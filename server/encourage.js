// "I need encouragement now": a short, separate reflection on request. It is
// stored on its own and never touches the daily edition or its history.
import { clock } from './clock.js';
import { config } from './config.js';
import { getSetting } from './db.js';
import { getPublished, latestPublishedBefore } from './editions.js';
import { addDays, localDate } from './time.js';

// Used when research credentials are absent, the model is unavailable, or the
// day's allowance of generated reflections is spent.
export const FALLBACKS = [
  { key: 'information', text: 'Low energy is information, not a verdict. It usually means you have been carrying more than one share for a while — the build, the lab, the people who depend on both. Nothing about today requires you to prove anything. The company does not need your best day; it needs you still here next month.\n\nChoose the smallest piece of work that would make tomorrow easier, and let that be enough for the next hour. If even that is too much, stop, drink some water and step outside for ten minutes. That counts.' },
  { key: 'certainty', text: 'You do not have to feel certain to keep going. Most people who built something lasting spent long stretches not knowing whether it would work; they kept the next promise, and then the one after. Certainty is a poor fuel anyway. It runs out the moment the facts change.\n\nWhat you have instead is the reason you started, and the people who are better off when lab work is done carefully. For the next hour, do one thing that keeps a promise you have already made. Leave the big questions for a rested mind.' },
  { key: 'maintenance', text: 'Some days the work is mostly maintenance: replying, fixing, waiting on someone else. Those days feel as if nothing moved. They are not nothing. A lab that runs well is built from thousands of unremarkable checks done properly, and a company is not so different.\n\nIf today is one of those days, let it be one. Write down three small things you did finish, so that tonight you can see them. Then pick the next small thing, or rest — both are part of the work.' },
  { key: 'tired-plan', text: 'If you are tired, plan for a tired version of yourself rather than pretending otherwise. Pick the one decision that would cause real trouble if it slipped, and protect time for it. Everything else can be done imperfectly or moved to tomorrow without anyone being harmed.\n\nYou are allowed to run at sixty per cent for a day. The people who count on you are better served by your steadiness over months than by a heroic afternoon. Before the hour is out, close one thread or one worry — just one.' },
  { key: 'doubt', text: 'Doubt often arrives dressed as a fact. "This will never work" sounds like analysis, but it is often fatigue speaking in a confident voice. You do not need to argue with it. Notice it, and ask what evidence would actually change your course. If you cannot name any, the doubt is mood, not information, and mood passes.\n\nIn the next hour, do one thing that produces a little real evidence — a message to a user, a test, a number checked — and let that, not the voice, inform you.' },
  { key: 'people', text: 'You are allowed to need people. Building alone is slower and lonelier than it has to be, and asking for help is not a confession of weakness; it is how most hard things have been done.\n\nThink of one person who would be glad to hear from you — a colleague, a mentor, someone who has run a lab or a company. Send them a short, honest note today. It does not need to ask for anything. Connection is a kind of rest, and it often turns out to be progress too.' },
  { key: 'direction', text: 'There is a difference between a hard day and a wrong direction. Hard days are expected; they are the cost of making something that has not been made in quite this way before. A wrong direction shows itself over weeks, in what users do, not in how you feel at four in the afternoon.\n\nSo today, decide nothing large. Do the next right-sized task and let the bigger question wait for a morning when you have slept. For now: stand up, stretch, and finish one thing.' },
  { key: 'weight', text: 'Responsibility can feel like weight, especially when other people\'s work and patients\' results sit downstream of what you build. That weight is also a sign that the work matters. You do not have to carry all of it at once.\n\nPut down what belongs to tomorrow. Put down what belongs to other people. What remains for today is usually smaller than it felt. Name it in one sentence and give it your next quiet hour — or, if you are spent, give that hour to rest instead.' },
];

function pickFallback(db) {
  const used = db.prepare("SELECT fallback_key, MAX(created_at) AS last FROM encouragements WHERE origin = 'fallback' GROUP BY fallback_key").all();
  const last = new Map(used.map((u) => [u.fallback_key, u.last]));
  return [...FALLBACKS].sort((a, b) => String(last.get(a.key) || '').localeCompare(String(last.get(b.key) || '')))[0];
}

export async function encourage(db, { researcher = null, note = '', log = console } = {}) {
  const now = clock.now();
  const tz = getSetting(db, 'timezone', config.defaultTimezone);
  const today = localDate(now, tz);
  const cleanNote = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const piece = getPublished(db, today) || latestPublishedBefore(db, addDays(today, 1));
  const body = piece ? JSON.parse(piece.body) : null;
  const usedToday = db.prepare("SELECT COUNT(*) AS n FROM encouragements WHERE local_date = ? AND origin = 'claude'").get(today).n;

  let text = null;
  let origin = 'fallback';
  let fallbackKey = null;
  if (researcher?.encourage && usedToday < config.encouragementsPerDay) {
    try {
      text = await researcher.encourage({ note: cleanNote, todayStory: body ? { title: body.title, summary: body.story.summary } : null });
      origin = 'claude';
    } catch (err) {
      log.warn?.(`[encourage] model unavailable, using a prepared reflection: ${err.message}`);
    }
  }
  if (!text) {
    const f = pickFallback(db);
    text = f.text;
    fallbackKey = f.key;
  }
  const r = db.prepare(`INSERT INTO encouragements (created_at, local_date, note, text, origin, fallback_key, related_piece)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(now.toISOString(), today, cleanNote || null, text, origin, fallbackKey, piece?.id || null);
  return { id: Number(r.lastInsertRowid), created_at: now.toISOString(), text, origin };
}

export function recentEncouragements(db, limit = 10) {
  return db.prepare('SELECT id, created_at, text, origin FROM encouragements ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
}
