# Memory

## Me
Justin Schmidt, justinschmidt@netrevenue.io. Building "Sales Overlay" as a personal side project (NOT for Net Revenue LLC). Not a developer — relies entirely on Claude for all code. No external dev will be hired until the product is generating revenue — Phase 2 will be built by Justin + Claude incrementally.

## Project: Sales Overlay
Real-time AI sales coaching teleprompter for high-ticket closers. Electron desktop app. Listens to live sales calls, transcribes in real time, displays a transparent overlay bar at top of screen showing the closer what to say next.

**Target vertical:** High-ticket coaching/consulting closers.
**Important:** No Net Revenue client content (SSI, GlobalBanks) — only universal sales framework structure.

## Tech Stack
| Tech | Purpose |
|------|---------|
| **Electron 41** | Desktop app, two windows (control panel + overlay) |
| **Deepgram Nova-2** | Real-time STT via raw WebSocket (SDK v5 broken, using raw WS) |
| **Anthropic Claude Sonnet** | Live teleprompter AI — always tells closer what to say next |
| **Supabase + pgvector** | Knowledge base / RAG for sales frameworks |
| **electron-audio-loopback** | Native system audio capture — no drivers needed, user just grants Screen Recording permission |

## Key Files
| File | What |
|------|------|
| `src/main/index.js` | Main Electron process, IPC, session lifecycle, suggestion polling timer |
| `src/renderer/overlay/overlay.html` | Overlay bar — stacking prompt display (60% opacity for old prompts, light gray text) |
| `src/renderer/control/index.html` | Control panel UI with audio device selectors |
| `src/renderer/control/control.js` | Audio capture, device enumeration, session controls |
| `src/ai/claude.js` | ClaudeCoach — delivery detection, backchannel filtering, question-first matching, prospect response gate, closer-active protection, anti-repetition (themes + exact text), objection bypass |
| `src/ai/prompts.js` | System prompt (live teleprompter mode — follow the conversation, not a script), suggestion prompt builder with 5 params (transcript, objection, KB, memory, history) |
| `src/ai/objections.js` | 4 framework + 6 secondary objections, prospect-only detection, strict fuzzy matching (4+ word triggers, 2+ distinctive words, edit distance ≤1) |
| `src/ai/call-memory.js` | Rolling summary every 8 turns (max_tokens: 500), 7-stage detection with progression guards |
| `src/ai/knowledge-base.js` | Supabase search, client filtering, framework phase lookup |
| `src/ai/script-parser.js` | Claude API parses uploaded .txt scripts into KB entries |
| `src/preload.js` | contextBridge IPC (includes logToMain for debug) |
| `scripts/seed-frameworks.js` | 65+ KB entries for sales frameworks |
| `scripts/clear-and-reseed.js` | Wipes and reseeds Supabase KB |

## Sales Frameworks in KB
- **Identity Shifting** objection methodology (Isolate > Binary Identity > Historical Pattern > Mirror Reality > Identity Choice)
- **SPAIN** discovery (Situation > Pain > Accountability > Implications > Needs Payoff)
- **V-L-F-A-R** dialogue (Validate > Label > Frame > Ask > Repeat)
- 4 main objection frameworks: Money (8 phases), Spouse (8), Think About It (10), No Time (6)
- 7 call stages: Introduction, Set, Discovery, Transition, Pitch, Close, Objection Handling

## Current Architecture Decisions

### Prompt Flow (the core loop)
1. Prompt appears in overlay (statement + question)
2. System listens for the QUESTION portion only (extracts questions via `?` detection)
3. Closer reads/paraphrases the question → delivery detected (35% fuzzy match on meaningful words)
4. System WAITS for prospect to respond (prospect response gate)
5. Prospect speaks → "Prospect responded — ready for next prompt"
6. Prospect finishes (1.5s silence) → Claude API generates next suggestion
7. New prompt appears below, old prompt fades to 60% opacity (still readable)

