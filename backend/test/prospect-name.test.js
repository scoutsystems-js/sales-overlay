// lib/prospect-name.js — resolving WHO the prospect on a call actually is.
// PROSPECT NAMES, sub-stage 3a.
//
// ── GOVERNING PRINCIPLE (Justin, 2026-08-03) ─────────────────────────────
// A WRONG name is worse than NO name. A wrong name silently fabricates a
// prospect identity that later merges and miscounts, invisibly. Device names,
// phone numbers, hotspot names and meeting labels must resolve to NULL →
// "Unknown prospect", NEVER to a plausible-looking guess. When in doubt, refuse.
//
// Every rejection test below is therefore a REQUIREMENT, not a nicety: each one
// is a case where returning something readable would be actively harmful.
// All the junk strings here are real values observed in Josh's live corpus.
const test = require('node:test');
const assert = require('node:assert');
const {
  isRejectedName, nameFromTitle, cleanDiarizedName, resolveProspectName,
} = require('../lib/prospect-name');

// ── Rejection: device names ──────────────────────────────────────────────
test('REJECTS device names (8 of 83 live second-speakers were devices)', () => {
  for (const s of [
    'iPhone', 'iphone', 'IPHONE', 'iPad', 'Android', 'Galaxy S22', 'Pixel 7',
    'OnePlus CPH2551', 'MacBook Pro', 'Laptop', 'Desktop', 'BophanoHotspot',
    "Margaret's iPhone", 'Margaret’s iPhone', 'Conference Room', 'Meeting Room 2',
  ]) {
    assert.strictEqual(isRejectedName(s), true, 'must reject device: ' + s);
  }
});

test("REJECTS a possessive device name even though a real name is inside it", () => {
  // "Margaret's iPhone" contains a genuine first name, and extracting it would
  // usually be right. We refuse anyway: the same shape produces "Conference
  // Room's iPhone", and per the governing principle a plausible-looking guess is
  // the failure we are protecting against. 3c's LLM pass recovers these properly.
  assert.strictEqual(isRejectedName("Margaret's iPhone"), true);
  assert.strictEqual(cleanDiarizedName("Margaret's iPhone"), null);
});

// ── Rejection: phone / dial-in identifiers ───────────────────────────────
test('REJECTS phone numbers and dial-in ids', () => {
  for (const s of ['84844626214', '+1 (555) 123-4567', '555-123-4567', '18005551234', '+44 20 7946 0958']) {
    assert.strictEqual(isRejectedName(s), true, 'must reject phone: ' + s);
  }
});

// ── Rejection: meeting labels ────────────────────────────────────────────
test('REJECTS meeting labels — the bug that started this stage', () => {
  for (const s of [
    'Impromptu Zoom Meeting', 'Zoom Meeting', 'Meeting', 'New Meeting', 'My Meeting',
    'Google Meet', 'Teams Meeting', 'Huddle', 'Standup', 'Stand-up', 'Sync',
    'Weekly Sync', 'Webinar', 'Training', 'Interview', 'Discovery Call', 'Sales Call', 'Call',
  ]) {
    assert.strictEqual(isRejectedName(s), true, 'must reject meeting label: ' + s);
  }
});

// ── Rejection: placeholders and junk ─────────────────────────────────────
test('REJECTS placeholders (live corpus contains "X" on 2 calls)', () => {
  for (const s of ['X', 'x', 'TBD', 'N/A', 'NA', 'Unknown', 'Test', 'Guest', 'User', 'Anonymous', '?', '-', '...']) {
    assert.strictEqual(isRejectedName(s), true, 'must reject placeholder: ' + s);
  }
});

test('REJECTS empty / whitespace / non-string', () => {
  for (const s of ['', '   ', null, undefined, 42, {}, []]) {
    assert.strictEqual(isRejectedName(s), true);
  }
});

