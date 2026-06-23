# Memory

## Me
Justin Schmidt, justinschmidtsales@gmail.com. Building "Sales Overlay" as a personal side project (NOT for Net Revenue LLC). Not a developer — relies entirely on Claude for all code. No external dev will be hired until the product is generating revenue — Phase 2 will be built by Justin + Claude incrementally.

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
| **Chart.js 4 (CDN)** | Donut charts on the /dashboard coaching view. Loaded via `cdn.jsdelivr.net`. If the CDN goes down the dashboard center numbers still render — only the rings fail. No npm dependency. |

## Key Files
| File | What |
|------|------|
| `src/main/index.js` | Main Electron process, IPC, session lifecycle, suggestion polling timer. v1.1.2: session-start logic extracted into `startSessionNow(clientId)` so device-check commit/cancel paths can both kick off a session without duplicating the original `ipcMain.on('start-session')` body. Original IPC entry point still works — it just calls the named function. v1.1.8: `startZoomWatcher()` added (3s pgrep CptHost loop); auto-fires `ipcMain.emit('stop-session', {})` when a Zoom meeting ends while a Scout session is active, so all teardown runs identically to a manual Stop. |
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
| `backend/lib/session-analytics.js` | Pure-ish aggregation helpers shared by `/me/*` and `/admin/*` analytics routes. `computeAnalytics(admin, userId, from, to)` returns outcome distribution + objection breakdown for the dashboard. `loadSessionObjections(admin, sessionId)` for per-call drill. `loadObjectionsByType(admin, userId, objectionId, from, to)` for the third-level drill (joins session_objections to call_sessions so each event carries prospect_name + session_outcome). Refactored from inline route code so the same logic powers both caller-scoped and admin-scoped queries. |
| `backend/routes/me.js` | Caller-scoped routes (`/me/*`). Holds the canonical `OBJECTION_LABEL_MAP` (10 labels → id + framework + framework_rebuttal text denormalized from `src/ai/objections.js`). Owns the extraction prompts: outcome inference from post_call_summary, per-objection coaching narrative generation, prospect name extraction from intro transcript, cross-session pattern recommendations. Routes export `_computeCoachingPatterns` so `admin.js` can dispatch to it for cross-user views. |
| `backend/web/dashboard.html` | Coaching dashboard with KB management section. Users upload winning calls, offer docs, landing pages. Admins see full KB management. Uses Chart.js via CDN. |
| `backend/web/coaching.html` | v1 coaching page — route still exists at `/coaching`. Kept for reference; not linked from nav. |

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
6. Prospect finishes (800ms silence — v1.0.7; was 1.5s in v1.0.6) → Claude API generates next suggestion
7. New prompt appears below, old prompt fades to 60% opacity (still readable)

