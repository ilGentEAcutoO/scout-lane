import { pdfToText } from "../pdf";
import { glmJson } from "../llm/glm";
import { getPrompt } from "../llm/settings";
import { logError, logInfo } from "../security/log";
import { indexCandidate } from "../embed";
import { logTrail } from "../trail";
import { publishLane } from "../do/lane-hub";

export type ScreenJob = {
  applicationId: string;
  candidateId: string;
  jobId: string;
  resumeKey: string;
};

export async function handleScreenJob(env: Env, job: ScreenJob): Promise<void> {
  const object = await env.R2_RESUMES.get(job.resumeKey);
  if (!object) throw new Error("resume_missing");
  const text = await pdfToText(await object.arrayBuffer());

  const jd = await env.DB_MAIN.prepare("SELECT title, description FROM jobs WHERE id = ?")
    .bind(job.jobId)
    .first<{ title: string; description: string }>();
  if (!jd) throw new Error("job_missing");

  const system = await getPrompt(env, "prompt.screen");
  const scored = await glmJson<{
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
  }>(env, [
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

  await env.DB_MAIN.prepare(
    `UPDATE applications SET
      skills_score = ?, experience_score = ?, culture_score = ?,
      skills_why = ?, experience_why = ?, culture_why = ?,
      strengths = ?, flags = ?, questions = ?, summary = ?, status = 'ready'
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

  await env.DB_MAIN.prepare("UPDATE candidates SET stage = 'screening' WHERE id = ? AND stage = 'applied'")
    .bind(job.candidateId)
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

  logInfo("screen_ready", { applicationId: job.applicationId });
  await publishLane(env, {
    type: "screen.ready",
    applicationId: job.applicationId,
    candidateId: job.candidateId,
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
      logError("screen_job_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
      await publishLane(env, {
        type: "screen.failed",
        applicationId: msg.body.applicationId,
        candidateId: msg.body.candidateId,
      });
      msg.retry();
    }
  }
}

function clamp(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(10, n));
}
