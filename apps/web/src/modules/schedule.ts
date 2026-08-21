import { Hono } from "hono";
import { interviewPatchSchema, interviewSchema, parseBody } from "@scout-lane/core";
import { requireActor, requirePerm } from "../security/actor";
import { readJson } from "../security/body";
import { HttpError } from "../http/errors";
import { getPrompt } from "../llm/settings";
import { glmJson } from "../llm/glm";
import { logTrail } from "../trail";
import { publishLane } from "../do/lane-hub";
import {
  consumeOauthState,
  createMeet,
  deleteMeet,
  updateMeet,
  exchangeCode,
  googleAuthUrl,
  googleConfigured,
  hasRefreshToken,
  mintOauthState,
  parseCalendarMode,
  parseShareEmails,
  queryFreeBusy,
  tokenKeyFor,
  type CalendarMode,
  type OauthKind,
} from "./schedule/google";

export const schedule = new Hono<{ Bindings: Env }>();

type CalPerson = { id: string; username: string; calendarEmail: string | null };

async function settingValue(env: Env, key: string): Promise<string | null> {
  const row = await env.DB_MAIN.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function calendarMode(env: Env): Promise<CalendarMode> {
  return parseCalendarMode(await settingValue(env, "calendar.mode"));
}

async function extraShareEmails(env: Env): Promise<string[]> {
  return parseShareEmails(await settingValue(env, "calendar.share_emails"));
}

async function calendarPeople(env: Env): Promise<CalPerson[]> {
  const rows = await env.DB_MAIN.prepare(
    "SELECT id, username, calendar_email FROM users WHERE disabled = 0 ORDER BY username",
  ).all<{ id: string; username: string; calendar_email: string | null }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    username: row.username,
    calendarEmail: row.calendar_email,
  }));
}

schedule.get("/api/schedule/status", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "interviews.read");
  const mode = await calendarMode(c.env);
  const [team, me] = await Promise.all([
    hasRefreshToken(c.env, tokenKeyFor("team")),
    hasRefreshToken(c.env, tokenKeyFor("me", actor.userId)),
  ]);
  return c.json({
    google: googleConfigured(c.env),
    mode,
    team,
    me,
    shareEmails: (await extraShareEmails(c.env)).join("\n"),
    people: await calendarPeople(c.env),
  });
});

schedule.get("/api/schedule/busy", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "interviews.read");
  const from = Date.parse(c.req.query("from") ?? "");
  const to = Date.parse(c.req.query("to") ?? "");
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > 45 * 86_400_000) {
    throw new HttpError(400, "invalid_range");
  }
  const who = c.req.query("who") ?? "all";
  const mode = await calendarMode(c.env);
  const people = await calendarPeople(c.env);
  const picked = who === "all" ? people : people.filter((p) => p.id === who);
  const timeMin = new Date(from).toISOString();
  const timeMax = new Date(to).toISOString();
  const blocks: { start: string; end: string }[] = [];

  if (mode === "share" || mode === "both") {
    const emails = [
      ...picked.map((p) => p.calendarEmail).filter((e): e is string => Boolean(e)),
      ...(who === "all" ? await extraShareEmails(c.env) : []),
    ];
    blocks.push(...(await queryFreeBusy(c.env, tokenKeyFor("team"), emails, timeMin, timeMax)));
  }
  if (mode === "personal" || mode === "both") {
    const targets = picked.length ? picked : people;
    for (const person of targets) {
      const key = tokenKeyFor("me", person.id);
      if (!(await hasRefreshToken(c.env, key))) continue;
      blocks.push(...(await queryFreeBusy(c.env, key, ["primary"], timeMin, timeMax)));
    }
  }
  return c.json({ busy: blocks });
});

schedule.get("/api/schedule/oauth/start", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "interviews.write");
  if (!googleConfigured(c.env)) throw new HttpError(503, "google_not_configured");
  const kind: OauthKind = c.req.query("kind") === "me" ? "me" : "team";
  const state = await mintOauthState(c.env, { kind, userId: actor.userId });
  return c.redirect(googleAuthUrl(c.env, state), 302);
});

schedule.get("/api/schedule/oauth/callback", async (c) => {
  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  const payload = await consumeOauthState(c.env, state);
  if (!code || !payload) {
    return c.redirect("/app/schedule?google=denied", 302);
  }
  try {
    await exchangeCode(c.env, code, tokenKeyFor(payload.kind, payload.userId));
  } catch {
    return c.redirect("/app/schedule?google=fail", 302);
  }
  const dest = payload.kind === "me" ? "profile" : "schedule";
  return c.redirect(dest === "profile" ? "/app/profile?google=ok" : "/app/schedule?google=ok", 302);
});

