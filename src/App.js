import { useState, useRef, useEffect } from 'react';
import { loadDay, saveDay, loadIndex, saveIndex } from './supabase';

// ─── Constants ────────────────────────────────────────────────────────────────
const POINT_VALUES = { ES: 50, NQ: 20, MES: 5, MNQ: 2 };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS_HDR = ["Su","Mo","Tu","We","Th","Fr","Sa"];
const TABS = ["Pre-Market", "Trades", "EOD Review"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function calcPnL(ticker, contracts, points) {
  return (parseFloat(points) || 0) * (POINT_VALUES[ticker] || 0) * (parseFloat(contracts) || 0);
}
function calcRisk(ticker, contracts, sl) {
  return (parseFloat(sl) || 0) * (POINT_VALUES[ticker] || 0) * (parseFloat(contracts) || 0);
}
function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}
function getMonthDays(year, month) {
  const days = [];
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < first; i++) days.push(null);
  for (let d = 1; d <= total; d++) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    days.push(`${year}-${mm}-${dd}`);
  }
  return days;
}
function emptyDay() {
  return {
    pre: { dailyBias: '', bigPicture: '', plan: '', feelings: '', imgFractal: '', imgTPO: '', img15: '' },
    trades: [newTrade()],
    eod: { emotions: '', well: '', fix: '', review: '', img15: '', imgTPO: '' },
  };
}
function newTrade() {
  return { ticker: '', contracts: '', sl: '', plan: '', candle: '', result: '', points: '', emotions: '', notes: '', img1: '', img15: '', open: true };
}

// ─── Primitives ───────────────────────────────────────────────────────────────
function Pills({ options, value, onChange, colors }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const active = value === o.value;
        const col = colors?.[o.value] || '#fff';
        return (
          <button key={o.value} onClick={() => onChange(active ? '' : o.value)} style={{
            padding: '6px 16px', borderRadius: 20,
            border: active ? `1.5px solid ${col}` : '1.5px solid #222',
            background: active ? col + '18' : 'transparent',
            color: active ? col : '#444', fontSize: 12, fontFamily: 'inherit',
            cursor: 'pointer', fontWeight: active ? 700 : 400,
            letterSpacing: '0.04em', transition: 'all 0.15s',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function ImageSlot({ label, value, onChange }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef();
  const handle = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => onChange(e.target.result);
    reader.readAsDataURL(file);
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: '#333', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      <div
        onClick={() => !value && ref.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
        style={{
          border: drag ? '1.5px dashed #4ade80' : value ? '1.5px solid #1e1e1e' : '1.5px dashed #1e1e1e',
          borderRadius: 8, minHeight: value ? 'auto' : 72,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: value ? 'default' : 'pointer', overflow: 'hidden',
          background: drag ? '#4ade8008' : '#0a0a0a', transition: 'all 0.15s', position: 'relative',
        }}
      >
        {value ? (
          <>
            <img src={value} alt={label} style={{ width: '100%', display: 'block', borderRadius: 7 }} />
            <button onClick={(e) => { e.stopPropagation(); onChange(''); }} style={{
              position: 'absolute', top: 6, right: 6,
              background: '#000000cc', border: 'none', borderRadius: 4,
              color: '#666', fontSize: 10, padding: '3px 7px', cursor: 'pointer',
            }}>✕</button>
          </>
        ) : (
          <span style={{ color: '#2a2a2a', fontSize: 11 }}>drop / tap to upload</span>
        )}
        <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handle(e.target.files[0])} />
      </div>
    </div>
  );
}

function Field({ label, placeholder, value, onChange, rows = 3 }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10, color: '#333', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{
        width: '100%', background: '#0a0a0a', border: '1.5px solid #1a1a1a',
        borderRadius: 8, color: '#bbb', fontSize: 13, padding: '10px 12px',
        resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, outline: 'none', boxSizing: 'border-box',
      }} onFocus={(e) => e.target.style.borderColor = '#2a2a2a'} onBlur={(e) => e.target.style.borderColor = '#1a1a1a'} />
    </div>
  );
}

function Input({ label, value, onChange, type = 'text' }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: '#333', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={{
        width: '100%', background: '#0a0a0a', border: '1.5px solid #1a1a1a',
        borderRadius: 8, color: '#bbb', fontSize: 13, padding: '8px 12px',
        fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
      }} onFocus={(e) => e.target.style.borderColor = '#2a2a2a'} onBlur={(e) => e.target.style.borderColor = '#1a1a1a'} />
    </div>
  );
}

