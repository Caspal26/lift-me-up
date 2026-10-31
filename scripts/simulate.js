#!/usr/bin/env node
// Three simulated mornings, end to end, on a fresh database:
//
//   Mon — the research job runs at 05:30. Its first candidate retells an
//         episode already in the ledger under a new title and is rejected;
//         the second is verified and published at 08:00.
//   Tue — the research service is down all morning (three attempts fail).
//         At 08:00 the morning falls back to the reserve. One device's push
//         fails and is retried; then the whole 08:00 run is retried and the
//         server is "restarted".
//   Wed — research succeeds again.
//
// Push messages go to a local stand-in push service that decrypts them the
// way a phone would; WhatsApp goes to a local stand-in Graph API. Quotes and
// story sources are checked live over the network.
//
//   node scripts/simulate.js            run, print the checks, write the report
//   node scripts/simulate.js --serve    …then keep the app running for a look
process.env.ALLOW_INSECURE_PUSH_ENDPOINTS = '1';

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp } from '../server/app.js';
import { createAuth } from '../server/auth.js';
import { clock } from '../server/clock.js';
import { config, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { saveSubscription } from '../server/delivery/push.js';
import { optIn } from '../server/delivery/whatsapp.js';
import { getPublished, publishForDate, toPublic, wordStats } from '../server/editions.js';
import { ResearchError } from '../server/research/claude.js';
import { verifyQuote } from '../server/research/verify.js';
import { createScheduler } from '../server/scheduler.js';
import { importEditions, readSeedFiles } from '../server/seed.js';
import { zonedTimeToUtc } from '../server/time.js';
import { startMockServices } from './lib/mock-services.js';

const args = process.argv.slice(2);
const SERVE = args.includes('--serve');
const PORT = Number(args[args.indexOf('--port') + 1]) || 8090;
const TZ = 'Africa/Nairobi';
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04'];
const PASSCODE = 'morning-sim';
// Editions held back from the reserve to play the research job's results.
const FIXTURE_PREFERENCE = [/ushahidi/, /coulter/];

const at = (ymd, hhmm) => zonedTimeToUtc(ymd, hhmm, TZ);
const stamp = () => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(clock.now());

const timeline = [];
const note = (m) => timeline.push(`${stamp()}  ${m}`);
const log = { info: note, warn: note, error: note };

// ---- fresh state ----------------------------------------------------------------

const SIM_DIR = path.join(ROOT, 'data', 'simulation');
fs.rmSync(SIM_DIR, { recursive: true, force: true });
const db = openDb(path.join(SIM_DIR, 'simulation.db'));
clock.set(at('2026-11-01', '20:00'));

const mocks = await startMockServices({ now: () => clock.now() });
Object.assign(config.whatsapp, {
  token: 'simulated-token', phoneNumberId: '100200300', templateName: 'lift_me_up_morning',
  templateLang: 'en', templateParams: ['title', 'url'], apiBase: mocks.base,
});
config.publicUrl = `http://localhost:${PORT}`;
config.passcode = PASSCODE;
config.reserveTarget = 3;

// ---- the reserve and the research job's results ----------------------------------

const seeds = readSeedFiles();
if (seeds.length < 4) {
  console.error(`The simulation needs at least four researched editions in seed/editions (found ${seeds.length}).`);
  process.exit(1);
}
const fixtures = [];
for (const re of FIXTURE_PREFERENCE) {
  const hit = seeds.find((s) => re.test(s.edition.id) && !fixtures.includes(s));
  if (hit) fixtures.push(hit);
}
for (const s of seeds) if (fixtures.length < 2 && !fixtures.includes(s)) fixtures.push(s);
const reserveSeeds = seeds.filter((s) => !fixtures.includes(s));

note(`Loading ${reserveSeeds.length} researched editions into the reserve (quotes and sources checked live)`);
const imported = await importEditions(db, reserveSeeds, { log });
for (const r of imported) note(`  reserve: ${r.status} ${r.id || r.file}${r.reason ? ` — ${r.reason}` : ''}`);

// A retelling of a reserve episode under a new title: must be caught as a repeat.
const retold = structuredClone(reserveSeeds.find((s) => /glitch|slack|butterfield/.test(s.edition.id))?.edition || reserveSeeds[0].edition);
retold.id = `retold-${retold.id}`;
retold.title = `A Second Look at ${retold.story.company}`;
retold.dek = 'The same incident, found in a different article and given a new headline.';

function draftOf(edition) {
  const { quote, ...rest } = structuredClone(edition);
  return { draft: { ...rest, quote_options: [quote] }, openedUrls: edition.sources.map((s) => s.url) };
}

const researcher = {
  name: 'fixture',
  origin: 'fixture',
  queue: [retold, fixtures[0].edition, fixtures[1].edition],
  outage: 0,
  async draftEdition() {
    if (this.outage > 0) {
      this.outage--;
      throw new ResearchError('unavailable', 'research service unavailable (simulated outage)');
    }
    const next = this.queue.shift();
    if (!next) throw new ResearchError('unavailable', 'no more simulated research results');
    note(`  research returned "${next.title}"`);
    return draftOf(next);
  },
};

// ---- devices and channels -------------------------------------------------------------

saveSubscription(db, mocks.addDevice('phone'), 'Android Chrome (simulated phone)');
saveSubscription(db, mocks.addDevice('laptop'), 'Desktop Chrome (simulated laptop)');
optIn(db, '+254700000001');
note('Registered push for a phone and a laptop; WhatsApp opt-in recorded for +254 700 ••• 001');

// ---- the app, served over HTTP --------------------------------------------------------------

let scheduler = createScheduler({ db, researcher, log });
const app = createApp({ db, scheduler: { tick: (o) => scheduler.tick(o) }, researcher: null, auth: createAuth(db), log });
// The decrypted push payloads the simulated phone received, so a browser can
// replay a real one and tap it.
const outer = express();
outer.get('/sim/pushes', (req, res) => res.json(mocks.pushes));
outer.use(app);
const server = await new Promise((resolve) => { const s = outer.listen(PORT, () => resolve(s)); });
const base = `http://localhost:${PORT}`;
const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: PASSCODE }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const get = async (p) => (await fetch(`${base}${p}`, { headers: { cookie } })).json();

