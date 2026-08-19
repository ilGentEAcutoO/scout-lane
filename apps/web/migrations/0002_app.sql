CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  skills_score REAL,
  experience_score REAL,
  culture_score REAL,
  strengths TEXT,
  flags TEXT,
  questions TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shortlist (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  headline TEXT,
  profile_url TEXT,
  location TEXT,
  reason TEXT,
  fit_score REAL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE candidates ADD COLUMN headline TEXT;
ALTER TABLE candidates ADD COLUMN notes TEXT;
ALTER TABLE candidates ADD COLUMN resume_key TEXT;
ALTER TABLE candidates ADD COLUMN job_id TEXT;
