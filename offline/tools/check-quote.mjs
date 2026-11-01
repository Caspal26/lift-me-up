#!/usr/bin/env node
// Check a quote before using it: verifyQuote against the edition (cached copy
// for texts in offline/texts), and whether it overlaps a quote already used
// in any finished edition. Prints the citation fields to copy into the JSON.
// Usage: node offline/tools/check-quote.mjs <text-key | source-url> "<exact quote>"
import { verifyQuote } from '../../server/research/verify.js';
import { allEditions, cachedTextFetch, quoteClash } from './lib.mjs';
import { byKey } from './texts.mjs';

const [ref, ...rest] = process.argv.slice(2);
const text = rest.join(' ');
if (!ref || !text) {
  console.error('Usage: node offline/tools/check-quote.mjs <text-key | source-url> "<exact quote>"');
  process.exit(2);
}
const t = byKey.get(ref);
const url = t ? t.source_url : ref;
const result = await verifyQuote(text, url, { fetchImpl: cachedTextFetch() });
const used = allEditions().filter((x) => x.edition).map((x) => ({ id: x.edition.id, text: x.edition.quote.text }));
const clash = quoteClash(text, used);
const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

console.log(`verified: ${result.verified} (${result.match})${result.error ? ` — ${result.error}` : ''}`);
console.log(`words: ${words}${words > 60 ? '  (over the 60-word limit)' : ''}`);
console.log(clash.length ? `ALREADY USED (overlaps): ${clash.map((c) => c.id).join(', ')}` : 'not used in any edition yet');
if (/\.\.\.|…/.test(text)) console.log('CONTAINS AN ELLIPSIS — not allowed');
if (t) {
  console.log('\nCitation fields:');
  console.log(JSON.stringify({ thinker: t.thinker, work: t.work, locator: t.locator || '<fill in book/chapter/section>', translator: t.translator, tradition: t.tradition, source_url: t.source_url, source_title: t.source_title }, null, 2));
}
process.exitCode = result.verified && !clash.length && words <= 60 ? 0 : 1;
