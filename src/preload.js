const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startSession: function(clientId) { ipcRenderer.send('start-session', clientId); },
  stopSession: function() { ipcRenderer.send('stop-session'); },
  sendAudioChunk: function(buffer) { ipcRenderer.send('audio-chunk', buffer); },
  logToMain: function(msg) { ipcRenderer.send('renderer-log', msg); },
  showSuggestion: function(data) { ipcRenderer.send('show-suggestion', data); },
  uploadScript: function(scriptText, clientName) { return ipcRenderer.invoke('upload-script', scriptText, clientName); },
  getClients: function() { return ipcRenderer.invoke('get-clients'); },
  enableLoopbackAudio: function() { return ipcRenderer.invoke('enable-loopback-audio'); },
  disableLoopbackAudio: function() { return ipcRenderer.invoke('disable-loopback-audio'); },

  // Onboarding wizard — load/save profile data + lifecycle signals
  getProfile: function() { return ipcRenderer.invoke('get-profile'); },
  saveProfile: function(data) { return ipcRenderer.invoke('save-profile', data); },
  onboardingComplete: function() { ipcRenderer.send('onboarding-complete'); },
  onboardingSkip: function() { ipcRenderer.send('onboarding-skip'); },
  openOnboarding: function() { ipcRenderer.send('open-onboarding'); },
  onShowSetupNudge: function(callback) {
    ipcRenderer.on('show-setup-nudge', function() { callback(); });
  },

  onStatusUpdate: function(callback) {
    ipcRenderer.on('status-update', function(event, data) { callback(data); });
  },
  onAppendTranscript: function(callback) {
    ipcRenderer.on('append-transcript', function(event, data) { callback(data); });
  },
  onNewSuggestion: function(callback) {
    ipcRenderer.on('new-suggestion', function(event, data) { callback(data); });
  },
  onClearSuggestion: function(callback) {
    ipcRenderer.on('clear-suggestion', function() { callback(); });
  },
});
