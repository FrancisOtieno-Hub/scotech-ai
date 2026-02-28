/**
 * ScoTech AI — Cloudflare Pages Function
 * Route: /api/chat  (POST)
 *
 * Features:
 *   - Auto-detects image prompts → Together AI FLUX image generation
 *   - Text prompts → OpenRouter streaming via SSE
 *   - Clerk auth (optional)
 *   - Neon PostgreSQL persistence
 *
 * Env vars (Cloudflare Pages → Settings → Environment Variables):
 *   OPENROUTER_API_KEY   — openrouter.ai/keys
 *   TOGETHER_API_KEY     — api.together.ai (free tier)
 *   CLERK_SECRET_KEY     — Clerk dashboard (optional)
 *   DATABASE_URL         — Neon PostgreSQL connection string
 */

const TEXT_MODEL  = 'openrouter/auto';
const IMAGE_MODEL = 'black-forest-labs/FLUX.1-schnell-Free';
const OR_URL      = 'https://openrouter.ai/api/v1/chat/completions';
const IMG_URL     = 'https://api.together.xyz/v1/images/generations';

// Keywords that signal an image generation request
const IMAGE_TRIGGERS = [
  'generate', 'create an image', 'create a picture', 'draw', 'paint',
  'make an image', 'make a picture', 'make a photo', 'show me a',
  'picture of', 'image of', 'photo of', 'illustration of', 'portrait of',
  'logo of', 'logo for', 'artwork', 'render', 'visualize', 'visualise',
  'design a', 'sketch', 'photograph of', 'anime', 'realistic image',
  'digital art', 'watercolor', 'oil painting',
];

function isImageRequest(message) {
  const lower = message.toLowerCase();
  return IMAGE_TRIGGERS.some(trigger => lower.includes(trigger));
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── OPTIONS ───────────────────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { sessionId, message, history = [], token } = body;

    if (!message?.trim()) return jsonRes({ error: 'Message is required.' }, 400);
    if (!env.OPENROUTER_API_KEY) return jsonRes({ error: 'OPENROUTER_API_KEY not configured.' }, 500);

    // ── Clerk auth (optional) ─────────────────────────────────────────────
    let userId = 'guest';
    if (token && env.CLERK_SECRET_KEY) {
      try {
        const v = await fetch('https://api.clerk.com/v1/tokens/verify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (v.ok) { const d = await v.json(); userId = d?.sub || d?.user_id || 'guest'; }
      } catch (_) {}
    }

    // ── Route: image or text ──────────────────────────────────────────────
    if (isImageRequest(message)) {
      return await handleImage(message, sessionId, userId, env);
    } else {
      return await handleText(message, history, sessionId, userId, env);
    }

  } catch (err) {
    console.error('[ScoTech]', err);
    return jsonRes({ error: err.message || 'Internal server error.' }, 500);
  }
}

// ── IMAGE GENERATION ──────────────────────────────────────────────────────
async function handleImage(message, sessionId, userId, env) {
  if (!env.TOGETHER_API_KEY) {
    return jsonRes({ error: 'Image generation is not configured. Add TOGETHER_API_KEY in Cloudflare.' }, 503);
  }

  const imgRes = await fetch(IMG_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.TOGETHER_API_KEY}`,
    },
    body: JSON.stringify({
      model:           IMAGE_MODEL,
      prompt:          message,
      width:           1024,
      height:          1024,
      steps:           4,
      n:               1,
      response_format: 'b64_json',
    }),
  });

  if (!imgRes.ok) {
    const err = await imgRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Together AI error ${imgRes.status}`);
  }

  const imgData = await imgRes.json();
  const b64     = imgData?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image returned from Together AI.');

  // Persist to Neon
  if (env.DATABASE_URL && sessionId) {
    try {
      await ensureTables(env.DATABASE_URL);
      const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
      await neonQuery(env.DATABASE_URL,
        `INSERT INTO sessions (id, user_id, title, updated_at) VALUES ($1,$2,$3,NOW())
         ON CONFLICT (id) DO UPDATE SET updated_at=NOW()`,
        [sessionId, userId, title]);
      await neonQuery(env.DATABASE_URL,
        `INSERT INTO messages (session_id, role, content) VALUES ($1,'user',$2),($1,'model',$3)`,
        [sessionId, message, '[Image generated]']);
    } catch (dbErr) { console.error('[DB]', dbErr.message); }
  }

  return jsonRes({ type: 'image', image: b64, prompt: message });
}

// ── TEXT GENERATION (streaming SSE) ──────────────────────────────────────
async function handleText(message, history, sessionId, userId, env) {
  const messages = [
    { role: 'system', content: 'You are ScoTech AI, a smart, friendly, and precise assistant.' },
    ...history.slice(-20).map(m => ({
      role:    m.role === 'model' ? 'assistant' : 'user',
      content: m.parts[0].text,
    })),
    { role: 'user', content: message },
  ];

  const orRes = await fetch(OR_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'HTTP-Referer':  'https://scotech-ai.pages.dev',
      'X-Title':       'ScoTech AI',
    },
    body: JSON.stringify({
      model:       TEXT_MODEL,
      messages,
      stream:      false,   // reliable non-streaming
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
      await ensureTables(env.DATABASE_URL);
      const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
      await neonQuery(env.DATABASE_URL,
        `INSERT INTO sessions (id, user_id, title, updated_at) VALUES ($1,$2,$3,NOW())
         ON CONFLICT (id) DO UPDATE SET updated_at=NOW()`,
        [sessionId, userId, title]);
      await neonQuery(env.DATABASE_URL,
        `INSERT INTO messages (session_id, role, content) VALUES ($1,'user',$2),($1,'model',$3)`,
        [sessionId, message, aiText]);
    } catch (dbErr) { console.error('[DB]', dbErr.message); }
  }

  return jsonRes({ type: 'text', reply: aiText });
}

// ── NEON HELPERS ──────────────────────────────────────────────────────────
async function ensureTables(databaseUrl) {
  await neonQuery(databaseUrl, `
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT DEFAULT 'guest',
      title TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await neonQuery(databaseUrl, `
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
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

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