schedule.get("/api/interviews", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "interviews.read");
  const rows = await c.env.DB_MAIN.prepare(
    `SELECT i.id, i.candidate_id, i.starts_at, i.minutes, i.calendar_event_id, i.meet_url, i.interviewer_id, c.display_name, c.stage
     FROM interviews i
     JOIN candidates c ON c.id = i.candidate_id
     ORDER BY i.starts_at ASC`,
  ).all();
  return c.json({ interviews: rows.results ?? [], google: googleConfigured(c.env) });
});

schedule.post("/api/interviews", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "interviews.write");
  const body = parseBody(interviewSchema, await readJson(c.req.raw));

  const start = Date.parse(body.startsAt);
  if (Number.isNaN(start)) throw new HttpError(400, "invalid_time");
  const end = start + body.minutes * 60_000;
  const id = crypto.randomUUID();

  const lock = c.env.SLOT_LOCK.getByName("hq");
  const reserved = await lock.reserve(id, start, end);
  if (!reserved.ok) throw new HttpError(409, "conflict");

  try {
    await c.env.DB_MAIN.prepare(
      "INSERT INTO interviews (id, candidate_id, starts_at, minutes, calendar_event_id, interviewer_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, body.candidateId, new Date(start).toISOString(), body.minutes, null, body.interviewerId ?? null)
      .run();
  } catch (err) {
    await lock.release(id);
    throw err;
  }

  await c.env.DB_MAIN.prepare(
    "UPDATE candidates SET stage = 'interview' WHERE id = ? AND stage IN ('applied','screening','prescreen')",
  )
    .bind(body.candidateId)
    .run();
  await logTrail(c.env.DB_MAIN, body.candidateId, "booked", {
    stage: "interview",
    detail: new Date(start).toISOString(),
  });

  c.executionCtx.waitUntil(writeBriefing(c.env, id, body.candidateId, start, end, body.interviewerId));
  c.executionCtx.waitUntil(publishLane(c.env, { type: "calendar.changed", candidateId: body.candidateId }));

  return c.json({
    id,
    startsAt: new Date(start).toISOString(),
    minutes: body.minutes,
    briefing: "",
    provider: googleConfigured(c.env) ? "google" : "local",
  }, 201);
});

