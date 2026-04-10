# Sales Overlay — Full Transfer Guide
**Last updated: April 9, 2026**
**Owner: Justin Schmidt (justinschmidt@netrevenue.io)**

This document contains everything needed to continue development on this project in a new Claude session. Copy the entire `sales-overlay` folder and share this file as context in the first message of your new session.

---

## What This Project Is

Sales Overlay is a real-time AI sales coaching teleprompter built as an Electron desktop app. It listens to live sales calls (both the closer's mic and the prospect's system audio), transcribes everything in real time via Deepgram, and displays a transparent overlay bar at the top of the screen telling the closer exactly what to say next. Claude Sonnet generates the coaching suggestions based on the live transcript, a knowledge base of sales frameworks, and call memory.

This is a personal side project — NOT for Net Revenue LLC. Only universal sales frameworks, no client-specific content. No external dev will be hired until the product generates revenue — all development is done by Justin + Claude.

Brand: **Scout Systems** (scoutsystems.io). Product name TBD — "Sales Overlay" is the working title.

---

## How to Run It

```bash
cd ~/sales-overlay
npm install
npm start
```

Requires a `.env` file in the project root with:
```
DEEPGRAM_API_KEY=your_deepgram_key
ANTHROPIC_API_KEY=your_anthropic_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
NODE_ENV=development
```

First time: grant macOS Screen Recording permission when prompted (needed for system audio capture).

To seed the knowledge base (one-time):
```bash
node scripts/clear-and-reseed.js
node scripts/seed-frameworks.js
```

---

## Tech Stack

| Tech | Purpose |
|------|---------|
| **Electron 41** | Desktop app, two BrowserWindows (control panel + overlay) |
| **Deepgram Nova-2** | Real-time speech-to-text via raw WebSocket (not SDK — SDK v5 was broken) |
| **Anthropic Claude Sonnet** (`claude-sonnet-4-20250514`) | Live teleprompter AI — generates next-line coaching suggestions |
| **Supabase + pgvector** | Knowledge base / RAG for sales frameworks (65+ entries) |
| **electron-audio-loopback** | Native macOS system audio capture — no virtual drivers needed |

Dependencies (package.json): `@supabase/supabase-js`, `dotenv`, `electron`, `electron-audio-loopback`. The Anthropic SDK is loaded via `require('@anthropic-ai/sdk')` — if not in package.json, install with `npm install @anthropic-ai/sdk`.

---

## File Map

```
sales-overlay/
├── .env                              # API keys (DEEPGRAM, ANTHROPIC, SUPABASE)
├── package.json                      # Electron 41, electron-audio-loopback
├── CLAUDE.md                         # Project memory for Claude (KEEP UPDATED)
├── BUILD-PLAN.md                     # 4-phase roadmap
├── TRANSFER-GUIDE.md                 # This file
│
├── src/
│   ├── main/index.js                 # Main Electron process, IPC handlers, session lifecycle, polling timer
│   ├── preload.js                    # contextBridge IPC (logToMain for debug)
│   │
│   ├── ai/
│   │   ├── claude.js                 # ClaudeCoach class — THE CORE ENGINE
│   │   ├── prompts.js                # System prompt + suggestion prompt builder
│   │   ├── objections.js             # Hardcoded objection detection (4 main + 6 secondary)
│   │   ├── call-memory.js            # Rolling call summary + stage detection
│   │   ├── knowledge-base.js         # Supabase pgvector search
│   │   └── script-parser.js          # Parse uploaded .txt scripts into KB entries
│   │
│   ├── transcription/
│   │   └── deepgram.js               # Raw WebSocket connection to Deepgram
│   │
│   └── renderer/
│       ├── control/
│       │   ├── index.html            # Control panel UI
│       │   └── control.js            # Audio capture, device enumeration, session controls
│       └── overlay/
│           └── overlay.html          # Overlay bar — stacking prompts, badges, styling
│
├── scripts/
│   ├── seed-frameworks.js            # Seeds 65+ KB entries (SPAIN, Identity Shifting, etc.)
│   ├── clear-and-reseed.js           # Wipes and reseeds Supabase KB
│   ├── seed-knowledge-base.js        # Older seed script
│   ├── seed-client-ssi.js            # Client-specific (NOT USED — ignore)
│   └── seed-client-globalbanks.js    # Client-specific (NOT USED — ignore)
│
└── memory/
    └── projects/sales-overlay.md     # Older project memory file
```

