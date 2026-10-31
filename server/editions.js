import { tx } from './db.js';
import { clock } from './clock.js';
import { normalise } from './research/verify.js';
import { pickReserve } from './research/rotation.js';

export const ARCS = ['founding-decision', 'setback', 'ordinary-day', 'change-of-direction', 'closure', 'hard-responsibility', 'breakthrough'];
export const REGIONS = ['Kenya', 'East Africa', 'West Africa', 'Southern Africa', 'North Africa', 'Central Africa', 'South Asia', 'East Asia', 'Southeast Asia', 'Middle East', 'Europe', 'North America', 'Latin America', 'Oceania'];
export const FUNDING = ['bootstrapped', 'venture', 'nonprofit', 'public', 'mixed', 'unknown'];
export const STANCES = ['affirms', 'challenges', 'complicates'];
export const SOURCE_KINDS = ['founder-interview', 'oral-history', 'shareholder-letter', 'company-archive', 'memoir', 'court-record', 'independent-reporting', 'business-school-case', 'book'];

// Word ranges from the editorial brief. Outside these is a warning; far
// outside (HARD) is an error, because the reading would no longer fit a
// two- to three-minute morning.
export const LIMITS = { story: [280, 380], quote: [1, 60], connection: [20, 70], reflection: [70, 130], invitation: [12, 45], total: [450, 650] };
const HARD = { story: [220, 460], quote: [1, 75], total: [380, 760] };

const WPM = 220;

