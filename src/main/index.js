require('dotenv').config();

const { initMain } = require('electron-audio-loopback');
initMain(); // Must be called before app.whenReady()

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const DeepgramTranscriber = require('../transcription/deepgram');
const ClaudeCoach = require('../ai/claude');
const KnowledgeBase = require('../ai/knowledge-base');
const CallMemory = require('../ai/call-memory');
const ScriptParser = require('../ai/script-parser');

let controlWindow = null;
let overlayWindow = null;
let deepgram = null;
let claude = null;
let kb = null;
let callMemory = null;
let activeClient = 'generic'; // Current client filter for KB searches
let uploadedScripts = {};     // clientId -> array of parsed entries (in-memory for uploaded scripts)
let suggestionPollInterval = null; // Polls getSuggestion() during natural pauses in conversation

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
    resizable: false,
    title: 'Sales Overlay',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controlWindow.loadFile(path.join(__dirname, '..', 'renderer', 'control', 'index.html'));

  // Pipe renderer console logs to main process terminal
  controlWindow.webContents.on('console-message', function(event, level, message) {
    if (message.indexOf('[control]') !== -1) {
      console.log(message);
    }
  });

  if (process.env.NODE_ENV === 'development') {
    controlWindow.webContents.openDevTools({ mode: 'detach' });
  }

  controlWindow.on('closed', function() {
    controlWindow = null;
    app.quit();
  });
}

function createOverlayWindow() {
  var display = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: display.width,
    height: 260,
    x: 0,
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

  // Click-through by default — clicks pass to windows behind the overlay
  // The overlay HTML uses -webkit-app-region: drag on a handle area
  // and forwards mouse events for that region only
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.on('closed', function() {
    overlayWindow = null;
  });
}

// Get available clients (only uploaded scripts — no hardcoded clients)
ipcMain.handle('get-clients', async function() {
  var clients = [
    { id: 'generic', name: 'No Script (Core Framework Only)' },
  ];

  // Add uploaded scripts
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

    // Store in memory
    uploadedScripts[clientId] = {
      name: clientName,
      entries: entries,
    };

    // Also seed to Supabase if available
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

  // Set the active client filter on the knowledge base
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

  callMemory = new CallMemory(process.env.ANTHROPIC_API_KEY);
  claude = new ClaudeCoach(process.env.ANTHROPIC_API_KEY, kb, callMemory);

  // Poll getSuggestion() every 1.5s so natural pauses in conversation still trigger prompts.
  // Without this, getSuggestion() only runs when a transcript arrives — if both speakers
  // are briefly silent (very common), the next prompt never fires.
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
    if (controlWindow) {
      controlWindow.webContents.send('status-update', { status: 'Listening...', active: true });
    }
    if (overlayWindow) {
      overlayWindow.webContents.send('status-update', { active: true });
    }
  } catch (err) {
    console.error('[main] Failed to connect to Deepgram:', err.message);
    if (controlWindow) {
      controlWindow.webContents.send('status-update', { status: 'Connection failed', active: false });
    }
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
  if (controlWindow) {
    controlWindow.webContents.send('status-update', { status: 'Not listening', active: false });
  }
  if (overlayWindow) {
    overlayWindow.webContents.send('status-update', { active: false });
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

ipcMain.on('show-suggestion', function(event, data) {
  if (overlayWindow) { overlayWindow.webContents.send('new-suggestion', data); }
});

ipcMain.on('clear-suggestion', function() {
  if (overlayWindow) { overlayWindow.webContents.send('clear-suggestion'); }
});

app.whenReady().then(function() {
  initKnowledgeBase();
  createControlWindow();
  createOverlayWindow();
});

app.on('window-all-closed', function() { app.quit(); });