---

## How the Core Loop Works

1. **Audio captured** — Closer's mic (channel 0) + prospect's system audio via electron-audio-loopback (channel 1)
2. **Deepgram transcribes** — Raw WebSocket, multichannel=2. Each transcript chunk tagged as CLOSER or PROSPECT
3. **Turns added to ClaudeCoach** — `addTurn(text, speaker)` in claude.js
4. **Backchannel check** — If closer's turn is a short filler word ("Yeah", "Right", "Okay" — 3 words or fewer), it's a backchannel. Does NOT update the closer-active timer, does NOT count toward auto-advance, does NOT accumulate in delivery detection.
5. **Delivery detection listens** — Extracts the QUESTION portion from the current suggestion (splits on `?`), fuzzy-matches closer's speech against it (35% of meaningful 4+ char words, excluding 80+ stop words)
6. **Closer delivers the question** → system marks delivered, activates PROSPECT RESPONSE GATE
7. **System WAITS** — No new prompt until prospect actually speaks. Closer-active guard prevents ANY timeout from firing while closer spoke within last 5 seconds (real speech only).
8. **Prospect responds** → gate opens. System waits 1.5s after prospect's last speech chunk.
9. **Polling timer fires** (every 1.5s, independent of transcripts) → all gates checked
10. **Claude generates next suggestion** — Based on 16-turn transcript buffer + call memory summary + KB matches + suggestion/angle history
11. **New prompt appears in overlay** — Stacks below previous (which fades to 60% opacity). Max 3 visible.
12. **Repeat from step 4**

### Gate System (claude.js)

There are multiple gates that must ALL be open before a new suggestion fires:

| Gate | What It Checks | Bypass |
|------|---------------|--------|
| **Rate limit** | 5s since last API call | Never |
| **Turn minimum** | 2+ turns since last call | Never |
| **Delivery gate** | Closer said the question | 4-turn auto-advance (requires 2s gap between turns), 30s silence timeout (closer must be silent) |
| **Prospect response gate** | Prospect spoke after delivery | 45s timeout (closer must be silent) |
| **Prospect-silence check** | Prospect's last speech was 1.5s+ ago | 45s prospect response timeout |
| **Closer-active guard** | Closer hasn't spoken in 5s (real speech only) | Never — this is the final safety net |

Objections bypass ALL gates except rate limit. They're urgent.

The system also runs a **1.5s polling timer** in `main/index.js` that calls `getSuggestion()` independently of incoming transcripts. This ensures prompts fire during natural pauses even when nobody is speaking.

---

## Backchannel Filtering (claude.js)

The `BACKCHANNEL_WORDS` array and `isBackchannel()` function filter out short filler utterances from the closer ("Yeah", "Right", "Okay", "Mhmm", "Gotcha", etc. — 3 words or fewer, all acknowledgment/stop words).

Without this filter: every "Yeah" the closer says while the prospect is talking resets the closer-active timer, permanently blocking new prompts from firing.

With this filter: "Yeah" doesn't reset anything. Only real speech (4+ words, or meaningful content words) counts.

---

## Delivery Detection Deep Dive (claude.js)

1. `extractQuestionPart(text)` — Splits suggestion on sentence boundaries, separates question sentences (contain `?`) from statements
2. `countMeaningfulMatches(spoken, target)` — Counts how many words from `target` appear in `spoken`, excluding 80+ stop words and words under 4 characters
3. `hasDeliveredLine(spokenText, suggestedText)`:
   - If suggestion has a question: match against question only (35% threshold, min 2 matches)
   - If no question: match against full text (35% threshold, min 3 matches)

---

## Anti-Repetition System (claude.js + prompts.js)

Two layers:

1. **Exact suggestion history** — Last 8 suggestions stored with headline + text. Passed to Claude as "ALREADY SUGGESTED (DO NOT REPEAT)"
2. **Theme/angle tracking** — Last 5 unique themes tracked. When a new headline shares 50%+ of its meaningful words with an existing angle, it's flagged as duplicate and not added. Passed to Claude as "ANGLES/THEMES ALREADY EXPLORED"

