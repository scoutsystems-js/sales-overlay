// Server-side configuration constants. Values here are NOT secrets — they're
// the kind of thing that should change in one place and take effect
// everywhere (model IDs, timeouts, limits).
//
// Secrets still live in Railway Variables (ANTHROPIC_API_KEY, DEEPGRAM_*,
// SUPABASE_SERVICE_ROLE_KEY, etc.) and are read from process.env at use.

// Anthropic model used for both live teleprompter suggestions (/proxy/suggest)
// and rolling call-memory summaries (/proxy/memory). Bump this one line when
// migrating to a newer Sonnet release.
const CLAUDE_MODEL = 'claude-sonnet-4-6';

module.exports = {
  CLAUDE_MODEL: CLAUDE_MODEL,
};
