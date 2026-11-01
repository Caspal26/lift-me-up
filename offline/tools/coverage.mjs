#!/usr/bin/env node
// Coverage of the finished editions (seeds + researched): regions,
// industries, arcs, funding, traditions, thinkers, talQen mentions, and the
// slate entries dropped and why. Usage: node offline/tools/coverage.mjs [--md]
import fs from 'node:fs';
import path from 'node:path';
import { allEditions, mentionsTalqen, OFFLINE } from './lib.mjs';
import { isHealth } from './order.mjs';

const AFRICA = new Set(['Kenya', 'East Africa', 'West Africa', 'Southern Africa', 'North Africa', 'Central Africa']);
// --bundle reports on what ships (work/bundle.json); otherwise every edition on disk.
const fromBundle = process.argv.includes('--bundle');
const list = fromBundle
  ? JSON.parse(fs.readFileSync(path.join(OFFLINE, 'work', 'bundle.json'), 'utf8')).editions
  : allEditions().filter((x) => x.edition).map((x) => x.edition);
const md = process.argv.includes('--md');

function tally(pick) {
  const m = new Map();
  for (const e of list) {
    const k = pick(e);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}
const pct = (n) => `${Math.round((100 * n) / list.length)}%`;
const line = (rows) => rows.map(([k, v]) => `${k} ${v}`).join(', ');
const industryGroup = (e) => {
  const s = e.story.industry.toLowerCase();
  if (isHealth(e)) return /diagnos|laborat|patholog/.test(s) ? 'diagnostics' : /pharma|drug|medicine/.test(s) ? 'pharmaceuticals' : /device|instrument|equipment/.test(s) ? 'medical devices' : /biotech|genom/.test(s) ? 'biotech' : 'healthcare';
  for (const k of ['fintech', 'finance', 'bank', 'software', 'telecom', 'media', 'retail', 'food', 'agricult', 'transport', 'logistic', 'energy', 'education', 'fashion', 'hospitality', 'travel', 'manufactur', 'construction', 'social']) if (s.includes(k)) return k.replace(/^bank$/, 'finance');
  return s.split(/[ (,]/)[0];
};

const africa = list.filter((e) => AFRICA.has(e.story.region)).length;
const health = list.filter(isHealth).length;
const turn = list.filter((e) => ['closure', 'change-of-direction'].includes(e.story.arc)).length;
const boot = list.filter((e) => e.story.funding === 'bootstrapped').length;
const talqen = list.filter(mentionsTalqen).length;

const out = [];
out.push(`${list.length} editions (6 seeds + ${list.length - 6} researched)${fromBundle ? ', as bundled in the app' : ''}`);
out.push(`African founders ${africa} (${pct(africa)}), healthcare ${health} (${pct(health)}), closure/change ${turn} (${pct(turn)}), bootstrapped ${boot} (${pct(boot)}), talQen mentioned in ${talqen} (${pct(talqen)})`);
out.push(`Regions: ${line(tally((e) => e.story.region))}`);
out.push(`Countries: ${tally((e) => e.story.country).length} (${line(tally((e) => e.story.country).slice(0, 12))}, …)`);
out.push(`Industries: ${line(tally(industryGroup))}`);
out.push(`Arcs: ${line(tally((e) => e.story.arc))}`);
out.push(`Funding: ${line(tally((e) => e.story.funding))}`);
out.push(`Traditions: ${line(tally((e) => e.quote.tradition))}`);
out.push(`Thinkers: ${tally((e) => e.quote.thinker).length} (${line(tally((e) => e.quote.thinker).slice(0, 10))}, …)`);
out.push(`Quote stance: ${line(tally((e) => e.quote.stance))}`);
out.push(`Story eras: ${line(tally((e) => { const y = Number(String(e.story.approx_date).slice(0, 4)); return y < 1900 ? 'before 1900' : y < 1950 ? '1900–49' : y < 2000 ? '1950–99' : '2000 on'; }))}`);

const dropped = [];
for (const dir of [path.join(OFFLINE, 'progress'), path.join(OFFLINE, 'progress', 'retry')]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (p.status === 'dropped') dropped.push(`${p.key}${dir.endsWith('retry') ? ' (queued for retry)' : ''}: ${p.reason}`);
  }
}
out.push(`Dropped: ${dropped.length}`);
for (const d of dropped) out.push(`  - ${d}`);
console.log(md ? out.map((l) => (l.startsWith('  ') ? l : `- ${l}`)).join('\n') : out.join('\n'));
