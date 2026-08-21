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
import { extractResumeContact, gapsOf, mergeResumeContact, preferStoredContact } from "../resume-contact";

export const screen = new Hono<{ Bindings: Env }>();

screen.post("/api/screen", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "screen.run");
  const { secretFor, loadProvider } = await import("../llm/providers");
  const active = await loadProvider(c.env);
  const { key } = await secretFor(c.env, active);
  if (!key) throw new HttpError(503, "llm_not_configured");

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
    const bytes = await file.arrayBuffer();
    await c.env.R2_RESUMES.put(resumeKey, bytes, {
      httpMetadata: { contentType: "application/pdf" },
    });
    if (!inlineText) {
      try {
        inlineText = await pdfToText(bytes);
      } catch {
        inlineText = "";
      }
    }
  }

  if (!inlineText && !resumeKey) throw new HttpError(400, "resume_required");

  const seeded = mergeResumeContact(extractResumeContact(inlineText), {
    name: fields.name,
    email: fields.email,
  });
  await c.env.DB_MAIN.batch([
    c.env.DB_MAIN.prepare(
      `INSERT INTO candidates (id, display_name, email, phone, source, stage, resume_key, job_id)
       VALUES (?, ?, ?, ?, 'upload', 'applied', ?, ?)`,
    ).bind(
      candidateId,
      seeded.name,
      seeded.email || null,
      seeded.phone || null,
      resumeKey,
      jobId,
    ),
    c.env.DB_MAIN.prepare(
      `INSERT INTO applications (id, candidate_id, job_id, status, last_step) VALUES (?, ?, ?, 'queued', 'queued')`,
    ).bind(applicationId, candidateId, jobId),
  ]);
  await logTrail(c.env.DB_MAIN, candidateId, "entered", { stage: "applied", detail: "upload" });

  if (resumeKey) {
    await c.env.SCREEN_QUEUE.send({
      applicationId,
      candidateId,
      jobId,
      resumeKey,
    });
    track(c.env, "screen_queued");
    c.executionCtx.waitUntil(publishLane(c.env, { type: "board.changed", candidateId }));
    return c.json({
      applicationId,
      candidateId,
      status: "queued",
      candidate: {
        displayName: seeded.name,
        email: seeded.email,
        phone: seeded.phone,
        missing: seeded.missing,
      },
    }, 202);
  }

  const system = await getPrompt(c.env, "prompt.screen");
  type ScreenScore = {
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
    name?: string;
    email?: string;
    phone?: string;
  };
  const scored = await glmJson<ScreenScore>(c.env, [
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

  const existing = await c.env.DB_MAIN.prepare(
    "SELECT display_name, email, phone FROM candidates WHERE id = ?",
  )
    .bind(candidateId)
    .first<{ display_name: string | null; email: string | null; phone: string | null }>();
  const contact = preferStoredContact(
    { displayName: existing?.display_name, email: existing?.email, phone: existing?.phone },
    mergeResumeContact(extractResumeContact(inlineText), scored),
  );
  await c.env.DB_MAIN.prepare(
    "UPDATE candidates SET display_name = ?, email = ?, phone = ?, stage = 'screening' WHERE id = ?",
  )
    .bind(contact.name, contact.email || null, contact.phone || null, candidateId)
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
  return c.json({
    applicationId,
    candidateId,
    status: "ready",
    candidate: {
      displayName: contact.name,
      email: contact.email,
      phone: contact.phone,
      missing: contact.missing,
    },
  });
});

screen.get("/api/screen/:id", async (c) => {
  const actor = await requireActor(c.req.raw, c.env);
  requirePerm(actor, "screen.run");
  const row = await c.env.DB_MAIN.prepare(
    `SELECT a.*, c.id AS candidate_id, c.display_name, c.email, c.phone, j.title AS job_title
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
  ], { disableThinking: true });
  return c.json({ pack });
});

function decodeApplication(row: Record<string, unknown>) {
  return {
    ...row,
    strengths: parseArr(row.strengths),
    flags: parseArr(row.flags),
    questions: parseArr(row.questions),
    missing: gapsOf(
      typeof row.display_name === "string" ? row.display_name : "",
      typeof row.email === "string" ? row.email : "",
    ),
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
