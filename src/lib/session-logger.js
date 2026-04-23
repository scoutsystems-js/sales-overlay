// SessionLogger — captures console.log/warn/error during a session and
// streams batched entries to the backend /log endpoint.
//
// Lifecycle:
//   const logger = new SessionLogger(proxyClient, { clientVersion, platform });
//   await logger.start();          // calls /log/session-start, installs console tee
//   // ... session runs, logs capture automatically ...
//   await logger.end('win');       // flushes buffer, calls /log/session-end
//
// Capture rules:
//   - Wraps console.log/warn/error so stdout still works AND each call tees
//     into an in-memory buffer.
//   - Leading "[tag]" prefix in the message is auto-extracted and stamped
//     onto the row (so session_logs.tag has clean "[main]" / "[claude]" etc.).
//   - Entries flush to the backend when buffer hits FLUSH_BATCH_SIZE or every
//     FLUSH_INTERVAL_MS, whichever first.
//   - Buffer is capped at MAX_BUFFER_SIZE to keep memory bounded. When full,
//     oldest entries drop first (FIFO) — the current call keeps going.
//
// Error resilience:
//   - If a flush call fails, the entries go back to the front of the buffer
//     for the next attempt. Session never crashes because of logging.
//   - If /log/session-start fails, start() rejects and the caller (main/index)
//     decides whether to continue without logging or surface the error.

var FLUSH_INTERVAL_MS = 2000;
var FLUSH_BATCH_SIZE = 20;
var MAX_BUFFER_SIZE = 1000;
var TAG_PATTERN = /^(\[[\w-]+\])\s*/;

class SessionLogger {
  constructor(proxyClient, opts) {
    this.proxy = proxyClient;
    this.clientVersion = (opts && opts.clientVersion) || null;
    this.platform = (opts && opts.platform) || null;
    this.sessionId = null;
    this.buffer = [];
    this.flushTimer = null;
    this.originalConsole = null;
    this.isStarted = false;
    this.flushInFlight = false;
  }

  async start() {
    if (this.isStarted) return this.sessionId;
    var res = await this.proxy.sessionStart({
      clientVersion: this.clientVersion,
      platform: this.platform,
    });
    if (!res || !res.session_id) {
      throw new Error('session-start response missing session_id');
    }
    this.sessionId = res.session_id;
    this.isStarted = true;
    this._installConsoleTee();
    this._startFlushTimer();
    return this.sessionId;
  }

  async end(outcome) {
    if (!this.isStarted) return;
    this._stopFlushTimer();
    this._uninstallConsoleTee();
    // Drain any remaining entries before marking the session ended so the
    // final state shows up alongside every preceding log line.
    try { await this._flush(); } catch (_) { /* drained what we could */ }
    try {
      await this.proxy.sessionEnd(this.sessionId, outcome || null);
    } catch (err) {
      // Best-effort — session is over locally regardless. Mark the buffer
      // and local state as cleaned up even if the remote call failed.
    }
    this.isStarted = false;
    this.sessionId = null;
    this.buffer = [];
  }

  // Manual log entry — used by code that doesn't go through console.*.
  log(level, tag, message) {
    if (!this.isStarted) return;
    this._push(level, tag, message);
  }

  _push(level, tag, message) {
    this.buffer.push({
      level: level,
      tag: tag || null,
      message: String(message),
      logged_at: new Date().toISOString(),
    });
    while (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift(); // drop oldest on overflow
    }
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      this._flush(); // fire-and-forget
    }
  }

  _installConsoleTee() {
    var self = this;
    this.originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    console.log = function() {
      self.originalConsole.log.apply(console, arguments);
      self._capture('info', arguments);
    };
    console.warn = function() {
      self.originalConsole.warn.apply(console, arguments);
      self._capture('warn', arguments);
    };
    console.error = function() {
      self.originalConsole.error.apply(console, arguments);
      self._capture('error', arguments);
    };
  }

  _uninstallConsoleTee() {
    if (this.originalConsole) {
      console.log = this.originalConsole.log;
      console.warn = this.originalConsole.warn;
      console.error = this.originalConsole.error;
      this.originalConsole = null;
    }
  }

  _capture(level, args) {
    // Serialize console args into a single message string the way the
    // terminal would display them — strings unchanged, objects JSON-ified.
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (typeof a === 'string') parts.push(a);
      else if (a === undefined) parts.push('undefined');
      else if (a === null) parts.push('null');
      else {
        try { parts.push(JSON.stringify(a)); }
        catch (_) { parts.push(String(a)); }
      }
    }
    var message = parts.join(' ');
    var match = message.match(TAG_PATTERN);
    var tag = match ? match[1] : null;
    this._push(level, tag, message);
  }

  _startFlushTimer() {
    var self = this;
    this.flushTimer = setInterval(function() { self._flush(); }, FLUSH_INTERVAL_MS);
  }

  _stopFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async _flush() {
    if (this.flushInFlight) return; // avoid overlapping flushes
    if (this.buffer.length === 0 || !this.sessionId) return;
    this.flushInFlight = true;
    var toSend = this.buffer.splice(0, this.buffer.length);
    try {
      await this.proxy.logBatch(this.sessionId, toSend);
    } catch (err) {
      // Re-queue at the front so ordering is preserved, and trim if we've
      // overflowed. We don't keep using originalConsole here because this
      // method may run while the tee is already uninstalled (end() path).
      this.buffer = toSend.concat(this.buffer);
      while (this.buffer.length > MAX_BUFFER_SIZE) {
        this.buffer.shift();
      }
    } finally {
      this.flushInFlight = false;
    }
  }
}

// Exported only for tests.
SessionLogger._internals = {
  FLUSH_INTERVAL_MS: FLUSH_INTERVAL_MS,
  FLUSH_BATCH_SIZE: FLUSH_BATCH_SIZE,
  MAX_BUFFER_SIZE: MAX_BUFFER_SIZE,
  TAG_PATTERN: TAG_PATTERN,
};

module.exports = SessionLogger;