async function tickAt(ymd, hhmm) {
  clock.set(at(ymd, hhmm));
  const r = await scheduler.tick({ awaitResearch: true });
  if (!r.events.length) note('(nothing to do)');
  return r;
}

// ---- Monday ---------------------------------------------------------------------------------

await tickAt(DAYS[0], '05:30');
await tickAt(DAYS[0], '07:59');
await tickAt(DAYS[0], '08:00');
const monRefresh = [(await get('/api/today')).edition?.id, (await get('/api/today')).edition?.id];
await tickAt(DAYS[0], '08:01');

// ---- Tuesday --------------------------------------------------------------------------------

researcher.outage = 3;
await tickAt(DAYS[1], '05:30');
await tickAt(DAYS[1], '05:50');
await tickAt(DAYS[1], '06:10');
await tickAt(DAYS[1], '06:30');
mocks.failNext('laptop', 1);
await tickAt(DAYS[1], '08:00');
const tueFirst = (await get('/api/today')).edition?.id;

note('— retrying the 08:00 run, as if the job had fired twice —');
await tickAt(DAYS[1], '08:00');
const direct = publishForDate(db, DAYS[1]);
note(`publishForDate(${DAYS[1]}) called again directly → ${direct.source} edition ${direct.piece?.id}`);

note('— restarting the server and running the morning job again —');
scheduler = createScheduler({ db, researcher, log });
await tickAt(DAYS[1], '08:03');
await tickAt(DAYS[1], '08:10');
const tueAfter = (await get('/api/today')).edition?.id;

// ---- Wednesday ------------------------------------------------------------------------------

await tickAt(DAYS[2], '05:30');
await tickAt(DAYS[2], '08:00');
await tickAt(DAYS[2], '08:05');

