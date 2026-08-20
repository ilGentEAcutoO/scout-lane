import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  approveSchema,
  can,
  capabilities,
  candidateCreateSchema,
  candidatePatchSchema,
  createUser,
  createUserSchema,
  deleteUser,
  interviewSchema,
  jobSchema,
  LIMITS,
  listUsers,
  parseBody,
  patchUserSchema,
  promptSaveSchema,
  STAGES,
  type AccessPrincipal,
  type Perm,
  updateUser,
  uuidSchema,
} from "@scout-lane/core";
import { clientIp, limit } from "./rate";
import { glmJson } from "./glm";
import { officialSearchUrls } from "../../web/src/modules/scout/links";
import { buildSourceLanes, sourceLabel } from "../../web/src/modules/scout/catalog";
import {
  hireableShortlist,
  hitThai,
  overlayModelScores,
  peopleForModel,
  scoreLocally,
} from "../../web/src/modules/scout/rank";
import { githubAdapter } from "../../web/src/modules/scout/github";
import { gitlabAdapter, huggingfaceAdapter, npmAdapter } from "../../web/src/modules/scout/public";
import { devhubAdapter } from "../../web/src/modules/scout/devhub";
import { devtoAdapter, githubReposAdapter, hnAdapter, redditAdapter } from "../../web/src/modules/scout/extra";
import {
  cratesAdapter,
  githubThailandAdapter,
  hfSpacesAdapter,
  pypiAdapter,
  rubygemsAdapter,
  stackoverflowAdapter,
} from "../../web/src/modules/scout/deep";
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
} from "../../web/src/modules/scout/wave";
import {
  facebookAdapter,
  jobbkkAdapter,
  jobsdbAdapter,
  jobthaiAdapter,
  linkedinAdapter,
} from "../../web/src/modules/scout/policy";
import { apifyWebAdapter } from "../../web/src/modules/scout/apify";
import { CANDIDATE_SOURCES } from "../../web/src/modules/scout/engine";
import { readyAdapters } from "../../web/src/modules/scout/modes";
import { getPrompt } from "../../web/src/llm/settings";
import { SEED_ROLE } from "../../web/src/modules/jobs";
import { slotsOverlap } from "../../web/src/do/overlap";
import { logTrail, listTrail } from "../../web/src/trail";
import { createMeet, googleConfigured } from "../../web/src/modules/schedule/google";

const liveAdapters = [
  githubAdapter,
  githubThailandAdapter,
  githubBangkokAdapter,
  gitlabAdapter,
  devtoAdapter,
  hnAdapter,
  devhubAdapter,
  stackoverflowAdapter,
  apifyWebAdapter,
];
const policyAdapters = [linkedinAdapter, facebookAdapter, jobsdbAdapter, jobthaiAdapter, jobbkkAdapter];

function mcpAdapterList() {
  return [...liveAdapters, ...policyAdapters];
}