test('REJECTS an email address or URL masquerading as a name', () => {
  for (const s of ['josh@scoutsystems.io', 'https://zoom.us/j/123', 'www.example.com']) {
    assert.strictEqual(isRejectedName(s), true, 'must reject: ' + s);
  }
});

// ── ACCEPTANCE: real names must survive ──────────────────────────────────
// The rejection rules are aggressive by design; these prove they are not so
// aggressive that they refuse legitimate people.
test('ACCEPTS real names from the live corpus, including awkward ones', () => {
  for (const s of [
    'Katina Goss', 'Gabriel Ocasio', 'Lemoine Richmond', 'Eli Leifer', 'Jamie Ellis',
    'Khari', 'isaac', 'bopha', 'Tierra O', 'Osias', 'Mark-Anthony Rassmann',
    'Serena Ifeoma Moka', "O'Brien", 'Jean-Luc Picard', 'Nefertari', 'TJ',
  ]) {
    assert.strictEqual(isRejectedName(s), false, 'must ACCEPT real name: ' + s);
  }
});

test('cleanDiarizedName trims and normalises but does not invent', () => {
  assert.strictEqual(cleanDiarizedName('  Katina Goss  '), 'Katina Goss');
  assert.strictEqual(cleanDiarizedName('isaac'), 'isaac');       // case preserved, not title-cased
  assert.strictEqual(cleanDiarizedName('iPhone'), null);
  assert.strictEqual(cleanDiarizedName(null), null);
});

// ── Title parsing ────────────────────────────────────────────────────────
test('nameFromTitle takes the last pipe segment', () => {
  assert.strictEqual(nameFromTitle('PS Sober Living Riches | Amanda Law'), 'Amanda Law');
  assert.strictEqual(nameFromTitle('IH Sober Living Riches | Maria Mercado'), 'Maria Mercado');
});

test('nameFromTitle REFUSES an unpiped meeting label (the original bug)', () => {
  // The old prospectNameFromTitle returned this verbatim, collapsing 11 distinct
  // real prospects into one "Impromptu Zoom Meeting".
  assert.strictEqual(nameFromTitle('Impromptu Zoom Meeting'), null);
  assert.strictEqual(nameFromTitle('Zoom Meeting'), null);
  assert.strictEqual(nameFromTitle(''), null);
  assert.strictEqual(nameFromTitle(null), null);
});

test('nameFromTitle refuses a piped segment that is itself junk', () => {
  assert.strictEqual(nameFromTitle('IH Sober Living Riches | X'), null);
  assert.strictEqual(nameFromTitle('Something | iPhone'), null);
});

test('nameFromTitle accepts an unpiped title that is plainly a person', () => {
  assert.strictEqual(nameFromTitle('Katina Goss'), 'Katina Goss');
});

// ── Resolution precedence ────────────────────────────────────────────────
const turns = (names) => names.map((n, i) => ({ display_name: n, text: 't' + i }));

test('PRECEDENCE: grader name wins over diarized and title', () => {
  const r = resolveProspectName({
    graderName: 'Jamie Ellis',
    turns: turns(['Joshua Pinner', 'Joshua Pinner', 'Tasha P']),
    closerName: 'Joshua Pinner',
    title: 'PS Sober Living Riches | Tasha Presberry',
  });
  assert.strictEqual(r.name, 'Jamie Ellis');
  assert.strictEqual(r.source, 'grader');
  assert.strictEqual(r.confidence, 'high');
});

test('PRECEDENCE: diarized wins over title when no grader name (the Katina case)', () => {
  const r = resolveProspectName({
    graderName: null,
    turns: turns(['Joshua Pinner', 'Katina Goss', 'Joshua Pinner', 'Katina Goss']),
    closerName: 'Joshua Pinner',
    title: 'Impromptu Zoom Meeting',
  });
  assert.strictEqual(r.name, 'Katina Goss');
  assert.strictEqual(r.source, 'diarized');
  assert.strictEqual(r.confidence, 'high');
});

