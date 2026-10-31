import path from 'node:path';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { config, researchConfigured, whatsappConfigured } from './config.js';
import { openDb } from './db.js';
import { vapidKeys } from './delivery/push.js';
import { countReserve } from './editions.js';
import { createClaudeResearcher } from './research/researcher.js';
import { createScheduler } from './scheduler.js';
import { importEditions, readSeedFiles } from './seed.js';

if (!config.passcode && !config.allowNoPasscode) {
  console.error('Set APP_PASSCODE (or ALLOW_NO_PASSCODE=1 for a local trial) before starting Lift Me Up.');
  process.exit(1);
}

const db = openDb(path.join(config.dataDir, 'lift-me-up.db'));

// First run: fill the reserve from the hand-researched editions.
if (db.prepare('SELECT COUNT(*) AS n FROM pieces').get().n === 0) {
  const results = await importEditions(db, readSeedFiles(), { verify: process.env.SEED_VERIFY !== '0' });
  for (const r of results) console.log(`[seed] ${r.status} ${r.file}${r.reason ? ` — ${r.reason}` : ''}`);
}

vapidKeys(db);
const researcher = researchConfigured() ? createClaudeResearcher() : null;
const auth = createAuth(db);
const scheduler = createScheduler({ db, researcher });
const app = createApp({ db, scheduler, researcher, auth });

const server = app.listen(config.port, () => {
  console.log(`Lift Me Up listening on http://localhost:${config.port}`);
  console.log(`  research: ${researcher ? `Claude (${config.claude.model})` : 'not configured — using the reserve'}; reserve: ${countReserve(db)}`);
  console.log(`  WhatsApp: ${whatsappConfigured() ? 'configured' : 'off'}; passcode: ${auth.open ? 'off' : 'on'}`);
  scheduler.start();
});

function shutdown() {
  scheduler.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
