// Lift Me Up offline: everything the PWA asked the server for (/api/*) is
// answered here, on the phone, from the editions bundled in editions.json.
// Edition i opens on startDate + i days at the chosen delivery time; the first
// opens at first launch. Settings, favourites and encouragements live in
// Capacitor Preferences; the native DailyReading plugin keeps the morning
// notification scheduled.
import { ENCOURAGEMENTS, THEMES } from './encouragements.js';

const cap = window.capacitorExports;
const native = Boolean(cap?.Capacitor?.isNativePlatform?.());
const Preferences = native ? cap.registerPlugin('Preferences') : null;
export const DailyReading = native ? cap.registerPlugin('DailyReading') : null;
export const AppPlugin = native ? cap.registerPlugin('App') : null;

export const DEFAULTS = { deliveryTime: '08:00', timezone: 'Africa/Nairobi' };

// ---- storage ------------------------------------------------------------------

async function getPref(key, fallback = null) {
  try {
    const value = native ? (await Preferences.get({ key })).value : localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function setPref(key, value) {
  const s = JSON.stringify(value);
  try {
    if (native) await Preferences.set({ key, value: s });
    else localStorage.setItem(key, s);
  } catch { /* storage unavailable: the app still reads, it just forgets */ }
}

// ---- time (the same arithmetic as server/time.js) -----------------------------

const formatters = new Map();
function formatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formatters.get(tz);
}

export function isValidTimeZone(tz) {
  try { formatter(tz); return true; } catch { return false; }
}

function localParts(date, tz) {
  const p = Object.fromEntries(formatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}

export function localDate(date, tz) {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function offsetMs(date, tz) {
  const p = localParts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

export function zonedTimeToUtc(ymd, hhmm, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let result = guess - offsetMs(new Date(guess), tz);
  const second = guess - offsetMs(new Date(result), tz);
  if (second !== result) result = second;
  return new Date(result);
}

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// ---- the bundle and the schedule ----------------------------------------------

let bundle = null;
async function editions() {
  if (!bundle) bundle = await (await fetch('/editions.json')).json();
  return bundle.editions;
}

async function schedule() {
  const list = await editions();
  const timezone = await getPref('lmu.timezone', DEFAULTS.timezone);
  const deliveryTime = await getPref('lmu.deliveryTime', DEFAULTS.deliveryTime);
  const now = new Date();
  const today = localDate(now, timezone);
  let start = await getPref('lmu.startDate');
  if (!isDate(start)) {
    start = today;
    await setPref('lmu.startDate', start);
  }
  const index = daysBetween(start, today);
  const deliverAt = zonedTimeToUtc(today, deliveryTime, timezone);
  // Once a reading has opened it stays open, even if the delivery time is
  // later moved past the present or the clock is wound back.
  const reached = index === 0 ? 0 : now >= deliverAt ? index : index - 1;
  let unlocked = await getPref('lmu.unlocked', -1);
  if (reached > unlocked) {
    unlocked = Math.min(reached, list.length - 1);
    await setPref('lmu.unlocked', unlocked);
  }
  unlocked = Math.min(unlocked, list.length - 1);
  return { list, timezone, deliveryTime, today, start, index, deliverAt, unlocked };
}

const dateOf = (s, i) => addDays(s.start, i);

function toPublic(s, i) {
  const e = s.list[i];
  return { ...e, date: dateOf(s, i), quote: { ...e.quote, verification: e.verification?.quote || null } };
}

function toSummary(s, i) {
  const e = s.list[i];
  return { date: dateOf(s, i), id: e.id, title: e.title, dek: e.dek, founder: e.story.founder, company: e.story.company, country: e.story.country, minutes: e.minutes };
}

function nextDelivery(s) {
  for (let d = 0; d < 3; d++) {
    const day = addDays(s.today, d);
    const at = zonedTimeToUtc(day, s.deliveryTime, s.timezone);
    const i = daysBetween(s.start, day);
    if (at > new Date() && i > s.unlocked && i < s.list.length) return at;
  }
  return null;
}

// Hand the schedule to the phone so the morning notification fires with the
// app closed. Called at every start and whenever the time changes.
export async function syncNotifications() {
  if (!DailyReading) return null;
  const s = await schedule();
  try {
    return await DailyReading.configure({
      startDate: s.start, time: s.deliveryTime, timezone: s.timezone,
      items: s.list.map((e) => ({ title: e.title, dek: e.dek })),
    });
  } catch {
    return null;
  }
}

class NotFound extends Error {
  constructor(msg) { super(msg); this.status = 404; }
}

// ---- encouragement -------------------------------------------------------------

function themesIn(note) {
  const n = ` ${String(note || '').toLowerCase().replace(/[^\p{L}\s'-]+/gu, ' ')} `;
  return Object.entries(THEMES).filter(([, words]) => words.some((w) => n.includes(` ${w} `) || n.includes(` ${w}`))).map(([t]) => t);
}

async function encourage(note) {
  const history = await getPref('lmu.encouragements', []);
  const lastUsed = new Map();
  history.forEach((h, i) => { if (!lastUsed.has(h.key)) lastUsed.set(h.key, i); });
  const wanted = themesIn(note);
  const fit = (e) => e.themes.filter((t) => wanted.includes(t)).length;
  // Never repeat any of the last six; among the rest, best fit to the note,
  // then the one shown longest ago.
  const pool = ENCOURAGEMENTS.filter((e) => !(lastUsed.has(e.key) && lastUsed.get(e.key) < 6));
  const ranked = (pool.length ? pool : ENCOURAGEMENTS).slice().sort((a, b) => (fit(b) - fit(a))
    || ((lastUsed.get(b.key) ?? Infinity) - (lastUsed.get(a.key) ?? Infinity)) || (Math.random() - 0.5));
  const chosen = ranked[0];
  const entry = { id: Date.now(), key: chosen.key, created_at: new Date().toISOString(), note: String(note || '').trim().slice(0, 500) || null, text: chosen.text, origin: 'prepared' };
  await setPref('lmu.encouragements', [entry, ...history].slice(0, 30));
  return entry;
}

// ---- the old /api routes, answered locally ------------------------------------

export async function localApi(path, { method = 'GET', body } = {}) {
  const s = await schedule();
  let m;

  if (path === '/api/today') {
    const finished = s.index >= s.list.length;
    const open = !finished && s.index <= s.unlocked;
    return {
      today: s.today, timezone: s.timezone, deliveryTime: s.deliveryTime, deliverAt: s.deliverAt.toISOString(),
      edition: open ? toPublic(s, s.index) : null,
      previous: open || s.unlocked < 0 ? null : toPublic(s, Math.min(s.unlocked, s.index - 1)),
      finished, total: s.list.length,
    };
  }

  if ((m = path.match(/^\/api\/editions\/(\d{4}-\d{2}-\d{2})$/))) {
    const i = daysBetween(s.start, m[1]);
    if (i < 0 || i >= s.list.length) throw new NotFound('There is no reading for that day.');
    if (i > s.unlocked) throw new NotFound('That reading has not opened yet. It will arrive on its morning.');
    return toPublic(s, i);
  }

  if (path === '/api/archive') {
    const out = [];
    for (let i = s.unlocked; i >= 0; i--) out.push(toSummary(s, i));
    return out;
  }

  if (path === '/api/favourites') {
    const favs = await getPref('lmu.favourites', []);
    const byId = new Map(s.list.map((e, i) => [e.id, i]));
    return favs.filter((f) => byId.has(f.id) && byId.get(f.id) <= s.unlocked)
      .map((f) => ({ ...toSummary(s, byId.get(f.id)), saved_at: f.saved_at }));
  }

  if ((m = path.match(/^\/api\/favourites\/(\d{4}-\d{2}-\d{2})$/))) {
    const i = daysBetween(s.start, m[1]);
    if (i < 0 || i > s.unlocked || i >= s.list.length) throw new NotFound('There is no reading for that day.');
    const id = s.list[i].id;
    const favs = (await getPref('lmu.favourites', [])).filter((f) => f.id !== id);
    if (method === 'PUT') favs.unshift({ id, saved_at: new Date().toISOString() });
    await setPref('lmu.favourites', favs);
    return { saved: method === 'PUT' };
  }

  if (path === '/api/encourage' && method === 'POST') return encourage(body?.note);
  if (path === '/api/encouragements') return (await getPref('lmu.encouragements', [])).slice(0, 10);

  if (path === '/api/settings' && method === 'PUT') {
    const time = String(body?.deliveryTime || '');
    const tz = String(body?.timezone || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Object.assign(new Error('Use a time like 07:30.'), { status: 400 });
    if (!isValidTimeZone(tz)) throw Object.assign(new Error('That time zone is not recognised.'), { status: 400 });
    await setPref('lmu.deliveryTime', time);
    await setPref('lmu.timezone', tz);
    await syncNotifications();
    return localApi('/api/settings');
  }

  if (path === '/api/settings') {
    const status = DailyReading ? await DailyReading.getStatus().catch(() => null) : null;
    const next = nextDelivery(s);
    return {
      deliveryTime: s.deliveryTime, timezone: s.timezone,
      nextDeliveryAt: next ? next.toISOString() : null,
      notifications: status, total: s.list.length, opened: s.unlocked + 1,
      startDate: s.start, lastDate: dateOf(s, s.list.length - 1), bundleVersion: bundle?.version || null,
    };
  }

  throw new NotFound('Not available.');
}