test('PRECEDENCE: title used only as a last resort', () => {
  const r = resolveProspectName({
    graderName: null, turns: turns(['Joshua Pinner']), closerName: 'Joshua Pinner',
    title: 'PS Sober Living Riches | Amanda Law',
  });
  assert.strictEqual(r.name, 'Amanda Law');
  assert.strictEqual(r.source, 'title');
  assert.strictEqual(r.confidence, 'low'); // booked name — wrong ~34% of the time
});

test('REFUSES rather than guessing when every source is junk', () => {
  const r = resolveProspectName({
    graderName: null,
    turns: turns(['Joshua Pinner', 'iPhone', '84844626214']),
    closerName: 'Joshua Pinner',
    title: 'Impromptu Zoom Meeting',
  });
  assert.strictEqual(r.name, null);
  assert.strictEqual(r.source, null);
});

// ── Closer exclusion ─────────────────────────────────────────────────────
test('never returns the CLOSER as the prospect', () => {
  const r = resolveProspectName({
    graderName: null, turns: turns(['Joshua Pinner', 'Joshua Pinner']),
    closerName: 'Joshua Pinner', title: 'Impromptu Zoom Meeting',
  });
  assert.strictEqual(r.name, null, 'a solo-closer transcript has no prospect');
});

test('closer excluded by any of the known identities (closer_name is NULL on all 83 live rows)', () => {
  const r = resolveProspectName({
    graderName: null,
    turns: turns(['Joshua Pinner', 'Joshua Pinner', 'Eli Leifer']),
    closerName: null,                 // the live reality
    closerCandidates: ['Joshua Pinner'], // from recorded_by / user profile
    title: 'Impromptu Zoom Meeting',
  });
  assert.strictEqual(r.name, 'Eli Leifer');
});

test('REFUSES when the closer cannot be identified at all — no turn-count guessing', () => {
  // An earlier draft assumed "the closer talks most". The live dry run DISPROVED
  // it: on "AF … | Sherrita Hall" the speakers are Donna (637) and Joshua Pinner
  // (585), so the heuristic would have returned the CLOSER as the prospect — a
  // confidently wrong name, the exact failure the governing principle forbids.
  // True on 77 of 83 calls is not good enough when the 6 failures are silent.
  const many = [];
  for (let i = 0; i < 10; i++) many.push({ display_name: 'Joshua Pinner' });
  for (let i = 0; i < 4; i++) many.push({ display_name: 'Katina Goss' });
  const r = resolveProspectName({ graderName: null, turns: many, closerName: null, title: 'Impromptu Zoom Meeting' });
  assert.strictEqual(r.name, null);
  assert.strictEqual(r.source, null);
});

test('the closer email’s local part is enough to identify the closer', () => {
  // How real rows resolve: fathom_connections.fathom_email =
  // "joshua@soberlivingriches.com" → local part "joshua" ↔ "Joshua Pinner".
  const r = resolveProspectName({
    graderName: null,
    turns: turns(['Joshua Pinner', 'Katina Goss', 'Katina Goss']),
    closerName: null,
    closerCandidates: ['joshua@soberlivingriches.com', 'joshua'],
    title: 'Impromptu Zoom Meeting',
  });
  assert.strictEqual(r.name, 'Katina Goss');
  assert.strictEqual(r.confidence, 'high');
});

test('REJECTS generic client participant labels ("Zoom user" — 415 turns on a live call)', () => {
  for (const s of ['Zoom user', 'zoom user', 'Teams user', 'Unknown User', 'Unnamed', 'Participant 2', 'Caller 1']) {
    assert.strictEqual(isRejectedName(s), true, 'must reject: ' + s);
  }
  const r = resolveProspectName({
    graderName: null, turns: turns(['Joshua Pinner', 'Zoom user']),
    closerCandidates: ['joshua'], title: 'AP Sober Living Riches | Christopher Wiley',
  });
  // Falls through to the title rather than naming someone "Zoom user".
  assert.strictEqual(r.name, 'Christopher Wiley');
  assert.strictEqual(r.source, 'title');
});

