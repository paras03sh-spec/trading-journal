// Refreshes current_price on open swing positions using Questrade quotes.
// Two entry points into the same logic:
//   POST { userId } — manual "Refresh Now" button, one user, on demand.
//   GET              — Vercel Cron, once daily, loops every connected user.
// Cron requests carry a secret so this can't be triggered by anyone who
// finds the URL (Vercel signs cron requests with CRON_SECRET automatically
// when that env var is set).
import { createClient } from '@supabase/supabase-js';
import { getValidAccessToken, resolveSymbolId, fetchQuotes, fetchSectors } from './_questrade-lib.js';

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
      .select('id, symbol, questrade_symbol_id, sector, currency')
      .eq('user_id', userId)
      .eq('status', 'open');
    if (!positions || positions.length === 0) { results.push({ userId, updated: 0 }); continue; }

    const idBySymbol = {};
    const resolveDebug = [];
    for (const p of positions) {
      const { symbolId, debug } = await resolveSymbolId(supabase, api_server, access_token, p);
      resolveDebug.push(`${p.symbol}: ${debug}`);
      if (symbolId) idBySymbol[symbolId] = p.id;
    }
    const symbolIds = Object.keys(idBySymbol);
    const { prices, debug: quotesDebug } = await fetchQuotes(api_server, access_token, symbolIds);
    const sectors = await fetchSectors(api_server, access_token, symbolIds);
    const positionById = Object.fromEntries(positions.map(p => [p.id, p]));

    let updated = 0;
    for (const sid of symbolIds) {
      const positionId = idBySymbol[sid];
      const price = prices[sid];
      const sector = sectors[sid];
      const pos = positionById[positionId];
      const patch = {};
      if (price != null) { patch.current_price = price; patch.current_price_updated = new Date().toISOString(); }
      if (sector && !pos.sector) patch.sector = sector; // only fill blanks, never override a manual value
      if (Object.keys(patch).length === 0) continue;
      await supabase.from('swing_positions').update(patch).eq('id', positionId);
      updated++;
    }
    results.push({ userId, updated, total: positions.length, debug: [...resolveDebug, quotesDebug] });
  }

  return res.status(200).json({ results });
}
