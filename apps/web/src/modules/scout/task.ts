export const SCOUT_STEPS = [
  { id: "query", label: "ตั้งคำค้นจาก job description", next: "ดึงโปรไฟล์จากแหล่งที่เปิด" },
  { id: "fetch", label: "ดึงโปรไฟล์จากแหล่งที่เปิด", next: "ตัดซ้ำและกรองคนที่จ้างได้" },
  { id: "filter", label: "ตัดซ้ำและกรองคนที่จ้างได้", next: "ให้ AI ให้คะแนนความเข้ากัน" },
  { id: "rank", label: "ให้ AI ให้คะแนนความเข้ากัน", next: "จัดอันดับผลค้นหา" },
  { id: "save", label: "จัดอันดับผลค้นหา", next: "" },
] as const;

export type ScoutJobStatus = "queued" | "running" | "done" | "cancelled" | "failed";

export type ScoutLogRow = {
  source?: string;
  state: string;
  count?: number;
  message: string;
  next?: string;
  via?: "queue" | "llm" | "apify" | "public";
};

export type ScoutQueueJob = {
  runId: string;
  jobId: string;
  title: string;
  jd: string;
  jdHash: string;
  modes?: Record<string, string>;
};

export class ScoutCancelled extends Error {
  constructor() {
    super("scout_cancelled");
    this.name = "ScoutCancelled";
  }
}

export async function hashScoutKey(title: string, jd: string, modes?: unknown): Promise<string> {
  const raw = `${title.trim()}\n${jd.trim()}\n${JSON.stringify(modes || {})}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function stepNext(id: (typeof SCOUT_STEPS)[number]["id"]): string {
  return SCOUT_STEPS.find((row) => row.id === id)?.next || "";
}

export async function loadScoutJob(
  db: D1Database,
  runId: string,
): Promise<{ id: string; job_id: string; jd_hash: string; status: ScoutJobStatus } | null> {
  return (await db
    .prepare("SELECT id, job_id, jd_hash, status FROM scout_jobs WHERE id = ?")
    .bind(runId)
    .first<{ id: string; job_id: string; jd_hash: string; status: ScoutJobStatus }>()) ?? null;
}

export async function latestScoutJob(db: D1Database, jobId: string) {
  return db
    .prepare(
      `SELECT id, job_id, jd_hash, status, step, query, log, hit_count, error, updated_at
       FROM scout_jobs WHERE job_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(jobId)
    .first<{
      id: string;
      job_id: string;
      jd_hash: string;
      status: ScoutJobStatus;
      step: string | null;
      query: string | null;
      log: string;
      hit_count: number;
      error: string | null;
      updated_at: string;
    }>();
}

export async function cancelOtherScoutJobs(db: D1Database, jobId: string, keepId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE scout_jobs SET status = 'cancelled', updated_at = datetime('now')
       WHERE job_id = ? AND id != ? AND status IN ('queued', 'running')`,
    )
    .bind(jobId, keepId)
    .run();
}

export async function patchScoutJob(
  db: D1Database,
  runId: string,
  patch: {
    status?: ScoutJobStatus;
    step?: string;
    query?: string;
    log?: ScoutLogRow[];
    hitCount?: number;
    error?: string | null;
  },
): Promise<void> {
  const row = await db
    .prepare("SELECT status, step, query, log, hit_count, error FROM scout_jobs WHERE id = ?")
    .bind(runId)
    .first<{
      status: string;
      step: string | null;
      query: string | null;
      log: string;
      hit_count: number;
      error: string | null;
    }>();
  if (!row) return;
  await db
    .prepare(
      `UPDATE scout_jobs
       SET status = ?, step = ?, query = ?, log = ?, hit_count = ?, error = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(
      patch.status ?? row.status,
      patch.step ?? row.step,
      patch.query ?? row.query,
      JSON.stringify(patch.log ?? JSON.parse(row.log || "[]")),
      patch.hitCount ?? row.hit_count,
      patch.error === undefined ? row.error : patch.error,
      runId,
    )
    .run();
}
