// Deterministic rotation: instead of hoping the model varies its choices,
// the ledger says which regions, industries, arcs and traditions have been
// quiet longest, and the research brief asks for those.

export const REGION_LIST = ['Kenya', 'East Africa', 'West Africa', 'Southern Africa', 'North Africa', 'Central Africa', 'South Asia', 'East Asia', 'Southeast Asia', 'Middle East', 'Europe', 'North America', 'Latin America', 'Oceania'];
const AFRICA = new Set(['Kenya', 'East Africa', 'West Africa', 'Southern Africa', 'North Africa', 'Central Africa']);

export const INDUSTRY_LIST = ['healthcare', 'diagnostics', 'pharmaceuticals', 'medical devices', 'agriculture', 'food', 'fintech', 'telecoms', 'logistics', 'manufacturing', 'retail', 'education', 'energy', 'software', 'media', 'transport', 'construction', 'social enterprise', 'hospitality', 'fashion'];
const HEALTH = new Set(['healthcare', 'diagnostics', 'pharmaceuticals', 'medical devices', 'biotech']);

export const ARC_LIST = ['founding-decision', 'setback', 'ordinary-day', 'change-of-direction', 'closure', 'hard-responsibility', 'breakthrough'];

export const TRADITIONS = [
  { name: 'Stoic', hint: 'Marcus Aurelius, Meditations (George Long, MIT Classics); Seneca, Moral Letters to Lucilius (Richard M. Gummere, Wikisource); Epictetus, Discourses or Enchiridion (George Long, Project Gutenberg)' },
  { name: 'Confucian', hint: 'Confucius, Analects, or Mencius (James Legge, Project Gutenberg)' },
  { name: 'Daoist', hint: 'Laozi, Tao Te Ching (James Legge, 1891); Zhuangzi (Herbert Giles, 1889)' },
  { name: 'Buddhist', hint: 'The Dhammapada (F. Max Müller, 1881)' },
  { name: 'Hindu', hint: 'Bhagavad Gita (Edwin Arnold, The Song Celestial, 1885); the Upanishads (F. Max Müller)' },
  { name: 'Ancient Egyptian', hint: 'The Instruction of Ptahhotep (Battiscombe Gunn, 1906)' },
  { name: 'Classical Greek', hint: 'Aristotle, Nicomachean Ethics (W. D. Ross, MIT Classics); Plato, dialogues (Benjamin Jowett, Project Gutenberg)' },
  { name: 'Islamic and Persian', hint: 'Rumi, Masnavi (E. H. Whinfield, 1898); Saadi, Gulistan (Edward Rehatsek); Al-Ghazali, The Alchemy of Happiness (Claud Field, 1909)' },
  { name: 'Renaissance and early modern', hint: 'Montaigne, Essays (Charles Cotton); Spinoza, Ethics (R. H. M. Elwes); Pascal, Pensées (W. F. Trotter)' },
  { name: 'American', hint: 'Emerson, Essays; Thoreau, Walden; William James, Pragmatism or The Will to Believe' },
  { name: 'Jewish', hint: 'Pirkei Avot, Sayings of the Jewish Fathers (Charles Taylor, 1897); Maimonides, Guide for the Perplexed (M. Friedländer)' },
];

function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h;
}

// Index of the most recent use in `recent` (0 = newest), or Infinity.
function lastUse(recent, pick, value) {
  const v = String(value).toLowerCase();
  const i = recent.findIndex((r) => String(pick(r) || '').toLowerCase() === v);
  return i === -1 ? Infinity : i;
}

// Among `options`, the one used least recently; ties broken by a hash of the
// date so the choice is stable for a given morning.
function quietest(options, recent, pick, seed) {
  const rank = (o) => Math.min(lastUse(recent, pick, o), Number.MAX_SAFE_INTEGER);
  return [...options].sort((a, b) => (rank(b) - rank(a)) || (hash(seed + a) - hash(seed + b)))[0];
}

function within(recent, n, test) {
  return recent.slice(0, n).some(test);
}

export function recentLedger(db, limit = 40) {
  return db.prepare(`SELECT s.*, q.thinker, q.work, q.tradition, q.text AS quote_text
                     FROM story_ledger s LEFT JOIN quote_ledger q ON q.piece_id = s.piece_id
                     ORDER BY s.recorded_at DESC, s.id DESC LIMIT ?`).all(limit);
}

export function researchBrief(db, seed) {
  const recent = recentLedger(db);

  let region;
  if (!within(recent, 4, (r) => AFRICA.has(r.region))) {
    region = within(recent, 8, (r) => r.region === 'Kenya')
      ? quietest([...AFRICA].filter((x) => x !== 'Kenya'), recent, (r) => r.region, seed)
      : 'Kenya';
  } else {
    region = quietest(REGION_LIST, recent, (r) => r.region, seed);
  }

  const industry = !within(recent, 5, (r) => HEALTH.has(String(r.industry).toLowerCase()))
    ? quietest(['healthcare', 'diagnostics', 'pharmaceuticals', 'medical devices'], recent, (r) => r.industry, seed)
    : quietest(INDUSTRY_LIST, recent, (r) => r.industry, seed);

  const arc = !within(recent, 6, (r) => r.arc === 'closure' || r.arc === 'change-of-direction')
    ? quietest(['closure', 'change-of-direction'], recent, (r) => r.arc, seed)
    : quietest(ARC_LIST, recent, (r) => r.arc, seed);

  const funding = within(recent, 6, (r) => r.funding === 'bootstrapped') ? null : 'bootstrapped';

  const traditionName = quietest(TRADITIONS.map((t) => t.name), recent, (r) => r.tradition, seed);
  const tradition = TRADITIONS.find((t) => t.name === traditionName);
  const avoidThinkers = [...new Set(recent.slice(0, 10).map((r) => r.thinker).filter(Boolean))];

  const lines = [
    `Region: ${region}`,
    `Industry: ${industry}`,
    `Kind of episode (arc): ${arc}`,
    funding ? 'Funding: prefer a bootstrapped business' : null,
    `Philosophical tradition for the quote: ${tradition.name} — e.g. ${tradition.hint}`,
    avoidThinkers.length ? `Do not quote these thinkers (used recently): ${avoidThinkers.join(', ')}` : null,
  ].filter(Boolean);

  return { region, industry, arc, funding, tradition, avoidThinkers, text: lines.join('\n') };
}

// Choose which reserve edition to publish: the one least like recent mornings.
export function pickReserve(db, reserves) {
  if (!reserves.length) return null;
  const recent = db.prepare("SELECT body FROM pieces WHERE status = 'published' ORDER BY published_date DESC LIMIT 14").all()
    .map((r) => JSON.parse(r.body));
  const dims = [
    [1.0, (b) => b.story.region],
    [0.6, (b) => b.story.industry],
    [0.8, (b) => b.story.arc],
    [1.0, (b) => b.quote.tradition],
    [1.2, (b) => b.quote.thinker],
    [5.0, (b) => b.story.founder],
  ];
  const score = (row) => {
    const body = JSON.parse(row.body);
    return dims.reduce((sum, [w, pick]) => {
      const i = lastUse(recent, pick, pick(body));
      return sum + (Number.isFinite(i) ? w * (14 - i) / 14 : 0);
    }, 0);
  };
  let best = reserves[0];
  let bestScore = score(best);
  for (const row of reserves.slice(1)) {
    const s = score(row);
    if (s < bestScore) { best = row; bestScore = s; }
  }
  return best;
}
