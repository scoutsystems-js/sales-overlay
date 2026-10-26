'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Scout AI has a private question page, not a new dashboard metric', () => {
  const file = path.join(__dirname, '..', 'web', 'scout-ai.html');
  assert.ok(fs.existsSync(file), 'Scout AI needs its own question page');
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /Ask Scout/i);
  assert.match(source, /\/scout-ai\/ask/);
  assert.match(source, /Evidence/i);
  assert.match(source, /Most raised objection/);
  assert.match(source, /Best documented handlers/);
  assert.match(source, /Overall close rate/);
  assert.match(source, /Earned stage scores/);
  assert.match(source, /Saved call exchange/);
  assert.match(source, /prior_questions/);
  assert.match(source, /conversation/);
  assert.match(source, /Scout is checking saved evidence/);
  assert.match(source, /loading-message/);
  assert.match(source, /\['manager', 'owner'\]/);
  assert.doesNotMatch(source, /spouse-objection cohort close rate/i);
});

test('the dashboard gives managers and above a visible path to Scout AI', () => {
  const file = path.join(__dirname, '..', 'web', 'dashboard.html');
  const source = fs.readFileSync(file, 'utf8');

  assert.match(source, /id="navScoutAi"[^>]*>Scout AI/);
  assert.match(source, /window\.location\.href\s*=\s*'\/scout-ai'/);
  assert.match(source, /\['manager', 'owner'\]\.includes\(state\.me\.role\)[\s\S]{0,300}navScoutAi/);
});

test('the active composer follows the conversation instead of covering the answer', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.doesNotMatch(source, /#askForm\s*\{\s*position:sticky/);
});

test('an ambiguous closer name becomes a human choice, not an internal-id answer', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.match(source, /type === 'closer_choices'/);
  assert.match(source, /data-closer-choice/);
  assert.match(source, /type:'closer_choice'/);
  assert.match(source, /Choose the closer to review/);
});

test('an overall coaching priority has its own evidence card', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.match(source, /evidence\.priority/);
  assert.match(source, /Coaching priority/);
});

test('an Objection Handling priority card opens that closer\'s existing objections page in the same window', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.match(source, /function objectionPageUrl/);
  assert.match(source, /dashboard\?user=/);
  assert.match(source, /#objections/);
  assert.match(source, /metric-link/);
});

test('leaderboard handler cards open each closer\'s objections drilldown in a new tab', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.match(source, /function leaderboardMetric\(leader, category, window\)/);
  assert.match(source, /leaderboardMetric\(leader, evidence\.category, evidence\.window\)/);
  assert.match(source, /objectionPageUrl\(leader, window\)/);
  assert.match(source, /target="_blank" rel="noopener"/);
  assert.doesNotMatch(source, /item\.stage !== 'objection'/);
  assert.match(source, /function dashboardCallUrl\(example\)/);
  assert.match(source, /dashboardCallUrl\(example\)/);
});

test('a performance diagnosis gives the manager grounded coaching calls and a separate objections drilldown', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.match(source, /performance_coaching_diagnosis/);
  assert.match(source, /Strongest repeated coaching gap/);
  assert.match(source, /Open objection drilldown/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /closer_response/);
  assert.match(source, /Closer response/);
});

test('coaching priority actions can select any saved call stage without guessing from a typed yes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.match(source, /stage_choices/);
  assert.match(source, /stage_drilldown/);
  assert.match(source, /renderFollowUpChoices/);
  assert.match(source, /data-stage-action/);
  assert.match(source, /follow_up_context/);
});

test('a saved objection comparison shows both grounded patterns and the supporting calls', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.match(source, /evidence\.kind === 'objection_coaching_comparison'/);
  assert.match(source, /When it works/);
  assert.match(source, /When it is not handled/);
});

test('call-search answers render the existing call outcome and links, without inventing an exchange', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.match(source, /evidence\.kind === 'call_examples'/);
  assert.match(source, /call\.outcome/);
  assert.match(source, /Open call review/);
  assert.match(source, /Watch clip/);
  assert.match(source, /follow_up:'Open'/);
  assert.doesNotMatch(source, /Follow-up \/ open/);
});

test('open call cards can show only saved outcome evidence and its recorded moment', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'scout-ai.html'), 'utf8');
  assert.match(source, /outcome_evidence/);
  assert.match(source, /What kept it open/);
  assert.match(source, /Watch outcome moment/);
  assert.doesNotMatch(source, /No documented objection on record/);
});
