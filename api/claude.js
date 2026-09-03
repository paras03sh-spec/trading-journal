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

  // Prompt caching: the system prompt (trader profile + aggregates + raw
  // trade history) is identical across messages in a session as long as the
  // underlying trade data hasn't changed. Caching it means only the FIRST
  // message in a sitting pays full price — every follow-up within the TTL
  // reuses the cache at roughly 10% of normal input cost. 1-hour TTL (not
  // the 5-minute default) since real usage has gaps longer than 5 min
  // between messages. No beta header required for this as of 2026.
  const systemBlock = typeof system === 'string'
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }]
    : system;

  // Also cache the growing CONVERSATION itself, not just the system block.
  // Every call resends the full message history (that's how the API works),
  // so a long back-and-forth thread would otherwise repay full price for the
  // entire prior transcript on every single new message. Marking the last
  // "old" message (everything before the newest turn) as a cache breakpoint
  // means only the newest message is fresh/full-price — everything before it
  // reads from cache. This is what makes staying in one ongoing chat actually
  // cheaper than starting fresh ones, the way it should be.
  let cachedMessages = messages;
  if (Array.isArray(messages) && messages.length >= 2) {
    const idx = messages.length - 2; // last message before the newest turn
    cachedMessages = messages.map((m, i) => {
      if (i !== idx) return m;
      const content = typeof m.content === 'string'
        ? [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral', ttl: '1h' } }]
        : m.content;
      return { ...m, content };
    });
  }

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
        system: systemBlock,
        messages: cachedMessages,
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
