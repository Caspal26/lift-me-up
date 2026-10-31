import webpush from 'web-push';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';

// VAPID keys identify this server to the browser's push service. Taken from
// the environment when set, otherwise generated once and kept in the database
// (keys must stay stable, or existing subscriptions stop working).
export function vapidKeys(db) {
  if (config.vapid.publicKey && config.vapid.privateKey) {
    return { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey };
  }
  let keys = getSetting(db, 'vapid_keys');
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    setSetting(db, 'vapid_keys', keys);
  }
  return keys;
}

function endpointAllowed(endpoint) {
  try {
    const u = new URL(endpoint);
    if (u.protocol === 'https:') return true;
    // Plain HTTP only for a local stand-in push service during simulation.
    return process.env.ALLOW_INSECURE_PUSH_ENDPOINTS === '1' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

export function saveSubscription(db, sub, userAgent = null) {
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpointAllowed(endpoint) || !p256dh || !auth) return null;
  db.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
                user_agent = excluded.user_agent, disabled_at = NULL, failures = 0`)
    .run(endpoint, p256dh, auth, userAgent ? String(userAgent).slice(0, 200) : null, clock.now().toISOString());
  return db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(endpoint);
}

export function removeSubscription(db, endpoint) {
  return db.prepare('UPDATE push_subscriptions SET disabled_at = ? WHERE endpoint = ? AND disabled_at IS NULL')
    .run(clock.now().toISOString(), endpoint).changes > 0;
}

export function activeSubscriptions(db) {
  return db.prepare('SELECT * FROM push_subscriptions WHERE disabled_at IS NULL ORDER BY id').all();
}

// Sends one encrypted Web Push message. `topic` lets the push service replace
// an undelivered message with the same topic instead of queueing a second.
export async function sendPush(db, sub, payload, { topic, ttlSeconds = 20 * 3600, urgency = 'normal', fetchImpl = fetch } = {}) {
  const keys = vapidKeys(db);
  let details;
  try {
    details = webpush.generateRequestDetails(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: ttlSeconds, topic, urgency, vapidDetails: { subject: config.vapid.subject, publicKey: keys.publicKey, privateKey: keys.privateKey } },
    );
  } catch (err) {
    return { ok: false, permanent: true, error: `could not encrypt for this subscription: ${err.message}` };
  }
  const headers = { ...details.headers };
  delete headers['Content-Length'];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetchImpl(details.endpoint, { method: details.method, headers, body: details.body, signal: ctrl.signal });
    const text = await res.text().catch(() => '');
    if (res.ok) {
      db.prepare('UPDATE push_subscriptions SET last_success_at = ?, failures = 0 WHERE id = ?').run(clock.now().toISOString(), sub.id);
      return { ok: true, status: res.status };
    }
    if (res.status === 404 || res.status === 410) {
      db.prepare('UPDATE push_subscriptions SET disabled_at = ? WHERE id = ?').run(clock.now().toISOString(), sub.id);
      return { ok: false, permanent: true, status: res.status, error: 'subscription has expired' };
    }
    db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(sub.id);
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 408;
    return { ok: false, permanent, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}` };
  } catch (err) {
    db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(sub.id);
    return { ok: false, permanent: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}
