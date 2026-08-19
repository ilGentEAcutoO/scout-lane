import { Hono } from "hono";
import { approveSchema, parseBody, scoutSearchSchema } from "@scout-lane/core";
import { requireActor, requirePerm } from "../security/actor";
import { readJson } from "../security/body";
import { HttpError } from "../http/errors";
import { githubAdapter } from "./scout/github";
import { officialSearchUrls } from "./scout/links";
import { gitlabAdapter, huggingfaceAdapter, npmAdapter } from "./scout/public";
import { devhubAdapter } from "./scout/devhub";
import { devtoAdapter, githubReposAdapter, hnAdapter, redditAdapter } from "./scout/extra";
import {
  cratesAdapter,
  githubThailandAdapter,
  hfSpacesAdapter,
  pypiAdapter,
  rubygemsAdapter,
  stackoverflowAdapter,
} from "./scout/deep";
import {
  dblpAdapter,
  githubBangkokAdapter,
  githubLangchainAdapter,
  gitlabProjectsAdapter,
  hexAdapter,
  hfForumAdapter,
  lobstersAdapter,
  openalexAdapter,
  openaiForumAdapter,
  openvsxAdapter,
  packagistAdapter,
  pubdevAdapter,
  s2Adapter,
  stackAiAdapter,
  stackDsAdapter,
} from "./scout/wave";
import {
  facebookAdapter,
  jobbkkAdapter,
  jobsdbAdapter,
  jobthaiAdapter,
  linkedinAdapter,
} from "./scout/policy";
import { apifyWebAdapter, withVendorStatus } from "./scout/apify";
import { buildSourceLanes, sourceLabel } from "./scout/catalog";
import { CANDIDATE_SOURCES } from "./scout/engine";
import {
  classifyHit,
  heuristicScore,
  hireableShortlist,
  hitThai,
  overlayModelScores,
  peopleForModel,
  scoreLocally,
} from "./scout/rank";
import type { CandidateHit, SourceAdapter, SourceId } from "./scout/types";
import { glmJson } from "../llm/glm";
import { getPrompt } from "../llm/settings";
import { track } from "../metrics";
import { logTrail } from "../trail";
import { publishLane } from "../do/lane-hub";

const adapters: SourceAdapter[] = [
  githubAdapter,
  githubReposAdapter,
  huggingfaceAdapter,
  npmAdapter,
  gitlabAdapter,
  devtoAdapter,
  devhubAdapter,
  hnAdapter,
  redditAdapter,
  stackoverflowAdapter,
  cratesAdapter,
  pypiAdapter,
  rubygemsAdapter,
  githubThailandAdapter,
  hfSpacesAdapter,
  githubBangkokAdapter,
  githubLangchainAdapter,
  gitlabProjectsAdapter,
  stackAiAdapter,
  stackDsAdapter,
  packagistAdapter,
  hexAdapter,
  pubdevAdapter,
  openvsxAdapter,
  lobstersAdapter,
  hfForumAdapter,
  openaiForumAdapter,
  dblpAdapter,
  s2Adapter,
  openalexAdapter,
  linkedinAdapter,
  facebookAdapter,
  jobsdbAdapter,
  jobthaiAdapter,
  jobbkkAdapter,
  apifyWebAdapter,
];

export const scout = new Hono<{ Bindings: Env }>();

scout.get("/api/scout/latest", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "scout.run");
  const origin = "thai";
  const latest = await c.env.DB_MAIN.prepare(
    "SELECT job_id, created_at FROM shortlist ORDER BY created_at DESC LIMIT 1",
  ).first<{ job_id: string; created_at: string }>();
  if (!latest) return c.json({ jobId: null, query: null, shortlist: [] });
  const job = await c.env.DB_MAIN.prepare("SELECT id, title, description FROM jobs WHERE id = ?")
    .bind(latest.job_id)
    .first<{ id: string; title: string; description: string }>();
  const rows = await c.env.DB_MAIN.prepare(
    `SELECT id, source, external_id, display_name, headline, profile_url, location, reason, fit_score
     FROM shortlist WHERE job_id = ? ORDER BY COALESCE(fit_score, -1) DESC, display_name`,
  )
    .bind(latest.job_id)
    .all<{
      id: string;
      source: string;
      external_id: string;
      display_name: string;
      headline: string | null;
      profile_url: string | null;
      location: string | null;
      reason: string | null;
      fit_score: number | null;
    }>();
  const hits = (rows.results ?? []).map((row) => {
    const hit: CandidateHit = {
      source: row.source as SourceId,
      externalId: row.external_id,
      displayName: row.display_name,
      headline: row.headline ?? "",
      profileUrl: row.profile_url ?? "",
      location: row.location,
    };
    const local = heuristicScore(hit);
    return {
      id: row.id,
      ...hit,
      kind: local.kind,
      fitScore: row.fit_score ?? local.fitScore,
      reason: row.reason || local.reason,
    };
  });
  const shortlist = hireableShortlist(hits, undefined, job?.description ?? "", origin);
  return c.json({
    jobId: latest.job_id,
    title: job?.title ?? null,
    shortlist,
  });
});

