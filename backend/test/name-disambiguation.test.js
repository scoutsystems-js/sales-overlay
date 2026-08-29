/**
 * TWO PEOPLE SHARING A FIRST NAME (Justin, 2026-08-29): "show the surname
 * initial — Josh P." Live on the board: Josh Pinner and Josh Niebloom.
 *
 * ⚠⚠ IT MATTERS MOST IN PROSE, WHICH IS WHY THE LABEL ITSELF IS FIXED RATHER
 * THAN THE COLUMN. A grid shows both full names and they are already distinct —
 * but the digest hands these labels to a MODEL and the model SHORTENS them. A
 * real stored digest reads "Yazan's close on Alicia Robinson is the model";
 * with two Joshes that becomes "Josh", attributing one rep's work to another
 * with nothing on screen to say which.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { disambiguateNames } = require('../lib/display-name');

test('a shared first name gains a surname initial', () => {
  const out = disambiguateNames({ a: 'Josh Pinner', b: 'Josh Niebloom' });
  assert.strictEqual(out.a, 'Josh P');
  assert.strictEqual(out.b, 'Josh N');
});

test('a UNIQUE first name is left exactly as it was — this is not a rename', () => {
  const out = disambiguateNames({
    a: 'Josh Pinner', b: 'Josh Niebloom',
    c: 'Yazan Younis', d: 'Godwin Ona', e: "Nick O'Neal",
  });
  assert.strictEqual(out.c, 'Yazan Younis');
  assert.strictEqual(out.d, 'Godwin Ona');
  assert.strictEqual(out.e, "Nick O'Neal");
});

test('it NEVER invents an initial it does not have', () => {
  /* ⚠ A colliding person with no surname keeps their label unchanged. A wrong
     or empty initial is worse than the collision it was meant to solve — the
     same governing rule as prospect names: when in doubt, do not guess. */
  const out = disambiguateNames({ a: 'Josh', b: 'Josh Pinner' });
  assert.strictEqual(out.a, 'Josh', 'no surname → unchanged, never "Josh " or "Josh ?"');
  assert.strictEqual(out.b, 'Josh P');
});

test('case-insensitive collision, and a middle name still yields the SURNAME', () => {
  const out = disambiguateNames({ a: 'josh pinner', b: 'Josh Niebloom' });
  assert.strictEqual(out.b, 'Josh N', 'the collision must be detected across case');
  const mid = disambiguateNames({ a: 'Josh Alan Pinner', b: 'Josh Niebloom' });
  assert.strictEqual(mid.a, 'Josh P', 'the LAST token is the surname, not the middle name');
});

test('total on junk — a naming helper must never throw', () => {
  [null, undefined, 'nope', 42, []].forEach(v => {
    assert.doesNotThrow(() => disambiguateNames(v));
  });
  assert.deepStrictEqual(disambiguateNames({ x: '' }), { x: '' });
  assert.deepStrictEqual(disambiguateNames({}), {});
});

/* ── applied once, where the maps are built ───────────────────────────────── */

test('it is applied where a name map is PRODUCED, not at each render site', () => {
  const team = fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8');
  const analytics = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-analytics.js'), 'utf8');
  /* ⚠ Disambiguation needs to see EVERY member at once, so it cannot be done
     per row — and doing it at each surface is how two screens come to disagree
     about what one person is called. */
  assert.ok(/return disambiguateNames\(nameMap\)/.test(team),
    'nameMapFor must disambiguate before returning');
  assert.ok(/nameOf = disambiguateNames\(nameOf\)/.test(analytics),
    'the board must disambiguate across the whole team');
  assert.ok(/display_name: nameOf\[id\]/.test(analytics),
    'and per_rep must read the disambiguated map');
});

test('the Calls rep picker names the person rather than showing a raw email', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'dashboard.html'), 'utf8');
  const code = html.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
                   .replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/personLabel\(u\) \|\| u\.user_id/.test(code),
    'the picker must resolve a name, falling back to an id only when there is none');
  assert.ok(!/\(self \? 'Me — ' : ''\) \+ \(u\.email \|\| u\.user_id\)/.test(code),
    'the raw-email label must not come back');
});

/* ── the prose lanes, which are where an ambiguous label costs most ────────── */

test('the prose lanes prefer the PROFILE name over the email-derived one', () => {
  const nwSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-needs-work.js'), 'utf8');
  const synSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'team-synthesis.js'), 'utf8');
  const strip = s => s.split('\n').filter(l => l.trim().indexOf('//') !== 0).join('\n')
                      .replace(/\/\*[\s\S]*?\*\//g, '');
  const nw = strip(nwSrc), syn = strip(synSrc);

  /* ⚠ These two lanes fed a MODEL while naming people from their email — so
     they said "Joshua" where the board said "Josh P". A model shortens what it
     is given, which is exactly where an ambiguous label does damage. */
  assert.ok(/computeTeamNeedsWork\(admin, keyId, repIds, from, to, emailMap, nameMap\)/.test(nw),
    'needs-work must accept a name map');
  assert.ok(/\(nameMap && nameMap\[rid\]\) \|\|/.test(nw),
    'and prefer it over the email-derived name');

  ['computeTeamRecommendations', 'computeWeeklyHighlights'].forEach(fn => {
    assert.ok(new RegExp(fn + '\\(admin, keyId, repIds, from, to, emailMap, nameMap\\)').test(syn),
      fn + ' must accept a name map');
  });
  // it used to hand the model a RAW EMAIL as the rep
  assert.ok(!/rep: \(emailMap && emailMap\[rid\]\) \|\| rid,/.test(syn),
    'a raw email must never be handed to the model as the rep name');

  const team = strip(fs.readFileSync(path.join(__dirname, '..', 'routes', 'team.js'), 'utf8'));
  const calls = (team.match(/await nameMapFor\(admin, team\.memberIds, em\)/g) || []).length;
  assert.ok(calls >= 5, 'every lane that names people must be passed the map, found ' + calls);
});
