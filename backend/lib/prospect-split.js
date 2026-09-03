// lib/prospect-split.js — THE SPLITTING PASS (Justin's ruling 2026-09-03, H702).
//
// THE RULE, already recorded in CLAUDE.md §4b — applied here, not re-derived:
//   A ONE-WORD PROSPECT WHOSE TITLES CARRY TWO OR MORE DIFFERENT SURNAMES IS A
//   COLLISION, NOT A PROSPECT. "Anthony Ehikhamhen → Anthony Simmons → Anthony
//   Hall → Anthony Davis" stored as one prospect with four closes is four people.
//
// SILENCE BEATS A GUESS — a call produces NO move when:
//   • its title has no "| Name" segment (untitled calls stay where they are);
//   • the segment fails titleNameSegment (digits, an email, 1 or 5+ tokens, the
//     device/label vocabulary);
//   • the segment's FIRST token is not the prospect's own one-word name
//     (a nickname "Chris" vs "Christopher Chavez", a wrong-person title "Dan" vs
//     "Carrie Banks Wright", and the company name "Sober Living Riches" all fail
//     here — that one test covers every "does not match the speaker" case);
//   • the prospect's eligible calls carry fewer than two distinct surnames.
//
// It corrects the NUMERATOR's grouping and nothing else: no outcome, no mark, no
// attribution, no merge page. Reversible by construction — every move is a row
// in prospect_splits (migration 063), and undoSplits puts a call back.
//
// planSplits is pure and total. applySplits/undoSplits do I/O and never throw.
'use strict';
var { titleNameSegment } = require('./prospect-identity');
var { nameKey } = require('./prospect-entity');

var SUFFIXES = { jr: 1, 'jr.': 1, sr: 1, 'sr.': 1, ii: 1, iii: 1, iv: 1 };

function surnameOf(tokens) {
  var last = tokens[tokens.length - 1].toLowerCase();
  if (SUFFIXES[last] && tokens.length > 2) return tokens[tokens.length - 2].toLowerCase();
  return last;
}

/* prospects: [{ id, user_id, display_name }]      (any; one-word ones are candidates)
   calls:     [{ id, user_id, prospect_id, title }] (already real, counted, undeduplicated)
   → { moves: [{ call_id, user_id, from_prospect_id, from_display_name, to_display_name,
                 to_name_key, surname, reason }],
       prospects_split, skipped: { untitled, unusable_segment, first_token_mismatch, one_surname } } */
function planSplits(input) {
  var prospects = (input && Array.isArray(input.prospects)) ? input.prospects : [];
  var calls = (input && Array.isArray(input.calls)) ? input.calls : [];
  var byId = {};
  prospects.forEach(function (p) { if (p && p.id) byId[p.id] = p; });
  var skipped = { untitled: 0, unusable_segment: 0, first_token_mismatch: 0, one_surname: 0 };
  var perProspect = {};   // prospect_id → [{ call, seg, tokens, surname }]
  calls.forEach(function (c) {
    if (!c || !c.prospect_id || !byId[c.prospect_id]) return;
    var p = byId[c.prospect_id];
    var pname = (typeof p.display_name === 'string') ? p.display_name.trim() : '';
    if (!pname || /\s/.test(pname)) return;                 // only one-word prospects are candidates
    if (typeof c.title !== 'string' || c.title.indexOf('|') === -1) { skipped.untitled++; return; }
    var seg = titleNameSegment(c.title);
    if (!seg) { skipped.unusable_segment++; return; }
    var tokens = seg.split(' ');
    if (tokens[0].toLowerCase() !== pname.toLowerCase()) { skipped.first_token_mismatch++; return; }
    (perProspect[p.id] = perProspect[p.id] || []).push({ call: c, seg: seg, tokens: tokens, surname: surnameOf(tokens) });
  });
  var moves = [], prospectsSplit = 0;
  Object.keys(perProspect).forEach(function (pid) {
    var rows = perProspect[pid];
    var surnames = {};
    rows.forEach(function (r) { surnames[r.surname] = surnames[r.surname] || r.seg; });   // first-seen full name per surname
    if (Object.keys(surnames).length < 2) { skipped.one_surname += rows.length; return; }
    prospectsSplit++;
    var p = byId[pid];
    rows.forEach(function (r) {
      var toName = surnames[r.surname];
      moves.push({
        call_id:           r.call.id,
        user_id:           r.call.user_id,
        from_prospect_id:  pid,
        from_display_name: p.display_name,
        to_display_name:   toName,
        to_name_key:       nameKey(toName),
        surname:           r.surname,
        reason: { rule: 'one_word_prospect_two_title_surnames', title: r.call.title, title_name: r.seg,
                  first_token: r.tokens[0], surname: r.surname, from_display_name: p.display_name },
      });
    });
  });
  return { moves: moves, prospects_split: prospectsSplit, skipped: skipped };
}

