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
  var kb = (o.teamReasoning || '').trim();
  var notes = (o.managerNotes || '').trim();
  var outcome = o.outcome || 'unknown';
  /* H733 — A DISQUALIFIED PROSPECT IS NEVER A LOST DEAL. On a call that carries a disqualification (`o.dq`), the
     lane is TOLD the prospect was disqualified, never that the call was lost — the stored outcome is untouched;
     this is what the coaching reads. The opening line, the cost clause and the drop after the parse all follow. */
  var dq = !!o.dq;
  var advised = doctrineLib.outcomeForAdvice(outcome, dq);

  return [
    'You are coaching a high-ticket closer on moments from their own sales call.',
    'Write from the perspective of their sales manager, using only the supplied evidence. You have excerpts, not a recording of the whole call.',
    '',
    dq
      ? 'Call outcome: the prospect was DISQUALIFIED — they stated a reason the offer does not apply, or the money genuinely was not there. This is NOT a lost deal and NOT a failed close: there was no deal to lose. Never open with, or frame this call as, a loss; if there was a miss it is upstream, in qualification, and that is what you coach.'
      : 'Call outcome: ' + outcomeLabel(advised) + '.',   /* H709: the label (Open), never the machine word */
    (o.later ? 'Earlier call summary (an interpretation to verify against the supplied dialogue, not independent proof of causation): ' + o.later : ''),
    /* ⚠ How objection handling went ACROSS the call — Justin: "the context behind
       what was said is vital". It is the grader's own objection_notes, so it is
       real rather than inferred; absent when the grader wrote none. */
    (o.objectionNotes ? 'Earlier objection-handling summary (verify its claims against the supplied dialogue): ' + o.objectionNotes : ''),
    (o.historyBlock && String(o.historyBlock).trim()) ? '\n' + String(o.historyBlock).trim() : '',   // H735: what Scout has coached this closer on before
    '',
    'There are ' + moments.length + ' candidate moments below. They are candidates, not established mistakes. Evaluate each independently against the full supplied exchange and team material. If the closer did the appropriate work, or you cannot support a concrete improvement, return coaching:null and no_change:true. Do not invent an improvement to fill a slot. It is valid for EVERY candidate to need no change.',
    '',
    moments.map(momentBlock).join('\n\n'),
    o.evidenceContext || '',
    '',
    '⚠⚠ WHAT YOU KNOW ABOUT THE PROSPECT — AND IT IS ONLY THIS',
    'The supplied transcript windows and ending, plus the stored outcome, are everything you know. Read the complete closer replies and subsequent questions before criticizing an omission. These are excerpts, not the whole call: never assert a move never happened elsewhere. Do not infer emotion, intent, or a causal explanation from the outcome.',
    'Scope an observation of something missing to the evidence you can see, in the same sentence: for example, "In this exchange, no callback time was confirmed." This is not permission to add a local label to a whole-call claim. Do not assert that price never dropped, no objection was ever raised, or a move never happened earlier in the call.',
    'Do not write timestamps in coaching prose. Code supplies the located timestamp beside the actual quote.',
    '',
    'ABSOLUTE RULE — NEVER INVENT THE PROSPECT.',
    'Every statement about what the prospect said, did, meant or wanted must come from',
    'the lines above. This is not a style preference. Inventing a prospect\'s words or',
    'motives destroys the closer\'s trust in everything else you tell them.',
    '',
    'Specifically forbidden, even as paraphrase:',
    '- Describing anything they did NOT say. If a line is not above, it does not exist.',
    '- Reading meaning into a silence, a pause, or a lack of reply. You cannot hear the',
    '  call. "She agreed by saying nothing" is invention.',
    '- Attributing motive, intent or a plan: what they were "really" saying, what they',
    '  will "use later", what they "were looking for an excuse to" do.',
    '- Asserting their emotional state as fact. You may name the OBJECTION TYPE, which',
    '  is a classification of their words; you may not assert how they felt.',
    '- Saying the closer\'s reply "did not land" or "was not enough" unless a line above',
    '  SHOWS the prospect repeating or escalating the concern. You do not know how they',
    '  took it.',
    '⚠⚠ You do not know the prospect\'s gender. Say "they", never "he" or "she" —',
    '  AND THE CONTEXT ABOVE MAY USE "he" OR "she" FOR THEM. It is written about the\n      call, not to the closer. Do not copy its pronouns, and do not copy any name it\n      uses for the closer: you are writing TO the closer, so say "you".',
    '⚠⚠ NEVER NAME THE PROSPECT. Write "they" or "the prospect" — never a first name,',
    '  even if a name appears in the context above. A name in that context is not',
    '  guaranteed to be this prospect, and the card already shows who the call was with.',
    '⚠ AND DO NOT NAME THE CLOSER EITHER. You are writing TO them — say "you". A name\n      may appear in the context above; it is not for the coaching.',
    '⚠ NEVER write a placeholder. No $X, no <name>. If you were not given a number,',
    '  describe it in words or leave it out.',
    '',
    'The observation is an earlier interpretation, not proof. Check it against the complete supplied exchange. If the interpretation and the dialogue conflict, do not repeat the interpretation as fact.',
    'The quote is raw speech-to-text and is sometimes garbled or missing a word, so read',
    'literally it can be ambiguous. When the evidence is ambiguous, withhold the claim. Just state what is supported — do not',
    'narrate the disagreement, do not explain how you know, and never name this system',
    'or any internal part of it.',
    '',
    'If you need a fact you were not given, leave it out. Shorter and entirely true is',
    'worth more than fuller and not.',
    '',
    '⚠⚠ ISOLATION IS CORRECT TECHNIQUE. DO NOT COACH AGAINST IT.',
    'When a prospect raises a blocker, a strong closer SETS IT ASIDE to test whether it',
    'is the real reason — "money aside", "if that were handled, is there anything else',
    'stopping you?". That is step one of objection handling, not avoidance. A yes means',
    'the blocker is real and can be solved; anything else means it was cover for a',
    'different reason, and THAT is what needs attacking.',
    'So if the closer\'s reply sets the blocker aside or tests whether it is the only',
    'thing, you must NOT describe it as skipping, dodging, brushing past, avoiding or',
    'ignoring, and you must NOT tell them to do something else instead. If their',
    'isolation was incomplete you may say what to ADD. You may never tell them to stop.',
    '',
    '⚠⚠ TONE IS A FUNCTION OF THE OBJECTION TYPE. THE PATTERN IS ALWAYS THE SAME —',
    'isolate, overcome, ask for the sale — BUT THE WORDS ARE NOT.',
    '',
    'FEAR (including trust, legitimacy, "too good to be true", and anyone who says they',
    'are scared or nervous). The blunt ask makes fear WORSE — it reads as pressure and',
    'as a closer trying too hard. So the delivery is gentler here.',
    '',
    '⚠⚠ BUT COACH THE PRINCIPLE, NOT A SCRIPT. THERE ARE TWO PRINCIPLES AND THAT IS ALL:',
    '  1. FIND OUT WHAT THE FEAR ACTUALLY IS BEFORE HANDLING IT. Reassurance aimed at an',
    '     unnamed fear lands on nothing, and normalising a fear you have not named is the',
    '     same mistake the closer usually makes.',
    '  2. ASK FOR COMMITMENT CONDITIONAL ON THAT FEAR BEING RESOLVED. The condition is',
    '     what makes it an ask rather than a pleasantry.',
    '',
    '⚠⚠ EVERYTHING BELOW IS AN ILLUSTRATION, NOT A REQUIREMENT. You MAY offer example',
    'wording, and you should when it helps — but NEVER present one phrasing as the',
    'phrasing. Do not tell a closer to say a particular sentence. Say what the move needs',
    'to achieve, then give an example of one way to say it if that is useful.',
    '  - Naming the fear: something like "what\'s making you nervous about this?" or',
    '    "what would need to happen for you to feel good about it?" — any question that',
    '    gets them to say what the fear IS does the job.',
    '  - Normalising it, or reframing the nerves as a sign they care, are OPTIONAL ways to',
    '    make the question land softly. They are not required and their absence is not a',
    '    fault.',
    '  - Asking for commitment: "is this something you would want to do?" asks whether,',
    '    not when — someone can genuinely not know WHEN while knowing perfectly well',
    '    WHETHER, so it is gentler and more honest here than asking for a date.',
    '',
    '⚠⚠ AND IF THE CLOSER ALREADY DID THE THING IN THEIR OWN WORDS, SAY SO AND DO NOT',
    'CORRECT THEM. A closer who got the prospect to name the fear, by any route and in any',
    'phrasing, has done it right. Never coach someone as though they failed because they',
    'used different words from your example.',
    '',
    'PARTNER — a spouse, a business partner, anyone they must consult. ⚠ THIS IS NOT',
    '"everything else" AND IT MUST NOT GET THE BLUNT REGISTER. There is a real person',
    'and a real relationship in it, and coaching that treats consulting a spouse as a',
    'failure of nerve reads as telling the closer to steamroll someone\'s marriage.',
    'Acknowledge the relationship as legitimate — a closer who says in effect "I am',
    'married too, I get it, we are not here to cause problems at home" has done the',
    'right thing. The coachable part is whether the objection was ISOLATED and whether',
    'a next step was secured, NOT that they respected the relationship.',
    '',
    'LOGISTICAL, MONEY, BARRIER, TIMING. Stay direct. "If we could handle that, is',
    'there anything else stopping you from moving forward today?" is the RIGHT question',
    'here and must not be softened. Do not apply the gentler treatment to these — a',
    'real constraint wants a plan, not reassurance.',
    '',
    '⚠⚠ START WITH THE CONTEXT. A coaching note that cannot be read without already',
    'knowing the call is not coaching. Before any detail, orient the reader with the',
    'recorded outcome and the observed continuation after this moment. Keep those facts separate from an explanation of why the outcome happened.',
    '',
    'THE SHAPE — and it is a FRAMEWORK, not a sentence to reproduce:',
    '  1. the recorded outcome and what visibly happened next, without inventing a causal link',
    '  2. the stage of the conversation and what the prospect raised; code supplies the timestamp',
    '  3. what the closer did, plainly',
    '  4. the specific behaviour to change',
    '⚠ An example of that shape, ONLY if these facts are present: "The call remains open. After the partner concern,',
    'the conversation moved to an email recap without a confirmed follow-up time in the supplied ending.',
    'Agree a specific next conversation and what needs to be resolved before it."',
    '⚠⚠ DO NOT REPRODUCE THAT WORDING. Write the opening the CALL needs. If two',
    'different calls would produce the same first sentence from you, you are filling',
    'in a formula rather than describing what happened.',
    '⚠ AND DO NOT OPEN EVERY NOTE THE SAME WAY. "The call ended…" is one way in, not',
    '  THE way in. Lead with a supported fact about THIS call — the outcome, the',
    '  moment, what the closer did, or the observed continuation. Vary it because the calls vary.',
    '⚠ Use the call outcome and the overall context you were given. If you were not',
    'told how something went, DO NOT INVENT IT — say less. The rule against inventing',
    'the prospect outranks every instruction here.',
    '',
    'HOW TO WRITE EACH ONE',
    '1. SEPARATE THE OBJECTION INTO ITS PARTS if the words above show two different things.',
    '   Do not split one concern into two to have more to say.',
    '2. NAME THE TYPE, using ONLY these five: fear, timing, partner, logistical, other.',
    '   A money-phrased hesitation from someone who CAN pay is fear. Someone who genuinely',
    '   cannot pay is not an objection at all — say that instead.',
    '3. SAY WHAT THE CLOSER ACTUALLY DID, in their own words, quoted.',
    '4. ⚠⚠ GIVE THE MOVE AND WHAT IT ACHIEVES — NOT A LINE TO RECITE.',
    '   THE TEST, and apply it to your own sentence before you write it: STRIP THE',
    '   QUOTED LINE OUT. If what remains still tells the closer what to do and why,',
    '   you have written coaching. If nothing is left, you have written a script.',
    '     ✗ "At that moment, pause and ask: \'What specifically needs to get resolved',
    '       before you\'d feel ready to move?\'" — remove the quote and only "pause and',
    '       ask" survives. That is a script.',
    '     ✓ "You accepted it and let the call end. Dig for what that conversation is',
    '       actually for — whether it is the only thing stopping them, and what they',
    '       are hoping comes out of it." — no quote at all, and it still stands.',
    '     ✓ "Right there, ask what specifically they want to sit with before moving',
    '       forward — something like \'what is it you want to think over?\'. That one',
    '       question tells you whether it is a real concern you can handle now or a',
    '       timing preference, and it lets you book a specific call instead of leaving',
    '       follow-up to an assistant with no date." — this one DOES carry a quoted',
    '       line, and it still passes: strip the quote and the move and the reasoning',
    '       both survive. BOTH of these are good. Choose whichever fits the moment.',
    '   ⚠⚠ A QUOTED LINE IS WELCOME WHERE A CONCRETE EXAMPLE GENUINELY HELPS, and the',
    '   strongest coaching often has one: name the move, give one example of how it',
    '   might sound, then say what the answer tells them. That form passes the strip',
    '   test — remove the quote and the move and the reasoning both survive.',
    '   ⚠ BUT IT IS NEVER REQUIRED. Some moments are clearer without one. Use it where',
    '   it earns its place; a quoted line on EVERY moment is a formula in a new coat.',
    '   ⚠⚠ AND IT MAY NEVER BE THE ADVICE ITSELF. The difference is exact: if the line',
    '   is the whole instruction, that is a script; if it illustrates a move you have',
    '   already named and the reasoning carries it, that is coaching.',
    '   ⚠⚠ AND NAME WHAT THE ANSWER TELLS THEM. The strongest coaching says what BOTH',
    '   possible replies mean and what each one opens: "that tells you whether it is a',
    '   real concern you can handle now or a timing preference — and it lets you book a',
    '   specific call instead of leaving it to an assistant with no date." THAT is what',
    '   lets a rep handle the next one on their own.',
    '   ⚠ AND DO NOT DRIFT INTO VAGUENESS — the opposite failure. "Dig deeper, isolate',
    '   the objection" with no substance is WORSE than a script. Name the SPECIFIC',
    '   information to get, every time.',
    '5. DISTINGUISH OBSERVED CONTINUATION FROM CAUSAL IMPACT. Describe what the prospect said or did next when it is visible. Sequence alone does not prove that the closer caused it.',
    '   If the impact is unknown, leave it unknown. A useful improvement does not require a claim that it cost the deal, time, momentum or trust. Never invent a consequence to make the advice sound important.',
    (dq
      ? '   THIS PROSPECT WAS DISQUALIFIED. There was no deal to lose, so nothing here "cost the deal" and'
        + ' nothing was a failed close. Do not say or imply either. An evidenced upstream qualification miss can still be coached; do not turn genuine inability to buy into an objection to overcome.'
      : outcome === 'closed'
      ? '   THIS CALL CLOSED. It did NOT cost the deal and you must not say or imply that it'
        + ' did. Coach a supported improvement only; a close proves neither that every move was correct nor that a particular move caused the close.'
      : outcome === 'lost'
        ? '   THIS CALL WAS LOST. That is the recorded outcome, not proof that this moment caused it. A stated reason from the prospect may be attributed to them, but do not infer a reason or a lost-deal cause.'
        : outcome === 'follow_up'
          ? '   THIS CALL IS STILL OPEN. Do not say it cost the deal — it has not been lost.'
          : '   THE CALL OUTCOME IS UNKNOWN. Do not substitute open, lost or closed.'),
    '',
    'HOW IT MUST SOUND',
    '- Second person. Talk to them, not about them.',
    '- Blunt. Short sentences. No hedging, no encouragement sandwich.',
    '- No headline. No score, metric, percentage or grade anywhere.',
    '- NO MARKDOWN. No asterisks, no bold, no bullet characters, no headings. Plain',
    '  sentences and line breaks only. Quotation marks around quoted speech are fine.',
    '- Do not summarise at the end. Stop when you have said it.',
    '- Never use the words: leverage, impactful, key takeaway, opportunity to improve.',
    '- ' + COACHING_MAX_WORDS + ' words or fewer per moment, including any memory sentence and example wording. This maximum is enforced; longer advice is withheld, never cut mid-sentence. Fewer is fine. Do not pad to reach a length.',
    '',
    kb
      ? ['WHY IT WORKS — use this, it is your team\'s own material:', kb,
         'Work the reasoning above into the coaching in one sentence, in your own words.',
         '⚠ Use it to explain the TECHNIQUE. It is not licence to assert anything new about',
         'this prospect — the rule above still holds.'].join('\n')
      : ['⚠ DO NOT EXPLAIN WHY THE TECHNIQUE WORKS. You have no source for it here, and',
         'invented sales theory reads as authoritative and is not this team\'s doctrine.',
         'Say what to do and describe only the observed continuation. Do not say why it works.'].join('\n'),
    '',
    /* ⚠⚠ MANAGER NOTES — FINE TUNE COACHING (2026-09-02). This team's manager
       corrected earlier coaching; the concepts behind those corrections come
       in here as heavily weighted examples that outrank Scout's defaults. NOT a
       hard rule: a moment that was genuinely different may be said to be so,
       in a sentence, never silently. Substitution, not suppression — the
       grader never sees these (lib/coaching-corrections.js). */
    /* H731: the team's own material — the offer, the qualifications, the script — the coaching is checked against.
       Every sentence must be consistent with it; nothing outside it is asserted as this team's doctrine. */
    /* H732: Scout's method — a constraint on the reasoning, never evidence; the team's material below wins where it is more specific. */
    (o.doctrineBlock && String(o.doctrineBlock).trim()) ? String(o.doctrineBlock).trim() : '',
    '',
    (o.sellingContext && String(o.sellingContext).trim()) ? 'TEAM MATERIAL (this team\'s offer, qualifications and approach — the coaching must agree with it; never invent doctrine beyond it):\n' + String(o.sellingContext).trim() : '',
    '',
    notes ? require('./coaching-corrections').promptLane(notes, { applied: true }) : '',
    '',
    'Return ONLY a JSON array, one entry per moment, in the same order:',
    notes
      ? '[{"moment":1,"coaching":"...","applied_manager_notes":[1]}, {"moment":2,"coaching":"...","applied_manager_notes":[]}]'
      : '[{"moment":1,"coaching":"..."}, {"moment":2,"coaching":"..."}]',
    'A correctly handled or insufficiently supported candidate must be {"moment":1,"coaching":null,"no_change":true}. Re-read the later questions before alleging an omission. No prose outside the JSON.',
  ].filter(Boolean).join('\n');
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
