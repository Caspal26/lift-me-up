// Morning delivery with retries that cannot double-send.
//
// Each (morning, channel, recipient) gets one row in `deliveries`. A sender
// must claim the row inside a transaction before sending; a second process, a
// job retry or a restart sees the claim and stays away. Failed sends are
// retried with backoff. If the server dies mid-send, the outcome is unknown:
// push is re-sent because the Topic header and notification tag make a repeat
// replace the first rather than appear twice; WhatsApp is not re-sent.
import { clock } from '../clock.js';
import { config } from '../config.js';
import { tx } from '../db.js';
import { getPublished, readingMinutes, wordStats } from '../editions.js';
import { activeSubscriptions, sendPush } from './push.js';
import { sendTemplate, whatsappState } from './whatsapp.js';

const STALE_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const backoffMs = (attempts) => Math.min(60, 2 ** attempts) * 60 * 1000;

export function claimDelivery(db, { date, channel, target, pieceId }) {
  const now = clock.now();
  const iso = now.toISOString();
  return tx(db, () => {
    const row = db.prepare('SELECT * FROM deliveries WHERE local_date = ? AND channel = ? AND target = ?').get(date, channel, target);
    if (!row) {
      db.prepare(`INSERT INTO deliveries (local_date, channel, target, piece_id, status, attempts, claimed_at)
                  VALUES (?, ?, ?, ?, 'sending', 1, ?)`).run(date, channel, target, pieceId, iso);
      return { claimed: true, attempt: 1 };
    }
    if (row.status === 'sent' || row.status === 'abandoned') return { claimed: false, reason: `already ${row.status}` };

    const age = now.getTime() - new Date(row.claimed_at).getTime();
    if (row.status === 'failed') {
      if (row.attempts >= MAX_ATTEMPTS) {
        db.prepare("UPDATE deliveries SET status = 'abandoned' WHERE id = ?").run(row.id);
        return { claimed: false, reason: 'gave up after repeated failures' };
      }
      if (age < backoffMs(row.attempts)) return { claimed: false, reason: 'waiting to retry' };
    } else if (row.status === 'sending') {
      if (age < STALE_MS) return { claimed: false, reason: 'another send is in progress' };
      if (channel !== 'push') {
        db.prepare("UPDATE deliveries SET status = 'abandoned', last_error = ? WHERE id = ?")
          .run('interrupted mid-send; not resent so the message cannot arrive twice', row.id);
        return { claimed: false, reason: 'interrupted earlier; not resent' };
      }
    }
    const r = db.prepare(`UPDATE deliveries SET status = 'sending', attempts = attempts + 1, claimed_at = ?
                          WHERE id = ? AND status = ? AND attempts = ?`).run(iso, row.id, row.status, row.attempts);
    return r.changes === 1 ? { claimed: true, attempt: row.attempts + 1 } : { claimed: false, reason: 'claimed elsewhere' };
  });
}

function recordResult(db, { date, channel, target }, result) {
  const iso = clock.now().toISOString();
  if (result.ok) {
    db.prepare("UPDATE deliveries SET status = 'sent', sent_at = ?, last_error = NULL WHERE local_date = ? AND channel = ? AND target = ?")
      .run(iso, date, channel, target);
  } else {
    db.prepare('UPDATE deliveries SET status = ?, last_error = ? WHERE local_date = ? AND channel = ? AND target = ?')
      .run(result.permanent ? 'abandoned' : 'failed', String(result.error || 'unknown error').slice(0, 500), date, channel, target);
  }
}

export function editionLink(date) {
  return `${config.publicUrl}/e/${date}`;
}

export function pushPayload(piece, date) {
  const body = JSON.parse(piece.body);
  const minutes = readingMinutes(wordStats(body).total);
  return {
    type: 'edition',
    date,
    title: body.title,
    body: `${minutes}-minute read · ${body.story.founder}`,
    url: `/e/${date}`,
    tag: `edition-${date}`,
  };
}

export async function deliverForDate(db, date, { sendPushImpl = sendPush, sendWhatsAppImpl = sendTemplate, readerName = config.readerName } = {}) {
  const piece = getPublished(db, date);
  if (!piece) return { date, skipped: 'no edition published', results: [] };

  const payload = pushPayload(piece, date);
  const jobs = activeSubscriptions(db).map((sub) => ({
    channel: 'push',
    target: `sub:${sub.id}`,
    send: () => sendPushImpl(db, sub, payload, { topic: `ed-${date}` }),
  }));

  const wa = whatsappState(db);
  if (wa.available && wa.optedIn) {
    jobs.push({
      channel: 'whatsapp',
      target: wa.phone,
      send: () => sendWhatsAppImpl({ to: wa.phone, values: { name: readerName, title: payload.title, url: editionLink(date), date } }),
    });
  }

  const results = [];
  for (const job of jobs) {
    const key = { date, channel: job.channel, target: job.target };
    const claim = claimDelivery(db, { ...key, pieceId: piece.id });
    if (!claim.claimed) {
      results.push({ ...key, sent: false, skipped: claim.reason });
      continue;
    }
    const result = await job.send();
    recordResult(db, key, result);
    results.push({ ...key, sent: Boolean(result.ok), attempt: claim.attempt, error: result.ok ? undefined : result.error });
  }
  return { date, pieceId: piece.id, title: payload.title, results };
}

export async function sendTestPush(db, { sendPushImpl = sendPush } = {}) {
  const payload = { type: 'test', title: 'Lift Me Up is connected', body: 'Your morning reading will arrive here.', url: '/', tag: 'test' };
  const subs = activeSubscriptions(db);
  const results = [];
  for (const sub of subs) results.push({ id: sub.id, ...(await sendPushImpl(db, sub, payload, { topic: 'test', ttlSeconds: 600 })) });
  return results;
}
