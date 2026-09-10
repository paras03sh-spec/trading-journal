// Handles the initial Questrade connection: the person pastes a refresh
// token generated in their own Questrade account (Security → API Centre →
// Personal Apps → Generate refresh token). This exchanges it once and
// stores the result — after this, the connection self-renews via
// getValidAccessToken, since Questrade rotates the refresh token on every
// use and we always persist the new one.
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Vercel environment variables (Project Settings → Environment Variables). Add it, then redeploy.' });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const { userId, refreshToken } = req.body || {};
  if (!userId || !refreshToken) return res.status(400).json({ error: 'Missing userId or refreshToken' });

  try {
    const qRes = await fetch(`https://login.questrade.com/oauth2/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`);
    const data = await qRes.json();
    if (!qRes.ok || !data.access_token) {
      return res.status(qRes.status || 401).json({ error: data.error_description || 'Questrade rejected that refresh token — generate a fresh one in Questrade\'s API Centre and try again.' });
    }
    const expiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString();
    await supabase.from('questrade_tokens').upsert({
      user_id: userId,
      refresh_token: data.refresh_token,
      access_token: data.access_token,
      api_server: data.api_server,
      access_token_expires: expiresAt,
      updated_at: new Date().toISOString(),
    });
    return res.status(200).json({ connected: true });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Questrade: ' + e.message });
  }
}
