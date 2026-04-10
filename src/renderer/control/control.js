var btnStart = document.getElementById('btnStart');
var btnStop = document.getElementById('btnStop');
var statusDot = document.getElementById('statusDot');
var statusText = document.getElementById('statusText');
var transcriptEl = document.getElementById('transcript');
var clientSelect = document.getElementById('clientSelect');
var btnUpload = document.getElementById('btnUpload');
var fileInput = document.getElementById('fileInput');
var uploadStatus = document.getElementById('uploadStatus');
var micSelect = document.getElementById('micSelect');

var micStream = null;
var systemStream = null;
var audioContext = null;
var processor = null;

// ── Audio device enumeration (mic only) ──

async function enumerateAudioDevices() {
  try {
    var tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(function(t) { t.stop(); });

    var devices = await navigator.mediaDevices.enumerateDevices();
    var audioInputs = devices.filter(function(d) { return d.kind === 'audioinput'; });

    window.electronAPI.logToMain('[control] Audio inputs found: ' + audioInputs.length);

    micSelect.innerHTML = '';
    var preferredMic = null;
    for (var i = 0; i < audioInputs.length; i++) {
      // Skip virtual devices — those aren't mics
      var label = (audioInputs[i].label || '').toLowerCase();
      if (label.indexOf('blackhole') !== -1 || label.indexOf('virtual') !== -1 || label.indexOf('zoomaudio') !== -1) continue;
      // Skip "Default" entry — it's a duplicate of another device
      if (label.indexOf('default') !== -1) continue;

      var opt = document.createElement('option');
      opt.value = audioInputs[i].deviceId;
      opt.textContent = audioInputs[i].label || ('Microphone ' + (i + 1));
      micSelect.appendChild(opt);

      // Prefer dedicated mics over webcam mics (look for known mic brands/names)
      var lbl = audioInputs[i].label || '';
      var lowerLbl = lbl.toLowerCase();
      if (lowerLbl.indexOf('wave') !== -1 || lowerLbl.indexOf('yeti') !== -1 || lowerLbl.indexOf('at2020') !== -1 || lowerLbl.indexOf('rode') !== -1 || lowerLbl.indexOf('sm7b') !== -1 || lowerLbl.indexOf('scarlett') !== -1 || lowerLbl.indexOf('focusrite') !== -1) {
        preferredMic = audioInputs[i].deviceId;
      }

      window.electronAPI.logToMain('[control]   → ' + (audioInputs[i].label || 'Unnamed') + ' [' + audioInputs[i].deviceId.substring(0, 8) + '...]');
    }

    // Auto-select the preferred mic if found
    if (preferredMic) {
      micSelect.value = preferredMic;
      window.electronAPI.logToMain('[control] Auto-selected preferred mic');
    }
  } catch (err) {
    window.electronAPI.logToMain('[control] Failed to enumerate audio devices: ' + err.message);
    micSelect.innerHTML = '<option value="">Default Microphone</option>';
  }
}

// ── Transcript ──

