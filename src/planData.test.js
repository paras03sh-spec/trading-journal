import { mergeDay } from './planData';

test('stale tab keeps newer sync data and added trades', () => {
  const stale = { pre: { dailyBias: 'bearish' }, trades: [{ ticker: '', notes: '' }], eod: { review: '' } };
  const server = { pre: { claude: { synced_at: '2026-11-18T16:20:00' } }, trades: [{ ticker: 'ES', _syncKey: 'k1', points: '10' }], eod: { review: 'Session notes' } };
  const m = mergeDay(server, stale);
  expect(m.pre.claude.synced_at).toBe('2026-11-18T16:20:00');
  expect(m.pre.dailyBias).toBe('bearish');
  expect(m.trades.map(t => t._syncKey)).toEqual(['k1']);
  expect(m.eod.review).toBe('Session notes');
});

test('local edits win, deleted synced trades stay deleted', () => {
  const server = { pre: { claude: { synced_at: 'b' } }, trades: [{ ticker: 'ES', _syncKey: 'k1', notes: 'auto', mfe: '5' }, { ticker: 'ES', _syncKey: 'k2' }] };
  const local = { pre: { claude: { synced_at: 'a' } }, trades: [{ ticker: 'ES', _syncKey: 'k1', notes: 'mine', mfe: '1' }], deletedSyncKeys: ['k2'] };
  const m = mergeDay(server, local);
  expect(m.trades.length).toBe(1);
  expect(m.trades[0].notes).toBe('mine');
  expect(m.trades[0].mfe).toBe('5');
  expect(m.deletedSyncKeys).toEqual(['k2']);
});

test('daily stop: 1 invalid trade stops the day and lists later trades', () => {
  const { dailyStop } = require('./planData');
  const ds = dailyStop([
    { ticker: 'ES', result: 'L', entryTime: '09:57', valid: true, sl: '8', points: '-7.75', contracts: '1' },
    { ticker: 'ES', result: 'L', entryTime: '10:43', valid: false, sl: '7', points: '-7', contracts: '1' },
    { ticker: 'ES', result: 'L', entryTime: '10:45', valid: false, sl: '10.75', points: '-10', contracts: '1' },
  ]);
  expect(ds.hit).toBe('1 invalid trade (10:43)');
  expect(ds.after).toEqual(['10:45']);
  expect(ds.losses).toBe(3);
  expect(ds.R).toBeCloseTo(-2.9, 1);
});
