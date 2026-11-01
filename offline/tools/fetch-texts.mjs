#!/usr/bin/env node
// Download every edition in texts.mjs into offline/texts/<key>.txt, using the
// verifier's own fetchText so the cached text is what verifyQuote reads.
// Usage: node offline/tools/fetch-texts.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText } from '../../server/research/verify.js';
import { TEXTS } from './texts.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'texts');
const force = process.argv.includes('--force');
fs.mkdirSync(DIR, { recursive: true });

const manifest = [];
for (const t of TEXTS) {
  const file = path.join(DIR, `${t.key}.txt`);
  if (force || !fs.existsSync(file)) {
    try {
      const page = await fetchText(t.source_url, { timeoutMs: 60000 });
      if (!page.ok) { console.log(`FAIL ${page.status} ${t.key}`); continue; }
      fs.writeFileSync(file, page.text);
      console.log(`ok   ${t.key} (${Math.round(page.text.length / 1024)} KB)`);
      if (t.source_url.includes('wikisource')) await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.log(`ERR  ${t.key}: ${err.message}`);
      continue;
    }
  }
  manifest.push({ ...t, file: `offline/texts/${t.key}.txt` });
}
fs.writeFileSync(path.join(DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n${manifest.length} of ${TEXTS.length} texts cached in ${DIR}`);