### Key Protections
- **Closer-active guard** — if closer spoke within last 5 seconds (real speech only — backchannels excluded), ALL timeouts and new prompts are frozen. No prompt ever pops up mid-sentence.
- **Backchannel filtering** — short filler words (Yeah, Right, Okay, Mhmm, etc. — 3 words or fewer) do NOT reset the closer-active timer, do NOT count toward the 4-turn auto-advance, and do NOT accumulate in delivery detection. Without this, saying "Yeah" every few seconds would permanently block new prompts.
- **Prospect response gate** — after delivery, system waits for prospect to actually answer before generating next prompt. 45s safety valve (only fires when closer is silent).
- **Prospect-finished-speaking check** — waits 1.5s after prospect's last speech chunk before firing next suggestion, so it doesn't fire mid-answer.
- **Suggestion polling timer** — `getSuggestion()` is called every 1.5s (in addition to on each transcript) so natural pauses in conversation still trigger prompts even when nobody is speaking.
- **Question-first delivery detection** — splits suggestion into statement vs question parts, only listens for the question. Closer can skip/use the statement mirror freely.
- **Delivery fallbacks** — 4 closer turns = auto-advance (only if 2s+ gap between turns, prevents Deepgram chunking false triggers), 30s of silence = auto-advance. Both still require prospect response after.
- **Objections bypass everything** — objection detection fires immediately regardless of delivery/prospect gates (they're urgent).

### Anti-Repetition System
- **Exact text history** — last 8 suggestions tracked, passed to Claude as "ALREADY SUGGESTED"
- **Theme/angle tracking** — last 5 unique themes tracked by headline keyword overlap (50% match = same theme). Passed as "ANGLES ALREADY EXPLORED"
- **System prompt rules** — explicit instructions to never revisit answered topics, go deeper on answers or pivot

### Overlay Display
- **50% screen width, horizontally centered**, positioned at top of screen (y=0)
- **Auto-resizing window** — window height syncs to bar content height via `resize-overlay` IPC so the window never extends beyond the visible dark bar. This means clicks below the bar pass through naturally without needing `setIgnoreMouseEvents`. Do NOT use `setIgnoreMouseEvents` for click-through — auto-resize is the correct approach.
- **Control panel hidden** (`show: false` in createControlWindow) — audio capture runs there invisibly
- **Overlay controls** — Scout logo + brand name center-left, Start (green) / Stop (red) / X buttons top-right. Start triggers `startSession('generic')`, Stop triggers `stopSession()`, X triggers `quitApp()`
- **Top row is sticky** (`position: sticky; top: 0`) — buttons always visible even when prompts stack below
- **Drag handle** — top-left corner, 48px wide
- **Stacking prompts** — new prompts appear below, old ones fade to 60% opacity with #aaa text color
- **Max 3 visible** — oldest removed when 4th appears
- **Stage badges** — color-coded (blue default, red objection, green close, amber transition)
- **Rounded bottom corners** (`border-radius: 0 0 10px 10px`)

### Discovery Tracker
- **Separate window** — top-right corner of screen (x = screen.width - 190, y = 0), 190px wide
- **Hidden until session starts** — appears on Start, hides + resets on Stop
- **7 checkboxes** — Finances/Budget, Willing to Do the Work, Pain Identified, Goals/Vision, Timeline/Urgency, Decision Maker Confirmed, Why Now
- **Auto-checks via call memory** — after each rolling summary (every 8 turns), Claude detects which items have been covered and checks them off. Once checked, never unchecked.
- **Live financial details under Finances row** — when the prospect shares specific numbers (income, savings, budget, cashflow, debt, credit), Claude extracts them into `discovery.financeDetails` (array of short strings capped at 8 entries). The details render as a green-bar-accented list directly under the Finances checkbox, and are also passed into `getContext()` so the suggestion engine can reference them during money objections. Dedupes on text, never drops entries mid-call.
- **No extra API cost** — detection + financial extraction are added to the existing call memory summary prompt, not a separate call
- **Auto-resizes** to content height via `resize-discovery` IPC (same pattern as overlay) — resize fires after every update so the panel grows as details are added

### Audio & Transcription
- **System audio loopback** — prospect audio captured natively via electron-audio-loopback (no BlackHole/virtual drivers needed). User grants Screen Recording permission.
- **Deepgram multichannel** — channels=2, channel 0 = CLOSER (mic), channel 1 = PROSPECT (system loopback)
- **Auto-selects preferred mic** — Elgato Wave:1 auto-selected over webcam mics

### Rate Limiting
- 5s min interval + 2 turn minimum between Claude API calls
- Renderer logs piped to terminal via `logToMain` IPC + `renderer-log` handler

## Current Status: What Works
- Deepgram real-time transcription of both speakers (closer mic + system audio loopback)
- Claude API generating next-line suggestions as live teleprompter
- Overlay bar with stacking prompts and question-first delivery detection
- Prospect response gate — next prompt waits for prospect to answer
- Closer-active protection — never interrupts mid-sentence
- Backchannel filtering — "Yeah/Right/Okay" don't block the system
- Suggestion polling timer — prompts fire during natural pauses, not just on new transcripts
- 7-stage call detection (introduction through objection handling) with progression guards
- Knowledge base search with framework phases
- Objection detection (prospect speech only, strict fuzzy matching with edit distance)
- Anti-repetition (exact suggestion history + theme/angle tracking)
- Script upload + parse infrastructure (untested by user)
- Call memory with rolling summaries (500 max_tokens, fence-stripped JSON)
- Overlay with drag handle, Scout logo, Start/Stop/X buttons — buttons confirmed working
- Sticky top row — Stop/X always visible even when prompts stack below
- Discovery Tracker — side panel top-right, 7 auto-checking items driven by call memory + live financial detail extraction under the Finances row
- Audio device enumeration and dual-input UI
- Stage progression allows skipping 2 stages, 3 after 30 turns, any after 50 turns
- Signed + notarized universal .dmg (arm64 + x64) via electron-builder using Apple Developer ID (identity `1CD4B87D…`, team `8QN5Y29R27`)
- App bundles ship with the Scout icon (`build/icon.icns` referenced via `build.mac.icon` in `package.json`)
- GitHub repo at github.com/scoutsystems-js/sales-overlay (PAT lives in `API Keys.md` only — never in committed files)
- Auto-updater (electron-updater) pointed at GitHub Releases — `latest-mac.yml` + DMGs + blockmaps uploaded per release
- GitHub Release v1.0.0 and v1.0.1 published with signed + notarized DMGs; v1.0.1 adds the macOS app icon
- Project synced to iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay/`) with node_modules and dist as `.nosync` symlinks
- Supabase user_profiles table live — stores onboarding wizard data (niche, offer, pricing, payment URLs) with RLS scoped to auth.uid(). Migration at backend/migrations/001_user_profiles.sql.

## Current Status: What's Being Tuned
1. **Prompt firing speed** — Target: fires within ~1.5s of prospect finishing. With polling timer + backchannel fix this should now work. Still being tested.
2. **Delivery detection sensitivity** — Currently 35% threshold with question-first matching. May need further tuning based on real call testing.
3. **Deepgram transcription quality** — System audio (YouTube/loopback) sometimes garbles badly, which confuses Claude's suggestions. Open issue — no fix yet.
4. **Claude suggestion length** — Claude sometimes generates very long suggestions. Could benefit from a max word count instruction in the system prompt.

## Current Status: Not Yet Built
- Post-call summary
- Onboarding wizard
- Backend / auth / billing (Phase 2 — building with Claude, no external dev)
- Diagnostics dashboard (Phase 2 — see BUILD-PLAN.md for spec)
- Automated release via `npm run release` (currently manual — DMGs uploaded to GitHub Releases via web UI since `gh` CLI isn't installed locally)

## Resolved Issues (full history)
- Overlay used to replace prompts mid-read → fixed with delivery detection + stacking
- Delivery gate permanently blocking → fixed with timeout (30s) + turn (4) auto-advance + prospect response gate
- Delivery detection too sensitive (common words triggering) → fixed with 80+ stop words, 4+ char minimum, 35% threshold
- Delivery detection firing on statement before question asked → fixed with question-first extraction (splits on `?`)
- New prompts popping up while closer still speaking → fixed with closer-active guard (5s) + backchannel filtering
- New prompts popping up before prospect answers → fixed with prospect response gate
- Prompt appearing mid-question (closer mid-sentence) → fixed: maxSecondsBeforeAutoAdvance 20s→30s, 4-turn auto-advance now requires 2s gap between turns, closerActiveThreshold kept at 5s
- Prompt not updating for 4-5 questions → fixed with 1.5s polling timer in main/index.js + backchannel filtering
- Prompt firing mid-prospect-answer → fixed with 1.5s prospect-silence check in getSuggestion()
- "Yeah/Right/Okay" backchannels blocking new prompts → fixed with BACKCHANNEL_WORDS filter + isBackchannel() function
- False objection triggers on closer's speech → fixed with prospect-only guard
- False positive objection detection from fuzzy matching → fixed with strict fuzzy (4+ word triggers, 2+ distinctive 5+ char words, ALL must match, edit distance ≤1)
- Call memory JSON parse failures from markdown code fences → fixed with fence stripping
- Call memory JSON parse failures from truncated responses → fixed by increasing max_tokens from 300 to 500
- Claude repeating exact same suggestion → fixed with suggestion history (last 8)
- Claude repeating same theme/angle with variations → fixed with theme tracking (headline keyword overlap)
- Call stage stuck on introduction → fixed by relaxing stage progression (allow 2-stage skips, more after 30/50 turns)
- Too many API calls → fixed with interval + turn gating
- Overlay was bottom-right popup → rebuilt as full-width top bar
- AI was selective coach → rewritten as always-on teleprompter
- Old prompts too dark to read (30% opacity) → raised to 60% opacity with #aaa text
- desktopCapturer can't capture system audio on macOS → replaced with manual audio device selector + BlackHole → replaced with electron-audio-loopback (zero user setup)
- package.json got overwritten (missing electron/start script) → restored from sales-overlay-backup-2026-04-08.zip
- GitHub push authentication failure → fixed by embedding PAT token directly in remote URL (`https://scoutsystems-js:TOKEN@github.com/...`)
- GitHub 100MB file size limit on dist/ and node_modules/ → fixed with .gitignore + `git rm -r --cached` + fresh `git init`
- Microphone permission loop in packaged app → fixed with `session.defaultSession.setPermissionRequestHandler`, `NSMicrophoneUsageDescription` in package.json extendInfo, and ad-hoc codesign
- iCloud sync corrupting node_modules → fixed with `rm -rf node_modules.nosync && npm install`
- overlay.html deadlocked by iCloud (EDEADLK) → fixed by writing to Downloads and running `cp` in terminal
- codesign "resource fork/detritus" error → fixed with `xattr -cr` before codesign
- dist/ syncing 2.33GB to iCloud → fixed by renaming to `dist.nosync` and creating symlink
- Overlay buttons not clicking (setIgnoreMouseEvents blocking all events) → fixed by removing setIgnoreMouseEvents and auto-resizing window to bar height via `resize-overlay` IPC — window never extends beyond visible dark bar so clicks below pass through naturally
- Stop/X buttons hidden when prompts appeared → fixed by making top-row `position: sticky; top: 0` and removing `bar.scrollTop = bar.scrollHeight`
- electron-builder hanging on build → caused by cleared cache forcing re-download of Electron binaries (~200MB). Fix: run `npm run build:unsigned` and wait 5-10 min. Do NOT use ELECTRON_BUILDER_OFFLINE=true (breaks binary rename).
- Packaged app showed default Electron icon → `~/sales-overlay/build/` was missing `icon.icns` (and entitlements) AND `build.mac.icon` wasn't set in `~/sales-overlay/package.json`. Fixed by `cp`'ing icon + entitlements from the iCloud copy to `~/sales-overlay/build/` and patching `build.mac.icon = "build/icon.icns"`. Confirmed fixed in v1.0.1.
- `~/sales-overlay` (local build dir) can drift from iCloud copy → the iCloud folder has `build/` assets the local dir may be missing. Always verify `build/icon.icns` + `build/entitlements.mac.plist` exist in `~/sales-overlay/build/` before building.
- GitHub push protection blocking `git push` due to secrets in commits → Anthropic API key in old initial commit's `.env:2`, PAT in `CLAUDE.md`. Fix: strip secrets from tracked files, amend commit, click the `unblock-secret` URL GitHub prints for secrets in unreachable old commits, then `git push --force`. Going forward: keep all secrets in `API Keys.md` (gitignored) — NEVER commit them to `CLAUDE.md` or `.env`.
- `gh release create` failed with `command not found: gh` → GitHub CLI not installed on Justin's Mac. Workaround: create releases via GitHub web UI (Releases → Draft a new release → drag DMGs + `.blockmap`s + `latest-mac.yml` from `dist/`). Long-term fix: `brew install gh` if we want to automate.
- Live site (www.scoutsystems.io) rendering as unstyled plain HTML → `website/public/index.html` references `/css/style.css` but the CSS file was never committed to GitHub (only existed in Justin's local `~/sales-overlay/website/public/css/style.css`). Fixed by `git add website/public/css/style.css && git commit && git push` (commit `75bd6a0`). Railway auto-redeployed in ~60s and the site rendered correctly. Root cause was NOT the DNS work — the CSS was missing since the initial website deploy (commit `feba9a9`) and just went unnoticed.
- Namecheap MX records don't live in Advanced DNS → Host Records section → they live in the **Mail Settings** section, which is a separate dropdown farther down the Advanced DNS page. Set Mail Settings to **Custom MX** to enable the MX records table.
- Namecheap ALIAS Record at apex can be flaky with Railway → switched to `URL Redirect Record @ → https://www.scoutsystems.io`. Only works over HTTP (Namecheap's redirect servers don't listen on 443); HTTPS to bare domain times out. Planned fix: migrate DNS to Cloudflare.
- Namecheap "Failed to save record" error when adding SPF TXT `v=spf1 include:_spf.google.com ~all` → the tilde `~` character causes the save to fail in Namecheap's UI. Fix: use `-all` (hard fail) instead of `~all` (soft fail). Functionally stricter but fine for a domain that only sends via Google.
- Google Workspace MX verification failing on first retry even though MX is correct + globally propagated → normal. Google docs: activation can take up to 72 hours. Just retry every ~30 min.
- Railway provisions a **different** `*.up.railway.app` endpoint for each custom domain (e.g., `ujcd5dfv` for the old bare domain, `vdy3qiy5` for the new `www` domain). Both route to the same underlying service. Make sure to update any CNAME records to the NEW endpoint when Railway asks for it — using an old endpoint will 404.
- Force-push on origin silently wiped 5 commits of backend code (`de4836d`, `8b5bdb3`, `c6b028e`, `d9e2fe6`, `671d3cc`) → Railway kept running an older cached build while the current `main` was missing `backend/routes/auth.js`, `backend/routes/billing.js`, `backend/routes/proxy.js`, `backend/middleware/auth.js`, `backend/package.json`, `Procfile`, `railway.json`. Login endpoints 404'd, nobody noticed for days because `/health` kept working. Fixed by recovering from git reflog (`git checkout 671d3cc -- <paths>`) and committing restore as `0e669f8`. Prevention: branch protection on `main` (no force-push), `.gitignore` covering all secrets on `main`, pre-commit `gitleaks` hook. See README.md.

## Brand
- **Name:** Scout Systems
- **Domain:** scoutsystems.io
- **Product name TBD** — "Sales Overlay" is the working title, may rename for launch

## GitHub & Railway Deployment

### Project layout (iCloud root: `~/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay/`)
- `src/` — Electron desktop app source
- `backend/` — Railway-deployed Express backend (auth, billing, API proxy) + landing page
- `backend/public/` — static website served by backend (`index.html` landing, `login.html`)
- `build/` — electron-builder icons + entitlements
- `dist` → `dist.nosync` (symlinked, kept out of iCloud)
- `node_modules` — kept local (iCloud sync breaks it; use `.nosync` pattern if re-created)
- `package.json` — Electron app manifest
- `railway.json`, `Procfile` — Railway config
- `API Keys.md` — all secrets in one place (gitignored)
- `.env` — local desktop app env
- `sales-overlay/` (nested folder) — OLD copy of the project, ignore

### GitHub
- **Repo:** https://github.com/scoutsystems-js/sales-overlay
- **Owner:** `scoutsystems-js`
- **Default branch:** `main`
- **Used for:** source for the Electron app AND the Railway backend in one repo; also the electron-builder auto-updater release target
- **PAT (scoutsystems-js):** stored in `API Keys.md` only (NEVER paste into `CLAUDE.md` or any tracked file — GitHub push protection will block the push)
- **Authed remote URL format:** `https://scoutsystems-js:<PAT>@github.com/scoutsystems-js/sales-overlay.git` (substitute the PAT from `API Keys.md` when setting up a new clone)
- **Push command:** `cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/sales-overlay && git add <files> && git commit -m "message" && git push`
- **Auto-deploy:** every push to `main` triggers a Railway redeploy of the backend (~60s)
- **Release workflow (manual, v1.0.1 baseline):**
  1. `cd ~/sales-overlay && npm version <x.y.z> --no-git-tag-version`
  2. `APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=8QN5Y29R27 npm run build` (~8–10 min for signing + notarization)
  3. `git add package.json && git commit -m "Bump to vX.Y.Z" && git push`
  4. GitHub → Releases → Draft a new release → tag `vX.Y.Z` → drag `Scout-X.Y.Z-arm64.dmg`, `Scout-X.Y.Z.dmg`, both `.blockmap`s, and `latest-mac.yml` from `dist/`
  5. Done. Auto-updater picks up the release for existing installs; the website's `/download` endpoint resolves the new DMG automatically within 5 minutes (cache TTL). Never need to update a hardcoded URL.

### Railway
- **Service public URL:** https://sales-overlay-production.up.railway.app
- **Custom domain:** www.scoutsystems.io is the canonical live URL — CNAME `www` in Namecheap → `vdy3qiy5.up.railway.app` (Railway provisioned a new endpoint when `www` was added as a custom domain; the old `ujcd5dfv` target is no longer used). Bare `scoutsystems.io` uses a Namecheap **URL Redirect Record** → `https://www.scoutsystems.io` (permanent 301). Known limitation: Namecheap URL Redirects don't serve HTTPS, so `https://scoutsystems.io` times out (HTTP 000) — users typing the bare domain with HTTPS-first browsers hit an SSL error. Permanent fix requires migrating DNS to Cloudflare for CNAME flattening + edge SSL at the apex.
- **Builder:** NIXPACKS (configured via `railway.json`)
- **Build command:** `cd backend && npm install`
- **Start command:** `cd backend && node index.js` (same in `Procfile`)
- **Node version:** `>=20.0.0` (per `backend/package.json` engines)
- **Health check:** `GET /health` returns `{"status":"ok","service":"Scout Systems Backend"}`
- **Routes served by backend:**
  - `/` → landing page (`backend/public/index.html`)
  - `/login` → web login page (`backend/public/login.html`)
  - `/auth/*` → signup / login / verify (Supabase-backed, `backend/routes/auth.js`)
  - `/billing/*` → Stripe checkout + webhook (`backend/routes/billing.js`; `/billing/webhook` uses raw body)
  - `/proxy/*` → API proxy (`backend/routes/proxy.js`, keeps Deepgram/Anthropic keys server-side)
  - `/download` → 302 redirects to the latest Mac universal .dmg from GitHub Releases (`backend/routes/download.js`). Variants: `/download/mac` (universal, same), `/download/mac/arm64` (Apple Silicon only), `/download/latest-mac.yml` (auto-updater manifest passthrough), `/download/version` (JSON: current tag, name, published date, release URL). Resolves the asset URL from the GitHub API at request time with a 5-minute in-memory cache — the download button on login.html points to `/download` and never has to change when a new version ships. Optional `GITHUB_TOKEN` env var lifts the 60/hr unauthenticated rate limit to 5000/hr if we ever need it.
  - `/health` → health check

### Railway environment variables (set in Railway → Variables)
Keys themselves live in `API Keys.md` (gitignored). Variable names set in Railway:
```
DEEPGRAM_API_KEY
ANTHROPIC_API_KEY
SUPABASE_URL           (https://vkprybqmryiuwbdwdlpk.supabase.co — not secret)
SUPABASE_ANON_KEY      (public key, safe to reference)
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY                # add when Stripe is wired
STRIPE_WEBHOOK_SECRET            # add when webhook is configured
STRIPE_PRICE_ID                  # $197/month price ID
DEEPGRAM_PROJECT_ID              # for Deepgram usage proxy
PORT=3000
BACKEND_URL=https://sales-overlay-production.up.railway.app
SKIP_AUTH=true                   # flip to false once auth is tested
```

### Domain / DNS (Namecheap → Railway + Google Workspace)
- Registrar: Namecheap
- **Advanced DNS records:**
  - `CNAME www` → `vdy3qiy5.up.railway.app` (Railway www endpoint)
  - `TXT _railway-verify.www` → `railway-verify=0cff3f73…` (Railway www domain verification)
  - `TXT _railway-verify` → `railway-verify=622b22b1…` (stale — from the old bare-domain Railway setup, safe to delete)
  - `URL Redirect @` → `https://www.scoutsystems.io` (Permanent 301 Unmasked — HTTP-only, no HTTPS)
  - `TXT @` → `google-site-verification=Rbg5oSHK…` (Google Workspace domain ownership)
  - `TXT @` → `v=spf1 include:_spf.google.com -all` (SPF; used `-all` because Namecheap's UI choked on the tilde `~`)
  - `TXT _dmarc` → `v=DMARC1; p=none; rua=mailto:justin@scoutsystems.io`
- **Mail Settings section** (separate from Host Records — MX lives here in Namecheap):
  - `MX @` → `smtp.google.com` priority `1` (Google Workspace single-record format, 2023+)
- SSL cert (Let's Encrypt) auto-issues from Railway once TXT verifies
- **HTTPS apex limitation:** Namecheap URL Redirect Records don't listen on port 443 so `https://scoutsystems.io` times out. Fix requires migrating DNS to Cloudflare (planned — see Future Plans).

### Google Workspace (scoutsystems.io)
- **Plan:** Business Starter, $7/user/month, 14-day free trial active
- **Admin console:** https://admin.google.com (logged in as `justin@scoutsystems.io`)
- **Users to create after Gmail activates:** `justin@`, `James@`, `Josh@` (support@ added later)
- **Domain verification:** completed (TXT record at `@`)
- **Gmail activation:** in progress — DNS is correct and globally propagated (verified via `dig` from Google + Cloudflare DNS), but Google's verifier hasn't re-checked yet. Google docs note activation can take up to 72 hours. Retry every ~30 min until it flips to "verified."
- **Deliverability:** SPF + DMARC in place. DKIM must be generated in admin.google.com → Apps → Google Workspace → Gmail → Authenticate Email AFTER Gmail activates, then TXT at `google._domainkey` added to Namecheap.

### Electron app publish target (auto-updater)
- Publish provider: `github`
- Owner/repo: `scoutsystems-js/sales-overlay`
- Current release: v1.0.1 (commit `feba9a9` + version bump), signed + notarized, icon shipping
- Releases currently uploaded manually via GitHub web UI (drag DMGs + `.blockmap`s + `latest-mac.yml` from `dist/`). `npm run release` will work once `gh` CLI is installed + `GH_TOKEN` set.

## Future Plans
- **Phase 1.5 build order (next up, see BUILD-PLAN.md):** 1) Financial Tracker (DONE — live detail extraction under Finances row), 2) Onboarding Wizard (in progress — data layer done) (niche, offer, price, qualifications, payment links — PIF / 2-pay / Affirm), 3) Call Boundary Detection (auto-detect Zoom/FaceTime start & end with confirmation prompt), 4) Post-Call Summary (Win/Loss + stats screen after every call)
- Context-aware payment link surfacing: during Close / money objection, overlay shows the right payment option link based on prospect's financial situation (wired up after onboarding stores the links)
- Stripe billing fully wired (keys pending — see Railway env vars above)
- Diagnostics dashboard (Phase 3 — see BUILD-PLAN.md)
- **Migrate DNS from Namecheap to Cloudflare** — solves bare-domain HTTPS timeout via CNAME flattening + edge SSL. Free tier. Keep Namecheap as registrar, just change nameservers.
- Revoke old exposed GitHub PAT at github.com/settings/tokens (the Anthropic key is already gone from console.anthropic.com; only the PAT still needs manual revocation)
- Install `gh` CLI (`brew install gh`) so `npm run release` can push DMGs + tag in one shot instead of manual web UI upload
- See BUILD-PLAN.md for full 4-phase roadmap

