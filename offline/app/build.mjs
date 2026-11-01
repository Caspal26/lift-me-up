#!/usr/bin/env node
// Assemble the app's web assets in www/ from the PWA (public/) and the
// offline sources (src/), plus the ordered, verified editions bundle written
// by offline/tools/order.mjs. Usage: node offline/app/build.mjs [--dev]
// --dev builds from the seed editions alone when no bundle exists yet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(APP, '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const WWW = path.join(APP, 'www');
const BUNDLE = path.join(ROOT, 'offline', 'work', 'bundle.json');

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(path.join(WWW, 'icons'), { recursive: true });

// The PWA's page, without the service worker, manifest or install prompts:
// the Capacitor shell serves everything from the APK.
let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
html = html
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace('<script type="module" src="/app.js"></script>', '<script src="/capacitor.js"></script>\n  <script type="module" src="/app.js"></script>');
fs.writeFileSync(path.join(WWW, 'index.html'), html);

fs.copyFileSync(path.join(PUBLIC, 'styles.css'), path.join(WWW, 'styles.css'));
fs.copyFileSync(path.join(PUBLIC, 'icons', 'icon-192.png'), path.join(WWW, 'icons', 'icon-192.png'));
fs.copyFileSync(path.join(APP, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js'), path.join(WWW, 'capacitor.js'));
for (const f of fs.readdirSync(path.join(APP, 'src'))) fs.copyFileSync(path.join(APP, 'src', f), path.join(WWW, f));

let bundle;
if (fs.existsSync(BUNDLE)) {
  bundle = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
} else if (process.argv.includes('--dev')) {
  const { wordStats, readingMinutes } = await import('../../server/editions.js');
  const dir = path.join(ROOT, 'seed', 'editions');
  const editions = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map((e) => ({ ...e, minutes: readingMinutes(wordStats(e).total), verification: { quote: null } }));
  bundle = { version: 'dev-seeds', built_at: new Date().toISOString(), editions };
  console.log('No bundle yet: built a development bundle from the six seeds (quotes not re-verified).');
} else {
  console.error(`Missing ${BUNDLE}. Run node offline/tools/order.mjs first, or pass --dev.`);
  process.exit(1);
}
fs.writeFileSync(path.join(WWW, 'editions.json'), JSON.stringify(bundle));
console.log(`www/ built with ${bundle.editions.length} editions (bundle ${bundle.version}).`);