// ---- checks ---------------------------------------------------------------------------------

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

const pieces = DAYS.map((d) => getPublished(db, d));
const editions = pieces.map((p) => (p ? toPublic(p) : null));
check('One edition published for each of the three mornings', editions.every(Boolean), editions.map((e) => e?.id).join(', '));

const episodes = new Set(editions.filter(Boolean).map((e) => `${e.story.founder}|${e.story.event}`));
check('Three distinct stories (different founders and episodes)', episodes.size === 3 && new Set(editions.map((e) => e?.story.founder)).size === 3);

const sourceOk = pieces.map((p) => {
  const v = JSON.parse(p?.verification || '{}');
  return (v.sources || []).filter((s) => s.relevant).length;
});
check('Every story has at least two live sources that name the founder or company', sourceOk.every((n) => n >= 2), sourceOk.map((n, i) => `${DAYS[i]}: ${n}`).join(', '));

const recheck = await Promise.all(editions.map((e) => (e ? verifyQuote(e.quote.text, e.quote.source_url) : { verified: false })));
check('Three quotes, each re-verified word for word against its edition just now', recheck.every((r) => r.verified), recheck.map((r) => r.match).join(', '));
check('Three different thinkers', new Set(editions.map((e) => e?.quote.thinker)).size === 3);

check('Retelling an episode under a new title was rejected as a repeat',
  timeline.some((t) => t.includes('rejected as a repeat')) && !db.prepare('SELECT 1 FROM pieces WHERE id LIKE ?').get('retold-%'));

check('Research outage on Tuesday fell back to the reserve', pieces[1]?.origin === 'seed' && timeline.some((t) => t.includes('from reserve')));

check('Refreshing returns the same edition', monRefresh[0] && monRefresh[0] === monRefresh[1], monRefresh.join(' = '));
check('Retrying Tuesday\'s run (twice, and after a restart) kept the original edition',
  tueFirst && tueFirst === tueAfter && direct.source === 'existing' && direct.piece.id === tueFirst, `${tueFirst} → ${tueAfter}`);

const perDay = (list, pick) => DAYS.map((d) => list.filter((x) => pick(x) === d).length);
const phone = perDay(mocks.pushes.filter((p) => p.device === 'phone'), (p) => p.payload.date);
const laptop = perDay(mocks.pushes.filter((p) => p.device === 'laptop'), (p) => p.payload.date);
const wa = perDay(mocks.whatsapp, (m) => m.body.template.components[0].parameters[1].text.slice(-10));
check('Exactly one notification per device per morning (phone, laptop, WhatsApp)',
  [...phone, ...laptop, ...wa].every((n) => n === 1), `phone ${phone.join('/')}, laptop ${laptop.join('/')}, WhatsApp ${wa.join('/')}`);

const laptopTue = mocks.pushAttempts.filter((a) => a.device === 'laptop' && a.topic === `ed-${DAYS[1]}`).map((a) => a.result);
check('A failed push was retried once, without re-sending to devices that already had it',
  laptopTue.join(',') === 'failed (simulated 500),delivered' && phone[1] === 1, laptopTue.join(' → '));

