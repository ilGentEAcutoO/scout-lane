import { Hono } from "hono";
import { LIMITS, parseBody, screenFieldsSchema } from "@scout-lane/core";
import { requireActor, requirePerm } from "../security/actor";
import { HttpError } from "../http/errors";
import { pdfToText } from "../pdf";
import { glmJson } from "../llm/glm";
import { getPrompt } from "../llm/settings";
import { track } from "../metrics";
import { logTrail } from "../trail";
import { publishLane } from "../do/lane-hub";

export const screen = new Hono<{ Bindings: Env }>();

screen.post("/api/screen", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "screen.run");
  if (!c.env.GLM_API_KEY && !c.env.AI) throw new HttpError(503, "llm_not_configured");

  const length = Number(c.req.header("content-length") ?? "0");
  if (length > LIMITS.uploadBytesMax) throw new HttpError(413, "payload_too_large");

  const form = await c.req.raw.formData();
  const fields = parseBody(screenFieldsSchema, {
    jobId: String(form.get("jobId") ?? ""),
    name: String(form.get("name") ?? "").trim(),
    email: String(form.get("email") ?? "").trim(),
    text: String(form.get("text") ?? "").trim(),
  });
  const jobId = fields.jobId;
  const name = fields.name;
  const email = fields.email ?? "";
  const pasted = fields.text ?? "";
  const file = form.get("file");
  const job = await c.env.DB_MAIN.prepare("SELECT id, title, description FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ id: string; title: string; description: string }>();
  if (!job) throw new HttpError(404, "job_missing");

  const candidateId = crypto.randomUUID();
  const applicationId = crypto.randomUUID();
  let resumeKey: string | null = null;
  let inlineText = pasted.slice(0, LIMITS.resumeTextMax);

  if (file instanceof File && file.size > 0) {
    if (file.size > LIMITS.uploadBytesMax) throw new HttpError(413, "payload_too_large");
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      throw new HttpError(415, "pdf_only");
    }
    resumeKey = `resumes/${candidateId}.pdf`;
    await c.env.R2_RESUMES.put(resumeKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: "application/pdf" },
    });
  }

  if (!inlineText && !resumeKey) throw new HttpError(400, "resume_required");

  await c.env.DB_MAIN.batch([
    c.env.DB_MAIN.prepare(
      `INSERT INTO candidates (id, display_name, email, source, stage, resume_key, job_id)
       VALUES (?, ?, ?, 'upload', 'applied', ?, ?)`,
    ).bind(candidateId, name || "Untitled candidate", email || null, resumeKey, jobId),
    c.env.DB_MAIN.prepare(
      `INSERT INTO applications (id, candidate_id, job_id, status) VALUES (?, ?, ?, 'queued')`,
    ).bind(applicationId, candidateId, jobId),
  ]);
  await logTrail(c.env.DB_MAIN, candidateId, "entered", { stage: "applied", detail: "upload" });

  if (resumeKey && !inlineText) {
    await c.env.SCREEN_QUEUE.send({
      applicationId,
      candidateId,
      jobId,
      resumeKey,
    });
    track(c.env, "screen_queued");
    c.executionCtx.waitUntil(publishLane(c.env, { type: "board.changed", candidateId }));
    return c.json({ applicationId, status: "queued" }, 202);
  }

  if (!inlineText && resumeKey) {
    const obj = await c.env.R2_RESUMES.get(resumeKey);
    if (obj) inlineText = await pdfToText(await obj.arrayBuffer());
  }

  const system = await getPrompt(c.env, "prompt.screen");
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
  }>(c.env, [
    { role: "system", content: system },
    {
      role: "user",
      content: JSON.stringify({
        jobTitle: job.title,
        jobDescription: job.description,
        resume: inlineText,
      }),
    },
  ]);

  await c.env.DB_MAIN.prepare(
    `UPDATE applications SET
      skills_score = ?, experience_score = ?, culture_score = ?,
      skills_why = ?, experience_why = ?, culture_why = ?,
      strengths = ?, flags = ?, questions = ?, summary = ?, status = 'ready'
     WHERE id = ?`,
  )
    .bind(
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
      applicationId,
    )
    .run();

  await c.env.DB_MAIN.prepare("UPDATE candidates SET stage = 'screening' WHERE id = ?")
    .bind(candidateId)
    .run();
  await logTrail(c.env.DB_MAIN, candidateId, "screened", {
    stage: "screening",
    from: "applied",
    detail: [scored.skills, scored.experience, scored.culture].join("/"),
  });

  track(c.env, "screen_inline");
  c.executionCtx.waitUntil(
    publishLane(c.env, { type: "screen.ready", applicationId, candidateId }),
  );
  return c.json({ applicationId, status: "ready" });
});

screen.get("/api/screen/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "screen.run");
  const row = await c.env.DB_MAIN.prepare(
    `SELECT a.*, c.display_name, c.email, j.title AS job_title
     FROM applications a
     JOIN candidates c ON c.id = a.candidate_id
     JOIN jobs j ON j.id = a.job_id
     WHERE a.id = ?`,
  )
    .bind(c.req.param("id"))
    .first();
  if (!row) throw new HttpError(404, "not_found");
  return c.json({ application: decodeApplication(row) });
});

screen.post("/api/screen/:id/pack", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "screen.run");
  const row = await c.env.DB_MAIN.prepare(
    `SELECT a.summary, a.questions, a.flags, a.strengths, c.display_name, j.title, j.description
     FROM applications a
     JOIN candidates c ON c.id = a.candidate_id
     JOIN jobs j ON j.id = a.job_id
     WHERE a.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<{
      summary: string | null;
      questions: string | null;
      flags: string | null;
      strengths: string | null;
      display_name: string;
      title: string;
      description: string;
    }>();
  if (!row) throw new HttpError(404, "not_found");
  const system = await getPrompt(c.env, "prompt.interview_pack");
  const pack = await glmJson(c.env, [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(row) },
  ]);
  return c.json({ pack });
});

function decodeApplication(row: Record<string, unknown>) {
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