## Preferences
- **Push back when warranted.** Justin doesn't want an agreeable AI. If an idea has a flaw — logical, technical, UX, strategic — call it out and explain why before implementing. If experience says something won't work, say so. Challenge, disagree, say no with reasoning. Only implement a user idea after confirming it actually makes sense. Never water down a concern to seem easier to work with. Justin is the expert on his business; Claude is the expert on the code and product patterns — push back from that expertise.
- Justin is not a developer — explain things simply, provide exact terminal commands
- Always use universal sales framework structure, never client-specific content
- Project lives in TWO places on Justin's Mac:
  - `~/Library/Mobile\ Documents/com~apple~CloudDocs/sales-overlay/` (iCloud canonical copy — `npm start` for dev)
  - `~/sales-overlay/` (local build dir — `npm run build` here for signed + notarized DMGs; watch for drift, especially in `build/`)
- Signed + notarized build: `APPLE_ID="..." APPLE_APP_SPECIFIC_PASSWORD="..." APPLE_TEAM_ID="8QN5Y29R27" npm run build` from `~/sales-overlay/` (creds live in `API Keys.md`)
- Unsigned dev build fallback: `npm run build:unsigned` then `xattr -cr dist.nosync/mac-universal/Scout.app && codesign --force --deep --sign - dist.nosync/mac-universal/Scout.app`
- When making code changes, always run `node -c <file>` to syntax check before declaring done
- Push to GitHub: `git add <files> && git commit -m "message" && git push`
- **All secrets live in `API Keys.md` (gitignored). DO NOT paste keys into `CLAUDE.md`, `.env` that's tracked, or any other committed file** — GitHub push protection will block the push.
