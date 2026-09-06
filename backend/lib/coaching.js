var { outcomeLabel } = require('./outcome-labels');   // H709
/**
 * PER-MOMENT COACHING (v30).
 *
 * Turns a stored moment into coaching a closer can act on. Justin picked the
 * voice ("version C plus the reasoning") after reading real output on real
 * calls, and every rule below came from him reading output rather than from a
 * measurement — see the standing note that the definition of done on this
 * feature includes him reading it.
 *
 * ⚠⚠ ONE MODEL CALL PER CALL, COVERING ALL ITS MOMENTS. Never one per moment.
 * Calls average 5.7 coachable moments, so per-moment would be a 5.7x error.
 * Each candidate carries a located transcript exchange and the call ending.
 * Those excerpts do not establish what happened in the omitted parts of a call.
 *
 * ⚠ IT DRIVES NO SCORE. Coaching text is written to call_highlights.coaching and
 * read by the What Needs Work panel. Nothing aggregates it.
 */

var CLAUDE_COACHING_MODEL = 'claude-sonnet-4-6';
var COACHING_MAX_TOKENS   = 2000;
var COACHING_MAX_WORDS    = 90;

/* Coach only the moments a surface actually renders. The What Needs Work panel
   shows the `bad` group, which is where all four approved samples came from.
   Coaching moments nobody renders is spend with no consumer. */
/* ⚠ ONE SOURCE (③-5, 2026-09-02): the coachable set IS the evidence rule's negative set —
   "moments where something went wrong". Typed twice they agreed, in different orders, and
   nothing pinned them; a type coached on but refused as evidence would drift by omission.
   Order is prompt text over there and irrelevant here (indexOf). Pinned by identity. */
var COACHABLE_TYPES = require('./evidence-rule').NEGATIVE_TYPES;
var doctrineLib = require('./doctrine');   // H732

/* ⚠ `coachingOpening` REMOVED 2026-08-30. It assembled "At HH:MM:SS the prospect
   said …" and prepended it, which made the card show the quote twice; the panel
   then stripped that line and, because the card had no timestamp of its own, the
   strip deleted the ONLY timestamp on the surface. THE ANCHOR BELONGS TO THE CARD,
   rendered from timestamp_seconds — do not reintroduce it into the prose. */

function hms(x) {
  var n = Math.floor(Number(x) || 0);
  return [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60]
    .map(function (v) { return String(v).padStart(2, '0'); }).join(':');
}

/** The moments worth coaching, in the order the panel shows them. */
function selectCoachableMoments(highlights) {
  return (Array.isArray(highlights) ? highlights : []).filter(function (h) {
    if (!h || typeof h !== 'object') return false;
    if (!h.quote || !String(h.quote).trim()) return false;
    if (COACHABLE_TYPES.indexOf(h.type) === -1) return false;
    // an objection the closer HANDLED is a good moment, not something to fix
    if (h.type === 'objection' && h.resolution === 'handled') return false;
    /* H732, HARD RULE IN CODE: a financial disqualification is never a lost deal or a failed close — it is not coached
       here at all (it is coached upstream, on qualification, by the grader's qualification check). */
    if (doctrineLib.isDqMoment(h)) return false;
    return true;
  });
}

function momentBlock(m, i) {
  return [
    'MOMENT ' + (i + 1),
    'Section: ' + (m.section || 'unknown') + '. Time: ' + m.time + '.',
    'The prospect said: "' + m.quote + '"',
    (m.closerResponse
      ? 'The closer replied: "' + m.closerResponse + '"'
      : 'No verified reply is stored for this moment. This does not establish silence; read the supplied transcript turns.'),
    'What was observed: ' + (m.observation || '(nothing recorded)'),
  ].join('\n');
}

/**
 * ONE prompt for every moment on a call. Returns JSON so each piece of coaching
 * can be mapped back to the row it belongs to.
 */
