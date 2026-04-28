const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Auth
  authLogin: function(email, password) { return ipcRenderer.invoke('auth-login', email, password); },
  authSignup: function(email, password) { return ipcRenderer.invoke('auth-signup', email, password); },
  getToken: function() { return ipcRenderer.invoke('get-token'); },
  saveToken: function(token) { return ipcRenderer.invoke('save-token', token); },
  clearToken: function() { return ipcRenderer.invoke('clear-token'); },
  checkSubscription: function(token) { return ipcRenderer.invoke('check-subscription', token); },
  openCheckout: function(token) { return ipcRenderer.invoke('open-checkout', token); },
  authSuccess: function() { ipcRenderer.send('auth-success'); },

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
  saveScript: function(data) { return ipcRenderer.invoke('save-script', data); },
  callDetected: function() { ipcRenderer.send('call-detected'); },
  onCallDetected: function(callback) {
    ipcRenderer.on('call-detected', function() { callback(); });
  },
  onPostCallSummary: function(callback) {
    ipcRenderer.on('post-call-summary', function(event, data) { callback(data); });
  },
  onboardingComplete: function() { ipcRenderer.send('onboarding-complete'); },
  onboardingSkip: function() { ipcRenderer.send('onboarding-skip'); },
  openOnboarding: function() { ipcRenderer.send('open-onboarding'); },
  onShowSetupNudge: function(callback) {
    ipcRenderer.on('show-setup-nudge', function() { callback(); });
  },

  // Device check — overlay drives the probe lifecycle, control runs it,
  // main is a thin relay between the two windows.
  startDeviceCheck: function() { ipcRenderer.send('device-check-start'); },
  onDeviceCheckStart: function(callback) {
    ipcRenderer.on('device-check-start', function() { callback(); });
  },
  deviceCheckReady: function(data) { ipcRenderer.send('device-check-ready', data); },
  onDeviceCheckReady: function(callback) {
    ipcRenderer.on('device-check-ready', function(event, data) { callback(data); });
  },
  audioLevelUpdate: function(micRMS) { ipcRenderer.send('audio-level-update', { micRMS: micRMS }); },
  onAudioLevelUpdate: function(callback) {
    ipcRenderer.on('audio-level-update', function(event, data) { callback(data); });
  },
  commitDeviceCheck: function(micDeviceId) { ipcRenderer.send('device-check-commit', { micDeviceId: micDeviceId }); },
  onDeviceCheckCommit: function(callback) {
    ipcRenderer.on('device-check-commit', function(event, data) { callback(data); });
  },
  cancelDeviceCheck: function() { ipcRenderer.send('device-check-cancel'); },
  onDeviceCheckCancel: function(callback) {
    ipcRenderer.on('device-check-cancel', function() { callback(); });
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

  quitApp: function() { ipcRenderer.send('quit-app'); },
  resizeOverlay: function(height) { ipcRenderer.send('resize-overlay', height); },
  onTriggerStartAudio: function(callback) { ipcRenderer.on('trigger-start-audio', function() { callback(); }); },
  onTriggerStopAudio: function(callback) { ipcRenderer.on('trigger-stop-audio', function() { callback(); }); },

  // Discovery tracker (v1.0.9) — receives boolean + financeDetails updates from main's
  // CallMemory, and reports panel height back so main can resize the discovery window
  // to content. Without these, discovery.html throws TypeError on load and every
  // 'discovery-update' IPC from main is dropped (bug found in v1.0.8 live testing).
  onDiscoveryUpdate: function(callback) {
    ipcRenderer.on('discovery-update', function(event, data) { callback(data); });
  },
  onDiscoveryReset: function(callback) {
    ipcRenderer.on('discovery-reset', function() { callback(); });
  },
  resizeDiscovery: function(height) { ipcRenderer.send('resize-discovery', height); },
});
