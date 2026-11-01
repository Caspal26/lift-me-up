#!/usr/bin/env node
// The slate: every candidate episode, its research status and the batches.
//   node offline/tools/slate.mjs stats            counts by region, industry, arc, funding
//   node offline/tools/slate.mjs status           done / dropped / pending per batch
//   node offline/tools/slate.mjs next <n> [size]  the next n pending entries, balanced, as JSON
// Status lives in offline/progress/<key>.json, written by whoever researched it:
//   { "key", "status": "done" | "dropped", "file", "reason", "conflicts", "talqen" }
import fs from 'node:fs';
import path from 'node:path';
import { OFFLINE } from './lib.mjs';

const AFRICA = new Set(['Kenya', 'East Africa', 'West Africa', 'Southern Africa', 'North Africa', 'Central Africa']);
const HEALTH = new Set(['healthcare', 'diagnostics', 'pharmaceuticals', 'medical devices', 'biotech']);

export function readSlate() {
  const lines = fs.readFileSync(path.join(OFFLINE, 'slate.tsv'), 'utf8').split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split('|');
  return lines.map((l) => Object.fromEntries(l.split('|').map((v, i) => [head[i], v.trim()])))
    .filter((r) => r.founder && r.founder !== 'skip')
    .map((r) => ({ ...r, key: r.key.trim(), africa: AFRICA.has(r.region), health: HEALTH.has(r.industry), turn: r.arc === 'closure' || r.arc === 'change-of-direction', boot: r.funding === 'bootstrapped' }));
}

export function readProgress() {
  const dir = path.join(OFFLINE, 'progress');
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (p.key) out.set(p.key, p);
    } catch { /* half-written file: treat as pending */ }
  }
  return out;
}

function tally(rows, pick) {
  const m = new Map();
  for (const r of rows) m.set(pick(r), (m.get(pick(r)) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
}

// Take n pending entries spread across regions and flags, so every batch
// carries its share of African, healthcare, turning-point and bootstrapped
// stories.
export function nextBatch(slate, progress, n) {
  const pending = slate.filter((r) => !progress.has(r.key));
  const picked = [];
  const byRegion = new Map();
  for (const r of pending) {
    if (!byRegion.has(r.region)) byRegion.set(r.region, []);
    byRegion.get(r.region).push(r);
  }
  const share = (r) => (r.africa ? 0.34 : 0.66 / 8);
  while (picked.length < n && picked.length < pending.length) {
    let best = null;
    let bestScore = -Infinity;
    for (const [region, list] of byRegion) {
      if (!list.length) continue;
      const have = picked.filter((p) => p.region === region).length;
      const want = share(list[0]) * n * (region === 'Kenya' ? 1.6 : region === 'Central Africa' || region === 'North Africa' ? 0.5 : 1) / (AFRICA.has(region) ? 3.1 : 1);
      const score = (want - have) + list.length / 400;
      if (score > bestScore) { bestScore = score; best = region; }
    }
    picked.push(byRegion.get(best).shift());
  }
  return picked;
}

const [cmd = 'stats', ...rest] = process.argv.slice(2);
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('slate.mjs')) {
  const slate = readSlate();
  const progress = readProgress();
  if (cmd === 'stats') {
    console.log(`${slate.length} entries`);
    console.log(`African ${slate.filter((r) => r.africa).length}, healthcare ${slate.filter((r) => r.health).length}, closure/change ${slate.filter((r) => r.turn).length}, bootstrapped ${slate.filter((r) => r.boot).length}`);
    console.log(`Regions: ${tally(slate, (r) => r.region)}`);
    console.log(`Industries: ${tally(slate, (r) => r.industry)}`);
    console.log(`Arcs: ${tally(slate, (r) => r.arc)}`);
    console.log(`Funding: ${tally(slate, (r) => r.funding)}`);
    const dupes = slate.map((r) => r.key).filter((k, i, a) => a.indexOf(k) !== i);
    if (dupes.length) console.log(`DUPLICATE KEYS: ${dupes.join(', ')}`);
  } else if (cmd === 'status') {
    const done = [...progress.values()].filter((p) => p.status === 'done');
    const dropped = [...progress.values()].filter((p) => p.status === 'dropped');
    console.log(`${done.length} done, ${dropped.length} dropped, ${slate.length - progress.size} pending of ${slate.length}`);
    for (const d of dropped) console.log(`  dropped ${d.key}: ${d.reason}`);
  } else if (cmd === 'next') {
    const n = Number(rest[0] || 25);
    console.log(JSON.stringify(nextBatch(slate, progress, n), null, 2));
  }
}
