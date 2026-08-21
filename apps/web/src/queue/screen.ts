import { pdfToText } from "../pdf";
import { glmJson } from "../llm/glm";
import { getPrompt } from "../llm/settings";
import { logError, logInfo } from "../security/log";
import { indexCandidate } from "../embed";
import { logTrail } from "../trail";
import { publishLane } from "../do/lane-hub";
import { extractResumeContact, mergeResumeContact, preferStoredContact } from "../resume-contact";

export type ScreenJob = {
  applicationId: string;
  candidateId: string;
  jobId: string;
  resumeKey: string;
};

async function noteScreen(
  env: Env,
  job: Pick<ScreenJob, "applicationId" | "candidateId">,
  step: string,
  message: string,
  error?: string,
): Promise<void> {
  const retry = Boolean(error && (error === "llm_rate_limited" || error.startsWith("llm_upstream")));
  await env.DB_MAIN.prepare("UPDATE applications SET last_step = ?, last_error = ? WHERE id = ?")
    .bind(step, error ?? null, job.applicationId)
    .run();
  await publishLane(env, {
    type: error && !retry ? "screen.failed" : "screen.progress",
    applicationId: job.applicationId,
    candidateId: job.candidateId,
    source: step,
    state: retry ? "wait" : error ? "fail" : "run",
    message: error ? `${message} (${error})` : message,
  });
}

export async function handleScreenJob(env: Env, job: ScreenJob): Promise<void> {
  await noteScreen(env, job, "read_pdf", "กำลังอ่านข้อความจาก PDF");
  const object = await env.R2_RESUMES.get(job.resumeKey);
  if (!object) throw new Error("resume_missing");
  const text = await pdfToText(await object.arrayBuffer());

  await noteScreen(env, job, "load_job", "อ่านตำแหน่งและ job description แล้ว");
  const jd = await env.DB_MAIN.prepare("SELECT title, description FROM jobs WHERE id = ?")
    .bind(job.jobId)
    .first<{ title: string; description: string }>();
  if (!jd) throw new Error("job_missing");

  await noteScreen(env, job, "score", "กำลังให้โมเดลให้คะแนน");
  const system = await getPrompt(env, "prompt.screen");
  type ScreenScore = {
    skills: number;
    experience: number;
    culture: number;
    skillsWhy: string;
    experienceWhy: string;
    cultureWhy: string;
    strengths: string[];
    flags: string[];
    questions: string[];
    summary: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  const scored = await glmJson<ScreenScore>(env, [
    { role: "system", content: system },
    {
      role: "user",
      content: JSON.stringify({
        jobTitle: jd.title,
        jobDescription: jd.description,
        resume: text,
      }),
    },
  ]);

  await noteScreen(env, job, "save_score", "กำลังบันทึกคะแนน");
  await env.DB_MAIN.prepare(
    `UPDATE applications SET
      skills_score = ?, experience_score = ?, culture_score = ?,
      skills_why = ?, experience_why = ?, culture_why = ?,
      strengths = ?, flags = ?, questions = ?, summary = ?, status = 'ready',
      last_step = 'ready', last_error = NULL
     WHERE id = ?`,
  )
    .bind(
      clamp(scored.skills),
      clamp(scored.experience),
      clamp(scored.culture),
      scored.skillsWhy ?? "",
      scored.experienceWhy ?? "",
      scored.cultureWhy ?? "",
      JSON.stringify(scored.strengths ?? []),
      JSON.stringify(scored.flags ?? []),
      JSON.stringify(scored.questions ?? []),
      scored.summary ?? "",
      job.applicationId,
    )
    .run();

  const existing = await env.DB_MAIN.prepare(
    "SELECT display_name, email, phone FROM candidates WHERE id = ?",
  )
    .bind(job.candidateId)
    .first<{ display_name: string | null; email: string | null; phone: string | null }>();
  const contact = preferStoredContact(
    { displayName: existing?.display_name, email: existing?.email, phone: existing?.phone },
    mergeResumeContact(extractResumeContact(text), scored),
  );
  await env.DB_MAIN.prepare(
    "UPDATE candidates SET display_name = ?, email = ?, phone = ?, stage = 'screening' WHERE id = ?",
  )
    .bind(contact.name, contact.email || null, contact.phone || null, job.candidateId)
    .run();
  await logTrail(env.DB_MAIN, job.candidateId, "screened", {
    stage: "screening",
    from: "applied",
    detail: [clamp(scored.skills), clamp(scored.experience), clamp(scored.culture)].join("/"),
  });

  await indexCandidate(env, job.candidateId, `${jd.title}\n${text}`, {
    source: "resume",
    jobId: job.jobId,
  });

  await noteScreen(env, job, "ready", "คัดกรองเสร็จแล้ว");
  logInfo("screen_ready", { applicationId: job.applicationId });
  await publishLane(env, {
    type: "screen.ready",
    applicationId: job.applicationId,
    candidateId: job.candidateId,
    state: "ok",
    message: "คัดกรองเสร็จแล้ว",
  });
}

export async function consumeScreenBatch(
  batch: MessageBatch<ScreenJob>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await handleScreenJob(env, msg.body);
      msg.ack();
    } catch (err) {
      const error = err instanceof Error ? err.message : "unknown";
      logError("screen_job_failed", { error });
      const retry = error === "llm_rate_limited" || error.startsWith("llm_upstream");
      await noteScreen(
        env,
        msg.body,
        retry ? "score" : "fail",
        retry ? "โมเดลถี่ไป · คิวจะลองใหม่" : "คัดกรองไม่สำเร็จ",
        error,
      ).catch(() => {});
      msg.retry();
    }
  }
}

function clamp(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(10, n));
}