function Divider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 18px' }}>
      <div style={{ flex: 1, height: 1, background: '#161616' }} />
      {label && <span style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</span>}
      <div style={{ flex: 1, height: 1, background: '#161616' }} />
    </div>
  );
}

// ─── Trade Card ───────────────────────────────────────────────────────────────
function TradeCard({ index, trade, onChange, onRemove }) {
  const pnl = calcPnL(trade.ticker, trade.contracts, trade.points);
  const risk = calcRisk(trade.ticker, trade.contracts, trade.sl);
  const rr = risk > 0 ? (Math.abs(pnl) / risk).toFixed(2) : '—';
  const set = (k) => (v) => onChange({ ...trade, [k]: v });
  const dot = trade.result === 'W' ? '#4ade80' : trade.result === 'L' ? '#f87171' : trade.result === 'BE' ? '#f59e0b' : '#222';

  return (
    <div style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={() => set('open')(!trade.open)} style={{
        padding: '13px 14px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />
          <span style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>Trade {index + 1}</span>
          {trade.ticker && <span style={{ fontSize: 11, color: '#333', background: '#161616', padding: '2px 7px', borderRadius: 4 }}>{trade.ticker}</span>}
          {trade.plan && <span style={{ fontSize: 10, color: '#2a2a2a' }}>{trade.plan === 'fractal' ? 'fractal' : 'first tap'}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {trade.points !== '' && (
            <span style={{ fontSize: 12, fontWeight: 700, color: parseFloat(trade.points) >= 0 ? '#4ade80' : '#f87171', fontVariantNumeric: 'tabular-nums' }}>
              {parseFloat(trade.points) >= 0 ? '+' : ''}{trade.points}pts
            </span>
          )}
          <span style={{ color: '#222', fontSize: 14 }}>{trade.open ? '▲' : '▼'}</span>
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ background: 'none', border: 'none', color: '#222', fontSize: 15, cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      </div>

      {trade.open && (
        <div style={{ padding: '0 14px 18px', borderTop: '1px solid #141414' }}>
          <Divider label="Setup" />
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: '#333', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Ticker</div>
            <Pills
              options={[{label:'ES',value:'ES'},{label:'NQ',value:'NQ'},{label:'MES',value:'MES'},{label:'MNQ',value:'MNQ'}]}
              value={trade.ticker} onChange={set('ticker')}
              colors={{ ES:'#60a5fa', NQ:'#a78bfa', MES:'#34d399', MNQ:'#fb923c' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Input label="Contracts" type="number" value={trade.contracts} onChange={set('contracts')} />
            <Input label="SL Points" type="number" value={trade.sl} onChange={set('sl')} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: '#333', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Execution Plan</div>
            <Pills options={[{label:'Fractal Based',value:'fractal'},{label:'First Tap',value:'firsttap'}]}
              value={trade.plan} onChange={set('plan')} colors={{ fractal:'#a78bfa', firsttap:'#60a5fa' }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: '#333', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Reversal Candle</div>
            <Pills options={[{label:'✓ Confirmed',value:'yes'},{label:'✗ No confirmation',value:'no'}]}
              value={trade.candle} onChange={set('candle')} colors={{ yes:'#4ade80', no:'#f87171' }} />
          </div>

          <Divider label="Charts" />
          <ImageSlot label="1min Chart" value={trade.img1} onChange={set('img1')} />
          <ImageSlot label="15min Chart" value={trade.img15} onChange={set('img15')} />

          <Divider label="Result" />
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: '#333', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Result</div>
            <Pills options={[{label:'Win',value:'W'},{label:'Loss',value:'L'},{label:'Break Even',value:'BE'}]}
              value={trade.result} onChange={set('result')} colors={{ W:'#4ade80', L:'#f87171', BE:'#f59e0b' }} />
          </div>
          <Input label="Points Gained / Lost" type="number" value={trade.points} onChange={set('points')} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'P&L $', val: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)}`, color: pnl >= 0 ? '#4ade80' : '#f87171' },
              { label: 'Risk $', val: `$${risk.toFixed(0)}`, color: '#f59e0b' },
              { label: 'RR', val: `${rr}R`, color: '#888' },
            ].map(s => (
              <div key={s.label} style={{ background: '#0a0a0a', border: '1px solid #161616', borderRadius: 8, padding: '9px 10px' }}>
                <div style={{ fontSize: 9, color: '#2a2a2a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.val}</div>
              </div>
            ))}
          </div>

          <Divider label="Notes" />
          <Field label="Emotions" placeholder="Entry · during · exit..." value={trade.emotions} onChange={set('emotions')} rows={2} />
          <Field label="Trade Notes" placeholder="Plan followed? Deviations? Key observations..." value={trade.notes} onChange={set('notes')} rows={2} />
        </div>
      )}
    </div>
  );
}

// ─── Summary Bar ──────────────────────────────────────────────────────────────
function SummaryBar({ trades }) {
  const total = trades.reduce((s, t) => s + calcPnL(t.ticker, t.contracts, t.points), 0);
  const totalPts = trades.reduce((s, t) => s + (parseFloat(t.points) || 0), 0);
  const wins = trades.filter(t => t.result === 'W').length;
  const losses = trades.filter(t => t.result === 'L').length;
  const counted = trades.filter(t => t.result).length;
  const wr = counted > 0 ? Math.round((wins / counted) * 100) : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 14 }}>
      {[
        { label: 'P&L', val: `${total >= 0 ? '+' : ''}$${total.toFixed(0)}`, col: total >= 0 ? '#4ade80' : '#f87171' },
        { label: 'Points', val: `${totalPts >= 0 ? '+' : ''}${totalPts.toFixed(1)}`, col: totalPts >= 0 ? '#4ade80' : '#f87171' },
        { label: 'W Rate', val: `${wr}%`, col: '#f59e0b' },
        { label: 'Trades', val: `${wins}W ${losses}L`, col: '#555' },
      ].map(s => (
        <div key={s.label} style={{ background: '#0a0a0a', border: '1px solid #161616', borderRadius: 8, padding: '9px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: '#2a2a2a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>{s.label}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: s.col, fontVariantNumeric: 'tabular-nums' }}>{s.val}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function CalendarModal({ selectedDate, onSelect, onClose, index }) {
  const now = new Date(selectedDate + 'T12:00:00');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const days = getMonthDays(year, month);
  const today = todayStr();
  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000000cc', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: '16px 16px 0 0', padding: '20px 16px 36px', width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: '#444', fontSize: 18, cursor: 'pointer', padding: '4px 10px' }}>‹</button>
          <span style={{ fontSize: 13, color: '#888', fontWeight: 600, letterSpacing: '0.06em' }}>{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: '#444', fontSize: 18, cursor: 'pointer', padding: '4px 10px' }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 6 }}>
          {DAYS_HDR.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 9, color: '#2a2a2a', letterSpacing: '0.1em', padding: '4px 0' }}>{d}</div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
          {days.map((d, i) => {
            if (!d) return <div key={i} />;
            const isSelected = d === selectedDate;
            const isToday = d === today;
            const dayIdx = index[d];
            const dotColor = dayIdx?.pnl > 0 ? '#4ade80' : dayIdx?.pnl < 0 ? '#f87171' : dayIdx ? '#f59e0b' : null;
            return (
              <button key={d} onClick={() => { onSelect(d); onClose(); }} style={{
                padding: '8px 0', borderRadius: 8,
                border: isSelected ? '1.5px solid #3a3a3a' : '1.5px solid transparent',
                background: isSelected ? '#1a1a1a' : 'transparent',
                color: isToday ? '#fff' : dayIdx ? '#777' : '#2a2a2a',
                fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                fontWeight: isToday ? 700 : 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}>
                {String(new Date(d + 'T12:00:00').getDate())}
                {dotColor && <div style={{ width: 4, height: 4, borderRadius: '50%', background: dotColor }} />}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 16 }}>
          {[['#4ade80','Profit'],['#f87171','Loss'],['#f59e0b','Breakeven']].map(([c,l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#333' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: c }} />{l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function PreMarketTab({ data, onChange }) {
  const set = k => v => onChange({ ...data, [k]: v });
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, color: '#333', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Daily Bias</div>
        <Pills
          options={[{label:'🟢 Bullish',value:'bullish'},{label:'⚪ Neutral',value:'neutral'},{label:'🔴 Bearish',value:'bearish'}]}
          value={data.dailyBias} onChange={set('dailyBias')}
          colors={{ bullish:'#4ade80', neutral:'#888', bearish:'#f87171' }}
        />
      </div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, color: '#333', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Big Picture</div>
        <Pills
          options={[{label:'🐂 Bull',value:'bull'},{label:'⚪ Neutral',value:'neutral'},{label:'🐻 Bear',value:'bear'}]}
          value={data.bigPicture} onChange={set('bigPicture')}
          colors={{ bull:'#4ade80', neutral:'#888', bear:'#f87171' }}
        />
      </div>
      <Divider label="Charts" />
      <ImageSlot label="Fractal Screenshot" value={data.imgFractal} onChange={set('imgFractal')} />
      <ImageSlot label="TPO Chart" value={data.imgTPO} onChange={set('imgTPO')} />
      <ImageSlot label="15min Candlestick" value={data.img15} onChange={set('img15')} />
      <Divider label="Plan" />
      <Field label="Daily Operating Plan" placeholder="Key levels · VAH/VAL/POC · Setups · Max loss · Risk rules..." value={data.plan} onChange={set('plan')} rows={4} />
      <Field label="Pre-Market Feelings" placeholder="Mindset · Sleep · Confidence · Anything affecting edge..." value={data.feelings} onChange={set('feelings')} rows={3} />
    </div>
  );
}

function TradesTab({ trades, onChange }) {
  const update = (i, t) => onChange(trades.map((x, j) => j === i ? t : x));
  const remove = (i) => onChange(trades.filter((_, j) => j !== i));
  const add = () => onChange([...trades, newTrade()]);
  return (
    <div>
      <SummaryBar trades={trades} />
      {trades.map((t, i) => (
        <TradeCard key={i} index={i} trade={t} onChange={nt => update(i, nt)} onRemove={() => remove(i)} />
      ))}
      <button onClick={add} style={{
        width: '100%', padding: '11px', marginTop: 6,
        background: 'transparent', border: '1.5px dashed #1a1a1a',
        borderRadius: 10, color: '#2a2a2a', fontSize: 11,
        fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.06em', transition: 'all 0.15s',
      }}
        onMouseEnter={e => { e.target.style.borderColor = '#2a2a2a'; e.target.style.color = '#444'; }}
        onMouseLeave={e => { e.target.style.borderColor = '#1a1a1a'; e.target.style.color = '#2a2a2a'; }}
      >+ Add Trade</button>
    </div>
  );
}

function EODTab({ data, onChange, trades, date }) {
  const set = k => v => onChange({ ...data, [k]: v });
  const total = trades.reduce((s, t) => s + calcPnL(t.ticker, t.contracts, t.points), 0);
  const totalPts = trades.reduce((s, t) => s + (parseFloat(t.points) || 0), 0);
  const [copied, setCopied] = useState(false);

  const prompt = `Review my trading journal for ${date}.

Daily Bias: ${data.dailyBias||'—'} | Big Picture: ${data.bigPicture||'—'}
Plan: ${data.plan||'—'}
Pre-Market Feelings: ${data.feelings||'—'}

Trades (${trades.length}):
${trades.map((t,i)=>`Trade ${i+1}: ${t.ticker}|${t.contracts}c|SL ${t.sl}pts|Plan:${t.plan}|Candle:${t.candle}|Result:${t.result}|Points:${t.points}|P&L:$${calcPnL(t.ticker,t.contracts,t.points).toFixed(0)}|Notes:${t.notes}`).join('\n')}

Total P&L: $${total.toFixed(0)} | Total Points: ${totalPts.toFixed(1)}
EOD Emotions: ${data.emotions||'—'}
What I Did Well: ${data.well||'—'}
What I Must Fix: ${data.fix||'—'}
General Review: ${data.review||'—'}

Please: 1. Bias accuracy vs market. 2. Trade-by-trade breakdown. 3. What I did well (specific). 4. Top 1-2 fixes. 5. Confirm P&L math (ES=$50 NQ=$20 MES=$5 MNQ=$2). 6. Daily review paragraph. 7. Tradeable day verdict. 8. One edge to build on. Direct, no padding.`;

  const copy = () => { navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'Day P&L', val: `${total>=0?'+':''}$${total.toFixed(0)}`, col: total>=0?'#4ade80':'#f87171' },
          { label: 'Total Points', val: `${totalPts>=0?'+':''}${totalPts.toFixed(1)}`, col: totalPts>=0?'#4ade80':'#f87171' },
        ].map(s => (
          <div key={s.label} style={{ background: '#0a0a0a', border: '1px solid #161616', borderRadius: 10, padding: '14px 14px' }}>
            <div style={{ fontSize: 9, color: '#2a2a2a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.col, fontVariantNumeric: 'tabular-nums' }}>{s.val}</div>
          </div>
        ))}
      </div>
      <Divider label="Charts" />
      <ImageSlot label="15min Chart — Full Day" value={data.img15} onChange={set('img15')} />
      <ImageSlot label="TPO Chart — Full Day" value={data.imgTPO} onChange={set('imgTPO')} />
      <Divider label="Review" />
      <Field label="Overall Emotions & Summary" placeholder="In control? Reactive? Overtraded?" value={data.emotions} onChange={set('emotions')} rows={3} />
      <Field label="✅ What I Did Well" placeholder="Specific — clean executions, rules, reads..." value={data.well} onChange={set('well')} rows={2} />
      <Field label="❌ What I Must Fix" placeholder="Honest — rules broken, bad entries, oversized..." value={data.fix} onChange={set('fix')} rows={2} />
      <Field label="General Review" placeholder="Market narrative, levels, notes for tomorrow..." value={data.review} onChange={set('review')} rows={3} />
      <Divider label="Claude Prompt" />
      <div style={{ background: '#080808', border: '1px solid #161616', borderRadius: 10, padding: '12px 14px', fontSize: 10, color: '#2a2a2a', lineHeight: 1.7, fontFamily: 'monospace', marginBottom: 10, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>{prompt}</div>
      <button onClick={copy} style={{
        width: '100%', padding: '11px',
        background: copied ? '#4ade8012' : 'transparent',
        border: `1.5px solid ${copied ? '#4ade80' : '#222'}`,
        borderRadius: 10, color: copied ? '#4ade80' : '#555',
        fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s',
      }}>{copied ? '✓ Copied to clipboard' : 'Copy Claude Prompt'}</button>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const today = todayStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [tab, setTab] = useState(0);
  const [dayData, setDayData] = useState(null);
  const [index, setIndex] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    loadIndex().then(idx => setIndex(idx || {}));
  }, []);

  useEffect(() => {
    setLoading(true);
    loadDay(selectedDate).then(d => {
      setDayData(d || emptyDay());
      setLoading(false);
    });
  }, [selectedDate]);

  useEffect(() => {
    if (!dayData || loading) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await saveDay(selectedDate, dayData);
      const trades = dayData.trades || [];
      const total = trades.reduce((s, t) => s + calcPnL(t.ticker, t.contracts, t.points), 0);
      const totalPts = trades.reduce((s, t) => s + (parseFloat(t.points) || 0), 0);
      const wins = trades.filter(t => t.result === 'W').length;
      const summary = { pnl: total, pts: totalPts, wins, trades: trades.length, bias: dayData.pre?.dailyBias || '' };
      await saveIndex(selectedDate, summary);
      setIndex(prev => ({ ...prev, [selectedDate]: summary }));
      setSaving(false);
    }, 1000);
    return () => clearTimeout(saveTimer.current);
  }, [dayData]);

  const updatePre = pre => setDayData(d => ({ ...d, pre }));
  const updateTrades = trades => setDayData(d => ({ ...d, trades }));
  const updateEod = eod => setDayData(d => ({ ...d, eod }));

  const goDay = (offset) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toLocaleDateString('en-CA'));
    setTab(0);
  };

  const biasColor = dayData?.pre?.dailyBias === 'bullish' ? '#4ade80' : dayData?.pre?.dailyBias === 'bearish' ? '#f87171' : null;
  const isToday = selectedDate === today;
  const dayIdx = index[selectedDate];

  return (
    <div style={{ minHeight: '100vh', background: '#080808', fontFamily: "'DM Mono','Fira Code','Courier New',monospace", color: '#ccc' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 4px; }
        textarea::placeholder, input::placeholder { color: #1e1e1e; }
      `}</style>

      <div style={{ padding: '20px 18px 0', maxWidth: 520, margin: '0 auto' }}>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 9, color: '#222', letterSpacing: '0.16em', textTransform: 'uppercase' }}>Trading Journal</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {saving && <span style={{ fontSize: 9, color: '#2a2a2a', letterSpacing: '0.1em' }}>saving...</span>}
            {!saving && dayIdx && <span style={{ fontSize: 9, color: '#1e1e1e', letterSpacing: '0.1em' }}>saved ✓</span>}
            {biasColor && (
              <div style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${biasColor}30`, background: `${biasColor}0c`, fontSize: 9, color: biasColor, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {dayData?.pre?.dailyBias}
              </div>
            )}
          </div>
        </div>

        {/* Date navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <button onClick={() => goDay(-1)} style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, color: '#333', width: 34, height: 34, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>‹</button>
          <button onClick={() => setShowCal(true)} style={{ flex: 1, background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
            <div style={{ fontSize: 13, color: '#888', fontWeight: 600 }}>{fmtDate(selectedDate)}{isToday ? ' · Today' : ''}</div>
            {dayIdx ? (
              <div style={{ fontSize: 10, color: dayIdx.pnl >= 0 ? '#4ade80' : '#f87171', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                {dayIdx.pnl >= 0 ? '+' : ''}${dayIdx.pnl.toFixed(0)} · {dayIdx.trades} trade{dayIdx.trades !== 1 ? 's' : ''}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: '#1e1e1e', marginTop: 2 }}>no entries yet</div>
            )}
          </button>
          <button onClick={() => goDay(1)} disabled={selectedDate >= today} style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, color: selectedDate >= today ? '#161616' : '#333', width: 34, height: 34, cursor: selectedDate >= today ? 'default' : 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>›</button>
          {!isToday && (
            <button onClick={() => { setSelectedDate(today); setTab(0); }} style={{ background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 8, color: '#333', padding: '0 10px', height: 34, cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.06em', flexShrink: 0 }}>today</button>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3, background: '#0a0a0a', borderRadius: 10, padding: 3, border: '1px solid #161616', marginBottom: 20 }}>
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(i)} style={{
              padding: '9px 4px', borderRadius: 8,
              background: tab === i ? '#161616' : 'transparent',
              border: 'none', color: tab === i ? '#aaa' : '#2a2a2a',
              fontSize: 10, fontFamily: 'inherit', cursor: 'pointer',
              fontWeight: tab === i ? 600 : 400, letterSpacing: '0.06em', transition: 'all 0.15s',
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 18px 80px', maxWidth: 520, margin: '0 auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#222', fontSize: 11, padding: '40px 0', letterSpacing: '0.1em' }}>loading...</div>
        ) : (
          <>
            {tab === 0 && <PreMarketTab data={dayData.pre} onChange={updatePre} />}
            {tab === 1 && <TradesTab trades={dayData.trades} onChange={updateTrades} />}
            {tab === 2 && <EODTab data={{ ...dayData.eod, dailyBias: dayData.pre.dailyBias, bigPicture: dayData.pre.bigPicture, plan: dayData.pre.plan, feelings: dayData.pre.feelings }} onChange={updateEod} trades={dayData.trades} date={selectedDate} />}
          </>
        )}
      </div>

      {showCal && <CalendarModal selectedDate={selectedDate} onSelect={d => { setSelectedDate(d); setTab(0); }} onClose={() => setShowCal(false)} index={index} />}
    </div>
  );
}
