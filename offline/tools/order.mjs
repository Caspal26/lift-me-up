#!/usr/bin/env node
// Order the verified editions for the app so every stretch of mornings keeps
// the rotation quotas (server/research/rotation.js, tightened for a fixed
// sequence): an African founder in every 4 consecutive mornings, healthcare
// in every 5, a closure or change of direction in every 6, a bootstrapped
// business in every 6. Softer rules keep thinkers, traditions, regions,
// industries and talQen mentions apart. Writes offline/work/bundle.json.
// Usage: node offline/tools/order.mjs [--first <edition-id>]
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../../server/db.js';
import { readingMinutes, wordStats } from '../../server/editions.js';
import { mentionsTalqen, WORK } from './lib.mjs';

const AFRICA = new Set(['Kenya', 'East Africa', 'West Africa', 'Southern Africa', 'North Africa', 'Central Africa']);
export const isHealth = (e) => /health|diagnos|pharma|medic|biotech|hospital|clinic/i.test(e.story.industry);
export const RULES = [
  { name: 'African founder', every: 4, test: (e) => AFRICA.has(e.story.region) },
  { name: 'healthcare', every: 5, test: isHealth },
  { name: 'closure or change of direction', every: 6, test: (e) => e.story.arc === 'closure' || e.story.arc === 'change-of-direction' },
  { name: 'bootstrapped', every: 6, test: (e) => e.story.funding === 'bootstrapped' },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 2 ** 32);
}

// Distinctive surname and company words, to keep stories that mention each
// other (two pacemaker pioneers, say) a few weeks apart.
const NAME_STOP = new Set(['and', 'the', 'later', 'company', 'limited', 'group', 'with', 'brothers', 'others', 'co-founders', 'founders']);
const keys = new WeakMap();
function nameKeys(e) {
  if (!keys.has(e)) {
    const words = `${e.story.founder} ${e.story.company}`.split(/[^\p{L}]+/u).filter((w) => w.length > 4 && !NAME_STOP.has(w.toLowerCase()));
    keys.set(e, new Set(words));
  }
  return keys.get(e);
}
const texts = new WeakMap();
const relatedCache = new Map();
const related = (a, b) => {
  const key = `${a.id}|${b.id}`;
  if (!relatedCache.has(key)) {
    if (!texts.has(a)) texts.set(a, a.story.paragraphs.join(' '));
    const text = texts.get(a);
    let hit = false;
    for (const k of nameKeys(b)) if (text.includes(k)) { hit = true; break; }
    relatedCache.set(key, hit);
  }
  return relatedCache.get(key);
};
const talqenCache = new WeakMap();
const talqen = (e) => {
  if (!talqenCache.has(e)) talqenCache.set(e, mentionsTalqen(e));
  return talqenCache.get(e);
};

function penalty(e, placed) {
  let p = 0;
  const back = (n) => placed.slice(-n);
  if (back(30).some((x) => related(e, x) || related(x, e))) p += 5;
  if (back(10).some((x) => x.quote.thinker === e.quote.thinker)) p += 8;
  if (back(2).some((x) => x.quote.tradition === e.quote.tradition)) p += 3;
  if (back(1).some((x) => x.story.region === e.story.region)) p += 2;
  if (back(1).some((x) => x.story.industry === e.story.industry)) p += 1.5;
  if (back(1).some((x) => x.story.arc === e.story.arc)) p += 0.7;
  if (talqen(e) && back(4).some(talqen)) p += 6;
  return p;
}

