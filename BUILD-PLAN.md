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
- [ ] Tune overlay sizing and prompt readability
- [ ] Package with electron-builder into .dmg installer
- [ ] Write a quick setup guide (install app → grant Screen Recording permission → pick mic → go)

### Deliverable
A .dmg file you can hand to one closer to install and test on real calls.

---

## Phase 2: Backend & User Accounts
Turn it from a local app into a real product with logins and billing.

### What to Build
- Node.js backend on Railway or Vercel
- User auth (email/password or Google login)
- API key proxy — users don't need their own Deepgram/Claude keys, you manage them server-side
- Stripe billing — monthly subscription ($X/month per seat)
- Onboarding wizard in the app (enter your name, your offer, your price point, your top objections)
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

### What to Build
- Save full call transcripts to Supabase (both speakers, timestamped)
- Post-call summary — auto-generated after each session:
  - Objections hit and how they were handled
  - Suggestions delivered vs skipped
  - Call stage durations (how long in discovery vs pitch vs close)
  - Missed opportunities flagged by Claude
- Dashboard in the app (or web portal):
  - Call history with searchable transcripts
  - Objection frequency heatmap
  - Close rate tracking (user marks outcome after each call)
  - Trend lines over time (getting better or worse?)

### Deliverable
Closers can review their calls, see patterns, and improve over time. Sales managers get visibility.

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
