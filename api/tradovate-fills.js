// Server-side proxy for Tradovate fills/orders — same CORS-avoidance reason
// as tradovate-auth.js. Accepts the access token from the client (obtained
// via /api/tradovate-auth) and fetches fills + orders on its behalf.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, isDemo } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const base = isDemo
    ? 'https://demo.tradovateapi.com/v1'
    : 'https://live.tradovateapi.com/v1';

  try {
    const [fillsRes, ordersRes] = await Promise.all([
      fetch(base + '/fill/list', { headers: { Authorization: 'Bearer ' + token } }),
      fetch(base + '/order/list', { headers: { Authorization: 'Bearer ' + token } }),
    ]);
    if (!fillsRes.ok) {
      const t = await fillsRes.text();
      return res.status(fillsRes.status).json({ error: 'Fill fetch failed: ' + t });
    }
    const fills = await fillsRes.json();
    const orders = ordersRes.ok ? await ordersRes.json() : [];

    // Resolve contract names server-side too (Tradovate returns contractId, not name)
    const contractIds = [...new Set(fills.map(f => f.contractId).filter(Boolean))];
    let contractMap = {};
    if (contractIds.length) {
      const results = await Promise.all(contractIds.map(async id => {
        try {
          const r = await fetch(base + '/contract/item?id=' + id, { headers: { Authorization: 'Bearer ' + token } });
          if (!r.ok) return null;
          const c = await r.json();
          return [id, c.name];
        } catch (_) { return null; }
      }));
      results.forEach(r => { if (r) contractMap[r[0]] = r[1]; });
    }
    const enrichedFills = fills.map(f => ({ ...f, contractName: contractMap[f.contractId] || '' }));

    return res.status(200).json({ fills: enrichedFills, orders });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Tradovate: ' + e.message });
  }
}
