CREATE TABLE IF NOT EXISTS candidate_events (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  stage TEXT,
  from_stage TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_candidate ON candidate_events(candidate_id, created_at);