function appendToTranscript(speaker, text) {
  var turn = document.createElement('div');
  turn.className = 'turn';
  var label = document.createElement('span');
  label.className = speaker === 'CLOSER' ? 'label-closer' : 'label-prospect';
  label.textContent = speaker + ':';
  var content = document.createTextNode(' ' + text);
  turn.appendChild(label);
  turn.appendChild(content);
  transcriptEl.appendChild(turn);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// ── Script upload ──

function showUploadStatus(msg, isError) {
  uploadStatus.style.display = 'block';
  uploadStatus.textContent = msg;
  uploadStatus.style.color = isError ? '#ef4444' : '#22c55e';
  if (!isError) {
    setTimeout(function() { uploadStatus.style.display = 'none'; }, 4000);
  }
}

btnUpload.addEventListener('click', function() {
  fileInput.click();
});

fileInput.addEventListener('change', async function(e) {
  var file = e.target.files[0];
  if (!file) return;

  showUploadStatus('Uploading and parsing script...', false);

  try {
    var text = await file.text();
    var clientName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    var result = await window.electronAPI.uploadScript(text, clientName);

    if (result && result.success) {
      showUploadStatus('Loaded ' + result.entriesCount + ' entries from "' + result.clientName + '"', false);

      var exists = false;
      for (var i = 0; i < clientSelect.options.length; i++) {
        if (clientSelect.options[i].value === result.clientId) { exists = true; break; }
      }
      if (!exists) {
        var option = document.createElement('option');
        option.value = result.clientId;
        option.textContent = result.clientName + ' (uploaded)';
        clientSelect.appendChild(option);
      }
      clientSelect.value = result.clientId;
    } else {
      showUploadStatus('Upload failed: ' + (result ? result.error : 'unknown error'), true);
    }
  } catch (err) {
    showUploadStatus('Failed to read file: ' + err.message, true);
  }

  fileInput.value = '';
});

// ── Audio capture ──

async function getSystemAudioStream() {
  try {
    window.electronAPI.logToMain('[control] Requesting system audio loopback...');

    // Enable the loopback override
    await window.electronAPI.enableLoopbackAudio();

    // getDisplayMedia with audio — the loopback plugin intercepts this
    var stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    // Remove video tracks (we only need audio)
    var videoTracks = stream.getVideoTracks();
    videoTracks.forEach(function(t) {
      t.stop();
      stream.removeTrack(t);
    });

    // Restore normal getDisplayMedia behavior
    await window.electronAPI.disableLoopbackAudio();

    if (stream.getAudioTracks().length > 0) {
      window.electronAPI.logToMain('[control] System audio loopback captured: ' + stream.getAudioTracks().length + ' track(s)');
      return stream;
    } else {
      window.electronAPI.logToMain('[control] System audio loopback returned no audio tracks');
      return null;
    }
  } catch (err) {
    window.electronAPI.logToMain('[control] System audio loopback failed: ' + err.message);
    // Make sure we restore normal behavior even on failure
    try { await window.electronAPI.disableLoopbackAudio(); } catch(e) {}
    return null;
  }
}

async function startAudioCapture() {
  try {
    var micDeviceId = micSelect.value;

    // 1. Capture closer's mic
    var micConstraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 16000,
      },
      video: false,
    };
    if (micDeviceId) {
      micConstraints.audio.deviceId = { exact: micDeviceId };
    }

    micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
    var micLabel = micSelect.options[micSelect.selectedIndex] ? micSelect.options[micSelect.selectedIndex].textContent : 'default';
    window.electronAPI.logToMain('[control] Closer mic captured: ' + micLabel);

    // 2. Capture system audio (prospect voice from Zoom/FaceTime/etc)
    systemStream = await getSystemAudioStream();

    // 3. Set up AudioContext and send stereo to Deepgram
    audioContext = new AudioContext({ sampleRate: 16000 });
    var micSource = audioContext.createMediaStreamSource(micStream);

    if (systemStream && systemStream.getAudioTracks().length > 0) {
      // Two-input mode: interleaved stereo (left=closer, right=prospect)
      var systemSource = audioContext.createMediaStreamSource(systemStream);

      var merger = audioContext.createChannelMerger(2);
      var micGain = audioContext.createGain();
      micGain.gain.value = 1.0;
      var systemGain = audioContext.createGain();
      systemGain.gain.value = 1.0;

      micSource.connect(micGain);
      systemSource.connect(systemGain);
      micGain.connect(merger, 0, 0);       // Left channel = closer
      systemGain.connect(merger, 0, 1);    // Right channel = prospect

      var audioDebugCounter = 0;
      processor = audioContext.createScriptProcessor(4096, 2, 2);
      processor.onaudioprocess = function(e) {
        var left = e.inputBuffer.getChannelData(0);
        var right = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : left;

        // Log audio levels every ~2 seconds so we can see if each channel has signal
        audioDebugCounter++;
        if (audioDebugCounter % 8 === 0) {
          var leftRMS = 0, rightRMS = 0;
          for (var j = 0; j < left.length; j++) {
            leftRMS += left[j] * left[j];
            rightRMS += right[j] * right[j];
          }
          leftRMS = Math.sqrt(leftRMS / left.length);
          rightRMS = Math.sqrt(rightRMS / right.length);
          window.electronAPI.logToMain('[audio] Mic level: ' + leftRMS.toFixed(4) + ' | System level: ' + rightRMS.toFixed(4));
        }

        // Interleave stereo for Deepgram multichannel
        var interleaved = new Int16Array(left.length * 2);
        for (var i = 0; i < left.length; i++) {
          var sL = Math.max(-1, Math.min(1, left[i]));
          var sR = Math.max(-1, Math.min(1, right[i]));
          interleaved[i * 2] = sL < 0 ? sL * 0x8000 : sL * 0x7fff;
          interleaved[i * 2 + 1] = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
        }
        window.electronAPI.sendAudioChunk(interleaved.buffer);
      };

      merger.connect(processor);
      processor.connect(audioContext.destination);
      window.electronAPI.logToMain('[control] *** TWO-INPUT audio capture started (mic + system loopback) ***');

    } else {
      // Single-input mode: mic only
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = function(e) {
        var input = e.inputBuffer.getChannelData(0);
        var int16 = new Int16Array(input.length);
        for (var i = 0; i < input.length; i++) {
          var s = Math.max(-1, Math.min(1, input[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        window.electronAPI.sendAudioChunk(int16.buffer);
      };

      micSource.connect(processor);
      processor.connect(audioContext.destination);
      window.electronAPI.logToMain('[control] *** SINGLE-INPUT audio capture started (mic only — no system audio) ***');
    }

  } catch (err) {
    window.electronAPI.logToMain('[control] Audio capture failed: ' + err.message);
    statusText.textContent = 'Audio error — check permissions';
  }
}

function stopAudioCapture() {
  if (processor) { processor.disconnect(); processor = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  if (micStream) { micStream.getTracks().forEach(function(t) { t.stop(); }); micStream = null; }
  if (systemStream) { systemStream.getTracks().forEach(function(t) { t.stop(); }); systemStream = null; }
  window.electronAPI.logToMain('[control] Audio capture stopped');
}

// ── Session controls ──

btnStart.addEventListener('click', async function() {
  var selectedClient = clientSelect.value;
  btnStart.disabled = true;
  btnStop.disabled = false;
  clientSelect.disabled = true;
  btnUpload.disabled = true;
  micSelect.disabled = true;
  statusDot.classList.add('active');
  statusText.textContent = 'Starting...';
  window.electronAPI.startSession(selectedClient);
  await startAudioCapture();
});

btnStop.addEventListener('click', function() {
  btnStart.disabled = false;
  btnStop.disabled = true;
  clientSelect.disabled = false;
  btnUpload.disabled = false;
  micSelect.disabled = false;
  statusDot.classList.remove('active');
  statusText.textContent = 'Not listening';
  stopAudioCapture();
  window.electronAPI.stopSession();
});

window.electronAPI.onStatusUpdate(function(data) {
  statusText.textContent = data.status;
  if (data.active) { statusDot.classList.add('active'); } else { statusDot.classList.remove('active'); }
});

window.electronAPI.onAppendTranscript(function(data) {
  appendToTranscript(data.speaker, data.text);
});

// ── Init ──
enumerateAudioDevices();