const taps = [];
for (const p of mocks.pushes.filter((x) => x.device === 'phone')) {
  const opened = await get(p.payload.url.replace(/^\/e\//, '/api/editions/'));
  taps.push({ date: p.payload.date, url: p.payload.url, notified: p.payload.title, opened: opened.title, ok: opened.title === p.payload.title && opened.date === p.payload.date });
}
check('Each notification shows the story title and its link opens that exact edition', taps.length === 3 && taps.every((t) => t.ok));

const topics = mocks.pushes.every((p) => p.topic === `ed-${p.payload.date}` && p.payload.tag === `edition-${p.payload.date}`);
check('Pushes carry a per-morning Topic and tag, so a repeat would replace rather than stack', topics);

// ---- report ---------------------------------------------------------------------------------

const passed = checks.filter((c) => c.ok).length;
const lines = [];
lines.push('# Lift Me Up — three-morning simulation', '');
lines.push(`Run on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Simulated clock in Africa/Nairobi; delivery at 08:00, research from 05:30.`, '');
lines.push(`**${passed} of ${checks.length} checks passed.**`, '');
for (const c of checks) lines.push(`- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
lines.push('', '## Timeline', '', '```', ...timeline, '```', '');
lines.push('## The three editions', '');
editions.forEach((e, i) => {
  if (!e) return;
  const v = JSON.parse(pieces[i].verification);
  const w = wordStats(JSON.parse(pieces[i].body));
  lines.push(`### ${DAYS[i]} — ${e.title}`, '');
  lines.push(`*${e.dek}*`, '');
  lines.push(`- **Founder:** ${e.story.founder} (${e.story.company}), ${e.story.country}, ${e.story.approx_date} · ${e.story.arc} · ${e.story.industry}`);
  lines.push(`- **Came from:** ${e.origin === 'seed' ? 'the reserve (research service unavailable)' : 'the morning research job'} · researched ${e.researched_at}`);
  lines.push(`- **Length:** ${w.total} words, ${e.minutes}-minute read (story ${w.story}, reflection ${w.reflection}, invitation ${w.invitation})`);
  lines.push(`- **Quote:** “${e.quote.text}” — ${e.quote.thinker}, *${e.quote.work}*${e.quote.locator ? `, ${e.quote.locator}` : ''}${e.quote.translator ? `, trans. ${e.quote.translator}` : ''}`);
  lines.push(`  - Verified: ${recheck[i].verified ? `yes (${recheck[i].match} match)` : 'NO'} against [${e.quote.source_title}](${e.quote.source_url}); stance: ${e.quote.stance}`);
  lines.push('- **Story sources:**');
  for (const s of e.sources) {
    const c = (v.sources || []).find((x) => x.url === s.url);
    lines.push(`  - [${s.title}](${s.url}) — ${s.publisher} · HTTP ${c?.status ?? '—'}${c?.relevant ? ' · names the founder/company' : c?.blocked ? ' · blocks automated checks' : ' · context source'}`);
  }
  if (e.cross_checks.length) {
    lines.push('- **Cross-checked claims:**');
    for (const c of e.cross_checks) lines.push(`  - ${c.claim} (${c.urls.length} sources)`);
  }
  lines.push('');
});
lines.push('## What arrived on each device', '', '| Morning | Device | Notification title | Opens | Push attempts |', '|---|---|---|---|---|');
for (const d of DAYS) {
  for (const dev of ['phone', 'laptop']) {
    const p = mocks.pushes.find((x) => x.device === dev && x.payload.date === d);
    const attempts = mocks.pushAttempts.filter((a) => a.device === dev && a.topic === `ed-${d}`).map((a) => a.result).join(' → ');
    lines.push(`| ${d} | ${dev} | ${p?.payload.title ?? '—'} | \`${p?.payload.url ?? '—'}\` | ${attempts} |`);
  }
  const m = mocks.whatsapp.find((x) => x.body.template.components[0].parameters[1].text.endsWith(d));
  lines.push(`| ${d} | WhatsApp | ${m?.body.template.components[0].parameters[0].text ?? '—'} | ${m?.body.template.components[0].parameters[1].text ?? '—'} | template \`${m?.body.template.name ?? '—'}\` |`);
}
lines.push('');
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'simulation-report.md'), `${lines.join('\n')}\n`);

console.log(timeline.join('\n'));
console.log('');
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
console.log(`\n${passed}/${checks.length} checks passed. Report: docs/simulation-report.md`);

if (SERVE) {
  clock.set(at(DAYS[2], '09:00'));
  console.log(`\nServing the simulated app at ${base} (clock frozen at ${DAYS[2]} 09:00 Nairobi). Passcode: ${PASSCODE}`);
} else {
  server.close();
  await mocks.close();
  db.close();
  process.exitCode = passed === checks.length ? 0 : 1;
}
