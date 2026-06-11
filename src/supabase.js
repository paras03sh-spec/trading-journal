import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Day data ─────────────────────────────────────────────────────────────────
export async function loadDay(date) {
  try {
    const { data, error } = await supabase
      .from('journal_days')
      .select('data')
      .eq('date', date)
      .single();
    if (error || !data) return null;
    return data.data;
  } catch (_) { return null; }
}

export async function saveDay(date, dayData) {
  try {
    await supabase
      .from('journal_days')
      .upsert({ date, data: dayData }, { onConflict: 'date' });
  } catch (_) {}
}

// ─── Index (calendar summaries) ───────────────────────────────────────────────
export async function loadIndex() {
  try {
    const { data, error } = await supabase
      .from('journal_index')
      .select('date, pnl, esPts, nqPts, wins, trades, bias')
      .order('date', { ascending: false })
      .limit(365);
    if (error || !data) return {};
    const idx = {};
    data.forEach(row => {
      idx[row.date] = { pnl: row.pnl, esPts: row.esPts, nqPts: row.nqPts, wins: row.wins, trades: row.trades, bias: row.bias };
    });
    return idx;
  } catch (_) { return {}; }
}

export async function saveIndex(date, summary) {
  try {
    await supabase
      .from('journal_index')
      .upsert({ date, ...summary }, { onConflict: 'date' });
  } catch (_) {}
}
