// Plan & data: what the end-of-session sync (Claude, from Sierra Chart) stores with each day, shown in the app.
// Read-only views of pre.claude (setup table, go-live gate, table-zone tests, footprint prints, level reactions,
// options levels) and of the per-trade plan fields (grade, valid, trigger type, planned stop/target, exit map).
// Also the save-merge that keeps newer sync data when a stale tab saves.
import React, { useState } from 'react';

// Fields the sync owns on a trade. When the server copy of the day has newer sync data than the tab,
// these come from the server; everything Paras types stays his.
const SYNC_FIELDS = ['mfe', 'mae', 'exitEfficiency', 'afterExit', 'exitMap', 'exitMapSummary', 'partials', 'avgEntry',
  'entryTime', 'exitTime', 'points', 'result', 'paper', '_syncKey'];

const isBlankTrade = t => !t.ticker && !t.notes && !t.plan && !t.points && !t.entryTime;

// Merge what is on the server with what this tab is about to save, so a tab that was open before the
// after-close sync never wipes the sync's data. Paras's edits always win; sync-owned data wins when newer.
export function mergeDay(server, local) {
  if (!server) return local;
  if (!local) return server;
  const sc = server.pre && server.pre.claude, lc = local.pre && local.pre.claude;
  const serverNewer = !!sc && (!lc || String(sc.synced_at || '') > String(lc.synced_at || ''));
  const pre = { ...(server.pre || {}), ...(local.pre || {}) };
  if (serverNewer) pre.claude = sc;
  const deleted = new Set([...(server.deletedSyncKeys || []), ...(local.deletedSyncKeys || [])]);
  const byKey = {};
  (server.trades || []).forEach(t => { if (t._syncKey) byKey[t._syncKey] = t; });
  const localKeys = new Set((local.trades || []).map(t => t._syncKey).filter(Boolean));
  let trades = (local.trades || []).map(t => {
    const s = t._syncKey && byKey[t._syncKey];
    if (!s) return t;
    const out = { ...s, ...t };                 // keep server-only fields, Paras's edits win
    if (serverNewer) SYNC_FIELDS.forEach(k => { if (s[k] !== undefined) out[k] = s[k]; });
    return out;
  });
  const extra = (server.trades || []).filter(t => t._syncKey && !localKeys.has(t._syncKey) && !deleted.has(t._syncKey));
  if (extra.length) trades = [...trades.filter(t => !isBlankTrade(t)), ...extra];
  let eod = local.eod || server.eod;
  if (serverNewer && server.eod && local.eod) {
    const sr = server.eod.review || '', lr = local.eod.review || '';
    // the sync appends session notes to the review; take the server text unless Paras changed it in this tab
    if (sr !== lr && (lr === '' || lr.startsWith('Auto recap') || sr.includes(lr))) eod = { ...local.eod, review: sr };
  }
  const merged = { ...server, ...local, pre, trades, eod };
  if (deleted.size) merged.deletedSyncKeys = [...deleted];
  return merged;
}

export function syncedAt(day) {
  return (day && day.pre && day.pre.claude && day.pre.claude.synced_at) || '';
}

