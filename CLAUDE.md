# Memory

## Me
Justin Schmidt, justinschmidtsales@gmail.com. Apple Developer account under justin.schmidt23@yahoo.com. Building "Sales Overlay" as a personal side project (NOT for Net Revenue LLC). Not a developer — relies entirely on Claude for all code. No external dev will be hired until the product is generating revenue — Phase 2 will be built by Justin + Claude incrementally.

## Project: Sales Overlay
Real-time AI sales coaching teleprompter for high-ticket closers. Electron desktop app. Listens to live sales calls, transcribes in real time, displays a transparent overlay bar at top of screen showing the closer what to say next.

**Target vertical:** High-ticket coaching/consulting closers.
**Important:** No Net Revenue client content (SSI, GlobalBanks) — only universal sales framework structure.

## Tech Stack
| Tech | Purpose |
|------|---------|
| **Electron 41** | Desktop app, single unified window (overlay + controls combined) |
| **Deepgram Nova-2** | Real-time STT via raw WebSocket (SDK v5 broken, using raw WS) |
| **Anthropic Claude Sonnet** | Live teleprompter AI — always tells closer what to say next |
| **Supabase + pgvector** | Knowledge base / RAG for sales frameworks |
| **electron-audio-loopback** | Native system audio capture — no drivers needed, user just grants Screen Recording permission |
| **electron-updater** | Auto-updates via GitHub Releases |

## Key Files
| File | What |
|------|------|
| `src/main/index.js` | Main Electron process, IPC, session lifecycle, suggestion polling timer. Single overlay window only. Auto-updater wired in. |
| `src/renderer/overlay/overlay.html` | Full UI — Scout logo, mic selector, Start/Stop (red), X close (red), stacking prompt display. 50% screen width, centered. |
| `src/ai/claude.js` | ClaudeCoach — delivery detection, backchannel filtering, question-first matching, prospect response gate, closer-active protection, anti-repetition (themes + exact text), objection bypass. Tuned: 3s closer-active guard, 3-turn auto-advance, 3.5s min API interval. |
| `src/ai/prompts.js` | System prompt (live teleprompter, stage-aware), suggestion prompt builder. 30-word limit on suggestions. |
| `src/ai/objections.js` | 4 framework + 6 secondary objections, prospect-only detection, strict fuzzy matching |
| `src/ai/call-memory.js` | Rolling summary every 8 turns, 7-stage detection with progression guards + hard turn-count fallback (30t→set, 50t→discovery, 80t→transition) |
| `src/ai/knowledge-base.js` | Supabase search, client filtering, framework phase lookup |
| `src/ai/script-parser.js` | Claude API parses uploaded .txt scripts into KB entries |
| `src/preload.js` | contextBridge IPC — includes setIgnoreMouse, closeApp, logToMain |
| `src/built-config.js` | AUTO-GENERATED at build time by scripts/prebuild.js — API keys baked in, never commit |
| `scripts/prebuild.js` | Reads .env, writes src/built-config.js for packaged app |
| `scripts/notarize.js` | Apple notarization hook for electron-builder |
| `scripts/seed-frameworks.js` | 65+ KB entries for sales frameworks |
| `entitlements.plist` | macOS entitlements for hardened runtime (audio input, unsigned code) |

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
- **Closer-active guard** — 3s (was 5s). If closer spoke within last 3 seconds, all prompts frozen.
- **Backchannel filtering** — short filler words (Yeah, Right, Okay, Mhmm ≤3 words) don't reset timer, don't count toward auto-advance.
- **Prospect response gate** — after delivery, waits for prospect to answer. 45s safety valve.
- **Prospect-finished-speaking check** — waits 1.5s after prospect's last speech chunk.
- **Suggestion polling timer** — `getSuggestion()` called every 1.5s for natural pauses.
- **Question-first delivery detection** — only listens for question portion of suggestion.
- **Delivery fallbacks** — 3 closer turns = auto-advance (was 4, requires 2s gap between turns), 25s silence = auto-advance (was 30s).
- **Objections bypass everything** — fires immediately regardless of gates.

### Anti-Repetition System
- **Exact text history** — last 8 suggestions tracked, passed to Claude as "ALREADY SUGGESTED"
- **Theme/angle tracking** — last 5 unique themes, 50% keyword overlap = same theme
- **System prompt rules** — never revisit answered topics, go deeper or pivot

### Overlay Display
- **50% screen width, horizontally centered**
- **Click-through** with setIgnoreMouseEvents(true, {forward: true})
- **Stacking prompts** — new below, old fades to 60% opacity / #aaa text
- **Max 3 visible** — oldest removed when 4th appears
- **Stage badges** — blue default, red objection, green close, amber transition
- **Stop + X buttons are red** for visibility

