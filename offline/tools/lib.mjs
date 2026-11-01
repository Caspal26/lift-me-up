// Shared helpers for the offline edition tools. The checks themselves are the
// server's own (validateEdition, verifyQuote, checkSource, checkRepeat); this
// file only finds the files and serves cached texts to the quote verifier.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalise, wordsOnly } from '../../server/research/verify.js';
import { byUrl } from './texts.mjs';

export const OFFLINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(OFFLINE, '..');
export const EDITIONS_DIR = path.join(OFFLINE, 'editions');
export const SEED_DIR = path.join(ROOT, 'seed', 'editions');
export const TEXTS_DIR = path.join(OFFLINE, 'texts');
export const WORK = path.join(OFFLINE, 'work');

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function editionFiles(dir = EDITIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f));
}

// Every finished edition: the six seeds, then the researched ones.
export function allEditions() {
  return [...editionFiles(SEED_DIR), ...editionFiles()].map((file) => {
    try {
      return { file, edition: readJson(file) };
    } catch (err) {
      return { file, error: err.message };
    }
  });
}

// A fetch that answers from offline/texts for known editions (the cache holds
// fetchText's own output) and goes to the network for everything else.
export function cachedTextFetch(liveFetch = fetch) {
  return async (url, init) => {
    const t = byUrl.get(url);
    const file = t && path.join(TEXTS_DIR, `${t.key}.txt`);
    if (file && fs.existsSync(file)) {
      return new Response(fs.readFileSync(file, 'utf8'), { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return liveFetch(url, init);
  };
}

// The same URL is fetched once per run (live), so 350 quotes from a few dozen
// editions do not hammer Gutenberg.
export function memoFetch(liveFetch = fetch) {
  const seen = new Map();
  return async (url, init) => {
    if (!seen.has(url)) {
      seen.set(url, (async () => {
        const res = await liveFetch(url, init);
        const body = await res.arrayBuffer();
        return { status: res.status, headers: [...res.headers], body, url: res.url };
      })().catch((err) => { seen.delete(url); throw err; }));
    }
    const r = await seen.get(url);
    const res = new Response(r.body.slice(0), { status: r.status, headers: r.headers });
    Object.defineProperty(res, 'url', { value: r.url || url });
    return res;
  };
}

// "No quote repeated": the same words, or one quote contained in another.
// A shared run of eight words means the same passage cut differently.
function shingles(s, n = 8) {
  const w = s.split(' ');
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

export function quoteClash(text, others) {
  const a = wordsOnly(text);
  const aSh = shingles(a);
  return others.filter((o) => {
    const b = wordsOnly(o.text);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;
    for (const s of aSh) if (b.includes(s)) return true;
    return false;
  });
}

export function mentionsTalqen(e) {
  const text = [e.title, e.dek, ...(e.story?.paragraphs || []), e.quote?.connection, ...(e.reflection || []), e.invitation].join(' ');
  return /talqen/i.test(text);
}

export { normalise, wordsOnly };
