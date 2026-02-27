/**
 * ScoTech AI — Cloudflare Pages Function
 * Route: /api/chat  (POST)
 * Features: Streaming SSE, Clerk auth, Neon persistence
 *
 * Env vars needed in Cloudflare Pages dashboard:
 *   OPENROUTER_API_KEY  — openrouter.ai/keys
 *   CLERK_SECRET_KEY    — Clerk dashboard → API Keys (optional)
 *   DATABASE_URL        — Neon PostgreSQL connection string
 */

const MODEL  = 'openrouter/auto';
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { sessionId, message, history = [], token } = body;

    if (!message?.trim()) return jsonRes({ error: 'Message is required.' }, 400);

    // Verify Clerk token (gracefully optional)
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

    const messages = [
      { role: 'system', content: 'You are ScoTech AI, a smart, friendly, and precise assistant.' },
      ...history.slice(-20).map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.parts[0].text })),
      { role: 'user', content: message },
    ];

    const orRes = await fetch(OR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://scotech-ai.pages.dev',
        'X-Title': 'ScoTech AI',
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true, temperature: 0.85, max_tokens: 2048 }),
    });

    if (!orRes.ok) {
      const err = await orRes.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenRouter error ${orRes.status}`);
    }

    const { readable, writable } = new TransformStream();
    const writer  = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      let fullText = '';
      try {
        const reader  = orRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const chunk = JSON.parse(data)?.choices?.[0]?.delta?.content;
              if (chunk) {
                fullText += chunk;
                await writer.write(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
              }
            } catch (_) {}
          }
        }

        // Persist to Neon
        if (env.DATABASE_URL && sessionId && fullText) {
          try {
            await neonQuery(env.DATABASE_URL, `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT DEFAULT 'guest', title TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
            await neonQuery(env.DATABASE_URL, `CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`);
            const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
            await neonQuery(env.DATABASE_URL, `INSERT INTO sessions (id, user_id, title, updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (id) DO UPDATE SET updated_at=NOW()`, [sessionId, userId, title]);
            await neonQuery(env.DATABASE_URL, `INSERT INTO messages (session_id,role,content) VALUES ($1,'user',$2),($1,'model',$3)`, [sessionId, message, fullText]);
          } catch (dbErr) { console.error('[DB]', dbErr.message); }
        }

        await writer.write(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      } catch (e) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: e.message })}\n\n`));
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
    });

  } catch (err) {
    console.error('[ScoTech]', err);
    return jsonRes({ error: err.message || 'Internal server error.' }, 500);
  }
}

async function neonQuery(databaseUrl, sql, params = []) {
  const url   = new URL(databaseUrl);
  const creds = btoa(`${url.username}:${url.password}`);
  const res   = await fetch(`https://${url.hostname}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${creds}`, 'Neon-Connection-String': databaseUrl },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!res.ok) throw new Error(`Neon ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
