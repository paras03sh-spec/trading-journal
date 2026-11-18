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
