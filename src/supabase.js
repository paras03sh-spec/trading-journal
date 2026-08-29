import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }
    })
  : { from(){ return { select(){ return { eq(){ return { single(){ return Promise.resolve({data:null,error:'not configured'}); }, order(){ return { limit(){ return Promise.resolve({data:[],error:'not configured'}); } }; } }; } }; }, upsert(){ return Promise.resolve({error:'not configured'}); } }; }, auth: { getSession(){ return Promise.resolve({data:{session:null}}); }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}};}, signInWithPassword(){ return Promise.resolve({error:{message:'Not configured'}}); }, signUp(){ return Promise.resolve({error:{message:'Not configured'}}); }, signOut(){ return Promise.resolve(); } } };

// ─── Auth helpers ──────────────────────────────────────────────────────────────
export async function getCurrentUser() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user || null;
  } catch (_) { return null; }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { user: data?.user || null, error };
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  return { user: data?.user || null, error };
}

export async function signOut() {
  await supabase.auth.signOut();
}

// ─── Day data ─────────────────────────────────────────────────────────────────
export async function loadDay(date, userId) {
  try {
    const { data, error } = await supabase
      .from('journal_days')
      .select('data')
      .eq('date', date)
      .eq('user_id', userId)
      .single();
    if (error || !data) return null;
    return data.data;
  } catch (_) { return null; }
}

export async function saveDay(date, dayData, userId) {
  try {
    await supabase
      .from('journal_days')
      .upsert({ date, data: dayData, user_id: userId }, { onConflict: 'date,user_id' });
  } catch (_) {}
}

// ─── Index (calendar summaries) ───────────────────────────────────────────────
export async function loadIndex(userId) {
  try {
    const { data, error } = await supabase
      .from('journal_index')
      .select('date, pnl, esPts, nqPts, wins, trades, bias')
      .eq('user_id', userId)
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

// ─── Load all days (for Analytics + Claude context) ───────────────────────────
export async function loadAllDays(userId) {
  try {
    const { data, error } = await supabase
      .from('journal_days')
      .select('date, data')
      .eq('user_id', userId)
      .order('date', { ascending: true });
    if (error || !data) return [];
    return data;
  } catch (_) { return []; }
}

export async function saveIndex(date, summary, userId) {
  try {
    await supabase
      .from('journal_index')
      .upsert({ date, ...summary, user_id: userId }, { onConflict: 'date,user_id' });
  } catch (_) {}
}
