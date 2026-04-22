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
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const DeepgramTranscriber = require('../transcription/deepgram');
const ClaudeCoach = require('../ai/claude');
const KnowledgeBase = require('../ai/knowledge-base');
const CallMemory = require('../ai/call-memory');
const ScriptParser = require('../ai/script-parser');

const BACKEND_URL = process.env.BACKEND_URL || 'https://sales-overlay-production.up.railway.app';
const SKIP_AUTH = process.env.SKIP_AUTH === 'true';
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

// Auth IPC handlers
ipcMain.handle('auth-login', async function(event, email, password) {
  try {
    var res = await fetch(BACKEND_URL + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    });
    var data = await res.json();
    if (!res.ok) return { error: data.error || 'Login failed. Check your email and password.' };
    return { token: data.token, user: data.user };
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
    return { token: data.token, user: data.user };
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

ipcMain.handle('get-token', async function() {
  try {
    if (tokenPath && fs.existsSync(tokenPath)) {
      var data = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      return data.token || null;
    }
    return null;
  } catch (err) { return null; }
});

ipcMain.handle('save-token', async function(event, token) {
  try {
    if (tokenPath) fs.writeFileSync(tokenPath, JSON.stringify({ token: token }), 'utf8');
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
  var token = readTokenFromDisk();
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

function readTokenFromDisk() {
  try {
    if (tokenPath && fs.existsSync(tokenPath)) {
      var data = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      return data.token || null;
    }
  } catch (err) {}
  return null;
}

// Build a Supabase client authenticated as the current user. The user's JWT
// is passed as an Authorization header so RLS policies using auth.uid() work.
function createSupabaseForUser(token) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !token) return null;
  var { createClient } = require('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false },
  });
}

// Extract the Supabase user id (`sub` claim) from a JWT without a crypto check —
// we only need it for upserts; RLS still enforces that users can't write anyone
// else's row, so a forged id here just makes the insert fail.
function decodeUserIdFromToken(token) {
  try {
    var b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return payload.sub || null;
  } catch (err) {
    return null;
  }
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
  var token = readTokenFromDisk();
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
  var token = readTokenFromDisk();
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

// Initialize knowledge base on startup
function initKnowledgeBase() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    kb = new KnowledgeBase(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      process.env.ANTHROPIC_API_KEY
    );
    console.log('[main] Knowledge base initialized');
  } else {
    console.log('[main] No Supabase credentials - knowledge base disabled');
  }
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
  var display = screen.getPrimaryDisplay().workAreaSize;
  var winWidth = 190;
  var winX = display.width - winWidth; // Right edge of screen

  discoveryWindow = new BrowserWindow({
    width: winWidth,
    height: 250,
    x: winX,
    y: 0,
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

  discoveryWindow.on('closed', function() {
    discoveryWindow = null;
  });
}

function createOverlayWindow() {
  var display = screen.getPrimaryDisplay().workAreaSize;
  var overlayWidth = Math.floor(display.width / 2);
  var overlayX = Math.floor((display.width - overlayWidth) / 2);

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: 200,
    x: overlayX,
    y: 0,
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
  console.log('[main] Starting session... Client: ' + activeClient);

  if (kb) {
    kb.activeClient = activeClient;
  }

  deepgram = new DeepgramTranscriber(process.env.DEEPGRAM_API_KEY, function(data) {
    var text = data.text;
    var isFinal = data.isFinal;
    var speaker = data.speaker;
    if (!isFinal || !text.trim()) return;

    var speakerLabel = speaker === 0 ? 'CLOSER' : 'PROSPECT';

    if (controlWindow) {
      controlWindow.webContents.send('append-transcript', { speaker: speakerLabel, text: text });
    }

    claude.addTurn(text, speakerLabel);
    claude.getSuggestion(function(suggestion) {
      if (overlayWindow) {
        overlayWindow.webContents.send('new-suggestion', suggestion);
      }
    });
  });

  callMemory = new CallMemory(process.env.ANTHROPIC_API_KEY, function(discovery) {
    if (discoveryWindow) {
      discoveryWindow.webContents.send('discovery-update', discovery);
    }
  });
  claude = new ClaudeCoach(process.env.ANTHROPIC_API_KEY, kb, callMemory);

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

ipcMain.on('stop-session', function() {
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
});

ipcMain.on('audio-chunk', function(event, buffer) {
  if (deepgram && deepgram.isConnected) {
    deepgram.sendAudio(Buffer.from(buffer));
  }
});

ipcMain.on('renderer-log', function(event, msg) {
  console.log(msg);
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
  // Only run auto-updates in packaged app, not during development
  if (!app.isPackaged) return;

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
      message: 'Sales Overlay v' + info.version + ' has been downloaded.',
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

  // Check for updates 5 seconds after launch
  setTimeout(function() {
    autoUpdater.checkForUpdates();
  }, 5000);
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
