#!/usr/bin/env node
// The final gate: import the six seeds and every researched edition into a
// fresh scratch database with the server's importEditions (validation, repeat
// check, live quote verification against the cited edition, live source
// checks), then apply the offline bundle's extra rules: no quote that
// overlaps another, and at least two story sources that really load.
// Usage: node offline/tools/import-all.mjs
// Writes offline/work/scratch.db and offline/work/import-results.json.
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../../server/db.js';
import { importEditions } from '../../server/seed.js';
import { allEditions, memoFetch, mentionsTalqen, quoteClash, WORK } from './lib.mjs';

const DB_FILE = path.join(WORK, 'scratch.db');
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DB_FILE + suffix, { force: true });
const db = openDb(DB_FILE);

const items = allEditions().map(({ file, edition, error }) => (error ? { file: path.basename(file), edition: null, error } : { file: path.basename(file), edition }));
const broken = items.filter((i) => !i.edition);
const quiet = { info() {}, warn() {}, error() {} };
const results = await importEditions(db, items.filter((i) => i.edition), {
  origin: 'seed', verify: true, verifyOpts: { fetchImpl: memoFetch(), timeoutMs: 30000, retries: 2 }, log: quiet,
});

// Offline rules, on what the server accepted.
const pieces = new Map(db.prepare("SELECT id, body, verification FROM pieces").all().map((r) => [r.id, { body: JSON.parse(r.body), verification: JSON.parse(r.verification) }]));
const accepted = [];
for (const r of results) {
  if (r.status !== 'imported') continue;
  const p = pieces.get(r.id);
  const live = (p.verification.sources || []).filter((s) => s.live).length;
  const named = (p.verification.sources || []).filter((s) => s.live && s.relevant).length;
  const clash = quoteClash(p.body.quote.text, accepted.map((a) => ({ id: a.id, text: a.text })));
  const problems = [];
  if (live < 2) problems.push(`only ${live} story source(s) load`);
  if (named < 1) problems.push('no loading source names the founder or company');
  if (clash.length) problems.push(`quote overlaps ${clash.map((c) => c.id).join(', ')}`);
  if (problems.length) {
    r.status = 'rejected';
    r.reason = `offline rules: ${problems.join('; ')}`;
    db.prepare('DELETE FROM pieces WHERE id = ?').run(r.id);
    continue;
  }
  r.live_sources = live;
  r.talqen = mentionsTalqen(p.body);
  accepted.push({ id: r.id, text: p.body.quote.text });
}
for (const b of broken) results.push({ file: b.file, status: 'rejected', reason: `unreadable JSON: ${b.error}` });

fs.writeFileSync(path.join(WORK, 'import-results.json'), `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`);
const by = (s) => results.filter((r) => r.status === s);
console.log(`${by('imported').length} imported, ${by('rejected').length} rejected, ${by('skipped').length} skipped`);
for (const r of by('rejected')) console.log(`  rejected ${r.file}: ${r.reason}`);
const warned = by('imported').filter((r) => r.warnings?.length);
if (warned.length) console.log(`${warned.length} imported with warnings (see import-results.json)`);
db.close();
