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

## Current Status: What Works
- Deepgram real-time transcription of both speakers (closer mic + system audio loopback)
- Claude API generating next-line suggestions as live teleprompter
- Overlay bar with stacking prompts and question-first delivery detection
- Prospect response gate — next prompt waits for prospect to answer
- Closer-active protection — never interrupts mid-sentence; clears the moment the prospect speaks more recently than the closer (v1.0.7 floor-handoff fix)
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
- Signed + notarized .dmg via electron-builder using Apple Developer ID (identity `1CD4B87D…`, team `8QN5Y29R27`). **Current release: v1.0.4** (arm64 + x64, both notarized + stapled). Major architecture change: the desktop app no longer ships any secret API keys — all Claude + Deepgram traffic routes through the Railway backend's `/proxy/*` endpoints using short-lived ephemeral Deepgram keys. Supabase URL + anon key (both public per Supabase's own design) are hardcoded in `src/config.js`. Historical: v1.0.0 initial; v1.0.1 added macOS app icon; v1.0.2 fixed packaged app login; v1.0.3 attempted but the DMG had three bugs (broken logo, dead Start button, invisible onboarding wizard) all tracing to missing `.env` in the asar — v1.0.3's DMGs remain in `~/sales-overlay/dist/` alongside v1.0.4 (harmless, different filenames). v1.0.4's release notes are on GitHub Releases.
- App bundles ship with the Scout icon (`build/icon.icns` referenced via `build.mac.icon` in `package.json`)
- GitHub repo at github.com/scoutsystems-js/sales-overlay (PAT lives in `API Keys.md` only — never in committed files)
- Auto-updater (electron-updater) pointed at GitHub Releases — `latest-mac.yml` + DMGs + blockmaps uploaded per release. electron-updater is lazy-required inside `initAutoUpdater()` with try/catch so a missing module never crashes the app.
- GitHub Releases: v1.0.0 initial, v1.0.1 macOS icon, v1.0.2 packaged-login fix (arm64), v1.0.3 attempted (three packaging bugs — never published), v1.0.4 (no shipped API keys, JWT refresh, proxy routing), v1.0.5 (cloud logging via SessionLogger), v1.0.6 (auto-updater 30-min polling + backend transient-failure retry + error truncation), v1.0.7 (ZIP target so macOS auto-update works + latency pass: Haiku for live suggestions, 800ms prospect-silence gate, closer-active floor-handoff), **v1.0.8 current release** — delivery gate tuning (Check 2 switched from per-pair 2s gap to 4s total-elapsed floor via `turnAutoAdvanceMinElapsedMs`) + overlay max visible prompts reduced 3→2. Release published via `gh release create`.
- Project synced to iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay/`) with node_modules and dist as `.nosync` symlinks
- Supabase user_profiles table live — stores onboarding wizard data (niche, offer, pricing, payment URLs) with RLS scoped to auth.uid(). Migration at backend/migrations/001_user_profiles.sql.
- Onboarding Wizard — 5-screen post-login setup (niche, offer, pricing, payment links, qualifications) wired to user_profiles via Supabase. Skip saves partial data, complete sets completed_at to hide wizard on future launches.
- Web login session persistence — backend/routes/auth.js returns full session (access_token, refresh_token, expires_at); login.html stores to localStorage under `scout_session_v1` key and auto-restores on reload
- Cache-Control: no-cache on all HTML files served by backend (prevents browser caching stale login/landing pages after deploys)
- gitleaks pre-commit hook installed via `.pre-commit-config.yaml` — blocks commits containing API keys or secrets before they reach GitHub

## Current Status: What's Being Tuned
1. **Prompt firing speed** — Target: fires within ~1.5s of prospect finishing. With polling timer + backchannel fix this should now work. Still being tested.
2. **Delivery detection sensitivity** — Currently 35% threshold with question-first matching. May need further tuning based on real call testing.
3. **Deepgram transcription quality** — System audio (YouTube/loopback) sometimes garbles badly, which confuses Claude's suggestions. Open issue — no fix yet.
4. **Claude suggestion length** — Claude sometimes generates very long suggestions. Could benefit from a max word count instruction in the system prompt.

## Current Status: Not Yet Built
- Post-call summary
- Stripe billing wired end-to-end (auth works; Stripe keys pending; `SKIP_BILLING` currently `true` so all logged-in users get full access)
- Post-call analytics dashboard — charts, aggregations, win rate, objection breakdown, stage timing (Phase 3 per BUILD-PLAN.md, at `/dashboard`). The Phase 2 raw session log viewer at `/admin` is live (v1.1.0 Feature 2); remaining Phase 2 diagnostics work: search by email/session/date and one-click log copy.
- Automated release via `npm run release` (currently manual — DMGs uploaded to GitHub Releases via web UI since `gh` CLI isn't installed locally)
- x64 DMG for v1.0.2 (Apple notarization server returned 500 mid-build; arm64 shipped; rebuild x64 separately when Apple servers recover)

## Resolved Issues (full history)
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
- `gh release create` failed with `command not found: gh` → GitHub CLI not installed on Justin's Mac. Workaround: create releases via GitHub web UI (Releases → Draft a new release → drag DMGs + `.blockmap`s + `latest-mac.yml` from `dist/`). Long-term fix: `brew install gh` if we want to automate.
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
- **Release workflow (manual, v1.0.1 baseline):**
  1. `cd ~/sales-overlay && npm version <x.y.z> --no-git-tag-version`
  2. `APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=8QN5Y29R27 npm run build` (~8–10 min for signing + notarization). **Paste this as ONE single line — newlines between the env-var prefix and the command cause zsh to treat the vars as local shell variables, they don't get exported to electron-builder, and notarization silently skips with `notarize options were unable to be generated`. Verify post-build with `xcrun stapler validate dist/Scout-X.Y.Z-arm64.dmg`.**
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
  - `/` → landing page (`backend/web/index.html`)
  - `/login` → web login page (`backend/web/login.html`)
  - `/admin` → admin session logs page (`backend/web/admin.html`; owner role only, API at `backend/routes/admin.js`)
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
- Current release: **v1.0.4** (arm64 + x64). Desktop app ships with zero secret API keys — all Claude + Deepgram traffic proxied through Railway. Includes JWT auto-refresh via `/auth/refresh`, proxy-minted 10-min ephemeral Deepgram keys, and SKIP_BILLING beta pass-through on `requireSubscription` middleware.
- Releases currently uploaded manually via GitHub web UI (drag DMGs + `.blockmap`s + `latest-mac.yml` from `dist/`). `npm run release` will work once `gh` CLI is installed + `GH_TOKEN` set.

## Future Plans
- **Post-call prompt-compliance scoring (future, v1.0.7+).** Use the new session_logs table to post-process each call: compare every Claude suggestion (`[claude] Next line: ...`) against the closer's transcripts that followed it (same 35% fuzzy-match used for delivery detection). Output a per-call "delivery %" and per-stage breakdown (discovery / objection / close). Shows up in the admin dashboard as a coaching score. Scope: one backend post-call job + a UI surface. Queue after admin view (Phase 4) ships.
- **v1.0.6 SHIPPED 2026-04-23**: auto-updater 30-min polling + backend error hardening. `initAutoUpdater` now calls `setInterval(checkForUpdates, 30*60*1000)` alongside the 5s startup setTimeout — long-running apps pick up releases without restart. New `backend/lib/format-error.js` shared by `/proxy/*` and `/log/*` with three helpers: `formatUpstreamError` (status + truncated message), `isTransientError` (regex-matches 502/503/504/bad gateway/ETIMEDOUT/ECONNRESET/EAI_AGAIN), `insertWithRetry` (one retry with 500ms backoff on transient failures only — non-transient errors return immediately). 30 unit tests pass. Applied to all three `/log` catch blocks + bulk-insert call. Released via `gh release create v1.0.6`. Verification for polling: publish a future no-op bump and confirm a running v1.0.6 logs `[updater] Update available:` within 30 min.
- **v1.0.5 SHIPPED: cloud logging (Phases 1-3 + 5). Admin view (Phase 4) deferred to v1.0.6.** Packaged app previously discarded all console.log output (no terminal attached when launched from /Applications). Now: two shared tables — `call_sessions` (one row per Start→Stop cycle, outcome + error_count + client_version) and `session_logs` (one row per log line, indexed by session_id and user_id+logged_at). RLS restricts reads to the owning user; INSERTs use backend service role. 14-day retention via `public.prune_old_session_data()` scheduled by pg_cron in Supabase dashboard. Migration at `backend/migrations/002_session_logs.sql` (applied 2026-04-23; renamed pre-existing empty tables to `*_legacy_2026_04_23`). Backend endpoints: `POST /log/session-start` creates session row + returns session_id, `PATCH /log/session-end/:id` marks ended_at + optional outcome (`win`/`loss`/`follow_up`), `POST /log` bulk-inserts validated batch (pure `validateLogBatch` unit-tested, 11 cases). `src/lib/session-logger.js` class captures console.log/warn/error via a tee, batches at 20 entries OR 2s, caps buffer at 1000 entries (drop-oldest on overflow), re-queues entries on failed flush (28 unit tests passing). Wired into main/index.js `start-session` (before Deepgram key fetch so errors are captured) and `stop-session` (final flush + sessionEnd after cleanup). Integration tested end-to-end 2026-04-23: one session produced 63 log rows over 35s. Nothing else regressed (login, onboarding, Start/Stop, Deepgram, overlay all unchanged). Phase 4 admin view at `scoutsystems.io/admin` (email-allowlisted) is next — for now, query Supabase directly via SQL Editor. Matches BUILD-PLAN.md Phase 3 "Diagnostics Dashboard" spec.
- **Phase 1.5 build order (next up, see BUILD-PLAN.md):** 1) Financial Tracker (DONE — live detail extraction under Finances row), 2) Onboarding Wizard (in progress — Phase 2 done, Phase 3 (first-launch detection polish) and Phase 4 (coaching integration) remaining) (niche, offer, price, qualifications, payment links — PIF / 2-pay / Affirm), 3) Call Boundary Detection (auto-detect Zoom/FaceTime start & end with confirmation prompt), 4) Post-Call Summary (Win/Loss + stats screen after every call)
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
- **Build path (mandatory):** Always build Scout releases from `~/sales-overlay` (the local copy), never from the iCloud folder. The build command is `npm run build` run from `/Users/justinschmidt/sales-overlay`. iCloud's extended attributes cause codesign failures when building from the iCloud path. Claude must reference this rule before writing any build or release command. If the local copy is out of date, rsync from iCloud first (exclude node_modules and dist), then build. (this rule applies to npm run build only, not to normal development, code editing, or SQL operations)
- **v1.1.0 build plan:** Features built one at a time in this order: (1) Role system, (2) Admin session logs page on website, (3) Script upload in app, (4) Call boundary detection, (5) Post-call summary. Each feature fully committed and approved before the next starts. Justin receives one feature prompt at a time from the architect — Claude Code never plans ahead.
- **Session start:** cd into the project root at the start of every session: cd '/Users/justinschmidt/Library/Mobile Documents/com~apple~CloudDocs/sales-overlay'. Note: Supabase MCP is not currently configured — migrations must be run manually via the Supabase dashboard SQL editor. To enable Supabase MCP in future, add it to .mcp.json and start a fresh session.
