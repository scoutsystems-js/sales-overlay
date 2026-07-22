// Server-side configuration constants. Values here are NOT secrets — they're
// the kind of thing that should change in one place and take effect
// everywhere (model IDs, timeouts, limits).
//
// Secrets still live in Railway Variables (ANTHROPIC_API_KEY, DEEPGRAM_*,
// SUPABASE_SERVICE_ROLE_KEY, etc.) and are read from process.env at use.

// Default Anthropic model — used by /proxy/memory (rolling call-memory
// summaries) and anywhere else that needs the intelligence/nuance of Sonnet.
// Live teleprompter suggestions use CLAUDE_SUGGESTION_MODEL below instead,
// because on a 2–3 second latency budget Haiku's speed matters more than
// Sonnet's depth.
const CLAUDE_MODEL = 'claude-sonnet-4-6';

// Dedicated model for /proxy/suggest (live teleprompter). Haiku 4.5 — same
// Claude 4.x family as CLAUDE_MODEL, tuned for ~600-900ms latency per call
// vs Sonnet's ~3000-3500ms. Quality trade-off accepted for real-time use.
// If this string 404s, the upstream error surfaces directly in session_logs
// via formatUpstreamError — one-line fix.
const CLAUDE_SUGGESTION_MODEL = 'claude-haiku-4-5-20251001';

// Canonical public origin. www is the real host (apex HTTPS times out —
// Namecheap URL-redirect limitation, see CLAUDE.md DNS notes). Used by the
// set-password redirect and anywhere else that mints absolute site URLs.
const CANONICAL_ORIGIN = 'https://www.scoutsystems.io';

module.exports = {
  CANONICAL_ORIGIN,
  CLAUDE_MODEL: CLAUDE_MODEL,
  CLAUDE_SUGGESTION_MODEL: CLAUDE_SUGGESTION_MODEL,
};
