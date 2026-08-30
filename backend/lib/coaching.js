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
 * This call does NOT carry the transcript — it works from moments already
 * stored — so it is ~2.5k input tokens against the ~23.7k the grader and the
 * extractor each send.
 *
 * ⚠ IT DRIVES NO SCORE. Coaching text is written to call_highlights.coaching and
 * read by the What Needs Work panel. Nothing aggregates it.
 */

var CLAUDE_COACHING_MODEL = 'claude-sonnet-4-6';
var COACHING_MAX_TOKENS   = 2000;

/* Coach only the moments a surface actually renders. The What Needs Work panel
   shows the `bad` group, which is where all four approved samples came from.
   Coaching moments nobody renders is spend with no consumer. */
var COACHABLE_TYPES = ['objection', 'risk_signal', 'barrier', 'missed_opportunity', 'disqualify_signal'];

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
      : 'The closer did not reply to this.'),
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
  var outcome = o.outcome || 'unknown';

  return [
    'You are coaching a high-ticket closer on moments from their own sales call.',
    'You are their sales manager. You have watched the call.',
    '',
    'Call outcome: ' + outcome + '.',
    (o.later ? 'What happened on the call overall: ' + o.later : ''),
    /* ⚠ How objection handling went ACROSS the call — Justin: "the context behind
       what was said is vital". It is the grader's own objection_notes, so it is
       real rather than inferred; absent when the grader wrote none. */
    (o.objectionNotes ? 'How objection handling went across the whole call: ' + o.objectionNotes : ''),
    '',
    'There are ' + moments.length + ' moments below. Coach each one separately.',
    '',
    moments.map(momentBlock).join('\n\n'),
    '',
    '⚠⚠ WHAT YOU KNOW ABOUT THE PROSPECT — AND IT IS ONLY THIS',
    'The lines given for each moment, plus the call outcome, are EVERYTHING you know',
    'about this prospect. You have not seen the transcript. You do not know what they',
    'said before or after, how they sounded, whether they paused, what they were',
    'thinking, or what they intended to do next.',
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
    '⚠ THE OBSERVATION IS THE VERIFIED READING OF A MOMENT AND IT OUTRANKS THE QUOTE.',
    'The quote is raw speech-to-text and is sometimes garbled or missing a word, so read',
    'literally it can say the OPPOSITE of what the prospect meant. Where the two',
    'disagree, the observation is what happened. ⚠⚠ Just state what happened — do not',
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
    'knowing the call is not coaching. Before any detail, the reader must know WHERE',
    'THEY ARE: how the call ended and what drove it. Then the moment.',
    '',
    'THE SHAPE — and it is a FRAMEWORK, not a sentence to reproduce:',
    '  1. the outcome AND its cause, in one sentence',
    '  2. when it happened and what the prospect raised',
    '  3. what the closer did, plainly',
    '  4. the specific behaviour to change',
    '⚠ An example of that shape, NOT a template to copy: "This call didn\'t close',
    'because of a spousal objection. At 00:47 she brings it up and you never attempt',
    'to handle it — you asked if he would be supportive and let her off the hook."',
    '⚠⚠ DO NOT REPRODUCE THAT WORDING. Write the opening the CALL needs. If two',
    'different calls would produce the same first sentence from you, you are filling',
    'in a formula rather than describing what happened.',
    '⚠ AND DO NOT OPEN EVERY NOTE THE SAME WAY. "The call ended…" is one way in, not',
    '  THE way in. Lead with whatever actually explains THIS call — the outcome, the',
    '  moment, what the closer did, or what it cost. Vary it because the calls vary.',
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
    '4. GIVE THE SEQUENCE, not a single line — what to do first, then next.',
    '5. STATE THE COST plainly — AND IT MUST MATCH THE CALL OUTCOME ABOVE.',
    (outcome === 'closed'
      ? '   THIS CALL CLOSED. It did NOT cost the deal and you must not say or imply that it'
        + ' did. The cost is what it made harder, slower or left unresolved — or there may be'
        + ' no cost at all, in which case say what to do next time and stop. Do not invent a'
        + ' consequence to have one.'
      : outcome === 'lost'
        ? '   THIS CALL WAS LOST. You may say it likely cost the deal. You may NOT say WHY they'
          + ' left or what they did after the call unless you were told above.'
        : '   THIS CALL IS STILL OPEN. Do not say it cost the deal — it has not been lost.'),
    '',
    'HOW IT MUST SOUND',
    '- Second person. Talk to them, not about them.',
    '- Blunt. Short sentences. No hedging, no encouragement sandwich.',
    '- No headline. No score, metric, percentage or grade anywhere.',
    '- NO MARKDOWN. No asterisks, no bold, no bullet characters, no headings. Plain',
    '  sentences and line breaks only. Quotation marks around quoted speech are fine.',
    '- Do not summarise at the end. Stop when you have said it.',
    '- Never use the words: leverage, impactful, key takeaway, opportunity to improve.',
    '- 90 words or fewer per moment. Fewer is fine. Do not pad to reach a length.',
    '',
    kb
      ? ['WHY IT WORKS — use this, it is your team\'s own material:', kb,
         'Work the reasoning above into the coaching in one sentence, in your own words.',
         '⚠ Use it to explain the TECHNIQUE. It is not licence to assert anything new about',
         'this prospect — the rule above still holds.'].join('\n')
      : ['⚠ DO NOT EXPLAIN WHY THE TECHNIQUE WORKS. You have no source for it here, and',
         'invented sales theory reads as authoritative and is not this team\'s doctrine.',
         'Say what to do and what it cost. Do not say why it works.'].join('\n'),
    '',
    'Return ONLY a JSON array, one entry per moment, in the same order:',
    '[{"moment":1,"coaching":"..."}, {"moment":2,"coaching":"..."}]',
    'No prose outside the JSON.',
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

module.exports = {
  CLAUDE_COACHING_MODEL: CLAUDE_COACHING_MODEL,
  COACHING_MAX_TOKENS:   COACHING_MAX_TOKENS,
  COACHABLE_TYPES:       COACHABLE_TYPES,
  selectCoachableMoments: selectCoachableMoments,
  buildCoachingPrompt:   buildCoachingPrompt,
  toMoment:              toMoment,
  hms:                   hms,
};
