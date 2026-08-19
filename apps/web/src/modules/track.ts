import { Hono } from "hono";
import {
  candidateCreateSchema,
  candidatePatchSchema,
  LIMITS,
  parseBody,
  STAGES,
  uuidSchema,
} from "@scout-lane/core";
import { requireActor, requirePerm } from "../security/actor";
import { readJson } from "../security/body";
import { HttpError } from "../http/errors";
import { listTrail, listTrailFor, logTrail } from "../trail";
import { publishLane } from "../do/lane-hub";

export const track = new Hono<{ Bindings: Env }>();

track.get("/api/candidates", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "candidates.read");
  const stage = c.req.query("stage");
  const source = c.req.query("source");
  const jobId = c.req.query("jobId");
  if (stage && !(STAGES as readonly string[]).includes(stage)) {
    throw new HttpError(400, "invalid_stage");
  }
  if (source && source.length > LIMITS.sourceMax) throw new HttpError(400, "invalid_source");
  if (jobId) parseBody(uuidSchema, jobId);

  let sql = `SELECT c.id, c.display_name, c.email, c.phone, c.source, c.stage, c.profile_url, c.headline, c.job_id, c.created_at,
    j.title AS job_title,
    a.skills_score, a.experience_score, a.culture_score, a.status AS screen_status, a.summary
    FROM candidates c
    LEFT JOIN jobs j ON j.id = c.job_id
    LEFT JOIN applications a ON a.id = (
      SELECT id FROM applications WHERE candidate_id = c.id ORDER BY created_at DESC LIMIT 1
    )
    WHERE 1=1`;
  const binds: string[] = [];
  if (stage) {
    sql += " AND c.stage = ?";
    binds.push(stage);
  }
  if (source) {
    sql += " AND c.source = ?";
    binds.push(source);
  }
  if (jobId) {
    sql += " AND c.job_id = ?";
    binds.push(jobId);
  }
  sql += " ORDER BY c.created_at DESC LIMIT 200";

  const stmt = c.env.DB_MAIN.prepare(sql);
  const rows = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  const candidates = (rows.results ?? []) as Array<{ id: string }>;
  const events = await listTrailFor(
    c.env.DB_MAIN,
    candidates.map((c) => c.id),
  );
  const byId = new Map<string, unknown[]>();
  for (const ev of events as Array<{ candidate_id: string }>) {
    const list = byId.get(ev.candidate_id) ?? [];
    list.push(ev);
    byId.set(ev.candidate_id, list);
  }
  return c.json({
    candidates: candidates.map((c) => ({ ...c, trail: byId.get(c.id) ?? [] })),
    stages: STAGES,
  });
});

track.get("/api/candidates/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "candidates.read");
  const id = c.req.param("id");
  parseBody(uuidSchema, id);
  const candidate = await c.env.DB_MAIN.prepare(
    `SELECT id, display_name, email, phone, source, stage, profile_url, headline, notes, job_id, created_at
     FROM candidates WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!candidate) throw new HttpError(404, "not_found");
  const [trail, interviews, application] = await Promise.all([
    listTrail(c.env.DB_MAIN, id),
    c.env.DB_MAIN.prepare(
      "SELECT id, starts_at, calendar_event_id FROM interviews WHERE candidate_id = ? ORDER BY starts_at",
    )
      .bind(id)
      .all(),
    c.env.DB_MAIN.prepare(
      "SELECT id, skills_score, experience_score, culture_score, skills_why, experience_why, culture_why, summary, status, flags, questions, strengths FROM applications WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(id)
      .first(),
  ]);
  return c.json({
    candidate,
    trail,
    interviews: interviews.results ?? [],
    application,
  });
});

track.post("/api/candidates", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "candidates.write");
  const body = parseBody(candidateCreateSchema, await readJson(c.req.raw));
  const id = crypto.randomUUID();
  await c.env.DB_MAIN.prepare(
    `INSERT INTO candidates (id, display_name, email, phone, source, profile_url, stage, job_id)
     VALUES (?, ?, ?, ?, ?, ?, 'applied', ?)`,
  )
    .bind(
      id,
      body.displayName,
      body.email || null,
      body.phone ?? null,
      body.source,
      body.profileUrl || null,
      body.jobId ?? null,
    )
    .run();
  await logTrail(c.env.DB_MAIN, id, "entered", { stage: "applied", detail: body.source });
  c.executionCtx.waitUntil(publishLane(c.env, { type: "board.changed", candidateId: id }));
  return c.json({ id }, 201);
});

track.patch("/api/candidates/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "candidates.write");
  const body = parseBody(candidatePatchSchema, await readJson(c.req.raw));
  const current = await c.env.DB_MAIN.prepare("SELECT id, stage FROM candidates WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ id: string; stage: string }>();
  if (!current) throw new HttpError(404, "not_found");

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.displayName) {
    sets.push("display_name = ?");
    binds.push(body.displayName);
  }
  if (body.email !== undefined) {
    sets.push("email = ?");
    binds.push(body.email || null);
  }
  if (body.phone !== undefined) {
    sets.push("phone = ?");
    binds.push(body.phone || null);
  }
  if (body.stage) {
    sets.push("stage = ?");
    binds.push(body.stage);
  }
  if (body.notes !== undefined) {
    sets.push("notes = ?");
    binds.push(body.notes);
  }
  if (!sets.length) throw new HttpError(400, "empty_patch");
  binds.push(c.req.param("id"));
  await c.env.DB_MAIN.prepare(`UPDATE candidates SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  if (body.stage && body.stage !== current.stage) {
    await logTrail(c.env.DB_MAIN, c.req.param("id"), "moved", {
      stage: body.stage,
      from: current.stage,
    });
  }
  c.executionCtx.waitUntil(publishLane(c.env, { type: "board.changed", candidateId: c.req.param("id") }));
  return c.json({ ok: true });
});

track.delete("/api/candidates/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "candidates.delete");
  await c.env.DB_MAIN.prepare("DELETE FROM interviews WHERE candidate_id = ?")
    .bind(c.req.param("id"))
    .run();
  await c.env.DB_MAIN.prepare("DELETE FROM applications WHERE candidate_id = ?")
    .bind(c.req.param("id"))
    .run();
  await c.env.DB_MAIN.prepare("DELETE FROM candidate_events WHERE candidate_id = ?")
    .bind(c.req.param("id"))
    .run();
  await c.env.DB_MAIN.prepare("DELETE FROM candidates WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  c.executionCtx.waitUntil(publishLane(c.env, { type: "board.changed", candidateId: c.req.param("id") }));
  return c.json({ ok: true });
});
