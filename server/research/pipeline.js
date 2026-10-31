// research → repeat check → quote verification → source checks → validation
// → store. Nothing reaches the reader unless every gate passes; a failed run
// leaves the morning to the reserve.
import { clock } from '../clock.js';
import { config } from '../config.js';
import { getSetting } from '../db.js';
import { storePiece, validateEdition } from '../editions.js';
import { finishJob, startJob } from '../jobs.js';
import { localDate } from '../time.js';
import { ResearchError } from './claude.js';
import { conservativeVerdict, ledgerLine, screenAgainstLedger } from './ledger.js';
import { researchBrief } from './rotation.js';
import { checkSource, normalise, verifyQuote } from './verify.js';

export function slugify(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'edition';
}

export async function checkRepeat(researcher, story, ledger, log = console) {
  const flags = screenAgainstLedger(story, ledger);
  if (!flags.length) return { repeat: false, matches: [], reason: 'No similar episode in the ledger', judged_by: 'rules' };
  const summary = flags.map((f) => ({ piece_id: f.entry.piece_id, level: f.level, similarity: f.similarity, yearGap: f.yearGap }));
  if (researcher?.judgeRepeat) {
    try {
      const verdict = await researcher.judgeRepeat(story, flags);
      if (verdict) return { ...verdict, flags: summary };
    } catch (err) {
      log.warn?.(`[research] repeat judge unavailable, using rules: ${err.message}`);
    }
  }
  return { ...conservativeVerdict(flags), flags: summary };
}

export async function chooseQuote(options, quoteLedger, verifyOpts = {}) {
  const used = new Set(quoteLedger.map((q) => q.norm));
  const attempts = [];
  for (const option of options || []) {
    if (!option?.text || !option?.source_url) continue;
    if (used.has(normalise(option.text))) {
      attempts.push({ text: option.text, url: option.source_url, verified: false, error: 'already used in an earlier edition' });
      continue;
    }
    if (/\.\.\.|…/.test(option.text)) {
      attempts.push({ text: option.text, url: option.source_url, verified: false, error: 'contains an ellipsis' });
      continue;
    }
    const result = await verifyQuote(option.text, option.source_url, verifyOpts);
    attempts.push({ text: option.text, ...result });
    if (result.verified) return { quote: option, verification: result, attempts };
  }
  return { quote: null, verification: null, attempts };
}

export async function checkStorySources(edition, openedUrls = null, verifyOpts = {}) {
  const names = [edition.story.founder, edition.story.company];
  return Promise.all(edition.sources.map(async (s) => ({
    ...(await checkSource(s.url, names, verifyOpts)),
    opened_by_research: openedUrls ? openedUrls.includes(s.url) : null,
  })));
}

// Keep sources a reader can open — including context sources (a casualty
// figure, a market statistic) that need not name the founder. At least two
// must remain, and at least one must be confirmed to discuss this founder or
// company.
export function usableSources(edition, checks) {
  const byUrl = new Map(checks.map((c) => [c.url, c]));
  const kept = edition.sources.filter((s) => byUrl.get(s.url)?.live || byUrl.get(s.url)?.blocked);
  const confirmed = kept.filter((s) => byUrl.get(s.url)?.relevant).length;
  return { kept, confirmed };
}

export async function researchEdition(db, { researcher, forDate = null, log = console, verifyOpts = {} }) {
  const tz = getSetting(db, 'timezone', config.defaultTimezone);
  const today = localDate(clock.now(), tz);
  const runId = startJob(db, forDate ? 'research' : 'replenish', forDate);
  const exclude = [];
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ledger = db.prepare('SELECT * FROM story_ledger ORDER BY id').all();
      const quoteLedger = db.prepare('SELECT * FROM quote_ledger ORDER BY id DESC').all();
      const brief = researchBrief(db, forDate || today);
      const { draft, openedUrls = null } = await researcher.draftEdition({
        today, brief, exclude,
        ledgerLines: ledger.map(ledgerLine),
        quoteLines: quoteLedger.slice(0, 80).map((q) => `"${q.text}" — ${q.thinker}, ${q.work}`),
      });

      const verdict = await checkRepeat(researcher, draft.story, ledger, log);
      if (verdict.repeat) {
        exclude.push(`${draft.story.founder} — ${draft.story.event}`);
        log.warn?.(`[research] rejected as a repeat: ${draft.title} (${verdict.reason})`);
        continue;
      }

      const { quote_options: options, ...rest } = draft;
      const base = { ...rest, id: slugify(draft.id || `${draft.story.founder} ${draft.story.event}`), researched_at: draft.researched_at || today };

      let picked = await chooseQuote(options, quoteLedger, verifyOpts);
      if (!picked.quote && researcher.findMoreQuotes) {
        const more = await researcher.findMoreQuotes({ edition: base, tradition: brief.tradition, avoid: brief.avoidThinkers });
        const second = await chooseQuote(more, quoteLedger, verifyOpts);
        picked = { ...second, attempts: [...picked.attempts, ...second.attempts] };
      }
      if (!picked.quote) throw new ResearchError('no_verified_quote', 'None of the proposed quotes could be verified against its edition');

      const edition = { ...base, quote: picked.quote };
      const sourceChecks = await checkStorySources(edition, openedUrls, verifyOpts);
      const { kept, confirmed } = usableSources(edition, sourceChecks);
      if (kept.length < 2 || confirmed < 1) {
        throw new ResearchError('sources', 'Fewer than two story sources could be opened and confirmed');
      }
      edition.sources = kept;

      const { errors, warnings } = validateEdition(edition);
      if (errors.length) throw new ResearchError('invalid', errors.join('; '));

      const id = storePiece(db, edition, {
        origin: researcher.origin || 'live',
        status: forDate ? 'candidate' : 'reserve',
        intendedDate: forDate,
        verification: {
          quote: picked.verification,
          quote_attempts: picked.attempts,
          sources: sourceChecks,
          repeat: verdict,
          warnings,
          rotation: { region: brief.region, industry: brief.industry, arc: brief.arc, tradition: brief.tradition.name },
          researcher: researcher.name,
          model: researcher.name === 'claude' ? config.claude.model : null,
        },
      });
      finishJob(db, runId, 'ok', { id, attempt, warnings });
      log.info?.(`[research] stored ${id} (${forDate ? `for ${forDate}` : 'reserve'})`);
      return { ok: true, id, warnings };
    }
    throw new ResearchError('repeat', 'Both candidates repeated episodes already in the ledger');
  } catch (err) {
    const detail = { code: err.code || 'error', message: String(err?.message || err) };
    finishJob(db, runId, 'failed', detail);
    log.error?.(`[research] ${forDate ? `research for ${forDate}` : 'reserve top-up'} failed: ${detail.code}: ${detail.message}`);
    return { ok: false, error: detail };
  }
}
