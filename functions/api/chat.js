/**
 * ScoTech AI — Cloudflare Pages Function
 * Route: /api/chat  (POST)
 *
 * Powered by OpenRouter — zero npm dependencies.
 *
 * Environment variables (Cloudflare Pages dashboard):
 *   OPENROUTER_API_KEY  — get free at openrouter.ai/keys
 *   DATABASE_URL        — Neon PostgreSQL connection string
 */

const MODEL = 'openrouter/free';
const OR_URL   = 'https://openrouter.ai/api/v1/chat/completions';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { sessionId, message, history = [] } = body;

    if (!message?.trim()) {
      return json({ error: 'Message is required.' }, 400);
    }

    // Build messages array (OpenAI-compatible format)
    const messages = [
      {
        role: 'system',
        content: 'You are ScoTech AI, a smart and helpful assistant. Be clear, concise, and friendly.'
      },
      ...history.slice(-20).map(m => ({
        role:    m.role === 'model' ? 'assistant' : 'user',
        content: m.parts[0].text
      })),
      { role: 'user', content: message }
    ];

    // Call OpenRouter
    const orRes = await fetch(OR_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer':  'https://scotech-ai.pages.dev',
        'X-Title':       'ScoTech AI',
      },
      body: JSON.stringify({
        model:       MODEL,
        messages,
        temperature: 0.85,
        max_tokens:  2048,
      }),
    });

    if (!orRes.ok) {
      const err = await orRes.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenRouter error ${orRes.status}`);
    }

    const orData = await orRes.json();
    const aiText = orData?.choices?.[0]?.message?.content;
    if (!aiText) throw new Error('Empty response from OpenRouter.');

    // Persist to Neon
    if (env.DATABASE_URL && sessionId) {
      try {
        await neonQuery(env.DATABASE_URL, `
          CREATE TABLE IF NOT EXISTS sessions (
            id         TEXT PRIMARY KEY,
            title      TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        await neonQuery(env.DATABASE_URL, `
          CREATE TABLE IF NOT EXISTS messages (
            id         SERIAL PRIMARY KEY,
            session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
            role       TEXT NOT NULL,
            content    TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
        await neonQuery(env.DATABASE_URL, `
          INSERT INTO sessions (id, title, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
        `, [sessionId, title]);
        await neonQuery(env.DATABASE_URL, `
          INSERT INTO messages (session_id, role, content) VALUES
            ($1, 'user',  $2),
            ($1, 'model', $3)
        `, [sessionId, message, aiText]);
      } catch (dbErr) {
        console.error('[ScoTech DB Error]', dbErr.message);
      }
    }

    return json({ reply: aiText });

  } catch (err) {
    console.error('[ScoTech API Error]', err);
    return json({ error: err.message || 'Internal server error.' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

async function neonQuery(databaseUrl, sql, params = []) {
  const url   = new URL(databaseUrl);
  const host  = url.hostname;
  const creds = btoa(`${url.username}:${url.password}`);

  const res = await fetch(`https://${host}/sql`, {
    method:  'POST',
    headers: {
      'Content-Type':           'application/json',
      'Authorization':          `Basic ${creds}`,
      'Neon-Connection-String': databaseUrl,
    },
    body: JSON.stringify({ query: sql, params }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Neon HTTP ${res.status}: ${err}`);
  }

  return res.json();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