### Key Protections
- **Closer-active guard** — a closer counts as "active" iff ALL three: (1) they've spoken at least once, (2) their last non-backchannel turn was within the last 5 seconds, and (3) they spoke MORE RECENTLY than the prospect (floor-handoff detection, added v1.0.7). When active, all timeouts and new prompts are frozen — no prompt pops up mid-sentence. Condition (3) is the fix for v1.0.6's thrash where the guard kept blocking for up to 5s after the prospect had already responded (observed cycle jo6buv: 4,284ms of post-prospect blocking). Backchannels don't stamp the closer's timer.
- **Backchannel filtering** — short filler words (Yeah, Right, Okay, Mhmm, etc. — 3 words or fewer) do NOT reset the closer-active timer, do NOT count toward the 4-turn auto-advance, and do NOT accumulate in delivery detection. Without this, saying "Yeah" every few seconds would permanently block new prompts.
- **Prospect response gate** — after delivery, system waits for prospect to actually answer before generating next prompt. 45s safety valve (only fires when closer is silent).
- **Prospect-finished-speaking check** — waits `this.prospectSilenceMs` (v1.0.7: 800ms; was 1500ms in v1.0.6) after prospect's last final transcript before firing next suggestion, so it doesn't fire mid-answer. Stacked on top of Deepgram's ~500ms endpointing delay = ~1300ms total effective silence window.
- **Suggestion polling timer** — `getSuggestion()` is called every 1.5s (in addition to on each transcript) so natural pauses in conversation still trigger prompts even when nobody is speaking.
- **Question-first delivery detection** — splits suggestion into statement vs question parts, only listens for the question. Closer can skip/use the statement mirror freely.
- **Delivery fallbacks** — 4 non-backchannel closer turns = auto-advance **if** at least `this.turnAutoAdvanceMinElapsedMs` (v1.0.8: 4000ms; was a per-pair ≥2s gap in v1.0.7) have elapsed since the FIRST closer turn after the suggestion appeared (`this.firstCloserSpeechAfterSuggestion`). Deepgram chunking protection preserved: one continuous sentence split into 4 sub-second chunks arrives within ~1-2s total, well under the 4s floor. The v1.0.7 per-pair gap false-negatived on fluid conversations where real closer bursts arrive <2s apart. Separately: 30s of total silence = auto-advance (Check 3, in `getSuggestion()`). Both still require prospect response after.
- **Objections bypass everything** — objection detection fires immediately regardless of delivery/prospect gates (they're urgent).

### Anti-Repetition System
- **Exact text history** — last 8 suggestions tracked, passed to Claude as "ALREADY SUGGESTED"
- **Theme/angle tracking** — last 5 unique themes tracked by headline keyword overlap (50% match = same theme). Passed as "ANGLES ALREADY EXPLORED"
- **System prompt rules** — explicit instructions to never revisit answered topics, go deeper on answers or pivot

### Overlay Display
- **50% screen width, horizontally centered**, positioned at `y: display.workArea.y` (just below macOS menu bar — NOT y:0 which goes behind it)
- **Auto-resizing window** — `ResizeObserver` on `.bar` sends `resize-overlay` IPC to main on every content change; main calls `setBounds` with `Math.max(44, height)`. This means clicks below the bar pass through naturally without needing `setIgnoreMouseEvents`. Do NOT use `setIgnoreMouseEvents` for click-through — auto-resize is the correct approach.
- **Control panel hidden** (`show: false` in createControlWindow) — audio capture runs there invisibly; receives `trigger-start-audio` / `trigger-stop-audio` IPC from main when overlay buttons are pressed
- **Overlay controls** — Scout logo + brand name (drag handle) center-left, Start (green) / Stop (red) / X buttons top-right. Start triggers `startSession('generic')`, Stop triggers `stopSession()`, X triggers `quitApp()`
- **Button visibility** — managed exclusively via inline `style.display` (`'flex'`/`'none'`). CSS classes carry appearance only, never `display:none`. Initial states set on HTML elements. All transitions go through `setSessionState(active)`.
- **Drag** — brand area (logo + name) is `-webkit-app-region: drag`; buttons are `-webkit-app-region: no-drag`
- **Stacking prompts** — new prompts appear below, old ones fade to 60% opacity with #aaa text color
- **Max 2 visible** (v1.0.8; was 3 in v1.0.7) — oldest removed when 3rd appears. Controlled by `MAX_VISIBLE_PROMPTS` in `overlay.html`. Sticky top row and ResizeObserver IPC both handle the smaller count automatically.
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

### Architecture Decisions
- **Voyage embeddings must stay server-side** — was found as broken dead code when the desktop app called them directly (no VOYAGE_API_KEY in desktop env). All embedding generation happens on Railway via `POST /kb/search`.
- **KB search diversity** — fetch `matchCount+3` results from Supabase, guarantee at least 1 seeded framework entry in final result set. Three-tier priority: `learned_pattern` → user uploads → seeded frameworks.
- **Auto-approve all KB uploads** — no pending/approval queue at current scale. Trickle-down scoping handles visibility: owner uploads → global, admin → team, closer → personal.
- **Post-call summarization is non-blocking** — session UI clears immediately, summary arrives async. Fires after session ends, never blocks teardown.
- **Transcript tag warning** — the prospect/closer dialogue is under tag `[deepgram]` (NOT `[memory]`, which holds CallMemory's internal logs). Any future analytics work that needs transcripts must filter on `[deepgram]` + `Transcript (final)`.

## Current Status: What Works
- Deepgram real-time transcription of both speakers (closer mic + system audio loopback)
- Claude API generating next-line suggestions as live teleprompter
- Overlay bar with stacking prompts and question-first delivery detection
- Prospect response gate — next prompt waits for prospect to answer
- Closer-active protection — never interrupts mid-sentence; clears the moment the prospect speaks more recently than the closer (v1.0.7 floor-handoff fix)
- Backchannel filtering — "Yeah/Right/Okay" don't block the system
- Suggestion polling timer — prompts fire during natural pauses, not just on new transcripts
- Knowledge base search with framework phases
- Objection detection (prospect speech only, strict fuzzy matching with edit distance)
- Anti-repetition (exact suggestion history + theme/angle tracking)
- Script upload + parse infrastructure (untested by user)
- Call memory with rolling summaries (500 max_tokens, fence-stripped JSON)
- Overlay with drag handle, Scout logo, Start/Stop/X buttons — buttons confirmed working
- Sticky top row — Stop/X always visible even when prompts stack below
- Discovery Tracker — side panel top-right, 7 auto-checking items driven by call memory + live financial detail extraction under the Finances row
- Audio device enumeration and dual-input UI
- Device check panel (v1.1.2) — mic selector with live RMS level meter appears when Start is clicked. Closer confirms mic before session starts. Skip available for experienced users. Probe runs entirely in the control window (mic-only `getUserMedia` + lightweight ScriptProcessor emitting leftRMS via `audio-level-update` IPC every audio buffer). Five new IPC channels relay overlay ↔ control through main: `device-check-start` / `device-check-ready` / `audio-level-update` / `device-check-commit` / `device-check-cancel`. Commit and cancel both fire `startSessionNow('generic')` after relaying to control.
- Post-call summary (v1.1.1) — fires async after session ends. Five sections: STAGE REACHED, DISCOVERY COMPLETE, WHAT WENT WELL, AREAS TO IMPROVE, NEXT STEP. Auto-saves to `call_sessions.post_call_summary`. Overlay panel with single Dismiss button — no outcome buttons. Migration: `backend/migrations/005_post_call_summary.sql`. Post-call summarization is non-blocking — session UI clears immediately, summary arrives async.
- Knowledge Base upload system (backend-only, no desktop build needed) — users upload content via /dashboard or /admin KB section. Three ingestion types: URL fetch, PDF parse, paste text. Voyage AI embeddings server-side (voyage-3-lite, 512-dim, VOYAGE_API_KEY on Railway). Transcript-aware chunking for `winning_call` category (5 speaker turns per chunk, 2-turn overlap, falls back to fixed word chunking if <4 turns detected). Three-tier diversity enforcement in search: `learned_pattern` → user uploads → seeded frameworks. Trickle-down scoping: owner uploads → global, admin → team, closer → personal. Migration 006 added `uploaded_by`, `scope`, `source_label` columns to `knowledge_base` and updated `match_knowledge` RPC with `p_user_id` and `p_admin_id` params for scoped visibility. New routes: `POST /kb/upload`, `GET /kb/list`, `DELETE /kb/:source_label`, `POST /kb/search`, `POST /kb/store-patterns`, `GET /kb/entries/:label`. KB search now routes through proxy (`kb.search()` → `/kb/search`) instead of direct Voyage call from desktop (was broken — no key in desktop env).
- **Adaptive Learning Engine (DESIGNED, NOT YET BUILT)** — architecture designed: after every call, Claude Sonnet extracts up to 5 high-signal moments from the transcript (`POST /proxy/extract-patterns`). Each moment stored as `category: learned_pattern`, `scope: personal` in `knowledge_base` via `POST /kb/store-patterns`. Pattern extraction fires async after post-call summary is delivered to overlay — user never waits. Requires 10+ turn minimum to skip test calls. `buildContext()` renders learned patterns as `[LEARNED PATTERN: label]` in Claude context. Promotion path to team scope supported by existing schema with no changes. KB diversity update: `learned_pattern` gets a guaranteed slot alongside seeded frameworks. Admin can change scope from personal to team (schema already supports it). Awaiting implementation.
- Signed + notarized .dmg via electron-builder using Apple Developer ID (identity `1CD4B87D…`, team `8QN5Y29R27`). **Current release: v1.1.2** (arm64 + x64, both notarized + stapled). Architecture baseline (since v1.0.4): the desktop app ships no secret API keys — all Claude + Deepgram traffic routes through the Railway backend's `/proxy/*` endpoints using short-lived ephemeral Deepgram keys. Supabase URL + anon key (both public per Supabase's own design) are hardcoded in `src/config.js`. Historical packaging milestones: v1.0.0 initial; v1.0.1 added macOS app icon; v1.0.2 fixed packaged app login; v1.0.3 attempted but the DMG had three bugs (broken logo, dead Start button, invisible onboarding wizard) all tracing to missing `.env` in the asar — v1.0.3's DMGs remain in `~/sales-overlay/dist/` alongside v1.0.4 (harmless, different filenames). v1.0.4 release notes are on GitHub Releases. v1.1.x = role-based dashboard, script upload, call boundary detection, post-call summary, device check.
- App bundles ship with the Scout icon (`build/icon.icns` referenced via `build.mac.icon` in `package.json`)
- GitHub repo at github.com/scoutsystems-js/sales-overlay (PAT lives in `API Keys.md` only — never in committed files)
- Auto-updater (electron-updater) pointed at GitHub Releases — `latest-mac.yml` + DMGs + blockmaps uploaded per release. electron-updater is lazy-required inside `initAutoUpdater()` with try/catch so a missing module never crashes the app.
- GitHub Releases: v1.0.0 initial, v1.0.1 macOS icon, v1.0.2 packaged-login fix (arm64), v1.0.3 attempted (three packaging bugs — never published), v1.0.4 (no shipped API keys, JWT refresh, proxy routing), v1.0.5 (cloud logging via SessionLogger), v1.0.6 (auto-updater 30-min polling + backend transient-failure retry + error truncation), v1.0.7 (ZIP target so macOS auto-update works + latency pass: Haiku for live suggestions, 800ms prospect-silence gate, closer-active floor-handoff), v1.0.8 (delivery gate tuning + overlay max visible prompts reduced 3→2), v1.1.0 (role-based dashboard system: /dashboard for users, /admin for admins+owners with user management; v1.1.0 Features 1+2), v1.1.1 (Feature 3 script upload + Feature 4 call boundary detection + Feature 5 post-call summary), **v1.1.2 current release** (Feature 6: device check panel — mic level meter and device selection before session start). Releases published via `gh release create` (gh CLI installed as of v1.1.0).
- Project synced to iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay/`) with node_modules and dist as `.nosync` symlinks
- Supabase user_profiles table live — stores onboarding wizard data (niche, offer, pricing, payment URLs) with RLS scoped to auth.uid(). Migration at backend/migrations/001_user_profiles.sql.
- Onboarding Wizard — 5-screen post-login setup (niche, offer, pricing, payment links, qualifications) wired to user_profiles via Supabase. Skip saves partial data, complete sets completed_at to hide wizard on future launches.
- Web login session persistence — backend/routes/auth.js returns full session (access_token, refresh_token, expires_at); login.html stores to localStorage under `scout_session_v1` key and auto-restores on reload
- Cache-Control: no-cache on all HTML files served by backend (prevents browser caching stale login/landing pages after deploys)
- gitleaks pre-commit hook installed via `.pre-commit-config.yaml` — blocks commits containing API keys or secrets before they reach GitHub

## Current Status: What's Being Tuned
1. **Delivery detection sensitivity** — Currently 35% threshold with question-first matching. May need further tuning based on real call testing.
2. **Deepgram transcription quality** — System audio (YouTube/loopback) sometimes garbles badly, which confuses Claude's suggestions. Open issue — no fix yet.

## Current Status: Not Yet Built
- Stripe billing wired end-to-end (SKIP_BILLING still true — auth works; Stripe keys pending; `SKIP_BILLING=true` means all logged-in users get full access until flipped)
- Admin UI to promote learned patterns from personal to team scope (schema already supports it — just needs a PATCH endpoint and UI button)
- Post-call analytics dashboard — charts, aggregations, win rate, objection breakdown, stage timing (Phase 3 per BUILD-PLAN.md, at `/dashboard`). The Phase 2 raw session log viewer at `/admin` is live (v1.1.0 Feature 2); remaining Phase 2 diagnostics work: search by email/session/date and one-click log copy.
- Automated `npm run release` end-to-end with `GH_TOKEN` (gh CLI is now installed and `gh release create` works as of v1.1.0; one remaining piece is wiring `GH_TOKEN` into the build env so electron-builder's `--publish always` flag can fire automatically without a manual asset upload step)
- x64 DMG for v1.0.2 (Apple notarization server returned 500 mid-build; arm64 shipped; rebuild x64 separately when Apple servers recover)

## Resolved Issues (full history)
- **Owner role RLS leak caused onboarding wizard skip + maybeSingle() errors.** `user_profiles` SELECT queries in `src/main/index.js` without `.eq('user_id', userId)` returned all rows for the owner role (which has unrestricted RLS), causing `maybeSingle()` to error on multiple results and `needsOnboardingCheck()` to see another user's completed profile and skip the wizard. Fixed by adding explicit `.eq('user_id', userId)` to all three unscoped SELECT queries: `needsOnboardingCheck()`, `get-profile` IPC handler, and `start-session` `script_summary` fetch. Rule: never rely on RLS alone to scope queries — always include explicit user filters.
- **Transcript turns are tagged `[deepgram]`, NOT `[memory]` 2026-05-25.** Critical finding during v1.1.10 objection-coaching backfill. First-pass classifier prompts kept returning "no transcript content in window" for 9 of 13 objection events despite sessions having hundreds of `[memory]` log lines. Diagnosis: `[memory]` is CallMemory's internal state (`"[memory] Updating call summary…"`, `"[memory] Stage: introduction"`, `"[memory] Key facts: 1"`) — useless to a classifier. Actual transcripts live under `[deepgram]` with shape `[deepgram] Transcript (final) [PROSPECT|CLOSER]: <text>` (38,861 such rows across the corpus). Fix: route filters `tag === '[deepgram]'` and `message.indexOf('Transcript (final)')` to isolate genuine dialogue. Future analytics work that needs transcripts MUST filter on this tag. The fallback (use all window rows when `[deepgram]` is sparse) is the right call for short sessions but `[memory]` is never useful as a primary source.
- **supabase-js default 1000-row pagination bug 2026-05-25.** First version of `extract-objections` did `select('logged_at, message').eq('session_id', X)` without explicit pagination — supabase-js silently caps at 1000 rows. Real sessions are 38-51 minutes with 3,000-7,400 log lines each; any objection in the second half of a call had an empty ±90s transcript window because those rows were never fetched. Fix: per-objection time-windowed query using `.gte('logged_at', windowStart).lte('logged_at', windowEnd)` so only the relevant slice is fetched, no row-count truncation. Rule of thumb: any unbounded `select(...).eq(...)` on a table with potentially-large per-row counts needs explicit `.limit()` or per-page query — never trust the default.
- **JSON parsing fragility on Claude responses 2026-05-25.** `JSON.parse(stripCodeFences(rawText))` was failing 100% of the time on Money Objection classification — Claude occasionally wraps JSON in narrative prose ("Here's my analysis: {...} The closer was…") that strict parsing can't see past. Fix: new `extractFirstJsonObject(text)` helper in `backend/routes/me.js` walks the string brace-by-brace tracking depth + string state to return the first balanced `{...}` block. Tries strict parse first (cheap), bracewalk only on fallback. Applied to both extract-outcome and extract-objections classifier outputs.
- **Supabase CLI workflow for autonomous DDL 2026-05-25.** Before this session, all migrations were applied manually via the Supabase dashboard SQL Editor. After verifying `supabase` CLI v2.95.4 is installed at `/opt/homebrew/bin/supabase` and already logged in (saw 3 projects including Overlay = `vkprybqmryiuwbdwdlpk`), the autonomous flow is: `supabase link --project-ref vkprybqmryiuwbdwdlpk` (one-time per working dir; creates `supabase/.temp/pooler-url` containing the DB password — `supabase/` MUST be gitignored). Then `supabase db query --linked --file backend/migrations/NNN.sql` applies any migration. `supabase db query --linked "<sql>" -o csv` runs ad-hoc queries against prod. Service-role key from `API Keys.md` (the `sb_secret_*` prefix) does NOT work for DDL — only CRUD via the REST API. The Management API (`api.supabase.com/v1/projects/.../database/query`) needs a Personal Access Token (`sbp_*` prefix in old model; under the May 2026 publishable/secret-only model, the CLI is the path of least resistance and uses session auth, not API keys).
- **DMG notarization gap discovered + recovered 2026-05-16 (v1.1.8 release).** `npm run build` with proper Apple creds (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID) successfully signs the `.app` bundle, uploads it to Apple as `Scout.zip`, gets `status: Accepted`, and staples the ticket onto the `.app` inside `dist/mac-arm64/Scout.app` and `dist/mac/Scout.app`. **But the DMG container wrapping the .app is never signed or notarized.** `xcrun stapler validate Scout-X.Y.Z-arm64.dmg` returns "does not have a ticket stapled" and `codesign -dv` returns "code object is not signed at all" — even though the `.app` *inside* the DMG passes `spctl -a -v` with `source=Notarized Developer ID`. Same gap silently affected every build since at least v1.1.6 (last verified-shipped) — explains why v1.1.7 was bumped but never released. Was blamed on the multi-line paste bug for three rebuild cycles before the diagnostic `xcrun notarytool history` proved Apple was accepting every submission. **Recovery (no rebuild required):** for each DMG, run `codesign --sign "Developer ID Application: Justin Schmidt (8QN5Y29R27)" --timestamp --options runtime <dmg>`, then `xcrun notarytool submit <dmg> --apple-id ... --password ... --team-id ... --wait` (5-10 min per DMG, both can run in parallel), then `xcrun stapler staple <dmg>`. Then verify with `xcrun stapler validate <dmg> && spctl -a -t open --context context:primary-signature <dmg>`. **Permanent fix (TODO):** investigate electron-builder 25 + `notarize: true` config — `.app` notarization runs but DMG notarization is skipped. Likely needs an `afterAllArtifactBuild` hook or `notarize.tool: "notarytool"` explicit setting. Until fixed, every release requires the manual DMG recovery sequence above. Diagnostic clue for next time: the `.app` bundles in `dist/mac/` and `dist/mac-arm64/` will be fully stapled even when the DMG isn't — that's the fingerprint of this exact bug.
- **Build-release script eliminates multi-line paste bug permanently 2026-05-16.** Multi-line pasting of `APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... npm run build` into zsh has caused at least three silent unsigned/unnotarized builds across the project's history. Permanent fix: gitignored `~/sales-overlay/build-release.sh` (mode 0755) wraps the build command with backslash-continued env-var prefix in a single bash invocation. Run as `bash ~/sales-overlay/build-release.sh`. File added to `.gitignore` (committed `2082207`). Contains Apple creds in plaintext — same trust model as `API Keys.md`. If creds rotate, edit the script. Do NOT inline-paste the env-var prefix into the terminal anymore — always use the script.
- v1.1.0 Feature 2 (Role-based dashboard system) complete — /dashboard for users (personal call history, inline log expansion), /admin for admins+owners (three-section layout: user management with role change controls + last-owner protection, session list with user filter, log detail panel). Login now redirects to correct surface by role via /auth/me. Audit trail logs all role changes. Scope violation attempts logged on all protected routes.
- v1.1.0 Feature 2 (Admin session logs page) complete — `/admin` page at `backend/web/admin.html` with two-panel layout (session list + log detail), protected by `requireRole('owner')`. New `backend/routes/admin.js` exposes `GET /admin/sessions` (cross-user list, cursor paginated via `?before=<started_at>`, unfiltered by user_id on purpose — `requireRole` is the gate) and `GET /admin/sessions/:session_id/logs` (up to 2000 rows, `total_count` from Supabase `count: 'exact'` so client shows "Showing X of Y" when capped). Emails batch-fetched once via `admin.auth.admin.listUsers({perPage:1000})` → `{user_id: email}` map for the list route; detail route uses `getUserById` for the single user. Log counts batch-computed per page via one `.in('session_id', ids)` query + JS group-by (swap to Postgres RPC when session_logs scales). Page reuses login.html's session refresh flow (`scout_session_v1` localStorage, `/auth/refresh`); 401 → `/login`, 403 → `/`. Client-side filter chips (`[claude]`, `[memory]`, `[TIMING]`, `Errors only`) + search box; all in-memory over the capped 2000 rows. Pure helpers (`buildUserEmailMap`, `computeCountsBySession`, `computeDurationSeconds`) exported on the router per the `log.js:_validateLogBatch` pattern.
- v1.1.0 Feature 1 (Role system) complete — migration 003 adds role/managed_by columns to user_profiles, current_user_role() security-definer helper, revised RLS policies on user_profiles/call_sessions/session_logs, and requireRole middleware in auth.js. Justin (justinschmidtsales@gmail.com) promoted to owner, Josh (josh@scoutsystems.io) at user. Railway live.
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
- `gh release create` failed with `command not found: gh` → GitHub CLI not installed on Justin's Mac. **Resolved as of v1.1.0**: gh CLI installed and authenticated, `gh release create v1.1.0 <assets...> --repo scoutsystems-js/sales-overlay --title ... --notes ...` works one-shot. Used to publish v1.1.0 (arm64+x64 DMGs, both ZIPs, all blockmaps, latest-mac.yml). Web UI fallback no longer needed for typical releases.
- Live site (www.scoutsystems.io) rendering as unstyled plain HTML → `website/public/index.html` references `/css/style.css` but the CSS file was never committed to GitHub (only existed in Justin's local `~/sales-overlay/website/public/css/style.css`). Fixed by `git add website/public/css/style.css && git commit && git push` (commit `75bd6a0`). Railway auto-redeployed in ~60s and the site rendered correctly. Root cause was NOT the DNS work — the CSS was missing since the initial website deploy (commit `feba9a9`) and just went unnoticed.
- Namecheap MX records don't live in Advanced DNS → Host Records section → they live in the **Mail Settings** section, which is a separate dropdown farther down the Advanced DNS page. Set Mail Settings to **Custom MX** to enable the MX records table.
- Namecheap ALIAS Record at apex can be flaky with Railway → switched to `URL Redirect Record @ → https://www.scoutsystems.io`. Only works over HTTP (Namecheap's redirect servers don't listen on 443); HTTPS to bare domain times out. Planned fix: migrate DNS to Cloudflare.
- Namecheap "Failed to save record" error when adding SPF TXT `v=spf1 include:_spf.google.com ~all` → the tilde `~` character causes the save to fail in Namecheap's UI. Fix: use `-all` (hard fail) instead of `~all` (soft fail). Functionally stricter but fine for a domain that only sends via Google.
- Google Workspace MX verification failing on first retry even though MX is correct + globally propagated → normal. Google docs: activation can take up to 72 hours. Just retry every ~30 min.
- Railway provisions a **different** `*.up.railway.app` endpoint for each custom domain (e.g., `ujcd5dfv` for the old bare domain, `vdy3qiy5` for the new `www` domain). Both route to the same underlying service. Make sure to update any CNAME records to the NEW endpoint when Railway asks for it — using an old endpoint will 404.
- Packaged app login showed "Something went wrong" → two root causes: (1) `BACKEND_URL` fell back to `http://localhost:3000` when no `.env` present in packaged build; (2) all 8 auth methods (`authLogin`, `authSignup`, `getToken`, `saveToken`, `clearToken`, `checkSubscription`, `openCheckout`, `authSuccess`) were missing from `src/preload.js` contextBridge — calling `undefined()` threw TypeError. Fixed both in v1.0.2: BACKEND_URL default changed to Railway URL, all 8 methods added to contextBridge.
- `Cannot find module 'electron-updater'` crash in packaged app → adding `"node_modules/**/*"` to electron-builder `files` array bypasses smart bundler and produces malformed asar headers (only 2 entries for electron-updater instead of 201). Fix: revert `files` to `["src/**/*", "package.json"]` (smart bundler handles transitive deps automatically) + lazy-require electron-updater inside `initAutoUpdater()` with try/catch so future packaging issues never crash the app. Confirmed fixed: `npx asar list app.asar | grep -c electron-updater` returns 201.
- Overlay showed as thin black line — three compounding causes: (1) overlay.html was missing the entire top control row (Start/Stop/X/logo) — it was only in the hidden control panel; (2) `y: 0` positioned the window behind the macOS menu bar (~24px), so only a sliver of the bar showed below it — fixed by using `y: display.workArea.y`; (3) `trigger-start-audio` / `trigger-stop-audio` IPC was sent from main to the hidden control window but control.js had no listeners — added them.
- Stop button never appeared after pressing Start — CSS had `display:none` on `.btn-stop`; JS used `style.display = ''` which clears the inline style and falls back to the CSS rule (still none). Fix: remove `display:none` from CSS class, set initial state as inline `style="display:none"` on the HTML element, use explicit `'flex'`/`'none'` in JS via `setSessionState(active)`.
- Overlay was rendering but from old packaged app (v1.0.2 DMG) — source changes in the iCloud working directory have no effect on the installed Scout.app. Always test with `npm start` from `~/Library/Mobile\ Documents/com~apple~CloudDocs/sales-overlay/` during dev; only the packaged DMG reflects built changes.
- Installed v1.0.3 DMG showed broken Scout logo, dead Start button, and invisible onboarding wizard — three separate-looking bugs with one shared root cause: `package.json` `build.files` glob was `["src/**/*", "package.json"]` which excludes `.env` and `build/icon.png` from the packaged asar. All testing had been via `npm start` from iCloud dev, which physically has those files on disk — hiding every one of these bugs until v1.0.3 was the first DMG to actually try to use them (v1.0.2's overlay had no logo image and no in-overlay Start button). Full fix in v1.0.4 via architectural refactor: (1) Scout icon moved to `src/assets/icon.png` so it ships via the existing glob, overlay.html updated to `../../assets/icon.png`; (2) `.env` eliminated from packaged app entirely — Supabase URL + anon key (public per Supabase design) hardcoded in `src/config.js`, Deepgram + Anthropic routed through Railway backend proxy via new `src/lib/proxy-client.js`; (3) onboarding wizard now actually runs the Supabase query because `createSupabaseForUser` no longer returns null on missing env vars. Lesson: if an npm-start-only test passes but the packaged app behaves differently, the `files` glob is the first suspect.
- JWT expiry silently ignored — access tokens expired after ~1 hour but the app kept proceeding with stale tokens because: (1) save-token IPC only persisted the access_token and discarded refresh_token + expires_at; (2) there was no expiry check anywhere; (3) `needsOnboardingCheck` fail-open returned false on any Supabase error, masking expired-JWT as "no wizard needed." Fix in v1.0.4: `auth-login`/`auth-signup` IPC now returns the full session; new `ensureFreshToken()` single-choke-point reads stored session, parses exp claim (with 60s grace), refreshes via `/auth/refresh` if expired, or clears session and reopens login if refresh fails. Every token-consuming IPC handler (get-token, auth-success, get-profile, save-profile) + ProxyClient go through it. Helper `decodeJwtPayload()` shared between `isJwtExpired` and `decodeUserIdFromToken` (DRY). `_refreshInFlight` singleton dedupes concurrent refreshes.
- `/proxy/*` routes returned 403 "No active subscription found" for every authenticated user — `requireSubscription` middleware at `backend/middleware/auth.js` was unconditionally querying a `subscriptions` table (which doesn't even exist yet — no migration), ignoring `SKIP_BILLING`. Desktop app's own `check-subscription` IPC already honored `SKIP_BILLING !== 'false'` and returned `{active: true, status: 'beta'}`; the backend's middleware was out of sync. Fix: add `if (process.env.SKIP_BILLING !== 'false') return next();` at top of `requireSubscription`. Unit-tested across unset / 'true' / 'false' — pass-through in the first two, falls through to DB check in the third. When Stripe gets wired, flip `SKIP_BILLING=false` in Railway env vars.
- v1.0.8 live 48-min call analysis showed Scout kept re-asking discovery questions (pain, goals, timeline) long after those topics had been confirmed — AND the Discovery Tracker checkboxes never updated on screen. Two separate root causes, both fixed in v1.0.9: (A) IPC wiring break — `preload.js` never exposed `onDiscoveryUpdate`/`onDiscoveryReset`/`resizeDiscovery` bridges, so `discovery.html` threw TypeError on load and every `discovery-update` IPC from main was dropped. Added the three bridges (commit `569921e`); added `console-message` pipes to `discoveryWindow` + `overlayWindow` so future renderer errors surface to session_logs (commit `a6e679d`). (B) Prompt blindness — CallMemory tracked 7 discovery booleans but `getContext()` only surfaced `financeDetails`; Claude inferred coverage from summary prose and often missed it. SYSTEM_PROMPT also had no rule about what to do once an item was covered. Fix: `getContext()` now emits a `DISCOVERY STATUS` section (`[DONE]` / `[NEEDED]` lines) and SYSTEM_PROMPT includes a 40-word DISCOVERY COMPLETION RULE instructing the engine never to re-ask `[DONE]` items and to advance to TRANSITION/PITCH once all are covered (commit `8aaf813`). Unicode audit: `✓`/`✗` were safe (em-dash + `→` already ship in the same prompt path) but ASCII tags chosen for explicit LLM parseability and session_logs grep-friendliness. Complementary to the existing theme/angle anti-repetition — state-based vs keyword-based, they reinforce.
- v1.0.7 post-latency-fix testing showed delivery gate blocking for 30+ seconds on fluid conversations where the closer spoke in rapid non-verbatim bursts. Root cause: Check 2 (the 4-turn auto-advance in `addTurn`) required the gap between the last two closer turns to be >2s, so rapid real bursts (<2s apart) never tripped it; the gate then had to wait for Check 3 (30s silence in `getSuggestion`). Fix in v1.0.8: replace the per-pair gap with a total-elapsed floor. New field `this.firstCloserSpeechAfterSuggestion` stamps the timestamp of the first non-backchannel closer turn post-suggestion (set once when `turnsSinceSuggestion === 1`, resets to 0 in all three sites where `turnsSinceSuggestion` resets: objection bypass path, Claude API success path, `reset()`). New named constant `this.turnAutoAdvanceMinElapsedMs = 4000` replaces the hardcoded 2000 inline check. Check 2 now fires when closer has 4+ non-backchannel turns AND ≥4000ms elapsed since their first post-suggestion turn. Deepgram chunking protection preserved — one continuous sentence split into 4 sub-second chunks arrives within ~1-2s total, still well under the 4s floor. Check 1 (35% fuzzy match), Check 3 (30s silence), backchannel filter, prospect-response gate, closer-active v1.0.7 floor-handoff all untouched. Also in v1.0.8: `MAX_VISIBLE_PROMPTS` reduced 3→2 in overlay.html per product direction — sticky top row and ResizeObserver handle the smaller count without any other changes. Commits: `d864cfd` delivery gate, `1a792b5` overlay cap, `9462b80` version bump.
- v1.0.6 live testing showed prospect-last-word → prompt-visible latency >10s, target <3s. Added diagnostic instrumentation in v1.0.7-alpha (src/lib/proxy-client.js passthrough of Anthropic `usage`, checkpoint logs `[TIMING]` at t0..t7 + `[TIMING_SUMMARY]` per cycle, gated by `SCOUT_TIMING=1`). First live-test run showed no `[TIMING]` lines despite env var set — shell paste split the env assignment from npm start; fixed by adding an unconditional `[timing-check]` startup log at the top of `src/ai/claude.js` so env-var propagation is always visible. Second live-test revealed three bottlenecks, all fixed in v1.0.7 final: (1) Claude Sonnet averaged 3,372ms per live-suggestion call — swapped `/proxy/suggest` to `claude-haiku-4-5-20251001` (new `CLAUDE_SUGGESTION_MODEL` constant in `backend/config.js`); `/proxy/memory` stays on Sonnet. (2) Prospect-silence gate was 1500ms on top of Deepgram's ~500ms endpointing — lowered to 800ms via new `this.prospectSilenceMs` class field in claude.js constructor. (3) `closerIsActive` was a pure trailing 5s window; it blocked new prompts for up to 5s after the prospect had already responded (cycle jo6buv: 4,284ms post-prospect thrash). Fixed by adding a third conjunction to the existing two (`lastCloserSpeechTime > lastProspectSpeechTime`) — the guard now clears the moment the prospect speaks more recently than the closer. All three protections preserved: mid-sentence protection, backchannel filter, 45s prospect-response safety valve. Three separate commits (`d5784fa` startup log, `b7e2598` silence gate, `537cdc2` floor-handoff). Timing instrumentation stays in for now; Phase B cleanup removes it once latency is validated.
- macOS auto-update never worked from v1.0.0 through v1.0.6 — every installed DMG stayed on its original version indefinitely, requiring manual reinstalls. Root cause: `package.json` `build.mac.target` was `{"target":"dmg","arch":[...]}` (single target), so electron-builder never produced the ZIP files that electron-updater requires for in-place macOS updates. DMGs are for initial install only; auto-update downloads a ZIP and swaps it over the running .app. Without ZIP entries in latest-mac.yml, the updater failed with `Error: ZIP file not provided` at the download step. Only discovered because a user finally checked Scout → About after multiple releases and noticed the version hadn't moved. Fix in v1.0.7: change target to array of two entries — `[{"target":"dmg","arch":[...]},{"target":"zip","arch":[...]}]`. latest-mac.yml's `path:` field now points at the arm64 zip, which is what the updater actually uses. Once everyone is on v1.0.7, every subsequent release auto-installs seamlessly. Rule of thumb: auto-update must be tested by installing a real DMG of the OLD version and watching it catch the NEW release. `npm start` in dev mode does not exercise auto-update at all.
- Every `/proxy/suggest` and `/proxy/memory` call started 404'ing mid-session with `Claude API call failed` — root cause: Anthropic retired the model ID `claude-sonnet-4-20250514` (Sonnet 4.0 from May 2025). Was only discovered via v1.0.5 cloud logging (first real production bug the logs caught). Fix: `backend/config.js` now exports `CLAUDE_MODEL = 'claude-sonnet-4-6'` used by both `/proxy/suggest` and `/proxy/memory`. Also added `formatProxyError(err, serviceLabel)` helper so upstream errors (status code + message) now surface directly in the client JSON body and session_logs instead of being masked by a generic "X API call failed" string — applied to all three proxy catch blocks (`/suggest`, `/memory`, `/deepgram-key`). 14 unit tests covering Anthropic-shaped errors, plain Errors, null, truncation. `src/ai/script-parser.js` model ID also bumped (still uses direct SDK, not proxy — refactor queued for when script upload becomes a real feature). Rule of thumb: when an upstream API breaks, the real error should be one SQL query away. Never silently wrap errors in a generic string — always include the upstream status + message (truncated).
- Deepgram `/proxy/deepgram-key` returned 404 even with API key + project ID set on Railway — the new Deepgram API key created for v1.0.4's backend lived in a different Deepgram project (`b74d3e9b-336c-4d89-87f0-061139970005`) than the one the old key was in (`a0458447-3a65-4098-a46a-3e033900258d`). Backend was hitting `POST /v1/projects/a0458447.../keys` which 404'd because the new key couldn't see that project. Fix: update `DEEPGRAM_PROJECT_ID` on Railway to match whichever project the current key actually lives in. Diagnostic: `curl -H "Authorization: Token $KEY" https://api.deepgram.com/v1/projects` returns the project(s) the key has access to. Also: the key needs `keys:write` scope to mint ephemeral keys — `usage:write` alone returns 403 INSUFFICIENT_PERMISSIONS.
- Signup on live site returned "Database error" on every attempt → root cause was a leftover `on_auth_user_created` trigger on `auth.users` running a `public.handle_new_user()` function that inserted into a `public.profiles` table (singular). That table was scaffolded from a Supabase starter template and never belonged in this project — our actual schema is `public.user_profiles` (populated by the onboarding wizard after login, not by a signup trigger). Trigger failed on every signup and rolled back the `auth.users` insert. Fix: `drop trigger if exists on_auth_user_created on auth.users; drop function if exists public.handle_new_user();` in Supabase SQL Editor. Left the empty `public.profiles` table in place — harmless, can be dropped later if desired. Do NOT re-add an auto-create-profile trigger; `user_profiles` is populated by the onboarding wizard, which is the intended flow. Diagnostic queries used: `select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;` and `select * from public.profiles;`.
- electron-builder silently skipped notarization with message `notarize options were unable to be generated` → root cause was multi-line paste of the build command. In zsh, `VAR=value` followed by a newline sets a *local shell variable*, not an exported env var. So `APPLE_ID=... \n APPLE_APP_SPECIFIC_PASSWORD=... \n npx electron-builder` reached electron-builder with ZERO Apple creds in its environment, and `@electron/notarize` silently bailed. DMGs were produced and signed with Developer ID, but `xcrun stapler validate` confirmed no ticket and `spctl` rejected them — unshippable. Fix: always run the env-var prefix and the command on ONE single line. Preferred: `cd ~/sales-overlay && APPLE_ID="..." APPLE_APP_SPECIFIC_PASSWORD="..." APPLE_TEAM_ID="8QN5Y29R27" npm run build` (single line, no newlines). Verify after build with `xcrun stapler validate dist/Scout-X.Y.Z-arm64.dmg` — should say "The validate action worked!" not "does not have a ticket stapled".
- Force-push on origin silently wiped 5 commits of backend code (`de4836d`, `8b5bdb3`, `c6b028e`, `d9e2fe6`, `671d3cc`) → Railway kept running an older cached build while the current `main` was missing `backend/routes/auth.js`, `backend/routes/billing.js`, `backend/routes/proxy.js`, `backend/middleware/auth.js`, `backend/package.json`, `Procfile`, `railway.json`. Login endpoints 404'd, nobody noticed for days because `/health` kept working. Fixed by recovering from git reflog (`git checkout 671d3cc -- <paths>`) and committing restore as `0e669f8`. Prevention: branch protection on `main` (no force-push), `.gitignore` covering all secrets on `main`, pre-commit `gitleaks` hook. See README.md.

## Brand
- **Name:** Scout Systems
- **Domain:** scoutsystems.io
- **Product name TBD** — "Sales Overlay" is the working title, may rename for launch

## GitHub & Railway Deployment

### Project layout (iCloud root: `~/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay/`)
- `src/` — Electron desktop app source
- `backend/` — Railway-deployed Express backend (auth, billing, API proxy) + landing page
- `backend/web/` — static website served by backend (`index.html` landing, `login.html`, `admin.html`). Folder is `web/` not `public/` because Railpack's Staticfile detector auto-triggers on `public/` and deploys Caddy instead of Node — rename sidesteps it (see comment at `backend/index.js:22-24`).
- `build/` — electron-builder icons + entitlements
- `dist` → `dist.nosync` (symlinked, kept out of iCloud). In `~/sales-overlay/dist/` (local build dir), failed/unshipped build artifacts are moved into `dist/archive/<label>/` instead of deleted — e.g., `dist/archive/failed-build-2026-04-22-unnotarized/` holds the v1.0.3 DMGs that built signed-but-not-notarized due to the env-var paste bug. Pattern: always move failed builds to a dated `archive/` subfolder so electron-builder can write fresh artifacts at the top level of `dist/` without conflicts, and old artifacts remain for forensics.
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
- **Release workflow (manual, v1.1.8 baseline):**
  1. `cd ~/sales-overlay && npm version <x.y.z> --no-git-tag-version`
  2. `bash ~/sales-overlay/build-release.sh` (~8–10 min). The script is gitignored and contains the APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID prefix on backslash-continued lines so the env vars always reach electron-builder. **Do NOT inline-paste the env-var prefix into the terminal** — that has caused silent unsigned builds at least three times across the project history.
  3. **Verify .app + DMG notarization separately** — the build will sign + notarize the `.app` reliably, but the DMG container is currently NOT auto-notarized (electron-builder gap, see Resolved Issues). Run: `xcrun stapler validate dist/Scout-X.Y.Z-arm64.dmg && xcrun stapler validate dist/Scout-X.Y.Z.dmg`. If either reports "does not have a ticket stapled," recover with manual sign+notarize+staple per DMG (see the DMG notarization gap entry in Resolved Issues for the exact commands). Until the electron-builder config is fixed, expect to run the manual recovery on every release.
  4. `git add package.json package-lock.json && git commit -m "Bump to vX.Y.Z" && git push` (from iCloud, not local build dir)
  5. Publish via `gh release create vX.Y.Z dist/Scout-X.Y.Z-arm64.dmg dist/Scout-X.Y.Z-arm64.dmg.blockmap dist/Scout-X.Y.Z-arm64-mac.zip dist/Scout-X.Y.Z-arm64-mac.zip.blockmap dist/Scout-X.Y.Z.dmg dist/Scout-X.Y.Z.dmg.blockmap dist/Scout-X.Y.Z-mac.zip dist/Scout-X.Y.Z-mac.zip.blockmap dist/latest-mac.yml --repo scoutsystems-js/sales-overlay --title "vX.Y.Z" --notes "..."`. Web UI fallback no longer needed (gh CLI installed since v1.1.0).
  6. Done. Auto-updater picks up the release for existing installs; the website's `/download` endpoint resolves the new DMG automatically within 5 minutes (cache TTL). Never need to update a hardcoded URL.

### Railway
- **Service public URL:** https://sales-overlay-production.up.railway.app
- **Custom domain:** www.scoutsystems.io is the canonical live URL — CNAME `www` in Namecheap → `vdy3qiy5.up.railway.app` (Railway provisioned a new endpoint when `www` was added as a custom domain; the old `ujcd5dfv` target is no longer used). Bare `scoutsystems.io` uses a Namecheap **URL Redirect Record** → `https://www.scoutsystems.io` (permanent 301). Known limitation: Namecheap URL Redirects don't serve HTTPS, so `https://scoutsystems.io` times out (HTTP 000) — users typing the bare domain with HTTPS-first browsers hit an SSL error. Permanent fix requires migrating DNS to Cloudflare for CNAME flattening + edge SSL at the apex.
- **Builder:** NIXPACKS (configured via `railway.json`)
- **Build command:** `cd backend && npm install`
- **Start command:** `cd backend && node index.js` (same in `Procfile`)
- **Node version:** `>=20.0.0` (per `backend/package.json` engines)
- **Health check:** `GET /health` returns `{"status":"ok","service":"Scout Systems Backend"}`
- **Routes served by backend:**
  - `/` → landing page (`backend/web/index.html`)
  - `/login` → web login page (`backend/web/login.html`)
  - `/admin` → admin + owner dashboard (`backend/web/admin.html`; user management with role change controls, cross-user session list, log detail; admin API at `backend/routes/admin.js`)
  - `/dashboard` → v2 donut-led coaching dashboard (`backend/web/dashboard.html`). Three donuts + Coach Summary + Recent Calls + drill-downs. No role redirect — works for everyone (admin/owner can pivot to another user via `?user=<id>` query param). v1 list-heavy version archived at `dashboard-v1.html.archived`.
  - `/coaching` → v1 coaching page (`backend/web/coaching.html`) — superseded by dashboard v2; route kept for backward compat, not linked from nav.
  - `/auth/*` → signup / login / verify / `me` (Supabase-backed, `backend/routes/auth.js`; `/auth/me` returns `{user_id, email, role}` and is the source of truth for post-login redirect)
  - `/me/*` → caller-scoped endpoints (`backend/routes/me.js`):
    - `GET /me/sessions` — call list with prospect_name + outcome_source enrichment
    - `GET /me/sessions/:id/logs` — raw session_logs rows
    - `GET /me/sessions/:id/objections` — per-call objection events with coaching narratives
    - `POST /me/sessions/:id/extract-outcome` — Claude infers win/loss/follow_up from post_call_summary
    - `POST /me/sessions/:id/extract-objections` — mines session_logs, classifies + generates coaching narrative per objection event
    - `POST /me/sessions/:id/extract-prospect-name` — Claude pulls prospect's first name from intro transcript
    - `GET /me/analytics?from=&to=` — donut data (outcome distribution + objection breakdown by type)
    - `GET /me/objections?objection_id=&from=&to=` — every event of one objection type, joined with session metadata for the third-level drill
    - `GET /me/coaching/patterns?from=&to=` — Claude-generated 3-5 cross-session coaching patterns
  - `/admin/*` → cross-user routes for admin/owner (`backend/routes/admin.js`). Mirror of `/me/*` extraction + analytics + coaching/patterns + objections-by-type routes, scope-checked: admins limited to `user_profiles.managed_by = self`, owners unrestricted. Plus the cross-user user management + session list from v1.1.0.
  - `/billing/*` → Stripe checkout + webhook (`backend/routes/billing.js`; `/billing/webhook` uses raw body)
  - `/proxy/*` → API proxy (`backend/routes/proxy.js`, keeps Deepgram/Anthropic keys server-side)
  - `/download` → 302 redirects to the latest Mac universal .dmg from GitHub Releases (`backend/routes/download.js`). Variants: `/download/mac` (universal, same), `/download/mac/arm64` (Apple Silicon only), `/download/latest-mac.yml` (auto-updater manifest passthrough), `/download/version` (JSON: current tag, name, published date, release URL). Resolves the asset URL from the GitHub API at request time with a 5-minute in-memory cache — the download button on login.html points to `/download` and never has to change when a new version ships. Optional `GITHUB_TOKEN` env var lifts the 60/hr unauthenticated rate limit to 5000/hr if we ever need it.
  - `/health` → health check

### Railway environment variables (set in Railway → Variables)
Keys themselves live in `API Keys.md` (gitignored). Variable names set in Railway:
```
DEEPGRAM_API_KEY
ANTHROPIC_API_KEY
VOYAGE_API_KEY                   # server-side embeddings for KB search
SUPABASE_URL           (https://vkprybqmryiuwbdwdlpk.supabase.co — not secret)
SUPABASE_ANON_KEY      (public key, safe to reference)
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY                # add when Stripe is wired
STRIPE_WEBHOOK_SECRET            # add when webhook is configured
STRIPE_PRICE_ID                  # $197/month price ID
DEEPGRAM_PROJECT_ID              # for Deepgram usage proxy
FATHOM_CLIENT_ID                 # Fathom OAuth (v2.0 pivot)
FATHOM_CLIENT_SECRET             # Fathom OAuth (v2.0 pivot)
FATHOM_REDIRECT_URI=https://sales-overlay-production.up.railway.app/auth/fathom/callback
FATHOM_STATE_SECRET              # HMAC-SHA256 key for the signed OAuth state JWT in /auth/fathom/*. Generate with `openssl rand -hex 32`. Treat as a database password — never commit. Rotating it invalidates any in-flight OAuth attempts but does NOT affect already-stored Fathom tokens.
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
- Current release: **v1.1.2** (arm64 + x64). Desktop app ships with zero secret API keys — all Claude + Deepgram traffic proxied through Railway. Architecture baseline from v1.0.4 still holds: JWT auto-refresh via `/auth/refresh`, proxy-minted 10-min ephemeral Deepgram keys, and SKIP_BILLING beta pass-through on `requireSubscription` middleware.
- Releases published via `gh release create v<X.Y.Z> <assets...> --repo scoutsystems-js/sales-overlay --title "v<X.Y.Z>" --notes "..."` (gh CLI installed and authenticated as of v1.1.0). Fully automated `npm run release` (build + publish in one command via electron-builder's `--publish always`) needs `GH_TOKEN` set in the build env — not yet wired but the gh CLI prerequisite is no longer blocking.

## Strategic Pivot — Scout v2.0

### Product Vision: "Jarvis for closers"

Scout v2.0 is an **AI operating system for high-ticket sales teams** — not a single feature, a stack of capability layers that compound as they ship. The original live-teleprompter product stays as an optional feature; the new core is post-call intelligence and CRM-level automation.

**Three capability layers, shipped in order:**

**Layer 1 — Call Intelligence** (building now)
- Fathom OAuth + auto-sync (Phase 1 — **COMPLETE**)
- Post-call analysis pipeline with 5 section grades
- Call library dashboard with timestamp-linked clips
- Objection intelligence dashboard

**Layer 2 — CRM Integration** (after call analysis proven)
- GHL (GoHighLevel) and Close.io to start
- HubSpot and others added later
- Read AND write: Scout updates pipeline stages, logs call activities, manages contact data
- Pipeline updates after every analyzed call
- Curated follow-up cadences per deal
- Beginning-of-day pipeline prioritization list
- Beginning-of-day overnight recap

**Layer 3 — Proactive Intelligence** (after CRM)
- BOD report: prioritized call list for the day
- Overnight recap: what changed while closer was offline
- Curated follow-ups: Scout suggests next touch per deal
- Follow-up email generation after every call

### Build Phases (in order)
- **v1.2.0 — Fathom OAuth + auto-sync** — **COMPLETE** (shipped to prod 2026-06-15 via commits `00c9630` / `c39954d` / `2f3abc4` / `df5fb4e`; migration 009 applied)
- **v1.3.0 — Post-call analysis pipeline** — Layer 1 step 2 / step 3 combined release:
  - Migration 010 (`call_analyses` + `call_highlights`)
  - Transcript normalizer (HH:MM:SS strings + numeric seconds → single numeric-seconds representation)
  - Section grader (Claude call — Intro / Discovery / Pitch / Objection Handling / Close)
  - Highlight extractor (Claude call — 5-8 moments with type + quote + observation)
  - Auto-trigger after sync completes (async; closer never waits)
  - Call library dashboard page
  - Call review page with highlights timeline as the lead section
- **v1.4.0 — Objection intelligence dashboard** — Layer 1 step 4:
  - Frequency by type across all calls
  - Handle rate per objection type
  - Drill-down to real examples with playable timestamp clips
- **v1.5.0 — CRM integration (GHL + Close.io)** — Layer 2:
  - OAuth connect per closer (same popup pattern as Fathom)
  - Pipeline stage reading and updating
  - Match analyzed calls to CRM contacts
  - Follow-up checklist — hottest leads for today
  - SMS + email draft per lead
- **v1.6.0 — Proactive Intelligence** — Layer 3:
  - BOD report: prioritized call list for the day
  - Overnight recap: what changed while closer was offline
  - Curated follow-up cadences per deal

### Recording Source Architecture
Fathom is the only recording source for now. Zoom and Google Meet will be added later.

**CRITICAL:** Before Phase 2 (the analysis pipeline) is built, a recording-source abstraction layer must be designed so the analysis pipeline is source-agnostic. The pipeline receives a **transcript object** regardless of where it came from. The transcript object shape MUST be defined before Phase 2 implementation begins. Locking the shape early is the only way to avoid a Zoom/Meet integration becoming an analysis-pipeline rewrite later.

Shape questions to answer at design time: speaker labels and identity resolution, turn-level vs sentence-level granularity, timestamp anchoring (absolute vs relative), confidence per segment, action items / highlights / summary as separate optional fields, transcript-language metadata, and whether each segment carries a back-reference to the source recording's playable URL + offset.

### Phase 2 Architecture — Post-Call Intelligence

**Pipeline (end-to-end, one row at a time):**

```
fathom_calls.sync_status='pending'
    ↓
analysis worker picks up the row
    ↓
fetch transcript + highlights + summary from Fathom with include_*=true
    ↓
normalize timestamps (HH:MM:SS strings + numeric seconds → numeric seconds)
    ↓
identify CLOSER vs PROSPECT (see Speaker Identification below)
    ↓
TWO PARALLEL CLAUDE CALLS:
  1. Section Grader      2. Highlight Extractor
    ↓                      ↓
results upsert into call_analyses + call_highlights
    ↓
fathom_calls.sync_status='processed'
```

**Two new tables (migration 010):**

`public.call_analyses` — one row per analyzed call.
- `id` uuid PK
- `fathom_call_id` uuid FK → `public.fathom_calls(id) ON DELETE CASCADE`
- `user_id` uuid FK → `auth.users(id) ON DELETE CASCADE`
- `overall_score` integer (0–100)
- `overall_summary` text
- For each of the 5 sections (`intro` / `discovery` / `pitch` / `objection` / `close`), three columns each: `<section>_grade` text, `<section>_score` integer, `<section>_notes` text. (15 columns total across the 5 sections.)
- `one_thing` text — the single actionable to do differently next time
- `follow_up_email` text — draft email body the closer can copy
- `transcript_stored` jsonb — the normalized turn array (`[{ speaker, role, text, start_seconds }, ...]`) kept on the row so the analysis is reproducible and the review page can render the timeline without re-fetching from Fathom
- `speaker_closer_name` text — what name the closer's voice was identified as in this transcript (free-form match against `recorded_by.name`)
- `analyzed_at` timestamptz
- `status` text — `pending` / `processing` / `done` / `error` (separate from `fathom_calls.sync_status`; this one tracks the *analysis* lifecycle within the row)

`public.call_highlights` — one row per highlight moment (typically 5–8 per call).
- `id` uuid PK
- `fathom_call_id` uuid FK → `public.fathom_calls(id) ON DELETE CASCADE`
- `user_id` uuid FK → `auth.users(id) ON DELETE CASCADE`
- `timestamp_seconds` integer — used in the Fathom deep link (`?t=<seconds>`)
- `speaker` text — `CLOSER` or `PROSPECT`
- `quote` text — exact words spoken at the moment
- `observation` text — one factual sentence describing what happened (not commentary)
- `type` text — `buying_signal` / `objection` / `missed_opportunity` / `strong_moment` / `rapport_moment` / `disqualify_signal`
- `sequence_order` integer — display order within the call (the timeline)

RLS on both tables mirrors `fathom_calls` (own / admin-managed / owner via `current_user_role()`). Backend writes via service-role; no INSERT/UPDATE policies.

**Two parallel Claude calls (one analysis pass = both fire concurrently):**

1. **Section Grader.** Inputs: normalized transcript, closer's uploaded script (if present in KB), top winning-call transcripts from KB. Output: structured JSON with `grade`, `score`, and `evidence` (quoted lines from the transcript) for each of the 5 sections (Intro / Discovery / Pitch / Objection Handling / Close). Plus `overall_score`, `overall_summary`, `one_thing`. Plus `follow_up_email` draft. Uses the Call Analysis Accuracy Requirements section as the prompting contract — every claim must cite a quoted transcript line.
2. **Highlight Extractor.** Input: normalized transcript only (no benchmark). Output: array of 5–8 highlights with `timestamp_seconds`, `speaker`, `quote`, `observation`, `type`. Tone explicitly calibrated as **film coach reviewing tape — factual, not cheerleader or critic.** Must connect patterns across related moments (e.g. "the same 'too expensive' objection appears at 00:12:04 and again at 00:34:51 — second one was harder because the first wasn't fully isolated"). No empty validation, no generic feedback.

**Timestamp handling.**

Per the SDK audit in this CLAUDE.md, Fathom's timestamps are inconsistent across types:
- `TranscriptItem.timestamp` → `"HH:MM:SS"` string
- `ActionItem.recording_timestamp` → `"HH:MM:SS"` string
- `Highlight.start_time` / `end_time` → numeric seconds
- `Meeting.recording_start_time` / `recording_end_time` → ISO datetime string (absolute)

The normalizer runs FIRST in the pipeline and converts everything to **numeric seconds from start of recording**. Numeric chosen because Fathom's own deep-link URL uses it: `https://fathom.video/calls/{recording_url_id}?t={seconds}`. All downstream code (analysis, UI, follow-up email "see at 00:12:04" anchors) reads from the normalized numeric form only.

**Speaker identification.**

The new CLAUDE.md SDK audit confirmed `TranscriptItemSpeaker.display_name` is fragile and `matched_calendar_invitee_email` is "Coming soon!" — currently never populated. Phase 2 resolves CLOSER vs PROSPECT this way:

1. Fetch `recorded_by.name` from the Fathom meeting data (the Fathom user who recorded — usually the closer).
2. Fuzzy-match against the set of `display_name` values present in the transcript turns.
3. Tag the matched speaker as `CLOSER`; all other speakers tagged as `PROSPECT`.
4. Store the matched name in `call_analyses.speaker_closer_name` so re-analysis is reproducible and the review page can label turns confidently.
5. **Fallback** when no fuzzy match clears a threshold: pass through raw `display_name` values to Claude and let it infer roles from conversational cues (who asks discovery questions, who pitches, who handles objections). Store the inferred name in `speaker_closer_name`.

Multi-prospect calls (more than one external participant) are out of scope for Phase 2 — first non-closer voice is treated as "the prospect" and a TODO is left for v1.4.0+ to handle panel calls.

**Trigger.**

Phase 2 fires automatically immediately after `/fathom/sync` completes for a row. Async via the existing fire-and-forget pattern (matches the post-call summary and adaptive-learning flows already in the desktop's `stop-session` handler). **The closer never waits.** Calls show up in the dashboard list as `"analyzing…"` (`status='processing'`) and then populate when done (`status='done'`). Errors flip to `status='error'` with an error message stored, and the dashboard surfaces a retry button.

**Call Review page (dashboard).**

When the user clicks a synced call from the library, the review page renders three sections **in this order** (deliberately — highlights come first, grades support):

1. **Call Highlights** — the lead section, most visual prominence. Timeline of the 5–8 highlights with: clickable timestamp link (`fathom.video/calls/{id}?t={seconds}` deep link, opens in a new tab), speaker label badge, exact quote, Scout's one-sentence observation. Pattern notes inline connect related moments. Footer: **"One thing to do differently"** (the `one_thing` field) called out in an accent box.
2. **Section Grades** — five collapsible cards, one per section, each showing the grade letter + score + evidence quotes. Supporting detail, not the focus — collapsed by default with a "show all" affordance.
3. **Follow-up Email** — generated draft with a copy-to-clipboard button. The closer sends manually; Scout never sends.

### CRM Integration Notes
- **Start with GHL (GoHighLevel) and Close.io.** Both have public APIs with OAuth (same UX pattern we built for Fathom in v1.2.0).
- **Read+write**: pipeline stages, activity logging, contact data, deal notes.
- **Write operations require closer confirmation before executing** — never auto-write without the user seeing exactly what will change. The diff-then-confirm pattern is non-negotiable; one wrong silent overwrite of a pipeline stage in a real CRM destroys trust in the entire product.
- **Closer connects CRM account via OAuth popup** — reuse the Fathom popup pattern (`/auth/<provider>/connect` returns `{url}`, popup posts result to opener, closes itself). The state-JWT scheme in `backend/routes/auth.js` is general enough to reuse with a per-provider secret.
- **HubSpot et al. come later** — only after GHL + Close.io are working in production for at least one paying customer.

### Call Analysis Accuracy Requirements
**This is the single most critical feature in Scout.** A wrong grade on a closer's call is worse than no grade — it teaches the wrong lesson and burns trust. The analysis pipeline must:

- **Know the source of the transcript** (Fathom, Zoom, Meet) and weight confidence accordingly. Fathom diarized transcripts get higher baseline confidence than a Zoom auto-caption export.
- **Flag low-confidence analysis** when transcript quality is poor — never hide uncertainty behind a confident grade. The dashboard surfaces a "transcript quality unclear" badge that adjusts how the grade is presented.
- **Reference specific transcript moments as evidence for every grade** — never make unsupported claims. Every assertion in a grade output ("missed the discovery on budget") must include a quoted prospect/closer line + timestamp anchor.
- **Use the closer's uploaded script** (if present in the KB) **as the benchmark** for what "good" looks like for that closer / offer.
- **Use winning-call transcripts from the KB as comparison examples** — the same three-tier KB diversity model that powers `/kb/search` (learned patterns → user uploads → seeded frameworks) extends naturally to "find the closest winning call to compare this one against."
- **Grade on a spectrum** — not pass/fail. Five-band scoring (or similar) so closers see directional progress over time, not a binary that flattens nuance.

### Fathom OAuth Credentials (Railway env vars)
```
FATHOM_CLIENT_ID
FATHOM_CLIENT_SECRET
FATHOM_REDIRECT_URI=https://sales-overlay-production.up.railway.app/auth/fathom/callback
FATHOM_STATE_SECRET
```

### Teleprompter (Future Architecture Note)
The original live-teleprompter feature **stays as an optional feature** in v2.0 — not deprecated, just no longer the lead product. Future: prompt mode only activates for **specific call sections** (objection handling, closing) — not during intro/rapport when narration interrupts rapport-building. Requires section detection in the live audio path. Not building now. The architecture (suggestion polling timer, prospect-response gate, closer-active guard) must be preserved so the section-aware mode can slot in without a rewrite.

## Future Plans
- **Adaptive Learning Engine (high priority, designed not built).** See "Current Status: What Works" for full architecture. Next desktop feature after v2.0 Fathom integration stabilizes.
- **Pre-existing item: Post-call prompt-compliance scoring (future).** Use session_logs to post-process each call: compare every Claude suggestion against the closer's transcripts that followed it (35% fuzzy-match). Output a per-call "delivery %" and per-stage breakdown. Scope: one backend post-call job + a UI surface.
- **Fix electron-builder DMG-notarization gap (high priority).** Discovered 2026-05-16 during v1.1.8 release: with `notarize: true` in `build.mac` config, electron-builder 25 notarizes the `.app` and staples the ticket, but never signs or notarizes the DMG container around it. Every release since at least v1.1.6 has needed manual `codesign + xcrun notarytool submit + xcrun stapler staple` per DMG to be shippable. Until fixed, the release workflow includes a mandatory manual DMG-notarization step (~15 min per release). Likely fix: add an `afterAllArtifactBuild` hook in `package.json` `build` config that auto-signs+notarizes+staples DMG artifacts, OR upgrade electron-builder, OR explicitly set `notarize.tool: "notarytool"` with target spec. Investigation should also verify the DMG-notarization step actually runs in CI/scripted contexts (it may be a known TTY-detection issue). See Resolved Issues for the full diagnosis and recovery sequence.
- Context-aware payment link surfacing: during Close / money objection, overlay shows the right payment option link based on prospect's financial situation (wired up after onboarding stores the links)
- Stripe billing fully wired (keys pending — see Railway env vars above)
- Diagnostics dashboard (Phase 3 — see BUILD-PLAN.md)
- **Migrate DNS from Namecheap to Cloudflare** — solves bare-domain HTTPS timeout via CNAME flattening + edge SSL. Free tier. Keep Namecheap as registrar, just change nameservers.
- Revoke old exposed GitHub PAT at github.com/settings/tokens (the Anthropic key is already gone from console.anthropic.com; only the PAT still needs manual revocation)
- See BUILD-PLAN.md for full 4-phase roadmap

## Preferences
- **Push back when warranted.** Justin doesn't want an agreeable AI. If an idea has a flaw — logical, technical, UX, strategic — call it out and explain why before implementing. If experience says something won't work, say so. Challenge, disagree, say no with reasoning. Only implement a user idea after confirming it actually makes sense. Never water down a concern to seem easier to work with. Justin is the expert on his business; Claude is the expert on the code and product patterns — push back from that expertise.
- Justin is not a developer — explain things simply, provide exact terminal commands
- Always use universal sales framework structure, never client-specific content
- Project lives in TWO places on Justin's Mac:
  - `~/Library/Mobile\ Documents/com~apple~CloudDocs/sales-overlay/` (iCloud canonical copy — `npm start` for dev)
  - `~/sales-overlay/` (local build dir — `npm run build` here for signed + notarized DMGs; watch for drift, especially in `build/`)
- **Signed + notarized build (use the script, not inline-paste):** `bash ~/sales-overlay/build-release.sh` — gitignored script (mode 0755, never commit) that wraps the build with the Apple creds on backslash-continued env-var prefix so they always reach electron-builder. Inline-pasting `APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... npm run build` into the terminal has silently failed 3+ times across the project history. If creds rotate, edit `~/sales-overlay/build-release.sh`. **Important:** the script reliably notarizes the `.app` but NOT the DMG container — every release currently needs manual DMG sign+notarize+staple (see Resolved Issues for the exact recovery commands). Until the electron-builder config gap is fixed, treat the DMG manual recovery as part of every release.
- Unsigned dev build fallback: `npm run build:unsigned` then `xattr -cr dist.nosync/mac-universal/Scout.app && codesign --force --deep --sign - dist.nosync/mac-universal/Scout.app`
- When making code changes, always run `node -c <file>` to syntax check before declaring done
- Push to GitHub: `git add <files> && git commit -m "message" && git push`
- **All secrets live in `API Keys.md` (gitignored). DO NOT paste keys into `CLAUDE.md`, `.env` that's tracked, or any other committed file** — GitHub push protection will block the push.
- **Build path (mandatory):** Always build Scout releases from `~/sales-overlay` (the local copy), never from the iCloud folder. The build command is `npm run build` run from `/Users/justinschmidt/sales-overlay`. iCloud's extended attributes cause codesign failures when building from the iCloud path. Claude must reference this rule before writing any build or release command. If the local copy is out of date, rsync from iCloud first (exclude node_modules and dist), then build. (this rule applies to npm run build only, not to normal development, code editing, or SQL operations)
- **v1.1.0 build plan:** Features built one at a time in this order: (1) Role system, (2) Role-based dashboard system on website (`/dashboard` for users + redesigned `/admin` for admins+owners with user management; the original raw log viewer remains as Sections B+C of the admin page), (3) Script upload in app, (4) Call boundary detection, (5) Post-call summary. Each feature fully committed and approved before the next starts. Justin receives one feature prompt at a time from the architect — Claude Code never plans ahead.
- **Session start:** cd into the project root at the start of every session: cd '/Users/justinschmidt/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay'. Note: Supabase MCP is not currently configured — migrations must be run manually via the Supabase dashboard SQL editor. To enable Supabase MCP in future, add it to .mcp.json and start a fresh session.
