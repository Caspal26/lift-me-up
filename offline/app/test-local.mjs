#!/usr/bin/env node
// Checks the offline data layer (src/local.js) without a phone: a fake clock,
// a fake localStorage and a fake editions.json. Usage: node offline/app/test-local.mjs
import assert from 'node:assert/strict';

const RealDate = Date;
let nowMs = 0;
class FakeDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(nowMs); }
  static now() { return nowMs; }
}
globalThis.Date = FakeDate;
const at = (iso) => { nowMs = RealDate.parse(iso); };

const store = new Map();
globalThis.window = {};
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const N = 4;
const editions = Array.from({ length: N }, (_, i) => ({
  id: `edition-${i}`, title: `Title ${i}`, dek: `Dek ${i}`, minutes: 3,
  story: { founder: `Founder ${i}`, company: 'Co', country: 'Kenya' }, quote: { text: 'q' }, verification: { quote: { verified: true } },
}));
globalThis.fetch = async () => ({ json: async () => ({ version: 'test', editions }) });

const { localApi } = await import('./src/local.js');
const today = () => localApi('/api/today');

// First launch at 06:00 in Nairobi (03:00 UTC): the first reading opens at once.
at('2026-11-02T03:00:00Z');
let t = await today();
assert.equal(t.today, '2026-11-02');
assert.equal(t.edition.id, 'edition-0');
assert.equal(t.previous, null);

// Next morning before 08:00: yesterday's reading, today's not yet.
at('2026-11-03T04:59:00Z');
t = await today();
assert.equal(t.edition, null);
assert.equal(t.previous.id, 'edition-0');
await assert.rejects(localApi('/api/editions/2026-11-03'), /not opened yet/);

// 08:00 Nairobi = 05:00 UTC.
at('2026-11-03T05:00:00Z');
t = await today();
assert.equal(t.edition.id, 'edition-1');

// Moving the time later does not lock a reading that has already opened.
await localApi('/api/settings', { method: 'PUT', body: { deliveryTime: '09:30', timezone: 'Africa/Nairobi' } });
t = await today();
assert.equal(t.edition.id, 'edition-1');
const s = await localApi('/api/settings');
assert.equal(s.deliveryTime, '09:30');
assert.equal(s.nextDeliveryAt, '2026-11-04T06:30:00.000Z');
await assert.rejects(localApi('/api/settings', { method: 'PUT', body: { deliveryTime: '25:00', timezone: 'Africa/Nairobi' } }), /time like/);

// Favourites persist in storage and list newest first.
await localApi('/api/favourites/2026-11-02', { method: 'PUT' });
await localApi('/api/favourites/2026-11-03', { method: 'PUT' });
await localApi('/api/favourites/2026-11-02', { method: 'DELETE' });
let favs = await localApi('/api/favourites');
assert.deepEqual(favs.map((f) => f.id), ['edition-1']);
await assert.rejects(localApi('/api/favourites/2026-11-05', { method: 'PUT' }), /no reading/);

// Days away from the app: everything due has opened; the archive is newest first.
at('2026-11-05T07:00:00Z');
const archive = await localApi('/api/archive');
assert.deepEqual(archive.map((a) => a.date), ['2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02']);

// After the last reading: nothing new, the last one stays, flagged as finished.
at('2026-11-06T07:00:00Z');
t = await today();
assert.equal(t.edition, null);
assert.equal(t.finished, true);
assert.equal(t.previous.id, 'edition-3');

// Encouragement: steered by the note, never one of the last six again.
const seen = [];
for (let i = 0; i < 7; i++) seen.push((await localApi('/api/encourage', { method: 'POST', body: { note: i === 0 ? 'so tired and exhausted today' : '' } })).key);
assert.ok(['information', 'tired-plan', 'rest', 'body', 'evening', 'enough', 'pace'].includes(seen[0]), seen[0]);
assert.equal(new Set(seen.slice(0, 7)).size, 7);
assert.equal((await localApi('/api/encouragements')).length, 7);

favs = await localApi('/api/favourites');
assert.equal(favs.length, 1);
console.log('local.js: all checks passed');
