import { Hono } from "hono";
import { approveSchema, can, parseBody, scoutSearchSchema } from "@scout-lane/core";
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
  jobbkkAdapter,
  jobsdbAdapter,
  jobthaiAdapter,
  linkedinAdapter,
} from "./scout/policy";
import { apifySecretFor, apifyWebAdapter, linkedinPeopleQuery } from "./scout/apify";
import { buildSourceLanes, sourceLabel } from "./scout/catalog";
import { CANDIDATE_SOURCES, fallbackQuery } from "./scout/engine";
import {
  GROUP_HINTS,
  GROUP_SHORT,
  SOURCE_GROUPS,
  groupFor,
  normalizeModes,
  readyAdapters,
  readyFromModes,
  saveSourceModes,
} from "./scout/modes";
import {
  classifyHit,
  heuristicScore,
  hireableShortlist,
  overlayModelScores,
  peopleForModel,
  RANK_BATCH,
  RANK_CAP,
  scoreLocally,
} from "./scout/rank";
import type { CandidateHit, SourceAdapter, SourceId } from "./scout/types";
import { glmJson } from "../llm/glm";
import { getPrompt } from "../llm/settings";
import { ensureJob, recordScoutRun } from "./jobs";
import { track } from "../metrics";
import { logTrail } from "../trail";
import { publishLane } from "../do/lane-hub";
import {
  ScoutCancelled,
  cancelOtherScoutJobs,
  hashScoutKey,
  latestScoutJob,
  loadScoutJob,
  patchScoutJob,
  stepNext,
  type ScoutLogRow,
  type ScoutQueueJob,
} from "./scout/task";

const adapters: SourceAdapter[] = [
  linkedinAdapter,
  apifyWebAdapter,
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
  jobsdbAdapter,
  jobthaiAdapter,
  jobbkkAdapter,
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

scout.get("/api/scout/status", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "scout.run");
  const jobId = c.req.query("jobId");
  if (!jobId) throw new HttpError(400, "invalid_body");
  const run = await latestScoutJob(c.env.DB_MAIN, jobId);
  if (!run) return c.json({ run: null, shortlist: [] });
  let log: ScoutLogRow[] = [];
  try {
    log = JSON.parse(run.log || "[]") as ScoutLogRow[];
  } catch {
    log = [];
  }
  let shortlist: unknown[] = [];
  if (run.status === "done") {
    const job = await c.env.DB_MAIN.prepare("SELECT description FROM jobs WHERE id = ?")
      .bind(jobId)
      .first<{ description: string | null }>();
    const rows = await c.env.DB_MAIN.prepare(
      `SELECT id, source, external_id, display_name, headline, profile_url, location, reason, fit_score
       FROM shortlist WHERE job_id = ? ORDER BY COALESCE(fit_score, -1) DESC, display_name`,
    )
      .bind(jobId)
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
    shortlist = hireableShortlist(hits, undefined, job?.description ?? "", "thai");
  }
  return c.json({
    run: {
      id: run.id,
      jobId: run.job_id,
      jdHash: run.jd_hash,
      status: run.status,
      step: run.step,
      query: run.query,
      hitCount: run.hit_count,
      error: run.error,
      log,
    },
    shortlist,
  });
});

scout.get("/api/scout/sources", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "scout.run");
  const { ready, modes, hasToken } = await readyAdapters(c.env, adapters);
  const map = buildSourceLanes({
    adapters: ready,
    links: officialSearchUrls("Tech Lead AI Workflow"),
    modes,
  });
  return c.json({
    ...map,
    modes,
    hasShopKey: hasToken,
    groups: SOURCE_GROUPS.map((id) => ({
      id,
      label: GROUP_SHORT[id],
      hint: GROUP_HINTS[id],
      on: modes[id] !== "off",
      fetch: modes[id] === "self" || (modes[id] === "shop" && hasToken),
    })),
    sources: ready.map((a) => ({ id: a.id, status: a.status, label: sourceLabel(a.id) })),
  });
});

