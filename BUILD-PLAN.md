# Sales Overlay — Build Plan

## Phase 1: Nail the Core Teleprompter (NOW)
Get the live coaching experience tight enough that one closer loves it.

**Status: 90% complete**

### What's Working
- Real-time transcription of both speakers (closer mic + system audio loopback)
- Zero-setup prospect audio capture via electron-audio-loopback (no drivers needed)
- Claude API generating next-line suggestions as live teleprompter
- Delivery-based overlay — prompt stays until closer says it, then next one stacks below
- Click-through overlay with drag handle (doesn't block other windows)
- 7-stage call detection (Introduction → Set → Discovery → Transition → Pitch → Close → Objection Handling)
- Objection detection on prospect speech only (Money, Spouse, Think About It, No Time)
- Knowledge base seeded with 69 framework entries (SPAIN, Identity Shifting, V-L-F-A-R, all objection frameworks)
- Auto-selects dedicated mic over webcam mics

### What's Left in Phase 1
- [x] Real two-person call test (FaceTime or Zoom) — DONE, found issues, fixing iteratively
- [x] Fix delivery gate locking up (added 30s timeout + 4-turn auto-advance)
- [x] Fix false positive objection triggers (tightened fuzzy matching)
- [x] Fix call stage stuck on introduction (relaxed stage progression)
- [x] Fix Claude repeating same suggestion (added suggestion history + anti-repetition)
- [x] Rewrite system prompt — follow the conversation, not a rigid script
- [ ] Continue real-call testing and tuning
- [ ] Discovery Tracker — side panel checkbox overlay showing what info has been gathered:
  - Finances / budget
  - Willingness to do the work
  - Pain identified
  - Goals / vision
  - Timeline / urgency
  - Decision maker confirmed
  - Why now
  (Call memory already extracts key facts — needs a UI panel that updates live)
- [ ] **Discovery Tracker — surface extracted financial details live.** When the prospect shares financial information during the call (income, savings, budget, monthly cashflow, existing debt, credit quality, available credit lines), auto-extract it and display the actual numbers/details underneath the "Finances / Budget" checkbox so the closer can reference them without searching through the transcript. Call memory already extracts these facts — they need a UI surface that updates after each rolling summary. Same pattern as the checkbox auto-checking, but showing the extracted value instead of just a ✓.
- [ ] Tune overlay sizing and prompt readability
- [ ] Package with electron-builder into .dmg installer
- [ ] Write a quick setup guide (install app → grant Screen Recording permission → pick mic → go)

### Deliverable
A .dmg file you can hand to one closer to install and test on real calls.

---

## Phase 1.5: Feature Completion Sprint (NEXT — BUILD IN THIS ORDER)
Four features to build in sequence before touching Phase 2 backend work. Each one is self-contained and ships value immediately to the single-closer test user.

**Build order:**
1. Financial Tracker (live extraction under Finances checkbox) — IN PROGRESS
2. Onboarding Wizard (niche, offer, qualifications, payment links)
3. Call Boundary Detection (auto-detect Zoom/FaceTime start & end)
4. Post-Call Summary (win/loss + stats after every call)

---

### Step 1: Financial Tracker — Live Extraction (IN PROGRESS)
When the prospect shares any financial detail during the call, extract it and display the actual numbers under the "Finances / Budget" checkbox in the Discovery Tracker — not just a ✓.

**What to extract:**
- Annual or monthly income
- Savings / liquid cash
- Budget available for the program
- Monthly cashflow (what they can comfortably commit)
- Existing debt / credit card balance
- Credit score or credit quality (self-reported)
- Available credit lines
- Any spouse/partner income or joint finances mentioned

**How it works:**
- Extend the `discovery` object in `call-memory.js` with a `financeDetails` field (array of short strings, e.g., `["Income: $180k", "Savings: ~$20k", "Has $15k on AmEx"]`)
- Update the Claude extraction prompt in `updateSummary()` to pull these specific values from the transcript when the prospect mentions them
- IPC message `discovery-update` carries the details alongside the boolean flags
- `discovery.html` renders the strings as a compact list under the Finances row when `financeDetails` is non-empty
- Once extracted, details persist (never drop off — same pattern as the checkboxes)

**Why it matters:**
Closer never has to scroll back through transcript to remember the prospect's income during a money objection. The numbers are right there on screen.

---

### Step 2: Onboarding Wizard (first-run experience, local-first)
Built before Phase 2 auth so it can run entirely locally and later sync to Supabase.

- First launch (or a Settings menu) opens a one-time setup flow:
  - Your name + company
  - **Your niche** (high-ticket coaching, SaaS, real estate, agency services, etc.) — informs tone and framework defaults
  - Your offer (what you sell, price point)
  - **Financial qualifications to close a prospect** — the criteria the closer uses to decide if a prospect qualifies (minimum income, available credit, savings, monthly cashflow, etc.). Used to auto-flag the Discovery Tracker when a prospect meets or misses the bar.
  - **Payment options + links** — closer enters available payment methods + corresponding URLs:
    - PIF (pay in full) — link to checkout
    - Split-pay (2-pay, 3-pay, etc.) — link(s) per plan
    - Affirm / Klarna / AfterPay financing — link or embed
    - Custom financing (in-house, partner lenders, etc.)
  - Your top 3 objections you hear most
  - Upload a script (optional)
- Stored locally in a JSON config file (`~/Library/Application Support/Scout/config.json` on macOS)
- Personalizes Claude's suggestions from call one
- Later (Phase 2) synced to Supabase per-user

### Step 2a: Context-Aware Payment Surfacing
Once payment options are configured, the overlay surfaces the right link at the right moment based on call context:
- In the **Close stage** → show "PIF / Split-pay / Affirm" as a quick-action button row
- When a **money objection** hits AND `financeDetails` shows tight cashflow → surface the Affirm / financing link prominently
- When a **money objection** hits AND `financeDetails` shows savings or "can swing it" → surface the PIF link
- Closer clicks the link → copies to clipboard OR opens in a side panel they can screen-share
- Goal: closer never fumbles for the right financing link while a prospect is on the edge of buying

---

### Step 3: Call Boundary Detection
Passive detection + one-click confirmation — never auto-start without the closer's OK.

**Start detection:**
- Poll running processes every ~3s for Zoom (`zoom.us`), FaceTime, Google Meet (Chrome tab — harder), Microsoft Teams
- For Zoom specifically: check meeting-active state, not just "is Zoom open" (Zoom runs in the background whenever launched)
- When a meeting goes active AND no Scout session is running → show a small non-intrusive prompt: **"Looks like you started a Zoom call — Launch Scout?"** [Yes / No / Don't ask again this session]
- Yes → triggers the existing `startSession('generic')` flow

**End detection:**
- When the meeting app closes OR meeting state flips to inactive → auto-stop the session and trigger post-call summary
- If the closer is mid-prompt or actively speaking → wait 10s then stop, to avoid cutting off a goodbye

**Why prompt instead of auto-start:**
- False positives: closer opens Zoom to schedule, not to take a call
- Control: closer might want to skip Scout for internal team calls

**Implementation notes:**
- macOS: use `ps` / `child_process` to poll process list. Zoom menu-bar state readable via AppleScript or `osascript` querying `System Events`
- Fallback: if process detection fails, the existing manual Start/Stop still works — this is a layer on top, not a replacement

### Step 3a: Per-Call State Reset
- On every detected call start, fully reset: transcript, call memory, discovery tracker, suggestion history, overlay prompts
- No stale state from the previous call bleeding into the next

---

### Step 4: Post-Call Summary
Fires automatically when the call ends (either via boundary detection or manual Stop).

- After Stop, show a lightweight end-of-call screen before the overlay closes:
  - "How did it go?" → Win / Loss / Follow-up (one tap)
  - Quick auto-generated stats: X objections handled, Y stages completed, Z min call duration
  - Top moments: biggest objection hit + how it was handled, key financial numbers captured
  - "View full report" button → opens scoutsystems.io/dashboard (once dashboard exists; for now a local summary screen)
- Win/loss tag + call metadata saved locally (synced to Supabase once Phase 2 auth is live) so Phase 3 analytics have real data from day one

### Deliverable (end of Phase 1.5)
Closer installs the app → runs through onboarding once → opens Zoom → Scout asks "Launch?" → overlay runs with onboarding-personalized prompts + live financial details surfaced under the Finances checkbox + payment links appear context-aware during the close → Zoom closes → summary pops with Win/Loss/Follow-up → ready for next call. Zero manual management between calls.

---

## Phase 2: Backend & User Accounts
Turn it from a local app into a real product with logins and billing.

### Step 1: Backend Infrastructure ✅
- [x] Node.js/Express backend on Railway (live at sales-overlay-production.up.railway.app)
- [x] User auth — email/password login + signup via Supabase
- [x] Login screen in Electron app (Scout Systems branded)
- [x] Subscription check gates the overlay — no active sub = can't launch
- [ ] API key proxy — users don't need their own Deepgram/Claude keys (next)

### Step 2: Stripe Billing (in progress)
- [ ] Create Stripe account + product ($197/month)
- [ ] Add real STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET to Railway
- [ ] Test full checkout → subscription active → overlay unlocks flow

### Step 3: Marketing Website + Acquisition Flow (scoutsystems.io)
The website is the front door. Stripe checkout lives here, not in the app. This is the Slack model — buy on the web, then "Launch App."

**User flow:**
1. User lands on scoutsystems.io → sees pricing
2. Clicks "Get Started" → Stripe checkout on the website
3. Payment succeeds → redirected to scoutsystems.io/welcome
4. Welcome page shows email/password they used + a **"Launch Scout"** button
5. "Launch Scout" uses a custom URL scheme (`scout://launch`) that opens the desktop app
6. App detects the deep link, prompts them to log in (email + password from signup), overlay unlocks

**What to build:**
- scoutsystems.io landing page (hero, features, $197/month pricing, "Get Started" CTA)
- Stripe checkout session created from website (or backend `/billing/checkout` endpoint)
- `/welcome` success page with "Launch Scout" deep link button
- Custom URL scheme `scout://` registered in Electron (package.json `protocols` field)
- Electron intercepts `scout://launch` → opens app, focuses login screen
- In-app paywall updated to say "Subscribe at scoutsystems.io" (button opens website) instead of inline checkout

**Why this order:**
Website comes after auth and billing infrastructure are working. You need a real Stripe key and a working subscription check before the website flow is meaningful to test.

### Step 4: Onboarding Wizard Cloud Sync
The onboarding wizard is already built locally in Phase 1.5. In Phase 2 it gets wired up to Supabase so the config follows the user across devices and is available for the diagnostics/analytics dashboards.
- Migrate local `config.json` → Supabase `user_profiles` table on first login with active subscription
- Settings menu reads from / writes to Supabase
- Niche, offer, qualifications, payment links, top objections all stored server-side

### Step 5: What to Build
- API key proxy — users don't need their own Deepgram/Claude keys, you manage them server-side
- Script upload stored per-user in Supabase (already built client-side, needs backend persistence)

### Diagnostics Dashboard (build alongside backend, not after)
When a user reports an issue, you need to be able to pull up exactly what happened on their call — the same log output currently visible in your terminal — without asking them to send screenshots.

**How it works:**
Every `[claude]`, `[deepgram]`, `[memory]`, and `[audio]` log line the app already emits gets forwarded to a `/log` endpoint on the backend in real time. Each line is tagged with the user's account ID and a session ID (generated when they hit Start). Stored in Supabase in a `call_sessions` table alongside the full transcript.

**What gets stored per session:**
- Session ID, user account, start/end timestamp
- Every log line in order (gate states, delivery detection, stage progression, API calls, errors)
- Full transcript — both speakers, with speaker labels and timestamps
- Key facts extracted by call memory (name, income, goals, pain points, etc.)
- Explicit `[error]` flags for the most common failure points: delivery gate stuck, Deepgram disconnect, Claude API failure, stage not advancing

**The web dashboard (scoutsystems.io/admin):**
- Search by user email, session ID, or date range
- See all sessions for a user, click into any one
- Full scrollable log output — identical to what you see in your terminal today
- One-click copy for sharing with diagnostics
- Error filter — show only sessions that had flagged errors

**Implementation cost:** ~2-3 days of dev work on top of the core backend. One Supabase table, one `/log` endpoint, one simple admin UI. Build it in from the start — retrofitting logging later is painful.

### Note on Dev Resources
Phase 2 will be built by Justin + Claude, no external dev until the product is generating revenue. This means Phase 2 gets built incrementally — ship the minimum viable version of each piece (auth, billing, logging) before moving to the next. Prioritize things that unblock distribution over things that are nice to have.

### Deliverable
Users download the app, create an account, pay, and start coaching. No API keys, no setup. You have a private admin dashboard to diagnose any issue any user reports.

---

## Phase 3: Post-Call Analytics & Insights
Every call is already being transcribed and staged — start saving and analyzing that data.

**Do this AFTER you have real users and real call data. An empty dashboard is worthless.**
The prerequisite is Phase 2 billing working + at least 5-10 users making real calls.

### Architecture Decision: Dashboard lives on the web, not in the app
scoutsystems.io/dashboard — not inside the Electron overlay. The app has one job: coach during calls. The dashboard is what you review after. Trying to show analytics in a floating overlay would be terrible UX. Web is the right call.

The login stays in the app for now (already built and working). Revisit moving it fully to the web (Slack-style) in Phase 4 when you have enough users to justify the extra engineering.

### What to Build

**Step 1: Data capture (backend)**
- Save full call transcripts to Supabase `call_sessions` table (both speakers, timestamped)
- Track per-session: call outcome (closer marks win/loss after call), duration, stage timestamps
- Track objections hit: which objection, what response was given, whether prospect moved past it
- Track suggestions: how many shown, how many the closer actually delivered

**Step 2: Post-call summary (in app)**
- After clicking Stop, show a lightweight end-of-call screen before the overlay closes:
  - "How did it go?" → Win / Loss / Follow-up
  - Quick summary: X objections handled, Y stages completed, Z min call
  - One-tap to open full report in browser (scoutsystems.io/dashboard)

**Step 3: Web dashboard (scoutsystems.io/dashboard)**
- Weekly performance report (close rate, cash collected, total calls, avg call time)
- Objection breakdown — total faced, overcome rate, per-objection stats with progress bars
- AI coaching insights — pattern-detected observations (e.g. "Your 'think about it' handle works 30% less often when discovery is under 10 min")
- Call history — searchable list, click into any call for full transcript + suggestions shown
- Stage breakdown — how long spent in each stage across all calls

### Deliverable
Closers can review every call, see their patterns, and get AI-driven coaching between calls. Sales managers get visibility into their team's performance. This is also the feature that justifies the monthly subscription price.

---

## Phase 4: Team Features & Enterprise
Scale from individual closers to sales teams.

### What to Build
- Team workspaces — manager creates a team, invites closers
- Custom script library per team (manager uploads, closers get it in the overlay)
- Team-wide analytics dashboard:
  - Compare reps side by side
  - See which frameworks and objection handlers work best across the team
  - Identify coaching opportunities (e.g., "Rep X skips discovery 40% of the time")
- Role-based access (manager vs closer)
- SSO / enterprise auth
- Custom branding options

### Deliverable
Sales orgs buy team seats. Managers get a dashboard, closers get coached. This is the enterprise play.

---

## Tech Stack Summary

| Layer | Current | Phase 2+ |
|-------|---------|----------|
| Desktop App | Electron 41 | Same |
| Speech-to-Text | Deepgram Nova-2 (raw WebSocket) | Same, proxied through backend |
| AI Coaching | Claude Sonnet API | Same, proxied through backend |
| System Audio | electron-audio-loopback | Same |
| Knowledge Base | Supabase + pgvector | Same |
| Backend | None (local only) | Railway/Vercel (Node.js) |
| Auth | None | Email/Google login |
| Billing | None | Stripe |
| Analytics DB | None | Supabase (call transcripts + metrics) |
| Session Logging | Terminal only | Supabase `call_sessions` table + admin dashboard |
| Packaging | npm start | electron-builder (.dmg/.exe) |
