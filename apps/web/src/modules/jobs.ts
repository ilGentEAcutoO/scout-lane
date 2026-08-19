import { Hono } from "hono";
import { jobSchema, parseBody } from "@scout-lane/core";
import { requireActor, requirePerm } from "../security/actor";
import { readJson } from "../security/body";
import { HttpError } from "../http/errors";

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

jobs.get("/api/jobs", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.read");
  const rows = await c.env.DB_MAIN.prepare(
    "SELECT id, title, created_at FROM jobs ORDER BY created_at DESC",
  ).all();
  return c.json({ jobs: rows.results ?? [] });
});

jobs.get("/api/jobs/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.read");
  const row = await c.env.DB_MAIN.prepare(
    "SELECT id, title, description, created_at FROM jobs WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first();
  if (!row) throw new HttpError(404, "not_found");
  return c.json({ job: row });
});

jobs.post("/api/jobs", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "jobs.write");
  const body = parseBody(jobSchema, await readJson(c.req.raw));
  const id = crypto.randomUUID();
  await c.env.DB_MAIN.prepare("INSERT INTO jobs (id, title, description) VALUES (?, ?, ?)")
    .bind(id, body.title, body.description)
    .run();
  return c.json({ id }, 201);
});
