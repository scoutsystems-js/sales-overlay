#!/usr/bin/env node
/**
 * DEPLOY VERIFICATION — every marker declares the ARTEFACT it lives in.
 *
 * ⚠⚠ WHY THE ARTEFACT IS MANDATORY. I checked for `EXCLUSION — legal` on the
 * served /dashboard page. It lives in `lib/team-digest.js`, so it returned 0 —
 * and A MARKER CHECKED AGAINST A FILE THAT COULD NEVER CONTAIN IT IS
 * INDISTINGUISHABLE FROM A MISSING DEPLOY. The check cannot fail correctly,
 * because it was never able to succeed.
 *
 * ⚠ AND THE SERVED PAGE IS ~42% COMMENT, so a raw grep on it is not evidence:
 * this codebase archives removed code in place and explains its rules in prose,
 * so a string routinely survives inside the comment describing its own removal.
 * RAW and CODE counts are printed side by side — one number is ambiguous, the
 * pair explains itself.
 *
 * Usage:  node scripts/verify-deploy.js <expected-commit-sha>
 */
const { execSync } = require('child_process');

const SITE = process.env.SCOUT_SITE || 'https://www.scoutsystems.io';

/* artefact: 'page'   -> fetched from the served site and checked in CODE
   artefact: 'server' -> not in any served page; verified by COMMIT ANCESTRY,
                         because there is no HTTP surface that would show it. */
const MARKERS = [
  { marker: 'var teamEpoch',            artefact: 'page',   why: 'team epoch (df755a4)' },
  { marker: 'teamLabelForSelection',    artefact: 'page',   why: 'one-source label (df755a4)' },
  { marker: 'personLabel(',             artefact: 'page',   why: 'people are named (df755a4)' },
  { marker: 'adoptRunningGrade',        artefact: 'page',   why: 'grading run survives refresh (c03e000)' },
  { marker: 'displayCloserResponse',    artefact: 'server', file: 'backend/lib/closer-side.js', why: 'sentinel display gate (3ab987a)' },
  { marker: 'EXCLUSION — legal',        artefact: 'server', file: 'backend/lib/team-digest.js', why: 'digest compliance suppression (1b38cca)' },
];

function stripComments(src) {
  // line comments FIRST — a `/*` inside a `//` line is a false opener
  return src.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}
const count = (hay, needle) => hay.split(needle).length - 1;

(async () => {
  const expected = process.argv[2];
  if (!expected) { console.error('usage: verify-deploy.js <expected-commit-sha>'); process.exit(2); }

  const res = await fetch(SITE + '/dashboard');
  const raw = await res.text();
  const live = stripComments(raw);
  console.log('served /dashboard: raw ' + raw.length + '  code ' + live.length
    + '  (' + Math.round((raw.length - live.length) * 100 / raw.length) + '% comment)\n');

  let bad = 0;
  console.log('marker                      ARTEFACT  RAW  CODE  verdict');
  MARKERS.forEach((m) => {
    if (m.artefact === 'page') {
      const r = count(raw, m.marker), c = count(live, m.marker);
      const ok = c > 0;
      if (!ok) bad++;
      console.log(m.marker.padEnd(28) + 'page'.padEnd(10) + String(r).padStart(3) + String(c).padStart(6)
        + '  ' + (ok ? 'live' : '⚠ NOT IN CODE') + '   ' + m.why);
    } else {
      /* ⚠ NOT checked against the page — it could never appear there. Verified
         by ancestry: the file changed in a commit the deployment contains. */
      let ok = false;
      try {
        execSync('git merge-base --is-ancestor ' + expected + ' HEAD || true', { stdio: 'ignore' });
        const has = execSync('git show ' + expected + ':' + m.file + ' 2>/dev/null || true', { encoding: 'utf8' });
        ok = has.indexOf(m.marker) !== -1;
      } catch (e) { ok = false; }
      if (!ok) bad++;
      console.log(m.marker.padEnd(28) + 'server'.padEnd(10) + '  -' + '     -'
        + '  ' + (ok ? 'in ' + expected.slice(0, 7) : '⚠ ABSENT') + '   ' + m.why + '  [' + m.file + ']');
    }
  });
  console.log('\n' + (bad ? '⚠ ' + bad + ' marker(s) failed' : 'all markers verified'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('THREW: ' + e.message); process.exit(2); });
