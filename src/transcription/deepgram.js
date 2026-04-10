// Raw WebSocket connection to Deepgram (bypasses broken SDK v5 wrapper)
var WebSocket = require('net').Socket ? null : null;

class DeepgramTranscriber {
  constructor(apiKey, onTranscript) {
    this.apiKey = apiKey;
    this.onTranscript = onTranscript;
    this.ws = null;
    this.isConnected = false;
    this.audioQueue = [];
  }

  connect() {
    var self = this;
    var params = [
      'model=nova-2',
      'language=en-US',
      'encoding=linear16',
      'sample_rate=16000',
      'channels=2',
      'multichannel=true',
      'punctuate=true',
      'interim_results=true',
      'utterance_end_ms=1500',
      'vad_events=true',
      'endpointing=500',
    ].join('&');

    var url = 'wss://api.deepgram.com/v1/listen?' + params;

    console.log('[deepgram] Connecting to Deepgram...');

    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() {
        console.error('[deepgram] Connection timed out after 10 seconds');
        reject(new Error('Deepgram connection timeout'));
      }, 10000);

      // Use Electron/Node native WebSocket
      self.ws = new globalThis.WebSocket(url, {
        headers: { 'Authorization': 'Token ' + self.apiKey },
      });

      self.ws.onopen = function() {
        clearTimeout(timeout);
        console.log('[deepgram] Connection opened - ready to receive audio');
        self.isConnected = true;

        // Flush queued audio
        while (self.audioQueue.length > 0) {
          self.ws.send(self.audioQueue.shift());
        }

        resolve();
      };

      self.ws.onmessage = function(event) {
        try {
          var data = JSON.parse(event.data);
          if (data.type === 'Results') {
            var alt = data.channel && data.channel.alternatives && data.channel.alternatives[0];
            var transcript = alt ? alt.transcript : '';
            if (!transcript || transcript.trim() === '') return;
            var isFinal = data.is_final || false;

            // Multichannel: channel_index[0] tells us which channel
            // Channel 0 = closer (left/mic), Channel 1 = prospect (right/BlackHole)
            var channelIndex = (data.channel_index && data.channel_index[0]) || 0;
            var speaker = channelIndex; // 0 = closer, 1 = prospect

            var speakerLabel = speaker === 0 ? 'CLOSER' : 'PROSPECT';
            console.log('[deepgram] Transcript (' + (isFinal ? 'final' : 'interim') + ') [' + speakerLabel + ']: ' + transcript);
            self.onTranscript({ text: transcript, isFinal: isFinal, speaker: speaker });
          }
        } catch (err) {
          console.error('[deepgram] Parse error:', err.message);
        }
      };

      self.ws.onerror = function(err) {
        clearTimeout(timeout);
        console.error('[deepgram] WebSocket error:', err.message || err);
        reject(err);
      };

      self.ws.onclose = function(event) {
        console.log('[deepgram] Connection closed (code: ' + event.code + ')');
        self.isConnected = false;
      };
    });
  }

  sendAudio(pcm16Buffer) {
    if (this.isConnected && this.ws && this.ws.readyState === 1) {
      this.ws.send(pcm16Buffer);
    } else {
      this.audioQueue.push(pcm16Buffer);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
      this.audioQueue = [];
    }
  }
}

module.exports = DeepgramTranscriber;
