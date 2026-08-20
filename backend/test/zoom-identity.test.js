/**
 * ZOOM SPEAKER IDENTITY — byte-identical match + the two-person collision
 * detector (2026-08-20).
 *
 * ⚠ THE FIXTURES ARE THE REAL MEASURED VALUES, NOT INVENTED ONES. Josh's Zoom
 * account returns display_name "Josh"; his real 1012-turn Zoom transcript
 * carries ["Josh", "Justin Schmidt", "Peter Singh"]; and the one colliding call
 * in his 196-call corpus carries ["Josh", "Joshua Pinner"]. A filter tested on
 * material you invented measures your imagination, not the data.
 */
const test = require('node:test');
const assert = require('node:assert');
const { hasLabelCollision, resolveZoomCloser } = require('../lib/zoom-identity');
const { normalizeTranscript } = require('../lib/transcript-normalizer');

// the REAL labels off the real call
const REAL_LABELS = ['Josh', 'Justin Schmidt', 'Peter Singh'];
const REAL_DISPLAY = 'Josh';

test('the real call resolves — byte-identical, exactly one match', () => {
  const r = resolveZoomCloser(REAL_DISPLAY, REAL_LABELS);
  assert.strictEqual(r.closerName, 'Josh');
  assert.strictEqual(r.reason, 'exact_match');
});

test('⚠⚠ NO NORMALISATION — every near-miss is REFUSED, not resolved', () => {
  // Each of these is a case someone would "helpfully" normalise. Every one must
  // refuse: the moment a near-miss resolves, this stops being an equality test
  // and becomes the resemblance test that recorded the CLOSER as the PROSPECT
  // on 6 of 83 Fathom calls.
  [
    ['josh',        'case-folded'],
    ['Josh ',       'trailing space'],
    [' Josh',       'leading space'],
    ['JOSH',        'upper-cased'],
    ['Josh P.',     'initial appended'],
    ['Joshua',      'the full first name'],
    ['Joshua Pinner', 'the Fathom label for the same human'],
  ].forEach(([display, why]) => {
    const r = resolveZoomCloser(display, REAL_LABELS);
    assert.strictEqual(r.closerName, null, why + ' must NOT resolve');
    assert.strictEqual(r.reason, 'no_match', why);
  });
});

test('⚠⚠ COLLISION: one distinct label on a call means we stay quiet', () => {
  // Two people sharing a display name are MERGED by Zoom into one VTT label.
  // A real sales call has 2+ speakers, so one label is a collision or a
  // monologue — both are reasons to refuse.
  assert.strictEqual(hasLabelCollision(['Josh']), true);
  assert.strictEqual(hasLabelCollision([]), true);
  assert.strictEqual(hasLabelCollision(REAL_LABELS), false);

  const r = resolveZoomCloser('Josh', ['Josh']);
  assert.strictEqual(r.closerName, null, 'a collided call must not resolve');
  assert.strictEqual(r.reason, 'label_collision');
});

test('⚠⚠ COLLISION IS CHECKED BEFORE THE MATCH — the order is load-bearing', () => {
  // On a collided call the closer's name DOES appear; it is just also someone
  // else's. Matching first would return a confident WRONG answer on exactly the
  // call the detector exists to catch.
  const r = resolveZoomCloser('Josh', ['Josh']);
  assert.strictEqual(r.reason, 'label_collision',
    'must report the collision, NOT an exact match — if this ever reads '
    + '"exact_match" the checks have been reordered and the detector is dead');
});

test('⚠ the 3-person partial collision is UNDETECTABLE — asserted, not hidden', () => {
  // Three people, two sharing a name -> two labels -> passes the detector.
  // This is the accepted residue. The test exists so that if someone later
  // believes the detector is complete, this states plainly that it is not.
  assert.strictEqual(hasLabelCollision(['Josh', 'Justin Schmidt']), false,
    'two labels pass — even when they represent three people');
  const r = resolveZoomCloser('Josh', ['Josh', 'Justin Schmidt']);
  assert.strictEqual(r.closerName, 'Josh',
    'ACCEPTED LIMIT: a 3-person call where 2 of 3 collide resolves anyway. '
    + 'Measured corpus collision rate is 0.51%. If 3-person calls become '
    + 'common this ruling must be RE-MADE, not quietly widened.');
});

