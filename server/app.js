import path from 'node:path';
import express from 'express';
import { clock } from './clock.js';
import { config, ROOT, whatsappConfigured } from './config.js';
import { getSetting, setSetting } from './db.js';
import { editionLink, sendTestPush } from './delivery/deliver.js';
import { activeSubscriptions, removeSubscription, saveSubscription, vapidKeys } from './delivery/push.js';
import { handleWebhook, maskPhone, optIn, optOut, sendTemplate, verifyWebhookSignature, whatsappState } from './delivery/whatsapp.js';
import {
  countReserve, getPublished, latestPublishedBefore, listFavourites, listPublished, setFavourite, toPublic, toSummary,
} from './editions.js';
import { encourage, recentEncouragements } from './encourage.js';
import { lastJob } from './jobs.js';
import { morningSchedule, nextDeliveryAt } from './scheduler.js';
import { isValidDate, isValidTime, isValidTimeZone, localDate } from './time.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const APP_ROUTES = ['/', '/e/:date', '/archive', '/saved', '/settings', '/encourage', '/login'];

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

const noStore = (req, res, next) => {
  res.set('Cache-Control', 'private, no-cache');
  next();
};

export function createApp({ db, scheduler, researcher = null, auth, log = console, deliverOpts = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use('/api/whatsapp/webhook', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', noStore);

  // ---- Open endpoints -------------------------------------------------

  app.get('/healthz', (req, res) => res.json({ ok: true, now: clock.now().toISOString() }));

  app.get('/api/session', (req, res) => {
    res.json({ authenticated: auth.valid(req), passcodeRequired: !auth.open });
  });

  app.post('/api/login', (req, res) => {
    const outcome = auth.attempt(req, req.body?.passcode);
    if (outcome === 'locked') return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    if (outcome !== 'ok') return res.status(401).json({ error: 'That passcode is not right.' });
    auth.issue(res);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    auth.clear(res);
    res.json({ ok: true });
  });

  // External schedulers (for hosts that sleep idle apps) can drive the
  // morning through this endpoint; it is safe to call as often as you like.
  app.post('/api/cron/tick', async (req, res) => {
    if (!config.cronSecret || req.get('x-cron-secret') !== config.cronSecret) return res.status(403).json({ error: 'forbidden' });
    res.json(await scheduler.tick());
  });

  app.get('/api/whatsapp/webhook', (req, res) => {
    const ok = config.whatsapp.verifyToken && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.whatsapp.verifyToken;
    if (!ok) return res.sendStatus(403);
    res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  });

  app.post('/api/whatsapp/webhook', (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!verifyWebhookSignature(raw, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    try {
      handleWebhook(db, JSON.parse(raw.toString('utf8')));
    } catch (err) {
      log.warn?.(`[whatsapp] webhook payload ignored: ${err.message}`);
    }
    res.sendStatus(200);
  });

  // ---- Everything below needs the passcode ------------------------------

  app.use('/api', auth.requireAuth);

  app.get('/api/today', (req, res) => {
    const s = morningSchedule(db);
    const piece = getPublished(db, s.today);
    const previous = piece ? null : latestPublishedBefore(db, s.today);
    res.json({
      today: s.today,
      timezone: s.tz,
      deliveryTime: s.time,
      deliverAt: s.deliverAt.toISOString(),
      edition: toPublic(piece),
      previous: toPublic(previous),
    });
  });

  app.get('/api/editions/:date', (req, res) => {
    if (!isValidDate(req.params.date)) return res.status(400).json({ error: 'Use a date like 2026-11-02.' });
    const piece = getPublished(db, req.params.date);
    if (!piece) return res.status(404).json({ error: 'There is no reading for that day.' });
    res.json(toPublic(piece));
  });

  app.get('/api/archive', (req, res) => res.json(listPublished(db).map(toSummary)));

  app.get('/api/favourites', (req, res) => {
    res.json(listFavourites(db).map((row) => ({ ...toSummary(row), saved_at: row.saved_at })));
  });

  app.put('/api/favourites/:date', (req, res) => {
    const piece = isValidDate(req.params.date) && setFavourite(db, req.params.date, true);
    if (!piece) return res.status(404).json({ error: 'There is no reading for that day.' });
    res.json({ saved: true });
  });

  app.delete('/api/favourites/:date', (req, res) => {
    const piece = isValidDate(req.params.date) && setFavourite(db, req.params.date, false);
    if (!piece) return res.status(404).json({ error: 'There is no reading for that day.' });
    res.json({ saved: false });
  });

  app.post('/api/encourage', async (req, res) => {
    res.json(await encourage(db, { researcher, note: req.body?.note, log }));
  });

  app.get('/api/encouragements', (req, res) => res.json(recentEncouragements(db, 10)));

  app.get('/api/settings', (req, res) => {
    const s = morningSchedule(db);
    const wa = whatsappState(db);
    const research = lastJob(db, 'research');
    res.json({
      readerName: config.readerName,
      timezone: s.tz,
      deliveryTime: s.time,
      nextDeliveryAt: nextDeliveryAt(db).toISOString(),
      push: { publicKey: vapidKeys(db).publicKey, devices: activeSubscriptions(db).length },
      whatsapp: { available: wa.available, optedIn: wa.optedIn, phone: maskPhone(wa.phone), consentedAt: wa.consentedAt },
      research: {
        configured: Boolean(researcher),
        reserve: countReserve(db),
        lastRun: research ? { at: research.started_at, outcome: research.outcome, forDate: research.local_date } : null,
      },
    });
  });

  app.put('/api/settings', (req, res) => {
    const { timezone, deliveryTime } = req.body || {};
    if (timezone !== undefined) {
      if (!isValidTimeZone(timezone)) return res.status(400).json({ error: 'Unknown time zone.' });
      setSetting(db, 'timezone', timezone);
    }
    if (deliveryTime !== undefined) {
      if (!isValidTime(deliveryTime)) return res.status(400).json({ error: 'Use a time like 08:00.' });
      setSetting(db, 'delivery_time', deliveryTime);
    }
    const s = morningSchedule(db);
    res.json({ timezone: s.tz, deliveryTime: s.time, nextDeliveryAt: nextDeliveryAt(db).toISOString() });
  });

  app.get('/api/push/key', (req, res) => res.json({ publicKey: vapidKeys(db).publicKey }));

  app.post('/api/push/subscribe', (req, res) => {
    const sub = saveSubscription(db, req.body?.subscription, req.get('user-agent'));
    if (!sub) return res.status(400).json({ error: 'That push subscription is not valid.' });
    res.json({ ok: true, devices: activeSubscriptions(db).length });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    removeSubscription(db, req.body?.endpoint);
    res.json({ ok: true, devices: activeSubscriptions(db).length });
  });

  app.post('/api/push/test', async (req, res) => {
    const results = await sendTestPush(db, deliverOpts);
    res.json({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
  });

  app.post('/api/whatsapp/optin', (req, res) => {
    if (!whatsappConfigured()) return res.status(409).json({ error: 'WhatsApp is not configured on the server.' });
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Please confirm that you want to receive WhatsApp messages.' });
    const phone = optIn(db, req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'Enter the number in international format, e.g. +254 712 345 678.' });
    res.json({ optedIn: true, phone: maskPhone(phone) });
  });

  app.post('/api/whatsapp/optout', (req, res) => {
    optOut(db, 'settings');
    res.json({ optedIn: false });
  });

  app.post('/api/whatsapp/test', async (req, res) => {
    const wa = whatsappState(db);
    if (!wa.available || !wa.optedIn) return res.status(409).json({ error: 'Opt in to WhatsApp first.' });
    const tz = getSetting(db, 'timezone', config.defaultTimezone);
    const today = localDate(clock.now(), tz);
    const piece = getPublished(db, today) || latestPublishedBefore(db, today);
    const date = piece?.published_date || today;
    const send = deliverOpts.sendWhatsAppImpl || sendTemplate;
    const r = await send({ to: wa.phone, values: { name: config.readerName, title: piece?.title || 'Lift Me Up is connected', url: editionLink(date), date } });
    if (!r.ok) return res.status(502).json({ error: r.error });
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---- The app itself ------------------------------------------------------

  app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders(res, file) {
      // The service worker and manifest must update promptly.
      if (/(sw\.js|manifest\.webmanifest)$/.test(file)) res.set('Cache-Control', 'no-cache');
    },
  }));

  app.get(APP_ROUTES, (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

  app.use((err, req, res, next) => {
    log.error?.(`[http] ${req.method} ${req.path}: ${err.stack || err}`);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
