/* NEVER DIMINISH THE CLOSER'S WORK — Justin's standing rule, 2026-09-01.
   And the pin toggle, which had no inverse. See CLAUDE.md. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const TONE = require('../lib/coaching-tone.js');
const lib = (f) => fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
const CODE = HTML.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/* The four lanes MEASURED as carrying the shape, against 274 rows of why_prose
   that carried none — the contrast is what shows it is not inevitable. */
const LANES = [
  ['team-digest.js', 'DIGEST_PROMPT_VERSION', "'||prompt:'"],
  ['performance-synthesis.js', 'SYNTH_RULE_VERSION', "'||v:'"],
  ['team-synthesis.js', 'RECS_LANE_VERSION', "'||recs:'"],
  ['team-objection-summary.js', 'PROMPT_VERSION', '.update(PROMPT_VERSION'],
];

test('⚠⚠⚠ every coaching lane carries the rule — ONE definition, never a copy', () => {
  LANES.forEach(([file]) => {
    const src = lib(file);
    assert.ok(/require\(['"]\.\/coaching-tone(\.js)?['"]\)/.test(src),
      file + ' must IMPORT the rule');
    assert.ok(/TONE\.NEVER_DIMINISH/.test(src),
      file + ' imports the rule and never uses it — an import is not a call site');
    /* ⚠ AND NOT A SECOND COPY. Four hand-written tone rules drift, and a drifted
       tone rule is INVISIBLE: nothing fails, the wording just softens in one lane
       and not another. */
    assert.ok(!/NEVER DIMINISH THE CLOSER/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
      file + ' spells the rule out itself — that is the second copy this module prevents');
  });
});

test('⚠⚠ each bumped version is IN ITS CACHE KEY — a prompt edit alone ships nothing', () => {
  /* ⚠ THE RECORDED FAILURE THIS PREVENTS: the generated text lives INSIDE the
     cached payload, so editing a prompt without moving the key leaves every
     cached entry rendering the old wording indefinitely — and the change looks
     shipped. */
  LANES.forEach(([file, ver, keyMarker]) => {
    const src = lib(file);
    const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(new RegExp(keyMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(code),
      file + ': ' + ver + ' is not folded into the cache key');
    assert.ok(/never-diminish/.test(code),
      file + ': the version was not bumped, so cached text keeps the old wording');
  });
});

test('⚠⚠ the rule is an OPERATION, not an adjective', () => {
  /* ⚠ THREE TIMES THIS PROJECT HAS FOUND THAT TELLING A MODEL TO "BE X" FAILS
     WHERE TELLING IT TO RUN A TEST SUCCEEDS. "Never diminish" is something a
     model can agree with and still violate; "do not attach a subtracting clause
     to a number they earned" is a thing it can check. */
  const r = TONE.NEVER_DIMINISH;
  assert.ok(/The tell is/.test(r), 'the rule must name the tell, not just the intent');
  ['but', 'however', 'technically', 'on paper'].forEach((w) =>
    assert.ok(r.indexOf('"' + w + '"') !== -1, 'the tell must name the word: ' + w));
  /* ⚠ AND THE WORKED PAIR IS WHAT SETTLED EVERY PREVIOUS BOUNDARY HERE — a
     WRONG and a RIGHT of the same fact, so the model sees the difference is the
     FRAMING and not the information. */
  assert.ok(/WRONG:/.test(r) && /RIGHT:/.test(r), 'the rule must carry a worked pair');
  assert.ok(/pre-sold/.test(r), "and it should be Justin's own example");
  /* ⚠ IT MUST NOT READ AS "SOFTEN CRITICISM". The information is GOOD and he
     said so — what is wrong is subtracting it from a number the rep earned. */
  assert.ok(/not a rule about softening criticism/.test(r),
    'the rule must say what it is NOT, or it will be read as a licence to flatter');
});

test('⚠⚠⚠ the pin control is a TOGGLE — pinning was a one-way door', () => {
  /* ⚠ THE BUTTON RENDERED ONLY WHEN A BOARD WAS *NOT* PINNED, and there was no
     unpin route at all. So a manager with a single board could pin it and never
     get back — and a control that vanishes on success reads as having broken
     itself. A capability with no inverse is the same shape as one with no control. */
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
  assert.ok(/router\.delete\('\/dashboard\/:id\/pin'/.test(routes), 'there must be an unpin route');
  assert.ok(/router\.post\('\/dashboard\/:id\/pin'/.test(routes), 'and the pin route survives');

  /* ⚠ PINNING CLEARS THE OLD PIN FIRST — a partial unique index on (user_id)
     WHERE pinned makes two pinned boards unrepresentable, so a second pin would
     be REJECTED rather than swapped. Unpinning cannot collide, so it is one write. */
  const pin = routes.slice(routes.indexOf("router.post('/dashboard/:id/pin'"));
  const body = pin.slice(0, pin.indexOf('\n});'));
  assert.ok(body.length > 300 && body.length < 2500, 'slice: ' + body.length);
  assert.ok(body.indexOf('pinned: false') < body.indexOf('pinned: true'),
    'the old pin must be cleared BEFORE the new one is set, or the index rejects it');

  // one handler, two directions — never two that can drift about what a pin means
  assert.ok(/function dashTogglePin\(id, isPinned\)/.test(CODE), 'one handler, both directions');
  assert.ok(/method: isPinned \? 'DELETE' : 'POST'/.test(CODE), 'and it picks the verb from the state');
  assert.ok(!/async function dashPin\b/.test(CODE), 'the one-way handler must be gone');

  // and it renders in BOTH states, next to the board list
  const bar = CODE.slice(CODE.indexOf("return '<div class=\"dash-bar\">"), CODE.indexOf('function dashBoardSelectHtml'));
  assert.ok(bar.length > 300 && bar.length < 3000, 'toolbar slice: ' + bar.length);
  assert.ok(/dashTogglePin/.test(bar) && !/&& !pinned/.test(bar),
    'the control must render whether or not the board is pinned');
  assert.ok(bar.indexOf('dashBoardSelectHtml') < bar.indexOf('dashTogglePin'),
    'it belongs beside the board list, which already marks the pinned one');
  assert.ok(/pinned \? 'Unpin' : 'Pin'/.test(bar),
    'the label is the ACTION — "Unpin" implies the state without restating the badge');
});
