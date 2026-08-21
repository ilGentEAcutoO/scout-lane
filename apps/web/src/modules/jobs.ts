import { Hono } from "hono";
import { jobGenerateSchema, jobListQuerySchema, jobPatchSchema, jobSchema, parseBody, uuidSchema } from "@scout-lane/core";
import { requireActor, requirePerm } from "../security/actor";
import { readJson } from "../security/body";
import { clientIp, rateLimit } from "../security/rate-limit";
import { HttpError } from "../http/errors";
import { glmJson, glmStream } from "../llm/glm";
import { getPrompt } from "../llm/settings";
import { descriptionDelta, finishStreamedDraft, pulseAsyncIterable } from "../llm/stream";

export const SEED_ROLE = {
  title: "Tech Lead / Senior Developer (AI Workflow & Automation)",
  description: `H+ Hotel Plus / บริษัท พักดีพลัส จำกัด
Hybrid Working | เข้าออฟฟิศทุกวันพุธ · Siam Pathumwan House ถนนพญาไท
จันทร์–ศุกร์ และ 1 เสาร์/เดือน · 09.00–18.00

วิเคราะห์ requirement และออกแบบ architecture / data flow
ออกแบบและพัฒนา AI workflow, automation, LLM, RAG, MCP
พัฒนา full stack web และ internal tools
เชื่อม REST API, webhook, OAuth, Google Workspace, LINE
ออกแบบ database, data pipeline, ETL
deploy ดูแลประสิทธิภาพ และถ่ายทอดความรู้ให้ทีม

Stack: React, TypeScript, JavaScript, Node.js, Express, PostgreSQL, MongoDB,
OpenAI, Claude, Gemini, RAG, MCP, GitHub, Docker

คุณสมบัติ: ประสบการณ์ 3–5 ปี, โครงการ AI automation อย่างน้อย 3 โครงการ,
ออกแบบ REST/webhook, systems thinking, portfolio หรือ GitHub เป็นพิเศษ`,
};

export const jobs = new Hono<{ Bindings: Env }>();

jobs.get("/api/jobs/seed", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.read");
  return c.json({ job: SEED_ROLE });
});

type JobRow = {
  id: string;
  title: string;
  description?: string | null;
  notes?: string | null;
  query: string | null;
  created_at: string;
  last_run_at: string | null;
  last_hit_count: number | null;
};

type JobListRow = JobRow & { run_count: number };

export async function recordScoutRun(
  env: Env,
  row: { jobId: string; query: string; hitCount: number; rankedBy: string },
): Promise<void> {
  await env.DB_MAIN.prepare(
    "INSERT INTO scout_runs (id, job_id, query, hit_count, ranked_by) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), row.jobId, row.query, row.hitCount, row.rankedBy)
    .run();
  await env.DB_MAIN.prepare(
    "UPDATE jobs SET query = ?, last_run_at = datetime('now'), last_hit_count = ? WHERE id = ?",
  )
    .bind(row.query, row.hitCount, row.jobId)
    .run();
}

function publicJob(row: JobRow, runCount = 0) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    notes: row.notes || "",
    query: row.query || "",
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
    lastHitCount: row.last_hit_count ?? 0,
    runCount,
  };
}

export function jobSearchNeedle(q: string): string | null {
  const t = q.trim().slice(0, 80).replace(/[%_]/g, "");
  if (!t) return null;
  return `%${t}%`;
}

export function jobTitleKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export function mergeGeneratedJob(current: string, drafted: string): {
  description: string;
  applied: boolean;
  draft: string;
} {
  const apply = !current.trim();
  return { description: apply ? drafted : current, applied: apply, draft: drafted };
}

export async function findJobIdByTitle(db: D1Database, title: string): Promise<string | null> {
  const key = jobTitleKey(title);
  if (!key) return null;
  const rows = await db.prepare("SELECT id, title FROM jobs").all<{ id: string; title: string }>();
  const hit = (rows.results ?? []).find((row) => jobTitleKey(row.title) === key);
  return hit?.id ?? null;
}

export async function ensureJob(
  db: D1Database,
  input: { id?: string | undefined; title: string; description: string; notes?: string | undefined },
): Promise<{ id: string; created: boolean }> {
  const title = input.title.trim() || "Open role";
  let id = input.id;
  if (id) {
    const exists = await db.prepare("SELECT id FROM jobs WHERE id = ?").bind(id).first();
    if (!exists) id = undefined;
  }
  if (!id) {
    id = (await findJobIdByTitle(db, title)) ?? undefined;
  }
  if (id) {
    if (input.notes !== undefined) {
      await db
        .prepare("UPDATE jobs SET title = ?, description = ?, notes = ? WHERE id = ?")
        .bind(title, input.description, input.notes, id)
        .run();
    } else {
      await db.prepare("UPDATE jobs SET title = ?, description = ? WHERE id = ?").bind(title, input.description, id).run();
    }
    return { id, created: false };
  }
  id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO jobs (id, title, description, notes) VALUES (?, ?, ?, ?)")
    .bind(id, title, input.description, input.notes ?? "")
    .run();
  return { id, created: true };
}

