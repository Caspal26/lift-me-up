// The research path with a fake Claude client and a fake web: checks the
// request shapes and every gate in the pipeline without network or API key.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../server/db.js';
import { getPiece } from '../server/editions.js';
import { researchEdition } from '../server/research/pipeline.js';
import { createClaudeResearcher } from '../server/research/researcher.js';

const words = (n) => Array.from({ length: n }, () => 'word').join(' ');
const QUOTE = 'He who knows others is wise; he who knows himself is enlightened.';

function draft(overrides = {}) {
  return {
    id: 'amina-closes-the-depot',
    title: 'The Week Amina Closed the Depot',
    dek: 'A one-line dek.',
    story: {
      founder: 'Amina Example', company: 'Depot Co', event: 'Closes the Mombasa depot', approx_date: '2019-04',
      country: 'Kenya', region: 'Kenya', industry: 'logistics', arc: 'closure', funding: 'bootstrapped',
      summary: 'Amina Example closed the Mombasa depot in April 2019 to save the Nairobi operation.',
      paragraphs: [words(160), words(160)],
    },
    quote_options: [
      { text: 'A line that is not in the edition at all.', thinker: 'Laozi', work: 'Tao Te Ching', locator: '33', translator: 'James Legge (1891)', tradition: 'Daoist', source_url: 'https://texts.example/tao.txt', source_title: 'Tao Te Ching (Legge)', connection: words(30), stance: 'affirms' },
      { text: QUOTE, thinker: 'Laozi', work: 'Tao Te Ching', locator: '33', translator: 'James Legge (1891)', tradition: 'Daoist', source_url: 'https://texts.example/tao.txt', source_title: 'Tao Te Ching (Legge)', connection: words(30), stance: 'challenges' },
    ],
    reflection: [words(100)],
    invitation: words(25),
    sources: [
      { title: 'Interview', publisher: 'Paper A', url: 'https://news-a.example/amina', kind: 'founder-interview', supports: 'all' },
      { title: 'Report', publisher: 'Paper B', url: 'https://news-b.example/depot', kind: 'independent-reporting', supports: 'dates' },
      { title: 'Dead link', publisher: 'Gone', url: 'https://gone.example/x', kind: 'independent-reporting', supports: 'nothing' },
    ],
    cross_checks: [{ claim: 'Closed in April 2019', urls: ['https://news-a.example/amina', 'https://news-b.example/depot'] }],
    research_notes: '',
    ...overrides,
  };
}

const fakeWeb = async (url) => {
  const pages = {
    'https://texts.example/tao.txt': `33.\n1. He who knows other men is discerning; ${QUOTE.replace('others', 'others')} He who overcomes others is strong.`,
    'https://news-a.example/amina': '<html><body><p>Amina Example on closing the depot.</p></body></html>',
    'https://news-b.example/depot': '<html><body><p>Depot Co shut its Mombasa site in 2019.</p></body></html>',
  };
  const body = pages[url];
  return new Response(body ?? 'not found', { status: body ? 200 : 404, headers: { 'content-type': url.endsWith('.txt') ? 'text/plain' : 'text/html' } });
};

test('Claude researcher: request shapes, paused turns, dossier and structured writing', async () => {
  const calls = [];
  const replies = [
    { stop_reason: 'pause_turn', content: [
      { type: 'server_tool_use', id: 's1', name: 'web_fetch', input: { url: 'https://news-a.example/amina' } },
      { type: 'web_fetch_tool_result', tool_use_id: 's1', content: { type: 'web_fetch_result', url: 'https://news-a.example/amina' } },
    ] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: `Notes.\n\n## Episode\n${words(150)}\n## Facts\n${words(80)}\n## Quote candidates\n1. "${QUOTE}"` }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(draft()) }] },
  ];
  const client = { beta: { messages: { stream(params) { calls.push(params); const r = replies.shift(); return { finalMessage: async () => r }; } } } };

  const out = await createClaudeResearcher(client).draftEdition({
    today: '2026-11-02', brief: { text: 'Region: Kenya' }, ledgerLines: ['A — B — C (2001)'], quoteLines: [], exclude: [],
  });

  assert.equal(calls.length, 3);
  const [research, resumed, writing] = calls;
  assert.equal(research.model, 'claude-opus-5-5');
  assert.deepEqual(research.thinking, { type: 'adaptive' });
  assert.deepEqual(research.tools.map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
  assert.ok(research.betas.includes('server-side-fallback-2026-07-01'));
  assert.equal(research.fallbacks, 'default');
  assert.match(research.messages[0].content, /A — B — C \(2001\)/);
  assert.equal(resumed.messages.length, 2); // paused assistant turn appended unchanged
  assert.equal(writing.output_config.format.type, 'json_schema');
  assert.equal(writing.tools, undefined);
  assert.match(writing.messages[0].content, /## Episode/);
  assert.deepEqual(out.openedUrls, ['https://news-a.example/amina']);
  assert.equal(out.draft.quote_options.length, 2);
});

test('pipeline: unverifiable quote is skipped, dead source dropped, edition stored as the day\'s candidate', async () => {
  const db = openDb(':memory:');
  const researcher = { name: 'fake', async draftEdition() { return { draft: draft(), openedUrls: [] }; } };
  const r = await researchEdition(db, { researcher, forDate: '2026-11-02', log: {}, verifyOpts: { fetchImpl: fakeWeb } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const piece = getPiece(db, r.id);
  const body = JSON.parse(piece.body);
  const v = JSON.parse(piece.verification);
  assert.equal(piece.status, 'candidate');
  assert.equal(piece.intended_date, '2026-11-02');
  assert.equal(body.quote.text, QUOTE);
  assert.equal(v.quote_attempts[0].verified, false);
  assert.equal(v.quote.verified, true);
  assert.deepEqual(body.sources.map((s) => s.publisher), ['Paper A', 'Paper B']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM story_ledger').get().n, 1);
});

test('pipeline: a repeat is rejected and research tries again; two repeats fail the run', async () => {
  const db = openDb(':memory:');
  const once = { name: 'fake', async draftEdition() { return { draft: draft(), openedUrls: [] }; } };
  assert.equal((await researchEdition(db, { researcher: once, log: {}, verifyOpts: { fetchImpl: fakeWeb } })).ok, true);
  const retold = { name: 'fake', async draftEdition() { return { draft: draft({ id: 'new-title', title: 'Another Look at the Depot' }), openedUrls: [] }; } };
  const r = await researchEdition(db, { researcher: retold, log: {}, verifyOpts: { fetchImpl: fakeWeb } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'repeat');
});

test('pipeline: no verifiable quote means no edition', async () => {
  const db = openDb(':memory:');
  const d = draft();
  d.quote_options = [d.quote_options[0]];
  const researcher = { name: 'fake', async draftEdition() { return { draft: d, openedUrls: [] }; } };
  const r = await researchEdition(db, { researcher, log: {}, verifyOpts: { fetchImpl: fakeWeb } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'no_verified_quote');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pieces').get().n, 0);
});