### Audio & Transcription
- **System audio loopback** — via electron-audio-loopback, no drivers needed
- **Deepgram multichannel** — channels=2, ch0=CLOSER (mic), ch1=PROSPECT (system audio)
- **Auto-selects preferred mic** — Elgato Wave:1 preferred over webcam mics

### Stage Detection
- Rolling summary every 8 turns, Claude detects stage
- Hard turn-count fallback: 30+ turns → at least `set`, 50+ → `discovery`, 80+ → `transition`
- Stage prompt updated with turn count so Claude knows how far into call we are
- Allows skipping 2 stages forward, 3 after 30 turns, any after 50 turns

### Auto-Updater
- `electron-updater` checks for updates on launch (packaged app only, not dev)
- Publish target: GitHub Releases (`scoutsystems-js/sales-overlay`)
- Dialog prompts user to restart when update is downloaded
- **To release a new version:** bump version in package.json, then run:
  ```bash
  GH_TOKEN=REDACTED_PAT APPLE_ID="justin.schmidt23@yahoo.com" APPLE_APP_SPECIFIC_PASSWORD="ozfz-kxfp-ybec-hbvy" APPLE_TEAM_ID="8QN5Y29R27" npm run release
  ```
  This builds, signs, notarizes, and publishes to GitHub Releases automatically.

### Rate Limiting
- 3.5s min interval between API calls (was 5s)
- 2 turn minimum between calls
- Renderer logs piped to terminal via `logToMain` IPC

## Current Status: What Works
- Full overlay UI merged into single window (no separate control panel)
- Deepgram real-time transcription of both speakers
- Claude API generating next-line suggestions as live teleprompter
- Overlay: stacking prompts, question-first delivery detection, stage badges
- Prospect response gate, closer-active guard, backchannel filtering
- Suggestion polling timer (1.5s)
- 7-stage call detection with hard turn-count fallback (stage no longer gets stuck)
- Knowledge base search with framework phases
- Objection detection (prospect speech only, strict fuzzy matching)
- Anti-repetition (exact history + theme tracking)
- Call memory with rolling summaries
- Click-through overlay with drag handle
- electron-builder packaging configured (signed + notarized for macOS)
- electron-updater wired in (checks on launch, dialog on update-downloaded)
- Apple Developer account active (justin.schmidt23@yahoo.com, Team ID: 8QN5Y29R27)
- scoutsystems.io live on Railway
- Login/signup working (Supabase auth)
- Admin dashboard live at scoutsystems.io/admin.html (Justin is admin)
- User dashboard with call history and analytics
- Download page at scoutsystems.io/download.html (links to GitHub Releases)
- Supabase tables created (profiles, call_sessions, session_logs)
- Auto-profile trigger on new user signup

## Current Status: In Progress
- **DMG build / notarization** — signing works, notarization testing with Yahoo Apple ID.
  Build command: `APPLE_ID="justin.schmidt23@yahoo.com" APPLE_APP_SPECIFIC_PASSWORD="ozfz-kxfp-ybec-hbvy" APPLE_TEAM_ID="8QN5Y29R27" npm run build`

## Current Status: Not Yet Built
- Discovery Tracker (side panel checkbox overlay)
- Post-call summary
- Onboarding wizard
- Wire Electron app to POST session data to backend (so calls show in dashboard)
- Stripe billing (waiting until ready for paying users)
- SUPABASE_SERVICE_ROLE_KEY needs to be added to Railway env vars (for admin dashboard)

## Phase 2: Website & Backend (LIVE)
**scoutsystems.io is live on Railway (CNAME + TXT verified on Namecheap)**