jobs.get("/api/jobs", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.read");
  const url = new URL(c.req.url);
  const parsed = parseBody(jobListQuerySchema, {
    q: url.searchParams.get("q") ?? "",
    page: url.searchParams.get("page") || 1,
    pageSize: url.searchParams.get("pageSize") || 20,
  });
  const needle = jobSearchNeedle(parsed.q);
  const where = needle ? "WHERE j.title LIKE ? OR ifnull(j.query,'') LIKE ? OR ifnull(j.notes,'') LIKE ?" : "";
  const offset = (parsed.page - 1) * parsed.pageSize;
  const countSql = `SELECT COUNT(*) AS n FROM jobs j ${where}`;
  const sql = `SELECT j.id, j.title, j.query, j.created_at, j.last_run_at, j.last_hit_count,
            (SELECT COUNT(*) FROM scout_runs r WHERE r.job_id = j.id) AS run_count
     FROM jobs j
     ${where}
     ORDER BY COALESCE(j.last_run_at, j.created_at) DESC
     LIMIT ? OFFSET ?`;
  const countRow = needle
    ? await c.env.DB_MAIN.prepare(countSql).bind(needle, needle, needle).first<{ n: number }>()
    : await c.env.DB_MAIN.prepare(countSql).first<{ n: number }>();
  const rows = needle
    ? await c.env.DB_MAIN.prepare(sql).bind(needle, needle, needle, parsed.pageSize, offset).all<JobListRow>()
    : await c.env.DB_MAIN.prepare(sql).bind(parsed.pageSize, offset).all<JobListRow>();
  return c.json({
    q: parsed.q,
    page: parsed.page,
    pageSize: parsed.pageSize,
    total: Number(countRow?.n || 0),
    jobs: (rows.results ?? []).map((row) => publicJob(row, Number(row.run_count || 0))),
  });
});

jobs.post("/api/jobs/generate", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.write");
  await rateLimit(c.env.KV_SESSIONS, `job-draft:${actor.userId}:${clientIp(c.req.raw)}`, 8, 60);
  const raw = await readJson(c.req.raw);
  const incoming = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const body = parseBody(jobGenerateSchema, {
    ...incoming,
    notes: String(incoming.notes || incoming.description || ""),
  });
  const prompt = await getPrompt(c.env, "prompt.job_draft");
  const drafted = await glmJson<{ title?: string; description?: string }>(
    c.env,
    [
      { role: "system", content: prompt },
      { role: "user", content: JSON.stringify({ title: body.title, notes: body.notes }) },
    ],
    { disableThinking: true },
  );
  const title = (drafted.title || body.title).trim().slice(0, 160);
  const description = (drafted.description || "").trim();
  if (description.length < 10) throw new HttpError(502, "llm_bad_json");
  const existingId = body.jobId || (await findJobIdByTitle(c.env.DB_MAIN, title));
  const existing = existingId
    ? await c.env.DB_MAIN.prepare("SELECT description FROM jobs WHERE id = ?")
        .bind(existingId)
        .first<{ description: string | null }>()
    : null;
  const merged = mergeGeneratedJob(existing?.description || "", description);
  const saved = await ensureJob(c.env.DB_MAIN, {
    id: existingId || undefined,
    title,
    description: merged.description,
    notes: body.notes,
  });
  const id = saved.id;
  const job = await c.env.DB_MAIN.prepare(
    "SELECT id, title, description, notes, query, created_at, last_run_at, last_hit_count FROM jobs WHERE id = ?",
  )
    .bind(id)
    .first<JobRow>();
  if (!job) throw new HttpError(500, "internal_error");
  return c.json({ job: publicJob(job), draft: merged.draft, applied: merged.applied }, saved.created ? 201 : 200);
});