// ── Corroboration: diarized is more ACCURATE, title is often more COMPLETE ──
test('CORROBORATION: agreeing sources yield the FULLER name at high confidence', () => {
  // Live: title "Towana Joseph", diarized "Towana". Same person; the title
  // carries the surname, which per-prospect grouping in 3d will need.
  const r = resolveProspectName({
    graderName: null, turns: turns(['Joshua Pinner', 'Towana', 'Towana']),
    closerCandidates: ['joshua'], title: 'PS Sober Living Riches | Towana Joseph',
  });
  assert.strictEqual(r.name, 'Towana Joseph');
  assert.strictEqual(r.confidence, 'high');
});

test('CORROBORATION: a truncated diarized name is completed by the title', () => {
  // Live: diarized "Ca" (193 turns) with title "Cameel Bernard".
  const r = resolveProspectName({
    graderName: null, turns: turns(['Joshua Pinner', 'Ca']),
    closerCandidates: ['joshua'], title: 'AF Sober Living Riches | Cameel Bernard',
  });
  assert.strictEqual(r.name, 'Cameel Bernard');
});

test('DISAGREEMENT: diarization wins over the booked title name', () => {
  // Live: title "Kay Rapple", actual attendee "Khari". The title is the BOOKED
  // name and names a different person on ~34% of calls.
  const r = resolveProspectName({
    graderName: null, turns: turns(['Joshua Pinner', 'Khari', 'Khari']),
    closerCandidates: ['joshua'], title: 'PS Sober Living Riches | Kay Rapple',
  });
  assert.strictEqual(r.name, 'Khari');
  assert.strictEqual(r.source, 'diarized');
});

// ── Couples = ONE prospect (ruling 1) ────────────────────────────────────
test('RULING 1: two prospect speakers combine into ONE name', () => {
  const r = resolveProspectName({
    graderName: null,
    turns: turns(['Joshua Pinner', 'Osias', 'Tierra O', 'Osias']),
    closerName: 'Joshua Pinner', title: 'Impromptu Zoom Meeting',
  });
  assert.strictEqual(r.name, 'Osias and Tierra O');
  assert.strictEqual(r.source, 'diarized');
  assert.strictEqual(r.confidence, 'low'); // multi-speaker is inherently less certain
});

test('RULING 1: junk co-speakers are dropped, leaving the real name alone', () => {
  // Live shape: "Joshua Pinner + BophanoHotspot + bopha".
  const r = resolveProspectName({
    graderName: null,
    turns: turns(['Joshua Pinner', 'BophanoHotspot', 'bopha', 'BophanoHotspot']),
    closerName: 'Joshua Pinner', title: 'Impromptu Zoom Meeting',
  });
  assert.strictEqual(r.name, 'bopha');
  assert.strictEqual(r.confidence, 'high'); // exactly one valid prospect name survived
});

test('three or more valid prospect speakers REFUSES rather than inventing a combined identity', () => {
  const r = resolveProspectName({
    graderName: null,
    turns: turns(['Joshua Pinner', 'Ann', 'Ben', 'Cara']),
    closerName: 'Joshua Pinner', title: 'Impromptu Zoom Meeting',
  });
  assert.strictEqual(r.name, null, 'a 3-prospect call is not one prospect; refuse');
});

// ── Totality ─────────────────────────────────────────────────────────────
test('resolveProspectName never throws on junk input', () => {
  for (const v of [undefined, null, {}, { turns: 'nope' }, { turns: [null, {}] }]) {
    const r = resolveProspectName(v);
    assert.ok(r && ('name' in r) && ('source' in r) && ('confidence' in r));
  }
});

test('the resolved name is always trimmed and never a bare empty string', () => {
  const r = resolveProspectName({ graderName: '  Katina Goss  ', turns: [], title: null });
  assert.strictEqual(r.name, 'Katina Goss');
});