schedule.patch("/api/interviews/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "interviews.write");
  const id = c.req.param("id");
  const body = parseBody(interviewPatchSchema, await readJson(c.req.raw));
  const row = await c.env.DB_MAIN.prepare(
    `SELECT id, candidate_id, starts_at, minutes, calendar_event_id, meet_url, interviewer_id
     FROM interviews WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      candidate_id: string;
      starts_at: string;
      minutes: number | null;
      calendar_event_id: string | null;
      meet_url: string | null;
      interviewer_id: string | null;
    }>();
  if (!row) throw new HttpError(404, "not_found");

  const candidateId = body.candidateId ?? row.candidate_id;
  const startsAt = body.startsAt ?? row.starts_at;
  const minutes = body.minutes ?? row.minutes ?? 45;
  const interviewerId = body.interviewerId === "" ? null : (body.interviewerId ?? row.interviewer_id);

  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) throw new HttpError(400, "invalid_time");
  const end = start + minutes * 60_000;
  const startIso = new Date(start).toISOString();

  const lock = c.env.SLOT_LOCK.getByName("hq");
  const reserved = await lock.reserve(id, start, end);
  if (!reserved.ok) throw new HttpError(409, "conflict");

  try {
    await c.env.DB_MAIN.prepare(
      "UPDATE interviews SET candidate_id = ?, starts_at = ?, minutes = ?, interviewer_id = ? WHERE id = ?",
    )
      .bind(candidateId, startIso, minutes, interviewerId, id)
      .run();
  } catch (err) {
    await lock.reserve(id, Date.parse(row.starts_at), Date.parse(row.starts_at) + (row.minutes || 45) * 60_000);
    throw err;
  }

  if (candidateId !== row.candidate_id) {
    await c.env.DB_MAIN.prepare(
      "UPDATE candidates SET stage = 'prescreen' WHERE id = ? AND stage = 'interview'",
    )
      .bind(row.candidate_id)
      .run();
    await c.env.DB_MAIN.prepare(
      "UPDATE candidates SET stage = 'interview' WHERE id = ? AND stage IN ('applied','screening','prescreen')",
    )
      .bind(candidateId)
      .run();
  }

  await logTrail(c.env.DB_MAIN, candidateId, "rescheduled", { stage: "interview", detail: startIso });
  c.executionCtx.waitUntil(syncMeetEvent(c.env, { ...row, candidate_id: candidateId, interviewer_id: interviewerId }, start, end));
  c.executionCtx.waitUntil(publishLane(c.env, { type: "calendar.changed", candidateId }));
  return c.json({ id, startsAt: startIso, minutes });
});

schedule.delete("/api/interviews/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "interviews.write");
  const id = c.req.param("id");
  const row = await c.env.DB_MAIN.prepare(
    "SELECT id, candidate_id, calendar_event_id FROM interviews WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; candidate_id: string; calendar_event_id: string | null }>();
  if (!row) throw new HttpError(404, "not_found");
  await c.env.SLOT_LOCK.getByName("hq").release(id);
  if (row.calendar_event_id) {
    c.executionCtx.waitUntil(deleteMeet(c.env, row.calendar_event_id));
  }
  await c.env.DB_MAIN.prepare("DELETE FROM interviews WHERE id = ?").bind(id).run();
  await c.env.DB_MAIN.prepare(
    "UPDATE candidates SET stage = 'prescreen' WHERE id = ? AND stage = 'interview'",
  )
    .bind(row.candidate_id)
    .run();
  await logTrail(c.env.DB_MAIN, row.candidate_id, "cancelled", { stage: "prescreen" });
  c.executionCtx.waitUntil(publishLane(c.env, { type: "calendar.changed", candidateId: row.candidate_id }));
  return c.json({ ok: true });
});

async function meetCalendarKey(env: Env, interviewerId?: string | null): Promise<string> {
  const mode = await calendarMode(env);
  let key = tokenKeyFor("team");
  if (interviewerId && (mode === "personal" || mode === "both")) {
    const personal = tokenKeyFor("me", interviewerId);
    if (await hasRefreshToken(env, personal)) key = personal;
  }
  return key;
}

async function syncMeetEvent(
  env: Env,
  row: { id: string; candidate_id: string; calendar_event_id: string | null; interviewer_id: string | null },
  start: number,
  end: number,
): Promise<void> {
  const eventId = row.calendar_event_id;
  if (!eventId || eventId === "local" || eventId === "mcp") {
    await writeBriefing(env, row.id, row.candidate_id, start, end, row.interviewer_id ?? undefined);
    return;
  }
  const person = await env.DB_MAIN.prepare("SELECT display_name FROM candidates WHERE id = ?")
    .bind(row.candidate_id)
    .first<{ display_name: string }>();
  const key = await meetCalendarKey(env, row.interviewer_id);
  const updated = await updateMeet(
    env,
    eventId,
    {
      summary: `สัมภาษณ์ · ${person?.display_name ?? ""}`,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    },
    key,
  );
  if (!updated) {
    await writeBriefing(env, row.id, row.candidate_id, start, end, row.interviewer_id ?? undefined);
    return;
  }
  if (updated.meetUrl) {
    await env.DB_MAIN.prepare("UPDATE interviews SET meet_url = ? WHERE id = ?").bind(updated.meetUrl, row.id).run();
  }
}

async function writeBriefing(
  env: Env,
  interviewId: string,
  candidateId: string,
  start: number,
  end: number,
  interviewerId?: string,
): Promise<void> {
  const app = await env.DB_MAIN.prepare(
    `SELECT a.questions, a.flags, a.summary, c.display_name, j.title, j.description
     FROM candidates c
     LEFT JOIN applications a ON a.candidate_id = c.id
     LEFT JOIN jobs j ON j.id = COALESCE(c.job_id, a.job_id)
     WHERE c.id = ?
     ORDER BY a.created_at DESC
     LIMIT 1`,
  )
    .bind(candidateId)
    .first<{
      questions: string | null;
      flags: string | null;
      summary: string | null;
      display_name: string;
      title: string | null;
      description: string | null;
    }>();
  if (!app) return;

  let briefing = "";
  try {
    const system = await getPrompt(env, "prompt.interview_pack");
    const pack = await glmJson<{ questions?: string[]; talkingPoints?: string[] }>(env, [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(app) },
    ]);
    briefing = [...(pack.talkingPoints ?? []), ...(pack.questions ?? [])].join("\n");
  } catch {
    briefing = app.summary ?? "";
  }

  const key = await meetCalendarKey(env, interviewerId);
  const created = await createMeet(env, {
    summary: `สัมภาษณ์ · ${app.display_name}${app.title ? ` · ${app.title}` : ""}`,
    description: briefing,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  }, key);

  await env.DB_MAIN.prepare(
    "UPDATE interviews SET calendar_event_id = ?, meet_url = ? WHERE id = ?",
  )
    .bind(created?.eventId ?? "local", created?.meetUrl ?? null, interviewId)
    .run();
}