### Website files: `website/` folder
| File | What |
|------|------|
| `website/server.js` | Express backend — auth middleware, Stripe (optional), session logging, admin API, /api/config endpoint |
| `website/public/index.html` | Landing page — dark theme, green (#22c55e), Scout logo, pricing ($197/mo placeholder) |
| `website/public/download.html` | Download page — links to latest GitHub Release DMG, install steps |
| `website/public/login.html` | Login page (Supabase auth) |
| `website/public/signup.html` | Signup + Stripe checkout redirect |
| `website/public/dashboard.html` | User dashboard — call history, objections, key facts, outcome tracking |
| `website/public/admin.html` | Admin dashboard — all users, session logs, diagnostics |
| `website/public/css/style.css` | Shared styles |
| `website/public/js/auth.js` | Supabase auth helper — fetches config from /api/config, no hardcoded keys |
| `website/railway.json` | Railway deployment config |

### Deployed to Railway via:
```bash
cd ~/sales-overlay/website && railway up
```

### Env vars set on Railway:
- `SUPABASE_URL` ✓
- `SUPABASE_ANON_KEY` ✓
- `SITE_URL` ✓
- `SUPABASE_SERVICE_ROLE_KEY` — NOT YET SET (needed for admin dashboard)
- `STRIPE_SECRET_KEY` — waiting until billing phase
- `STRIPE_PRICE_ID` — waiting until billing phase
- `STRIPE_WEBHOOK_SECRET` — waiting until billing phase

### Supabase tables (all created):
- `profiles` — user accounts, subscription status, admin flag, call count
- `call_sessions` — per-call data, transcript, key facts, objections, outcome
- `session_logs` — real-time log lines from the app
- Auto-trigger: `on_auth_user_created` → creates profile row on signup

### Justin's account:
- UUID: `15807ecc-c36b-4548-b388-82a827b97a1d`
- is_admin = true, subscription_status = active

## GitHub
- **Repo:** https://github.com/scoutsystems-js/sales-overlay
- **Owner:** scoutsystems-js
- **Default branch:** main
- **PAT:** stored in `~/sales-overlay/API Keys.md` — DO NOT COMMIT
- **Authed remote URL:** `https://scoutsystems-js:YOUR_PAT@github.com/scoutsystems-js/sales-overlay.git`
- **Push command:** `cd ~/sales-overlay && git add <files> && git commit -m "message" && git push`
- GitHub Releases are the publish target for electron-updater auto-updates

## Apple Developer / Build Signing
- **Account:** justin.schmidt23@yahoo.com
- **Team ID:** 8QN5Y29R27
- **Certificate:** Developer ID Application (installed in Keychain)
- **App-specific password:** ozfz-kxfp-ybec-hbvy (Scout Build 2)
- **Build (no publish):**
  ```bash
  APPLE_ID="justin.schmidt23@yahoo.com" APPLE_APP_SPECIFIC_PASSWORD="ozfz-kxfp-ybec-hbvy" APPLE_TEAM_ID="8QN5Y29R27" npm run build
  ```
- **Release (builds + signs + notarizes + publishes to GitHub Releases):**
  ```bash
  GH_TOKEN=YOUR_PAT APPLE_ID="justin.schmidt23@yahoo.com" APPLE_APP_SPECIFIC_PASSWORD="ozfz-kxfp-ybec-hbvy" APPLE_TEAM_ID="8QN5Y29R27" npm run release
  ```
- Output: `~/sales-overlay/dist/Scout-1.0.0.dmg`

## Resolved Issues (full history)
- Overlay used to replace prompts mid-read → fixed with delivery detection + stacking
- Delivery gate permanently blocking → fixed with timeout + turn auto-advance + prospect response gate
- Delivery detection too sensitive → fixed with stop words, 4+ char minimum, 35% threshold
- Delivery detection firing on statement → fixed with question-first extraction
- New prompts while closer speaking → fixed with closer-active guard + backchannel filtering
- New prompts before prospect answers → fixed with prospect response gate
- Prompt firing mid-prospect-answer → fixed with 1.5s prospect-silence check
- "Yeah/Right/Okay" blocking prompts → fixed with BACKCHANNEL_WORDS filter
- False objection triggers on closer → fixed with prospect-only guard
- False positive fuzzy objection matching → fixed with strict fuzzy matching
- Call memory JSON parse failures → fixed with fence stripping + max_tokens 500
- Claude repeating exact suggestion → fixed with suggestion history (last 8)
- Claude repeating same theme → fixed with theme tracking
- Call stage stuck on introduction → fixed with hard turn-count fallback + better stage prompt
- Too many API calls → fixed with interval + turn gating
- Overlay was bottom-right popup → rebuilt as full-width top bar
- AI was selective coach → rewritten as always-on teleprompter
- Old prompts too dark → raised to 60% opacity with #aaa text
- System audio on macOS → replaced with electron-audio-loopback
- package.json overwritten → restored from backup
- Control panel separate window → merged into overlay (single window)
- Overlay full screen width → resized to 50% centered
- npm global install permission error → fixed with sudo
- Railway TXT DNS record missing → added _railway-verify TXT in Namecheap
- electron in dependencies (build error) → moved to devDependencies
- teamId invalid in mac config (electron-builder 25.x) → moved to APPLE_TEAM_ID env var
- 401 notarization with Gmail Apple ID → switched to Yahoo Apple ID (justin.schmidt23@yahoo.com)

## Brand
- **Name:** Scout Systems
- **Domain:** scoutsystems.io (live)
- **Product name TBD** — "Sales Overlay" is working title
- **Colors:** dark bg (#080b0d), green (#22c55e), Scout radar SVG logo

## Preferences
- Justin is not a developer — explain things simply, provide exact terminal commands
- Always use universal sales framework structure, never client-specific content
- Test app: `cd ~/sales-overlay && npm start`
- Deploy website: `cd ~/sales-overlay/website && railway up`
- Syntax check: `node -c <file>`
