// Shared helpers for Questrade integration. Not a route itself (filename
// starts with _), imported by the actual route handlers.
//
// Key mechanic: Questrade refresh tokens are SINGLE-USE — every exchange
// returns a NEW refresh token that must be persisted, and the old one is
// invalidated immediately. If we ever fail to save the new one, the
// connection breaks and needs reconnecting from scratch. So every exchange
// here writes the new refresh_token back to Supabase before returning.

export async function getValidAccessToken(supabase, userId) {
  const { data, error } = await supabase
    .from('questrade_tokens')
    .select('refresh_token, access_token, api_server, access_token_expires')
    .eq('user_id', userId)
    .single();
  if (error || !data) return { error: 'No Questrade connection for this user. Connect first.' };

  // Still valid? Reuse it — don't burn a refresh-token rotation unnecessarily.
  if (data.access_token && data.api_server && data.access_token_expires && new Date(data.access_token_expires) > new Date()) {
    return { access_token: data.access_token, api_server: data.api_server };
  }

  // Expired or missing — exchange the refresh token for a fresh one.
  try {
    const qRes = await fetch(`https://login.questrade.com/oauth2/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(data.refresh_token)}`);
    const tok = await qRes.json();
    if (!qRes.ok || !tok.access_token) {
      return { error: tok.error_description || 'Questrade token refresh failed — the connection may need to be re-established.' };
    }
    const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString();
    await supabase.from('questrade_tokens').upsert({
      user_id: userId,
      refresh_token: tok.refresh_token, // rotated — MUST persist or the connection breaks next time
      access_token: tok.access_token,
      api_server: tok.api_server,
      access_token_expires: expiresAt,
      updated_at: new Date().toISOString(),
    });
    return { access_token: tok.access_token, api_server: tok.api_server };
  } catch (e) {
    return { error: 'Could not reach Questrade: ' + e.message };
  }
}

// Resolves a ticker to Questrade's internal numeric symbolId, using the
// cached value on the position if present (avoids re-resolving on every
// single refresh — symbol IDs don't change).
export async function resolveSymbolId(supabase, apiServer, accessToken, position) {
  if (position.questrade_symbol_id) return position.questrade_symbol_id;
  try {
    const sRes = await fetch(`${apiServer}v1/symbols/search?prefix=${encodeURIComponent(position.symbol)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const sData = await sRes.json();
    const match = (sData.symbols || []).find(s => s.symbol === position.symbol) || (sData.symbols || [])[0];
    if (!match) return null;
    await supabase.from('swing_positions').update({ questrade_symbol_id: String(match.symbolId) }).eq('id', position.id);
    return String(match.symbolId);
  } catch (_) {
    return null;
  }
}

// Batch quote fetch — Questrade accepts comma-separated IDs in one call.
export async function fetchQuotes(apiServer, accessToken, symbolIds) {
  if (symbolIds.length === 0) return {};
  try {
    const qRes = await fetch(`${apiServer}v1/markets/quotes/${symbolIds.join(',')}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const qData = await qRes.json();
    const byId = {};
    (qData.quotes || []).forEach(q => { byId[String(q.symbolId)] = q.lastTradePrice; });
    return byId;
  } catch (_) {
    return {};
  }
}
