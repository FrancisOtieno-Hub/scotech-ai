# ScoTech AI

**ScoTech AI 1.2 Lavender** — A secure, full-stack AI chat application built with Cloudflare Pages, OpenRouter, and Neon PostgreSQL. No API keys exposed to users. Installable as a Progressive Web App.

---

## Live Demo

🌐 **[scotech-ai.pages.dev](https://scotech-ai.pages.dev)**

---

## Features

- **AI Chat** — Powered by OpenRouter's free model router with multi-turn conversation memory
- **Secure Backend** — API keys never exposed to the browser; all AI calls go through a Cloudflare Pages Function
- **Chat History** — Conversations persisted to Neon PostgreSQL and cached locally
- **User Authentication** — Email/password and Google sign-in via Clerk (optional)
- **Progressive Web App** — Installable on Android, iOS, and desktop; works offline
- **Mobile Sidebar** — Responsive drawer navigation with hamburger menu
- **Export Chats** — Download any conversation as a `.txt` file
- **Delete Chats** — Remove individual sessions from history
- **Copy & Regenerate** — Action buttons on every AI message

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML, CSS, Vanilla JS | Chat UI, PWA shell |
| Backend | Cloudflare Pages Functions | Secure API proxy |
| AI | OpenRouter (`openrouter/auto`) | Free LLM routing |
| Database | Neon PostgreSQL | Chat persistence |
| Auth | Clerk | User accounts (optional) |
| Hosting | Cloudflare Pages | Global CDN, zero config |
| Version Control | GitHub | Source & CI/CD trigger |

---

## Project Structure

```
scotech-ai/
├── public/
│   ├── index.html          ← Frontend app shell
│   ├── manifest.json       ← PWA manifest
│   ├── sw.js               ← Service worker (offline + caching)
│   └── icons/              ← PWA icons (96px – 512px)
├── functions/
│   └── api/
│       └── chat.js         ← Cloudflare Pages Function (backend)
├── package.json
├── _redirects
├── DEPLOY.md               ← Step-by-step deployment guide
└── README.md
```

---

## Architecture

```
Browser (index.html)
        │
        │  POST /api/chat  (message + history)
        ▼
Cloudflare Pages Function  (chat.js)
        │                        │
        │  Bearer API Key         │  INSERT sessions/messages
        ▼                        ▼
  OpenRouter API           Neon PostgreSQL
  (AI response)            (Chat history)
```

> Your `OPENROUTER_API_KEY` and `DATABASE_URL` are stored as encrypted Cloudflare environment variables — never in the codebase or visible to users.

---

## Quick Deploy

### Prerequisites
- [GitHub](https://github.com) account
- [Cloudflare](https://dash.cloudflare.com) account (free)
- [OpenRouter](https://openrouter.ai) account (free)
- [Neon](https://neon.tech) account (free)

### Step 1 — Get your API keys

| Service | Where to get it | Env var name |
|---|---|---|
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | `OPENROUTER_API_KEY` |
| Neon | Dashboard → Connection string | `DATABASE_URL` |
| Clerk *(optional)* | Dashboard → API Keys | `CLERK_SECRET_KEY` |

### Step 2 — Fork & push to GitHub

```bash
git clone https://github.com/FrancisOtieno-Hub/scotech-ai.git
cd scotech-ai
git remote set-url origin https://github.com/YOUR_USERNAME/scotech-ai.git
git push -u origin main
```

### Step 3 — Deploy to Cloudflare Pages

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Pages** → **Create a project**
2. Connect GitHub → select your `scotech-ai` repo
3. Set build output directory to `public` — leave build command empty
4. Go to **Settings → Environment Variables** and add:

```
OPENROUTER_API_KEY   =  your_openrouter_key
DATABASE_URL         =  postgresql://...
CLERK_SECRET_KEY     =  your_clerk_key  (optional)
```

5. Go to **Settings → Functions → Compatibility flags** → add `nodejs_compat`
6. Trigger a redeploy — your app is live at `https://your-project.pages.dev`

> Full step-by-step instructions in [DEPLOY.md](./DEPLOY.md)

---

## Local Development

```bash
# Install Wrangler
npm install

# Create local environment file
cp .dev.vars.example .dev.vars
# Fill in your keys in .dev.vars

# Run locally
npm run dev
# → http://localhost:8788
```

**.dev.vars** (never commit this file):
```
OPENROUTER_API_KEY=your_key_here
DATABASE_URL=postgresql://your_neon_url
CLERK_SECRET_KEY=your_clerk_secret
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ Yes | OpenRouter API key for AI responses |
| `DATABASE_URL` | ✅ Yes | Neon PostgreSQL connection string |
| `CLERK_SECRET_KEY` | ⚪ Optional | Enables user authentication via Clerk |

---

## PWA Installation

ScoTech AI is a fully installable Progressive Web App.

| Platform | How to install |
|---|---|
| **Android (Chrome)** | Tap the "Install" banner or browser menu → Add to Home Screen |
| **iPhone (Safari)** | Tap Share → Add to Home Screen |
| **Desktop (Chrome/Edge)** | Click the install icon in the address bar |
| **In-app** | Click "Install ScoTech AI App" in the sidebar |

---

## Roadmap

- [x] Text generation with multi-turn memory
- [x] Secure backend (no client-side API keys)
- [x] Chat history with Neon PostgreSQL
- [x] User authentication (Clerk)
- [x] Mobile responsive + PWA
- [ ] Image generation (`/api/image`)
- [ ] Streaming responses
- [ ] Video generation (`/api/video`)
- [ ] Per-user rate limiting (Cloudflare KV)
- [ ] Custom system prompt per user

---

## Security

- API keys are stored as **encrypted Cloudflare environment variables**
- The frontend never sees or handles any secret keys
- All AI requests are proxied through the backend function
- Chat data is scoped per user when authentication is enabled
- CORS headers restrict API access to the app's own origin

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

---

## License

MIT © [Francis Otieno](https://github.com/FrancisOtieno-Hub)

---

<p align="center">Built with ❤️ using Cloudflare Pages · OpenRouter · Neon · Clerk</p>
