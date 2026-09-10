// Live symbol search-as-you-type, proxying Questrade's own symbol search so
// the person picks the exact listing directly (solving the CDR/dual-listing
// ambiguity by letting them see and choose, rather than us guessing).
import { createClient } from '@supabase/supabase-js';
import { getValidAccessToken } from './_questrade-lib.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Vercel environment variables.' });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const { userId, prefix } = req.body || {};
  if (!userId || !prefix || prefix.length < 1) return res.status(200).json({ results: [] });

  const tokenResult = await getValidAccessToken(supabase, userId);
  if (tokenResult.error) return res.status(200).json({ results: [], error: tokenResult.error });

  try {
    const sRes = await fetch(`${tokenResult.api_server}v1/symbols/search?prefix=${encodeURIComponent(prefix)}`, {
      headers: { Authorization: `Bearer ${tokenResult.access_token}` },
    });
    const sData = await sRes.json();
    if (!sRes.ok) return res.status(200).json({ results: [], error: `HTTP ${sRes.status}` });
    const results = (sData.symbols || []).slice(0, 15).map(s => ({
      symbol: s.symbol,
      symbolId: s.symbolId,
      description: s.description,
      currency: s.currency,
      listingExchange: s.listingExchange,
    }));
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(200).json({ results: [], error: e.message });
  }
}