scout.get("/api/scout/sources", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "scout.run");
  const ready = withVendorStatus(adapters, c.env);
  const map = buildSourceLanes({
    adapters: ready,
    links: officialSearchUrls("Tech Lead AI Workflow"),
  });
  return c.json({
    ...map,
    sources: ready.map((a) => ({ id: a.id, status: a.status, label: sourceLabel(a.id) })),
  });
});

scout.post("/api/scout/search", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "scout.run");
  const body = parseBody(scoutSearchSchema, await readJson(c.req.raw));

  const jobId = body.jobId ?? crypto.randomUUID();
  if (!body.jobId) {
    await c.env.DB_MAIN.prepare("INSERT INTO jobs (id, title, description) VALUES (?, ?, ?)")
      .bind(jobId, body.title || "Open role", body.jd)
      .run();
  }

  const runId = crypto.randomUUID();
  const say = (patch: { source?: string; state: string; count?: number; message: string }) =>
    c.executionCtx.waitUntil(
      publishLane(c.env, { type: "scout.progress", runId, candidateId: jobId, ...patch }),
    );

  const origin = "thai";
  const originLabel = "คนไทย";
  say({ state: "run", message: `ขั้นแรก: หา${originLabel} · อ่าน JD แล้วกำลังตั้งคำค้น` });
  const queryPrompt = await getPrompt(c.env, "prompt.scout_query");
  let query = fallbackQuery(body.jd);
  try {
    const planned = await glmJson<{ query: string; languages?: string[]; location?: string }>(
      c.env,
      [
        { role: "system", content: queryPrompt },
        { role: "user", content: body.jd },
      ],
    );
    if (planned.query) query = planned.query;
    say({ state: "ok", message: `คำค้น: ${query}` });
  } catch {
    say({ state: "ok", message: `โมเดลลิมิต — ใช้คำค้นสำรอง: ${query}` });
  }

  const ready = withVendorStatus(adapters, c.env);
  const live = ready.filter((a) => a.status === "live" && CANDIDATE_SOURCES.has(a.id));
  const preview = buildSourceLanes({ adapters: ready, links: officialSearchUrls(query) });
  say({
    state: "skip",
    message: `ไม่ดึง ${preview.lanes.blocked.map((row) => row.label).join(" · ")} — ไม่มี API สาธารณะ / กำแพงล็อกอิน`,
  });
  say({
    state: "ok",
    message: `จะดึงสด ${preview.lanes.live.length} แหล่งสาธารณะ — LinkedIn ไม่ได้อยู่ในนี้`,
  });

  const batches = await Promise.all(
    live.map(async (a) => {
      const name = sourceLabel(a.id);
      say({ source: a.id, state: "run", message: `กำลังดึง ${name}` });
      try {
        const rows = await a.search(query, c.env);
        say({
          source: a.id,
          state: rows.length ? "ok" : "empty",
          count: rows.length,
          message: rows.length ? `ได้ ${rows.length} โปรไฟล์จาก ${name}` : `${name} ไม่เจอในรอบนี้`,
        });
        return rows;
      } catch {
        say({ source: a.id, state: "fail", count: 0, message: `${name} ดึงไม่สำเร็จ` });
        return [] as CandidateHit[];
      }
    }),
  );
  const hits = dedupeHits(batches.flat())
    .filter((hit) => hitThai(hit))
    .slice(0, 140);
  const local = scoreLocally(hits, body.jd);
  const forModel = peopleForModel(hits);

  say({
    state: "rank",
    count: hits.length,
    message: `ได้ ${hits.length} รายการ · ส่ง ${forModel.length} คนให้ AI คัด (องค์กร/แพ็กเกจคะแนน 0)`,
  });
  const rankPrompt = await getPrompt(c.env, "prompt.scout_rank");
  let ranked: { items: Array<{ externalId: string; fitScore: number; reason: string }> } = { items: [] };
  if (forModel.length) {
    try {
      ranked = await glmJson<{ items: Array<{ externalId: string; fitScore: number; reason: string }> }>(
        c.env,
        [
          { role: "system", content: rankPrompt },
          {
            role: "user",
            content: JSON.stringify({
              jd: body.jd.slice(0, 4000),
              candidates: forModel,
            }),
          },
        ],
      );
      say({ state: "ok", message: `AI ให้คะแนนแล้ว ${ranked.items?.length ?? 0} คน` });
    } catch {
      say({ state: "skip", message: "โมเดลลิมิต — ใช้คะแนนสำรองจากกฎตำแหน่งนี้" });
      ranked = { items: [] };
    }
  }

  const scored = hireableShortlist(overlayModelScores(local, ranked.items), undefined, body.jd, origin);
  const dropped = local.length - scored.length;
  const shortlist = [];
  for (const hit of scored) {
    const id = crypto.randomUUID();
    await c.env.DB_MAIN.prepare(
      `INSERT INTO shortlist
        (id, job_id, source, external_id, display_name, headline, profile_url, location, reason, fit_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        jobId,
        hit.source,
        hit.externalId,
        hit.displayName,
        hit.headline,
        hit.profileUrl,
        hit.location,
        hit.reason,
        hit.fitScore,
      )
      .run();
    shortlist.push({
      id,
      ...hit,
    });
  }

  track(c.env, "scout_search", [shortlist.length]);
  say({
    state: "done",
    count: shortlist.length,
    message: `พร้อมแล้ว ${shortlist.length} คนที่จ้างได้${dropped ? ` · ตัดองค์กร/แพ็กเกจ ${dropped} ราย` : ""} — กดส่งเข้าท่อได้`,
  });
  const counts: Record<string, number> = {};
  live.forEach((adapter, index) => {
    counts[adapter.id] = batches[index]?.length ?? 0;
  });
  const map = buildSourceLanes({ adapters: ready, links: officialSearchUrls(query), counts });
  return c.json({
    jobId,
    runId,
    query,
    shortlist,
    dropped,
    rankedBy: (ranked.items?.length ?? 0) ? "model" : "heuristic",
    links: officialSearchUrls(query),
    ...map,
    sources: ready.map((a) => ({ id: a.id, status: a.status, label: sourceLabel(a.id) })),
  });
});

scout.post("/api/scout/approve", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "scout.run");
  const body = parseBody(approveSchema, await readJson(c.req.raw));

  const moved: string[] = [];
  for (const id of body.ids) {
    const row = await c.env.DB_MAIN.prepare(
      "SELECT * FROM shortlist WHERE id = ? AND approved = 0",
    )
      .bind(id)
      .first<{
        job_id: string;
        source: string;
        display_name: string;
        headline: string | null;
        profile_url: string | null;
        location: string | null;
      }>();
    if (!row) continue;
    const candidateId = crypto.randomUUID();
    await c.env.DB_MAIN.batch([
      c.env.DB_MAIN.prepare(
        `INSERT INTO candidates (id, display_name, source, profile_url, headline, stage, job_id)
         VALUES (?, ?, ?, ?, ?, 'applied', ?)`,
      ).bind(
        candidateId,
        row.display_name,
        row.source,
        row.profile_url,
        row.headline,
        row.job_id,
      ),
      c.env.DB_MAIN.prepare("UPDATE shortlist SET approved = 1 WHERE id = ?").bind(id),
    ]);
    await logTrail(c.env.DB_MAIN, candidateId, "entered", {
      stage: "applied",
      detail: row.source,
    });
    moved.push(candidateId);
  }

  track(c.env, "scout_approve", [moved.length]);
  if (moved.length) {
    c.executionCtx.waitUntil(publishLane(c.env, { type: "scout.changed", candidateId: moved[0]! }));
  }
  return c.json({ candidateIds: moved });
});

function dedupeHits(hits: CandidateHit[]): CandidateHit[] {
  const seen = new Set<string>();
  const out: CandidateHit[] = [];
  for (const hit of hits) {
    const key = hit.profileUrl || `${hit.source}:${hit.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function fallbackQuery(jd: string): string {
  const lang = /typescript|javascript|vue|nuxt|react|python|go\b/i.exec(jd)?.[0] ?? "TypeScript";
  const skill = /\b(MCP|RAG|LLM|automation)\b/i.exec(jd)?.[0] ?? "AI";
  return `${skill} ${lang} location:Bangkok`;
}

export type { CandidateHit };
