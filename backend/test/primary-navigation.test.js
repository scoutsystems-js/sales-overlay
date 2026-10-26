'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');

test('the permanent navigation is role-focused without deleting contextual pages', () => {
  assert.match(SOURCE, /id="navOverview"[^>]*>[\s\S]{0,500}<\/svg>Home<\/a>/);
  assert.match(SOURCE, /id="navTeam"[\s\S]{0,700}<\/svg>Daily Digest<span class="nav-caret">/);
  assert.match(SOURCE, /#workspaceTeamPages \{ display:none !important; \}/);
  assert.match(SOURCE, /Knowledge Base remains live and is reached contextually or by direct link/);
  assert.match(SOURCE, /var TEAM_PAGES = \[/, 'the existing team pages must remain routable');
});

test('the primary call tab sends managers to Call Review and closers to Calls', () => {
  assert.match(SOURCE, /id="navCallLibrary" onclick="goPrimaryCallWorkspace\(\); return false;"/);
  assert.match(SOURCE, /function goPrimaryCallWorkspace\(\) \{\s*if \(hasManagerContext\(\)\) \{ setView\('team-call-review'\); return; \}\s*goCallLibrary\(\);/);
  assert.match(SOURCE, /callWorkspaceLabel\.textContent = 'Call Review'/);
  assert.match(SOURCE, /\? \{ 'team-call-review': 1, 'call-review': 1 \}/);
});

test('Scout AI remains manager-and-owner only during the pilot', () => {
  assert.match(SOURCE, /id="navScoutAi"[^>]*style="display:none">Scout AI/);
  assert.match(SOURCE, /\['manager', 'owner'\]\.includes\(state\.me\.role\)[\s\S]{0,300}navScoutAiSep/);
  assert.match(SOURCE, /document\.getElementById\('navEod'\)\.style\.display = 'none'/,
    'manager navigation should show Daily Digest instead of EOD');
});