scout.post("/api/scout/search", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "scout.run");
  const body = parseBody(scoutSearchSchema, await readJson(c.req.raw));

  const saved = await ensureJob(c.env.DB_MAIN, {
    id: body.jobId,
    title: body.title || "Open role",
    description: body.jd,
  });
  const jobId = saved.id;
  const stored = await readyAdapters(c.env, adapters);
  const modes = body.modes ? normalizeModes(body.modes) : stored.modes;
  if (body.modes && can(actor.role, "settings.write")) {
    await saveSourceModes(c.env, modes);
  }
  const jdHash = await hashScoutKey(body.title || "", body.jd, modes);
  const current = await latestScoutJob(c.env.DB_MAIN, jobId);
  if (current && (current.status === "queued" || current.status === "running") && current.jd_hash === jdHash) {
    let log: ScoutLogRow[] = [];
    try {
      log = JSON.parse(current.log || "[]") as ScoutLogRow[];
    } catch {
      log = [];
    }
    return c.json({ runId: current.id, jobId, status: current.status, jdHash, reused: true, log }, 202);
  }

  const runId = crypto.randomUUID();
  const queuedLog = JSON.stringify([
    {
      state: "run",
      step: "query",
      via: "queue",
      message: "เข้าคิวแล้ว · รอตัวดึงเริ่มงาน",
      next: stepNext("query"),
    },
  ]);
  await c.env.DB_MAIN.prepare(
    `INSERT INTO scout_jobs (id, job_id, jd_hash, status, step, log) VALUES (?, ?, ?, 'queued', 'query', ?)`,
  )
    .bind(runId, jobId, jdHash, queuedLog)
    .run();
  await cancelOtherScoutJobs(c.env.DB_MAIN, jobId, runId);
  await c.env.SCOUT_QUEUE.send({
    runId,
    jobId,
    title: body.title || "Open role",
    jd: body.jd,
    jdHash,
    modes,
  } satisfies ScoutQueueJob);
  await publishLane(c.env, {
    type: "scout.progress",
    runId,
    jobId,
    candidateId: jobId,
    state: "run",
    via: "queue",
    message: "เข้าคิวแล้ว · รอตัวดึงเริ่มงาน",
    next: stepNext("query"),
  });
  return c.json({ runId, jobId, status: "queued", jdHash, reused: false }, 202);
});

function sourceVia(id: string): "apify" | "public" {
  return id === "linkedin" || id === "apify_web" ? "apify" : "public";
}

function sourceHow(id: string): string {
  return sourceVia(id) === "apify" ? "คุยกับ Apify" : "ดึง API สาธารณะ";
}

export function prioritizeLiveAdapters(list: SourceAdapter[]): SourceAdapter[] {
  const rank = (id: string) => (id === "linkedin" ? 0 : id === "apify_web" ? 1 : 2);
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
}

function scoutFetchError(err: unknown): string {
  if (!(err instanceof Error)) return "";
  const message = err.message;
  if (/abort|timeout/i.test(message)) return "timeout";
  const http = /apify_http_(\d+)/.exec(message);
  if (http) return `HTTP ${http[1]}`;
  return message.replace(/[^a-zA-Z0-9_ -]/g, "").slice(0, 40);
}

