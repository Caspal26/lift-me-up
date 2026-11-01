#!/usr/bin/env node
// Development only: serve www/ the way Capacitor does (unknown paths get
// index.html), so the views can be checked in a desktop browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WWW = path.join(path.dirname(fileURLToPath(import.meta.url)), 'www');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8091;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(WWW, p);
  if (!file.startsWith(WWW) || !path.extname(p) || !fs.existsSync(file)) file = path.join(WWW, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`offline app on http://localhost:${port}`));
