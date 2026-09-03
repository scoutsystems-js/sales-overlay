'use strict';
/* ⚠⚠ A RENDERED GUARD — the page's real stylesheet laid out by a real Chromium,
   computed style read back. `node -c`, a stylesheet grep and a cardinality pin
   all passed the day a `border: 0` shorthand removed the call-review verdict
   border (H267); only measuring the RENDERED border found it. This helper is how
   a test measures it. Electron ships with the dormant desktop app (repo root
   node_modules); it renders an HTML file offscreen in ~0.4s.
   ⚠ A missing binary FAILS the guard — a rendered check that cannot render has
   nothing to say, and a skip would read as green. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ELECTRON = path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'electron');
const RUNNER = path.join(__dirname, 'electron-runner.js');

/** Render `html` and evaluate `probeJs` (an expression returning a JSON-serialisable value) in it. */
function renderComputed(html, probeJs, opts) {
  if (!fs.existsSync(ELECTRON)) throw new Error('electron binary not found at ' + ELECTRON + ' — the rendered guard cannot run');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-render-'));
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, html);
  const r = spawnSync(ELECTRON, [RUNNER, file, probeJs, String((opts && opts.width) || 1400)], {
    encoding: 'utf8', timeout: 30000, env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '0' }),
  });
  fs.rmSync(dir, { recursive: true, force: true });
  const line = String(r.stdout || '').split('\n').filter((l) => l.startsWith('@@RESULT@@')).pop();
  if (!line) throw new Error('electron produced no result (status ' + r.status + '): ' + String(r.stderr || '').slice(0, 400));
  return JSON.parse(line.slice('@@RESULT@@'.length));
}

module.exports = { renderComputed, ELECTRON };