// ── small UI bits (theme colours come in as C) ────────────────────────────────
function Label({ C, children }) {
  return <div style={{ fontSize: 11, color: C.textSub, marginBottom: 7, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>{children}</div>;
}
function Chips({ C, options, value, onChange, colors }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(o => {
        const active = value === o.value; const col = (colors && colors[o.value]) || C.text;
        return (
          <button key={String(o.value)} onClick={() => onChange(active ? '' : o.value)} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
            border: active ? `1.5px solid ${col}` : `1.5px solid ${C.border}`, background: active ? col + '20' : 'transparent',
            color: active ? col : C.textMut, fontWeight: active ? 700 : 400,
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}
function Box({ C, title, children, sub }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: sub ? 2 : 8 }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>{sub}</div>}
      {children}
    </div>
  );
}
function MiniTable({ C, cols, rows }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{cols.map(c => <th key={c} style={{ textAlign: 'left', color: C.textMut, fontWeight: 600, padding: '4px 6px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} style={{ padding: '4px 6px', color: C.textSub, borderBottom: `1px solid ${C.surface2}`, verticalAlign: 'top' }}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
const pct = (a, b) => (b ? Math.round(100 * a / b) + '%' : '—');
const good = xs => xs.filter(x => x.grade === 'good').length;

// ── Trade card: plan grading + exit map ───────────────────────────────────────
export function TradePlanBlock({ trade, set, C }) {
  const em = trade.exitMap || [];
  const es = trade.exitMapSummary || {};
  const [showMap, setShowMap] = useState(false);
  const f8 = es.first_8pt_reversal;
  return (
    <div style={{ marginBottom: 16 }}>
      <Label C={C}>Grade</Label>
      <Chips C={C} value={trade.grade || ''} onChange={set('grade')}
        options={[{ label: 'A+', value: 'A+' }, { label: 'A-', value: 'A-' }, { label: 'B', value: 'B' }, { label: 'C (not a trade)', value: 'C' }]}
        colors={{ 'A+': C.green, 'A-': C.teal, B: C.yellow, C: C.red }} />
      <div style={{ height: 12 }} />
      <Label C={C}>Entry type</Label>
      <Chips C={C} value={trade.triggerType || ''} onChange={set('triggerType')}
        options={[{ label: 'First trigger + print', value: 'first+print' }, { label: 'Second trigger', value: 'second' }, { label: 'Early print (experiment)', value: 'early-print' }]}
        colors={{ 'first+print': C.blue, second: C.teal, 'early-print': C.purple }} />
      <div style={{ height: 12 }} />
      <Label C={C}>Plan-valid (counts for the go-live gate)</Label>
      <Chips C={C} value={trade.valid === true ? 'yes' : trade.valid === false ? 'no' : ''}
        onChange={v => set('valid')(v === 'yes' ? true : v === 'no' ? false : undefined)}
        options={[{ label: 'Valid', value: 'yes' }, { label: 'Invalid (resets the count)', value: 'no' }]}
        colors={{ yes: C.green, no: C.red }} />
      {trade.valid === false && (
        <input value={trade.invalidReason || ''} onChange={e => set('invalidReason')(e.target.value)} placeholder="Why it was invalid"
          style={{ marginTop: 8, width: '100%', background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13, padding: '8px 12px', fontFamily: 'inherit', boxSizing: 'border-box' }} />
      )}
      {(trade.plannedStop || trade.plannedTarget || trade.exitReason || trade.exitEfficiency !== undefined || trade.afterExit) && (
        <div style={{ marginTop: 12, fontSize: 12, color: C.textSub, lineHeight: 1.7 }}>
          {trade.plannedStop ? <>Planned stop <b>{trade.plannedStop}</b> · </> : null}
          {trade.plannedTarget ? <>target <b>{trade.plannedTarget}</b> · </> : null}
          {trade.exitReason ? <>exit: <b>{trade.exitReason}</b> · </> : null}
          {trade.exitEfficiency !== undefined && trade.exitEfficiency !== '' ? <>exit efficiency <b>{trade.exitEfficiency}</b> (points kept ÷ MFE) · </> : null}
          {trade.afterExit ? <>after exit: <b>{trade.afterExit}</b></> : null}
        </div>
      )}
      {em.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <div onClick={() => setShowMap(!showMap)} style={{ cursor: 'pointer', fontSize: 12, color: C.text }}>
            <b>Exit map</b>: price went {es.furthest} pts in the trade's favour by {es.window_end}.{' '}
            {f8 ? <>First level that reversed 8+ pts: <b>{f8.price}</b> ({f8.points} pts{f8.R != null ? `, ${f8.R}R` : ''}, {f8.phase}; {(f8.labels || []).slice(0, 2).join(', ')}).</> : 'No level reversed 8+ pts.'}
            <span style={{ color: C.textMut }}> {showMap ? '▲' : '▼'}</span>
          </div>
          {showMap && (
            <div style={{ marginTop: 8 }}>
              <MiniTable C={C} cols={['Level', 'At', 'Pts', 'R', 'Came back', 'Then', 'When', 'What']}
                rows={em.map(x => [x.price, x.touch, x.points, x.R ?? '—', x.came_back, x.then, x.phase, (x.labels || []).slice(0, 2).join(', ')])} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Day view: the sync's data for this day ────────────────────────────────────
export function DayDataPanel({ pre, C }) {
  const [open, setOpen] = useState(false);
  const c = pre && pre.claude;
  if (!c) return null;
  const g = c.golive || {};
  const fm = c.flow_marks || [];
  const atTable = fm.filter(x => x.table_row != null);
  const tests = c.level_tests || [];
  const offHeld = tests.filter(r => !r.on_table && !(r.kinds || []).includes('table') && r.outcome === 'held');
  const gex = tests.filter(r => (r.kinds || []).includes('gex'));
  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}>
        <b>Plan &amp; data</b>
        <span style={{ color: C.textMut }}> · go-live {g.valid_in_run ?? 0} valid in run{g.window ? `, last ${g.window}: ${Math.round((g.win_rate || 0) * 100)}% / ${g.avg_winner_R ?? '—'}R` : ''}{g.gate_met ? ' · GATE MET' : ''}
          {fm.length ? ` · prints ${good(fm)}/${fm.length} good` : ''}{(c.setup_table || []).length ? ` · ${(c.setup_table || []).length} table rows` : ''}</span>
        <span style={{ float: 'right', color: C.textMut }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {c.backfill_note && <div style={{ fontSize: 12, color: C.yellow, marginBottom: 10 }}>{c.backfill_note}</div>}
          <Box C={C} title="Go-live gate" sub="Rolling last 10 plan-valid paper trades: win rate ≥ 50% and average winner ≥ 2R. An invalid trade resets the count.">
            <div style={{ fontSize: 13, color: C.text }}>
              {g.valid_in_run ?? 0} valid since the last reset · last {g.window || 0}: win rate {g.win_rate != null ? Math.round(g.win_rate * 100) + '%' : '—'}, average winner {g.avg_winner_R ?? '—'}R · <b style={{ color: g.gate_met ? C.green : C.textMut }}>{g.gate_met ? 'met' : 'not met'}</b>
              {g.early_print_experiment ? <span style={{ color: C.textMut }}> · early-print experiment: {g.early_print_experiment.wins}/{g.early_print_experiment.trades} wins</span> : null}
            </div>
          </Box>
          {(c.setup_table || []).length > 0 && (
            <Box C={C} title="Setup table">
              <MiniTable C={C} cols={['#', 'Setup', 'Dir', 'Location', 'Grade', 'Trigger', 'Stop', 'Target', 'Status']}
                rows={c.setup_table.map(r => [r.n, r.setup, r.dir, r.location, r.grade, r.trigger, r.stop, r.target, r.status])} />
            </Box>
          )}
          {(c.table_tests || []).length > 0 && (
            <Box C={C} title="Every test of the table zones" sub="held = 15 pts away before trading 5 pts through the far edge">
              <MiniTable C={C} cols={['Row', 'Zone', 'Test', 'Time', 'As', 'Outcome', 'Best', 'Depth']}
                rows={c.table_tests.map(r => [`${r.row} ${r.setup} ${r.dir}`, `${r.zone[0]}-${r.zone[1]}`, r.test, r.time, r.side, r.outcome, r.best, r.depth])} />
            </Box>
          )}
          {fm.length > 0 && (
            <Box C={C} title="Footprint prints" sub="Every final EXH / ABS / P-b / volume spike in RTH; good = 6+ pts and 2x the heat over the next 10 bars">
              <div style={{ fontSize: 13, color: C.text, marginBottom: 8 }}>
                All {good(fm)}/{fm.length} ({pct(good(fm), fm.length)}) · at table zones {good(atTable)}/{atTable.length} ·
                with context {good(fm.filter(x => x.context === 'with'))}/{fm.filter(x => x.context === 'with').length} ·
                against {good(fm.filter(x => x.context === 'against'))}/{fm.filter(x => x.context === 'against').length}
              </div>
              {atTable.length > 0 && <MiniTable C={C} cols={['Time', 'Side', 'Print', 'Price', 'Row', 'Context', 'Move', 'Heat', 'Grade']}
                rows={atTable.map(x => [x.time, x.side, (x.marks || []).join('+'), x.price, x.table_row, x.context || '—', x.move10, x.heat10, x.grade])} />}
            </Box>
          )}
          {(offHeld.length > 0 || gex.length > 0) && (
            <Box C={C} title="Level reactions" sub="First RTH touch. Off-table levels that held are candidates for main locations once they repeat.">
              <MiniTable C={C} cols={['Time', 'Level', 'As', 'Outcome', 'Best', 'Depth', 'Kind']}
                rows={[...offHeld, ...gex].map(r => [r.touch, (r.labels || []).slice(0, 2).join('; ') + ` (${r.lo === r.hi ? r.lo : r.lo + '-' + r.hi})`, r.side, r.outcome, r.best, r.depth, (r.kinds || []).join(',')])} />
            </Box>
          )}
          {c.gex && c.gex.levels && (
            <Box C={C} title="Options levels (GexLevels, converted to ES)" sub={`${c.gex.regime || ''} · ratio ${c.gex.ratio || '—'} · context only`}>
              <div style={{ fontSize: 12, color: C.textSub }}>{c.gex.levels.map(l => `${l.label} ≈ ${l.price}`).join(' · ')}</div>
            </Box>
          )}
        </div>
      )}
    </div>
  );
}

// ── Analytics: across all days ────────────────────────────────────────────────
export function PlanAnalytics({ days, C }) {
  const list = (days || []).filter(d => d.data && d.data.pre && d.data.pre.claude);
  if (!list.length) return null;
  const latest = [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const g = latest.data.pre.claude.golive || {};
  const trades = [];
  (days || []).forEach(d => (d.data && d.data.trades || []).forEach(t => { if (t.ticker && t.result) trades.push({ ...t, _date: d.date }); }));
  const byType = ['first+print', 'second', 'early-print'].map(k => {
    const xs = trades.filter(t => t.triggerType === k);
    return [k, xs.length, xs.filter(t => t.result === 'W').length, pct(xs.filter(t => t.result === 'W').length, xs.length)];
  });
  const prints = [];
  list.forEach(d => (d.data.pre.claude.flow_marks || []).forEach(x => prints.push(x)));
  const pr = (name, xs) => [name, xs.length, good(xs), pct(good(xs), xs.length)];
  const tt = [];
  list.forEach(d => (d.data.pre.claude.table_tests || []).forEach(r => tt.push(r)));
  const byTest = [1, 2, 3].map(n => {
    const xs = tt.filter(r => (n < 3 ? r.test === n : r.test >= 3) && r.outcome !== 'open');
    return [n < 3 ? `Test ${n}` : 'Test 3+', xs.length, xs.filter(r => r.outcome === 'held').length, pct(xs.filter(r => r.outcome === 'held').length, xs.length)];
  });
  // off-table levels: group by label, count held vs broke across days
  const lv = {};
  list.forEach(d => (d.data.pre.claude.level_tests || []).forEach(r => {
    if (r.on_table || (r.kinds || []).includes('table')) return;
    const key = ((r.labels || [])[0] || '').replace(/\s\d{1,2}-\d{1,2}$/, '').replace(/\(.*?\)/g, '').trim() || (r.kinds || []).join(',');
    lv[key] = lv[key] || { held: 0, broke: 0 };
    if (r.outcome === 'held') lv[key].held++; else if (r.outcome === 'broke') lv[key].broke++;
  }));
  const lvRows = Object.entries(lv).filter(([, v]) => v.held + v.broke >= 2)
    .sort((a, b) => b[1].held / (b[1].held + b[1].broke) - a[1].held / (a[1].held + a[1].broke)).slice(0, 12)
    .map(([k, v]) => [k, v.held + v.broke, v.held, pct(v.held, v.held + v.broke)]);
  const winners = trades.filter(t => t.result === 'W' && t.exitMapSummary);
  const exitRows = winners.map(t => {
    const f = t.exitMapSummary.first_8pt_reversal;
    const kept = parseFloat(t.points) / Math.max(1, parseFloat(t.contracts) || 1);
    return [t._date, t.entryTime, t.direction, isNaN(kept) ? '—' : kept, t.exitMapSummary.furthest, f ? `${f.price} (${f.points} pts, ${f.phase})` : '—', f ? (f.labels || []).slice(0, 2).join(', ') : '—'];
  });
  return (
    <div style={{ marginBottom: 20 }}>
      <Box C={C} title="Go-live gate (paper)" sub={`As of ${latest.date}. Rolling last 10 plan-valid trades: ≥ 50% wins and average winner ≥ 2R; an invalid trade resets the count.`}>
        <div style={{ fontSize: 15, color: C.text, fontWeight: 700 }}>
          {g.valid_in_run ?? 0} valid in the current run · last {g.window || 0}: {g.win_rate != null ? Math.round(g.win_rate * 100) + '%' : '—'} wins, {g.avg_winner_R ?? '—'}R average winner ·{' '}
          <span style={{ color: g.gate_met ? C.green : C.textMut }}>{g.gate_met ? 'GATE MET' : 'not met'}</span>
        </div>
      </Box>
      <Box C={C} title="Entry type" sub="Playbook section 8: first trigger only with a clear print, otherwise the second trigger; early print is an experiment.">
        <MiniTable C={C} cols={['Entry type', 'Trades', 'Wins', 'Win rate']} rows={byType} />
      </Box>
      {prints.length > 0 && (
        <Box C={C} title="Footprint print accuracy" sub="Next 10 bars after each final print; good = 6+ pts and 2x the heat">
          <MiniTable C={C} cols={['Prints', 'Count', 'Good', 'Good %']} rows={[
            pr('All', prints), pr('At table zones', prints.filter(x => x.table_row != null)), pr('Away from table zones', prints.filter(x => x.table_row == null)),
            pr('With context', prints.filter(x => x.context === 'with')), pr('Against context', prints.filter(x => x.context === 'against')),
            ...['EXH', 'ABS', 'P', 'b', 'VS'].map(m => pr(m, prints.filter(x => (x.marks || []).includes(m)))),
          ]} />
        </Box>
      )}
      {tt.length > 0 && (
        <Box C={C} title="Table zones by test number" sub="First test is best? held = 15 pts away before 5 pts through the far edge">
          <MiniTable C={C} cols={['Test', 'Tests', 'Held', 'Held %']} rows={byTest} />
        </Box>
      )}
      {lvRows.length > 0 && (
        <Box C={C} title="Off-table levels that react" sub="First RTH touch, levels with 2+ touches. High held % = candidate main location.">
          <MiniTable C={C} cols={['Level', 'Touches', 'Held', 'Held %']} rows={lvRows} />
        </Box>
      )}
      {exitRows.length > 0 && (
        <Box C={C} title="Where winners could have exited" sub="Points kept vs the furthest move, and the first level that reversed 8+ pts">
          <MiniTable C={C} cols={['Date', 'Entry', 'Side', 'Kept', 'Furthest', 'First 8-pt reversal', 'Level']} rows={exitRows} />
        </Box>
      )}
    </div>
  );
}
