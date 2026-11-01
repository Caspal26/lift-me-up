#!/usr/bin/env node
// Check candidate story sources with the server's checkSource before writing
// an edition: does each load for the verifier, and does it name the founder
// or company? Usage:
//   node offline/tools/check-sources.mjs "Founder Name" "Company" <url> [<url> ...]
import { checkSource } from '../../server/research/verify.js';

const [founder, company, ...urls] = process.argv.slice(2);
if (!founder || !urls.length) {
  console.error('Usage: node offline/tools/check-sources.mjs "Founder" "Company" <url> ...');
  process.exit(2);
}
const results = await Promise.all(urls.map((u) => checkSource(u, [founder, company], { timeoutMs: 30000 })));
for (const r of results) {
  const tag = r.live ? (r.relevant ? 'OK     ' : 'NO-NAME') : r.blocked ? 'BLOCKED' : 'DEAD   ';
  console.log(`${tag} ${String(r.status ?? r.error ?? '').padEnd(4)} ${r.url}${r.mentions?.length ? `  [names: ${r.mentions.join(', ')}]` : ''}`);
}
console.log('\nOK = loads and names the founder or company. BLOCKED pages (401/403/429) are kept by the server but do not count as live here; DEAD pages are dropped.');