function buildCoachingPrompt(moments, opts) {
  var o = opts || {};
  var outcome = o.outcome || 'unknown';
  var dq = !!o.dq;
  var notes = (o.managerNotes || '').trim();
  var kb = (o.teamReasoning || '').trim();
  var outcomeContext = dq
    ? 'THIS PROSPECT WAS DISQUALIFIED. There was no deal to lose. Coach only an evidenced upstream qualification miss, not overcoming inability to buy.'
    : outcome === 'closed'
      ? 'THIS CALL CLOSED. A close does not prove every move was correct or that this move caused the close.'
      : outcome === 'lost'
        ? 'THIS CALL WAS LOST. The result does not establish what caused it.'
        : outcome === 'follow_up'
          ? 'THIS CALL IS STILL OPEN. Do not describe it as lost.'
          : 'THE CALL OUTCOME IS UNKNOWN. Do not substitute a result.';
  return [
    'Write concise post-call coaching to the closer. Use the transcript evidence and this team\'s guidance, not generic sales commentary.',
    'There are ' + moments.length + ' candidate moments below. A candidate is not an established mistake. If the closer handled it appropriately or a useful change is not supported, return coaching:null and no_change:true.',
    'ONE SHORT NOTE PER CANDIDATE: Aim for 45–65 words, usually three sentences. The hard maximum is ' + COACHING_MAX_WORDS + ' words including any memory statement. Do not pad, repeat the quote, add a headline, or list several improvements.',
    'First orient the reader with the recorded outcome and observed continuation after the moment. Then give ONE concrete change the closer can make and, when useful, the specific information it would establish. Stop there. The evidence display already supplies the quote and timestamp.',
    'An example of that shape, ONLY when its facts are supported: "The call remains open. In this exchange, the family discussion led to a text follow-up without a confirmed time. Clarify what that discussion needs to resolve and agree a time to reconnect." DO NOT REPRODUCE THAT WORDING on other calls.',
    'EVIDENCE: Read the entire supplied closer reply and following turns. The observation is an earlier interpretation, not proof; prior summaries also need verification against the dialogue. A general method is not evidence of what happened on this particular call.',
    'NEVER INVENT THE PROSPECT: no inferred motives, emotions, silence, intent, approval requirements or facts from omitted parts of the call. If the impact is unknown, leave it unknown. Report the recorded outcome and observed continuation without inventing why one caused the other.',
    'Keep an absence observation explicitly local in its own sentence, such as "In this exchange, no callback time was confirmed." Do not turn it into a claim that price never dropped or a move never happened on the whole call. A local label cannot justify a global claim.',
    'NEVER NAME THE PROSPECT. Use they/them for the prospect and you for the closer. Do not copy names, gendered prospect pronouns, timestamps, scores, placeholders or internal guidance labels into the note.',
    'COACH THE PRINCIPLE, NOT A SCRIPT. Specify what to establish or do, not words to recite. Different wording that achieves the same thing is not a mistake. No theory about why a technique works unless the supplied team material supports it.',
    'ISOLATION IS CORRECT TECHNIQUE. Setting a concern aside to test whether it is the only blocker is not avoidance. Assess what happened afterward; never coach the closer to stop isolating. Missing isolation can be coached when the exchange supports that observation.',
    'For fear, identify the actual concern and test commitment conditional on resolving it; "is this something you would want to do" illustrates the principle, not required wording. For a partner discussion, respect the relationship and clarify the person\'s role without assuming it. A real logistical barrier needs a practical next step. Financial inability is disqualification, not an objection to overcome; unknown affordability calls for qualification, not an assumed verdict.',
    'Use plain text, direct second-person sentences and a respectful tone. No markdown, filler, concluding summary or diminishing a closer\'s results. Preserve a verified memory sentence only when relevant and within the word limit; never invent a habit or count.',
    'RECORDED OUTCOME: ' + outcomeLabel(doctrineLib.outcomeForAdvice(outcome, dq)) + '. ' + outcomeContext,
    !o.actionRecords && o.later ? 'EARLIER SUMMARY (interpretation to check): ' + o.later : '',
    !o.actionRecords && o.objectionNotes ? 'EARLIER OBJECTION NOTES (interpretation to check): ' + o.objectionNotes : '',
    o.historyBlock || '',
    o.actionRecords ? moments.map(function(m,i){return 'CANDIDATE '+(i+1)+' QUOTE: '+m.quote;}).join('\n\n') : moments.map(momentBlock).join('\n\n'),
    o.actionRecords ? require('./coaching-action-record').recordBlock(o.actionRecords) : o.evidenceContext || '',
    o.doctrineBlock || '',
    o.sellingContext ? 'TEAM MATERIAL:\n' + o.sellingContext : '',
    kb ? 'TEAM REASONING (supports the technique, never new facts about this prospect):\n' + kb : '',
    notes ? require('./coaching-corrections').promptLane(notes, {applied:true}) : '',
    'Return ONLY a JSON array with each original moment number. Keep no-change entries too. No prose outside JSON.',
    JSON.stringify(moments.map(function(m, i) {
      var entry = {moment:i+1, coaching:'45–65 words, or null if no supported improvement', no_change:false};
      if (notes) entry.applied_manager_notes = [];
      return entry;
    })),
    'For no change use coaching:null and no_change:true. Otherwise return the short coaching text and no_change:false. Recheck the subsequent dialogue before alleging an omission.'
  ].filter(Boolean).join('\n\n');
}

/** Shape a stored highlight row into the moment the prompt consumes. */
function toMoment(h) {
  return {
    id: h.id,
    section: h.section,
    time: hms(h.timestamp_seconds),
    quote: h.quote,
    closerResponse: (h.closer_response_verified === true) ? h.closer_response : null,
    observation: h.observation,
  };
}

/* H732 — the two hard rules on the WRITTEN text: an entry that coaches a rep out of isolating, or frames a moment as a lost
   deal or failed close, is dropped and logged. A pattern check: it catches the shapes seen so far, not every phrasing. */
// H732 — the two hard rules, in code, on the written text. The isolation rule applies to every call. The loss rule
// applies only to a call that carries a disqualification (`opts.hasDq`): on a call with none, "you lost the deal" is an
// honest sentence and dropping it would make the lane say less than it knows.
function enforceHardRules(entries, opts) {
  var hasDq = !!(opts && opts.hasDq);
  return (Array.isArray(entries) ? entries : []).filter(function (e) {
    var t = e && e.coaching;
    if (doctrineLib.violatesIsolation(t)) { console.warn('[coaching] dropped (coaches out of isolating): ' + String(t).slice(0, 120)); return false; }
    if (hasDq && doctrineLib.framesDqAsLoss(t)) { console.warn('[coaching] dropped (frames a disqualification as a loss): ' + String(t).slice(0, 120)); return false; }
    return true;
  });
}
function hasDqMoment(rows) { return (Array.isArray(rows) ? rows : []).some(doctrineLib.isDqMoment); }

module.exports = {
  enforceHardRules:      enforceHardRules,
  hasDqMoment:           hasDqMoment,
  CLAUDE_COACHING_MODEL: CLAUDE_COACHING_MODEL,
  COACHING_MAX_TOKENS:   COACHING_MAX_TOKENS,
  COACHING_MAX_WORDS:    COACHING_MAX_WORDS,
  COACHABLE_TYPES:       COACHABLE_TYPES,
  selectCoachableMoments: selectCoachableMoments,
  buildCoachingPrompt:   buildCoachingPrompt,
  toMoment:              toMoment,
  hms:                   hms,
};
