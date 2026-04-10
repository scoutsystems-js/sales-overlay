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
- **Click-through** (`setIgnoreMouseEvents(true, {forward: true})`) with drag handle top-left
- **Stacking prompts** — new prompts appear below, old ones fade to 60% opacity with #aaa text color
- **Max 3 visible** — oldest removed when 4th appears
- **Stage badges** — color-coded (blue default, red objection, green close, amber transition)

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
- Click-through overlay with drag handle
- Audio device enumeration and dual-input UI
- Stage progression allows skipping 2 stages, 3 after 30 turns, any after 50 turns

## Current Status: What's Being Tuned
1. **Prompt firing speed** — Target: fires within ~1.5s of prospect finishing. With polling timer + backchannel fix this should now work. Still being tested.
2. **Delivery detection sensitivity** — Currently 35% threshold with question-first matching. May need further tuning based on real call testing.
3. **Deepgram transcription quality** — System audio (YouTube/loopback) sometimes garbles badly, which confuses Claude's suggestions. Open issue — no fix yet.
4. **Claude suggestion length** — Claude sometimes generates very long suggestions. Could benefit from a max word count instruction in the system prompt.

## Current Status: Not Yet Built
- Discovery Tracker (side panel checkbox overlay — see BUILD-PLAN.md)
- Post-call summary
- Onboarding wizard
- electron-builder packaging (.dmg/.exe)
- Backend / auth / billing (Phase 2 — building with Claude, no external dev)
- Diagnostics dashboard (Phase 2 — see BUILD-PLAN.md for spec)

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

## Brand
- **Name:** Scout Systems
- **Domain:** scoutsystems.io
- **Product name TBD** — "Sales Overlay" is the working title, may rename for launch

## Future Plans
- Onboarding wizard (offer, price, target prospect, top objections)
- Post-call summary (objections hit, suggestions used, missed opportunities)
- Railway backend (server-side API proxy, auth, user accounts, diagnostics dashboard)
- electron-builder packaging (.dmg/.exe)
- Website at scoutsystems.io
- See BUILD-PLAN.md for full 4-phase roadmap

## Preferences
- Justin is not a developer — explain things simply, provide exact terminal commands
- Always use universal sales framework structure, never client-specific content
- Test with `cd ~/sales-overlay && npm start`
- When making code changes, always run `node -c <file>` to syntax check before declaring done