test('missing inputs refuse with a REASON, never a silent null', () => {
  assert.strictEqual(resolveZoomCloser(null, REAL_LABELS).reason, 'no_display_name');
  assert.strictEqual(resolveZoomCloser('', REAL_LABELS).reason, 'no_display_name');
  assert.strictEqual(resolveZoomCloser('Josh', []).reason, 'no_labels');
  assert.strictEqual(resolveZoomCloser('Josh', null).reason, 'no_labels');
});

/* ── THE REAL ENTRY POINT ───────────────────────────────────────────────────
   The unit tests above prove the predicate. They say NOTHING about whether the
   normalizer calls it, or whether the branch is reachable — the dead-call-site
   lesson. These drive normalizeTranscript itself. */

function zoomMeeting(labels, displayName) {
  return {
    recording_id: 'z1',
    // a Zoom VTT carries display names ONLY — no email field anywhere
    transcript: labels.map((n, i) => ({
      speaker: { display_name: n },
      text: 'line ' + i,
      timestamp: '00:00:0' + i,
    })),
    highlights: [],
    recorded_by: null,
    closer_email: null,
    closer_display_name: displayName,
  };
}

test('⚠⚠ END TO END: the normalizer labels CLOSER/PROSPECT off the display name', () => {
  const out = normalizeTranscript(zoomMeeting(REAL_LABELS, REAL_DISPLAY));
  assert.strictEqual(out.speaker_confidence, 'matched');
  assert.strictEqual(out.closer_name, 'Josh');
  const roles = out.turns.map(t => t.speaker);
  assert.deepStrictEqual(roles, ['CLOSER', 'PROSPECT', 'PROSPECT']);
});

test('⚠⚠ END TO END: a collided call degrades to unknown — ONE call, not the provider', () => {
  const out = normalizeTranscript(zoomMeeting(['Josh', 'Josh'], 'Josh'));
  assert.strictEqual(out.speaker_confidence, 'unknown',
    'a collided call must stay quiet');
  assert.strictEqual(out.closer_name, null);
  // and it degrades the SAME way Zoom does today — raw names pass through
  assert.strictEqual(out.turns[0].speaker, 'Josh');
});

test('⚠ END TO END: a no-match Zoom call degrades exactly as it does today', () => {
  const out = normalizeTranscript(zoomMeeting(REAL_LABELS, 'Someone Else'));
  assert.strictEqual(out.speaker_confidence, 'unknown');
  assert.strictEqual(out.closer_name, null);
});

test('⚠⚠ THE FATHOM PATH IS UNTOUCHED — the email branch still wins', () => {
  // Regression guard: the Zoom branch must never intercept a Fathom call. The
  // per-turn invitee email is a strictly stronger identity and fires first.
  const m = {
    recording_id: 'f1',
    transcript: [
      { speaker: { display_name: 'Joshua Pinner', matched_calendar_invitee_email: 'joshua@x.com' },
        text: 'a', timestamp: '00:00:00' },
      { speaker: { display_name: 'Teesha', matched_calendar_invitee_email: null },
        text: 'b', timestamp: '00:00:05' },
    ],
    highlights: [], recorded_by: null,
    closer_email: 'joshua@x.com',
    // a display name that would match the PROSPECT if the Zoom branch ran
    closer_display_name: 'Teesha',
  };
  const out = normalizeTranscript(m);
  assert.strictEqual(out.speaker_confidence, 'matched');
  assert.strictEqual(out.closer_name, 'Joshua Pinner',
    'the EMAIL identity must win — if this returns "Teesha" the Zoom branch is '
    + 'intercepting Fathom calls and would label the prospect as the closer');
  assert.deepStrictEqual(out.turns.map(t => t.speaker), ['CLOSER', 'PROSPECT']);
});
