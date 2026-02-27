/**
 * ScoTech AI — Cloudflare Pages Function
 * Route: /api/chat  (POST)
 *
 * ZERO npm dependencies — uses Neon's HTTP API directly.
 *
 * Environment variables (set in Cloudflare Pages dashboard):
 *   GEMINI_API_KEY   — your Google Gemini API key
 *   DATABASE_URL     — Neon PostgreSQL connection string (postgresql://...)
 */

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── CORS HEADERS ────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── MAIN HANDLER ────────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body    = await request.json();
    const { sessionId, message, history = [] } = body;

    if (!message?.trim()) {
      return json({ error: 'Message is required.' }, 400);
    }

    // ── Build Gemini conversation ──────────────────────────────────────────
    const contents = [
      ...history.slice(-20),           // last 10 pairs for context
      { role: 'user', parts: [{ text: message }] },
    ];

    // ── Call Gemini ────────────────────────────────────────────────────────
    const geminiRes = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature:      0.85,
          topK:             40,
          topP:             0.95,
          maxOutputTokens:  2048,
        },
      }),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini error ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    const aiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiText) throw new Error('Empty response from Gemini.');

    // ── Persist to Neon via HTTP API (zero npm packages) ─────────────────────
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
        // DB errors are non-fatal — AI reply still returns to user
        console.error('[ScoTech DB Error]', dbErr.message);
      }
    }

    return json({ reply: aiText });

  } catch (err) {
    console.error('[ScoTech API Error]', err);
    return json({ error: err.message || 'Internal server error.' }, 500);
  }
}

// ── OPTIONS preflight ─────────────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// ── Neon HTTP Query Helper ────────────────────────────────────────────────────
// No npm package needed — calls Neon's native HTTPS SQL endpoint directly.
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

// ── JSON response helper ──────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