export function countWords(s) {
  return (String(s || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

export function wordStats(e) {
  const stats = {
    story: countWords(e.story?.paragraphs?.join(' ')),
    quote: countWords(e.quote?.text),
    connection: countWords(e.quote?.connection),
    reflection: countWords(e.reflection?.join(' ')),
    invitation: countWords(e.invitation),
  };
  stats.total = Object.values(stats).reduce((a, b) => a + b, 0);
  return stats;
}

export function readingMinutes(words) {
  return Math.max(1, Math.round(words / WPM));
}

const isUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u);
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

export function validateEdition(e) {
  const errors = [];
  const warnings = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(e && typeof e === 'object', 'edition must be an object');
  if (errors.length) return { errors, warnings };

  need(/^[a-z0-9][a-z0-9-]{2,80}$/.test(e.id || ''), 'id must be a kebab-case slug');
  need(nonEmpty(e.title) && e.title.length <= 90, 'title is required (at most 90 characters)');
  if (nonEmpty(e.title) && e.title.length > 70) warnings.push('title is longer than 70 characters');
  need(nonEmpty(e.dek), 'dek is required');

  const s = e.story || {};
  for (const f of ['founder', 'company', 'event', 'approx_date', 'country', 'industry', 'summary']) need(nonEmpty(s[f]), `story.${f} is required`);
  need(/^\d{4}(-\d{2})?$/.test(s.approx_date || ''), 'story.approx_date must be YYYY or YYYY-MM');
  need(REGIONS.includes(s.region), `story.region must be one of ${REGIONS.join(', ')}`);
  need(ARCS.includes(s.arc), `story.arc must be one of ${ARCS.join(', ')}`);
  need(FUNDING.includes(s.funding), `story.funding must be one of ${FUNDING.join(', ')}`);
  need(Array.isArray(s.paragraphs) && s.paragraphs.length >= 2 && s.paragraphs.every(nonEmpty), 'story.paragraphs needs at least two paragraphs');

  const q = e.quote || {};
  for (const f of ['text', 'thinker', 'work', 'tradition', 'connection', 'source_title']) need(nonEmpty(q[f]), `quote.${f} is required`);
  need(isUrl(q.source_url), 'quote.source_url must be a URL');
  need(STANCES.includes(q.stance), `quote.stance must be one of ${STANCES.join(', ')}`);
  if (nonEmpty(q.text) && /\.\.\.|…/.test(q.text)) errors.push('quote.text must not contain ellipses');

  need(Array.isArray(e.reflection) && e.reflection.length >= 1 && e.reflection.every(nonEmpty), 'reflection needs at least one paragraph');
  need(nonEmpty(e.invitation), 'invitation is required');

  const sources = Array.isArray(e.sources) ? e.sources : [];
  need(sources.length >= 2, 'at least two story sources are required');
  sources.forEach((src, i) => {
    need(isUrl(src?.url), `sources[${i}].url must be a URL`);
    need(nonEmpty(src?.title), `sources[${i}].title is required`);
    if (src?.kind && !SOURCE_KINDS.includes(src.kind)) warnings.push(`sources[${i}].kind "${src.kind}" is not a known kind`);
  });
  const checks = Array.isArray(e.cross_checks) ? e.cross_checks : [];
  if (checks.length === 0) warnings.push('no cross-checks recorded');
  checks.forEach((c, i) => {
    const hosts = new Set((c?.urls || []).filter(isUrl).map((u) => new URL(u).hostname.replace(/^www\./, '')));
    if (hosts.size < 2) warnings.push(`cross_checks[${i}] is not backed by two independent sites`);
  });

  if (!errors.length) {
    const w = wordStats(e);
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
      if (w[k] < lo || w[k] > hi) warnings.push(`${k} is ${w[k]} words (brief: ${lo}–${hi})`);
    }
    for (const [k, [lo, hi]] of Object.entries(HARD)) {
      if (w[k] < lo || w[k] > hi) errors.push(`${k} is ${w[k]} words, outside ${lo}–${hi}`);
    }
  }
  return { errors, warnings };
}

function uniqueId(db, base) {
  let id = base;
  for (let n = 2; db.prepare('SELECT 1 FROM pieces WHERE id = ?').get(id); n++) id = `${base}-${n}`;
  return id;
}

// Store a researched edition and record it in the permanent ledgers.
export function storePiece(db, edition, { origin, status, intendedDate = null, verification }) {
  const now = clock.now().toISOString();
  return tx(db, () => {
    const id = uniqueId(db, edition.id);
    const body = { ...edition, id };
    db.prepare(`INSERT INTO pieces (id, status, origin, intended_date, title, founder, company, body, verification, researched_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, status, origin, intendedDate, body.title, body.story.founder, body.story.company,
        JSON.stringify(body), JSON.stringify(verification || {}), body.researched_at || now.slice(0, 10), now);
    const s = body.story;
    db.prepare(`INSERT INTO story_ledger (piece_id, founder, company, event, approx_date, summary, country, region, industry, arc, funding, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, s.founder, s.company, s.event, s.approx_date, s.summary, s.country, s.region, s.industry, s.arc, s.funding, now);
    const q = body.quote;
    db.prepare(`INSERT INTO quote_ledger (piece_id, thinker, work, locator, tradition, text, norm, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, q.thinker, q.work, q.locator || null, q.tradition, q.text, normalise(q.text), now);
    return id;
  });
}

export function getPublished(db, date) {
  return db.prepare("SELECT * FROM pieces WHERE published_date = ? AND status = 'published'").get(date) || null;
}

export function getPiece(db, id) {
  return db.prepare('SELECT * FROM pieces WHERE id = ?').get(id) || null;
}

export function hasCandidateFor(db, date) {
  return Boolean(db.prepare("SELECT 1 FROM pieces WHERE status = 'candidate' AND intended_date = ?").get(date));
}

export function countReserve(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM pieces WHERE status = 'reserve'").get().n;
}

// Publish exactly one edition for a local calendar day. Calling this again
// for the same day — a refresh, a job retry, a second server — returns the
// edition already chosen. The UNIQUE constraint on published_date backs this
// up even if two processes race.
export function publishForDate(db, date) {
  const now = clock.now().toISOString();
  return tx(db, () => {
    const existing = getPublished(db, date);
    if (existing) return { piece: existing, created: false, source: 'existing' };

    // Candidates researched for an earlier morning that never ran are still
    // good, verified work: keep them as reserve.
    db.prepare("UPDATE pieces SET status = 'reserve' WHERE status = 'candidate' AND intended_date < ?").run(date);

    let source = 'candidate';
    let chosen = db.prepare("SELECT * FROM pieces WHERE status = 'candidate' AND intended_date = ? ORDER BY created_at LIMIT 1").get(date);
    if (!chosen) {
      source = 'reserve';
      chosen = pickReserve(db, db.prepare("SELECT * FROM pieces WHERE status = 'reserve' ORDER BY created_at").all());
    }
    if (!chosen) return { piece: null, created: false, source: null };

    db.prepare("UPDATE pieces SET status = 'published', published_date = ?, published_at = ? WHERE id = ?").run(date, now, chosen.id);
    return { piece: getPublished(db, date), created: true, source };
  });
}

export function listPublished(db) {
  return db.prepare("SELECT * FROM pieces WHERE status = 'published' ORDER BY published_date DESC").all();
}

export function latestPublishedBefore(db, date) {
  return db.prepare("SELECT * FROM pieces WHERE status = 'published' AND published_date < ? ORDER BY published_date DESC LIMIT 1").get(date) || null;
}

export function toPublic(row) {
  if (!row) return null;
  const body = JSON.parse(row.body);
  const verification = JSON.parse(row.verification || '{}');
  const words = wordStats(body);
  return {
    date: row.published_date,
    id: row.id,
    title: body.title,
    dek: body.dek,
    minutes: readingMinutes(words.total),
    words: words.total,
    story: body.story,
    quote: { ...body.quote, verification: verification.quote || null },
    reflection: body.reflection,
    invitation: body.invitation,
    sources: body.sources,
    cross_checks: body.cross_checks || [],
    research_notes: body.research_notes || '',
    researched_at: body.researched_at,
    origin: row.origin,
    published_at: row.published_at,
    sources_checked: verification.sources || [],
  };
}

export function toSummary(row) {
  const body = JSON.parse(row.body);
  const words = wordStats(body);
  return {
    date: row.published_date,
    id: row.id,
    title: body.title,
    dek: body.dek,
    founder: body.story.founder,
    company: body.story.company,
    country: body.story.country,
    minutes: readingMinutes(words.total),
  };
}

export function listFavourites(db) {
  return db.prepare(`SELECT p.*, f.saved_at FROM favourites f JOIN pieces p ON p.id = f.piece_id
                     WHERE p.status = 'published' ORDER BY f.saved_at DESC`).all();
}

export function setFavourite(db, date, saved) {
  const piece = getPublished(db, date);
  if (!piece) return null;
  if (saved) {
    db.prepare('INSERT INTO favourites (piece_id, saved_at) VALUES (?, ?) ON CONFLICT (piece_id) DO NOTHING')
      .run(piece.id, clock.now().toISOString());
  } else {
    db.prepare('DELETE FROM favourites WHERE piece_id = ?').run(piece.id);
  }
  return piece;
}
