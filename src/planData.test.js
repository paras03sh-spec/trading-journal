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

test('options observations rows', () => {
  const { obsRows } = require('./planData');
  const rows = obsRows({ ar_mfc: { es_pivot: 7419.5, spx_pivot: 7400, score_after_close: { pivot_respected: true, first_break_dir: 'down' } },
    observations: { premarket_drift: { call: 'bearish', outcome: 'down', match: true }, vix: { level: 24.6, key_level: null, outcome: 'not scored', match: null } } });
  expect(rows.map(r => r[0])).toEqual(['AR pivot', 'Pre-market drift', 'VIX']);
  expect(rows[0][3]).toBe(true);
  expect(rows[2][3]).toBe(null);
});
