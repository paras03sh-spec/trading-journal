// Shared helpers for Questrade integration. Not a route itself (filename
// starts with _), imported by the actual route handlers.
//
// Key mechanic: Questrade refresh tokens are SINGLE-USE — every exchange
// returns a NEW refresh token that must be persisted, and the old one is
// invalidated immediately. If we ever fail to save the new one, the
// connection breaks and needs reconnecting from scratch. So every exchange
// here writes the new refresh_token back to Supabase before returning.

export async function getValidAccessToken(supabase, userId, forceRefresh = false) {
  const { data, error } = await supabase
    .from('questrade_tokens')
    .select('refresh_token, access_token, api_server, access_token_expires')
    .eq('user_id', userId)
    .single();
  if (error || !data) return { error: 'No Questrade connection for this user. Connect first.' };

  // Still valid? Reuse it — don't burn a refresh-token rotation unnecessarily.
  // Unless forceRefresh is set: Questrade itself already told us this token
  // is invalid (a 401 came back despite our stored expiry saying it should
  // still be good) — trust Questrade's own answer over our local clock.
  if (!forceRefresh && data.access_token && data.api_server && data.access_token_expires && new Date(data.access_token_expires) > new Date()) {
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
  if (position.questrade_symbol_id) return { symbolId: position.questrade_symbol_id, debug: 'cached' };
  try {
    const url = `${apiServer}v1/symbols/search?prefix=${encodeURIComponent(position.symbol)}`;
    const sRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; TradingJournalApp/1.0)' } });
    const sData = await sRes.json();
    if (!sRes.ok) {
      return { symbolId: null, debug: `search HTTP ${sRes.status}: ${JSON.stringify(sData)}`, invalidToken: sRes.status === 401 };
    }
    const candidates = sData.symbols || [];
    const exactMatches = candidates.filter(s => s.symbol === position.symbol);
    // Some tickers are dual-listed under the identical symbol string — e.g.
    // Canadian Depositary Receipts (CDRs) trade under the SAME ticker as the
    // US original (both just "NFLX"), just on a different exchange/currency.
    // Currency is the only field that disambiguates which one is meant, so
    // prefer a match on the position's own stated currency over just taking
    // the first result.
    const match = exactMatches.find(s => s.currency === position.currency) || exactMatches[0] || candidates[0];
    if (!match) {
      return { symbolId: null, debug: `no match for "${position.symbol}" — search returned ${candidates.length} candidates: ${JSON.stringify(candidates.map(c=>({symbol:c.symbol,currency:c.currency})))}` };
    }
    await supabase.from('swing_positions').update({ questrade_symbol_id: String(match.symbolId) }).eq('id', position.id);
    return { symbolId: String(match.symbolId), debug: `resolved to ${match.symbol} (${match.currency}, id ${match.symbolId})` };
  } catch (e) {
    return { symbolId: null, debug: `exception: ${e.message}` };
  }
}

// Batch quote fetch — Questrade accepts comma-separated IDs in one call.
export async function fetchQuotes(apiServer, accessToken, symbolIds) {
  if (symbolIds.length === 0) return { prices: {}, debug: 'no symbol ids to fetch' };
  const url = `${apiServer}v1/markets/quotes?ids=${symbolIds.join(',')}`;
  try {
    const qRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; TradingJournalApp/1.0)' },
    });
    const qData = await qRes.json();
    if (!qRes.ok) return { prices: {}, debug: `quotes HTTP ${qRes.status} [${url}]: ${JSON.stringify(qData)}`, invalidToken: qRes.status === 401 };
    const byId = {};
    (qData.quotes || []).forEach(q => { byId[String(q.symbolId)] = q.lastTradePrice; });
    return { prices: byId, debug: `got ${(qData.quotes||[]).length} quotes` };
  } catch (e) {
    return { prices: {}, debug: `exception: ${e.message} [${url}]` };
  }
}

// Fetches real industry sector classification for a batch of symbol IDs —
// separate endpoint from quotes (symbols/:id vs markets/quotes/:id).
export async function fetchSectors(apiServer, accessToken, symbolIds) {
  if (symbolIds.length === 0) return {};
  try {
    const sRes = await fetch(`${apiServer}v1/symbols?ids=${symbolIds.join(',')}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; TradingJournalApp/1.0)' },
    });
    const sData = await sRes.json();
    const byId = {};
    (sData.symbols || []).forEach(s => { if (s.industrySector) byId[String(s.symbolId)] = s.industrySector; });
    return byId;
  } catch (_) {
    return {};
  }
}

// USD/CAD rate via DLR.TO (CAD) / DLR.U.TO (USD) — a real ETF pair designed
// to track the same underlying basket in two currencies, so the ratio of
// their live prices is a genuine market-based FX rate, fetched through the
// exact same quote mechanism already verified working for regular positions.
export async function updateFxRate(supabase, apiServer, accessToken) {
  try {
    const searchOne = async (symbol) => {
      const sRes = await fetch(`${apiServer}v1/symbols/search?prefix=${encodeURIComponent(symbol)}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; TradingJournalApp/1.0)' },
      });
      const data = await sRes.json();
      return (data.symbols || []).find(s => s.symbol === symbol);
    };
    const [cadSym, usdSym] = await Promise.all([searchOne('DLR.TO'), searchOne('DLR.U.TO')]);
    if (!cadSym || !usdSym) return { error: 'Could not resolve DLR.TO / DLR.U.TO' };

    const { prices } = await fetchQuotes(apiServer, accessToken, [String(cadSym.symbolId), String(usdSym.symbolId)]);
    const cadPrice = prices[String(cadSym.symbolId)];
    const usdPrice = prices[String(usdSym.symbolId)];
    if (!cadPrice || !usdPrice) return { error: 'Could not get DLR quotes' };

    const rate = cadPrice / usdPrice; // CAD per 1 USD
    await supabase.from('fx_rates').upsert({ pair: 'USDCAD', rate, updated_at: new Date().toISOString() });
    return { rate };
  } catch (e) {
    return { error: e.message };
  }
}

