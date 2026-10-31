// Repeat detection against the permanent story ledger. Two stages:
// a cheap screen that flags anything resembling a past episode (same founder
// or company, nearby year, overlapping vocabulary), then a judgement on the
// flagged entries — by Claude when available, conservatively otherwise.
// A new title or a different article about the same incident is a repeat.

import { normalise } from './verify.js';

const STOP = new Set(('a an and are as at be been but by for from had has have he her his i in into is it its of on or our she so that the their them they this to was we were which who with after before over under then than when while about also only into out up down off more most very just year years later first new one two three company founder founders started founded build built began'.split(' ')));

function stem(w) {
  return w.replace(/(ings|ing|edly|ed|es|s)$/u, '') || w;
}

function words(s) {
  return normalise(String(s || '')).replace(/[^\p{L}\p{N} ]+/gu, ' ').split(' ').filter(Boolean);
}

function contentTokens(s) {
  return new Set(words(s).filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
}

// Surnames (last word of each name) and company-name words.
function surnames(names) {
  return new Set(String(names || '').split(/\s*(?:,|&|\band\b)\s*/i).map((n) => words(n).filter((w) => w.length > 1).pop()).filter(Boolean));
}

function companyWords(company) {
  return new Set(words(company).filter((w) => w.length > 2 && !['the', 'inc', 'ltd', 'limited', 'company', 'group', 'later', 'and'].includes(w)));
}

function overlap(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

function jaccard(a, b) {
  const inter = overlap(a, b);
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function year(approx) {
  const y = Number.parseInt(String(approx || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export function screenAgainstLedger(story, ledger) {
  const cSurnames = surnames(story.founder);
  const cCompany = companyWords(story.company);
  const cText = contentTokens(`${story.event} ${story.summary}`);
  const cYear = year(story.approx_date);
  const flags = [];
  for (const entry of ledger) {
    const sameActor = overlap(cSurnames, surnames(entry.founder)) > 0 || overlap(cCompany, companyWords(entry.company)) > 0;
    const eYear = year(entry.approx_date);
    const yearGap = cYear !== null && eYear !== null ? Math.abs(cYear - eYear) : null;
    const similarity = jaccard(cText, contentTokens(`${entry.event} ${entry.summary}`));
    let level = null;
    if (sameActor && ((yearGap !== null && yearGap <= 2) || similarity >= 0.2)) level = 'likely';
    else if (sameActor) level = 'same-founder';
    else if (similarity >= 0.35) level = 'possible';
    if (level) flags.push({ entry, level, similarity: Number(similarity.toFixed(2)), yearGap });
  }
  return flags;
}

// Without a model to judge meaning, err towards calling it a repeat: only a
// clearly separate episode of the same founder (years apart, little shared
// vocabulary) gets through.
export function conservativeVerdict(flags) {
  const blocking = flags.filter((f) => f.level === 'likely' || f.level === 'possible'
    || (f.level === 'same-founder' && ((f.yearGap ?? 0) < 3 || f.similarity >= 0.15)));
  return {
    repeat: blocking.length > 0,
    matches: blocking.map((f) => f.entry.piece_id),
    reason: blocking.length
      ? `Resembles ${blocking.map((f) => `${f.entry.founder} — ${f.entry.event} (${f.entry.approx_date})`).join('; ')}`
      : 'No close match in the ledger',
    judged_by: 'rules',
  };
}

export function ledgerLine(entry) {
  return `${entry.founder} — ${entry.company} — ${entry.event} (${entry.approx_date})`;
}

export const REPEAT_SCHEMA = {
  type: 'object',
  properties: {
    repeat: { type: 'boolean' },
    matching_piece_ids: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['repeat', 'matching_piece_ids', 'reason'],
  additionalProperties: false,
};

export function repeatPrompt(story, flags) {
  const entries = flags.map((f) => `- [${f.entry.piece_id}] ${ledgerLine(f.entry)}\n  ${f.entry.summary}`).join('\n');
  return `A daily reading must never retell an episode that has already been told.

Ledger entries that look similar:
${entries}

Candidate episode:
${story.founder} — ${story.company} — ${story.event} (${story.approx_date})
${story.summary}

Decide whether the candidate is the same incident as any ledger entry. Retelling the same incident from a different article, from a different angle, or under a new title counts as a repeat. A genuinely different episode in the same founder's life (a different decision, at a different time) is not a repeat. Answer as JSON.`;
}
