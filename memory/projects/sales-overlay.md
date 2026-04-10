# Sales Overlay — Project Detail

**Owner:** Justin Schmidt (personal project, NOT Net Revenue LLC)
**Status:** Active development, pre-alpha
**Started:** Early April 2026

## What It Is
Real-time AI sales coaching teleprompter. Electron app that listens to live sales calls via Deepgram STT, processes through Claude Sonnet API, and displays a transparent overlay bar at the top of the screen telling the closer exactly what to say next. Target market is high-ticket coaching/consulting closers.

## Architecture
- **Electron 41** desktop app with two BrowserWindow instances:
  - Control panel (420x420): session controls, transcript, audio device selectors, script upload
  - Overlay (full-width x 260px): transparent click-through bar at top of screen with stacking prompts
- **contextIsolation + preload IPC bridge** — no nodeIntegration in renderers
- **Deepgram Nova-2** via raw WebSocket (not SDK — SDK v5 is broken)
- **Claude Sonnet API** as live teleprompter engine
- **Supabase + pgvector** for knowledge base / RAG
- **BlackHole 16ch** virtual audio driver on macOS for capturing prospect voice

## Audio System
- Two audio inputs: closer mic + prospect audio (virtual device)
- Dual dropdowns in control panel for device selection
- Auto-detects BlackHole/virtual/loopback devices
- Mixes both into mono PCM16 at 16kHz → sends to Deepgram
- desktopCapturer approach was abandoned (doesn't work on macOS)
- Requires Multi-Output Device in macOS Audio MIDI Setup

## AI Pipeline
1. Deepgram transcribes audio in real time
2. Speaker diarization: speaker 0 = CLOSER, speaker 1+ = PROSPECT
3. CallMemory tracks rolling summary, detects call stage (7 stages)
4. ClaudeCoach rate-limits (5s + 2 turns), searches KB, calls Claude API
5. Delivery detection: fuzzy-matches closer speech against current suggestion (30% keyword threshold)
6. Only advances to next prompt when closer delivers the line
7. Objections detected on prospect speech only, bypass delivery gate
8. Overlay stacks prompts (new below, old fades, max 3 visible)

## Key Env Vars (.env)
- DEEPGRAM_API_KEY
- ANTHROPIC_API_KEY
- SUPABASE_URL
- SUPABASE_ANON_KEY

## Known Issues (as of April 6, 2026)
1. Prospect audio not being captured — BlackHole is installed but need to verify it's being selected and captured in the app. Debug logging via logToMain IPC was just added.
2. KB may have stale entries — user hasn't run seed scripts yet.
3. Script upload feature is built but untested.
