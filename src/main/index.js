const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

// In development, load keys from .env file.
// In production (packaged .dmg), load from the built-config bundled at build time.
if (app.isPackaged) {
  try {
    var builtConfig = require('./built-config');
    Object.assign(process.env, builtConfig);
  } catch(e) { /* built-config not present */ }
} else {
  require('dotenv').config();
}

const { initMain } = require('electron-audio-loopback');
initMain(); // Must be called before app.whenReady()
const path = require('path');
const DeepgramTranscriber = require('../transcription/deepgram');
const ClaudeCoach = require('../ai/claude');
const KnowledgeBase = require('../ai/knowledge-base');
const CallMemory = require('../ai/call-memory');
const ScriptParser = require('../ai/script-parser');

let overlayWindow = null;
let deepgram = null;
let claude = null;
let kb = null;
let callMemory = null;
let activeClient = 'generic';
let uploadedScripts = {};
let suggestionPollInterval = null;

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

function createOverlayWindow() {
  var display = screen.getPrimaryDisplay().workAreaSize;
  var overlayWidth = Math.round(display.width * 0.5);
  var overlayX = Math.round((display.width - overlayWidth) / 2);

  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: 260,
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

  // Click-through except for interactive elements in the control bar
  // (buttons/selects have pointer-events: auto set in HTML)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  if (process.env.NODE_ENV === 'development') {
    overlayWindow.webContents.openDevTools({ mode: 'detach' });
  }

  overlayWindow.on('closed', function() {
    overlayWindow = null;
    app.quit();
  });
}

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
    uploadedScripts[clientId] = { name: clientName, entries: entries };
    if (kb) {
      var seeded = 0;
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        try {
          await kb.addEntry(e.category || 'client_stage', e.label || clientId + ' - Section ' + (i + 1), e.content || '', e.triggers || [], e.metadata || { client: clientId });
          seeded++;
        } catch (err) { console.error('[main] Failed to seed entry:', err.message); }
      }
      console.log('[main] Seeded ' + seeded + '/' + entries.length + ' entries');
    }
    return { success: true, clientId: clientId, clientName: clientName, entriesCount: entries.length };
  } catch (err) {
    console.error('[main] Script upload failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.on('start-session', async function(event, clientId) {
  activeClient = clientId || 'generic';
  console.log('[main] Starting session... Client: ' + activeClient);
  if (kb) kb.activeClient = activeClient;

  deepgram = new DeepgramTranscriber(process.env.DEEPGRAM_API_KEY, function(data) {
    if (!data.isFinal || !data.text.trim()) return;
    var speakerLabel = data.speaker === 0 ? 'CLOSER' : 'PROSPECT';
    claude.addTurn(data.text, speakerLabel);
    claude.getSuggestion(function(suggestion) {
      if (overlayWindow) overlayWindow.webContents.send('new-suggestion', suggestion);
    });
  });

  callMemory = new CallMemory(process.env.ANTHROPIC_API_KEY);
  claude = new ClaudeCoach(process.env.ANTHROPIC_API_KEY, kb, callMemory);

  suggestionPollInterval = setInterval(function() {
    if (claude) {
      claude.getSuggestion(function(suggestion) {
        if (overlayWindow) overlayWindow.webContents.send('new-suggestion', suggestion);
      });
    }
  }, 1500);

  try {
    await deepgram.connect();
    console.log('[main] Deepgram connected');
    if (overlayWindow) overlayWindow.webContents.send('status-update', { active: true });
  } catch (err) {
    console.error('[main] Deepgram connection failed:', err.message);
    if (overlayWindow) overlayWindow.webContents.send('status-update', { active: false });
  }
});

ipcMain.on('stop-session', function() {
  console.log('[main] Stopping session...');
  if (suggestionPollInterval) { clearInterval(suggestionPollInterval); suggestionPollInterval = null; }
  if (deepgram)    { deepgram.disconnect(); deepgram = null; }
  if (claude)      { claude.reset(); claude = null; }
  if (callMemory)  { callMemory.reset(); callMemory = null; }
  if (overlayWindow) overlayWindow.webContents.send('status-update', { active: false });
});

ipcMain.on('audio-chunk', function(event, buffer) {
  if (deepgram && deepgram.isConnected) deepgram.sendAudio(Buffer.from(buffer));
});

ipcMain.on('renderer-log', function(event, msg) { console.log(msg); });

// Toggle click-through — off when mouse is over interactive elements, on otherwise
ipcMain.on('set-ignore-mouse', function(event, ignore) {
  if (overlayWindow) overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('close-app', function() { app.quit(); });

ipcMain.on('show-suggestion', function(event, data) {
  if (overlayWindow) overlayWindow.webContents.send('new-suggestion', data);
});

ipcMain.on('clear-suggestion', function() {
  if (overlayWindow) overlayWindow.webContents.send('clear-suggestion');
});

app.whenReady().then(function() {
  initKnowledgeBase();
  createOverlayWindow();

  // Auto-updater (only runs in packaged app, not dev)
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', function() {
      console.log('[updater] Update available — downloading in background...');
    });

    autoUpdater.on('update-downloaded', function(info) {
      console.log('[updater] Update downloaded: ' + info.version);
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'Scout ' + info.version + ' is ready to install.',
        detail: 'Restart Scout now to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      }).then(function(result) {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    });

    autoUpdater.on('error', function(err) {
      console.error('[updater] Error:', err.message);
    });
  }
});

app.on('window-all-closed', function() { app.quit(); });
