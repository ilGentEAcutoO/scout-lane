CREATE TABLE IF NOT EXISTS scout_jobs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  jd_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  step TEXT,
  query TEXT,
  log TEXT NOT NULL DEFAULT '[]',
  hit_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scout_jobs_job ON scout_jobs (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scout_jobs_status ON scout_jobs (status, updated_at DESC);
