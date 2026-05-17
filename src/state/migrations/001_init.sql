CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  spec TEXT NOT NULL,
  channels TEXT NOT NULL,
  project_repo TEXT,
  estimate TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
