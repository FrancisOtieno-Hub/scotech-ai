# ScoTech AI — Deployment Guide
### Stack: Cloudflare Pages · GitHub · Neon PostgreSQL

---

## Project Structure

```
scotech-ai/
├── public/
│   └── index.html           ← Frontend (served by Cloudflare Pages)
├── functions/
│   └── api/
│       └── chat.js          ← Backend API (Cloudflare Pages Function)
├── package.json
├── _redirects
└── DEPLOY.md
```

---

## Step 1 — Neon Database (Free Tier)

1. Go to **https://neon.tech** → Create a free account
2. Create a new project → name it `scotech-ai`
3. Click **Dashboard → Connection string** → copy the `postgresql://...` URL
4. Keep this for Step 3 — this is your `DATABASE_URL`

> Neon auto-creates tables on first message (no migrations needed — handled in `chat.js`)

---

## Step 2 — Gemini API Key (Free)

1. Go to **https://aistudio.google.com/app/apikey**
2. Click **Create API Key**
3. Copy and save it — this is your `GEMINI_API_KEY`

> Free tier: 1,500 requests/day on `gemini-1.5-flash` — plenty for most use cases.

---

## Step 3 — Push to GitHub

```bash
# In your terminal
git init
git add .
git commit -m "feat: initial ScoTech AI"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/scotech-ai.git
git push -u origin main
```

---

## Step 4 — Deploy on Cloudflare Pages

1. Go to **https://dash.cloudflare.com** → **Pages** → **Create a project**
2. Connect to GitHub → select `scotech-ai` repo
3. Configure build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
4. Click **Save and Deploy**

### Add Environment Variables (critical — do this before first deploy)

In Cloudflare Pages → your project → **Settings → Environment Variables → Add variable**:

| Variable Name     | Value                          | Environment        |
|-------------------|--------------------------------|--------------------|
| `GEMINI_API_KEY`  | `AIza...` (your Gemini key)   | Production + Preview |
| `DATABASE_URL`    | `postgresql://...` (Neon URL)  | Production + Preview |

> ⚠️ These are secret — never commit them to GitHub. Cloudflare keeps them encrypted.

5. Go to **Pages → Deployments → Retry** after adding env vars

---

## Step 5 — Enable Cloudflare Pages Functions

Cloudflare detects the `functions/` folder automatically.
Make sure your project has **Compatibility flags** set:

In Cloudflare Pages → Settings → **Functions**:
- **Compatibility date:** `2024-01-01` (or latest)
- **Compatibility flags:** `nodejs_compat`

---

## Step 6 — Verify Deployment

1. Visit your URL: `https://scotech-ai.pages.dev`
2. Type a message → you should get a response from Gemini
3. Check Neon dashboard → **Tables** → you should see `sessions` and `messages` tables populated

---

## Local Development

```bash
# Install dependencies
npm install

# Create local env file
echo "GEMINI_API_KEY=your_key_here" > .dev.vars
echo "DATABASE_URL=your_neon_url_here" >> .dev.vars

# Run locally (Cloudflare Pages dev server)
npm run dev
# → Opens at http://localhost:8788
```

---

## Future Scaling

When you're ready to add image or video generation:

1. **Image:** Add `/api/image` → call `gemini-2.0-flash-exp` (image output) or Stability AI
2. **Video:** Add `/api/video` → connect Runway ML or Google Veo API
3. **Auth:** Add Cloudflare Access or Clerk for user login
4. **Rate limiting:** Use Cloudflare Workers KV for per-user request limiting

---

## Architecture Diagram

```
Browser (index.html)
      │
      │  POST /api/chat
      ▼
Cloudflare Pages Function (chat.js)
      │                    │
      │                    │ INSERT sessions/messages
      ▼                    ▼
 Google Gemini API      Neon PostgreSQL
 (AI response)          (Chat history)
```

**Your API key is NEVER exposed to the browser.** ✓
