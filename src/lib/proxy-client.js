// Thin HTTP client for the Railway backend's /proxy and /log routes.
//
// The desktop app never holds Deepgram or Anthropic API keys. Instead it sends
// the user's session token to the backend, which uses its own server-side
// credentials (Railway env vars) to call those services on the user's behalf.
//
// Endpoints wrapped here:
//   suggest(...)         → POST  /proxy/suggest        (Claude teleprompter)
//   memory(...)          → POST  /proxy/memory         (Claude rolling summary)
//   getDeepgramKey()     → POST  /proxy/deepgram-key   (mint 10-min ephemeral key)
//   sessionStart(...)    → POST  /log/session-start    (v1.0.5 cloud logging)
//   sessionEnd(...)      → PATCH /log/session-end/:id  (v1.0.5 cloud logging)
//   logBatch(...)        → POST  /log                  (v1.0.5 cloud logging)
//
// Errors thrown by these methods are plain Error objects with a descriptive
// message. Callers should try/catch and surface a useful message to the user.

const { BACKEND_URL } = require('../config');

class ProxyClient {
  // getToken is a function that returns the current user's access token (or
  // null if not logged in). It may return a Promise — the main process wires
  // this up to ensureFreshToken(), which refreshes an expired JWT before
  // returning. Passing a function rather than a string lets tokens rotate
  // without rebuilding the client.
  constructor(getToken) {
    this.getToken = getToken;
  }

  async _request(method, path, body) {
    var token = await Promise.resolve(this.getToken());
    if (!token) {
      throw new Error('Not logged in — cannot reach backend proxy.');
    }

    var res;
    try {
      res = await fetch(BACKEND_URL + path, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error('Could not reach backend: ' + (err.message || err));
    }

    if (!res.ok) {
      var errText;
      try {
        var data = await res.json();
        errText = data.error || ('HTTP ' + res.status);
      } catch (_) {
        errText = 'HTTP ' + res.status;
      }
      if (res.status === 401) throw new Error('Session expired — please log in again.');
      if (res.status === 403) throw new Error('Subscription required — please finish checkout.');
      throw new Error(errText);
    }

    return res.json();
  }

  async _post(path, body) {
    return this._request('POST', path, body || {});
  }

  async _patch(path, body) {
    return this._request('PATCH', path, body || {});
  }

  // Claude live-teleprompter suggestion. Returns { content: "<raw model text>" }.
  async suggest(args) {
    return this._post('/proxy/suggest', {
      systemPrompt: args.systemPrompt,
      userPrompt: args.userPrompt,
      maxTokens: args.maxTokens || 300,
    });
  }

  // Claude rolling summary (call-memory). Returns { content: "<raw model text>" }.
  async memory(args) {
    return this._post('/proxy/memory', {
      userPrompt: args.userPrompt,
      maxTokens: args.maxTokens || 500,
    });
  }

  // Mint a short-lived (10 min) Deepgram key. Returns { key: "..." }.
  // The key is used once during WebSocket handshake; Deepgram doesn't re-auth
  // after the socket is open, so a 10-min TTL is fine for calls of any length.
  async getDeepgramKey() {
    return this._post('/proxy/deepgram-key', {});
  }

  // ── v1.0.5 cloud logging ──────────────────────────────────────────────────
  // Register a new session. Returns { session_id: "<uuid>" } that must be sent
  // with every subsequent logBatch and the eventual sessionEnd.
  async sessionStart(args) {
    return this._post('/log/session-start', {
      clientVersion: args && args.clientVersion,
      platform: args && args.platform,
    });
  }

  // Mark a session ended. Optional outcome: 'win' | 'loss' | 'follow_up'.
  async sessionEnd(sessionId, outcome) {
    return this._patch('/log/session-end/' + encodeURIComponent(sessionId), {
      outcome: outcome || null,
    });
  }

  // Bulk-insert log entries for a session. entries = array of
  // { level, tag?, message, logged_at }. Validation on the server silently
  // drops malformed entries, so batches don't fail as long as at least one
  // entry is valid.
  async logBatch(sessionId, entries) {
    return this._post('/log', {
      session_id: sessionId,
      entries: entries,
    });
  }
}

module.exports = ProxyClient;
