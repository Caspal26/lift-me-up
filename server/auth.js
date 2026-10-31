// A private app for one reader: a passcode, then a long-lived signed cookie.
// Changing APP_PASSCODE signs every device out.
import crypto from 'node:crypto';
import { config } from './config.js';
import { getSetting, setSetting } from './db.js';

const COOKIE = 'lmu_session';
const MAX_AGE_MS = 365 * 24 * 3600 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 8;

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createAuth(db) {
  let secret = config.sessionSecret || getSetting(db, 'session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting(db, 'session_secret', secret);
  }
  const open = !config.passcode && config.allowNoPasscode;
  const passcodeTag = crypto.createHash('sha256').update(config.passcode).digest('hex').slice(0, 16);
  const sign = (issued) => crypto.createHmac('sha256', secret).update(`${issued}:${passcodeTag}`).digest('base64url');
  const tries = new Map();

  const valid = (req) => {
    if (open) return true;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return false;
    const [issued, mac] = token.split('.');
    if (!issued || !mac || !same(mac, sign(issued))) return false;
    return Date.now() - Number.parseInt(issued, 36) < MAX_AGE_MS;
  };

  return {
    open,
    valid,

    // Returns 'ok', 'wrong' or 'locked'.
    attempt(req, passcode) {
      const ip = req.ip || 'unknown';
      const now = Date.now();
      const recent = (tries.get(ip) || []).filter((t) => now - t < WINDOW_MS);
      if (recent.length >= MAX_TRIES) return 'locked';
      if (!open && config.passcode && same(crypto.createHash('sha256').update(String(passcode || '')).digest('hex'),
        crypto.createHash('sha256').update(config.passcode).digest('hex'))) {
        tries.delete(ip);
        return 'ok';
      }
      tries.set(ip, [...recent, now]);
      return open ? 'ok' : 'wrong';
    },

    issue(res) {
      const issued = Date.now().toString(36);
      res.cookie(COOKIE, `${issued}.${sign(issued)}`, {
        httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: MAX_AGE_MS, path: '/',
      });
    },

    clear(res) {
      res.clearCookie(COOKIE, { path: '/' });
    },

    requireAuth(req, res, next) {
      if (valid(req)) return next();
      res.status(401).json({ error: 'Sign in with your passcode.' });
    },
  };
}
