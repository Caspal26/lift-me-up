#!/usr/bin/env node
// Run the server's gates on one or more edition files, exactly as a seed
// import would, plus the offline-bundle rules (no repeated quote, at least two
// sources that really load, talQen count). Quote editions in offline/texts
// are served from the cache; use --live to fetch everything from the web.
// Usage: node offline/tools/check-edition.mjs [--live] offline/editions/<id>.json ...
import path from 'node:path';
import { validateEdition, wordStats } from '../../server/editions.js';
import { checkRepeat, checkStorySources, chooseQuote, usableSources } from '../../server/research/pipeline.js';
import { allEditions, cachedTextFetch, memoFetch, mentionsTalqen, normalise, quoteClash, readJson } from './lib.mjs';

const args = process.argv.slice(2);
const live = args.includes('--live');
const files = args.filter((a) => !a.startsWith('--')).map((f) => path.resolve(f));
if (!files.length) {
  console.error('Usage: node offline/tools/check-edition.mjs [--live] <edition.json> ...');
  process.exit(2);
}

const fetchImpl = live ? memoFetch() : cachedTextFetch(memoFetch());
const verifyOpts = { fetchImpl, timeoutMs: 30000 };
const everything = allEditions().filter((x) => x.edition);
let failed = 0;

for (const file of files) {
  const problems = [];
  const notes = [];
  let e;
  try {
    e = readJson(file);
  } catch (err) {
    console.log(`\n✗ ${path.basename(file)}: not valid JSON (${err.message})`);
    failed++;
    continue;
  }
  const others = everything.filter((x) => path.resolve(x.file) !== file && x.edition.id !== e.id);

  const { errors, warnings } = validateEdition(e);
  problems.push(...errors);
  notes.push(...warnings.map((w) => `warning: ${w}`));

  if (!errors.length) {
    const ledger = others.map((x, i) => ({ id: i, piece_id: x.edition.id, ...x.edition.story }));
    const repeat = await checkRepeat(null, e.story, ledger, { warn() {} });
    if (repeat.repeat) problems.push(`repeat check: ${repeat.reason}`);
    else if (repeat.flags?.length) notes.push(`repeat screen flagged ${repeat.flags.map((f) => `${f.piece_id} (${f.level})`).join(', ')} but let it through`);

    const usedQuotes = others.map((x) => ({ id: x.edition.id, text: x.edition.quote.text }));
    const quoteLedger = usedQuotes.map((q) => ({ norm: normalise(q.text) }));
    const picked = await chooseQuote([e.quote], quoteLedger, verifyOpts);
    if (!picked.quote) problems.push(`quote not verified: ${picked.attempts[0]?.error || 'unknown'} (${e.quote.source_url})`);
    else notes.push(`quote: ${picked.verification.match} match at ${e.quote.source_url}`);
    const clash = quoteClash(e.quote.text, usedQuotes);
    if (clash.length) problems.push(`quote overlaps one already used in ${clash.map((c) => c.id).join(', ')}`);

    const checks = await checkStorySources(e, null, verifyOpts);
    const { kept, confirmed } = usableSources(e, checks);
    const loaded = checks.filter((c) => c.live);
    for (const c of checks) {
      const tag = c.live ? (c.relevant ? 'ok  ' : 'live') : c.blocked ? 'blkd' : 'DEAD';
      notes.push(`source ${tag} ${c.status ?? c.error ?? ''} ${c.url}${c.live && !c.relevant ? ' (does not name founder or company)' : ''}`);
    }
    if (kept.length < 2 || confirmed < 1) problems.push('fewer than two story sources could be opened and confirmed (server rule)');
    if (loaded.length < 2) problems.push(`only ${loaded.length} source(s) actually load (offline rule: at least two live sources)`);

    const w = wordStats(e);
    notes.push(`words: story ${w.story}, quote ${w.quote}, connection ${w.connection}, reflection ${w.reflection}, invitation ${w.invitation}, total ${w.total}`);
    if (mentionsTalqen(e)) notes.push('mentions talQen');
  }

  const ok = problems.length === 0;
  if (!ok) failed++;
  console.log(`\n${ok ? '✓' : '✗'} ${path.basename(file)}${e.title ? ` — ${e.title}` : ''}`);
  for (const p of problems) console.log(`  ERROR ${p}`);
  for (const n of notes) console.log(`  ${n}`);
}
console.log(`\n${files.length - failed} of ${files.length} passed`);
process.exitCode = failed ? 1 : 0;
