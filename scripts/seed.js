#!/usr/bin/env node
// Import researched editions from seed/editions (or a given folder) into the
// reserve. Each passes validation, the repeat check, live quote verification
// and source checks first. Usage: npm run seed [-- path/to/folder]
import path from 'node:path';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { countReserve } from '../server/editions.js';
import { importEditions, readSeedFiles, SEED_DIR } from '../server/seed.js';

const dir = process.argv[2] ? path.resolve(process.argv[2]) : SEED_DIR;
const db = openDb(path.join(config.dataDir, 'lift-me-up.db'));
const results = await importEditions(db, readSeedFiles(dir));
for (const r of results) {
  console.log(`${r.status.padEnd(8)} ${r.file}${r.reason ? ` — ${r.reason}` : ''}`);
  for (const w of r.warnings || []) console.log(`         warning: ${w}`);
}
console.log(`\nReserve now holds ${countReserve(db)} edition(s).`);
db.close();
