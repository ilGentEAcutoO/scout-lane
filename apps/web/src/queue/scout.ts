import { executeScoutSearch } from "../modules/scout";
import { ScoutCancelled, patchScoutJob, type ScoutQueueJob } from "../modules/scout/task";
import { logError, logInfo } from "../security/log";
import { publishLane } from "../do/lane-hub";

export async function consumeScoutBatch(batch: MessageBatch<ScoutQueueJob>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    const job = msg.body;
    try {
      await executeScoutSearch(env, job);
      msg.ack();
      logInfo("scout_job_done", { runId: job.runId, jobId: job.jobId });
    } catch (err) {
      if (err instanceof ScoutCancelled) {
        msg.ack();
        continue;
      }
      const error = err instanceof Error ? err.message : "unknown";
      logError("scout_job_failed", { error, runId: job.runId });
      await patchScoutJob(env.DB_MAIN, job.runId, { status: "failed", error }).catch(() => {});
      await publishLane(env, {
        type: "scout.failed",
        runId: job.runId,
        jobId: job.jobId,
        candidateId: job.jobId,
        state: "fail",
        message: "ค้นไม่สำเร็จ — คิวจะลองใหม่",
      }).catch(() => {});
      msg.retry();
    }
  }
}
