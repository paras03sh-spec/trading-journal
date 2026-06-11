import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!supabaseConfigured) {
  console.error('Supabase env vars missing — REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY must be set in Vercel. App will render but data will not save/load until configured.');
}

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : { from(){ return { select(){ return { eq(){ return { single(){ return Promise.resolve({data:null,error:'not configured'}); }, order(){ return { limit(){ return Promise.resolve({data:[],error:'not configured'}); } }; } }; } }; }, upsert(){ return Promise.resolve({error:'not configured'}); }, insert(){ return Promise.resolve({error:'not configured'}); } }; } };

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
