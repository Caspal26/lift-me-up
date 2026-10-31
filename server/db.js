import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Every researched edition. "candidate" was researched for a specific morning,
-- "reserve" waits for a morning when research is unavailable, "published"
-- belongs to exactly one local calendar day.
CREATE TABLE IF NOT EXISTS pieces (
  id             TEXT PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('candidate', 'reserve', 'published')),
  origin         TEXT NOT NULL CHECK (origin IN ('live', 'seed', 'fixture')),
  intended_date  TEXT,
  published_date TEXT UNIQUE,
  title          TEXT NOT NULL,
  founder        TEXT NOT NULL,
  company        TEXT NOT NULL,
  body           TEXT NOT NULL,
  verification   TEXT NOT NULL,
  researched_at  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  published_at   TEXT
);
CREATE INDEX IF NOT EXISTS pieces_status ON pieces (status, created_at);

-- Permanent record of every episode that has been researched, so a story is
-- never told twice. Rows are never deleted.
CREATE TABLE IF NOT EXISTS story_ledger (
  id          INTEGER PRIMARY KEY,
  piece_id    TEXT NOT NULL,
  founder     TEXT NOT NULL,
  company     TEXT NOT NULL,
  event       TEXT NOT NULL,
  approx_date TEXT NOT NULL,
  summary     TEXT NOT NULL,
  country     TEXT,
  region      TEXT,
  industry    TEXT,
  arc         TEXT,
  funding     TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_ledger (
  id          INTEGER PRIMARY KEY,
  piece_id    TEXT NOT NULL,
  thinker     TEXT NOT NULL,
  work        TEXT NOT NULL,
  locator     TEXT,
  tradition   TEXT,
  text        TEXT NOT NULL,
  norm        TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favourites (
  piece_id TEXT PRIMARY KEY REFERENCES pieces (id),
  saved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS encouragements (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT NOT NULL,
  local_date    TEXT NOT NULL,
  note          TEXT,
  text          TEXT NOT NULL,
  origin        TEXT NOT NULL,
  fallback_key  TEXT,
  related_piece TEXT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              INTEGER PRIMARY KEY,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TEXT NOT NULL,
  last_success_at TEXT,
  failures        INTEGER NOT NULL DEFAULT 0,
  disabled_at     TEXT
);

-- One row per (morning, channel, recipient). The row is claimed before
-- sending, which is what makes retries safe against duplicates.
CREATE TABLE IF NOT EXISTS deliveries (
  id         INTEGER PRIMARY KEY,
  local_date TEXT NOT NULL,
  channel    TEXT NOT NULL,
  target     TEXT NOT NULL,
  piece_id   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'abandoned')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT NOT NULL,
  sent_at    TEXT,
  last_error TEXT,
  UNIQUE (local_date, channel, target)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY,
  job         TEXT NOT NULL,
  local_date  TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  outcome     TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS job_runs_job ON job_runs (job, local_date, started_at);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function deleteSetting(db, key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
