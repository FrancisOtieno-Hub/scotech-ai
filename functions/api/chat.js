/**
 * ScoTech AI — Cloudflare Pages Function
 * Route: /api/chat  (POST)
 *
 * Environment variables (set in Cloudflare Pages dashboard):
 *   GEMINI_API_KEY   — your Google Gemini API key
 *   DATABASE_URL     — Neon PostgreSQL connection string
 */

import { Client } from '@neondatabase/serverless';

const GEMINI_MODEL = 'gemini-1.5-flash-latest';
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

    // ── Persist to Neon ────────────────────────────────────────────────────
    if (env.DATABASE_URL && sessionId) {
      const db = new Client(env.DATABASE_URL);
      await db.connect();

      // Ensure tables exist
      await db.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          title TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS messages (
          id SERIAL PRIMARY KEY,
          session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // Upsert session
      const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
      await db.query(`
        INSERT INTO sessions (id, title, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
      `, [sessionId, title]);

      // Save both messages
      await db.query(`
        INSERT INTO messages (session_id, role, content) VALUES
          ($1, 'user',  $2),
          ($1, 'model', $3)
      `, [sessionId, message, aiText]);

      await db.end();
    }

    return json({ reply: aiText });

  } catch (err) {
    console.error('[ScoTech API Error]', err);
    return json({ error: err.message || 'Internal server error.' }, 500);
  }
}

// ── OPTIONS (preflight) ──────────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// ── Helper ───────────────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
