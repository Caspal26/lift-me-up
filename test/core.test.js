// Fast, offline tests for the rules the app's promise rests on.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { clock } from '../server/clock.js';
import { openDb } from '../server/db.js';
import { claimDelivery } from '../server/delivery/deliver.js';
import { publishForDate, storePiece, validateEdition, wordStats } from '../server/editions.js';
import { conservativeVerdict, screenAgainstLedger } from '../server/research/ledger.js';
import { normalise, wordsOnly } from '../server/research/verify.js';
import { addDays, localDate, zonedTimeToUtc } from '../server/time.js';

afterEach(() => clock.reset());

const words = (n, w = 'word') => Array.from({ length: n }, () => w).join(' ');

function edition(id, overrides = {}) {
  const base = {
    id,
    title: `A title for ${id}`,
    dek: 'A one-line dek.',
    story: {
      founder: 'Ada Example', company: 'Example Labs', event: 'Closes the first clinic', approx_date: '2015-06',
      country: 'Kenya', region: 'Kenya', industry: 'healthcare', arc: 'closure', funding: 'bootstrapped',
      summary: 'Ada Example closed the first clinic after two years and reopened as a lab network.',
      paragraphs: [words(160), words(160)],
    },
    quote: {
      text: 'The obstacle is the way through the work.', thinker: 'Someone', work: 'A Work', locator: 'I.1',
      translator: 'A. Translator (1900)', tradition: 'Stoic', source_url: 'https://example.org/text.txt',
      source_title: 'A Work (1900)', connection: words(30), stance: 'affirms',
    },
    reflection: [words(100)],
    invitation: words(25),
    sources: [
      { title: 'One', publisher: 'P1', url: 'https://a.example/1', kind: 'founder-interview', supports: 'x' },
      { title: 'Two', publisher: 'P2', url: 'https://b.example/2', kind: 'independent-reporting', supports: 'y' },
    ],
    cross_checks: [{ claim: 'Closed in 2015', urls: ['https://a.example/1', 'https://b.example/2'] }],
    research_notes: '',
    researched_at: '2026-11-01',
  };
  return { ...base, ...overrides, story: { ...base.story, ...(overrides.story || {}) } };
}