export function buildServer(env: Env, user: AccessPrincipal, request: Request): McpServer {
  const server = new McpServer({ name: "scout-lane", version: "1.0.0" });
  const lane = env as never;

  const gated = async (tool: string, perm: Perm, fn: () => Promise<unknown>, write = false) => {
    if (!can(user.role, perm)) return text("forbidden");
    const ok = await limit(env.KV_SESSIONS, `mcp:${user.userId}:${tool}`, write ? 20 : 60, 60);
    if (!ok) return text("rate_limited");
    const ipOk = await limit(env.KV_SESSIONS, `mcpip:${clientIp(request)}`, 120, 60);
    if (!ipOk) return text("rate_limited");
    try {
      return text(JSON.stringify(await fn(), null, 2));
    } catch (err) {
      return text(err instanceof Error ? err.message : "tool_failed");
    }
  };

  const add = (
    name: string,
    perm: Perm,
    def: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
    handler: (args: Record<string, unknown>) => Promise<unknown>,
    write = false,
  ) => {
    if (!can(user.role, perm)) return;
    server.registerTool(name, def, async (args) => gated(name, perm, () => handler(args as Record<string, unknown>), write));
  };

  server.registerTool("whoami", { description: "Current Scout Lane user and capabilities", inputSchema: {} }, async () =>
    text(
      JSON.stringify(
        {
          userId: user.userId,
          username: user.username,
          role: user.role,
          kind: user.kind,
          can: capabilities(user.role),
          limits: LIMITS,
          aiGateway: env.CF_AI_GATEWAY_ID || "scoutlane-ai-gateway",
        },
        null,
        2,
      ),
    ),
  );

  add("list_jobs", "jobs.read", { description: "List job descriptions", inputSchema: {} }, async () => {
    const rows = await env.DB_MAIN.prepare("SELECT id, title, created_at FROM jobs ORDER BY created_at DESC").all();
    return rows.results ?? [];
  });

  add(
    "get_job",
    "jobs.read",
    { description: "Get a job description by id", inputSchema: { id: z.string().uuid() } },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      const row = await env.DB_MAIN.prepare("SELECT id, title, description, created_at FROM jobs WHERE id = ?")
        .bind(id)
        .first();
      if (!row) throw new Error("not_found");
      return row;
    },
  );

  add("seed_job", "jobs.read", { description: "H+ Tech Lead seed job used as the search axis", inputSchema: {} }, async () => {
    return SEED_ROLE;
  });

  add(
    "create_job",
    "jobs.write",
    {
      description: "Create a job description",
      inputSchema: {
        title: z.string().trim().min(LIMITS.jobTitleMin).max(LIMITS.jobTitleMax),
        description: z.string().trim().min(LIMITS.jobDescMin).max(LIMITS.jobDescMax),
      },
    },
    async (args) => {
      const body = parseBody(jobSchema, args);
      const id = crypto.randomUUID();
      await env.DB_MAIN.prepare("INSERT INTO jobs (id, title, description) VALUES (?, ?, ?)")
        .bind(id, body.title, body.description)
        .run();
      return { id };
    },
    true,
  );

  add(
    "list_candidates",
    "candidates.read",
    {
      description: "List applicants. Filter by stage, source, or job.",
      inputSchema: {
        stage: z.enum(STAGES).optional(),
        source: z.string().trim().min(1).max(LIMITS.sourceMax).optional(),
        jobId: z.string().uuid().optional(),
      },
    },
    async (args) => {
      const stage = args.stage ? parseBody(z.enum(STAGES), args.stage) : undefined;
      const source = args.source ? String(args.source) : undefined;
      const jobId = args.jobId ? parseBody(uuidSchema, args.jobId) : undefined;
      let sql =
        "SELECT id, display_name, email, phone, source, stage, profile_url, headline, job_id, created_at FROM candidates WHERE 1=1";
      const binds: string[] = [];
      if (stage) {
        sql += " AND stage = ?";
        binds.push(stage);
      }
      if (source) {
        sql += " AND source = ?";
        binds.push(source);
      }
      if (jobId) {
        sql += " AND job_id = ?";
        binds.push(jobId);
      }
      sql += " ORDER BY created_at DESC LIMIT 200";
      const stmt = env.DB_MAIN.prepare(sql);
      const rows = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
      return { candidates: rows.results ?? [], stages: STAGES };
    },
  );

  add(
    "get_candidate",
    "candidates.read",
    { description: "Candidate card with scorecard, trail, and interviews", inputSchema: { id: z.string().uuid() } },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      const candidate = await env.DB_MAIN.prepare(
        `SELECT id, display_name, email, phone, source, stage, profile_url, headline, notes, job_id, created_at
         FROM candidates WHERE id = ?`,
      )
        .bind(id)
        .first();
      if (!candidate) throw new Error("not_found");
      const [trail, interviews, application] = await Promise.all([
        listTrail(env.DB_MAIN, id),
        env.DB_MAIN.prepare(
          "SELECT id, starts_at, minutes, calendar_event_id, meet_url FROM interviews WHERE candidate_id = ? ORDER BY starts_at",
        )
          .bind(id)
          .all(),
        env.DB_MAIN.prepare(
          `SELECT id, skills_score, experience_score, culture_score, skills_why, experience_why, culture_why,
                  strengths, flags, questions, summary, status
           FROM applications WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
          .bind(id)
          .first(),
      ]);
      return { candidate, trail, interviews: interviews.results ?? [], application: decodeApplication(application) };
    },
  );

  add(
    "add_candidate",
    "candidates.write",
    {
      description: "Add a candidate by hand (referral or pasted profile link)",
      inputSchema: {
        displayName: z.string().trim().min(LIMITS.candidateNameMin).max(LIMITS.candidateNameMax),
        email: z.string().email().max(LIMITS.emailMax).optional(),
        source: z.string().trim().min(LIMITS.sourceMin).max(LIMITS.sourceMax).optional(),
        profileUrl: z.string().url().max(LIMITS.profileUrlMax).optional(),
        jobId: z.string().uuid().optional(),
      },
    },
    async (args) => {
      const body = parseBody(candidateCreateSchema, { ...args, source: args.source ?? "mcp" });
      const id = crypto.randomUUID();
      await env.DB_MAIN.prepare(
        "INSERT INTO candidates (id, display_name, email, source, profile_url, stage, job_id) VALUES (?, ?, ?, ?, ?, 'applied', ?)",
      )
        .bind(id, body.displayName, body.email || null, body.source, body.profileUrl || null, body.jobId ?? null)
        .run();
      await logTrail(env.DB_MAIN, id, "entered", { stage: "applied", detail: body.source });
      return { id };
    },
    true,
  );

  add(
    "update_candidate",
    "candidates.write",
    {
      description: "Update name, email, phone, notes, or pipeline stage",
      inputSchema: {
        id: z.string().uuid(),
        displayName: z.string().trim().min(LIMITS.candidateNameMin).max(LIMITS.candidateNameMax).optional(),
        email: z.string().email().max(LIMITS.emailMax).optional(),
        phone: z.string().max(LIMITS.phoneMax).optional(),
        stage: z.enum(STAGES).optional(),
        notes: z.string().max(LIMITS.notesMax).optional(),
      },
    },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      const body = parseBody(candidatePatchSchema, {
        displayName: args.displayName,
        email: args.email,
        phone: args.phone,
        stage: args.stage,
        notes: args.notes,
      });
      const current = await env.DB_MAIN.prepare("SELECT id, stage FROM candidates WHERE id = ?")
        .bind(id)
        .first<{ id: string; stage: string }>();
      if (!current) throw new Error("not_found");
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
      if (!sets.length) throw new Error("empty_patch");
      binds.push(id);
      await env.DB_MAIN.prepare(`UPDATE candidates SET ${sets.join(", ")} WHERE id = ?`)
        .bind(...binds)
        .run();
      if (body.stage && body.stage !== current.stage) {
        await logTrail(env.DB_MAIN, id, "moved", { stage: body.stage, from: current.stage });
      }
      return { ok: true };
    },
    true,
  );

  add(
    "move_candidate",
    "candidates.write",
    {
      description: "Move a candidate to a pipeline stage",
      inputSchema: {
        id: z.string().uuid(),
        stage: z.enum(STAGES),
      },
    },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      const body = parseBody(candidatePatchSchema, { stage: args.stage });
      const current = await env.DB_MAIN.prepare("SELECT id, stage FROM candidates WHERE id = ?")
        .bind(id)
        .first<{ id: string; stage: string }>();
      if (!current) throw new Error("not_found");
      await env.DB_MAIN.prepare("UPDATE candidates SET stage = ? WHERE id = ?").bind(body.stage, id).run();
      if (body.stage && body.stage !== current.stage) {
        await logTrail(env.DB_MAIN, id, "moved", { stage: body.stage, from: current.stage });
      }
      return { ok: true };
    },
    true,
  );

  add(
    "delete_candidate",
    "candidates.delete",
    { description: "Remove a candidate and related interviews/scorecards", inputSchema: { id: z.string().uuid() } },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      await env.DB_MAIN.prepare("DELETE FROM interviews WHERE candidate_id = ?").bind(id).run();
      await env.DB_MAIN.prepare("DELETE FROM applications WHERE candidate_id = ?").bind(id).run();
      await env.DB_MAIN.prepare("DELETE FROM candidate_events WHERE candidate_id = ?").bind(id).run();
      await env.DB_MAIN.prepare("DELETE FROM candidates WHERE id = ?").bind(id).run();
      return { ok: true };
    },
    true,
  );

  add("pipeline_summary", "candidates.read", { description: "Count candidates in each stage", inputSchema: {} }, async () => {
    const rows = await env.DB_MAIN.prepare("SELECT stage, COUNT(*) as n FROM candidates GROUP BY stage").all();
    return rows.results ?? [];
  });

  add("list_interviews", "interviews.read", { description: "List booked interviews", inputSchema: {} }, async () => {
    const rows = await env.DB_MAIN.prepare(
      `SELECT i.id, i.candidate_id, i.starts_at, i.minutes, i.meet_url, c.display_name, c.stage
       FROM interviews i JOIN candidates c ON c.id = i.candidate_id ORDER BY i.starts_at`,
    ).all();
    return { interviews: rows.results ?? [], google: googleConfigured(lane) };
  });

  add(
    "list_week_slots",
    "interviews.read",
    {
      description: "Mon–Fri 08:00–17:00 Bangkok slots for a week, with booked vs free hours (same grid as the UI)",
      inputSchema: { weekStart: z.string().min(10).max(10).optional() },
    },
    async (args) => {
      const monday = args.weekStart ? String(args.weekStart).slice(0, 10) : mondayOfBangkok();
      const booked = ((
        await env.DB_MAIN.prepare("SELECT id, candidate_id, starts_at, minutes FROM interviews").all()
      ).results ?? []) as Array<{ id: string; candidate_id: string; starts_at: string; minutes: number | null }>;
      const days = [...Array(5)].map((_, i) => addDays(monday, i));
      const hours = [...Array(10)].map((_, i) => 8 + i);
      const free: Array<{ startsAt: string; minutes: number }> = [];
      const taken: Array<{ id: string; startsAt: string; minutes: number; candidateId: string }> = [];
      for (const day of days) {
        for (const hour of hours) {
          const start = Date.parse(bangkokIso(day, hour));
          const end = start + 60 * 60_000;
          const hit = booked.find((row) => {
            const bStart = Date.parse(row.starts_at);
            const bEnd = bStart + (row.minutes || 45) * 60_000;
            return !Number.isNaN(bStart) && slotsOverlap(start, end, bStart, bEnd);
          });
          if (hit) {
            taken.push({
              id: hit.id,
              startsAt: bangkokIso(day, hour),
              minutes: hit.minutes || 45,
              candidateId: hit.candidate_id,
            });
          } else {
            free.push({ startsAt: bangkokIso(day, hour), minutes: 60 });
          }
        }
      }
      return { weekStart: monday, timezone: "Asia/Bangkok", free, booked: taken };
    },
  );

  add(
    "book_interview",
    "interviews.write",
    {
      description: "Book an interview slot. Checks overlap like the UI. Creates Google Meet when connected.",
      inputSchema: {
        candidateId: z.string().uuid(),
        startsAt: z.string().min(10).max(40),
        minutes: z.number().int().min(LIMITS.interviewMinutesMin).max(LIMITS.interviewMinutesMax).optional(),
      },
    },
    async (args) => {
      const body = parseBody(interviewSchema, args);
      const start = Date.parse(body.startsAt);
      if (Number.isNaN(start)) throw new Error("invalid_time");
      const end = start + body.minutes * 60_000;
      const startIso = new Date(start).toISOString();
      const existing = ((
        await env.DB_MAIN.prepare("SELECT id, starts_at, minutes FROM interviews").all()
      ).results ?? []) as Array<{ starts_at: string; minutes: number | null }>;
      const clash = existing.some((row) => {
        const bStart = Date.parse(row.starts_at);
        return !Number.isNaN(bStart) && slotsOverlap(start, end, bStart, bStart + (row.minutes || 45) * 60_000);
      });
      if (clash) throw new Error("conflict");
      const person = await env.DB_MAIN.prepare("SELECT id, display_name FROM candidates WHERE id = ?")
        .bind(body.candidateId)
        .first<{ id: string; display_name: string }>();
      if (!person) throw new Error("not_found");
      const id = crypto.randomUUID();
      await env.DB_MAIN.prepare(
        "INSERT INTO interviews (id, candidate_id, starts_at, minutes, calendar_event_id) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(id, body.candidateId, startIso, body.minutes, null)
        .run();
      await env.DB_MAIN.prepare(
        "UPDATE candidates SET stage = 'interview' WHERE id = ? AND stage IN ('applied','screening','prescreen')",
      )
        .bind(body.candidateId)
        .run();
      await logTrail(env.DB_MAIN, body.candidateId, "booked", { stage: "interview", detail: startIso });

      let meetUrl: string | null = null;
      try {
        const created = await createMeet(lane, {
          summary: `สัมภาษณ์ · ${person.display_name}`,
          description: "",
          start: startIso,
          end: new Date(end).toISOString(),
        });
        meetUrl = created?.meetUrl ?? null;
        await env.DB_MAIN.prepare("UPDATE interviews SET calendar_event_id = ?, meet_url = ? WHERE id = ?")
          .bind(created?.eventId ?? "mcp", meetUrl, id)
          .run();
      } catch {
        await env.DB_MAIN.prepare("UPDATE interviews SET calendar_event_id = ? WHERE id = ?")
          .bind("mcp", id)
          .run();
      }
      return { id, startsAt: startIso, minutes: body.minutes, meetUrl, provider: googleConfigured(lane) ? "google" : "local" };
    },
    true,
  );

  add(
    "cancel_interview",
    "interviews.write",
    { description: "Cancel a booked interview", inputSchema: { id: z.string().uuid() } },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      const row = await env.DB_MAIN.prepare("SELECT id, candidate_id FROM interviews WHERE id = ?")
        .bind(id)
        .first<{ id: string; candidate_id: string }>();
      if (!row) throw new Error("not_found");
      await env.DB_MAIN.prepare("DELETE FROM interviews WHERE id = ?").bind(id).run();
      await env.DB_MAIN.prepare(
        "UPDATE candidates SET stage = 'prescreen' WHERE id = ? AND stage = 'interview'",
      )
        .bind(row.candidate_id)
        .run();
      await logTrail(env.DB_MAIN, row.candidate_id, "cancelled", { stage: "prescreen" });
      return { ok: true };
    },
    true,
  );

  add("list_users", "users.read", { description: "List Scout Lane users (admin)", inputSchema: {} }, async () => {
    return listUsers(env.DB_MAIN);
  });

  add(
    "create_user",
    "users.write",
    {
      description: "Create a user (admin)",
      inputSchema: {
        username: z.string().trim().min(LIMITS.usernameMin).max(LIMITS.usernameMax),
        password: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax),
        role: z.enum(["admin", "member"]).optional(),
      },
    },
    async (args) => {
      const body = parseBody(createUserSchema, args);
      try {
        const created = await createUser(env.DB_MAIN, body.username, body.password, body.role);
        return { id: created.id, username: created.username, role: created.role };
      } catch {
        throw new Error("username_taken");
      }
    },
    true,
  );

  add(
    "update_user",
    "users.write",
    {
      description: "Change role, disable, or reset password (admin)",
      inputSchema: {
        id: z.string().uuid(),
        role: z.enum(["admin", "member"]).optional(),
        disabled: z.boolean().optional(),
        password: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax).optional(),
      },
    },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      const body = parseBody(patchUserSchema, {
        role: args.role,
        disabled: args.disabled,
        password: args.password,
      });
      return updateUser(env.DB_MAIN, id, body);
    },
    true,
  );

  add(
    "delete_user",
    "users.write",
    {
      description: "Delete a user (admin). Cannot delete yourself or the last admin.",
      inputSchema: { id: z.string().uuid() },
    },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      await deleteUser(env.DB_MAIN, id, user.userId);
      return { ok: true };
    },
    true,
  );

  add(
    "change_password",
    "tokens.write",
    {
      description: "Change the signed-in user's password",
      inputSchema: { password: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax) },
    },
    async (args) => {
      await updateUser(env.DB_MAIN, user.userId, { password: String(args.password) });
      return { ok: true };
    },
    true,
  );

  add("list_scout_sources", "scout.run", { description: "Legal scout sources split into live, HR-click, and blocked", inputSchema: {} }, async () => {
    const { ready, modes } = await readyAdapters(env, mcpAdapterList());
    return {
      ...buildSourceLanes({ adapters: ready, links: officialSearchUrls("Tech Lead AI Workflow"), modes }),
      sources: ready.map((a) => ({ id: a.id, status: a.status, label: sourceLabel(a.id) })),
    };
  });

  add(
    "scout_search",
    "scout.run",
    {
      description: "Search public profiles from a job description, rank them, and keep a shortlist like the UI",
      inputSchema: {
        jd: z.string().trim().min(LIMITS.jdMin).max(LIMITS.jdMax),
        title: z.string().trim().min(LIMITS.jobTitleMin).max(LIMITS.jobTitleMax).optional(),
        jobId: z.string().uuid().optional(),
        origin: z.enum(["any", "thai", "foreign"]).optional(),
      },
    },
    async (args) => {
      const jd = String(args.jd);
      let jobId = args.jobId ? parseBody(uuidSchema, args.jobId) : crypto.randomUUID();
      if (!args.jobId) {
        await env.DB_MAIN.prepare("INSERT INTO jobs (id, title, description) VALUES (?, ?, ?)")
          .bind(jobId, String(args.title || "Open role"), jd)
          .run();
      }
      const queryPrompt = await getPrompt(lane, "prompt.scout_query");
      const planned = await glmJson<{ query: string }>(env, [
        { role: "system", content: queryPrompt },
        { role: "user", content: jd },
      ]);
      const query = planned.query || "TypeScript MCP location:Bangkok";
      const { ready, modes } = await readyAdapters(env, mcpAdapterList());
      const live = ready.filter((a) => a.status === "live" && CANDIDATE_SOURCES.has(a.id));
      const batches = await Promise.all(live.map((a) => a.search(query, lane).catch(() => [])));
      const hits = batches
        .flat()
        .filter((hit) => hitThai(hit))
        .slice(0, 140);
      const local = scoreLocally(hits, jd);
      const forModel = peopleForModel(hits);
      const rankPrompt = await getPrompt(lane, "prompt.scout_rank");
      let ranked: { items: Array<{ externalId: string; fitScore: number; reason: string }> } = { items: [] };
      if (forModel.length) {
        try {
          ranked = await glmJson<{ items: Array<{ externalId: string; fitScore: number; reason: string }> }>(env, [
            { role: "system", content: rankPrompt },
            { role: "user", content: JSON.stringify({ jd: jd.slice(0, 4000), candidates: forModel }) },
          ]);
        } catch {
          ranked = { items: [] };
        }
      }
      const origin = "thai";
      const scored = hireableShortlist(overlayModelScores(local, ranked.items), undefined, jd, origin);
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
      return {
        jobId,
        query,
        shortlist,
        links: officialSearchUrls(query),
        ...buildSourceLanes({ adapters: ready, links: officialSearchUrls(query), modes }),
        sources: ready.map((a) => ({ id: a.id, status: a.status, label: sourceLabel(a.id) })),
      };
    },
    true,
  );

  add(
    "approve_scout",
    "scout.run",
    {
      description: "Move shortlist hits onto the pipeline (same as the UI approve button)",
      inputSchema: { ids: z.array(z.string().uuid()).min(1).max(LIMITS.approveIdsMax) },
    },
    async (args) => {
      const body = parseBody(approveSchema, args);
      const moved: string[] = [];
      for (const id of body.ids) {
        const row = await env.DB_MAIN.prepare("SELECT * FROM shortlist WHERE id = ? AND approved = 0")
          .bind(id)
          .first<{
            job_id: string;
            source: string;
            display_name: string;
            headline: string | null;
            profile_url: string | null;
          }>();
        if (!row) continue;
        const candidateId = crypto.randomUUID();
        await env.DB_MAIN.batch([
          env.DB_MAIN.prepare(
            `INSERT INTO candidates (id, display_name, source, profile_url, headline, stage, job_id)
             VALUES (?, ?, ?, ?, ?, 'applied', ?)`,
          ).bind(candidateId, row.display_name, row.source, row.profile_url, row.headline, row.job_id),
          env.DB_MAIN.prepare("UPDATE shortlist SET approved = 1 WHERE id = ?").bind(id),
        ]);
        await logTrail(env.DB_MAIN, candidateId, "entered", { stage: "applied", detail: row.source });
        moved.push(candidateId);
      }
      return { candidateIds: moved };
    },
    true,
  );

  add(
    "screen_resume",
    "screen.run",
    {
      description: "Score resume text against a job id. Same scorecard as the UI (skills/experience/culture + reasons).",
      inputSchema: {
        jobId: z.string().uuid(),
        name: z.string().trim().min(LIMITS.candidateNameMin).max(LIMITS.candidateNameMax),
        text: z.string().min(20).max(LIMITS.resumeTextMax),
        email: z.string().email().max(LIMITS.emailMax).optional(),
      },
    },
    async (args) => {
      const jobId = parseBody(uuidSchema, args.jobId);
      const job = await env.DB_MAIN.prepare("SELECT id, title, description FROM jobs WHERE id = ?")
        .bind(jobId)
        .first<{ title: string; description: string }>();
      if (!job) throw new Error("job_missing");
      const system = await getPrompt(lane, "prompt.screen");
      const scored = await glmJson<{
        skills: number;
        experience: number;
        culture: number;
        skillsWhy?: string;
        experienceWhy?: string;
        cultureWhy?: string;
        strengths?: string[];
        flags?: string[];
        questions?: string[];
        summary?: string;
      }>(env, [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            jobTitle: job.title,
            jobDescription: job.description,
            resume: args.text,
            name: args.name,
          }),
        },
      ]);
      const candidateId = crypto.randomUUID();
      const applicationId = crypto.randomUUID();
      await env.DB_MAIN.batch([
        env.DB_MAIN.prepare(
          `INSERT INTO candidates (id, display_name, email, source, stage, job_id) VALUES (?, ?, ?, 'mcp', 'screening', ?)`,
        ).bind(candidateId, String(args.name), args.email ? String(args.email) : null, jobId),
        env.DB_MAIN.prepare(
          `INSERT INTO applications (id, candidate_id, job_id, skills_score, experience_score, culture_score, skills_why, experience_why, culture_why, strengths, flags, questions, summary, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
        ).bind(
          applicationId,
          candidateId,
          jobId,
          scored.skills,
          scored.experience,
          scored.culture,
          scored.skillsWhy ?? "",
          scored.experienceWhy ?? "",
          scored.cultureWhy ?? "",
          JSON.stringify(scored.strengths ?? []),
          JSON.stringify(scored.flags ?? []),
          JSON.stringify(scored.questions ?? []),
          scored.summary ?? "",
        ),
      ]);
      await logTrail(env.DB_MAIN, candidateId, "screened", {
        stage: "screening",
        from: "applied",
        detail: [scored.skills, scored.experience, scored.culture].join("/"),
      });
      return { applicationId, candidateId, status: "ready", ...scored };
    },
    true,
  );

  add(
    "get_application",
    "screen.run",
    { description: "Read a scorecard / interview pack row", inputSchema: { id: z.string().uuid() } },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      const row = await env.DB_MAIN.prepare(
        `SELECT a.*, c.display_name, c.email, j.title AS job_title
         FROM applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN jobs j ON j.id = a.job_id
         WHERE a.id = ?`,
      )
        .bind(id)
        .first();
      if (!row) throw new Error("not_found");
      return decodeApplication(row as Record<string, unknown>);
    },
  );

  add("list_applications", "screen.run", { description: "List recent scorecards", inputSchema: {} }, async () => {
    const rows = await env.DB_MAIN.prepare(
      `SELECT a.id, a.candidate_id, a.status, a.skills_score, a.experience_score, a.culture_score, c.display_name, j.title
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN jobs j ON j.id = a.job_id
       ORDER BY a.created_at DESC LIMIT 50`,
    ).all();
    return rows.results ?? [];
  });

  add(
    "interview_pack",
    "screen.run",
    { description: "Generate an interview briefing from a scorecard", inputSchema: { id: z.string().uuid() } },
    async (args) => {
      const id = parseBody(uuidSchema, args.id);
      const row = await env.DB_MAIN.prepare(
        `SELECT a.summary, a.questions, a.flags, a.strengths, c.display_name, j.title, j.description
         FROM applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN jobs j ON j.id = a.job_id
         WHERE a.id = ?`,
      )
        .bind(id)
        .first();
      if (!row) throw new Error("not_found");
      const system = await getPrompt(lane, "prompt.interview_pack");
      return glmJson(env, [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(row) },
      ]);
    },
    true,
  );

  add("list_prompts", "settings.read", { description: "List AI prompt settings (admin)", inputSchema: {} }, async () => {
    const rows = await env.DB_MAIN.prepare("SELECT key, value FROM settings").all();
    return rows.results ?? [];
  });

  add(
    "save_prompt",
    "settings.write",
    {
      description: "Save an AI prompt setting (admin)",
      inputSchema: {
        key: z.enum(["prompt.scout_query", "prompt.scout_rank", "prompt.screen", "prompt.interview_pack"]),
        value: z.string().min(LIMITS.promptMin).max(LIMITS.promptMax),
      },
    },
    async (args) => {
      const body = parseBody(promptSaveSchema, args);
      await env.DB_MAIN.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
        .bind(body.key, body.value)
        .run();
      return { ok: true };
    },
    true,
  );

  return server;
}

function decodeApplication(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    ...row,
    strengths: parseArr(row.strengths),
    flags: parseArr(row.flags),
    questions: parseArr(row.questions),
  };
}

function parseArr(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mondayOfBangkok(now = new Date()): string {
  const th = new Date(now.getTime() + 7 * 3600_000);
  const day = th.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  th.setUTCDate(th.getUTCDate() + diff);
  return th.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

function bangkokIso(date: string, hour: number): string {
  return `${date}T${String(hour).padStart(2, "0")}:00:00+07:00`;
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}
