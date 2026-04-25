// In development, .env sits at the project root (two levels up from src/main/).
// In a packaged app, electron-builder copies .env into the app's resourcesPath.
// We try the dev path first; if it doesn't exist, fall back to resourcesPath.
(function loadEnv() {
  var _path = require('path');
  var _fs = require('fs');
  var devPath = _path.join(__dirname, '..', '..', '.env');
  var prodPath = process.resourcesPath ? _path.join(process.resourcesPath, '.env') : devPath;
  var envPath = _fs.existsSync(devPath) ? devPath : prodPath;
  require('dotenv').config({ path: envPath });
})();

const { initMain } = require('electron-audio-loopback');
initMain(); // Must be called before app.whenReady()

const { app, BrowserWindow, ipcMain, screen, dialog, session, systemPreferences, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const DeepgramTranscriber = require('../transcription/deepgram');
const ClaudeCoach = require('../ai/claude');
const KnowledgeBase = require('../ai/knowledge-base');
const CallMemory = require('../ai/call-memory');
const ScriptParser = require('../ai/script-parser');
const ProxyClient = require('../lib/proxy-client');
const SessionLogger = require('../lib/session-logger');
const pkg = require('../../package.json');
const config = require('../config');

const BACKEND_URL = config.BACKEND_URL;
const SKIP_AUTH = process.env.SKIP_AUTH === 'true';

// v1.0.7-alpha: timing instrumentation — toggle with SCOUT_TIMING=1 env var.
// The guard lives inside the helper so every callsite is just timingLog(msg)
// with no if-wrapping — makes Phase B removal a single grep + delete.
const TIMING_ENABLED = process.env.SCOUT_TIMING === '1';
function timingLog(msg) { if (TIMING_ENABLED) console.log(msg); }
let tokenPath = null; // Set after app is ready (needs app.getPath)

let authWindow = null;
let controlWindow = null;
let overlayWindow = null;
let discoveryWindow = null;
let onboardingWindow = null;
let deepgram = null;
let claude = null;
let kb = null;
let callMemory = null;
let activeClient = 'generic'; // Current client filter for KB searches
let uploadedScripts = {};     // clientId -> array of parsed entries (in-memory for uploaded scripts)
let suggestionPollInterval = null; // Polls getSuggestion() during natural pauses in conversation
let sessionLogger = null; // v1.0.5: tees console.log during a session into Supabase via /log endpoints

function createAuthWindow() {
  authWindow = new BrowserWindow({
    width: 420,
    height: 540,
    center: true,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  authWindow.loadFile(path.join(__dirname, '..', 'renderer', 'auth', 'auth.html'));
  authWindow.on('closed', function() { authWindow = null; });
}

// Auth IPC handlers — return full session so the renderer persists refresh_token
// and expires_at. Without those we can't refresh the access token when it expires.
ipcMain.handle('auth-login', async function(event, email, password) {
  try {
    var res = await fetch(BACKEND_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    });
    var data = await res.json();
    if (!res.ok) return { error: data.error || 'Login failed. Check your email and password.' };
    return {
      token: data.access_token || data.token,
      access_token: data.access_token || data.token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      user: data.user,
    };
  } catch (err) {
    console.error('[auth] Login error:', err.message);
    return { error: 'Could not reach server. Check your internet connection.' };
  }
});

ipcMain.handle('auth-signup', async function(event, email, password) {
  try {
    var res = await fetch(BACKEND_URL + '/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    });
    var data = await res.json();
    if (!res.ok) return { error: data.error || 'Signup failed. Try a different email.' };
    return {
      token: data.access_token || data.token,
      access_token: data.access_token || data.token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      user: data.user,
    };
  } catch (err) {
    console.error('[auth] Signup error:', err.message);
    return { error: 'Could not reach server. Check your internet connection.' };
  }
});

ipcMain.handle('check-subscription', async function(event, token) {
  // Billing disabled during free beta — all logged-in users get full access.
  // Set SKIP_BILLING=false in .env when Stripe is configured and ready to charge.
  if (process.env.SKIP_BILLING !== 'false') {
    return { active: true, status: 'beta' };
  }
  try {
    var res = await fetch(BACKEND_URL + '/billing/status', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    if (res.status === 401) return { error: 'Session expired', active: false };
    var data = await res.json();
    var active = data.status === 'active' || data.status === 'trialing';
    return { active: active, status: data.status };
  } catch (err) {
    console.error('[auth] Subscription check error:', err.message);
    return { error: 'Could not reach server.' };
  }
});

ipcMain.handle('open-checkout', async function(event, token) {
  // Opens the pricing page in the user's browser.
  // Once Stripe is configured, this will generate a checkout session
  // and redirect to the hosted checkout page, then back to scoutsystems.io/welcome.
  shell.openExternal('https://scoutsystems.io/#pricing');
  return { success: true };
});

// get-token auto-refreshes if the stored access_token is expired/expiring. The
// renderer gets a fresh JWT back without knowing anything about refresh tokens.
// Returns null if the session is unrecoverable (no refresh_token or refresh
// call failed) — the renderer should show the login screen in that case.
ipcMain.handle('get-token', async function() {
  try {
    return await ensureFreshToken();
  } catch (err) { return null; }
});

// save-token accepts either a bare access_token string (legacy) OR a full
// session object { access_token, refresh_token, expires_at }. The renderer's
// auth code passes the full login response, so refresh_token is preserved.
ipcMain.handle('save-token', async function(event, payload) {
  try {
    if (!tokenPath) return { error: 'tokenPath not set' };
    var session;
    if (payload && typeof payload === 'object') {
      session = {
        access_token: payload.access_token || payload.token,
        refresh_token: payload.refresh_token || null,
        expires_at: payload.expires_at || null,
      };
    } else {
      session = { access_token: payload, refresh_token: null, expires_at: null };
    }
    saveSessionToDisk(session);
    return { success: true };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('clear-token', async function() {
  try {
    if (tokenPath && fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
    return { success: true };
  } catch (err) { return { error: err.message }; }
});

ipcMain.on('auth-success', async function() {
  // Create app windows first, then close auth so window-all-closed never fires.
  // If the user hasn't completed onboarding, show the wizard instead of the
  // main control panel. The wizard is responsible for opening the control/
  // overlay/discovery trio when it finishes or is skipped.
  initKnowledgeBase();

  // Refresh the access token up-front so the onboarding check actually reaches
  // Supabase instead of failing with JWT expired and fail-opening to "no wizard
  // needed." If the session can't be refreshed, fall back to the login screen.
  var token = await ensureFreshToken();
  if (!token) {
    console.log('[auth] Session could not be refreshed — reopening login.');
    if (!authWindow) createAuthWindow();
    return;
  }

  var needsOnboarding = await needsOnboardingCheck(token);
  if (needsOnboarding) {
    createOnboardingWindow();
  } else {
    createControlWindow();
    createOverlayWindow();
    createDiscoveryWindow();
  }
  if (authWindow) { authWindow.close(); authWindow = null; }
});

// ── Onboarding flow ──────────────────────────────────────────────────────
// On first login, users land in the onboarding wizard (niche, offer, pricing,
// payment links, qualifications). "Save & continue" marks the profile
// completed and boots the main app. "Skip for now" still boots the main app
// but saves any partial data so the wizard can resume, and triggers a nudge
// banner on the control panel. Onboarding state lives in Supabase's
// `user_profiles` table with RLS scoped to auth.uid().

// Returns the full session object stored on disk: { access_token, refresh_token, expires_at }.
// The legacy `token` key (old installs) is mapped to access_token for compatibility.
function readSessionFromDisk() {
  try {
    if (tokenPath && fs.existsSync(tokenPath)) {
      var data = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      return {
        access_token: data.access_token || data.token || null,
        refresh_token: data.refresh_token || null,
        expires_at: data.expires_at || null,
      };
    }
  } catch (err) {}
  return null;
}

function saveSessionToDisk(session) {
  if (!tokenPath || !session || !session.access_token) return false;
  try {
    // Keep `token` key for backwards compatibility with anything still reading the old shape.
    fs.writeFileSync(tokenPath, JSON.stringify({
      token: session.access_token,
      access_token: session.access_token,
      refresh_token: session.refresh_token || null,
      expires_at: session.expires_at || null,
    }), 'utf8');
    return true;
  } catch (err) {
    console.error('[auth] saveSessionToDisk failed:', err.message);
    return false;
  }
}

function clearSessionFromDisk() {
  try {
    if (tokenPath && fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  } catch (err) {}
}

// Treat a token with less than this many seconds remaining as expired. Gives
// us a safety margin so we don't race the clock on an in-flight request whose
// access_token ticks over to expired between ensureFreshToken() and the
// downstream HTTP call.
var JWT_EXPIRY_GRACE_SEC = 60;

// Parse a JWT's payload without verifying its signature. We only read the
// `exp` and `sub` claims (for expiry and user id); RLS enforces real
// authorization downstream. Returns null for any malformed token.
function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    var parts = token.split('.');
    if (parts.length < 2) return null;
    var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (err) {
    return null;
  }
}

function isJwtExpired(accessToken) {
  var payload = decodeJwtPayload(accessToken);
  if (!payload || !payload.exp) return true;
  return payload.exp <= Math.floor(Date.now() / 1000) + JWT_EXPIRY_GRACE_SEC;
}

// Ensure the stored access_token is valid. If expired, attempt a refresh using
// the stored refresh_token. On any unrecoverable failure, clear the session
// and return null — the caller is responsible for showing the login screen.
// This is the single choke point for every token read in the app; the IPC
// handler, the onboarding check, and the proxy client all route through it.
var _refreshInFlight = null; // Dedupes concurrent refreshes
async function ensureFreshToken() {
  var session = readSessionFromDisk();
  if (!session || !session.access_token) return null;

  if (!isJwtExpired(session.access_token)) {
    return session.access_token;
  }

  if (!session.refresh_token) {
    console.log('[auth] access_token expired and no refresh_token — clearing session.');
    clearSessionFromDisk();
    return null;
  }

  // If a refresh is already running, wait for it instead of firing a second one.
  if (_refreshInFlight) {
    try { return await _refreshInFlight; }
    catch (err) { return null; }
  }

  _refreshInFlight = (async function() {
    try {
      console.log('[auth] access_token expired — refreshing session...');
      var res = await fetch(BACKEND_URL + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!res.ok) {
        console.log('[auth] Refresh failed:', res.status, '— clearing session.');
        clearSessionFromDisk();
        return null;
      }
      var data = await res.json();
      var sess = data.session || data;
      var newAccess = sess.access_token || null;
      var newRefresh = sess.refresh_token || session.refresh_token;
      var newExpires = sess.expires_at || null;
      if (!newAccess) {
        console.log('[auth] Refresh response missing access_token — clearing session.');
        clearSessionFromDisk();
        return null;
      }
      saveSessionToDisk({
        access_token: newAccess,
        refresh_token: newRefresh,
        expires_at: newExpires,
      });
      console.log('[auth] Session refreshed.');
      return newAccess;
    } catch (err) {
      console.error('[auth] Refresh error:', err.message);
      clearSessionFromDisk();
      return null;
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

// Build a Supabase client authenticated as the current user. The user's JWT
// is passed as an Authorization header so RLS policies using auth.uid() work.
function createSupabaseForUser(token) {
  if (!token) return null;
  var { createClient } = require('@supabase/supabase-js');
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false },
  });
}

// Build a ProxyClient that fetches a fresh access_token (refreshing via Supabase
// if needed) before every request. Returning a fresh client per session keeps
// things simple and avoids caching a stale token getter.
function buildProxyClient() {
  return new ProxyClient(function() { return ensureFreshToken(); });
}

// Extract the Supabase user id (`sub` claim) from a JWT. RLS still enforces
// that users can't write anyone else's row, so a forged id here just makes
// the insert fail — no crypto check needed.
function decodeUserIdFromToken(token) {
  var payload = decodeJwtPayload(token);
  return payload ? (payload.sub || null) : null;
}

// True if the user has no profile row OR has started but not finished setup.
// On any failure we return false so errors never block the user from reaching
// the app — worst case they just don't see the wizard, which matches the
// "nudge but allow" skip model anyway.
async function needsOnboardingCheck(token) {
  if (!token) return false;
  var supabase = createSupabaseForUser(token);
  if (!supabase) return false;
  try {
    var res = await supabase.from('user_profiles').select('completed_at').maybeSingle();
    if (res.error) {
      console.error('[onboarding] Check error:', res.error.message);
      return false;
    }
    return !res.data || !res.data.completed_at;
  } catch (err) {
    console.error('[onboarding] Check exception:', err.message);
    return false;
  }
}

function createOnboardingWindow() {
  onboardingWindow = new BrowserWindow({
    width: 480,
    height: 560,
    center: true,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  onboardingWindow.loadFile(path.join(__dirname, '..', 'renderer', 'onboarding', 'onboarding.html'));
  onboardingWindow.on('closed', function() { onboardingWindow = null; });
}

// Loads the current user's profile — used to pre-populate the wizard when
// a user resumes an incomplete setup, and (later) by the overlay to feed the
// closer's offer details into Claude's system prompt on each session.
ipcMain.handle('get-profile', async function() {
  // Use ensureFreshToken so a long-running wizard session doesn't silently 401
  // on a token that expired while the user was filling out fields.
  var token = await ensureFreshToken();
  var supabase = createSupabaseForUser(token);
  if (!supabase) return { error: 'Not authenticated' };
  try {
    var res = await supabase.from('user_profiles').select('*').maybeSingle();
    if (res.error) return { error: res.error.message };
    return { profile: res.data || null };
  } catch (err) { return { error: err.message }; }
});

// Saves the wizard data. When `data.completed === true`, sets completed_at
// so the wizard stops showing on future launches. On skip, any partial data
// is saved but completed_at stays null so the wizard reappears next login.
ipcMain.handle('save-profile', async function(event, data) {
  var token = await ensureFreshToken();
  var supabase = createSupabaseForUser(token);
  if (!supabase) return { error: 'Not authenticated' };
  var userId = decodeUserIdFromToken(token);
  if (!userId) return { error: 'Could not decode user id from token' };
  try {
    var row = {
      user_id:        userId,
      niche:          data.niche || null,
      offer:          data.offer || null,
      price_pif:      data.price_pif != null ? data.price_pif : null,
      price_2pay:     data.price_2pay != null ? data.price_2pay : null,
      qualifications: data.qualifications || null,
      pif_url:        data.pif_url || null,
      twopay_url:     data.twopay_url || null,
      affirm_url:     data.affirm_url || null,
    };
    if (data.completed === true) row.completed_at = new Date().toISOString();
    var res = await supabase
      .from('user_profiles')
      .upsert(row, { onConflict: 'user_id' })
      .select()
      .maybeSingle();
    if (res.error) return { error: res.error.message };
    return { profile: res.data };
  } catch (err) { return { error: err.message }; }
});

// Saves a sales script: summarizes via /proxy/summarize-script, then writes
// both script_raw and script_summary atomically. Aborts on summarization
// failure — never persists script_raw without script_summary, since the
// suggestion engine reads only script_summary.
ipcMain.handle('save-script', async function(event, data) {
  var scriptRaw = (data && data.script_raw) ? data.script_raw.trim() : '';
  if (!scriptRaw) return { error: 'No script text provided' };

  var token = await ensureFreshToken();
  var supabase = createSupabaseForUser(token);
  if (!supabase) return { error: 'Not authenticated' };
  var userId = decodeUserIdFromToken(token);
  if (!userId) return { error: 'Could not decode user id from token' };

  // Step 1: Summarize via backend. If this fails, abort — never write
  // script_raw without script_summary. Partial state is worse than no state.
  var summary;
  try {
    var proxy = buildProxyClient();
    var summaryRes = await proxy.summarizeScript({ scriptText: scriptRaw });
    if (!summaryRes.summary) return { error: 'Summarization returned empty response' };
    summary = summaryRes.summary;
  } catch (err) {
    console.error('[main] save-script summarization error:', err.message);
    return { error: 'Could not summarize script: ' + err.message };
  }

  // Step 2: Write both columns atomically. One upsert, one DB round-trip.
  try {
    var row = {
      user_id:        userId,
      script_raw:     scriptRaw,
      script_summary: summary,
    };
    var res = await supabase
      .from('user_profiles')
      .upsert(row, { onConflict: 'user_id' })
      .select()
      .maybeSingle();
    if (res.error) return { error: res.error.message };
    console.log('[main] Script saved successfully for user ' + userId);
    return { ok: true };
  } catch (err) {
    console.error('[main] save-script DB error:', err.message);
    return { error: err.message };
  }
});

// Wizard finished — launch the main app windows.
ipcMain.on('onboarding-complete', function() {
  createControlWindow();
  createOverlayWindow();
  createDiscoveryWindow();
  if (onboardingWindow) { onboardingWindow.close(); onboardingWindow = null; }
});

// Wizard skipped — launch the main windows, then tell the control panel to
// show the "finish setup" nudge banner once it's done loading.
ipcMain.on('onboarding-skip', function() {
  createControlWindow();
  createOverlayWindow();
  createDiscoveryWindow();
  if (controlWindow) {
    controlWindow.webContents.once('did-finish-load', function() {
      if (controlWindow) controlWindow.webContents.send('show-setup-nudge');
    });
  }
  if (onboardingWindow) { onboardingWindow.close(); onboardingWindow = null; }
});

// Reopen the wizard from the control panel (user clicked the nudge banner).
ipcMain.on('open-onboarding', function() {
  if (!onboardingWindow) createOnboardingWindow();
  else onboardingWindow.focus();
});

// Initialize knowledge base on startup.
// Supabase URL + anon key are hardcoded public values in src/config.js — no
// env vars required. The KB is always enabled in the packaged app.
function initKnowledgeBase() {
  kb = new KnowledgeBase(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  console.log('[main] Knowledge base initialized');
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 420,
    height: 420,
    show: false, // Hidden — audio capture runs here but no UI shown to user
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controlWindow.loadFile(path.join(__dirname, '..', 'renderer', 'control', 'index.html'));

  // Pipe renderer console logs to terminal for debugging
  controlWindow.webContents.on('console-message', function(event, level, message) {
    console.log(message);
  });
}

function createDiscoveryWindow() {
  var display = screen.getPrimaryDisplay();
  var winWidth = 190;
  var winX = display.workArea.x + display.workArea.width - winWidth;

  discoveryWindow = new BrowserWindow({
    width: winWidth,
    height: 250,
    x: winX,
    y: display.workArea.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false, // Hidden until session starts
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  discoveryWindow.loadFile(path.join(__dirname, '..', 'renderer', 'discovery', 'discovery.html'));

  // v1.0.9: pipe renderer console output to main's stdout (and therefore
  // SessionLogger → session_logs). Mirror of the controlWindow pipe above.
  // Without this, TypeErrors in discovery.html fire silently — the v1.0.8
  // discovery-IPC-break bug survived multiple releases for exactly that reason.
  discoveryWindow.webContents.on('console-message', function(event, level, message) {
    console.log(message);
  });

  discoveryWindow.on('closed', function() {
    discoveryWindow = null;
  });
}

function createOverlayWindow() {
  var display = screen.getPrimaryDisplay();
  var overlayWidth = Math.floor(display.workArea.width / 2);
  var overlayX = display.workArea.x + Math.floor((display.workArea.width - overlayWidth) / 2);

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: 200,
    x: overlayX,
    y: display.workArea.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));

  // Window auto-resizes to match bar height so transparent area below is never covered.

  // v1.0.9: pipe renderer console output to main's stdout (and therefore
  // SessionLogger → session_logs). Highest-traffic renderer window; silent
  // failures here would be as invisible as the discovery bug was.
  overlayWindow.webContents.on('console-message', function(event, level, message) {
    console.log(message);
  });

  overlayWindow.on('closed', function() {
    overlayWindow = null;
    app.quit();
  });
}

// Get available clients (only uploaded scripts — no hardcoded clients)
ipcMain.handle('get-clients', async function() {
  var clients = [
    { id: 'generic', name: 'No Script (Core Framework Only)' },
  ];

  var uploadedIds = Object.keys(uploadedScripts);
  for (var i = 0; i < uploadedIds.length; i++) {
    var id = uploadedIds[i];
    clients.push({ id: id, name: uploadedScripts[id].name + ' (uploaded)' });
  }

  return clients;
});

// Upload and parse a script
ipcMain.handle('upload-script', async function(event, scriptText, clientName) {
  try {
    console.log('[main] Uploading script: ' + clientName);

    var parser = new ScriptParser(process.env.ANTHROPIC_API_KEY);
    var entries = await parser.parseScript(scriptText, clientName);

    if (entries.length === 0) {
      return { success: false, error: 'Could not parse any entries from script' };
    }

    var clientId = clientName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    uploadedScripts[clientId] = {
      name: clientName,
      entries: entries,
    };

    if (kb) {
      console.log('[main] Seeding ' + entries.length + ' parsed entries to Supabase...');
      var seeded = 0;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        try {
          await kb.addEntry(
            e.category || 'client_stage',
            e.label || clientId + ' - Section ' + (i + 1),
            e.content || '',
            e.triggers || [],
            e.metadata || { client: clientId }
          );
          seeded++;
        } catch (err) {
          console.error('[main] Failed to seed entry:', err.message);
        }
      }
      console.log('[main] Seeded ' + seeded + '/' + entries.length + ' entries');
    }

    console.log('[main] Script uploaded: ' + clientId + ' (' + entries.length + ' entries)');

    return {
      success: true,
      clientId: clientId,
      clientName: clientName,
      entriesCount: entries.length,
    };
  } catch (err) {
    console.error('[main] Script upload failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.on('start-session', async function(event, clientId) {
  activeClient = clientId || 'generic';

  if (kb) {
    kb.activeClient = activeClient;
  }

  var proxy = buildProxyClient();

  // v1.0.5: start the cloud logger FIRST so every console.log from this point
  // on gets captured alongside its session_id. If session-start fails (e.g.
  // network drop), we continue without logging rather than block the call.
  sessionLogger = new SessionLogger(proxy, {
    clientVersion: pkg.version,
    platform: process.platform + '-' + process.arch,
  });
  try {
    var sid = await sessionLogger.start();
    console.log('[main] Cloud logging session started: ' + sid);
  } catch (err) {
    console.error('[main] Cloud logging failed to start (continuing without it):', err.message);
    sessionLogger = null;
  }

  console.log('[main] Starting session... Client: ' + activeClient);

  // Mint an ephemeral (10 min) Deepgram key via the backend proxy. Deepgram
  // only auths at WebSocket handshake, so 10 min is fine for calls of any
  // length once the socket is open.
  var deepgramKey;
  try {
    var keyRes = await proxy.getDeepgramKey();
    deepgramKey = keyRes.key;
  } catch (err) {
    console.error('[main] Failed to obtain Deepgram key:', err.message);
    if (overlayWindow) {
      overlayWindow.webContents.send('status-update', { active: false, error: err.message });
    }
    // End the cloud-log session so it doesn't hang open
    if (sessionLogger) { try { await sessionLogger.end(); } catch (_) {} sessionLogger = null; }
    return;
  }

  deepgram = new DeepgramTranscriber(deepgramKey, function(data) {
    var text = data.text;
    var isFinal = data.isFinal;
    var speaker = data.speaker;
    if (!isFinal || !text.trim()) return;

    var speakerLabel = speaker === 0 ? 'CLOSER' : 'PROSPECT';

    if (controlWindow) {
      controlWindow.webContents.send('append-transcript', { speaker: speakerLabel, text: text });
    }

    // v1.0.7-alpha: t0 — stamp when a final PROSPECT transcript arrives.
    // Reset per-cycle state so the next getSuggestion run measures against
    // this new baseline. gate_blocked logs reference this t0 until the next
    // prospect-final fires.
    if (speakerLabel === 'PROSPECT' && claude) {
      claude._lastProspectT0 = Date.now();
      claude._gatesBlockedSinceT0 = 0;
      timingLog('[TIMING] cycle=none stage=t0_prospect_final abs_ms=0 dt_prev=0 detail=text_len=' + text.length);
    }

    claude.addTurn(text, speakerLabel);
    claude.getSuggestion(function(suggestion) {
      if (overlayWindow) {
        overlayWindow.webContents.send('new-suggestion', suggestion);
      }
    });
  });

  // Feature 3: fetch script_summary for this session.
  // SELECT * in get-profile already returns it after
  // migration 004 — we do a targeted select here to
  // keep start-session self-contained and avoid
  // depending on a prior get-profile call having run.
  var scriptSummary = null;
  try {
    var scriptToken = await ensureFreshToken();
    var scriptSupabase = createSupabaseForUser(scriptToken);
    if (scriptSupabase) {
      var scriptRes = await scriptSupabase
        .from('user_profiles')
        .select('script_summary')
        .maybeSingle();
      if (scriptRes.data && scriptRes.data.script_summary) {
        scriptSummary = scriptRes.data.script_summary;
        console.log('[main] Script summary loaded for session.');
      }
    }
  } catch (err) {
    // Non-fatal — session continues without script context.
    console.error('[main] Could not fetch script_summary:', err.message);
  }

  callMemory = new CallMemory(proxy, function(discovery) {
    if (discoveryWindow) {
      discoveryWindow.webContents.send('discovery-update', discovery);
    }
  });
  callMemory.scriptSummary = scriptSummary;
  claude = new ClaudeCoach(proxy, kb, callMemory);

  // Poll getSuggestion() every 1.5s so natural pauses still trigger prompts
  suggestionPollInterval = setInterval(function() {
    if (claude) {
      claude.getSuggestion(function(suggestion) {
        if (overlayWindow) {
          overlayWindow.webContents.send('new-suggestion', suggestion);
        }
      });
    }
  }, 1500);

  try {
    await deepgram.connect();
    console.log('[main] Deepgram connected successfully');
    // Tell the hidden control window to start audio capture
    if (controlWindow) {
      controlWindow.webContents.send('trigger-start-audio');
    }
    if (overlayWindow) {
      overlayWindow.webContents.send('status-update', { active: true });
    }
    if (discoveryWindow) {
      discoveryWindow.show();
    }
  } catch (err) {
    console.error('[main] Failed to connect to Deepgram:', err.message);
    if (overlayWindow) {
      overlayWindow.webContents.send('status-update', { active: false });
    }
  }
});

ipcMain.on('stop-session', async function() {
  console.log('[main] Stopping session...');
  if (suggestionPollInterval) { clearInterval(suggestionPollInterval); suggestionPollInterval = null; }
  if (deepgram) { deepgram.disconnect(); deepgram = null; }
  if (claude) { claude.reset(); claude = null; }
  if (callMemory) { callMemory.reset(); callMemory = null; }
  // Tell the hidden control window to stop audio capture
  if (controlWindow) {
    controlWindow.webContents.send('trigger-stop-audio');
  }
  if (overlayWindow) {
    overlayWindow.webContents.send('status-update', { active: false });
  }
  if (discoveryWindow) {
    discoveryWindow.webContents.send('discovery-reset');
    discoveryWindow.hide();
  }
  // v1.0.5: flush remaining log batch and mark session ended. Runs last so
  // the "Stopping session..." line and all teardown logs are captured.
  if (sessionLogger) {
    try { await sessionLogger.end(); } catch (_) { /* best-effort */ }
    sessionLogger = null;
  }
});

ipcMain.on('audio-chunk', function(event, buffer) {
  if (deepgram && deepgram.isConnected) {
    deepgram.sendAudio(Buffer.from(buffer));
  }
});

ipcMain.on('renderer-log', function(event, msg) {
  console.log(msg);
});

// Feature 4: relay call-detected signal from
// control window to overlay. The sessionActive
// guard lives in control.js — this relay fires
// only when control.js determines audio is active
// without a running session.
ipcMain.on('call-detected', function() {
  console.log('[main] Call detected — relaying to overlay');
  if (overlayWindow) {
    overlayWindow.webContents.send('call-detected');
  }
});

ipcMain.on('quit-app', function() {
  app.quit();
});

ipcMain.on('resize-discovery', function(event, height) {
  if (discoveryWindow) {
    var bounds = discoveryWindow.getBounds();
    discoveryWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: Math.max(30, Math.ceil(height)) });
  }
});

ipcMain.on('resize-overlay', function(event, height) {
  if (overlayWindow) {
    var bounds = overlayWindow.getBounds();
    overlayWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: Math.max(44, Math.ceil(height)) });
  }
});

ipcMain.on('show-suggestion', function(event, data) {
  if (overlayWindow) { overlayWindow.webContents.send('new-suggestion', data); }
});

ipcMain.on('clear-suggestion', function() {
  if (overlayWindow) { overlayWindow.webContents.send('clear-suggestion'); }
});

function initAutoUpdater() {
  if (!app.isPackaged) return;

  var autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    console.error('[updater] electron-updater unavailable — auto-update disabled:', err.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', function() {
    console.log('[updater] Checking for updates...');
  });

  autoUpdater.on('update-available', function(info) {
    console.log('[updater] Update available: ' + info.version);
    if (controlWindow) {
      controlWindow.webContents.send('update-status', { message: 'Update downloading... v' + info.version });
    }
  });

  autoUpdater.on('update-not-available', function() {
    console.log('[updater] App is up to date');
  });

  autoUpdater.on('download-progress', function(progress) {
    console.log('[updater] Download progress: ' + Math.round(progress.percent) + '%');
  });

  autoUpdater.on('update-downloaded', function(info) {
    console.log('[updater] Update downloaded: ' + info.version);
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'Scout v' + info.version + ' has been downloaded.',
      detail: 'The update will be installed when you quit the app.',
      buttons: ['Install Now', 'Later'],
    }).then(function(result) {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', function(err) {
    console.error('[updater] Error:', err.message);
  });

  // One-shot startup check 5s after launch — catches releases published
  // before this session started.
  setTimeout(function() {
    autoUpdater.checkForUpdates();
  }, 5000);

  // Periodic poll every 30 minutes so a long-running Scout (left open for
  // a full work day) still discovers releases without needing a restart.
  // 2 requests/hour is well under GitHub's 60/hr unauthenticated rate limit.
  // Without this, apps that were already running when a release dropped
  // never re-check and users have to manually reinstall to update.
  setInterval(function() {
    autoUpdater.checkForUpdates();
  }, 30 * 60 * 1000);
}

app.whenReady().then(async function() {
  // Set token storage path now that app is ready
  tokenPath = path.join(app.getPath('userData'), 'scout-session.json');

  // Tell Electron's Chromium layer to auto-grant media permissions.
  // Without this, every getUserMedia / enumerateDevices call triggers
  // a Chromium-level permission check which kicks off repeated OS dialogs.
  session.defaultSession.setPermissionRequestHandler(function(webContents, permission, callback) {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler(function(webContents, permission) {
    if (permission === 'media') return true;
    return false;
  });

  // Pre-request microphone at the macOS TCC level so the OS only shows
  // the dialog once (on first launch), then caches it forever.
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone');
  }

  initAutoUpdater();

  if (SKIP_AUTH) {
    // Dev shortcut — skip login screen entirely
    console.log('[main] SKIP_AUTH=true — bypassing auth');
    initKnowledgeBase();
    createControlWindow();
    createOverlayWindow();
    createDiscoveryWindow();
  } else {
    createAuthWindow();
  }
});

app.on('window-all-closed', function() { app.quit(); });