/* Apply the plan. For each move: find-or-create the (user_id, name_key) prospect,
   repoint the call SCOPED BY id AND user_id, then record the split row. A failure
   on one move is counted and logged; the pass continues. Returns counts. */
async function applySplits(admin, moves) {
  var out = { moved: 0, prospects_created: 0, failed: 0 };
  var created = {};   // user_id + '|' + name_key → prospect id (within this run)
  var list = Array.isArray(moves) ? moves : [];
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    try {
      var key = m.user_id + '|' + m.to_name_key;
      var toId = created[key] || null;
      if (!toId) {
        var found = await admin.from('prospects').select('id').eq('user_id', m.user_id).eq('name_key', m.to_name_key).maybeSingle();
        if (found.error) throw new Error('prospects lookup: ' + found.error.message);
        toId = found.data ? found.data.id : null;
        if (!toId) {
          var ins = await admin.from('prospects').insert({ user_id: m.user_id, display_name: m.to_display_name, name_key: m.to_name_key }).select('id').maybeSingle();
          if (ins.error) throw new Error('prospects insert: ' + ins.error.message);
          toId = ins.data ? ins.data.id : null;
          if (!toId) throw new Error('prospects insert returned no id');
          out.prospects_created++;
        }
        created[key] = toId;
      }
      var up = await admin.from('fathom_calls').update({ prospect_id: toId }).eq('id', m.call_id).eq('user_id', m.user_id);
      if (up.error) throw new Error('fathom_calls update: ' + up.error.message);
      var rec = await admin.from('prospect_splits').insert({
        user_id: m.user_id, call_id: m.call_id, from_prospect_id: m.from_prospect_id, to_prospect_id: toId,
        to_display_name: m.to_display_name, reason: m.reason,
      });
      if (rec.error) throw new Error('prospect_splits insert: ' + rec.error.message);
      out.moved++;
    } catch (err) {
      out.failed++;
      console.error('[prospect-split] move failed for call ' + (m && m.call_id) + ': ' + ((err && err.message) || 'unknown'));
    }
  }
  return out;
}

/* Undo: put each split's call back on from_prospect_id and stamp undone_at. */
async function undoSplits(admin, splitIds) {
  var out = { undone: 0, failed: 0 };
  var ids = Array.isArray(splitIds) ? splitIds : [];
  for (var i = 0; i < ids.length; i++) {
    try {
      var s = await admin.from('prospect_splits').select('id, user_id, call_id, from_prospect_id, undone_at').eq('id', ids[i]).maybeSingle();
      if (s.error || !s.data) throw new Error('split not found');
      if (s.data.undone_at) continue;
      var up = await admin.from('fathom_calls').update({ prospect_id: s.data.from_prospect_id }).eq('id', s.data.call_id).eq('user_id', s.data.user_id);
      if (up.error) throw new Error('fathom_calls update: ' + up.error.message);
      var st = await admin.from('prospect_splits').update({ undone_at: new Date().toISOString() }).eq('id', ids[i]);
      if (st.error) throw new Error('stamp: ' + st.error.message);
      out.undone++;
    } catch (err) {
      out.failed++;
      console.error('[prospect-split] undo failed for ' + ids[i] + ': ' + ((err && err.message) || 'unknown'));
    }
  }
  return out;
}

module.exports = { planSplits: planSplits, applySplits: applySplits, undoSplits: undoSplits, surnameOf: surnameOf };