export async function executeScoutSearch(env: Env, job: ScoutQueueJob): Promise<void> {
  const live = await loadScoutJob(env.DB_MAIN, job.runId);
  if (!live || live.status === "cancelled") throw new ScoutCancelled();

  const log: ScoutLogRow[] = [];
  const say = async (patch: ScoutLogRow & { step?: string }) => {
    const row = await loadScoutJob(env.DB_MAIN, job.runId);
    if (!row || row.status === "cancelled") throw new ScoutCancelled();
    log.push(patch);
    if (log.length > 60) log.splice(0, log.length - 60);
    await patchScoutJob(env.DB_MAIN, job.runId, {
      status: patch.state === "done" ? "done" : "running",
      log,
      ...(patch.step ? { step: patch.step } : {}),
      ...(patch.state === "done" && patch.count != null ? { hitCount: patch.count } : {}),
    });
    await publishLane(env, {
      type: "scout.progress",
      runId: job.runId,
      jobId: job.jobId,
      candidateId: job.jobId,
      state: patch.state,
      message: patch.message,
      ...(patch.source ? { source: patch.source } : {}),
      ...(patch.count != null ? { count: patch.count } : {}),
      ...(patch.next ? { next: patch.next } : {}),
      ...(patch.step ? { step: patch.step } : {}),
      ...(patch.via ? { via: patch.via } : {}),
    });
  };

  const origin = "thai";
  await say({
    state: "run",
    step: "query",
    via: "llm",
    message: "เริ่มจากคิวแล้ว · โมเดลกำลังอ่าน JD แล้วตั้งคำค้น",
    next: stepNext("query"),
  });
  const queryPrompt = await getPrompt(env, "prompt.scout_query");
  let query = fallbackQuery(job.jd);
  try {
    const planned = await glmJson<{ query: string; languages?: string[]; location?: string }>(env, [
      { role: "system", content: queryPrompt },
      { role: "user", content: job.jd },
    ]);
    if (planned.query) query = planned.query;
    await say({ state: "ok", step: "query", via: "llm", message: `คำค้น: ${query}`, next: stepNext("query") });
  } catch {
    await say({
      state: "ok",
      step: "query",
      via: "llm",
      message: `โมเดลลิมิต — ใช้คำค้นสำรอง: ${query}`,
      next: stepNext("query"),
    });
  }
  await patchScoutJob(env.DB_MAIN, job.runId, { query });

  const stored = await readyAdapters(env, adapters);
  const modes = job.modes ? normalizeModes(job.modes as Parameters<typeof normalizeModes>[0]) : stored.modes;
  const shop = await apifySecretFor(env);
  const { ready, hasToken } = readyFromModes(env, adapters, modes, shop.key);
  const liveAdapters = prioritizeLiveAdapters(
    ready.filter((a) => a.status === "live" && CANDIDATE_SOURCES.has(a.id)),
  );
  const preview = buildSourceLanes({ adapters: ready, links: officialSearchUrls(query), modes });
  const liShop = modes.linkedin === "shop" && hasToken;
  await say({
    state: "ok",
    step: "fetch",
    message: liShop
      ? `จะดึงสด ${preview.lanes.live.length} แหล่ง · LinkedIn และค้นสาธารณะผ่าน Apify ที่เหลือดึง API`
      : `จะดึงสด ${preview.lanes.live.length} แหล่งสาธารณะ (API) · ไม่คุยกับ Apify รอบนี้`,
    next: stepNext("fetch"),
  });

  const batches: CandidateHit[][] = [];
  for (const a of liveAdapters) {
    const row = await loadScoutJob(env.DB_MAIN, job.runId);
    if (!row || row.status === "cancelled") throw new ScoutCancelled();
    const name = sourceLabel(a.id);
    const via = sourceVia(a.id);
    const how = sourceHow(a.id);
    const peopleQ = a.id === "linkedin" ? linkedinPeopleQuery(`${job.title} ${query}`) : "";
    await say({
      source: a.id,
      state: "run",
      step: "fetch",
      via,
      message: a.id === "linkedin"
        ? `กำลังคุยกับ Apify · LinkedIn People · "${peopleQ}" ในไทย`
        : `กำลัง${how} · ${name}`,
      next: stepNext("fetch"),
    });
    try {
      const rows = await a.search(a.id === "linkedin" ? `${job.title} ${query}` : query, env);
      batches.push(rows);
      await say({
        source: a.id,
        state: rows.length ? "ok" : "empty",
        count: rows.length,
        step: "fetch",
        via,
        message: rows.length
          ? `ได้ ${rows.length} โปรไฟล์จาก ${name}`
          : a.id === "linkedin"
            ? `LinkedIn ไม่เจอในรอบนี้ · ค้น "${peopleQ}" ที่กรุงเทพ`
            : `${name} ไม่เจอในรอบนี้`,
        next: stepNext("fetch"),
      });
    } catch (err) {
      batches.push([]);
      const why = scoutFetchError(err);
      await say({
        source: a.id,
        state: "fail",
        count: 0,
        step: "fetch",
        via,
        message: `${name} ดึงไม่สำเร็จ${why ? ` · ${why}` : ""}`,
        next: stepNext("fetch"),
      });
    }
  }

  const hits = dedupeHits(batches.flat()).slice(0, 500);
  const local = scoreLocally(hits, job.jd);
  const fromLi = hits.filter((hit) => hit.source === "linkedin").length;
  const fromCode = hits.filter((hit) => groupFor(hit.source) === "thai_code").length;
  const fromComm = hits.filter((hit) => groupFor(hit.source) === "community").length;
  const fromShop = hits.filter((hit) => hit.source === "apify_web").length;
  await say({
    state: "ok",
    step: "filter",
    count: hits.length,
    message: `ตัดซ้ำแล้วเหลือ ${hits.length} คนไม่ซ้ำ · LinkedIn ${fromLi} · GitHub ${fromCode} · ชุมชน ${fromComm} · ค้นสาธารณะ ${fromShop} · ต่อไปให้ AI คัด`,
    next: stepNext("filter"),
  });

  const forModel = peopleForModel(hits, RANK_CAP);
  const rankPrompt = await getPrompt(env, "prompt.scout_rank");
  const rankedItems: Array<{ externalId: string; fitScore: number; reason: string }> = [];
  if (forModel.length) {
    for (let i = 0; i < forModel.length; i += RANK_BATCH) {
      const row = await loadScoutJob(env.DB_MAIN, job.runId);
      if (!row || row.status === "cancelled") throw new ScoutCancelled();
      const chunk = forModel.slice(i, i + RANK_BATCH);
      await say({
        state: "rank",
        step: "rank",
        via: "llm",
        count: chunk.length,
        message: `โมเดลกำลังคัด ${i + 1}–${i + chunk.length} จาก ${forModel.length} คน`,
        next: stepNext("rank"),
      });
      try {
        const ranked = await glmJson<{ items: Array<{ externalId: string; fitScore: number; reason: string }> }>(env, [
          { role: "system", content: rankPrompt },
          {
            role: "user",
            content: JSON.stringify({
              jd: job.jd.slice(0, 4000),
              candidates: chunk,
            }),
          },
        ]);
        rankedItems.push(...(ranked.items || []));
      } catch {
        await say({
          state: "skip",
          step: "rank",
          message: "โมเดลลิมิตรอบนี้ — ใช้คะแนนสำรองจากกฎตำแหน่ง",
          next: stepNext("rank"),
        });
      }
    }
    await say({
      state: "ok",
      step: "rank",
      message: `AI ให้คะแนนแล้ว ${rankedItems.length} คน`,
      next: stepNext("rank"),
    });
  }

  const scored = hireableShortlist(overlayModelScores(local, rankedItems), undefined, job.jd, origin);
  const dropped = local.length - scored.length;
  await env.DB_MAIN.prepare("DELETE FROM shortlist WHERE job_id = ?").bind(job.jobId).run();
  const shortlist = [];
  for (const hit of scored) {
    const id = crypto.randomUUID();
    await env.DB_MAIN.prepare(
      `INSERT INTO shortlist
        (id, job_id, source, external_id, display_name, headline, profile_url, location, reason, fit_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        job.jobId,
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
    shortlist.push({ id, ...hit });
  }

  track(env, "scout_search", [shortlist.length]);
  await recordScoutRun(env, {
    jobId: job.jobId,
    query,
    hitCount: shortlist.length,
    rankedBy: rankedItems.length ? "model" : "heuristic",
  });
  await say({
    state: "done",
    step: "save",
    count: shortlist.length,
    message: `พร้อมแล้ว ${shortlist.length} คนที่จ้างได้ · LinkedIn ${shortlist.filter((row) => row.source === "linkedin").length} · GitHub ${shortlist.filter((row) => groupFor(row.source) === "thai_code").length} · ชุมชน ${shortlist.filter((row) => groupFor(row.source) === "community").length} · ค้นสาธารณะ ${shortlist.filter((row) => row.source === "apify_web").length}${dropped ? ` · ตัดองค์กร/แพ็กเกจ ${dropped} ราย` : ""} — กดส่งเข้าท่อได้`,
  });
  await patchScoutJob(env.DB_MAIN, job.runId, {
    status: "done",
    step: "save",
    query,
    log,
    hitCount: shortlist.length,
  });
  await publishLane(env, {
    type: "scout.ready",
    runId: job.runId,
    jobId: job.jobId,
    candidateId: job.jobId,
    state: "done",
    count: shortlist.length,
    message: `พร้อมแล้ว ${shortlist.length} คน`,
  });
}

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

export type { CandidateHit };