---

## Objection Detection (objections.js)

Runs on PROSPECT speech only. Two-pass detection:

1. **Exact match** — Full trigger phrase found in transcript (case-insensitive)
2. **Fuzzy match** — Only for triggers with 4+ words containing 2+ distinctive words (5+ chars, not in stop list). ALL distinctive words must match. Edit distance ≤1 allowed only for 5+ character words.

4 main frameworks: Money (8 phases), Spouse (8), Think About It (10), No Time (6).
6 secondary frameworks: generic rebuttals.

---

## Call Memory (call-memory.js)

Rolling summary updated every 8 turns via Claude Sonnet (max_tokens: 500). Extracts:
- Call summary (150 words max)
- Current stage (7 stages: introduction → set → discovery → transition → pitch → close → objection_handling)
- Key facts (name, location, profession, income, goals, pain points, etc.)

Stage progression is guarded: no going backwards, max 2 stages forward (3 after 30 turns, any after 50 turns). objection_handling can be entered/exited from any stage.

---

## Overlay (overlay.html)

- Full-width bar at top of screen, dark translucent background (rgba 0,0,0,0.82) with blur
- Click-through (`setIgnoreMouseEvents(true, {forward: true})`) — doesn't block other windows
- Small drag handle at top-left for repositioning
- Each prompt has a color-coded stage badge + headline + suggestion text + follow-up
- Old prompts fade to 60% opacity with #aaa text color (still readable)
- Max 3 prompts visible, oldest removed when 4th arrives
- Scrolls to bottom automatically when new prompt appears

---

## Sales Frameworks in Knowledge Base

All seeded via `scripts/seed-frameworks.js` into Supabase with pgvector embeddings:

- **SPAIN Discovery**: Situation → Pain → Accountability → Implications → Needs Payoff
- **V-L-F-A-R Dialogue**: Validate → Label → Frame → Ask → Repeat
- **Identity Shifting** (objection methodology): Isolate → Binary Identity → Historical Pattern → Mirror Reality → Identity Choice
- **Money Objection**: 8 phases
- **Spouse Objection**: 8 phases
- **Think About It Objection**: 10 phases
- **No Time Objection**: 6 phases
- **7 Call Stages**: Introduction, Set, Discovery, Transition, Pitch, Close, Objection Handling

---

## Known Issues & What to Work On Next

### Active Issues
1. **Deepgram transcription quality** — System audio sometimes garbles badly, which confuses Claude's suggestions. No fix yet — may need Deepgram's enhanced models or a transcript cleanup step.
2. **Claude suggestion length** — Claude sometimes generates very long suggestions. Worth adding a max word count instruction to the system prompt.
3. **Prompt firing speed** — Target is ~1.5s after prospect finishes. Polling timer + backchannel fix should mostly solve this. Still being tested.

### Next Features (see BUILD-PLAN.md)
1. **Discovery Tracker** — Side panel checkbox overlay showing what SPAIN info has been gathered
2. **Package as .dmg** — electron-builder for distribution
3. **Quick setup guide** — Install → grant Screen Recording → pick mic → go
4. **Post-call summary** — Save transcripts, show objections hit, suggestions used

### Phase 2 (Backend — Justin + Claude, no external dev)
- Node.js backend on Railway, user auth, API key proxy, Stripe billing, onboarding wizard
- Diagnostics dashboard — all terminal logs stored in Supabase per session, searchable web UI at scoutsystems.io/admin

---

## How to Continue Development

1. Share the entire `sales-overlay` folder with Claude in a new session
2. Point Claude to `CLAUDE.md` as the project memory file
3. Point Claude to this `TRANSFER-GUIDE.md` for deep context
4. Point Claude to `BUILD-PLAN.md` for the roadmap
5. Test with `cd ~/sales-overlay && npm start`
6. When making code changes, always syntax check: `node -c src/ai/claude.js` (etc.)

### Justin's Preferences
- Not a developer — explain things simply, provide exact terminal commands
- Always use universal sales framework structure, never client-specific content
- Tests with real calls or YouTube roleplay videos for the prospect audio
- Narrates issues in real time during tests — look for `[CLOSER]:` turns that describe problems
- Iterative approach: test → find issues → fix → test again
