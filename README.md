# Scout Systems — Sales Overlay

Real-time AI sales coaching teleprompter for high-ticket closers. An Electron desktop app that listens to live calls, transcribes both sides in real time, and displays a transparent overlay bar showing the closer what to say next.

## Repo layout

This monorepo holds three shipping pieces:

| Path | What it is |
|------|-----------|
| `src/` | The Electron desktop app (main process, renderer, overlay, discovery tracker, AI coaching logic). Runs on the closer's Mac. |
| `backend/` | Express server deployed to Railway. Handles auth, Stripe billing, API key proxying, and the `/download` redirect. Also serves the landing page + login page as static files in `backend/public/`. |
| `scripts/` | One-off Node scripts for seeding the Supabase knowledge base with sales framework content. |

Reference docs:

- `CLAUDE.md` — architecture notes, current status, resolved issues log. Read this before making changes.
- `BUILD-PLAN.md` — phased roadmap. Current focus is Phase 1.5.
- `backend/.env.example` — every env var the backend needs, with comments.

## Run locally

**Desktop app (Electron):**

```bash
# From the repo root
npm install
npm start
```

The desktop app reads its dev env from `.env` at the repo root. Copy values from `API Keys.md` (gitignored, ask Justin for the file if you don't have it) — you need at minimum `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`.

**Backend (Express):**

```bash
cd backend
npm install
cp .env.example .env   # then fill in real values
npm run dev            # nodemon, auto-reloads
```

Health check: `curl http://localhost:3000/health` → `{"status":"ok","service":"Scout Systems Backend"}`.

## Deploy

**Backend** auto-deploys to Railway on every push to `main` (~60s). Service URL: `https://sales-overlay-production.up.railway.app`. Custom domain: `www.scoutsystems.io`.

**Desktop app** is a manual release today:

```bash
cd ~/sales-overlay   # the local build dir, NOT the iCloud canonical copy
npm version <x.y.z> --no-git-tag-version
APPLE_ID="..." APPLE_APP_SPECIFIC_PASSWORD="..." APPLE_TEAM_ID="8QN5Y29R27" npm run build
# (8-10 min for signing + notarization)
git add package.json && git commit -m "Bump to vX.Y.Z" && git push
```

Then on GitHub → Releases → Draft a new release → tag `vX.Y.Z` and upload `Scout-X.Y.Z-arm64.dmg`, `Scout-X.Y.Z.dmg`, both `.blockmap`s, and `latest-mac.yml` from `dist/`.

The `/download` route resolves the asset from the GitHub Releases API on every request (5-minute in-memory cache), so the public download link never needs updating — ship a release and it picks up automatically.

## Env vars (backend, set in Railway → Variables)

Required:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` (proxied server-side so they never ship in the app)
- `PORT` (Railway sets this automatically)

Optional but expected soon:

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` (required once billing is wired)
- `GITHUB_TOKEN` (lifts the GitHub API rate limit from 60/hr to 5000/hr — only needed if `/download` traffic spikes)

All live values belong in `API Keys.md` (gitignored). Never commit real keys to `.env`, `CLAUDE.md`, or any tracked file.

## Troubleshooting

- **Backend crash on boot / every route returns 502:** most likely a missing env var or a missing file referenced by `backend/index.js`. Check Railway logs.
- **Auto-updater not finding a new release:** confirm `latest-mac.yml` is uploaded in the GitHub Release and the `version` field inside it matches the DMG filename.
- **iCloud sync corrupted `node_modules`:** `rm -rf node_modules` and `npm install` again. See `CLAUDE.md` for the `.nosync` symlink pattern.
- **`git push` blocked by secret detection:** a secret got committed somewhere in history. Use `gitleaks detect` to find it, strip it, amend, and click the unblock-secret URL GitHub prints as a last resort.

## Two working copies — know the difference

Justin's Mac has **two** copies of this repo:

1. `~/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay/` — the **iCloud canonical copy**. Used for `npm start` (dev) and all `git` operations. This is the source of truth.
2. `~/sales-overlay/` — the **local build directory**. Used only for `npm run build` because iCloud sync corrupts `node_modules` mid-build. Do not commit from here.

When making code changes, edit the iCloud copy, commit, push. When building a release DMG, either pull in `~/sales-overlay/` first or copy changes across. Drift between these two directories has caused at least one production incident — be careful.