export function orderEditions(pool, { first = null, seed = 1 } = {}) {
  const rand = rng(seed);
  const left = [...pool];
  const placed = [];
  if (first) {
    const i = left.findIndex((e) => e.id === first);
    if (i >= 0) placed.push(left.splice(i, 1)[0]);
  }
  while (left.length) {
    const pos = placed.length;
    // How many more mornings each rule can wait before it must be met.
    const slack = RULES.map((r) => {
      let last = -1;
      for (let i = placed.length - 1; i >= 0; i--) if (r.test(placed[i])) { last = i; break; }
      return last + r.every - pos; // 0 = must be met now
    });
    const supplies = RULES.map((r) => left.filter(r.test).length / left.length);
    // Thinkers with many quotes left go sooner, so the end of the year is not
    // left with the same few voices back to back.
    const remaining = new Map();
    for (const x of left) remaining.set(x.quote.thinker, (remaining.get(x.quote.thinker) || 0) + 1);
    const scored = left.map((e) => {
      let s = penalty(e, placed) + rand() * 0.5 - 25 * (remaining.get(e.quote.thinker) / left.length);
      RULES.forEach((r, k) => {
        const has = r.test(e);
        const supply = supplies[k];
        const need = 1 / r.every;
        if (slack[k] === 0 && !has) s += 1000;
        // Spend a scarce kind only when it is nearly due; use a plentiful one freely.
        if (has && slack[k] > 0) s += supply < need * 1.6 ? 2.5 * (slack[k] / r.every) : 0;
        if (!has && slack[k] === 1) s += 1.2;
      });
      return { e, s };
    });
    scored.sort((a, b) => a.s - b.s);
    placed.push(scored[0].e);
    left.splice(left.indexOf(scored[0].e), 1);
  }
  return placed;
}

export function checkOrder(list) {
  const problems = [];
  for (const r of RULES) {
    let gap = 0;
    list.forEach((e, i) => {
      gap = r.test(e) ? 0 : gap + 1;
      if (gap >= r.every) problems.push(`${r.name}: none in mornings ${i - r.every + 2}–${i + 1}`);
    });
  }
  list.forEach((e, i) => {
    const near = list.slice(Math.max(0, i - 6), i).find((x) => x.quote.thinker === e.quote.thinker);
    if (near) problems.push(`soft: ${e.quote.thinker} on mornings ${list.indexOf(near) + 1} and ${i + 1}`);
  });
  return problems;
}

if (process.argv[1].endsWith('order.mjs')) {
  const args = process.argv.slice(2);
  const first = args.includes('--first') ? args[args.indexOf('--first') + 1] : 'ory-okolloh-ushahidi-first-six-days';
  const db = openDb(path.join(WORK, 'scratch.db'));
  // Editions on the hold list (offline/hold.json) pass every check but are
  // thinner; they ship only with --include-held.
  const holdFile = path.join(WORK, '..', 'hold.json');
  const held = new Set(args.includes('--include-held') || !fs.existsSync(holdFile) ? [] : JSON.parse(fs.readFileSync(holdFile, 'utf8')).hold);
  const rows = db.prepare("SELECT id, body, verification FROM pieces WHERE status = 'reserve'").all().filter((r) => !held.has(r.id));
  if (held.size) console.log(`Holding back ${held.size} edition(s) listed in offline/hold.json`);
  const pool = rows.map((r) => {
    const body = JSON.parse(r.body);
    const v = JSON.parse(r.verification);
    const q = v.quote || {};
    return { ...body, minutes: readingMinutes(wordStats(body).total), verification: { quote: { verified: Boolean(q.verified), match: q.match, checkedAt: q.checkedAt } } };
  });
  let best = null;
  for (let seed = 1; seed <= 12; seed++) {
    const list = orderEditions(pool, { first, seed });
    const problems = checkOrder(list);
    const hard = problems.filter((p) => !p.startsWith('soft')).length;
    if (!best || hard < best.hard || (hard === best.hard && problems.length < best.problems.length)) best = { list, problems, hard, seed };
    if (!problems.length) break;
  }
  const version = `${new Date().toISOString().slice(0, 10)}-${best.list.length}`;
  fs.writeFileSync(path.join(WORK, 'bundle.json'), JSON.stringify({ version, built_at: new Date().toISOString(), editions: best.list }));
  fs.writeFileSync(path.join(WORK, 'schedule.txt'), best.list.map((e, i) => `${String(i + 1).padStart(3)} ${RULES.map((r) => (r.test(e) ? r.name[0].toUpperCase() : '·')).join('')} ${mentionsTalqen(e) ? 'T' : ' '} ${e.story.region.padEnd(15)} ${e.quote.tradition.padEnd(28)} ${e.id}`).join('\n') + '\n');
  console.log(`Ordered ${best.list.length} editions (seed ${best.seed}); bundle ${version}`);
  console.log(best.problems.length ? best.problems.join('\n') : 'All rotation rules hold for every stretch of mornings.');
  db.close();
}
