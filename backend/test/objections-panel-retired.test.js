/**
 * (g) RETIRE THE OLD TEAM "OBJECTION HANDLING FOCUS" VIEW (Justin, 2026-08-29).
 *
 * ⚠⚠ THE ROW SAID IT CARRIED THREE THINGS THE DRILLDOWN DOES NOT. Measured
 * before retiring, TWO WERE ALREADY STALE — and filing them as losses would
 * have been wrong:
 *   • the sales-language taxonomy → the DRILLDOWN has it;
 *   • the strict denominator AND the exclusion counts → the drilldown has both;
 *   • clickable bucket → per-call evidence → NOT unique to the retired view; it
 *     lives in a function SHARED with the live personal rep page.
 * So nothing was lost, and the shared pieces had to survive the removal.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
/* ⚠ Comments stripped: this codebase archives removed code IN PLACE, so a raw
   grep reports a shipped removal as un-shipped. */
const LIVE = RAW.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('the retired view has no live render path', () => {
  assert.strictEqual((LIVE.match(/renderTeamNeedsWorkView/g) || []).length, 0,
    'the archived view must not be reachable');
  assert.ok(/renderTeamNeedsWorkView/.test(RAW),
    'it should still be archived in place, not deleted outright');
});

test('⚠ BOTH dispatchers still normalise the old hash — a bookmark must land somewhere', () => {
  /* Two entry points: setView (via ARCHIVED_VIEWS) and the hash map, which
     assigns state.view DIRECTLY. Normalising only one leaves a pasted URL or a
     refresh opening a page that no longer exists. */
  assert.ok(/ARCHIVED_VIEWS = \{ 'team-needs-work': 'team-objections' \}/.test(LIVE),
    'setView must normalise');
  assert.ok(/'team-needs-work': 'team-objections'[\s\S]{0,120}TEAM_HASH|TEAM_HASH[\s\S]{0,200}'team-needs-work': 'team-objections'/.test(LIVE),
    'the hash map must normalise too');
});

test('⚠⚠ THE SHARED PIECES SURVIVED — removing them would break a LIVE surface', () => {
  /* needsWorkDetailBodyHtml is used by the personal rep page. openBucketEvidence
     is reachable only through it. teamNeedsWorkCardHtml is the team-page card,
     which stays by ruling — it is the only place its context line renders. */
  /* ⚠⚠ CONVERTED 2026-09-01 — THE TEAM CARD IS GONE AND ITS UNIQUE CLAIM WAS
     STALE. This used to require teamNeedsWorkCardHtml to be called, on the
     stated grounds that the card was "the only place its context line renders".
     ⚠ VERIFIED BEFORE REMOVING, because a claim about what something uniquely
     carries is a claim and not an inventory: the drilldown renders its own
     exclusion line ("— not counted as coachable objections", and its own comment
     records having had both since 2026-08-22), and nwContextLineHtml still has a
     SECOND call site on the personal rep page. Nothing was lost.
     ⚠ Justin's reason for removing it: there is a whole Objections page in the
     sidebar and the card linked straight to it — openTeamNeedsWork() is literally
     openTeamObjections(). A card that duplicates a navigation item. */
  ['needsWorkDetailBodyHtml', 'openBucketEvidence'].forEach(f => {
    assert.ok((LIVE.match(new RegExp(f, 'g')) || []).length >= 2,
      f + ' must still be defined AND called');
  });
  assert.ok(/needsWorkDetailBodyHtml\(state\.needsWork\)/.test(LIVE),
    'the personal rep-page call site must remain');
  /* the context line must survive SOMEWHERE, which is the property the old
     assertion was really protecting */
  assert.ok((LIVE.match(/nwContextLineHtml\(/g) || []).length >= 2,
    'the disqualification/logistical context line must still render on the rep page');
  assert.ok(/not counted as coachable objections/.test(LIVE),
    'and the drilldown must state its own exclusion — this is what made the card safe to drop');
});

test('the drilldown genuinely carries what the retired view had', () => {
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-objections.js'), 'utf8');
  assert.ok(/strict:/.test(lib) && /excluded:/.test(lib),
    'the strict denominator and exclusion counts must live in the drilldown lane');
  assert.ok(/Handle rate by objection type/.test(LIVE),
    'the sales-language taxonomy must render somewhere live');
});
