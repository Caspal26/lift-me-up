#!/usr/bin/env node
// Plan the next research batch: take pending slate entries in proportion to
// what is left in each region, give each a quote tradition (spreading them by
// how much each tradition's texts can still supply), and deal them into
// groups for parallel researchers. Writes offline/work/batch-<NN>.json.
// Usage: node offline/tools/batch.mjs <batch-number> [size=25] [groups=5]
import fs from 'node:fs';
import path from 'node:path';
import { allEditions, WORK } from './lib.mjs';
import { readProgress, readSlate } from './slate.mjs';

const AFRICA = new Set(['Kenya', 'East Africa', 'West Africa', 'Southern Africa', 'North Africa', 'Central Africa']);

// Roughly how many distinct, usable quotes each tradition's cached texts hold.
const CAPACITY = {
  Stoic: 45, 'Classical Greek': 40, 'Renaissance and early modern': 40, American: 40,
  'Islamic and Persian': 34, Daoist: 30, Hindu: 30, Confucian: 25, Buddhist: 25, Jewish: 25,
  'Ancient Egyptian': 12, Japanese: 12,
};

// --skip k1,k2 leaves out entries a still-running researcher is working on.
const argv = process.argv.slice(2);
const skipArg = argv.includes('--skip') ? argv.splice(argv.indexOf('--skip'), 2)[1] : '';
const skip = new Set(skipArg.split(',').filter(Boolean));
const [num, sizeArg = '25', groupsArg = '5'] = argv;
if (!num) {
  console.error('Usage: node offline/tools/batch.mjs <batch-number> [size] [groups]');
  process.exit(2);
}
const size = Number(sizeArg);
const groups = Number(groupsArg);

const slate = readSlate();
const progress = readProgress();
// A batch is planned only after the previous one has finished, so anything
// without a progress file (including entries a stalled researcher never
// reached) is simply pending again.
const planned = skip;
const pending = slate.filter((r) => !progress.has(r.key) && !planned.has(r.key));

// Largest-remainder quotas by region.
const byRegion = new Map();
for (const r of pending) {
  if (!byRegion.has(r.region)) byRegion.set(r.region, []);
  byRegion.get(r.region).push(r);
}
const take = Math.min(size, pending.length);
// African founders are dropped more often (fewer sources load), so they get a
// larger share than the slate's to keep one in every four mornings.
const weight = (region) => (AFRICA.has(region) ? 1.25 : 1);
const totalWeight = pending.reduce((s, r) => s + weight(r.region), 0);
const quotas = [...byRegion].map(([region, list]) => ({ region, list, exact: (take * list.length * weight(region)) / totalWeight }));
quotas.forEach((q) => { q.n = Math.floor(q.exact); });
let left = take - quotas.reduce((s, q) => s + q.n, 0);
for (const q of [...quotas].sort((a, b) => (b.exact - b.n) - (a.exact - a.n))) {
  if (left <= 0) break;
  q.n++;
  left--;
}
// Within each region, prefer entries whose kind (healthcare, closure or
// change of direction, bootstrapped) is furthest below its share so far, so
// every batch helps the rotation quotas rather than just the slate's order.
const TARGET = { health: 0.25, turn: 0.3, boot: 0.3 };
const doneKeys = new Set([...progress.values()].filter((p) => p.status === 'done').map((p) => p.key));
const counted = slate.filter((r) => doneKeys.has(r.key) || planned.has(r.key));
const chosen = [];
const share = (flag) => (counted.length + chosen.length ? [...counted, ...chosen].filter((r) => r[flag]).length / (counted.length + chosen.length) : 0);
for (const q of quotas.sort((a, b) => b.n - a.n)) {
  const list = [...q.list];
  for (let k = 0; k < q.n; k++) {
    const score = (r) => Object.entries(TARGET).reduce((s, [flag, t]) => s + (r[flag] ? t - share(flag) : 0), 0);
    list.sort((a, b) => score(b) - score(a));
    chosen.push(list.shift());
  }
}

// Traditions: least-used relative to capacity first.
const used = new Map(Object.keys(CAPACITY).map((t) => [t, 0]));
for (const { edition } of allEditions()) if (edition?.quote?.tradition && used.has(edition.quote.tradition)) used.set(edition.quote.tradition, used.get(edition.quote.tradition) + 1);
function nextTradition(avoid) {
  const ranked = Object.keys(CAPACITY).sort((a, b) => (used.get(a) / CAPACITY[a]) - (used.get(b) / CAPACITY[b]));
  const t = ranked.find((x) => !avoid.has(x)) || ranked[0];
  used.set(t, used.get(t) + 1);
  return t;
}

// Deal into groups so each researcher gets a mix of regions.
const out = Array.from({ length: groups }, () => []);
chosen.sort((a, b) => a.region.localeCompare(b.region));
chosen.forEach((r, i) => out[i % groups].push(r));
for (const g of out) {
  const avoid = new Set();
  for (const r of g) {
    r.tradition = nextTradition(avoid);
    avoid.add(r.tradition);
  }
}

const file = path.join(WORK, `batch-${String(num).padStart(2, '0')}.json`);
const slim = out.map((g) => g.map(({ key, founder, company, episode, year, country, region, industry, arc, funding, tradition }) => ({ key, founder, company, episode, year, country, region, industry, arc, funding, tradition })));
fs.writeFileSync(file, `${JSON.stringify({ batch: Number(num), created: new Date().toISOString(), groups: slim }, null, 2)}\n`);
console.log(`Wrote ${file}: ${chosen.length} entries in ${groups} groups`);
for (const [i, g] of slim.entries()) console.log(`  group ${i + 1}: ${g.map((r) => `${r.key} [${r.tradition}]`).join(', ')}`);
