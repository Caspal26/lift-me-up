// Load hand-researched editions from seed/editions into the reserve. They pass
// the same gates as a live run: validation, repeat check, quote verification
// against the edition, and source checks.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { getPiece, storePiece, validateEdition } from './editions.js';
import { checkRepeat, checkStorySources, chooseQuote, usableSources } from './research/pipeline.js';

export const SEED_DIR = path.join(ROOT, 'seed', 'editions');

export function readSeedFiles(dir = SEED_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: f, edition: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

export async function importEditions(db, items, { origin = 'seed', verify = true, verifyOpts = {}, log = console } = {}) {
  const results = [];
  for (const { file, edition } of items) {
    const name = file || edition?.id;
    if (edition?.id && getPiece(db, edition.id)) {
      results.push({ file: name, id: edition.id, status: 'skipped', reason: 'already imported' });
      continue;
    }
    const { errors, warnings } = validateEdition(edition);
    if (errors.length) {
      results.push({ file: name, status: 'rejected', reason: errors.join('; ') });
      continue;
    }
    const ledger = db.prepare('SELECT * FROM story_ledger ORDER BY id').all();
    const repeat = await checkRepeat(null, edition.story, ledger, log);
    if (repeat.repeat) {
      results.push({ file: name, status: 'rejected', reason: `repeat: ${repeat.reason}` });
      continue;
    }
    let quoteCheck = { verified: null, match: 'not checked' };
    let sources = [];
    let stored = edition;
    if (verify) {
      const quoteLedger = db.prepare('SELECT * FROM quote_ledger').all();
      const picked = await chooseQuote([edition.quote], quoteLedger, verifyOpts);
      if (!picked.quote) {
        results.push({ file: name, status: 'rejected', reason: `quote not verified: ${picked.attempts[0]?.error || 'unknown'}` });
        continue;
      }
      quoteCheck = picked.verification;
      sources = await checkStorySources(edition, null, verifyOpts);
      const { kept, confirmed } = usableSources(edition, sources);
      if (kept.length < 2 || confirmed < 1) {
        results.push({ file: name, status: 'rejected', reason: 'fewer than two story sources could be opened and confirmed' });
        continue;
      }
      stored = { ...edition, sources: kept };
    }
    const id = storePiece(db, stored, {
      origin, status: 'reserve',
      verification: { quote: quoteCheck, sources, repeat, warnings, researcher: 'manual research' },
    });
    results.push({ file: name, id, status: 'imported', warnings, quote: quoteCheck.match, sources: sources.map((s) => `${s.status ?? 'ERR'} ${s.url}`) });
  }
  return results;
}
