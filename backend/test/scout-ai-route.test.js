'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('http');

test('Scout AI has an owner-only route module', () => {
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', 'routes', 'scout-ai.js')),
    'the question route needs an explicit owner gate before it can be mounted'
  );
});

// The authentication decoder is outside this route's responsibility.  Forge
// the actor directly so the test proves the real route's role boundary without
// minting a session for somebody else's account.
const authPath = require.resolve('../middleware/auth');
const realAuth = require(authPath);
require.cache[authPath].exports = Object.assign({}, realAuth, {
  requireAuth(req, _res, next) { next(); },
});
const scoutAiRoutes = require('../routes/scout-ai');

function appFor(role) {
  const app = express();
  app.use(express.json());
  app.use(function (req, _res, next) {
    req.user = { id: role + '-id', role };
    req.userProfileRole = role;
    next();
  });
  app.use('/scout-ai', scoutAiRoutes);
  return app;
}

function post(app, body, pathName) {
  return new Promise(function (resolve, reject) {
    const server = http.createServer(app).listen(0, function () {
      const payload = JSON.stringify(body);
      const req = http.request({ port: server.address().port, path: pathName || '/scout-ai/facts/objection-cohort', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, function (res) {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', function () {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(text) });
        });
      });
      req.on('error', function (error) { server.close(); reject(error); });
      req.end(payload);
    });
  });
}

test('a non-owner cannot reach a Scout AI fact tool', async () => {
  const result = await post(appFor('user'), {});
  assert.equal(result.status, 403);
});

test('an owner reaches the fact tool before request validation', async () => {
  const result = await post(appFor('owner'), {});
  assert.equal(result.status, 400);
  assert.notEqual(result.status, 403);
});

test('the owner-only question route rejects an empty question before a model call', async () => {
  const blocked = await post(appFor('user'), {}, '/scout-ai/ask');
  assert.equal(blocked.status, 403);
  const owner = await post(appFor('owner'), {}, '/scout-ai/ask');
  assert.equal(owner.status, 400);
  assert.match(owner.body.error, /Ask Scout a question/);
});
