// Public configuration values shipped with the desktop app.
//
// These are intentionally hardcoded rather than read from .env so the packaged
// DMG works without any local config file. Supabase URL + anon key are public
// by design — RLS policies in the database enforce that each user can only
// read/write their own rows. The anon key cannot bypass RLS.
//
// Anything that IS secret (Deepgram, Anthropic) is never shipped with the app;
// it lives in Railway environment variables and is accessed via the backend
// proxy at BACKEND_URL/proxy/*.
//
// Environment variables still honored as overrides (useful for local dev):
//   BACKEND_URL    — point the app at a local backend instead of production
//   SKIP_AUTH      — bypass login for quick UI work
//   SKIP_BILLING   — ignore subscription check (already default server-side)

const SUPABASE_URL = 'https://vkprybqmryiuwbdwdlpk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_d5PIRuqbX41G3McUGR3IZg_um7xvTgM';
const DEFAULT_BACKEND_URL = 'https://sales-overlay-production.up.railway.app';

const BACKEND_URL = process.env.BACKEND_URL || DEFAULT_BACKEND_URL;

module.exports = {
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  BACKEND_URL: BACKEND_URL,
};
