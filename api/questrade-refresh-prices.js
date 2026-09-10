// Refreshes current_price on open swing positions using Questrade quotes.
// Two entry points into the same logic:
//   POST { userId } — manual "Refresh Now" button, one user, on demand.
//   GET              — Vercel Cron, once daily, loops every connected user.
// Cron requests carry a secret so this can't be triggered by anyone who
// finds the URL (Vercel signs cron requests with CRON_SECRET automatically
// when that env var is set).
import { createClient } from '@supabase/supabase-js';
import { getValidAccessToken, resolveSymbolId, fetchQuotes } from './_questrade-lib.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Vercel environment variables.' });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let userIds = [];
  if (req.method === 'GET') {
    // Cron: verify the request actually came from Vercel's scheduler, not
    // just someone who found this URL.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { data } = await supabase.from('questrade_tokens').select('user_id');
    userIds = (data || []).map(r => r.user_id);
  } else if (req.method === 'POST') {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    userIds = [userId];
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = [];
  for (const userId of userIds) {
    const tokenResult = await getValidAccessToken(supabase, userId);
    if (tokenResult.error) { results.push({ userId, error: tokenResult.error }); continue; }
    const { access_token, api_server } = tokenResult;

    const { data: positions } = await supabase
      .from('swing_positions')
      .select('id, symbol, questrade_symbol_id')
      .eq('user_id', userId)
      .eq('status', 'open');
    if (!positions || positions.length === 0) { results.push({ userId, updated: 0 }); continue; }

    const idBySymbol = {};
    for (const p of positions) {
      const sid = await resolveSymbolId(supabase, api_server, access_token, p);
      if (sid) idBySymbol[sid] = p.id;
    }
    const symbolIds = Object.keys(idBySymbol);
    const prices = await fetchQuotes(api_server, access_token, symbolIds);

    let updated = 0;
    for (const [sid, price] of Object.entries(prices)) {
      if (price == null) continue;
      const positionId = idBySymbol[sid];
      await supabase.from('swing_positions').update({
        current_price: price,
        current_price_updated: new Date().toISOString(),
      }).eq('id', positionId);
      updated++;
    }
    results.push({ userId, updated, total: positions.length });
  }

  return res.status(200).json({ results });
}
