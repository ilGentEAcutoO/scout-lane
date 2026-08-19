-- Candidate records only store what HR approved into the tracker.
-- Never log these rows; query them through parameterized statements.

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  source TEXT NOT NULL,
  profile_url TEXT,
  stage TEXT NOT NULL DEFAULT 'applied',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  starts_at TEXT NOT NULL,
  calendar_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates(stage);
CREATE INDEX IF NOT EXISTS idx_candidates_source ON candidates(source);
