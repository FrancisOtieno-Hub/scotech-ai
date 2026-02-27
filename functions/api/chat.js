/**
 * ScoTech AI — Cloudflare Pages Function
 * Route: /api/chat  (POST)
 */

const MODEL  = 'openrouter/auto';
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Step 1: Parse body ───────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid JSON body: ' + e.message, step: 1 }, 400);
  }

  const { sessionId, message, history = [], token } = body;

  if (!message?.trim()) {
    return json({ error: 'Message is empty.', step: 1 }, 400);
  }

  // ── Step 2: Check API key ────────────────────────────────────────────────
  if (!env.OPENROUTER_API_KEY) {
    return json({ error: 'OPENROUTER_API_KEY is not set in Cloudflare environment variables.', step: 2 }, 500);
  }

  // ── Step 3: Build messages ───────────────────────────────────────────────
  const messages = [
    { role: 'system', content: 'You are ScoTech AI, a smart and helpful assistant.' },
    ...history.slice(-10).map(m => ({
      role:    m.role === 'model' ? 'assistant' : 'user',
      content: m.parts[0].text,
    })),
    { role: 'user', content: message },
  ];

  // ── Step 4: Call OpenRouter ──────────────────────────────────────────────
  let orRes;
  try {
    orRes = await fetch(OR_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer':  'https://scotech-ai.pages.dev',
        'X-Title':       'ScoTech AI',
      },
      body: JSON.stringify({
        model:       MODEL,
        messages,
        stream:      false,
        temperature: 0.85,
        max_tokens:  2048,
      }),
    });
  } catch (e) {
    return json({ error: 'Failed to reach OpenRouter: ' + e.message, step: 4 }, 502);
  }

  // ── Step 5: Check OpenRouter response ────────────────────────────────────
  if (!orRes.ok) {
    let errBody;
    try { errBody = await orRes.json(); } catch (_) { errBody = {}; }
    return json({
      error: errBody?.error?.message || `OpenRouter returned HTTP ${orRes.status}`,
      status: orRes.status,
      step: 5,
    }, 502);
  }

  // ── Step 6: Extract reply ────────────────────────────────────────────────
  let orData;
  try {
    orData = await orRes.json();
  } catch (e) {
    return json({ error: 'Could not parse OpenRouter response: ' + e.message, step: 6 }, 502);
  }

  const aiText = orData?.choices?.[0]?.message?.content;
  if (!aiText) {
    return json({ error: 'OpenRouter returned empty content.', raw: JSON.stringify(orData).slice(0, 300), step: 6 }, 502);
  }

  // ── Step 7: Persist to Neon (non-fatal) ──────────────────────────────────
  if (env.DATABASE_URL && sessionId) {
    try {
      await neonQuery(env.DATABASE_URL, `
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, user_id TEXT DEFAULT 'guest',
          title TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await neonQuery(env.DATABASE_URL, `
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
      await neonQuery(env.DATABASE_URL,
        `INSERT INTO sessions (id, user_id, title, updated_at) VALUES ($1,'guest',$2,NOW())
         ON CONFLICT (id) DO UPDATE SET updated_at=NOW()`,
        [sessionId, title]);
      await neonQuery(env.DATABASE_URL,
        `INSERT INTO messages (session_id, role, content) VALUES ($1,'user',$2),($1,'model',$3)`,
        [sessionId, message, aiText]);
    } catch (dbErr) {
      console.error('[DB Error]', dbErr.message);
      // Non-fatal — still return reply
    }
  }

  // ── Step 8: Success ──────────────────────────────────────────────────────
  return json({ reply: aiText });
}

async function neonQuery(databaseUrl, sql, params = []) {
  const url   = new URL(databaseUrl);
  const creds = btoa(`${url.username}:${url.password}`);
  const res   = await fetch(`https://${url.hostname}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type':           'application/json',
      'Authorization':          `Basic ${creds}`,
      'Neon-Connection-String': databaseUrl,
    },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!res.ok) throw new Error(`Neon ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