test('time: Nairobi 08:00 is 05:00 UTC and local dates roll at local midnight', () => {
  assert.equal(zonedTimeToUtc('2026-11-02', '08:00', 'Africa/Nairobi').toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(localDate(new Date('2026-11-01T21:30:00Z'), 'Africa/Nairobi'), '2026-11-02');
  assert.equal(localDate(new Date('2026-11-01T20:59:00Z'), 'Africa/Nairobi'), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('editions: a valid edition passes and word counts are measured', () => {
  const e = edition('ada-closes-clinic');
  assert.deepEqual(validateEdition(e).errors, []);
  assert.equal(wordStats(e).story, 320);
});

test('editions: ellipses in a quote and missing sources are rejected', () => {
  const e = edition('bad', { sources: [], quote: { ...edition('x').quote, text: 'Begin... end' } });
  const { errors } = validateEdition(e);
  assert.ok(errors.some((m) => m.includes('ellipses')));
  assert.ok(errors.some((m) => m.includes('two story sources')));
});

test('publishing: one edition per local day, however often it is called', () => {
  const db = openDb(':memory:');
  storePiece(db, edition('first'), { origin: 'seed', status: 'reserve', verification: {} });
  storePiece(db, edition('second', { story: { founder: 'Bo Other', company: 'Other Co' } }), { origin: 'seed', status: 'reserve', verification: {} });
  const a = publishForDate(db, '2026-11-02');
  const b = publishForDate(db, '2026-11-02');
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.piece.id, b.piece.id);
  const c = publishForDate(db, '2026-11-03');
  assert.notEqual(c.piece.id, a.piece.id);
  assert.equal(publishForDate(db, '2026-11-04').piece, null); // reserve empty
});

test('publishing: a candidate researched for the day beats the reserve; stale candidates return to the reserve', () => {
  const db = openDb(':memory:');
  storePiece(db, edition('reserve-one'), { origin: 'seed', status: 'reserve', verification: {} });
  storePiece(db, edition('fresh', { story: { founder: 'Cy New', company: 'New Co' } }), { origin: 'live', status: 'candidate', intendedDate: '2026-11-02', verification: {} });
  storePiece(db, edition('late', { story: { founder: 'Di Late', company: 'Late Co' } }), { origin: 'live', status: 'candidate', intendedDate: '2026-11-01', verification: {} });
  assert.equal(publishForDate(db, '2026-11-02').piece.id, 'fresh');
  const statuses = Object.fromEntries(db.prepare('SELECT id, status FROM pieces').all().map((r) => [r.id, r.status]));
  assert.equal(statuses.late, 'reserve');
});

test('delivery: a claimed send cannot be claimed again; failures retry after backoff', () => {
  const db = openDb(':memory:');
  clock.set('2026-11-02T05:00:00Z');
  const key = { date: '2026-11-02', channel: 'push', target: 'sub:1', pieceId: 'p' };
  assert.equal(claimDelivery(db, key).claimed, true);
  assert.equal(claimDelivery(db, key).claimed, false); // in flight
  db.prepare("UPDATE deliveries SET status = 'failed'").run();
  assert.equal(claimDelivery(db, key).claimed, false); // backing off
  clock.set('2026-11-02T05:03:00Z');
  const retry = claimDelivery(db, key);
  assert.equal(retry.claimed, true);
  assert.equal(retry.attempt, 2);
  db.prepare("UPDATE deliveries SET status = 'sent'").run();
  clock.set('2026-11-02T09:00:00Z');
  assert.equal(claimDelivery(db, key).claimed, false);
});

test('delivery: an interrupted WhatsApp send is never repeated', () => {
  const db = openDb(':memory:');
  clock.set('2026-11-02T05:00:00Z');
  const key = { date: '2026-11-02', channel: 'whatsapp', target: '+254700000001', pieceId: 'p' };
  assert.equal(claimDelivery(db, key).claimed, true);
  clock.set('2026-11-02T05:30:00Z'); // the process died mid-send
  assert.equal(claimDelivery(db, key).claimed, false);
  assert.equal(db.prepare('SELECT status FROM deliveries').get().status, 'abandoned');
});

test('ledger: the same incident under a new title is a repeat; a different decade is not', () => {
  const ledger = [{ piece_id: 'glitch', founder: 'Stewart Butterfield', company: 'Tiny Speck (later Slack)', event: 'Shuts down Glitch and lays off most staff', approx_date: '2012-11', summary: 'Tiny Speck closed its game Glitch in November 2012 and turned an internal chat tool into Slack.' }];
  const retold = { founder: 'Stewart Butterfield', company: 'Slack', event: 'The game that had to end', approx_date: '2012', summary: 'A failed online game became the chat app Slack.' };
  assert.equal(conservativeVerdict(screenAgainstLedger(retold, ledger)).repeat, true);
  const flickr = { founder: 'Stewart Butterfield and Caterina Fake', company: 'Ludicorp (Flickr)', event: 'Sells Flickr to Yahoo', approx_date: '2005-03', summary: 'Ludicorp sold the photo-sharing site Flickr to Yahoo in March 2005.' };
  assert.equal(conservativeVerdict(screenAgainstLedger(flickr, ledger)).repeat, false);
  const other = { founder: 'Wanjiru Example', company: 'Lab Co', event: 'Opens a lab', approx_date: '2019', summary: 'A new lab opened in Kisumu.' };
  assert.equal(screenAgainstLedger(other, ledger).length, 0);
});

test('quote matching ignores typography but not words', () => {
  assert.equal(normalise('“Thou’rt   here” -- _now_'), '"thou\'rt here" - now');
  assert.ok(normalise('Begin the morning by saying to thyself').includes(normalise('the  morning')));
  assert.notEqual(wordsOnly('the evening'), wordsOnly('the morning'));
});
