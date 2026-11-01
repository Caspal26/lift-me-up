// Independent checks on what the research step claims. The model's word is
// never enough: the server fetches each quote's edition itself and confirms
// the wording is really there, and confirms story sources are live.

const UA = 'LiftMeUp/1.0 (private reading app; source verification)';
const MAX_BYTES = 25 * 1024 * 1024;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', shy: '',
};

export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const v = ENTITIES[code.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

// Normalise typography that differs between editions and web renderings
// without touching the words themselves.
export function normalise(s) {
  return s
    .normalize('NFKC')
    .replace(/­/g, '')                       // soft hyphens
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/-{2,}/g, '-')                        // Gutenberg writes em dashes as --
    .replace(/_/g, '')                             // Gutenberg marks italics with _
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Words only: used to report "same wording, different punctuation".
export function wordsOnly(s) {
  return normalise(s)
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/'(?![\p{L}])|(?<![\p{L}])'/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Network errors, rate limits and server errors are often momentary, so they
// are tried again before a source or quote edition is judged unreachable.
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

export async function fetchText(url, { retries = 2, retryDelayMs = 1500, ...opts } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const page = await fetchOnce(url, opts);
      if (!TRANSIENT.has(page.status) || attempt >= retries) return page;
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** attempt));
  }
}

async function fetchOnce(url, { timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': UA, accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`response too large (${buf.length} bytes)`);
    const type = res.headers.get('content-type') || '';
    const raw = buf.toString('utf8');
    const isHtml = /html/i.test(type) || /^\s*<(!doctype|html)/i.test(raw);
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, text: isHtml ? htmlToText(raw) : raw };
  } finally {
    clearTimeout(timer);
  }
}

// Returns { verified, match: 'exact' | 'words' | 'none', status, url, checkedAt, error? }
export async function verifyQuote(quoteText, sourceUrl, opts = {}) {
  const checkedAt = new Date().toISOString();
  if (!quoteText || !sourceUrl) {
    return { verified: false, match: 'none', url: sourceUrl, checkedAt, error: 'missing quote text or source URL' };
  }
  try {
    const page = await fetchText(sourceUrl, opts);
    if (!page.ok) {
      return { verified: false, match: 'none', status: page.status, url: sourceUrl, checkedAt, error: `HTTP ${page.status}` };
    }
    if (normalise(page.text).includes(normalise(quoteText))) {
      return { verified: true, match: 'exact', status: page.status, url: sourceUrl, checkedAt };
    }
    if (wordsOnly(page.text).includes(wordsOnly(quoteText))) {
      return { verified: true, match: 'words', status: page.status, url: sourceUrl, checkedAt };
    }
    return { verified: false, match: 'none', status: page.status, url: sourceUrl, checkedAt, error: 'wording not found in source' };
  } catch (err) {
    return { verified: false, match: 'none', url: sourceUrl, checkedAt, error: String(err?.message || err) };
  }
}

// A story source is checked for two things: that it loads, and whether it
// names the founder or company (whole words, so "Ory" does not match
// "history"). Some publishers refuse automated requests (401/403/429); those
// are marked "blocked" rather than dead, since a person can still open them.
const BLOCKED = new Set([401, 403, 429, 451]);
const NAME_NOISE = new Set(['and', 'the', 'later', 'company', 'limited', 'group', 'with']);

function wordSet(s) {
  return new Set(normalise(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

export async function checkSource(url, mustMention = [], opts = {}) {
  const checkedAt = new Date().toISOString();
  try {
    const page = await fetchText(url, opts);
    const pageWords = wordSet(page.text);
    const mentions = mustMention.filter(Boolean).filter((name) => {
      const parts = [...wordSet(name)].filter((p) => p.length > 3 && !NAME_NOISE.has(p));
      return parts.some((p) => pageWords.has(p));
    });
    return {
      url, checkedAt, status: page.status, live: page.ok, blocked: BLOCKED.has(page.status),
      mentions, relevant: page.ok && (mustMention.length === 0 || mentions.length > 0),
    };
  } catch (err) {
    return { url, checkedAt, live: false, blocked: false, relevant: false, mentions: [], error: String(err?.message || err) };
  }
}
