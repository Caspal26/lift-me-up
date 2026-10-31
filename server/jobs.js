import { clock } from './clock.js';

export function startJob(db, job, localDate = null) {
  const r = db.prepare('INSERT INTO job_runs (job, local_date, started_at) VALUES (?, ?, ?)')
    .run(job, localDate, clock.now().toISOString());
  return Number(r.lastInsertRowid);
}

export function finishJob(db, id, outcome, detail = null) {
  db.prepare('UPDATE job_runs SET finished_at = ?, outcome = ?, detail = ? WHERE id = ?')
    .run(clock.now().toISOString(), outcome, detail === null ? null : JSON.stringify(detail), id);
}

export function jobRuns(db, job, localDate) {
  return db.prepare('SELECT * FROM job_runs WHERE job = ? AND local_date IS ? ORDER BY started_at').all(job, localDate);
}

export function lastJob(db, job) {
  return db.prepare('SELECT * FROM job_runs WHERE job = ? ORDER BY started_at DESC, id DESC LIMIT 1').get(job) || null;
}

export function jobsSince(db, job, sinceIso) {
  return db.prepare('SELECT * FROM job_runs WHERE job = ? AND started_at >= ? ORDER BY started_at').all(job, sinceIso);
}
