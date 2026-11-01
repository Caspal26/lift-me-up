#!/usr/bin/env node
// Editor's check for repeats the rules-based screen can miss when a
// researcher rewords a founder or company field: list every pair of editions
// that share a surname or a distinctive company word, so a person can confirm
// each pair is a different person or a different episode.
// Usage: node offline/tools/review-repeats.mjs
import { allEditions } from './lib.mjs';

const STOP = new Set(('with later company group limited holdings corporation foundation international brothers founders cofounders cofounder others friends medical school their from foods food bank health hospital institute laboratories laboratory network school university society trust works fund africa african kenya india china japan united states new national first industries products partners movement mission academy solar founded proposed').split(' '));
const plain = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const words = (s) => new Set(plain(s).split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP.has(w)));

// Surnames: the last word of each name in the founder field, after dropping
// bracketed asides and phrases such as "who started it".
const surnames = (founder) => new Set(String(founder)
  .replace(/\([^)]*\)/g, ' ')
  .split(/,|;|&|\band\b|\bwith\b/i)
  .map((n) => n.replace(/\b(who|early|later|first|his|her)\b.*$/i, '').trim().split(/\s+/).pop() || '')
  .map((w) => plain(w).replace(/[^a-z]/g, ''))
  .filter((w) => w.length >= 3 && !STOP.has(w)));

// Company words, ignoring "later X" / "founded as X" asides.
const companyWords = (company) => words(String(company).replace(/\b(later|founded as|first proposed as)\b[^)]*/gi, ''));

const list = allEditions().filter((x) => x.edition).map(({ edition: e }) => ({
  year: String(e.story.approx_date).slice(0, 4), founder: e.story.founder, company: e.story.company, event: e.story.event,
  names: new Set([...surnames(e.story.founder), ...companyWords(e.story.company)]),
}));

let pairs = 0;
for (let i = 0; i < list.length; i++) {
  for (let j = i + 1; j < list.length; j++) {
    const shared = [...list[i].names].filter((w) => list[j].names.has(w));
    if (!shared.length) continue;
    pairs++;
    console.log(`[${shared.join(', ')}]`);
    for (const x of [list[i], list[j]]) console.log(`   ${x.year} ${x.founder} | ${x.company} | ${x.event}`);
  }
}
console.log(`\n${pairs} pair(s) share a surname or company word; confirm each is a different person or a different episode.`);
