// Server-side proxy for Claude — keeps the Anthropic API key out of the
// browser bundle entirely. The client calls this endpoint; this function
// calls api.anthropic.com with the real key, which lives only in Vercel's
// server environment (ANTHROPIC_API_KEY, no REACT_APP_ prefix).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel environment variables (Project Settings → Environment Variables). Add it without the REACT_APP_ prefix, then redeploy.' });
  }

  const { system, messages, max_tokens } = req.body || {};
  if (!messages) return res.status(400).json({ error: 'Missing messages' });

  try {
    const aRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: max_tokens || 2500,
        system,
        messages,
      }),
    });
    const data = await aRes.json();
    if (!aRes.ok) {
      return res.status(aRes.status).json({ error: data.error?.message || 'Claude API error', raw: data });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach Claude API: ' + e.message });
  }
}
