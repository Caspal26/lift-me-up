#!/usr/bin/env node
// Run one research job now and add the result to the reserve. Useful to check
// that the Claude connection works before relying on the morning schedule.
// Usage: npm run research
import path from 'node:path';
import { config, researchConfigured } from '../server/config.js';
import { openDb } from '../server/db.js';
import { countReserve, getPiece, toPublic } from '../server/editions.js';
import { researchEdition } from '../server/research/pipeline.js';
import { createClaudeResearcher } from '../server/research/researcher.js';

if (!researchConfigured()) {
  console.error('Set ANTHROPIC_API_KEY first (see README → Connect research).');
  process.exitCode = 1;
} else {
  const db = openDb(path.join(config.dataDir, 'lift-me-up.db'));
  console.log(`Researching with ${config.claude.model}. This usually takes several minutes…`);
  const result = await researchEdition(db, { researcher: createClaudeResearcher() });
  if (result.ok) {
    const e = toPublic(getPiece(db, result.id));
    console.log(`\nStored in the reserve: ${e.title}`);
    console.log(`  ${e.story.founder} — ${e.story.event} (${e.story.approx_date})`);
    console.log(`  Quote: "${e.quote.text}" — ${e.quote.thinker}, ${e.quote.work}`);
    for (const w of result.warnings) console.log(`  warning: ${w}`);
    console.log(`Reserve now holds ${countReserve(db)} edition(s).`);
  } else {
    console.error(`Research failed: ${result.error.code}: ${result.error.message}`);
    process.exitCode = 1;
  }
  db.close();
}
