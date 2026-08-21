ALTER TABLE jobs ADD COLUMN notes TEXT;
ALTER TABLE jobs ADD COLUMN query TEXT;
ALTER TABLE jobs ADD COLUMN last_run_at TEXT;
ALTER TABLE jobs ADD COLUMN last_hit_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS scout_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  query TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  ranked_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scout_runs_job ON scout_runs (job_id, created_at DESC);
