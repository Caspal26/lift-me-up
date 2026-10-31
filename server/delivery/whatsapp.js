// Optional delivery through the official WhatsApp Business Platform (Cloud
// API). Business-initiated messages must use a pre-approved template, and the
// recipient must have opted in — both are enforced here.
import crypto from 'node:crypto';
import { clock } from '../clock.js';
import { config, whatsappConfigured } from '../config.js';
import { getSetting, setSetting } from '../db.js';

export function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export function whatsappState(db) {
  const s = getSetting(db, 'whatsapp', null);
  return {
    available: whatsappConfigured(),
    optedIn: Boolean(s?.phone && s?.consented_at && !s?.opted_out_at),
    phone: s?.phone || null,
    consentedAt: s?.consented_at || null,
    optedOutAt: s?.opted_out_at || null,
  };
}

export function maskPhone(phone) {
  return phone ? `${phone.slice(0, 4)} ••• ${phone.slice(-3)}` : null;
}

export function optIn(db, phone) {
  const e164 = normalisePhone(phone);
  if (!e164) return null;
  setSetting(db, 'whatsapp', { phone: e164, consented_at: clock.now().toISOString(), opted_out_at: null });
  return e164;
}

export function optOut(db, reason = 'settings') {
  const s = getSetting(db, 'whatsapp', null);
  if (!s) return;
  setSetting(db, 'whatsapp', { ...s, opted_out_at: clock.now().toISOString(), opt_out_reason: reason });
}

export async function sendTemplate({ to, values, fetchImpl = fetch }) {
  const w = config.whatsapp;
  const url = `${w.apiBase}/${w.graphVersion}/${w.phoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: w.templateName,
      language: { code: w.templateLang },
      components: [{
        type: 'body',
        // Template variables may not contain line breaks or tabs.
        parameters: w.templateParams.map((key) => ({ type: 'text', text: String(values[key] ?? '').replace(/\s+/g, ' ').trim() })),
      }],
    },
  };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, status: res.status, messageId: json?.messages?.[0]?.id || null };
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    return { ok: false, permanent, status: res.status, error: json?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, permanent: false, error: String(err?.message || err) };
  }
}

export function verifyWebhookSignature(rawBody, header) {
  if (!config.whatsapp.appSecret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(String(header || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Honour "STOP" replies from the opted-in number.
export function handleWebhook(db, payload) {
  const state = whatsappState(db);
  if (!state.phone) return 0;
  let stops = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const msg of change?.value?.messages || []) {
        const from = normalisePhone(msg?.from);
        const text = String(msg?.text?.body || '').trim().toUpperCase();
        if (from === state.phone && ['STOP', 'UNSUBSCRIBE', 'STOP ALL'].includes(text)) {
          optOut(db, 'whatsapp-stop');
          stops++;
        }
      }
    }
  }
  return stops;
}
