// Server-side proxy for Tradovate auth — avoids browser CORS block.
// Runs on Vercel, not in the browser, so Tradovate's server sees a normal
// server-to-server request instead of a cross-origin browser fetch.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password, isDemo } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }

  const base = isDemo
    ? 'https://demo.tradovateapi.com/v1'
    : 'https://live.tradovateapi.com/v1';

  try {
    const tvRes = await fetch(base + '/auth/accesstokenrequest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: username,
        password,
        appId: 'Journal App',
        appVersion: '1.0',
        cid: 8,
        sec: 'secret',
        deviceId: 'journal-app-proxy',
      }),
    });
    const data = await tvRes.json();
    if (!tvRes.ok || !data.accessToken) {
      return res.status(tvRes.status || 401).json({ error: data.errorText || 'Tradovate auth failed', raw: data });
    }
    return res.status(200).json({ accessToken: data.accessToken });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Tradovate: ' + e.message });
  }
}