jobs.post("/api/jobs/generate-stream", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.write");
  await rateLimit(c.env.KV_SESSIONS, `job-draft:${actor.userId}:${clientIp(c.req.raw)}`, 8, 60);
  const raw = await readJson(c.req.raw);
  const incoming = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const body = parseBody(jobGenerateSchema, {
    ...incoming,
    notes: String(incoming.notes || incoming.description || ""),
  });
  const prompt = await getPrompt(c.env, "prompt.job_draft");
  const existingId = body.jobId || (await findJobIdByTitle(c.env.DB_MAIN, body.title));
  const existing = existingId
    ? await c.env.DB_MAIN.prepare("SELECT description FROM jobs WHERE id = ?")
        .bind(existingId)
        .first<{ description: string | null }>()
    : null;

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = async (row: Record<string, unknown>) => {
    await writer.write(encoder.encode(`${JSON.stringify(row)}\n`));
  };

  const run = async () => {
    let buf = "";
    let streamed = "";
    try {
      await send({ type: "status", text: "กำลังร่าง job description…" });
      const beats = ["กำลังอ่านความรับผิดชอบ…", "กำลังร่างหน้าที่…", "กำลังเรียงสกิลและคุณสมบัติ…"];
      let beat = 0;
      for await (const piece of pulseAsyncIterable(
        glmStream(c.env, [
          { role: "system", content: prompt },
          { role: "user", content: JSON.stringify({ title: body.title, notes: body.notes }) },
        ]),
        async () => {
          await send({ type: "status", text: beats[beat % beats.length] });
          beat += 1;
        },
      )) {
        const next = buf + piece;
        const delta = descriptionDelta(buf, next);
        buf = next;
        if (delta) {
          streamed += delta;
          await send({ type: "delta", text: delta });
        }
      }
      const drafted = finishStreamedDraft(buf, streamed);
      const title = (drafted.title || body.title).trim().slice(0, 160);
      const description = drafted.description.trim();
      if (description.length < 10) throw new HttpError(502, "llm_bad_json");
      const merged = mergeGeneratedJob(existing?.description || "", description);
      const saved = await ensureJob(c.env.DB_MAIN, {
        id: existingId || undefined,
        title,
        description: merged.description,
        notes: body.notes,
      });
      const job = await c.env.DB_MAIN.prepare(
        "SELECT id, title, description, notes, query, created_at, last_run_at, last_hit_count FROM jobs WHERE id = ?",
      )
        .bind(saved.id)
        .first<JobRow>();
      if (!job) throw new HttpError(500, "internal_error");
      await send({ type: "done", job: publicJob(job), draft: merged.draft, applied: merged.applied });
    } catch (err) {
      const code = err instanceof HttpError ? err.code : "llm_upstream";
      try {
        await send({ type: "error", error: code });
      } catch {
        /* client closed the stream */
      }
    } finally {
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    }
  };

  void run();
  return new Response(readable, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});

jobs.get("/api/jobs/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.read");
  const row = await c.env.DB_MAIN.prepare(
    "SELECT id, title, description, notes, query, created_at, last_run_at, last_hit_count FROM jobs WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<JobRow>();
  if (!row) throw new HttpError(404, "not_found");
  const runs = await c.env.DB_MAIN.prepare(
    "SELECT id, query, hit_count, ranked_by, created_at FROM scout_runs WHERE job_id = ? ORDER BY created_at DESC LIMIT 12",
  )
    .bind(row.id)
    .all<{ id: string; query: string | null; hit_count: number; ranked_by: string | null; created_at: string }>();
  return c.json({
    job: publicJob(row, (runs.results ?? []).length),
    runs: (runs.results ?? []).map((run) => ({
      id: run.id,
      query: run.query || "",
      hitCount: run.hit_count,
      rankedBy: run.ranked_by || "",
      createdAt: run.created_at,
    })),
  });
});

jobs.patch("/api/jobs/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.write");
  const body = parseBody(jobPatchSchema, await readJson(c.req.raw));
  const current = await c.env.DB_MAIN.prepare(
    "SELECT id, title, description, notes FROM jobs WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<{ id: string; title: string; description: string; notes: string | null }>();
  if (!current) throw new HttpError(404, "not_found");
  await c.env.DB_MAIN.prepare("UPDATE jobs SET title = ?, description = ?, notes = ? WHERE id = ?")
    .bind(body.title ?? current.title, body.description ?? current.description, body.notes ?? current.notes ?? "", current.id)
    .run();
  return c.json({ ok: true, id: current.id });
});

jobs.delete("/api/jobs/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.write");
  await rateLimit(c.env.KV_SESSIONS, `job-del:${actor.userId}:${clientIp(c.req.raw)}`, 20, 60);
  const id = parseBody(uuidSchema, c.req.param("id"));
  const exists = await c.env.DB_MAIN.prepare("SELECT id, title FROM jobs WHERE id = ?")
    .bind(id)
    .first<{ id: string; title: string }>();
  if (!exists) throw new HttpError(404, "not_found");
  await c.env.DB_MAIN.batch([
    c.env.DB_MAIN.prepare("DELETE FROM scout_runs WHERE job_id = ?").bind(id),
    c.env.DB_MAIN.prepare("DELETE FROM shortlist WHERE job_id = ?").bind(id),
    c.env.DB_MAIN.prepare("DELETE FROM jobs WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true, id });
});

jobs.post("/api/jobs", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.write");
  const body = parseBody(jobSchema, await readJson(c.req.raw));
  const saved = await ensureJob(c.env.DB_MAIN, {
    title: body.title,
    description: body.description,
    ...(body.notes != null ? { notes: body.notes } : {}),
  });
  return c.json({ id: saved.id }, saved.created ? 201 : 200);
});
