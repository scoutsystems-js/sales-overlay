/**
 * Analysis Worker — Scout v2.0 Phase 2
 *
 * Picks up one fathom_calls row at a time and produces the structured coaching
 * output the dashboard's Call Review page renders: a row in call_analyses
 * (overall summary + 5 section grades + one-thing + follow-up email) plus 5-8
 * rows in call_highlights (timestamped moments).
 *
 * Trigger: fire-and-forget IIFE in routes/fathom.js after /sync upserts new
 * rows. Sequential per-user dispatch (not parallel) — Anthropic rate limits +
 * predictable ordering in the dashboard. Closers never wait; the /sync
 * response has already been sent by the time the worker runs.
 *
 * Pipeline (per call):
 *   1. Atomically claim the run (claimAnalysisRun: conditional UPDATE to
 *      status='processing', or INSERT arbitrated by the fathom_call_id unique
 *      index). A run that loses the claim exits as a quiet no-op — overlapping
 *      dispatches can no longer double-analyze a call.
 *   2. Load the fathom_calls row → fathom_call_id (Fathom's recording_id) + call_date
 *   3. Load fathom_connections, refresh access token if needed
 *   4. Fetch the meeting (transcript + highlights inline) by paginating
 *      /meetings with created_after = call_date - 10min, walking up to
 *      MAX_SEARCH_PAGES pages looking for matching recording_id
 *   5. Normalize via transcript-normalizer (HH:MM:SS + numeric → numeric seconds,
 *      CLOSER/PROSPECT speaker identification)
 *   6. Two parallel Claude calls (section grader + highlight extractor)
 *   7. Persist: upsert call_analyses with all fields; delete + insert call_highlights
 *   8. Mark fathom_calls.sync_status='processed' (Phase 2 worker's job per migration 009)
 *
 * Error handling: any phase failure marks call_analyses.status='error' with
 * the reason in overall_summary, then returns. Caller (the /sync IIFE) logs
 * but does not propagate — analysis failures never block sync completion.
 *
 * JSON parsing: all Claude output goes through extractFirstJsonObject /
 * extractFirstJsonArray (brace-balanced + bracket-balanced walks). Verbatim
 * port from routes/me.js after v1.1.10 backfill found JSON.parse() failing
 * 100% of the time when Claude wrapped JSON in narrative prose.
 *
 * Section grader does NOT yet consume the closer's uploaded script as a
 * benchmark or KB winning-call comparisons — deferred to a follow-up commit
 * per the brief. Foundational pipeline first; KB-grounded grading second.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { CLAUDE_MODEL } = require('../config');
const { normalizeTranscript } = require('./transcript-normalizer');
const { storeCallIdentities } = require('./prospect-identity');   // H700
const { chooseLink, attachProspect } = require('./prospect-link');   // H705: the linking policy
const { deriveCallKind, setCallKindAuto, earlierCallsFor } = require('./call-kind');   // H706: the follow-up flag
const compromisedFile = require('./compromised-file');
const { fetchSellingContext } = require('./selling-context');
const { shouldHarvest, harvestClosedCall } = require('./kb-harvest');
const coachingLib = require('./coaching');
const { withDiscoveryAreas } = require('./discovery-areas');
const { resolveProspectName } = require('./prospect-name');
const { findPriceMomentByFraming } = require('./price-moment');
const { createWithUsage, setUsageRecorder } = require('./model-usage');
const { nameKey } = require('./prospect-entity');
const { effectiveCloseScore } = require('./outcome-tag');
const fathomRoutes = require('../routes/fathom');
// Zoom source (sub-stage 2). Token via the unified call_connections store (its
// serialized single-flight refresh is a correctness requirement for Zoom's
// single-use refresh tokens — never bypass it); transcript via the VTT adapter.
const callConnections = require('./call-connections');
const zoomClient = require('./zoom-client');
const { parseVttToTranscript } = require('./vtt-adapter');
const zoomRetry = require('./zoom-retry');
const fathomRetry = require('./fathom-retry');
const modelRetry = require('./model-retry');
const highlightFailure = require('./highlight-failure');
const closerVoice = require('./closer-voice');
// v29: the closer_response sentinels (__no_reply__ / __moment_is_closer__) —
// one definition shared by the prompt, the sanitizer and the quote verifier.
const closerSide = require('./closer-side');
// v26: the derived voice PROFILE + outcome-scaled form constraints. Replaces
// feeding exemplar lines — see lib/voice-profile for why lines were the wrong
// medium. closer-voice is still used for its line CLEANLINESS filter.
const voiceProfile = require('./voice-profile');
// Section tagging for highlights (Call Review Context, Part 1a).
const { sanitizeSectionValue } = require('./highlight-section');
const { sanitizeObjectionClass } = require('./objection-strict');
// 6a: independent quote→speaker attribution (refuses rather than guesses).
const { labelForQuote, locateQuoteSpeaker } = require('./quote-locate');
// 7c: the rep's own discovery areas (cached on their material hash).
const { getAreasForUser } = require('./coaching-areas');
// The per-criterion qualification check (2026-08-26) — the comparison that
// qualification_covered never made.
const qualCheck = require('./qualification-check');

// Which transcript path a call takes. 'zoom' → Zoom (call_connections + VTT);
// anything else (fathom / null / legacy pre-source rows) → Fathom, unchanged.
// PURE — the analyzeCall branch keys on this so the decision is unit-testable.
function transcriptSourceFor(callRow) {
  return (callRow && callRow.source === 'zoom') ? 'zoom' : 'fathom';
}

// ─── Schema-locked vocabularies (mirror migration 010 CHECK constraints) ────
const VALID_GRADES = ['A', 'B', 'C', 'D', 'F'];
// v17 — the overloaded 'objection' type split three ways (Justin's ruling).
// "A true objection only happens after you drop price and ask for the close."
// Everything earlier that was swept into 'objection' is now either an
// attitudinal risk_signal or a concrete barrier. Migration 038 widened the
// CHECK; existing rows keep the broad meaning.
const VALID_HIGHLIGHT_TYPES = [
  'buying_signal',
  'objection',
  'risk_signal',
  'barrier',
  'missed_opportunity',
  'strong_moment',
  'rapport_moment',
  'disqualify_signal',
];
const VALID_HIGHLIGHT_SPEAKERS = ['CLOSER', 'PROSPECT'];
// Objection sub-categories (migration 012). Only set on type='objection' rows.
const VALID_OBJECTION_CATEGORIES = require('./objection-categories').STORED_OBJECTION_CATEGORIES;   /* ⚠ ONE SOURCE (fix #7, H680): the ruled set in its stored order — never a literal copy here (sweep ③-3) */
// Objection resolution (migration 013). Grounds the coaching synthesis.
const VALID_RESOLUTIONS = ['handled', 'partial', 'unhandled'];
// 8a — did the closer engage with a risk_signal/barrier, or move past it?
// 'deflected' is the value that earns this field: no transcript heuristic can
// see it, because a deflection is often long, warm and sympathetic.
const VALID_HANDLING = ['addressed', 'deflected', 'ignored'];
// Deal outcome inferred by the section grader (migration 012).
const VALID_OUTCOMES = ['closed', 'follow_up', 'lost', 'no_show'];
/* H708 — the classifier field's closed sets. An unknown verdict is NULL (not stored as
   a guess); an unknown class is kept as text so a drift in the model's vocabulary is
   visible in review rather than silently folded. */
const SALES_CALL_VERDICTS = ['sales', 'not_sales', 'unsure'];
const SALES_CALL_REASON_CLASSES = ['no_prospect_internal_staff', 'training_or_roleplay', 'reviewing_a_recorded_call', 'recording_stub', 'prospect_logistics_only', 'prospect_pitch_or_price', 'prospect_discovery_only', 'cannot_tell'];
function salesCallVerdict(parsed) {
  var p = parsed || {};
  var v = (typeof p.sales_call_verdict === 'string') ? p.sales_call_verdict.trim().toLowerCase() : null;
  return {
    verdict:      SALES_CALL_VERDICTS.indexOf(v) === -1 ? null : v,
    reason_class: (typeof p.sales_call_reason_class === 'string' && p.sales_call_reason_class.trim()) ? p.sales_call_reason_class.trim().toLowerCase().slice(0, 60) : null,
    reason:       (typeof p.sales_call_reason === 'string' && p.sales_call_reason.trim()) ? p.sales_call_reason.trim().slice(0, 400) : null,
  };
}
// Payment structures (migration 022). Closed calls only — the worker forces
// 'none_stated' for every other outcome.
const VALID_PAYMENT_STRUCTURES = require('./sales-constants').PAYMENT_STRUCTURES;
// Analysis prompt version (migration 014) — BUMP MANUALLY whenever the grader or
// highlight-extractor prompts change. Stamped on every call_analyses row so a
// stale-prompt analysis is one query away (the guard for the Issue-1 class of
// bug). v2 = outcome inference + objection category/resolution/closer_response/surface.
// v3 = grader scale re-calibration (anchored bands + high-ticket domain context;
//      a typical solid call lands 65-80/section — no longer graded vs a perfect ideal).
// v7 = (a) cash_collected extraction — explicit-only, zero-default, never inferred;
//      (b) follow_up_email greeting contract — transcript-established name only,
//      omitted entirely when unclear (fixes title-vs-attendee greeting bugs).
// v8 = (a) cash extraction hunts transaction evidence (card runs, deposits,
//      charge confirmations, BNPL approvals, plan first-payments) with
//      per-structure cash rules; (b) payment_structure field (closed-only);
//      (c) eod_summary — first-person closer-voice EOD report summary
//      (coaching's overall_summary untouched). Never-fabricate unchanged.
const ANALYSIS_PROMPT_VERSION = 'v38-2026-09-03'; // v38 (H708: the three-state sales_call_verdict + reason on the grader, stored for review only). Was v37: // v37 (CACHE THE OBJECTION CLASS ON THE MOMENT — Justin's ruling: "go the cached route for objections"). ⚠ v36 IS DELIBERATELY SKIPPED: that number was used by the want-first DQ correction, which was built, measured and ABANDONED before it ever shipped (patch kept unpushed). Reusing it would make two different things share a version stamp. ⚠⚠ THE DEFECT: objection handling % meant TWO things on SIX surfaces. `lib/objection-handled.js` centralised the NUMERATOR — one definition, ten callers — and NOBODY centralised the DENOMINATOR, so the gauge, rep cards and manager graph counted EVERY objection moment while the per-closer grid and focus panel counted TRUE objections only. Measured on one rep: 20% (35/177) loose vs 17% (26/155) strict — two numbers under one name. A shared numerator with an unshared denominator LOOKS solved and is not. ⚠⚠ THE CHEAP PATH WAS CHECKED FIRST AND FAILED, WHICH IS WHY THIS EXISTS. Scout already types every moment (v17 split objection/risk_signal/barrier, v27/v35 route DQs to disqualify_signal), so the hope was that type='objection' already means true objection. Measured on 813 live moments ALREADY typed objection: 589 true_objection, 129 disqualification, 66 logistical_barrier — 24% are not true objections. AND `objection_category` cannot predict it (the disqualifications come from fear 81, timing 21, logistical 21, partner 6). No derivation exists; the classification is genuinely needed. ⚠ SO IT IS ASKED ONCE, HERE, AT ANALYSIS TIME — an EXTRACTOR FIELD, not a second model call. The alternative (running the period classifier per surface) is a ~20s non-deterministic LLM call behind a gauge. ⚠ ADDITIVE — no scoring prompt touched, no score moves, so NO DELTA GATE (the v10 precedent). Extractor token gate: worst measured 1408/3000 with ~1592 spare. ⚠⚠ GOING FORWARD ONLY, AND THE CROSSOVER IS A DESIGNED STATE, NOT A BUG: nothing re-analyses, so pre-v37 moments carry NULL and the readers COUNT them — the loose behaviour that already existed. The number degrades in the direction it already had rather than into a third thing, and the population corrects itself as calls turn over. // v35 (THE DQ ROUTING — THE BOUNDARY NOW ASKS TWO QUESTIONS IN ORDER): TEST 1 is DO THEY WANT IT AT ALL, and only if they do does TEST 2 ask the v27 ability question (the three-way boundary itself is UNCHANGED). ⚠⚠ THE CAUSE, AS A MECHANISM: the v27 test asked ONE question — can they buy if they decide to — so a prospect who CAN buy and simply does not WANT it answered yes and landed in `fear` BY CONSTRUCTION, and `disqualify_signal` was defined as no budget / no authority / wrong stage, NOT no need. ⚠⚠ THE DISCRIMINATOR IS A STATED REASON THE OFFER DOES NOT APPLY — NOT THE WORDS \"I don't need it\", which both kinds of prospect say. A bare \"do I really need this?\" from an engaged prospect is a STALL WEARING A NO-NEED COSTUME and stays `fear`; the prompt carries both worked examples and defaults to the objection when no reason can be pointed at. ⚠⚠ BOTH CHECKS RUN BEFORE PUSHING, AND THE CONTROL ARM IS WHAT MADE THEM MEAN ANYTHING. ① SHAPE on an ADVERSARIAL sample (10 calls selected BECAUSE they carry no-need language — 6x the corpus DQ rate, deliberately over-representing the phenomenon): disqualify_signal 5 → 5, objection 10 → 10. `fear` did NOT drain, which was the named red flag. ② EVERY FLIP READ: exactly ONE objection→DQ, and re-running THAT call 3x PER ARM shows the OLD rule produces the same disqualify_signal at the SAME 1-in-3 rate — so it is run-to-run variance on a borderline moment, NOT attributable to this change. ⚠ AND A FIRST, NON-ADVERSARIAL SAMPLE OF 8 CALLS FOUND ZERO DQ IN EITHER ARM — the minimum-sample failure, reported rather than read as a clean pass: at a 1.2% corpus DQ rate a 52-moment sample expects 0.6, so it could not have detected anything. Selecting for the phenomenon is what made the check real. ⚠ EXPECT A SMALLER EFFECT THAN THE DESIGN SUGGESTS: the canonical example (\"I have a company making $3 million a year, so I don't need this headache\") is ALREADY stored as disqualify_signal under the OLD rules, so v27 was catching a good share of these already. ⚠⚠ SEPARATE, PRE-EXISTING, FILED NOT FIXED — THE RULE DOES NOT ASK WHOSE REASON IT IS. On call 5f6a7052 the prospect says \"It makes sense for me. Yes. I need it\" and sixteen turns later defers to the CLOSER'S framing (\"if YOU think it would be a waste of time... I will have to agree with you because you know your program better than I do\"), the closer answers \"Okay, cool\", and the prospect leaves. That is a closer talking a buyer out of it, and BOTH rules can read it as a disqualification, i.e. nothing the closer could have done. Requiring the reason to be the PROSPECT'S OWN is a design change to an approved design and is Justin's ruling, not mine. ⚠ NEW CALLS ONLY — nothing re-grades; the outdated count is COSMETIC. The handle rate WILL drift UP as the corpus turns over (drift note at lib/tile-metrics.js objectionHandleRate, cross-referencing the v17 taxonomy note). ⚠ NO OUTPUT-TOKEN GATE NEEDED: input text plus a redirect between two EXISTING types — no field added, output shape byte-identical, so the measured extractor worst case (908/3000) is unmoved. // v34 (TWO SMALL DEFECTS, BOTH CUSTOMER-VISIBLE, BOTH FILED FOR DAYS): (a) `why_outcome` MUST NOT NAME THE PROSPECT. It had no name contract while `prospect_name` does, and on a live call it used a name appearing ONCE in 911 turns — in the CLOSER'S SIGN-OFF — while the call was with two other people, so the card rendered one name in its attribution and a different one in the prose beneath. ⚠ THE FIX IS TO FORBID NAMING, NOT TO ADD A SECOND NAME RULE: two rules that can disagree is the defect itself, and every surface rendering this already shows who the call was with. (b) THE OBSERVATION MAY REFERENCE A TIMESTAMP AND NEVER SAID IN WHAT FORM, so the model emitted a RAW SECONDS VALUE into customer-visible text — *"Objection at 3598 remained unresolved"*. Now pinned to [HH:MM:SS], with that exact string named in the prompt as the thing it produces. ⚠ ADDITIVE — no scoring prompt touched, no score moves, so NO DELTA GATE (the v10 precedent). The outdated count is COSMETIC under new-calls-only; do NOT mass re-analyze. // v33 (THE SIX DISCOVERY ITEMS): PAIN · GOALS · CURRENT_SITUATION · DECISION_MAKERS · WHY_NOW · FINANCIAL_RESOURCES are now FIXED areas in the EXISTING `coverage` block, present on every call for every rep. ⚠⚠ NOT A SEVENTH FIELD, DELIBERATELY. `coverage` already carried every requirement word for word — per area, established BY ANY conversational route, evidence copied VERBATIM as a contiguous run from ONE transcript line, NULL rather than a guess, verified at write time by quote-locate, and explicitly barred from influencing any score. A parallel field would have been two things answering one question. ⚠⚠ THE CONTRACT WAS RIGHT AND THE POPULATION WAS WRONG: coverage areas are DERIVED PER REP and exactly ONE rep of eight has any — 537 of 537 calls on one account, ZERO on the other seven. Fixed areas take it from one user to all eight. ⚠ FIXED SIX **PLUS** DERIVED, never instead: `what_mattered` RANKS the derived areas, so dropping them would break a working feature. The six lead, so a colliding derived key loses and the STABLE key wins. ⚠ AND IT CLOSES A HAZARD INDEPENDENTLY OF THE CHECKLIST: derived area keys are NON-DETERMINISTIC and drift between derivations, orphaning anything joined to them. A fixed key cannot drift. ⚠ PAIN CARRIES THE LOGICAL-SALE CAVEAT — some offers are bought on logic and pain is legitimately absent, so absent pain is covered:false and NOT a failure; nothing downstream may read it as one. ⚠⚠ ADDITIVE, SO NO DELTA GATE — the coverage block is explicitly barred from influencing any section score, grade or overall, the same reasoning that let v10 ship. The outdated count is COSMETIC under new-calls-only; do NOT mass re-analyze. ⚠ TOKEN GATE RUN FIRST on the six LONGEST calls (2776-2069 turns) at the TRUE worst case of six fixed PLUS six derived: worst output 3426/4500 (76%), 0 unparseable, ~1074 spare against a recorded 3211 baseline. The +215 is inside the ~300-token run-to-run variance, so treat it as approximate rather than a marginal cost. ⚠ ONE UNAVOIDABLE CONSUMPTION, STATED RATHER THAN GLOSSED: `what_mattered` validates its pick against the SAME area list, so its candidate set necessarily grows. Scoping it to derived-only would be WORSE, not safer — the model would see twelve areas and have picks from six of them REJECTED, lowering its hit rate. Both consumers get the merged list. ⚠ CAPTURE ONLY otherwise. Nothing else reads the six yet: store, then read, then decide. // v32 (THE DISCOVERY CRITERION): adds GOALS and CURRENT SITUATION, which were not looked for AT ALL, and puts a LOGICAL-SALE CAVEAT on PAIN, which was mandatory. Justin's six: PAIN (caveated) · GOALS · CURRENT SITUATION · DECISION MAKERS · WHY NOW · FINANCIAL RESOURCES. The other four were already there in some form; FINANCIAL RESOURCES only partially, as a dollar/timeline COMMITMENT rather than capacity to pay. ⚠ PAIN IS A RELATION, NOT A FEELING — it exists when the CURRENT SITUATION does not align with the GOALS, which is why those two make it legible. And discovery succeeds when it establishes enough to CLOSE **or DISQUALIFY** — both outcomes are correct. ⚠⚠ SHIPPED OVER A TRIPPED GATE, KNOWINGLY, AND THE TRADE IS RECORDED RATHER THAN GLOSSED. The gate's ONE real signal was an OUTCOME FLIP on sample 'Deep' (14 Jun): six runs per arm, the OLD criterion returned follow_up 6/6 and never once lost, the NEW one returned lost 2/6 — ATTRIBUTABLE, NOT NOISE. Justin has that number and shipped anyway. **DO NOT READ A follow_up->lost SHIFT AS AN UNNOTICED REGRESSION; it is a predicted, accepted consequence.** ⚠ THE SCORE DELTAS (+3/0/+3) MEASURE NOTHING — overall-score drift between rounds on byte-identical input is ~6 points, so they are inside the noise. And the PAIN caveat was NEVER EXERCISED by the gate: none of the three samples is a logical sale. Justin's reasoning for shipping regardless: he is unsure this offer has ANY logical sales, so waiting for that sample is waiting for a case that may never occur. ⚠ WATCH: baseline lost:follow_up = 0.137 (lost 9.5%, follow_up 69.1%) on the 1,000 most recently analysed real calls, captured immediately pre-ship. A rate materially above that is the predicted consequence arriving — STOP AND REPORT, do not tune it back. ⚠ NEW CALLS ONLY. This one DOES move scores by design, so unlike v30/v31 it is not merely cosmetic — but nothing re-grades. // v31 (COACHING IS STRATEGIC, NOT SCRIPTED): the coaching prompt's "give the actual words to say" rule is REMOVED. Justin's reason is TRUST, not style — "if it doesn't line up with something that closer would say, they're going to start trusting it less and less" — which makes a scripted note a CHURN mechanism. THE TEST IS MECHANICAL AND LIVES IN THE PROMPT: strip the quoted line out; if the advice still stands it is coaching, if nothing is left it was a script. A quoted line is WELCOME where a concrete example helps and is NEVER REQUIRED, but it may never BE the advice. ⚠ ALSO REQUIRED NOW: name what the answer tells them — BOTH possible replies and what each one opens. That is what lets a rep handle the NEXT one alone rather than the next identical one. ⚠ AND THE OPPOSITE FAILURE IS GUARDED: directional decaying into vague. "Dig deeper, isolate the objection" with no substance is WORSE than a script, so the specific information to get must be named. ⚠⚠ MEASURED AND REPORTED RATHER THAN TUNED: across 4 samples the model produces the no-quote shape EVERY time, including on a think-about-it moment where an illustration obviously fits. Explicit permission AND a worked exemplar both failed to change it. A third attempt would be tuning until the output matches a target — Justin rules on whether to force it. ⚠ ADDITIVE to the grader: no scoring prompt is touched, so NO DELTA GATE; the outdated count is COSMETIC under new-calls-only. Do NOT mass re-analyze. // v30 (PER-MOMENT COACHING): a THIRD model call writes coaching to call_highlights.coaching (migration 055). ⚠⚠ ONE CALL PER CALL, COVERING ALL ITS MOMENTS — never one per moment; calls average 5.7 coachable moments, so per-moment would be a 5.7x error. It carries NO TRANSCRIPT (it works from the moments just persisted), so it is ~2.5k input tokens against the ~23.7k the grader and extractor each send — about 5% on top of what an analysis already does. ⚠ ADDITIVE: no existing prompt is touched and no score moves, so NO DELTA GATE — the same reasoning that let v10 ship. The outdated count this bump produces is COSMETIC under new-calls-only; do NOT mass re-analyze. ⚠⚠ THE VOICE WAS SETTLED BY JUSTIN READING REAL OUTPUT, NOT BY A MEASUREMENT, and twice a shipping decision was corrected by nuance no check could catch: Scout coached a rep OUT of isolating ("money aside" read as skipping), and the fear tone was too aggressive. Both outputs passed every mechanical audit. THE RULES THAT CAME OUT OF IT: never invent the prospect (it covers PARAPHRASE — "she said yes with her silence" is not a quote and is banned); never name the prospect (why_outcome named the wrong person on a live call); the observation OUTRANKS the raw ASR quote; isolation is correct technique and must never be coached against; tone is a function of objection type (fear gentler, logistical direct, and flattening everything is the failure mode); and COACHING IS PRINCIPLES, NOT WORD TRACKS — a rep coached to say exact words is a rep reading a teleprompter. ⚠ The opening line is ASSEMBLED IN CODE and prepended, never asked for: it dropped twice as an instruction, and it is pure field assembly with no judgement in it. // v29 (BOTH SIDES OF EVERY MOMENT): closer_response is now asked for on EVERY citable type, not just objection/risk_signal/barrier. THE MEASURED CAUSE OF THE COACHING-EVIDENCE FAULT: of 8,238 real moments only those three carried a reply (98/94/97%) while buying_signal 0/2428, strong_moment 0/929, missed_opportunity 0/909, rapport_moment 0/154 and disqualify_signal 0/116 carried none — 55% of moments had no closer side at all. So when the synthesis claims something about the CLOSER it can only quote what the PROSPECT said; measured at 69% of what-to-improve evidence citing the wrong person. The model was never misbehaving, it could not quote the thing it was talking about — which is also why the v1 evidence RULE made it WORSE (67%→75%): forbidding a positive quote does not create a closer line, it pushes the model to a weaker claim. ⚠⚠ A DERIVED BACKFILL WAS TRIED FIRST AND FAILED, MEASURED TWICE: taking the next closer turn from the stored transcript agreed with the model's own reply on only 16% of 846 ground-truth cases, and even a 180-second window contained it just 52% of the time at a cost of 25 turns per moment. The reply is NOT recoverable from timestamp+transcript, so this had to be a grading-time change. ⚠⚠ CONSEQUENCE, STATED: 4,692 moments across 1,331 already-graded calls keep one side, and NO FIX REACHES THEM without a re-grade. Cost and count are in the findings; Justin rules. Do NOT mass re-analyze. // v28 (PER-CRITERION QUALIFICATION CHECK): the grader now COMPARES what the prospect said against the rep's own criteria, per criterion. The gap it closes: `qualification_covered` already stored the disclosure VERBATIM and the criteria already reached the grader through SELLING CONTEXT, and NOTHING JOINED THEM — on the motivating call the stored evidence was a credit score of "about 60 or something like that" against a stated bar of 640, and the call was graded follow_up with a timing objection. That field answers "was the topic covered", never "did the prospect pass". ⚠⚠ THREE VERDICTS, AND `undetermined` IS EXPECTED TO BE THE COMMON ONE — the prompt tells the model to use it freely. Two of Josh's three criteria are numeric bars; "not living paycheck to paycheck" is a JUDGEMENT with no threshold, and forcing a verdict on it would manufacture one. A guessed "failed" writes off a real buyer. ⚠⚠ VERIFIED AT WRITE TIME AND STRICTER THAN COVERAGE: a decided verdict must rest on the PROSPECT'S OWN WORDS. Measured on 349 real calls, 82% of stored qualification evidence reconstructs but 55 of those 286 are the CLOSER speaking ("Your credit, is your credit shot?") — deciding on those would let a closer's own question disqualify a buyer. The downgrade is ONE-WAY: an unprovable quote turns a decided verdict into `undetermined` and withholds the quote, and nothing can ever turn anything INTO `failed`. ⚠ ONE NOTION OF A DQ, NOT TWO: a failed criterion IS the financial disqualification v27 defined, fed into the EXISTING outcome rule (a DQ the closer accepts and does not overcome is `lost`). No server-side forcing of outcome. ⚠ CRITERIA ARE FREE TEXT PER COMPANY (`user_profiles.qualifications`) — nothing hardcodes a threshold, and 640 is Josh's bar, not Scout's. Only 1 of 8 live profiles has any, so the block is ABSENT and the prompt BYTE-IDENTICAL for everyone else, the same shape as the coverage map. ⚠ Marks prior analyses outdated as every bump does — COSMETIC under new-calls-only. Do not mass re-analyze. // v27 (JUSTIN'S OBJECTION BOUNDARY): the extractor was told the OPPOSITE of the ruling — its own words were that money-phrased objections "are nearly always the fear category ... UNLESS the transcript shows a genuine logistical payment constraint", which leaves a prospect who genuinely CANNOT AFFORD IT classified as a coachable fear objection. Justin's boundary is three-way and turns on ONE question, CAN THEY BUY IF THEY DECIDE TO: cannot afford = FINANCIAL DISQUALIFICATION (not an objection at all, not coachable, nothing the closer could have done); externally blocked = logistical; able but hesitant = fear; must consult anyone = partner. ⚠ THE DQ CARVE-OUT REUSES EXISTING MACHINERY rather than adding a value — disqualify_signal is ALREADY a valid highlight type, so the fix is telling the model which door to use, and no migration or new enum is involved. ⚠ THE EXCUSE IS NOT THE CLASSIFICATION: wanting proof, questioning legitimacy, needing to check with someone or wanting to think it over are FEAR when the prospect can afford it — prospects never say "I am scared". ⚠ NO OUTPUT-TOKEN GATE NEEDED: this is INPUT text plus a redirect between two EXISTING types; the output shape is byte-identical, no field is added, so the measured extractor worst case (908/3000) is unmoved. ⚠⚠ COST OF THE BUMP, STATED RATHER THAN DISCOVERED: it marks every prior analysis outdated, so the grading control will offer a large re-grade. Per the standing new-calls-only ruling that count is COSMETIC — do NOT click it, and do NOT mass re-analyze. Already-graded calls keep their old classifications by design. // v26 (VOICE PROFILE replaces exemplar lines, + outcome-scaled FORM constraints): v24 fed the model 15 of the closer's real spoken lines and the email still read as generated — every word plausible, the SHAPE wrong. LINES INVITE IMITATION, and what gets imitated is SPOKEN register: Josh talks in fragments and interrupts himself, which is bad writing. What survives a change of medium is a PROPERTY, not a phrasing — so the block now carries measured sentence length + variance, contraction rate, directness and question tendency, derived by ARITHMETIC over the stored lines with ZERO model calls. ⚠ SPLIT-HALF TESTED ON THE REAL CORPUS BEFORE SHIPPING (n=57 vs 57): sentence length drifts 1%, contraction 10%, question rate 17%, and HEDGE RATE 100% (0 vs 0.05) — so the hedge RATE is never printed while its THRESHOLDED VERDICT is, because the verdict is stable either side. A statistic can be too noisy to quote and still strong enough to classify. ⚠ characteristic_openings is emitted as an explicit NOT MEASURABLE entry: filter 1 rejects leading filler and lowercase starts, which is exactly where openings live, so the corpus is biased against that property BY CONSTRUCTION. Named rather than approximated; do NOT loosen filter 1 to recover it. ⚠⚠ FORM CONSTRAINTS ARE THE STRONGER HALF and scale with the outcome — closed 120 words, follow_up 90, lost 40, no_show 30 — because the sharpest generated-text tell measured so far is EFFORT: v24 handed a three-item diligence checklist to a prospect who had just refused to buy. Nobody types 180 careful words to a no. ALL FOUR ceilings are given and the model applies the one matching the outcome it assigns IN THE SAME JSON, because the outcome is not knowable when the prompt is built — the grader is what determines it. Self-consistent by construction; the server-side gate still checks against the ACTUAL outcome after the fact. // v25 (three follow_up_email DEFECT fixes — NOT the tone work, which is held pending a ruling): (1) NO-PROSPECT BRANCH. v24 put a GREETING on a call with no prospect in it ("Hey — no prospect on this one"), in a field the UI renders with a copy button. ⚠ THE CAUSE WAS NOT THE v24 COPY SOFTENING, which is what I first reported: the greeting rule SUPPLIES that exact shape as its worked example for a no-name call, and nothing anywhere distinguished "no name established" from "no prospect at all". The case was left to chance and different versions improvised differently — v23 wrote a flat sentence, v24 followed the example. Fixed with a FIXED STRING, not a tone instruction, because a downstream reader must be able to recognise it. (2) PARAGRAPH BREAKS — a live sample returned as one unbroken slab; stated mechanically (a blank line between paragraphs) per operation-not-adjective. (3) SIGN-OFF PINNED — three samples of the same closer signed "Joshua", "Josh" and "— Joshua"; the name is known from closerLabel so it is pinned rather than left to the model. OPEN: the pinned form is the transcript's ("Joshua") which may not be how Josh signs off — a per-user sign-off preference is the real fix. NO OUTPUT-TOKEN GATE NEEDED: all three additions are INPUT tokens (~200), and the no-prospect branch strictly REDUCES output. // v24: follow_up_email grounded on the closer's OWN verified lines (a missing INPUT, not a missing instruction). ⚠ CORRECTED 2026-08-20: the original v24 note said Zoom degrades to the v23 wording PERMANENTLY until the participants scope lands. THAT IS NO LONGER TRUE and was never quite right — the gate is speaker_confidence==='matched', and since the byte-identical display-name match (lib/zoom-identity, 8805fac) a Zoom call RETURNS 'matched'. Voice grounding is LIVE on Zoom today and waits on no scope. // v23 (three live typing fixes): (1) BARRIER tightened to an obstacle that IMPEDES the purchase, with two worked negatives — a prospect CLARIFYING terms ("$545 due today, then $1,600 a month") is checking the deal, not resisting it, same family as question-is-not-objection; and a prospect MOVING TO PAY ("let me just enter in my credit card") is the opposite of a barrier, it is a buying_signal. (2) HANDLING now cuts BOTH WAYS: warmth is not engagement, but a CHALLENGE IS — "It's taking you a year to finally reach out to us?" is ADDRESSED, not deflected. Engagement is whether the concern was TOUCHED, not whether the closer was agreeable. This is the mirror of the v18 warmth fix. (3) risk_signal/barrier/objection are the only types badged in the UI. Superseded header: // v22 (9a missed_cue) — NOTE: no prompt field; the pairing moved OUT of the grader into the worker, so this bump covers only the REMOVAL of the v22 grader instruction. // superseded reasoning: (9a missed_cue): REPLACES v21's area-anchored barrier_trace, which linked on 1 call in 14 and whose single link was weak. Anchored instead on a MISSED CUE — a concern the prospect raised early that the closer did not dig into, followed by a concrete obstacle later. Coverage gaps cannot distinguish "never came up" from "came up and was ignored", and that distinction is the whole point. Validated deterministically: BOTH quotes must reconstruct as the PROSPECT'S words, and the separation must clear MIN_CUE_GAP_SECONDS=120 (derived from the corpus — degenerate pairs top out at 101s, the next genuine one is 183s). The model may DECLINE and is told proximity is not causation. Coverage map is UNCHANGED and still feeds 7d. // v21 (8c barrier_trace): links a late obstacle to an uncovered discovery area — "the lender only approved $5,000, and financial qualification was never established in discovery". Rides the coverage block, so absent entirely for a rep with no areas. Validated by REUSING resolveWhatMattered (obstacle_quote takes the reason_evidence slot): area exists, area uncovered, quote reconstructs as the PROSPECT'S words; any failure stores NULL. The prompt tells it to DECLINE freely — an available gap is not a causal one. Held until the data made it a real choice: 25 of 39 mapped calls now carry 2+ uncovered areas. AN OBSERVATION, NOT A FINDING — causation is not provable, only the scaffolding is. Drives no score. // v20: (1) closer_response takes the SINGLE SHARPEST LINE rather than the fullest reply — Justin's ruling; seeing the real words beats reading an explanation of why there aren't any, and single-line spans reconstruct where multi-turn ones break (2 of 3 under v19). (2) Deflecting a price question asked BEFORE the pitch/price reveal is CORRECT TECHNIQUE and must never be missed_opportunity — high-ticket closers withhold price until the close; domain knowledge the model cannot infer. The prospect's early price question still types on manner per v17. (3) The speaker-anchoring rule is enforced as a WRITE-TIME GUARD (violatesProspectAnchor), applied in the sanitizer AND again on the proven speaker after verification — a prompt line would be the adjective-not-operation trap. // v19 (8b quote fix): closer_response must INCLUDE short interjections rather than tidying them out. Measured cause on the motivating call: the deflection spans four closer turns and the model reliably quoted it while dropping "You know what I mean?" from the middle, which HOW TO QUOTE already forbids in the abstract but which a human transcriber would naturally omit — so the quote failed reconstruction in 2 of 3 runs and was withheld, leaving the handling verdict with no evidence. Names the failure explicitly and states that a shorter unbroken span beats a longer tidied one. // v18 (8a): risk_signal and barrier now carry `closer_response` (verbatim, quote-locate verified at write time) and `handling` (addressed|deflected|ignored). DEFLECTED IS THE POINT — measured on the motivating call, the closer said 20 words in the 15 turns after the prospect disclosed losing $300,000, and his real reply came 16 turns / 53s later and was a warm deflection, so BOTH obvious proxies (a turn window, and did-he-reply/how-much) get it exactly backwards. Stated as an OPERATION with that worked example, the lesson now proven three times (v14 copy-a-span, v17 decide-your-way-out, v18 engage-with-the-substance). EXTRACTOR token gate run first on the six longest calls: worst case 908/3000 vs 868 baseline, 0 unparseable — note the binding cap here is HIGHLIGHT_MAX_TOK=3000, NOT the grader's 4500, and it had never been measured before. // v17 (HIGHLIGHT TAXONOMY SPLIT): 'objection' was overloaded — on a real call three moments were tagged objection and only ONE was, and the best catch on that call (prior financial losses signalling skepticism that would resurface at close) was filed as rapport_moment. Detection was right; the vocabulary was too small to hold it. Justin's governing definition: a true objection only happens after you drop price and ask for the close. So objection NARROWS to post-price/post-ask resistance, and two types are added — risk_signal (attitudinal doubt that could kill the deal later) and barrier (a concrete obstacle to solve, not an attitude). rapport_moment is restricted to genuine connection so disclosures of fear stop landing there. Migration 038 widened the type CHECK. NEW CALLS ONLY, so period-scoped metrics span both vocabularies until the corpus turns over — see the objection-handle-rate note in CLAUDE.md. // v16 (7d WHAT MATTERED): the grader additionally picks, from the areas it marked covered:false, the ONE that mattered most for THIS prospect, citing the prospect's own verbatim line as the reason. Rides the same coverage block, so it is absent entirely for a rep with no derived areas. ACCEPTED ONLY WHEN INDEPENDENTLY VERIFIED server-side — the area must exist for this rep, must be marked uncovered, and the reason must reconstruct from the transcript AS THE PROSPECT'''S WORDS; any failure stores NULL. Suppressed outright on role-inverted calls (recorded user being sold to), where the closer'''s own disclosures would otherwise read as covered prospect ground. DRIVES NO SCORE. // v15 (7c COVERAGE MAP): the grader additionally emits `coverage` (per-area: was this ground established on this call, by ANY conversational route, with a verbatim line) and `prospect_context` (1-3 factual attributes the prospect stated about themselves). BOTH DRIVE NOTHING — no score, no grade, no surface — the same measure-then-read discipline that made qualification_covered work after three attempts to express the intent as score nudging failed against the ±14 noise floor. Areas come from the rep's OWN material and are cached on its hash, so the prompt is byte-identical to v14 for any rep without material (7 of 8 live profiles). Evidence is verified at WRITE TIME by quote-locate, never trusted from the model. TRUNCATION MEASURED BEFORE SHIPPING on the six longest calls in the corpus (1645-2123 turns): worst-case output 3211/4500 tokens vs 2691 for v14 alone, +520 marginal, 0 unparseable — re-measure if further fields are added. // v14 (VERBATIM QUOTING): every quoted field the extractor emits (quote, closer_response) must be a CONTIGUOUS character-for-character span of ONE transcript line. Removed "trim filler" (it licensed editing) and the 30-word cap (it forced compression); shortening is now cut-from-the-ends only, never stitching a beginning to a later ending. WHY IT IS MECHANICAL RATHER THAN AN ADJECTIVE: closer_response ALREADY said "quoted verbatim" under v13 and still failed reconstruction 67% of the time — measured on 88 failures, 86% began verbatim and drifted mid-sentence. This is validated by RECONSTRUCTION RATE, never by score deltas: the grader noise floor makes a score comparison meaningless, and reconstruction is directly checkable (the same reasoning that made qualification_covered work). Scope is deliberately every quoted field, not just the objection lane — the same defect caps stored highlights and harvested KB moments alike. // v13 (6a — deterministic speaker labelling): the prompt TEMPLATE is unedited, but the prompt STRING sent to Claude changes materially on every call where the closer is now identified — `closerLabel`/`speakerNote` flip from "Speaker identity is uncertain — infer who the closer is" to "The closer is X, labeled CLOSER", and EVERY transcript line's speaker prefix changes from a raw display name to CLOSER/PROSPECT. That is a different input to the model, so it gets a version stamp: prompt_version is the ONLY way to tell which analyses were graded with MATCHED speakers versus GUESSED ones, and that distinction is load-bearing for every closer-side feature built on top. Cost, stated plainly: this marks every prior analysis outdated. Per the standing new-calls-only ruling, do NOT mass re-analyze to clear it — the count is cosmetic and the corpus corrects itself as new calls arrive. // v12: (1) qualification_covered {financial, evidence} — a MEASUREMENT-ONLY structured field, additive, drives NOTHING (no score, no UI). Adopted after three attempts to encode qualification enforcement as grader WORDING all failed: the intended effect is smaller than the grader's noise floor (see GRADER NOISE PROFILE in CLAUDE.md), so it cannot be validated by score deltas and must be validated by READING the boolean against transcripts. (2) the anti-literal-matching guidance kept as prompt text — it gated clean and costs nothing. NOT a scoring change; under new-calls-only the outdated count it produces is cosmetic. // v11: grader emits `prospect_name` (PROSPECT NAMES 3b), reusing the v7 follow-up-email greeting contract VERBATIM — transcript-only, null when no name is established, never the meeting title. A couple returns as ONE joined name (ruling: couples are one prospect). ADDITIVE — scoring/outcome/section prompts are UNCHANGED from v10, so NO delta-gate (same reasoning that let v10 ship without one). Feeds lib/prospect-name.js, which already ranked a grader name above diarized and title. // v10: highlight extractor now tags each moment with its `section` (intro/discovery/pitch/objection/close) for the Call Review section breakdown (migration 028). ADDITIVE — an extractor-only field; grader scoring/outcome prompts are UNCHANGED from v9, so no delta-gate needed (the score/outcome noise on re-analysis is the same as any re-grade). Backfill = last 30 days only (reviewed step); older calls stay v9 (no section tags → UI falls back to notes prose). Manual outcomes are frozen by the outcome_source='manual' guard, so re-analysis can't clobber them. // v9: sharper outcome criteria (no_show = very short/no discovery-pitch-close; disqualified/no-path = lost; follow_up requires a live path forward).

// ─── Tuning ────────────────────────────────────────────────────────────────
const MAX_SEARCH_PAGES   = 3;                // upper bound on /meetings pagination when finding one specific call
const SEARCH_WINDOW_MS   = 10 * 60 * 1000;   // created_after = call_date - 10min (Fathom's `created` is close to but not identical to recording_start_time)
const MAX_HIGHLIGHTS     = 8;                // hard cap — schema-free but the dashboard layout assumes <=8
const GRADER_MAX_TOKENS  = 4500;             // 5 sections × notes + overall + one_thing + follow_up_email + outcome. Bumped 3000→4500: at 3000 the grader JSON truncated (unparseable) on longer calls once the outcome field was added.
const HIGHLIGHT_MAX_TOK  = 3000;             // 8 highlights × ~300 tokens each

// ─── Lazy clients — same pattern as routes/me.js + routes/proxy.js ─────────
var _admin = null;
function getAdminClient() {
  if (_admin) return _admin;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin not configured — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in Railway Variables).');
  }
  _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  return _admin;
}

var _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic not configured — missing ANTHROPIC_API_KEY (set in Railway Variables).');
  }
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ─── JSON extraction (verbatim port from routes/me.js extractFirstJsonObject) ──
// Strip ```json / ``` fences from Claude responses. Same pattern as
// call-memory.js — Claude sometimes ignores "no fences" prompt instructions.
function stripCodeFences(text) {
  if (!text) return text;
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// Extract the first balanced JSON object from a string. Tolerates Claude
// wrapping JSON in prose, markdown fences, or trailing commentary. Returns
// the parsed object or null on failure. Switched into use in v1.1.10 after
// strict JSON.parse failed 100% of the time on narrative-wrapped output.
// ⚠⚠ LAST-RESORT REPAIR FOR RAW CONTROL CHARACTERS INSIDE JSON STRINGS.
//
// JSON forbids a literal newline inside a string literal — it must be "\n".
// The model does not always comply, and when it does not, JSON.parse rejects
// THE ENTIRE RESPONSE: the whole analysis fails, not just the offending field.
//
// ⚠ MEASURED CAUSE, and it is one of our own instructions. v25 told the grader
// to put a blank line between paragraphs of `follow_up_email` (a live sample had
// come back as one unbroken slab). On the longest call in the corpus the model
// obliges with TEN LITERAL NEWLINES inside that one string, the braces balance
// perfectly, and the parse dies at the first of them. Reproduced on 2 of 2 runs
// of that call; 2 production analyses currently sit in `error` for this reason.
//
// ⚠⚠ WHY THIS IS SAFE TO ADD: it runs ONLY after a normal parse has already
// failed, and a response that parses cannot contain a raw control character
// inside a string — so for every currently-healthy response this is a provable
// no-op. It can turn a failure into a success and can never do the reverse.
//
// ⚠ IT REPAIRS, IT DOES NOT REWRITE. Only characters below 0x20 INSIDE a string
// are escaped; structure, whitespace between tokens and every other byte are
// untouched, so the parsed object is exactly what the model meant to send.
function escapeRawControlChars(jsonText) {
  var out = '';
  var inString = false;
  var escape = false;
  for (var i = 0; i < jsonText.length; i++) {
    var ch = jsonText[i];
    if (escape) { out += ch; escape = false; continue; }
    if (ch === '\\' && inString) { out += ch; escape = true; continue; }
    if (ch === '"') { out += ch; inString = !inString; continue; }
    if (inString) {
      var code = jsonText.charCodeAt(i);
      if (code < 0x20) {
        if (code === 10) out += '\\n';
        else if (code === 13) out += '\\r';
        else if (code === 9) out += '\\t';
        else out += '\\u' + ('000' + code.toString(16)).slice(-4);
        continue;
      }
    }
    out += ch;
  }
  return out;
}

// Parse, and if that fails only because of raw control characters, repair once.
function parseJsonTolerant(candidate) {
  try { return JSON.parse(candidate); } catch (_) { /* fall through */ }
  try { return JSON.parse(escapeRawControlChars(candidate)); } catch (_) { return null; }
}

function extractFirstJsonObject(text) {
  if (!text) return null;
  var cleaned = stripCodeFences(text);
  try { return JSON.parse(cleaned); } catch (_) { /* fall through */ }
  var start = cleaned.indexOf('{');
  if (start === -1) return null;
  var depth = 0;
  var inString = false;
  var escape = false;
  for (var i = start; i < cleaned.length; i++) {
    var ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return parseJsonTolerant(cleaned.slice(start, i + 1));
      }
    }
  }
  return null;
}

// Sibling for arrays — same brace-walk logic, swapped for square brackets.
// Used by the highlight extractor whose output is a JSON array, not an object.
function extractFirstJsonArray(text) {
  if (!text) return null;
  var cleaned = stripCodeFences(text);
  try {
    var direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) return direct;
  } catch (_) { /* fall through */ }
  var start = cleaned.indexOf('[');
  if (start === -1) return null;
  var depth = 0;
  var inString = false;
  var escape = false;
  for (var i = start; i < cleaned.length; i++) {
    var ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        // Same raw-control-character exposure as the object extractor: the
        // highlight extractor's `observation` and `quote` fields are free prose.
        var parsed = parseJsonTolerant(cleaned.slice(start, i + 1));
        return Array.isArray(parsed) ? parsed : null;
      }
    }
  }
  return null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function formatSeconds(s) {
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(sec);
}

// Render the normalized turn array as plain text Claude can grade against.
// Keeps timestamps + speakers + raw text on each line so notes can quote
// "[00:12:04] CLOSER: 'we can do that for $5k'" verbatim.
function formatTurnsForPrompt(turns) {
  return turns.map(function(t) {
    var ts = (t.start_seconds != null) ? formatSeconds(t.start_seconds) : '--:--:--';
    return '[' + ts + '] ' + t.speaker + ': ' + (t.text || '');
  }).join('\n');
}

// SUPERSEDED (2026-07): no longer called by analyzeCall — the /meetings search
// below failed for all 200 of Josh's calls (created_after window + 3-page cap
// never surfaced the target). analyzeCall now fetches the transcript directly
// via /recordings/{id}/transcript using the stored fathom_call_id. Kept intact
// for reference / rollback; safe to delete once the direct-fetch path is proven.
//
// Find the Fathom meeting matching one recording_id by walking /meetings
// filtered by created_after = (call_date - 10min). Up to MAX_SEARCH_PAGES
// pages — past that we surface "not found" rather than blow Anthropic budget
// on an open-ended scan. Acceptable here because the trigger fires immediately
// after sync, so we know the recording_id exists and is recent.
//
// NB: the `recordingId` parameter is Fathom's id (the string we store in
// fathom_calls.fathom_call_id), NOT our internal fathom_calls(id) UUID — they
// have the same column name in the schema by historical accident.
async function findMeeting(accessToken, recordingId, callDate) {
  var createdAfter = null;
  if (callDate) {
    var startMs = new Date(callDate).getTime();
    if (!isNaN(startMs)) {
      createdAfter = new Date(startMs - SEARCH_WINDOW_MS).toISOString();
    }
  }
  var cursor = null;
  var pagesWalked = 0;
  for (var page = 0; page < MAX_SEARCH_PAGES; page++) {
    // includeTranscript=false: OAuth apps can't use include_transcript on
    // /meetings (silently ignored), so we no longer ask for it here — the
    // transcript is fetched separately via /recordings/{id}/transcript in
    // analyzeCall. includeHighlights=true stays (highlights DO come back inline).
    var data = await fathomRoutes._fetchMeetingsPage(accessToken, cursor, createdAfter, false, true);
    pagesWalked++;
    var items = Array.isArray(data.items) ? data.items : [];
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].recording_id) === String(recordingId)) {
        return { meeting: items[i], pagesWalked: pagesWalked };
      }
    }
    cursor = (typeof data.next_cursor === 'string' && data.next_cursor) ? data.next_cursor : null;
    if (!cursor) break;
  }
  return { meeting: null, pagesWalked: pagesWalked };
}

// ─── Section Grader prompt ────────────────────────────────────────────────

// Renders the 7c coverage instruction, or '' when the rep has no derived areas.
// Returning '' keeps the prompt byte-identical to v14 for every rep without
// material — which is most of them (1 of 8 live profiles derives areas).

// ─── 7c sanitizers ─────────────────────────────────────────────────────────
// Both fail toward LESS assertion, never more. `evidence_verified` is always
// false here: verification happens at write time against the transcript, and
// the model's confidence in its own quote is not evidence.

function sanitizeCoverage(raw, areas) {
  if (!Array.isArray(raw) || !Array.isArray(areas) || areas.length === 0) return [];
  var known = {};
  areas.forEach(function (a) { if (a && a.key) known[a.key] = true; });

  var seen = {};
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var r = raw[i];
    if (!r || typeof r !== 'object') continue;
    var key = normalizeAreaKey(r.area_key);
    // An area this rep does not have is DROPPED, never invented into the map.
    if (!key || !known[key] || seen[key]) continue;
    seen[key] = true;

    var covered = (r.covered === true);
    var ev = (typeof r.evidence === 'string') ? r.evidence.trim() : '';

    // NOTE the deliberate difference from sanitizeQualificationCovered, which
    // flips true->false when the quote is missing. That is right THERE because
    // the field drives nothing. Here it would be wrong: 7d ranks UNCOVERED
    // areas into "the question that mattered", so flipping an unsupported claim
    // to false would invent a gap and coach the rep on it. Claiming coverage
    // without proof and asserting a miss are both assertions; make neither —
    // keep the judgement, withhold the unprovable quote.
    out.push({
      area_key: key,
      covered: covered,
      evidence: (covered && ev) ? ev : null,
      evidence_verified: false,
    });
  }
  return out;
}

function sanitizeProspectContext(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  for (var i = 0; i < raw.length && out.length < 3; i++) {
    var r = raw[i];
    if (!r || typeof r !== 'object') continue;
    var attr = (typeof r.attribute === 'string') ? r.attribute.trim() : '';
    var ev = (typeof r.evidence === 'string') ? r.evidence.trim() : '';
    // Unlike coverage, an attribute without evidence has no useful meaning:
    // 7d would cite it as the reason a question mattered while citing nothing.
    if (!attr || !ev) continue;
    out.push({ attribute: attr.slice(0, 80), evidence: ev, evidence_verified: false });
  }
  return out;
}

// Same normalisation the area derivation uses, so a casing drift in the
// model's echo of a key does not silently lose the row.
function normalizeAreaKey(k) {
  if (typeof k !== 'string') return null;
  var s = k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return s || null;
}


// ─── 7d: "the question that mattered" ──────────────────────────────────────
//
// Accepts the model's pick ONLY when every claim in it is independently true:
// the area is one the rep actually has, it was NOT covered on this call, and
// the stated reason is a line the PROSPECT really spoke. Any failure returns
// null — emitting nothing beats reaching for the nearest plausible pairing,
// because a fabricated "the question that mattered" is coaching the rep on a
// call that did not happen.
function resolveWhatMattered(raw, ctx) {
  if (!raw || typeof raw !== 'object') return null;
  var c = ctx || {};
  var coverage = Array.isArray(c.coverage) ? c.coverage : [];
  var areas = Array.isArray(c.areas) ? c.areas : [];
  var turns = Array.isArray(c.turns) ? c.turns : [];

  // Without deterministic speakers we cannot say the PROSPECT said anything,
  // and the whole claim rests on that.
  if (c.speakerConfidence !== 'matched') return null;

  var key = normalizeAreaKey(raw.area_key);
  if (!key) return null;
  if (!areas.some(function (a) { return a && a.key === key; })) return null;

  // It must be a genuine GAP. A covered area is not "the question that
  // mattered" — and an area missing from the map was never assessed.
  var row = coverage.filter(function (r) { return r && r.area_key === key; })[0];
  if (!row || row.covered !== false) return null;

  var quote = (typeof raw.reason_evidence === 'string') ? raw.reason_evidence.trim() : '';
  if (!quote) return null;
  if (labelForQuote(turns, quote) !== 'PROSPECT') return null;

  return { area_key: key, reason_evidence: quote, reason_verified: true };
}

// Detect a call where the recorded user is the one being SOLD TO, so the
// closer/prospect roles are inverted relative to what recorded_by implies.
//
// The detector keys on WHO SPOKE the supposed prospect attributes, not on
// whether they verified. That distinction matters: an unverified quote is
// usually just a paraphrase, and treating it as inversion would flag any call
// where the model tidied a line. On a genuinely inverted call the attributes
// reconstruct cleanly — to the CLOSER, because he is describing himself.
//
// Requires the closer-spoken attributes to OUTWEIGH the prospect-spoken ones:
// one stray is an extraction slip, not an inverted call, and suppressing
// coaching on a normal call is its own harm.
function detectRoleInversion(prospectContext, turns, speakerConfidence) {
  var none = { inverted: false, closer_spoken: 0, prospect_spoken: 0 };
  if (speakerConfidence !== 'matched') return none;
  if (!Array.isArray(prospectContext) || prospectContext.length === 0) return none;

  var closer = 0, prospect = 0;
  prospectContext.forEach(function (p) {
    if (!p || typeof p.evidence !== 'string') return;
    var who = labelForQuote(turns, p.evidence);
    if (who === 'CLOSER') closer++;
    else if (who === 'PROSPECT') prospect++;
  });
  return { inverted: closer > 0 && closer > prospect, closer_spoken: closer, prospect_spoken: prospect };
}

function coverageInstruction(areas) {
  if (!Array.isArray(areas) || areas.length === 0) return '';
  var list = areas.map(function (a) { return a.key + ' (' + a.label + ')'; }).join('; ');
  return [
    '  - coverage: for EACH area listed below, whether the closer established that ground ON THIS CALL, as {"area_key":"...","covered":true|false,"evidence":"..."}.',
    '      Ground counts as covered BY ANY conversational route: a direct question, an indirect one, an inference the prospect confirms, or something the prospect volunteers all count equally. No specific words, figures or criteria need to appear.',
    '      evidence: the line that establishes it, copied EXACTLY as a contiguous run of words from ONE transcript line — no merging lines, no tidying, cut from the ends only to shorten. Use null when covered is false.',
    '      THIS IS AN OBSERVATION, NOT A JUDGEMENT: it must not influence any section score, grade or the overall score in any way.',
    '      AREAS: ' + list,
    '  - what_mattered: of the areas above that you marked covered:false, the ONE that mattered most FOR THIS PROSPECT given what they said about themselves, as {"area_key":"...","reason_evidence":"..."}. reason_evidence must be THE PROSPECT\'S OWN line explaining why that ground mattered for them, copied EXACTLY as a contiguous run of words from ONE transcript line. Return null if every area was covered, or if you cannot point to a line the prospect actually said that shows why it mattered. Do not reach for the nearest plausible pairing.',
    '  - prospect_context: 1-3 factual attributes THIS prospect stated about themselves (their situation, role, holdings, constraints), as [{"attribute":"...","evidence":"..."}]. attribute is 2-8 words. evidence is the prospect\'s own line, copied EXACTLY as a contiguous run of words from ONE transcript line. Return [] if the prospect stated nothing factual about themselves.',
  ].join('\n');
}

// The per-criterion qualification CHECK (2026-08-26). Emitted ONLY when this rep
// has criteria on file — 1 of 8 live profiles — so the prompt is byte-identical
// for everyone else and costs them nothing, the same shape as the coverage map.
//
// ⚠⚠ THIS IS THE COMPARISON THAT WAS MISSING. qualification_covered already
// captured the prospect's disclosure verbatim and the criteria already reached
// the grader; nothing joined them. On the motivating call the stored evidence
// was "My personal credit score right now is about 60 or something like that"
// against a criterion of "640 or above credit score", and the call was graded
// follow_up with a timing objection.
//
// ⚠ CRITERIA ARE FREE TEXT AND DIFFER PER COMPANY, so the model is handed the
// rep's own words and asked to split and judge them. Nothing here may hardcode
// a threshold — "640" is Josh's bar, not Scout's.
//
// ⚠⚠ THREE VERDICTS, AND undetermined IS THE EXPECTED ONE. "not living
// paycheck to paycheck" is a judgement, not a number, and many calls simply
// never establish a given criterion. Being unable to tell must be SAYABLE, or
// the model will guess — and a guessed "failed" disqualifies a real prospect.
function qualificationCheckInstruction(qualifications) {
  if (!qualifications || !String(qualifications).trim()) return '';
  return [
    '  - qualification_check: an ARRAY, one entry per criterion in the QUALIFYING CRITERIA below. Split the criteria text yourself into the separate bars it states.',
    '    THE CRITERIA FOR THIS OFFER: ' + String(qualifications).trim(),
    '    For each one return {"criterion": "<the criterion, in the words above>", "covered": true|false, "verdict": "passed"|"failed"|"undetermined", "evidence": "<a contiguous verbatim span from ONE of the PROSPECT\'s transcript lines>"|null}.',
    '      • "covered" — did the call establish where this prospect stands on this criterion, BY ANY conversational route? A direct question, an indirect one, an inference the prospect confirms, or something they volunteer all count equally. No particular words need to appear.',
    '      • "verdict" — COMPARE what the prospect said against the bar. "passed" = they clear it. "failed" = they do not. "undetermined" = you cannot tell.',
    '      • ⚠ USE "undetermined" FREELY AND WITHOUT HESITATION. It is the correct answer whenever the criterion was never established, the prospect was vague, or the criterion is a judgement rather than a number and the call gives you no basis to judge it. It is expected to be common. A guessed verdict is far worse than an honest "undetermined" — a wrong "failed" writes off a real buyer.',
    '      • ⚠ THE EVIDENCE MUST BE THE PROSPECT\'S OWN WORDS, never the closer\'s. The closer ASKING "is your credit shot?" or summarising "you have 10K set aside, right?" is NOT the prospect answering. A quote that is not the prospect\'s is discarded and the verdict is downgraded to "undetermined".',
    '      • Judge the SUBSTANCE, not the phrasing. "About 60 or something like that" for a credit score is below a bar of 640. "I have ten grand put away" clears a bar of 10k saved.',
    '      • If a criterion was not covered, set covered:false, verdict:"undetermined", evidence:null.',
    '    ⚠ A criterion you mark "failed" IS a financial disqualification — the same thing the objection rules above describe, not a separate idea. Let it inform "outcome" through the EXISTING rule: a disqualification the closer accepts and does not overcome is "lost"; one the closer genuinely overcomes is not.',
  ].join('\n');
}

function buildSectionGraderPrompt(normalized, durationSeconds, sellingContext, coachingAreas, opts) {
  var transcriptText = formatTurnsForPrompt(normalized.turns);
  var durationLabel = (durationSeconds != null) ? Math.round(durationSeconds / 60) + ' minutes' : 'unknown duration';
  /* ⚠⚠ v24 — THE CLOSER'S OWN LANGUAGE. See lib/closer-voice.js: this was a
     MISSING INPUT, not a missing instruction. The prompt has said "sound like a
     real person" since v7 and produced pastiche, because it named what to avoid
     and gave the model nothing to imitate.
     ⚠ ABSENT ON ZOOM, PERMANENTLY — a Zoom transcript has no matched speaker, so
     there are no verified closer lines and never will be until the participants
     scope lands. It degrades to the v23 wording rather than substituting
     unverified lines, which would be as likely to be the PROSPECT's words. */
  var voiceBlock = (opts && opts.voiceBlock) || null;   // v24; null on Zoom, by design

  var closerLabel = (normalized.speaker_confidence === 'matched')
    ? 'The closer is "' + normalized.closer_name + '", labeled CLOSER in the transcript. The prospect is labeled PROSPECT.'
    : 'Speaker identity is uncertain — the transcript shows raw display names. Infer who the closer is from conversational cues (asks discovery questions, makes the pitch, handles objections). Map both roles to CLOSER and PROSPECT in your evidence quotes.';

  // v7 diverges from v5/v6: cash_collected extraction + the follow_up_email
  // greeting contract (transcript-name-only, omit when unclear). The SELLING
  // CONTEXT block is still spliced in ONLY when non-empty. No version text
  // lives in the prompt — the version is a DB stamp.
  var lines = [
    'You are an expert sales coach reviewing a transcript of a high-ticket sales call. Grade five sections on a 0-100 spectrum (NOT pass/fail), each with a letter grade A-F.',
    '',
    'DOMAIN CONTEXT: This is high-ticket sales, where a 25-35% close rate is STRONG performance. Most calls do not close, and that is normal and expected. A call that advances the prospect to a next step, or ends with an appropriate disqualification, is a SUCCESSFUL outcome — not a failure. Do not treat "did not close on this call" as a poor performance.',
    '',
    'SCORING SCALE — anchor every section score to these bands:',
    '  85-100: exceptional — rare, near-perfect execution of this section',
    '  70-84 : strong — did the job well with only minor gaps. THIS IS WHAT GOOD WORKING CLOSERS SCORE ON MOST CALLS.',
    '  55-69 : adequate — the section happened, with real gaps that likely cost leverage',
    '  40-54 : weak — significant misses',
    '  <40   : the section failed or was barely attempted',
    'A competent professional closer\'s TYPICAL call should land 65-80 per section. Reserve sub-50 for genuine failures, not for imperfection. DO NOT grade against a perfect-call ideal — grade against what a solid working closer actually does.',
    '',
    'RANKING INTEGRITY: this anchoring shifts the SCALE, not your discrimination. The relative differences between sections (and between calls) must still reflect real quality differences — a genuinely stronger section must still score higher than a weaker one. Calibrate the overall level up, but keep the ordering honest.',
    '',
    'CRITICAL: Every claim in `notes` MUST cite a specific transcript line by quoting it with its [HH:MM:SS] timestamp. No unsupported assertions, no generic feedback, no cheerleading.',
    '',
    'Call duration: ' + durationLabel + '.',
    closerLabel,
    '',
    'Five sections to grade:',
    '  1. INTRO       — did the closer set frame and control from the first 60 seconds, establish credibility without overselling, set a clear agenda the prospect agreed to',
    '  2. DISCOVERY   — six things must be established before a closer can pitch and close: PAIN (emotional depth, not just the surface problem — \u26a0 BUT SOME OFFERS ARE A LOGICAL SALE WITH NO PAIN, and where the offer is bought on logic rather than on relief from a problem, absent pain is NOT a fault and must not reduce the score), GOALS (what they said they want to reach, in their own words), CURRENT SITUATION (where they are now — the facts the goal is measured against), DECISION MAKERS (confirmed present, or confirmed as the sole decider), WHY NOW (urgency established), and FINANCIAL RESOURCES (whether they can actually fund it, alongside any specific dollar/timeline commitment). \u26a0 PAIN IS A RELATION, NOT A FEELING: pain exists when their CURRENT SITUATION does not align with their GOALS, so the two are what make it legible. \u26a0 Discovery succeeds when it establishes what the closer needed to know to either CLOSE the deal or DISQUALIFY the prospect — both outcomes are correct, and a call that surfaced a genuine disqualification did its job.',
    '  3. PITCH       — solution framing tied directly to discovery findings',
    '  4. OBJECTION   — handling resistance via isolation + framework rebuttal',
    '  5. CLOSE       — was a clear assumptive or direct close attempted, was price presented confidently without apologizing, were final objections handled before the call ended',
    '',
    '',
    'HOW TO JUDGE EVERY SECTION: the bullets above name the AREAS each section must establish — they are not required words, questions or techniques. DO NOT REDUCE a score because the closer reached the required ground by a DIFFERENT ROUTE: a different order, their own wording, a technique used without naming it, an area established by inference or volunteered by the prospect, or a thread picked up again later in the call. Named methods (isolation, framework rebuttal, assumptive close, agenda-setting) are examples of routes that work, not requirements. Route alone is never a fault. This does NOT make you more generous overall — it changes what counts as a fault, not the scoring scale.',
    '',
    'For each section return: {"grade":"A"|"B"|"C"|"D"|"F","score":0-100,"notes":"<evidence + reasoning, including 1-2 quoted transcript lines with timestamps>"}',
    'If a section did not occur (e.g. no objections were raised), return {"grade":null,"score":null,"notes":"Section did not occur in this call."} — null is honest.',
    '',
    'Then provide call-level fields:',
    '  - overall_score: 0-100, weighted gestalt across sections that occurred',
    '  - overall_summary: 2-3 sentences. Factual only — no encouragement, no softening. State what happened, what stage was reached, and what the apparent outcome was.',
    '  - one_thing: the single most actionable behavioral change for the closer\'s next call — specific, not generic. Bad: "ask better discovery questions." Good: "when the prospect mentioned the $50k loan at [00:08:21], you moved straight to pitch instead of isolating the urgency — pause and ask \'what would change if you didn\'t solve this in 60 days?\' next time." For a "lost" OR "follow_up" call, one_thing MUST be the direct antidote to why_outcome.reason — the correction (for follow_up: the move that advances the deal) that addresses that exact cause, at the same or the adjacent moment. why_outcome and one_thing must read as cause → correction.',
    '  - why_outcome: the SINGLE most decisive cause of this call\'s result, anchored to one transcript moment — an object {"reason":"...","quote":"...","timestamp_seconds":N}:',
    '      • reason: ONE specific cause, not a list. For a "lost" call this is the primary reason the deal did not close (the one thing that most cost it). For a "closed" call this is what most won the deal (the decisive moment). For a "follow_up" call this is the primary BLOCKER that kept it from closing on THIS call — the unresolved objection, hesitation, or missing piece the closer must resolve next. The deal is alive, not lost: frame it as what is standing between here and a close.',
    // v14: same verbatim contract as the extractor. This quote is rendered on
    // the review page as the decisive moment, so a paraphrase presents words
    // nobody said as the reason a deal was won or lost.
    '      • quote: a CONTIGUOUS run of words copied EXACTLY from ONE transcript line at that moment (the closer\'s or the prospect\'s). Do not merge lines, skip words in the middle, tidy grammar, or remove filler. To shorten, cut from the ends only, so the result is still an unbroken run that appears in the transcript. Aim for 5-40 words.',
    '      • timestamp_seconds: integer seconds of that moment (read the [HH:MM:SS] tag, convert to seconds).',
    '      \u2022 \u26a0\u26a0 NEVER NAME THE PROSPECT IN `reason`. Write \'the prospect\', never a first name.',
    '        A name spoken once in a transcript is not reliably the prospect\u2014 on a real call a name',
    '        appearing ONCE in 911 turns, in the closer\u2019s sign-off, was used here while the call was',
    '        with two other people. `prospect_name` is the field that carries a name contract; this one',
    '        does not, and the surfaces that render this already show who the call was with.',
    '      • REQUIRED for "closed", "lost", and "follow_up". Set why_outcome to null ONLY when outcome is "no_show" (no real conversation to diagnose).',
    '  - one_thing_timestamp_seconds: integer seconds of the moment the one_thing correction belonged to — the same moment as why_outcome, or the adjacent moment where the closer should have intervened. Null if not applicable.',
    '  - prospect_name: the prospect\'s name, using the SAME rule as the follow-up email greeting: the name they are actually called (or call themselves) IN THE TRANSCRIPT. If no name is clearly established in the transcript, return null. Never take a name from the meeting title or any source other than the transcript itself. If two people are on the prospect side (a couple or business partners buying together), return them as one name joined by \" and \" (e.g. \"Alan and Jen\") \u2014 they are ONE prospect. Return the name only, with no title, company, or location.',
    // ─── 7c: the coverage map ─────────────────────────────────────────
    // Emitted ONLY when the rep's own material yielded areas. A rep with no
    // material is never asked to assess ground nobody defined — that is exactly
    // where an invented rubric would come from.
    //
    // "BY ANY conversational route" is v12's proven wording, reused verbatim
    // rather than restated: Justin's standing principle is that conversations
    // flow and are all different, so we assess whether the GROUND was
    // established, never whether particular phrases appeared.
    //
    // Evidence inherits the v14 verbatim contract because it is verified
    // against the transcript at write time and discarded if it does not
    // reconstruct. DRIVES NOTHING: no score, no grade, no surface.
    coverageInstruction(coachingAreas),
    qualificationCheckInstruction(opts && opts.qualifications),
    '  - qualification_covered: a factual OBSERVATION about whether the closer established the prospect\'s FINANCIAL POSITION on this call — their budget, what they earn, what they have saved, or what they are able to invest. Return {"financial": true, "evidence": "<the line that establishes it, copied EXACTLY as a contiguous run of words from ONE transcript line — no merging lines, no tidying, cut from the ends only to shorten>"} when that ground was covered BY ANY conversational route: a direct question, an indirect one, an inference the prospect confirms, or something the prospect volunteers all count equally. No specific words, figures or criteria need to appear. Return {"financial": false, "evidence": null} ONLY when the call genuinely never establishes it. THIS IS AN OBSERVATION, NOT A JUDGEMENT: it must not influence any section score, grade or the overall score in any way.',
    '  - follow_up_email: a draft the closer can copy + send today. Reference specific moments from this call. First-person, written as the closer (not an AI). No \'I hope this finds you well\', no \'don\'t hesitate to reach out\'. Sound like a real person following up on a real conversation. Under 200 words. Greeting rule: greet the prospect ONLY by the name they are actually called (or call themselves) in the transcript. If no name is clearly established in the transcript, omit the name from the greeting entirely (e.g. \'Hey — great talking today.\'). Never take a name from the meeting title or any source other than the transcript itself.',
    // ⚠⚠ NO-PROSPECT BRANCH — THE FIX FOR A LIVE REGRESSION, AND THE CAUSE WAS
    // NOT WHAT IT LOOKED LIKE. On Josh's Zoom recording (1012 turns of him
    // venting to a colleague — no prospect anywhere) v24 emitted
    // "Hey — no prospect on this one, so nothing to follow up on."
    // A GREETING, on a call with nobody to greet, in a field the UI renders
    // with a COPY button. It reads as sendable.
    // ⚠ THE GREETING RULE ABOVE SUPPLIES THAT EXACT SHAPE as its worked
    // example for a no-name call ('Hey — great talking today.'), and NOTHING
    // ANYWHERE DISTINGUISHES "no name established" FROM "no prospect at all".
    // So the model improvised across that gap, and which way it improvised
    // varied by version: v23 wrote a flat sentence, v24 followed the example.
    // The defect was never the wording — it was a MISSING BRANCH that left the
    // case to chance, exactly the shape 7c/7d exist to remove elsewhere.
    // ⚠ A FIXED STRING, NOT A TONE INSTRUCTION: this is the one output that
    // must never vary, because a downstream reader needs to recognise it.
    '  - follow_up_email — NO-PROSPECT CASE: if this recording has no prospect in it at all (an internal call, a colleague conversation, a test recording, an empty room), do NOT write an email of any kind. Return EXACTLY this string and nothing else: "No follow-up email — this recording has no prospect in it." No greeting, no sign-off, no explanation. A greeting on a call with nobody to greet is worse than no draft, because the UI renders this field with a copy button.',
    // ⚠ PARAGRAPH BREAKS — one live sample came back as a single unbroken slab.
    // Stated as a MECHANICAL rule (a blank line between paragraphs) rather than
    // as "well formatted", per the operation-not-adjective lesson.
    '  - follow_up_email — SHAPE: separate paragraphs with a BLANK LINE. Never return the whole email as one unbroken block; a wall of text is the single clearest tell that something was generated rather than typed. Two to four short paragraphs.',
    // ⚠ SIGN-OFF DRIFT — three live samples of the SAME closer signed
    // "Joshua", "Josh" and "— Joshua". The name is KNOWN (closerLabel, when
    // speakers are matched), so pin it rather than leaving it to the model.
    // ⚠ OPEN QUESTION FOR JUSTIN, deliberately not guessed: this pins the
    // FIRST NAME AS THE TRANSCRIPT LABELS IT ("Joshua"), which may not be how
    // Josh actually signs off — his own Zoom display name is "Josh". The real
    // fix is a per-user sign-off preference on the profile; until that exists,
    // consistency is worth more than a guess at the preferred form.
    '  - follow_up_email — SIGN-OFF: end with a final line containing ONLY the closer\'s first name, exactly as their name appears above. No em-dash before it, no title, no company, no "Best" or "Thanks". Use the identical form every time — a sign-off that varies between drafts is a tell.',
  ].concat(voiceBlock ? ['', voiceBlock, ''] : []).concat([
    '  - cash_collected + payment_structure: for CLOSED calls, actively look for transaction evidence anywhere in the transcript — card details being taken or run, a deposit being made, confirmation that a charge went through, financing approvals (Affirm, Klarna, or similar BNPL — buy now pay later), or a first payment on a payment plan. Then report BOTH fields:',
    '      • payment_structure: exactly one of "paid_in_full" | "payment_plan" | "bnpl" | "none_stated". Only a closed call can have a structure other than "none_stated" — for follow_up, lost, and no_show ALWAYS return "none_stated". If the call closed but how it was paid is not evidenced, return "none_stated".',
    '      • cash_collected: a plain number, no currency symbol. THE CASH DEFINITION DEPENDS ON THE STRUCTURE — apply the matching rule:',
    '          - paid_in_full: the full amount charged on the call.',
    '          - payment_plan: ONLY the money actually collected on the call (the deposit or first payment) — NEVER the total contract value of the plan.',
    '          - bnpl: the full financed amount approved on the call.',
    '          - none_stated: 0.',
    '      • The never-fabricate rule is unchanged: NEVER guess or infer an amount — only report an amount EXPLICITLY evidenced in the transcript. A price merely quoted, offered, or discussed is NOT cash collected. If no amount is actually evidenced, return 0 even for a closed call. When in doubt: 0.',
    '  - eod_summary: a 2-4 sentence end-of-day report summary written in FIRST PERSON as the closer, as if they wrote it themselves for their team\'s Slack channel ("Spoke with X about... She\'s deciding between... I set a follow-up for Friday."). Factual and professional — names, decisions, next steps. State losses plainly with no self-criticism and no coaching language. NO AI tells: no hedging filler, and never narrate the closer in the third person — you ARE the closer\'s voice here. This is separate from overall_summary (which stays analytical).',
    /* ⚠⚠ THE CLASSIFIER FIELD (Justin's ruling 2026-09-03, H708): three-state, riding THIS
       read — never a third read of the same text. THE REASON IS WRITTEN BEFORE THE VERDICT
       so a wrong answer can be read as a wrong reason rather than a wrong guess. The field
       is stored beside the call for review only; nothing auto-marks a call on it. */
    '  - sales_call_reason: BEFORE deciding sales_call_verdict, state in ONE plain sentence what this recording is and why — e.g. "two internal staff reviewing a recorded call, no prospect present", "a prospect is on the call, a price was stated and a close was asked for", "a two-minute reconnect with a real prospect about logistics". Write this first; the verdict follows the reason, never the other way round.',
    '  - sales_call_reason_class: exactly one of "no_prospect_internal_staff" | "training_or_roleplay" | "reviewing_a_recorded_call" | "recording_stub" | "prospect_logistics_only" | "prospect_pitch_or_price" | "prospect_discovery_only" | "cannot_tell".',
    '  - sales_call_verdict: exactly one of "sales" | "not_sales" | "unsure". "sales" = a real prospect is on the call being sold to at ANY stage — a first call, a follow-up, a two-minute reconnect, a logistics-only chat with someone already sold all count. "not_sales" = nobody is being sold to: internal staff only, a training, a role-play, a coaching debrief, a review of someone else\'s recorded call (even though it contains a pitch), a test recording, an empty room. "unsure" = you genuinely cannot tell from the transcript. Never guess: when the transcript could be read either way, say "unsure".',
    '  - outcome: the deal outcome for THIS call, inferred from what actually happened in the transcript. Exactly one of:',
    '      "closed"    — prospect committed, paid, or clearly agreed to buy on this call',
    '      "follow_up" — the deal is ALIVE with a genuine path forward: a booked next call, active thinking time, or a spouse/partner check the prospect intends to complete. There must be real intent to continue — not just the absence of a "no".',
    '      "lost"      — the prospect declined, walked with no path forward, or was DISQUALIFIED. A disqualification (e.g. they fail a qualification on credit/finances/fit) that the closer accepts and does not overcome is "lost", NOT "follow_up". A vague "reschedule" with no date and no real intent is "lost", not "follow_up".',
    '      "no_show"   — the prospect never meaningfully joined, OR the call ended almost immediately: a very short call (roughly under ~2 minutes) with NO discovery, NO pitch, and NO close. Empty/near-empty transcript, no real sales conversation.',
    '    Infer from evidence in the transcript. Use "follow_up" ONLY when there is a real live path forward; if the prospect was disqualified or walked with no path, that is "lost"; if the call never got going, that is "no_show". Never guess "closed" without clear support.',
    '',
    'Respond with ONLY this JSON object — no markdown, no code fences, no narrative wrapping:',
    '{',
    '  "intro":     {"grade":"...","score":N,"notes":"..."},',
    '  "discovery": {"grade":"...","score":N,"notes":"..."},',
    '  "pitch":     {"grade":"...","score":N,"notes":"..."},',
    '  "objection": {"grade":"...","score":N,"notes":"..."},',
    '  "close":     {"grade":"...","score":N,"notes":"..."},',
    '  "overall_score": N,',
    '  "overall_summary": "...",',
    '  "one_thing": "...",',
    '  "why_outcome": {"reason":"...","quote":"...","timestamp_seconds":N} | null,',
    '  "one_thing_timestamp_seconds": N | null,',
    '  "prospect_name": "..." | null,',
    '  "qualification_covered": {"financial": true|false, "evidence": "..."|null},',
    ((opts && opts.qualifications) ? '  "qualification_check": [{"criterion": "...", "covered": true|false, "verdict": "passed"|"failed"|"undetermined", "evidence": "..."|null}],' : ''),
    '  "follow_up_email": "...",',
    '  "cash_collected": N,',
    '  "payment_structure": "paid_in_full"|"payment_plan"|"bnpl"|"none_stated",',
    '  "eod_summary": "...",',
    '  "sales_call_reason": "...",',
    '  "sales_call_reason_class": "...",',
    '  "sales_call_verdict": "sales"|"not_sales"|"unsure",',
    '  "outcome": "closed"|"follow_up"|"lost"|"no_show"',
    '}',
    '',
    'TRANSCRIPT:',
    transcriptText,
  ]);

  // Splice SELLING CONTEXT between DOMAIN CONTEXT and the SCORING SCALE, present
  // only when there is content. When empty, `lines` is untouched → identical to v5.
  if (sellingContext && sellingContext.trim()) {
    var at = lines.indexOf('SCORING SCALE — anchor every section score to these bands:');
    if (at !== -1) {
      lines.splice(at, 0,
        'SELLING CONTEXT: The following is this closer\'s actual offer and sales approach, uploaded by their team. Ground your grading in it: judge the call against THIS offer and THIS selling style. Do not penalize approaches this material explicitly endorses (e.g., a logical, ROI-driven close for a B2B offer must not be marked down for lacking emotional urgency). Where the closer deviates from their own script/offer in a way that hurt the call, say so and cite it.',
        '',
        sellingContext.trim(),
        '');
    }
  }
  return lines.join('\n');
}

// ─── Highlight Extractor prompt ───────────────────────────────────────────
function buildHighlightExtractorPrompt(normalized) {
  var transcriptText = formatTurnsForPrompt(normalized.turns);
  var speakerNote = (normalized.speaker_confidence === 'matched')
    ? 'The closer is labeled CLOSER, the prospect PROSPECT.'
    : 'Speaker identity is uncertain — the transcript shows raw display names. Infer CLOSER vs PROSPECT from conversational cues and map both to those two labels in your output.';

  return [
    'You are a film coach reviewing tape. Extract 5-8 critical moments from this sales call transcript. Be factual, not cheerleading and not critical for its own sake. When two moments are related (the same objection reappears later, an early signal gets confirmed, a missed opportunity has a callback), connect them in the observation field — that pattern-spotting is the whole point of the timeline view.',
    '',
    speakerNote,
    '',
    // v14 — VERBATIM CONTRACT. Every quoted field is checked against the
    // transcript downstream (lib/quote-locate.js), and a quote that cannot be
    // reconstructed is discarded rather than shown. Under v13 wording, 52% of
    // `quote` and 67% of `closer_response` failed that check: the prompt said
    // "trim filler", which licenses editing, and capped quotes at 30 words,
    // which forces compression of longer lines. Measured on 88 failures: 86%
    // began verbatim and then drifted mid-sentence. So the rule below is
    // mechanical (copy a span) rather than an adjective ("verbatim") — the
    // adjective was already there and did not work.
    'HOW TO QUOTE — this governs EVERY quoted field below (quote, closer_response, and any other field asking for someone\'s words):',
    '  - COPY a contiguous run of characters from ONE transcript line, exactly as written. Do not merge two lines. Do not skip words in the middle. Do not tidy grammar, remove filler, fix false starts, or change punctuation or wording in any way.',
    '  - To shorten, CUT FROM THE ENDS ONLY. A shorter quote must still be an unbroken run of words that appears in the transcript. Never join a beginning to a later ending.',
    '  - If the moment spans several lines, pick the SINGLE line that best carries it and quote that line. Do not stitch lines together.',
    '  - If you cannot produce such a span, omit the moment rather than paraphrasing it.',
    '  - A quote that is not a character-for-character span of the transcript is discarded downstream, so a paraphrase is worth less than nothing — it costs the moment entirely.',
    '',
    'For each moment include:',
    '  - timestamp_seconds: integer seconds from start of recording (read from the [HH:MM:SS] tag on the line, convert to seconds)',
    '  - speaker: exactly "CLOSER" or "PROSPECT"',
    '  - quote: a contiguous verbatim span from the transcript line at that moment, copied exactly (aim for 5-40 words; stay within one line rather than padding or trimming to hit a length)',
    '  - observation: one factual sentence, 25 words max. Describe what happened. No commentary, no validation, no "great job" or "should have done X". If two moments are part of the same pattern, the second observation may reference the first by timestamp.',
    '      \u26a0 ANY timestamp you write here must be in [HH:MM:SS] form. NEVER a raw seconds number \u2014 this text is shown to the closer, and "Objection at 3598 remained unresolved" is what that produces.',
    '  - section: which part of the call this moment happened in — exactly one of "intro", "discovery", "pitch", "objection", "close". Use the ACTUAL flow of THIS call, not a fixed order: a call may run discovery after the pitch, revisit objections late, etc. — pick the section the moment genuinely belongs to.',
    '  - type: exactly one of these values:',
    '      "buying_signal"      — prospect indicates intent (asks about onboarding, mentions next steps, asks price/timing like a buyer)',
    '      "objection"          — the prospect\'s own resistance to going ahead, AFTER the price has been stated AND the close has been asked for. THE TEST THAT SEPARATES THIS FROM A BARRIER: could the prospect change it by deciding differently? If yes, it is an OBJECTION. "I may be able to get to the $4,800, but probably not today" is an OBJECTION — nothing external stops them; they could choose otherwise, and they are choosing not to. Concerns raised BEFORE price is on the table are not objections however money-shaped they sound — file those as risk_signal or barrier.',
    '      "risk_signal"        — attitudinal doubt that could kill the deal later: prior losses, skepticism, distrust, fear of being sold, price anxiety surfacing early. The prospect is telling you what will resurface at the close. This is about how they FEEL.',
    '      "barrier"            — a concrete EXTERNAL constraint that IMPEDES the purchase and that the prospect CANNOT decide their way out of. Apply the test in reverse: if deciding differently would not change it, it is a BARRIER. A lender approving only $5,000 against a $9,800 price, a spouse who must sign, funds locked until a date. ⚠ IT MUST BLOCK THE PURCHASE. Two things that are NOT barriers, both seen live: (1) the prospect CLARIFYING the deal — "$1,600, so $545 due today, and then $1,600 a month for 6 months" is checking the terms, not resisting them, the same way a question is not an objection; (2) the prospect MOVING TO PAY — "let me just enter in my credit card" is the OPPOSITE of a barrier and is a buying_signal. If the line moves the purchase FORWARD or merely confirms its mechanics, it is not a barrier.',
    '      "missed_opportunity" — closer let a discovery thread, pain signal, or buying cue slip without follow-up. NOT A MISSED OPPORTUNITY: deflecting a PRICE question asked BEFORE the pitch or the price reveal. High-ticket closers deliberately withhold price until they have closed, so redirecting an early "what does it cost?" is CORRECT TECHNIQUE — never type that missed_opportunity. The prospect\'s early price question itself still types on manner (a neutral ask is a buying_signal; a demanding one is a risk_signal).',
    '      "strong_moment"      — closer executed a framework cleanly (V-L-F-A-R, identity shift, isolation, etc.)',
    '      "rapport_moment"     — genuine connection ONLY: humour, shared experience, warmth. If the prospect opens up about a loss, a fear or a bad past experience, that is a risk_signal, NOT rapport — the disclosure is telling you about a doubt, not building a bond.',
    '      "disqualify_signal"  — prospect revealed they\'re not a real fit: no budget, no decision authority, wrong stage, OR NO NEED — they stated a reason the offer does not apply to them.',
    '',
    'HOW TO TYPE A QUESTION — a question is NOT resistance just for being a question. Judge it on WHEN it came and HOW it was asked, and require evidence in the wording:',
    '  - A genuine logistical question ("how does the price break down?", "how does billing work?") is NOT resistance at all. Do not type it as objection, barrier or risk_signal. If it is worth capturing it is usually a buying_signal, and if the closer never answered it that is a missed_opportunity.',
    '  - A DEMANDING or impatient price question early on ("just hurry up and tell me the price") IS a red flag: it often means no money or no seriousness. Type it risk_signal, and the observation must cite the wording that shows the manner.',
    '  - The same words can be either. "What does it cost?" asked calmly after real discovery is a buying_signal; the same question thrown in impatiently during discovery is a risk_signal. If the wording gives you no evidence of manner, prefer the non-resistance reading.',
    '',
    'FOR type="objection" MOMENTS ONLY, also include these extra fields (omit them for every other type — a barrier is not "handled" and a risk_signal has no resolution):',
    '  - objection_surface: the SURFACE objection as the prospect ACTUALLY framed it, in 1-3 words (e.g. "too expensive", "needs spouse", "bad timing", "wants to research", "not sure it works"). This is the apparent objection in the prospect\'s own words; objection_category below is the underlying driver.',
    '  - objection_class: one of "true_objection" | "logistical_barrier" | "disqualification". \u26a0\u26a0 THIS DECIDES WHETHER THE MOMENT COUNTS IN THE REP\'S HANDLE RATE, so judge it on whether the closer could have overcome it. "true_objection" = a real, coachable objection \u2014 price, timing, needs to think, spouse approval, wants proof. "logistical_barrier" = a mechanical or process problem that is NOT coachable: a DECLINED or FAILED PAYMENT belongs here (card declined, transfer failed, financing rejected). "disqualification" = the prospect is not a fit or cannot buy at all \u2014 "no money", "can\'t afford it", "no funding" is a DISQUALIFICATION, not an objection. \u26a0 RULE OF THUMB: a declined payment is a logistical_barrier; "no money / can\'t buy" is a disqualification; NEITHER is a coachable objection. \u26a0 When genuinely unsure, choose "true_objection" \u2014 counting a moment the closer could have handled is the safe direction; dropping a real objection hides coaching.',
    '  \u26a0\u26a0 BEFORE CATEGORIZING, APPLY TWO TESTS IN THIS ORDER.',
    '  TEST 1 \u2014 DO THEY WANT IT AT ALL? If the prospect stated A REASON THE OFFER DOES NOT APPLY TO THEM \u2014 they already have it, they do not have the problem, it is for a different situation, their business is past this \u2014 that is a DISQUALIFICATION, not an objection. Emit type="disqualify_signal", never type="objection". Nothing the closer could have done: you cannot handle your way out of someone not needing the thing.',
    '    \u26a0\u26a0 THE DISCRIMINATOR IS A STATED REASON THE OFFER DOES NOT APPLY \u2014 NOT THE WORDS \"I don\'t need it\". Those words are said by both kinds of prospect and cannot separate them.',
    '      \u2022 \"I have a company making $3 million a year, so I don\'t need this headache\" \u2014 carries a REASON the offer does not apply \u2192 disqualify_signal.',
    '      \u2022 A bare \"do I really need this?\" from an engaged prospect who has described a goal \u2014 NO reason given, and they have been leaning in \u2192 that is a STALL WEARING A NO-NEED COSTUME. It stays an objection, category fear.',
    '      \u2022 When you cannot point to the stated reason, it is NOT a disqualification. Default to the objection.',
    '  TEST 2 \u2014 ONLY IF THEY WANT IT: can the prospect buy right now if they decide to? If they genuinely CANNOT AFFORD IT \u2014 they want it and the money is simply not there \u2014 that is a FINANCIAL DISQUALIFICATION, NOT an objection. Do NOT emit it as type="objection"; emit it as type="disqualify_signal" instead. A disqualification is not a coaching failure: there was nothing the closer could have done differently.',
    '  ⚠ THE DISCRIMINATOR IN ONE LINE: WILLING BUT UNABLE is a disqualification (cannot afford) or logistical (externally blocked). ABLE BUT HESITANT is fear. Only the hesitant one is coachable.',
    '  - objection_category: exactly one of these four values:',
    '      "fear"       — the prospect CAN afford it and is hesitating. This is the coachable one, and it is the DEFAULT for a money-phrased objection from someone who has the means. ⚠ THE STATED EXCUSE IS NOT THE CLASSIFICATION: wanting more proof, questioning whether it is legitimate, wanting to "think about it", or needing to "run it by" someone are all fear when the prospect can afford it. Prospects never say "I am scared" — at most "I am nervous", and usually they say something that sounds practical instead.',
    '      "logistical" — the prospect WANTS to buy and PHYSICALLY CANNOT right now because of something OUTSIDE their control: funds locked until a date, a declined card, a financing mechanism that failed, a hard scheduling blocker. They cannot decide their way out of it. NOT a coaching failure — there was nothing the closer could have done.',
    '      "timing"     — "not now", "call me next quarter", "after X happens" — a deferral about WHEN, not whether.',
    '      "partner"    — the prospect must consult SOMEONE ELSE before deciding — spouse, partner, business partner, parent, anyone. The category is defined by THE NEED TO CONSULT, not by who that person is. When you use "partner", the observation MUST cite the prospect\'s own framing (quote how they referenced the partner).',
    '  - resolution: exactly one of "handled" (closer resolved it and advanced toward the close), "partial" (partially addressed but prospect stayed hesitant), or "unhandled" (left unresolved).',
    '',
    '',
    'FOR type="risk_signal" AND type="barrier" MOMENTS, also include this field (omit it for every other type):',
    '  - handling: exactly one of "addressed", "deflected", "ignored". THE TEST: did the closer engage with the SUBSTANCE of what the prospect raised, or acknowledge it and move on? Warmth, length and sympathy are NOT engagement — a long, kind reply that never touches the concern is "deflected": after a prospect disclosed losing $300,000, "Don\'t bring the ex-girlfriend into the conversation with a date with the hot blonde. I respect it. I know what you went through" is DEFLECTED, because it validates the feeling and never touches the concern. ⚠ BUT THE TEST CUTS BOTH WAYS: a CHALLENGE IS ENGAGEMENT — arguably its strongest form. Pushing back, calling out a contradiction or asking a pointed question is "addressed", not "deflected". When a prospect said they had watched the videos for a year, "It\'s taking you a year to finally reach out to us?" is ADDRESSED — it confronts the substance head on. Engagement is about whether the concern was TOUCHED, not whether the closer was comfortable or agreeable. Use "ignored" when the closer did not respond at all.',
    '',
    /* ⚠⚠ EVERY CITABLE TYPE, NOT THE THREE THAT OBVIOUSLY NEEDED IT. Measured on
       8,238 real moments: only objection (98%), risk_signal (94%) and barrier
       (97%) carried a closer_response — buying_signal 0/2428, strong_moment
       0/929, missed_opportunity 0/909, rapport_moment 0/154,
       disqualify_signal 0/116. So 55% of moments had NO closer side.
       ⚠⚠ THAT IS WHY COACHING EVIDENCE QUOTES THE WRONG PERSON. When the
       synthesis claims something about the CLOSER, a buying-signal moment can
       only offer what the PROSPECT said — it cannot quote the thing it is
       talking about. Measured at 69% of what-to-improve evidence.
       ⚠ `missed_opportunity` is the sharpest case: a type whose entire meaning
       is that the closer missed something, recording nothing about what he did. */
    'FOR EVERY MOMENT OF EVERY TYPE, also include closer_response:',
    '  - closer_response: what the CLOSER said in reply to this moment — a contiguous verbatim span from ONE of his transcript lines. TAKE THE SINGLE SHARPEST LINE, NOT THE FULLEST REPLY — quote ONE transcript line, the one that best captures how he answered, rather than stitching several together. If you do span more than one line, include every word in between, including short interjections you would naturally leave out ("You know what I mean?", "Right."), because dropping words from the middle breaks the span and the quote is DISCARDED. A short quote that survives beats a fuller one that does not. Copy exactly per the HOW TO QUOTE rules above. This is used to coach the closer from his OWN real language, so a paraphrase is useless — it is discarded.',
    '  - This is needed on EVERY type, including buying_signal, strong_moment, missed_opportunity, rapport_moment and disqualify_signal. On those it is the closer\'s side of the exchange: what he said when the prospect gave a buying signal, or what he said instead of acting on it.',
    /* ⚠⚠ "HE SAID NOTHING" IS A RESULT, NOT MISSING DATA — and on a
       missed_opportunity it may be the most coachable fact on the call. A single
       null would collapse "he did not answer" into "we could not find it", which
       is the absent-vs-excluded failure. The two are given different values so a
       reader can tell them apart. */
    '  - WHICH LINE COUNTS AS THE REPLY: his response IN THE SAME EXCHANGE — what he said when he took the floor back, directly after this moment. DO NOT search later in the call for a line that fits: a reply lifted from a different exchange is worse than no reply, because it reads as evidence and is about something else. If his next contribution is not a response to this moment, treat it as no reply.',
    '  - IF THE CLOSER DID NOT REPLY AT ALL — the prospect spoke and he moved straight on, or said nothing — use the exact string "__no_reply__". That is a real and often important finding, not a gap in the data, and on a missed opportunity it is frequently the point.',
    '  - IF THIS MOMENT IS ALREADY THE CLOSER SPEAKING (his own strong line, his own missed opportunity), his side is not missing — it IS the quote. Use the exact string "__moment_is_closer__". Do NOT go looking for another line of his.',
    '  - Use null ONLY when he did reply but you cannot produce an exact verbatim span. Do not guess, and do not paraphrase: a paraphrase is discarded.',
    '',
    'Order moments chronologically (earliest first).',
    '',
    'Quality gate: if fewer than 5 genuinely high-signal moments exist in this call, return only the ones that qualify. Never pad to reach a minimum count. An array of 3 honest moments is better than 8 diluted ones.',
    '',
    'Respond with ONLY a JSON array — no markdown, no code fences, no narrative wrapping:',
    '[',
    '  {"timestamp_seconds":N,"speaker":"PROSPECT","quote":"...","observation":"...","section":"objection","type":"objection","objection_surface":"too expensive","objection_category":"fear","resolution":"handled","closer_response":"..."},',
    '  {"timestamp_seconds":N,"speaker":"CLOSER","quote":"...","observation":"...","section":"discovery","type":"strong_moment"},',
    '  ...',
    ']',
    '',
    'TRANSCRIPT:',
    transcriptText,
  ].join('\n');
}

// ─── Output sanitizers ────────────────────────────────────────────────────
// Validates Claude's section output against the schema CHECK constraints.
// Coerces invalid values to NULL rather than throwing — partial output is
// better than no analysis. The schema allows NULL on every section column.
// cash_collected guard (v7): numbers, plus clean string formats normalized —
// leading $, thousands separators, plain numeric strings (the model sometimes
// echoes the transcript's formatting despite the prompt asking for a number).
// Anything that doesn't normalize unambiguously to a single non-negative
// amount → 0; then the same bounds (0–$1M) + cents rounding. The
// never-fabricate rule is unchanged — this widens FORMAT tolerance only,
// never inference.
function sanitizeCashCollected(v) {
  var n = null;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    var t = v.trim().replace(/^\$/, '');
    // Exactly one clean amount: 1234 | 1,234 | 1234.56 | 1,234.56
    if (/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(t) || /^\d+(\.\d{1,2})?$/.test(t)) {
      n = parseFloat(t.replace(/,/g, ''));
    }
  }
  if (typeof n !== 'number' || !isFinite(n)) return 0;
  if (n < 0 || n > 1000000) return 0;
  return Math.round(n * 100) / 100;
}

// payment_structure guard (v8): allowlist, case-normalized; anything unknown
// → 'none_stated'. Coupling enforced HERE, not just in the prompt: a non-closed
// outcome always yields 'none_stated' whatever the model said.
function sanitizePaymentStructure(v, outcome) {
  if (outcome !== 'closed') return 'none_stated';
  var t = (typeof v === 'string') ? v.trim().toLowerCase() : '';
  return VALID_PAYMENT_STRUCTURES.indexOf(t) !== -1 ? t : 'none_stated';
}

// eod_summary guard (v8): non-empty string, trimmed, capped to 2000; else null
// (NULL = "no v8 summary" — the EOD view falls back to overall_summary).
// qualification_covered — a measurement-only field (v12). Fails CLOSED: anything
// malformed becomes {financial:false, evidence:null} rather than a truthy guess,
// because a field that over-reports coverage is worse than one that under-reports
// (the whole point is to measure how often the ground is actually covered).
function sanitizeQualificationCovered(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { financial: false, evidence: null };
  var fin = (v.financial === true);
  var ev = (typeof v.evidence === 'string' && v.evidence.trim()) ? v.evidence.trim().slice(0, 400) : null;
  // A true with no evidence is not trustworthy — the contract asks for a quote.
  if (fin && !ev) return { financial: false, evidence: null };
  return { financial: fin, evidence: fin ? ev : null };
}

function sanitizeEodSummary(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim().slice(0, 2000);
}

function sanitizeSection(s) {
  if (!s || typeof s !== 'object') return { grade: null, score: null, notes: null };
  var grade = (typeof s.grade === 'string' && VALID_GRADES.indexOf(s.grade.toUpperCase()) !== -1)
    ? s.grade.toUpperCase()
    : null;
  var score = (typeof s.score === 'number' && s.score >= 0 && s.score <= 100)
    ? Math.round(s.score)
    : null;
  var notes = (typeof s.notes === 'string') ? s.notes.slice(0, 4000) : null;
  return { grade: grade, score: score, notes: notes };
}

// Clamp a Claude-supplied timestamp to a sane integer second within the call.
// Mirrors sanitizeHighlights' bound: reject negatives and anything wildly past
// the recording's end. Returns null when unusable (so the clip link degrades
// to a plain, unlinked reason).
function boundTs(v, durationSeconds) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  var ts = Math.floor(v);
  if (ts < 0) return null;
  if (durationSeconds != null && ts > durationSeconds + 60) return null;
  return ts;
}

// Validates the highlight array — drops any row with the wrong shape or
// out-of-vocabulary type/speaker. Caps at MAX_HIGHLIGHTS. Assigns
// sequence_order in encounter order (Claude is asked to sort chronologically
// already, but we don't rely on it).

// ─── speaker-anchoring guard ────────────────────────────────────────────────
// barrier / risk_signal / objection describe the PROSPECT'S position. They
// cannot be anchored on a closer-spoken line.
//
// Live failure this exists to stop: two moments typed `barrier` carried
// speaker=CLOSER and quoted the closer's own finances ("Dude, I just burnt
// through $100,000…") while their observations read "Prospect disclosed no
// liquid capital." Speaker attribution was CORRECT — the extractor ignored it
// when interpreting. A prompt line would be the adjective-not-operation trap;
// this is enforced where it cannot be talked around.
//
// REJECT rather than reclassify: the observation is written from the same
// mistaken premise as the type, so retyping the row would keep prose asserting
// the prospect said something they never said, and the sanitizer cannot rewrite
// an observation. Dropping costs one moment out of the 5-8 emitted.
// ⚠ DERIVED FROM THE CORPUS, NOT ROUNDED. Cue->obstacle gaps cluster: the
// degenerate pairs (the "obstacle" is the same moment restated — one had the
// cue at 0:45 and the obstacle at 1:59, the prospect saying he was on a flight
// twice) top out at 101s, and the next genuine pair is at 183s. Any threshold
// in that empty band excludes exactly the degenerate cluster and no real pair;
// 120 sits mid-band with margin either side. Removes 7 of 51 pairs.
//
// A SECTION constraint (cue in discovery, obstacle at close) was measured and
// REJECTED: it halves eligible calls (20 -> 10) and discards legitimately
// coachable pitch->close, intro->close and discovery->objection shapes.
var MIN_CUE_GAP_SECONDS = 120;

var PROSPECT_POSITION_TYPES = ['barrier', 'risk_signal', 'objection'];


// ─── 9a: the missed cue, paired in the WORKER ──────────────────────────────
//
// ⚠ WHY HERE AND NOT IN A PROMPT. This shape is DEFINED by the extractor's own
// output — risk_signal + handling + timestamps. The grader cannot see any of
// it, so when the field lived there it re-derived the judgement blind and
// declined on 8 of 8 calls that demonstrably contain the shape. The worker
// holds both models' output at once, which makes the pairing arithmetic.
//
// ⚠ NO MODEL "DECLINE" STEP, DELIBERATELY (ruling 2026-08-13). The claim is two
// FACTS, both already established: the prospect raised this (a typed
// risk_signal whose quote is proven as their words) and the closer did not dig
// (handling deflected/ignored, judged at CAPTURE with the transcript in view).
// It never claims the obstacle was caused by the miss, and the surface refuses
// that reading outright. The judgement is already made where the evidence was;
// asking a second model to re-make it blind is what produced 0/8.
//
// SELECTION: one pair per call — the EARLIEST unaddressed cue, with its FIRST
// qualifying obstacle. Measured: 44 pairs across 20 calls but only 24 distinct
// cues, so the multiplication is mostly one cue against several later
// obstacles; showing them all is repetition, not coaching. The cue anchors the
// story ("where the time went") and the first consequence proves it bit — the
// last would inflate the elapsed gap.
function selectMissedCuePair(highlights, minGap) {
  var arr = Array.isArray(highlights) ? highlights : [];
  var ts = function (h) { return (typeof h.timestamp_seconds === 'number') ? h.timestamp_seconds : null; };
  var proven = function (h) { return h.speaker_verified === true; };

  var cues = arr.filter(function (h) {
    return h.type === 'risk_signal' && (h.handling === 'deflected' || h.handling === 'ignored')
      && ts(h) !== null && proven(h);
  }).sort(function (a, b) { return ts(a) - ts(b); });

  var obstacles = arr.filter(function (h) {
    return (h.type === 'barrier' || h.type === 'objection') && ts(h) !== null && proven(h);
  }).sort(function (a, b) { return ts(a) - ts(b); });

  var gap = (typeof minGap === 'number') ? minGap : MIN_CUE_GAP_SECONDS;
  for (var i = 0; i < cues.length; i++) {
    for (var j = 0; j < obstacles.length; j++) {
      if (ts(obstacles[j]) - ts(cues[i]) >= gap) {
        return {
          cue_quote: cues[i].quote, cue_timestamp_seconds: ts(cues[i]),
          closer_said: closerSide.displayCloserResponse(cues[i].closer_response),
          obstacle_quote: obstacles[j].quote, obstacle_timestamp_seconds: ts(obstacles[j]),
          gap_seconds: ts(obstacles[j]) - ts(cues[i]), verified: true,
        };
      }
    }
  }
  return null;
}

function violatesProspectAnchor(h) {
  if (!h || typeof h !== 'object') return false;
  if (PROSPECT_POSITION_TYPES.indexOf(h.type) === -1) return false;
  return h.speaker === 'CLOSER';
}

function sanitizeHighlights(arr, durationSeconds) {
  if (!Array.isArray(arr)) return [];
  var out = [];
  for (var i = 0; i < arr.length && out.length < MAX_HIGHLIGHTS; i++) {
    var h = arr[i];
    if (!h || typeof h !== 'object') continue;
    var ts = (typeof h.timestamp_seconds === 'number') ? Math.floor(h.timestamp_seconds) : null;
    if (ts == null || ts < 0) continue;
    // Don't accept timestamps wildly outside the call's duration (defense
    // against Claude hallucinating a moment past the end). +60s grace allowed.
    if (durationSeconds != null && ts > durationSeconds + 60) continue;
    var speaker = (typeof h.speaker === 'string') ? h.speaker.toUpperCase() : null;
    if (VALID_HIGHLIGHT_SPEAKERS.indexOf(speaker) === -1) continue;
    if (typeof h.quote !== 'string' || !h.quote.trim()) continue;
    if (typeof h.observation !== 'string' || !h.observation.trim()) continue;
    var type = (typeof h.type === 'string') ? h.type.toLowerCase() : null;
    if (VALID_HIGHLIGHT_TYPES.indexOf(type) === -1) continue;
    // Prospect-position types cannot be anchored on a closer-spoken line.
    if (violatesProspectAnchor({ type: type, speaker: speaker })) {
      console.warn('[analysis] dropped %s anchored on a CLOSER line: "%s"', type, String(h.quote).slice(0, 60));
      continue;
    }
    // Objection sub-fields: only kept for type='objection'; coerced to null
    // (not dropped) when missing/invalid so a bad value never loses the moment.
    var objSurface = null;
    var objClass = null;
    var objCategory = null;
    var resolution = null;
    var closerResponse = null;
    var objHandled = null;
    // 8a: risk_signal/barrier carry the closer's reply and whether he engaged
    // with it. Deliberately NOT given `resolution` — that belongs to objections
    // and the handle rate reads it; two competing "was it dealt with" fields on
    // one row is a bug factory. Equally, an objection does not carry `handling`.
    var handling = null;
    if (type === 'risk_signal' || type === 'barrier') {
      var hv = (typeof h.handling === 'string') ? h.handling.toLowerCase().trim() : null;
      handling = (VALID_HANDLING.indexOf(hv) !== -1) ? hv : null;
    }
    if (type === 'objection') {
      objSurface = (typeof h.objection_surface === 'string' && h.objection_surface.trim())
        ? h.objection_surface.trim().slice(0, 80) : null;
      /* ⚠ CACHED AT ANALYSIS TIME so no surface has to re-derive it with a model
         call — see lib/objection-strict.js. Bad or missing values coerce to NULL,
         which the readers treat as "count it" (the pre-057 loose behaviour). */
      objClass = sanitizeObjectionClass(h.objection_class);
      var cat = (typeof h.objection_category === 'string') ? h.objection_category.toLowerCase() : null;
      objCategory = (VALID_OBJECTION_CATEGORIES.indexOf(cat) !== -1) ? cat : null;
      var res = (typeof h.resolution === 'string') ? h.resolution.toLowerCase() : null;
      resolution = (VALID_RESOLUTIONS.indexOf(res) !== -1) ? res : null;
      // ⚠ DELIBERATELY NOT the shared isHandled() predicate (ruling 2026-08-17).
      // This asks "was this a GOOD MOMENT?", not "what is the rate?". A moment
      // inside a closed call is not automatically a good moment, and crediting it
      // here would file weak handling under "what worked" — the opposite of
      // coaching. The rate surfaces credit closed calls; these five do not.
      objHandled = (resolution === null) ? null : (resolution === 'handled'); // back-compat with mig 012 column
    }
    /* ⚠⚠ v29: EVERY TYPE, and this line is the whole fix. closerResponse used to
       be assigned ONLY inside the two type gates above, so for the other five
       types the model's answer was DISCARDED HERE — silently, after the prompt
       had asked for it and the model had supplied it.
       ⚠ THE FIRST v29 SHIP MISSED THIS AND MEASURED CLEAN: the token gate read
       the model's RAW JSON and never ran the sanitizer, so it reported 12/12
       coverage while a 30-call re-grade wrote 0 of 137. A check at the model
       boundary cannot see a consumer that throws the value away. */
    closerResponse = (typeof h.closer_response === 'string' && h.closer_response.trim())
      ? h.closer_response.trim().slice(0, 1500) : null;
    out.push({
      timestamp_seconds:  ts,
      speaker:            speaker,
      quote:              h.quote.trim().slice(0, 1000),
      observation:        h.observation.trim().slice(0, 500),
      type:               type,
      handling:           handling,
      // Section tag (nullable): coerced to null when missing/invalid so a bad
      // value never loses the moment — same discipline as the objection sub-fields.
      section:            sanitizeSectionValue(h.section),
      objection_surface:  objSurface,
      objection_class:    objClass,
      objection_category: objCategory,
      objection_handled:  objHandled,
      resolution:         resolution,
      closer_response:    closerResponse,
      sequence_order:     out.length + 1,
    });
  }
  return out;
}

// Persist a call's highlights with a NO-WIPE-ON-FAILURE ordering (house rule):
// the prior rows are deleted ONLY AFTER the new set is successfully inserted, so
// a failed/empty extraction — realistic on a large backfill — never leaves a call
// with zero highlights. Steps: (1) empty new set → do nothing, keep existing;
// (2) capture the prior rows' ids; (3) insert the new set; if that fails, keep
// existing (no delete); (4) only then delete exactly the prior ids. If the final
// cleanup fails, the new set is already saved (dupes self-heal next run) — never a
// wipe. Non-fatal throughout (grades are already saved). Exported for tests.
async function persistHighlights(admin, fathomCallId, userId, sanitizedHighlights) {
  if (!sanitizedHighlights || sanitizedHighlights.length === 0) {
    console.warn('[analysis] no new highlights extracted for ' + fathomCallId + ' — preserving existing highlights (no delete)');
    return { inserted: 0, deleted: 0, kept_existing: true };
  }

  // Capture the prior rows BEFORE inserting so we can delete exactly those after.
  var existing = await admin.from('call_highlights').select('id').eq('fathom_call_id', fathomCallId);
  var oldIds = (existing && existing.data ? existing.data : []).map(function (r) { return r.id; });
  if (existing && existing.error) {
    // Couldn't read the old ids — proceed with insert anyway (worst case: old
    // rows linger as dupes and self-heal next run). NEVER a data-loss path.
    console.warn('[analysis] highlight old-id read failed for ' + fathomCallId + ' (proceeding; dupes may linger): ' + existing.error.message);
  }

  var rows = sanitizedHighlights.map(function (h) {
    return Object.assign({ fathom_call_id: fathomCallId, user_id: userId }, h);
  });
  var ins = await admin.from('call_highlights').insert(rows);
  if (ins && ins.error) {
    // Insert failed → DO NOT delete. Existing highlights stay intact; the next
    // re-analysis retries.
    console.warn('[analysis] highlight insert failed for ' + fathomCallId + ' — keeping existing highlights (no delete): ' + ins.error.message);
    /* ⚠ THE REASON TRAVELS WITH THE RESULT. A failed insert leaves a call with
       zero highlights and is INDISTINGUISHABLE from an extraction that found
       none — the exact confusion that made the Zoom investigation take days.
       The caller records it on the row. */
    return { inserted: 0, deleted: 0, kept_existing: true, error: 'insert failed: ' + ins.error.message };
  }

  // New set is safely in — now delete exactly the prior rows.
  var deleted = 0;
  if (oldIds.length > 0) {
    var del = await admin.from('call_highlights').delete().in('id', oldIds);
    if (del && del.error) {
      // New highlights saved; old rows lingering is cosmetic and self-heals on
      // the next re-analysis. Not a wipe — log and move on.
      console.warn('[analysis] old-highlight cleanup failed for ' + fathomCallId + ' (new set saved; dupes self-heal next run): ' + del.error.message);
    } else {
      deleted = oldIds.length;
    }
  }
  return { inserted: rows.length, deleted: deleted, kept_existing: false };
}

// Upserts a call_analyses row to the given status. Used for the initial
// "processing" mark AND for terminal "error" / "done" updates. Pass extraFields
// to populate columns alongside the status (analyzed_at, overall_summary,
// section grades, etc.).
//
// onConflict='fathom_call_id' makes this idempotent — re-runs replace prior
// analysis rather than dup-error. Non-fatal on failure: logs and continues so
// a write-during-error path doesn't mask the original failure.
async function setAnalysisStatus(admin, fathomCallId, userId, status, extraFields) {
  var payload = Object.assign({
    fathom_call_id: fathomCallId,
    user_id:        userId,
    status:         status,
  }, extraFields || {});
  var result = await admin
    .from('call_analyses')
    .upsert(payload, { onConflict: 'fathom_call_id' });
  if (result.error) {
    console.error('[analysis] setAnalysisStatus(' + status + ') failed for call ' + fathomCallId + ': ' + result.error.message);
  }
  return result;
}

// Flip fathom_calls.sync_status to 'error' so the row is distinguishable
// from never-attempted ('pending') and successfully-analyzed ('processed').
// Called alongside setAnalysisStatus(..., 'error', ...) at every error exit
// in analyzeCall — without this, the call sticks in 'pending' forever
// because /sync only dispatches newly-inserted rows. A future manual retry
// route + dashboard button (Phase 2 follow-up) will target sync_status='error'
// rows. Non-fatal on failure: logs and continues so a write-during-error path
// doesn't mask the original failure.
async function markFathomCallErrored(admin, fathomCallId, userId) {
  var result = await admin
    .from('fathom_calls')
    .update({ sync_status: 'error' })
    .eq('id', fathomCallId)
    .eq('user_id', userId);
  if (result.error) {
    console.error('[analysis] markFathomCallErrored failed for call ' + fathomCallId + ': ' + result.error.message);
  }
  return result;
}

// How long a 'processing' claim stays valid before another run may steal it.
// Sized from real drain data (2026-07 batches: p50 50s, p95 64s, max 247s per
// call) — 10 min is ~2.4x the longest observed analysis, so a live run is never
// preempted, while a crashed run (Railway redeploy mid-drain) self-heals
// without the manual status reset the old flow needed.
var CLAIM_STALE_MS = 10 * 60 * 1000;

// Atomically claim this call's analysis run. Returns true when this run may
// proceed, false when another run holds a fresh claim (caller must exit as a
// quiet no-op). Why: the dispatch loops (/sync, /reanalyze, /update-analyses)
// share no lock, so two overlapping dispatches could both analyze the SAME
// call — double Claude spend, and the non-atomic highlight delete+insert let
// both sets persist (the 2026-07-20 duplicate-objections bug).
//
// Atomicity, without client-side transactions:
//   • Row exists → ONE conditional UPDATE. Concurrent updates serialize on the
//     row lock; the loser re-evaluates the WHERE against the winner's committed
//     claim and matches 0 rows.
//   • No row yet → INSERT; the unique index on fathom_call_id (the upsert's
//     onConflict target) makes the loser's insert fail cleanly.
// analyzed_at doubles as the claim timestamp while status='processing' (it is
// overwritten at every terminal upsert anyway). NULL branches are explicit in
// the .or() per the 2026-07 silent-null lesson: NULL status and NULL
// analyzed_at must both be claimable, or pre-claim rows become unclaimable.
async function claimAnalysisRun(admin, fathomCallId, userId, nowIso) {
  var cutoffIso = new Date(new Date(nowIso).getTime() - CLAIM_STALE_MS).toISOString();
  var upd = await admin
    .from('call_analyses')
    .update({ status: 'processing', analyzed_at: nowIso, user_id: userId })
    .eq('fathom_call_id', fathomCallId)
    .or('status.neq.processing,status.is.null,analyzed_at.is.null,analyzed_at.lt.' + cutoffIso)
    .select('id');
  if (upd.error) {
    // Fail closed: without a registered claim we must not run (the race would
    // be back). The row stays pending and rides the next batch.
    console.error('[analysis] claim update failed for call ' + fathomCallId + ' — not proceeding: ' + upd.error.message);
    return false;
  }
  if (upd.data && upd.data.length > 0) return true;

  // 0 rows: either no call_analyses row exists yet, or another run holds a
  // fresh claim. Try to create the row — the unique index arbitrates.
  var ins = await admin
    .from('call_analyses')
    .insert({ fathom_call_id: fathomCallId, user_id: userId, status: 'processing', analyzed_at: nowIso })
    .select('id');
  if (!ins.error && ins.data && ins.data.length > 0) return true;
  // 23505 (unique violation) = we lost the race — expected and quiet. Anything
  // else is a real failure worth surfacing; either way we fail closed.
  if (ins.error && ins.error.code !== '23505') {
    console.error('[analysis] claim insert failed for call ' + fathomCallId + ' — not proceeding: ' + ins.error.message);
  }
  return false;
}

/**
 * Analyze a single Fathom call end-to-end. Designed for the fire-and-forget
 * IIFE in routes/fathom.js /sync, but safe for manual re-runs (idempotent
 * upserts; old highlights deleted before fresh insert).
 *
 * @param {string} fathomCallId  the public.fathom_calls(id) UUID, NOT Fathom's recording_id
 * @param {string} userId        auth.users(id)
 * @returns {Promise<{status: 'done'|'error', ...}>}
 */
async function analyzeCall(fathomCallId, userId) {
  /* ⚠ Hand the usage log a database client. It is INJECTED rather than built
     inside model-usage because this function already holds one, and creating a
     second Supabase client per model call would be a real cost for a log line.
     A lane that never calls this simply does not record — measured absence. */
  try { setUsageRecorder(getAdminClient()); } catch (e) { /* logging is optional */ }
  var admin = getAdminClient();
  console.log('[analysis] start call ' + fathomCallId + ' (user=' + userId + ', prompt_version=' + ANALYSIS_PROMPT_VERSION + ')');

  try {
    // ─── Phase 1: claim the run (atomic; replaces the blind 'processing' upsert) ──
    // was: await setAnalysisStatus(admin, fathomCallId, userId, 'processing');
    //      (blind upsert — replaced 2026-07-22 by the atomic claim: two
    //      overlapping dispatch loops could both pass it and double-analyze)
    var claimed = await claimAnalysisRun(admin, fathomCallId, userId, new Date().toISOString());
    if (!claimed) {
      // Another dispatch loop is already analyzing this call (or just did).
      // Quiet no-op — NOT an error: no status change, no Claude spend.
      console.log('[analysis] claim lost for call ' + fathomCallId + ' (user=' + userId + ') — another run holds it; skipping');
      return { status: 'skipped', reason: 'claim_held_by_another_run' };
    }

    // ─── Phase 2: load the fathom_calls row ───────────────────────────────
    var callQ = await admin
      .from('fathom_calls')
      /* ⚠⚠ not_a_sales_call IS IN THIS SELECT DELIBERATELY. The harvest gate
         reads callRow.not_a_sales_call; omit the column and it is `undefined`,
         `undefined === true` is false, and THE GATE SILENTLY NEVER FIRES — the
         component is correct and the thing that reaches it is broken. That exact
         missing-column bug has shipped here three times (the review page's
         `section`/`resolution`, and `id` on the highlights select). */
      .select('id, fathom_call_id, call_date, duration_seconds, user_id, title, recording_url, source, not_a_sales_call, not_sales_marked_by, exclusion_reason, calendar_invitees, title_name_segment')
      .eq('id', fathomCallId)
      .maybeSingle();
    if (callQ.error) throw new Error('fathom_calls fetch: ' + callQ.error.message);
    if (!callQ.data) throw new Error('fathom_calls row not found: ' + fathomCallId);
    if (callQ.data.user_id !== userId) {
      throw new Error('Scope mismatch: call ' + fathomCallId + ' does not belong to user ' + userId);
    }
    var callRow = callQ.data;
    /* Attempt counter for the transcript retry bound (migration 047). Read once
       here; fails CLOSED to a spent counter if the column is unreadable. */
    var callRow_attempts = 0;
    var modelAttempts = 0;
    try {
      var attQ = await admin.from('call_analyses').select('transcript_attempts, model_attempts').eq('fathom_call_id', fathomCallId).maybeSingle();
      callRow_attempts = (attQ && attQ.data && typeof attQ.data.transcript_attempts === 'number')
        ? attQ.data.transcript_attempts : 0;
      modelAttempts = (attQ && attQ.data && typeof attQ.data.model_attempts === 'number')
        ? attQ.data.model_attempts : 0;
    } catch (e) {
      callRow_attempts = fathomRetry.MAX_TRANSCRIPT_ATTEMPTS;
      modelAttempts = modelRetry.MAX_MODEL_ATTEMPTS;   // fail CLOSED, as above
    }

    // ─── Phase 3+4: fetch the transcript, SOURCE-AWARE ────────────────────
    // Everything downstream (normalize → grade → extract) is source-agnostic:
    // both branches produce `transcript` = an array of
    //   { speaker: { display_name }, text, timestamp: "HH:MM:SS" }
    // that feeds the same `meeting` object below. Only token store + fetch differ.
    //
    // Shared error exit: on any token/transcript failure, mark the analysis +
    // fathom_calls row errored with a human reason and stop (recoverable — the
    // user can retry via Update-analyses / a later sync).
    async function failTranscript(reason) {
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: reason,
        analyzed_at:     new Date().toISOString(),
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + reason + ' (call=' + fathomCallId + ' user=' + userId + ')');
      return { status: 'error', reason: reason };
    }

    /**
     * ⚠⚠ A ZOOM TRANSCRIPT THAT ISN'T READY YET IS NOT A FAILED CALL.
     * Zoom produces the recording first and the transcript minutes later, so a
     * sweep landing in that window used to error the call PERMANENTLY — the
     * sync upserts with ignoreDuplicates and no route moves 'error' back to
     * 'pending', so nothing and nobody could retry it.
     *
     * Requeueing leaves BOTH statuses at 'pending', which is the state the
     * dashboard's reanalyze path already dispatches — so the call is genuinely
     * recoverable rather than merely differently stuck. The reason is still
     * written to overall_summary so the state is legible in the DB.
     * Bounded by call age in lib/zoom-retry.js: the "not ready" and "was never
     * recorded with transcription" cases are textually identical, and age is
     * the only thing that separates them.
     */
    /* ⚠ ONE REQUEUE, THREE CALLERS (transcript-not-ready, model failure, unusable
       model output). `why` is a label for the log line ONLY — the behaviour is
       identical for all three and must stay that way, or "recoverable" comes to
       mean different things on different paths. */
    async function requeueTranscript(reason, why) {
      await setAnalysisStatus(admin, fathomCallId, userId, 'pending', {
        overall_summary: reason,
        analyzed_at:     new Date().toISOString(),
      });
      var rq = await admin.from('fathom_calls').update({ sync_status: 'pending' })
        .eq('id', fathomCallId).eq('user_id', userId);
      if (rq.error) console.error('[analysis] requeue failed for call ' + fathomCallId + ': ' + rq.error.message);
      console.warn('[analysis] REQUEUED (' + (why || 'transcript not ready') + ') ' + reason
        + ' (call=' + fathomCallId + ' user=' + userId + ')');
      return { status: 'requeued', reason: reason };
    }

    var transcript;
    // Zoom's own display name for the connected account — the closer-side half
    // of the byte-identical match. Stays null for Fathom, where the per-turn
    // invitee email is a strictly better identity and fires first.
    var zoomDisplayName = null;
    if (transcriptSourceFor(callRow) === 'zoom') {
      // ── Zoom ── token via call_connections (serialized single-flight refresh —
      // Zoom's single-use rotating refresh tokens make this mandatory), transcript
      // via /meetings/{uuid}/recordings → the transcript VTT → the VTT adapter.
      var zoomToken;
      try {
        zoomToken = await callConnections.getValidAccessToken(admin, userId, 'zoom');
      } catch (zTokErr) {
        return await failTranscript('Zoom token unavailable for user ' + userId + ': ' + ((zTokErr && zTokErr.message) || 'unknown'));
      }
      try {
        var zres = await zoomClient.fetchTranscriptWithMeta(zoomToken, callRow.fathom_call_id);
        transcript = parseVttToTranscript(zres.vtt);
        /* ⚠ BEST-EFFORT, AND DELIBERATELY NOT AWAITED INTO THE FAILURE PATH:
           a display name we cannot fetch means speaker identity degrades to
           silence, exactly as it does today. It must never fail an analysis
           that already has a transcript in hand — same rule the metadata
           refresh below follows. */
        zoomDisplayName = await zoomClient.getMyDisplayName(zoomToken);
        /* ⚠ REFRESH THE STALE SYNC METADATA. A requeued call was first synced
           while the recording was still processing, when Zoom reports duration 0
           — and nothing else ever re-reads it. Best-effort: a metadata refresh
           must never fail an analysis that has a transcript in hand. */
        try {
          var patch = {};
          if (zres.duration_seconds && !callRow.duration_seconds) patch.duration_seconds = zres.duration_seconds;
          if (zres.meeting_id && !callRow.meeting_id) patch.meeting_id = zres.meeting_id;
          if (Object.keys(patch).length) {
            await admin.from('fathom_calls').update(patch).eq('id', fathomCallId).eq('user_id', userId);
          }
        } catch (mErr) {
          console.warn('[analysis] zoom metadata refresh failed for ' + fathomCallId + ': ' + ((mErr && mErr.message) || 'unknown'));
        }
      } catch (zErr) {
        var zReason = 'Zoom transcript fetch failed for meeting ' + callRow.fathom_call_id
          + ': ' + ((zErr && zErr.message) || 'unknown');
        // not-ready-yet → requeue (free: this is before any Claude call).
        // Anything else — bad token, missing scope — is a real failure.
        if (zoomRetry.shouldRequeue(zReason, callRow.call_date)) return await requeueTranscript(zReason);
        return await failTranscript(zReason);
      }
    } else {
      // ── Fathom (unchanged) ── fathom_connections token + /recordings/{id}/transcript.
      // findMeeting() is bypassed (kept below, unused): everything the pipeline
      // needs is on callRow (Phase 2) plus the transcript pulled straight from the
      // recording endpoint by stored recording_id. Fathom highlights skipped (the
      // Claude extractor derives them); recorded_by null → Claude infers roles.
      var connQ = await admin
        .from('fathom_connections')
        .select('access_token, refresh_token, expires_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (connQ.error) throw new Error('fathom_connections fetch: ' + connQ.error.message);
      if (!connQ.data) throw new Error('Fathom connection not found for user ' + userId);
      var accessToken = await fathomRoutes._getValidAccessToken(admin, userId, connQ.data);
      try {
        transcript = await fathomRoutes._fetchRecordingTranscript(accessToken, callRow.fathom_call_id);
        /* A clean fetch clears the counter — the bound is CONSECUTIVE temporary
           failures, not lifetime ones. */
        if ((callRow_attempts || 0) > 0) {
          await admin.from('call_analyses').update({ transcript_attempts: 0 }).eq('fathom_call_id', fathomCallId);
        }
      } catch (transcriptErr) {
        /* ⚠⚠ A TEMPORARY REFUSAL MUST NOT PERMANENTLY DESTROY THE CALL.
           This branch used to call failTranscript() for ANY error, and nothing
           moves 'error' back to 'pending' — so one HTTP 429 or 502 made the call
           a silent hole in the customer's data forever. 151 calls were lost that
           way in three minutes on 2026-08-25.
           lib/fathom-retry.js reads the HTTP status out of the message and
           requeues only what is genuinely temporary, bounded by attempts (NOT by
           call age — see that file for why Zoom's bound is wrong here). */
        var tMsg = (transcriptErr && transcriptErr.message) || 'unknown';
        var reason = 'Transcript fetch failed for recording_id ' + callRow.fathom_call_id + ': ' + tMsg;
        if (fathomRetry.shouldRequeue(tMsg, callRow_attempts)) {
          var nextAttempt = (callRow_attempts || 0) + 1;
          var waitFor = fathomRetry.retryAfterSeconds(tMsg);
          await admin.from('call_analyses').update({ transcript_attempts: nextAttempt }).eq('fathom_call_id', fathomCallId);
          return await requeueTranscript(reason + ' — temporary, requeued (attempt ' + nextAttempt
            + ' of ' + fathomRetry.MAX_TRANSCRIPT_ATTEMPTS + ')'
            + (waitFor ? '; Fathom asked for ' + waitFor + 's' : ''));
        }
        /* Permanent, or the attempt bound is spent — record WHICH, so a stuck
           call is legible rather than just "failed". */
        var why = (fathomRetry.classifyTranscriptFailure(tMsg) === 'temporary')
          ? ' — temporary but retried ' + fathomRetry.MAX_TRANSCRIPT_ATTEMPTS + ' times, giving up'
          : ' — permanent, not retried';
        return await failTranscript(reason + why);
      }
    }

    // DIAGNOSTIC (temporary): first live exercise of /recordings/{id}/transcript.
    // Log the turn count + raw first-turn JSON so we can confirm the per-turn
    // field names (speaker.display_name / text / timestamp) from Railway logs.
    // Remove once the transcript shape is verified against real data.
    console.log('[analysis] transcript length: ' + (Array.isArray(transcript) ? transcript.length : '(not an array)') + ' (call=' + fathomCallId + ' recording_id=' + callRow.fathom_call_id + ')');
    console.log('[analysis] transcript shape sample:', JSON.stringify(transcript && transcript[0]));

    // ─── Closer identity (6a) ────────────────────────────────────────────
    // Hoisted ABOVE normalize because the normalizer now needs it: speaker
    // labelling is deterministic via exact equality between the per-turn
    // `matched_calendar_invitee_email` and this address. Phase 6b (prospect
    // name) reuses the same lookup rather than issuing a second query.
    //
    // Failure is non-fatal by design: no email → speaker_confidence 'unknown'
    // → the model infers roles, exactly as before 6a. Degraded, never wrong.
    var closerEmail = null;
    try {
      var connTable = (transcriptSourceFor(callRow) === 'zoom') ? 'call_connections' : 'fathom_connections';
      var emailCol  = (connTable === 'call_connections') ? 'external_account_email' : 'fathom_email';
      var emailConnQ = admin.from(connTable).select(emailCol).eq('user_id', userId);
      if (connTable === 'call_connections') emailConnQ = emailConnQ.eq('provider', 'zoom');
      var emailConnRow = await emailConnQ.maybeSingle();
      var rawCloserEmail = emailConnRow && emailConnRow.data ? emailConnRow.data[emailCol] : null;
      if (rawCloserEmail && typeof rawCloserEmail === 'string') closerEmail = rawCloserEmail;
    } catch (connErr) {
      console.warn('[analysis] closer-identity lookup failed for ' + fathomCallId + ': ' + ((connErr && connErr.message) || 'unknown'));
    }

    // Minimal source-agnostic meeting object built from the DB row + transcript.
    var meeting = {
      recording_id:  callRow.fathom_call_id,
      title:         callRow.title,
      recording_url: callRow.recording_url,
      created_at:    callRow.call_date,
      transcript:    transcript,
      highlights:    [],    // Fathom highlights skipped — extractor derives them
      // recorded_by stays null — the legacy fuzzy NAME match is deliberately
      // not wired (it returned the CLOSER as the prospect on 6 of 83 calls).
      recorded_by:   null,
      closer_email:  closerEmail,  // 6a: exact-equality speaker labelling
      // Zoom only. A VTT carries display names ONLY, so closer_email can never
      // match there; this is the byte-identical fallback, collision-guarded.
      closer_display_name: zoomDisplayName,
    };

    // ─── Phase 5: normalize ──────────────────────────────────────────────
    var normalized = normalizeTranscript(meeting);
    /* ⚠ H700 — store the per-speaker identities (matched_calendar_invitee_email,
       once per call, never per turn) BEFORE any model call, so identity is kept
       even when grading fails. Fathom only: a Zoom VTT carries no emails, and the
       column must read NULL (not captured) there, never []. Captured, not resolved. */
    if (transcriptSourceFor(callRow) !== 'zoom') {
      await storeCallIdentities(admin, fathomCallId, userId, { speaker_identities: normalized.speaker_identities });
    }
    if (!normalized.turns || normalized.turns.length === 0) {
      // Include the raw first turn so a field-name mismatch between
      // /recordings/{id}/transcript and what normalizeTranscript expects
      // (turn.speaker.display_name / turn.text / turn.timestamp) is visible
      // directly on the dashboard error card — no Railway log access required.
      var rawSample = JSON.stringify(transcript && transcript[0]);
      if (rawSample && rawSample.length > 500) rawSample = rawSample.slice(0, 500) + '…';
      var emptyReason = 'No transcript turns after normalize (recording_id ' + callRow.fathom_call_id + '; fetched ' + (Array.isArray(transcript) ? transcript.length : 0) + ' raw turn(s)). First raw turn: ' + rawSample;
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: emptyReason,
        analyzed_at:     new Date().toISOString(),
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + emptyReason + ' (call=' + fathomCallId + ')');
      return { status: 'error', reason: emptyReason };
    }

    /* ─── Phase 5b: refuse to grade a COMPROMISED FILE ────────────────────
       Justin's ruling 2026-08-29. One distinct speaker across a substantial
       transcript means the model would be told one person said everything,
       including the prospect's objections — and it returns a confident score
       anyway (measured: 71, 47, 32, and a 100-minute Fathom call at 60).
       A confident number from an unreadable source is worse than none.

       PLACED BEFORE PHASE 6 ON PURPOSE: the call is never graded rather than
       graded-and-then-flagged, so no score is ever produced from it.

       IT REUSES not_a_sales_call AS THE EXCLUSION and records only the REASON
       separately — one flag, already filtered in 21 places, so a compromised
       file cannot drift out of step with the other exclusion.

       AND IT NEVER OVERRULES A PERSON. If someone has explicitly said this call
       counts (not_a_sales_call === false with a human in not_sales_marked_by),
       the detection is skipped — the same read-before-write guard that stops a
       re-analysis re-stamping a manually set outcome. Without it, un-marking
       would trigger a re-analysis that immediately re-marked the call. */
    var humanSaidItCounts = (callRow.not_a_sales_call === false && !!callRow.not_sales_marked_by);
    var fileCheck = compromisedFile.assessTranscript(normalized.turns);
    if (fileCheck.compromised && !humanSaidItCounts) {
      /* CUSTOMER LANGUAGE: this string renders on the call review page, so it
         says what happened and what they can do — never how it was detected.
         No speaker counts, no character counts, no internal names. */
      var compReason = 'This recording only captured one voice, so it could not be '
        + 'graded and is not counted in your numbers. If both sides were speaking, '
        + 'mark it as a sales call on this page to include it.';
      await admin.from('fathom_calls').update({
        not_a_sales_call:  true,
        exclusion_reason:  'compromised_file',
        /* marked_by stays NULL — no person marked this, and writing a user id
           would make an automatic exclusion indistinguishable from a human one,
           which is the very thing the override guard above reads. */
        not_sales_marked_by:   null,
        not_sales_marked_role: null,
        not_sales_marked_at:   new Date().toISOString(),
        sync_status: 'processed',
      }).eq('id', fathomCallId);
      /* ⚠⚠ CLEAR THE GRADE THIS CALL ALREADY CARRIES, AND ITS HIGHLIGHTS.
         A brand-new call has nothing to clear, so this is a no-op for them —
         but a call graded BEFORE the refusal shipped keeps its old score, and
         the review page would then show "this could not be graded" directly
         beside a confident 60 and three highlights quoting an unreadable
         transcript. THAT IS THE EXACT CONTRADICTION THE REFUSAL EXISTS TO
         PREVENT: leaving any of it is keeping a confident number from a source
         we have just declared unreadable.

         ⚠ A MANUALLY SET OUTCOME IS LEFT ALONE — a person's judgement about how
         the call ended is not derived from the transcript and is not ours to
         erase. Same read-before-write rule as the grader's manualLocked. */
      var priorOutcome = await admin.from('call_analyses')
        .select('outcome_source').eq('fathom_call_id', fathomCallId).maybeSingle();
      var outcomeIsManual = !!(priorOutcome.data && priorOutcome.data.outcome_source === 'manual');
      var cleared = compromisedFile.clearedGradeFields(!outcomeIsManual);
      await setAnalysisStatus(admin, fathomCallId, userId, 'done', Object.assign({
        overall_summary: compReason,
        analyzed_at:     new Date().toISOString(),
        prompt_version:  ANALYSIS_PROMPT_VERSION,
      }, cleared));
      /* Highlights quote speakers we cannot attribute, so they go too. Failure
         here must not fail the refusal — the exclusion is already durable. */
      try {
        await admin.from('call_highlights').delete().eq('fathom_call_id', fathomCallId);
      } catch (e) {
        console.warn('[analysis] compromised: could not clear highlights (non-fatal):', e && e.message);
      }
      console.warn('[analysis] compromised file, not graded (call=%s speakers=%d chars=%d)',
        fathomCallId, fileCheck.speakers, fileCheck.chars);
      return { status: 'compromised_file', speakers: fileCheck.speakers, chars: fileCheck.chars };
    }

    // ─── Phase 6: two parallel Claude calls ──────────────────────────────
    // KB grounding: one read-only fetch of the closer's selling context (offer
    // docs / scripts). Never throws (empty on any failure) → the grader falls
    // back to the v5-identical prompt. Highlight extractor is unchanged. No new
    // Claude call — still exactly two per analysis.
    var selling = await fetchSellingContext(admin, userId);

    /**
     * ITEM (j) — the price-drop moment. Read the seller's OWN price and find the
     * first time they stated it as the total. Deterministic; a failure here must
     * never fail an analysis, so it degrades to null exactly like the KB harvest.
     *
     * ⚠ price_pif ONLY — price_2pay is the plan figure and is a decoy generator
     * ("a couple hundred bucks", "$300 to $500 a month"). lib/price-moment never
     * sees it.
     */
    /* ⚠⚠ NO STORED PRICE REQUIRED (2026-08-31, Justin's ruling twice over).
       This used to run ONLY when the rep had saved price_pif — and only 2 of 13
       users ever did, both the same person, so every other rep had ZERO price
       moments across 750+ graded calls and the graph drew one line. An offer
       also usually has several packages, so matching one stored number is
       brittle by construction.

       ⚠ The discriminator was never the number: it is total-framing language,
       measured at 85% of real-price first mentions against 0-1% of round
       decoys. findPriceMomentByFraming inverts the order and keeps Rule A.

       ⚠ Measured against the stored lookup as ground truth over 120 calls:
       109 exact, 6 within 60s, 0 DIFFERENT, 5 missed — 96%. The failure mode is
       a null, never a wrong minute, which is the safe direction. NEW CALLS
       ONLY: nothing re-analyses, so the graph fills as calls arrive. */
    var priceMoment = null;
    try {
      priceMoment = findPriceMomentByFraming(normalized.turns);
    } catch (e) {
      console.warn('[analysis] price moment skipped: %s', e.message);
    }

    // ─── 7c: the rep's derived coaching areas ────────────────────────────
    // Cached on their material hash, so this is one indexed read on the common
    // path and costs a Claude call only when the material changed. A rep with
    // no usable material gets [] and the grader prompt stays byte-identical to
    // v14 for them — which is most reps (1 of 8 live profiles derives areas).
    // Never throws: a failure here degrades to no coverage map, not a failed
    // analysis, exactly as fetchSellingContext does.
    var coachingAreas = [];
    try {
      var areasOut = await getAreasForUser(admin, userId, async function (prompt) {
        var ar = await createWithUsage({
          model: CLAUDE_MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }],
        }, { userId: userId, lane: 'coaching-areas' });
        var txt = ar.content[0] ? ar.content[0].text : '';
        return extractFirstJsonArray(txt);
      });
      coachingAreas = areasOut.areas || [];
    } catch (areaErr) {
      console.warn('[analysis] coaching-area lookup failed for ' + fathomCallId + ': ' + ((areaErr && areaErr.message) || 'unknown'));
    }
    /* ⚠⚠ THE SIX FIXED DISCOVERY ITEMS, ADDED ON EVERY CALL FOR EVERY REP.
       `coverage` already had the right contract and the wrong POPULATION — its
       areas are derived per rep and exactly ONE rep of eight has any (537/537 on
       one account, 0 on the other seven). Fixed areas take it to all of them.
       ⚠ ADDED to the derived list, never instead of it: `what_mattered` RANKS the
       derived areas, so dropping them would break a working feature.
       ⚠ Placed AFTER the catch deliberately — a failed area derivation must not
       cost the six. */
    coachingAreas = withDiscoveryAreas(coachingAreas);
    var anthropic = getAnthropic();
    /* ⚠ v24 — fetch the closer's OWN verified lines. Best-effort: a failure here
       must never fail an analysis, it just falls back to the v23 wording.
       ⚠ GATED ON speaker_confidence === 'matched' — on Zoom there is no matched
       speaker, so this returns null and the email degrades to generic. That is
       ⚠ CORRECTED 2026-08-20 — THIS COMMENT WAS TRUE WHEN WRITTEN AND IS NOT
       NOW. A Zoom call used to have no matched speaker, so this returned null.
       Since lib/zoom-identity (8805fac) the byte-identical display-name match
       makes speaker_confidence 'matched' on Zoom, so grounding FIRES there.
       ⚠ AND THE PARTICIPANTS SCOPE WAS NEVER THE FIX FOR THIS: both sides of a
       participants join are display names, so it cannot improve attribution.
       It buys a participant COUNT for collision detection, nothing more. */
    var voiceBlock = null;
    try {
      if (closerVoice.shouldGroundVoice(normalized.speaker_confidence)) {
        var vq = await admin.from('call_highlights')
          .select('closer_response')
          .eq('user_id', userId).eq('closer_response_verified', true)
          .not('closer_response', 'is', null)
          .limit(200);
        if (!vq.error) {
          /* ⚠⚠ v26 — A PROFILE, NOT EXEMPLAR LINES. v24 handed the model 15 of
             the closer's real spoken lines; every word came out plausible and
             the email still read as generated, because LINES INVITE IMITATION
             and what gets imitated is SPOKEN register. What survives a change
             of medium is a PROPERTY (sentence length and its variance,
             contraction rate, directness) — not a phrasing.
             ⚠ ALL the clean lines feed the profile, not the 15-line stride:
             selectVoiceLines exists to give the model a varied SAMPLE to read,
             and a measurement wants the whole population instead. */
          var clean = (vq.data || [])
            .map(function (r) { return r && r.closer_response; })
            .filter(closerVoice.isCleanVoiceLine);
          voiceBlock = voiceProfile.voiceProfileBlock(voiceProfile.deriveVoiceProfile(clean), null);
        }
      }
    } catch (vErr) {
      console.warn('[analysis] closer-voice fetch failed for ' + fathomCallId + ': ' + ((vErr && vErr.message) || 'unknown'));
    }
    var sectionPrompt   = buildSectionGraderPrompt(normalized, callRow.duration_seconds, selling.contextText, coachingAreas, { qualifications: selling.qualifications, voiceBlock: voiceBlock });
    var highlightPrompt = buildHighlightExtractorPrompt(normalized);

    /* ⚠ THE GRADER AND THE EXTRACTOR EACH SEND THE FULL TRANSCRIPT — measured
       49,076-64,405 input tokens apiece, so together they are ~95% of an
       analysis's input and the coaching pass below is ~5%. Merging them was
       measured and REFUSED ON QUALITY (fewer objection moments, missing
       sections); do not re-open that as a cost saving without re-reading it. */
    var graderPromise = createWithUsage({
      model:      CLAUDE_MODEL,
      max_tokens: GRADER_MAX_TOKENS,
      messages:   [{ role: 'user', content: sectionPrompt }],
    }, { userId: userId, callId: fathomCallId, lane: 'grader' });
    var highlighterPromise = createWithUsage({
      model:      CLAUDE_MODEL,
      max_tokens: HIGHLIGHT_MAX_TOK,
      messages:   [{ role: 'user', content: highlightPrompt }],
    }, { userId: userId, callId: fathomCallId, lane: 'extractor' });

    // GUARD: an Anthropic API failure (credit/quota exhaustion, 429, 5xx,
    // timeout) must hard-fail this call to 'error' — NEVER fall through to a
    // 'done' row with partial nulls. A thrown SDK error already reaches the
    // outer catch, but we handle it explicitly here so the DB reason is
    // unambiguous ("Anthropic API failure (HTTP …)") and stamped with the
    // prompt version.
    var settled;
    try {
      settled = await Promise.all([graderPromise, highlighterPromise]);
    } catch (apiErr) {
      var apiStatus = (apiErr && (apiErr.status || apiErr.statusCode)) || '';
      var apiReason = 'Anthropic API failure' + (apiStatus ? ' (HTTP ' + apiStatus + ')' : '') + ': ' + ((apiErr && apiErr.message) || 'unknown');
      /* ⚠⚠ A TEMPORARY MODEL FAILURE MUST NOT PERMANENTLY UNGRADE THE CALL.
         This branch used to error EVERY failure, and nothing moves 'error' back
         to 'pending' — so one 429 was a silent hole, exactly the Fathom defect
         one layer down. ⚠ The SDK has ALREADY retried 3× with backoff by the
         time we get here (maxRetries 2), so this only fires on a sustained
         problem rather than a blip. */
      if (modelRetry.shouldRetryModel(apiErr, modelAttempts)) {
        var nextModel = (modelAttempts || 0) + 1;
        await admin.from('call_analyses').update({ model_attempts: nextModel }).eq('fathom_call_id', fathomCallId);
        return await requeueTranscript(apiReason + ' — temporary, requeued (attempt ' + nextModel
          + ' of ' + modelRetry.MAX_MODEL_ATTEMPTS + ')', 'model failure');
      }
      apiReason += (modelRetry.classifyModelFailure(apiErr) === 'temporary')
        ? ' — temporary but retried ' + modelRetry.MAX_MODEL_ATTEMPTS + ' times, giving up'
        : ' — permanent, not retried';
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: apiReason.slice(0, 1000),
        analyzed_at:     new Date().toISOString(),
        prompt_version:  ANALYSIS_PROMPT_VERSION,
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + apiReason + ' (call=' + fathomCallId + ' user=' + userId + ')');
      return { status: 'error', reason: apiReason };
    }
    var graderResp     = settled[0];
    var highlighterResp = settled[1];

    var graderText     = graderResp.content[0] ? graderResp.content[0].text : '';
    var highlighterText = highlighterResp.content[0] ? highlighterResp.content[0].text : '';

    // Grader output is the load-bearing one — if it doesn't parse, the whole
    // analysis is unusable. Mark error and bail.
    var graderParsed = extractFirstJsonObject(graderText);
    if (!graderParsed) {
      var graderReason = 'Section grader returned unparseable JSON: ' + graderText.slice(0, 200);
      /* ⚠⚠ ITS OWN BRANCH, BECAUSE THIS IS A 200 — the SDK never sees it and
         cannot have retried it. ⚠ AND IT IS WORTH RETRYING: measured 2026-08-26,
         it is length-CORRELATED, not length-determined — a call that failed on
         it in production parsed cleanly hours later, and a live error count fell
         2→1 when a loop re-claimed one and it succeeded. Bounded TIGHTER than a
         transient API error (2 vs 3): the same call is likelier to fail again,
         and each attempt costs a full transcript. */
      if (modelRetry.shouldRetryUnparseable(modelAttempts)) {
        var nextU = (modelAttempts || 0) + 1;
        await admin.from('call_analyses').update({ model_attempts: nextU }).eq('fathom_call_id', fathomCallId);
        return await requeueTranscript(graderReason + ' — requeued (attempt ' + nextU
          + ' of ' + modelRetry.MAX_UNPARSEABLE_ATTEMPTS + ')', 'unusable model output');
      }
      graderReason += ' — retried ' + modelRetry.MAX_UNPARSEABLE_ATTEMPTS + ' times, giving up';
      await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
        overall_summary: graderReason,
        analyzed_at:     new Date().toISOString(),
      });
      await markFathomCallErrored(admin, fathomCallId, userId);
      console.error('[analysis] ' + graderReason);
      return { status: 'error', reason: graderReason };
    }
    // Highlight failure is non-fatal — we still ship the grades. Stored as
    // zero highlights (the review page renders "No highlights extracted").
    var highlightParsed = extractFirstJsonArray(highlighterText);
    /* ⚠⚠ RECORD WHY, ON THE ROW. This used to be a bare console.warn carrying no
       reason and no snippet, in a log that does not survive a restart — so a
       highlight failure reached the database as a perfectly normal graded call
       with an empty list and NOTHING saying what happened. That is what made
       the long-Zoom defect undiagnosable for days.
       ⚠ Non-fatal is unchanged: the grades still ship. Only the silence goes. */
    var highlightErrorReason = highlightFailure.describeHighlightFailure({
      text:       highlighterText,
      parsed:     highlightParsed,
      count:      highlightParsed ? highlightParsed.length : 0,
      stopReason: (highlighterResp && highlighterResp.stop_reason) || null,
    });
    if (highlightErrorReason) {
      console.warn('[analysis] highlight extraction produced nothing for ' + fathomCallId + ': ' + highlightErrorReason);
    }

    // ─── 7c: verify the coverage / context evidence at WRITE TIME ────────
    // The model's confidence in its own quote is not evidence. Under v13
    // wording only 17% of grader evidence quotes could be reconstructed from
    // the transcript at all; v14's verbatim contract lifted that to 89% in an
    // A/B and 3/3 in production, which is what made these fields worth storing.
    // An unverified quote is KEPT (it may still be a fair paraphrase of what
    // happened) but is marked so no surface can ever render it as someone's
    // actual words.
    var coverageOut = sanitizeCoverage(graderParsed.coverage, coachingAreas);
    var prospectContextOut = sanitizeProspectContext(graderParsed.prospect_context);
    var covStats = { ev: 0, evOk: 0, ctx: 0, ctxOk: 0 };

    coverageOut.forEach(function (c) {
      if (!c.evidence) return;
      covStats.ev++;
      // Either party can establish the ground — a prospect volunteering their
      // savings counts exactly as much as the closer asking. So the test is
      // "does this line exist", not "who said it".
      if (locateQuoteSpeaker(normalized.turns, c.evidence).ok) { c.evidence_verified = true; covStats.evOk++; }
    });

    // ── the per-criterion qualification check ────────────────────────────
    // ⚠ VERIFIED AGAINST THE TRANSCRIPT AT WRITE TIME, exactly like coverage —
    // but STRICTER, because a verdict here can disqualify a real person. The
    // quote must be the PROSPECT'S OWN WORDS: measured on 349 real calls, 55 of
    // the 286 reconstructible qualification quotes are the CLOSER speaking
    // ("Your credit, is your credit shot?"), and deciding on those would let a
    // closer's own question write off a buyer.
    //
    // ⚠ THE DOWNGRADE IS ONE-WAY. An unprovable quote turns a decided verdict
    // into "undetermined" and withholds the quote; it can never turn anything
    // INTO "failed". A wrong disqualification is worse than no verdict.
    var qualCheckOut = qualCheck.sanitizeQualificationCheck(graderParsed.qualification_check);
    if (qualCheckOut) {
      qualCheckOut = qualCheck.verifyQualificationCheck(qualCheckOut, normalized.turns, labelForQuote);
      var qcDecided = qualCheckOut.filter(function (e) { return e.verdict !== 'undetermined'; }).length;
      var qcFailed = qualCheckOut.filter(function (e) { return e.verdict === 'failed'; }).length;
      console.log('[analysis] qualification_check for ' + fathomCallId + ': '
        + qualCheckOut.length + ' criteria, ' + qcDecided + ' decided, ' + qcFailed + ' failed');
    }

    prospectContextOut.forEach(function (p) {
      covStats.ctx++;
      // Stricter: an attribute the PROSPECT stated about themselves must be in
      // the prospect's own words. On a matched call we can require that; on an
      // unknown-speaker call we can only require the line exists, and 6d-style
      // surfaces already exclude unknown-speaker material anyway.
      if (normalized.speaker_confidence === 'matched') {
        if (labelForQuote(normalized.turns, p.evidence) === 'PROSPECT') { p.evidence_verified = true; covStats.ctxOk++; }
      } else if (locateQuoteSpeaker(normalized.turns, p.evidence).ok) {
        p.evidence_verified = true; covStats.ctxOk++;
      }
    });

    // ─── 7d: the question that mattered, and role inversion ─────────────
    // Suppressed entirely on an inverted call: if the recorded user is the one
    // being sold to, the "prospect ground" is really the closer's own
    // situation, so any gap we name would be coaching a fiction.
    var roleInv = detectRoleInversion(prospectContextOut, normalized.turns, normalized.speaker_confidence);
    // 8c: the SAME validation chain as 7d, reused rather than duplicated. The
    // obstacle quote takes the reason_evidence slot, so it inherits: area must
    // exist for this rep, area must be marked uncovered on this call, and the
    // quote must reconstruct from the transcript AS THE PROSPECT'S WORDS.
    // 9a: paired here, from both models' output. See selectMissedCuePair.
    var barrierTrace = roleInv.inverted ? null : selectMissedCuePair(sanitizedHighlights, MIN_CUE_GAP_SECONDS);
    if (coachingAreas.length || barrierTrace) {
      console.log('[analysis] missed_cue call=%s %s', fathomCallId,
        barrierTrace ? ('paired gap=' + barrierTrace.gap_seconds + 's') : 'none');
    }

    var whatMattered = roleInv.inverted
      ? null
      : resolveWhatMattered(graderParsed.what_mattered, {
          coverage: coverageOut, areas: coachingAreas,
          turns: normalized.turns, speakerConfidence: normalized.speaker_confidence,
        });
    if (coachingAreas.length) {
      console.log('[analysis] what_mattered call=%s area=%s inverted=%s (closer_spoken=%d prospect_spoken=%d)',
        fathomCallId, (whatMattered ? whatMattered.area_key : 'none') + '/trace=' + (barrierTrace ? barrierTrace.area_key : 'declined'),
        roleInv.inverted, roleInv.closer_spoken, roleInv.prospect_spoken);
    }

    if (coachingAreas.length) {
      console.log('[analysis] coverage call=%s areas=%d covered=%d evidence=%d/%d context=%d/%d',
        fathomCallId, coachingAreas.length,
        coverageOut.filter(function (c) { return c.covered; }).length,
        covStats.evOk, covStats.ev, covStats.ctxOk, covStats.ctx);
    }

    // ─── Phase 6b: resolve the prospect name ─────────────────────────────
    // The closer must be excluded from the diarized speakers.
    //
    // 6a UPDATE: `normalized.closer_name` is now POPULATED whenever the invitee
    // email is available (it used to be NULL on every row, because the meeting
    // object hardcoded recorded_by:null and the fuzzy match never ran). The
    // local-part candidates below remain as the path for calls with no email
    // signal — Zoom, and users with no connection email.
    //
    // This matters concretely: on 6 of 83 live calls the PROSPECT out-talked the
    // closer, so the turn-count fallback alone would have returned the CLOSER as
    // the prospect — precisely the wrong-name failure the governing principle
    // forbids. Never let this degrade to that path when an email is available.
    // 6a: the lookup is hoisted above normalize now (the normalizer needs the
    // same address). Reuse it here rather than querying twice.
    var closerCandidates = [];
    if (closerEmail) {
      closerCandidates.push(closerEmail);
      var localPart = closerEmail.split('@')[0];
      if (localPart) closerCandidates.push(localPart);
    }

    var resolvedProspect = resolveProspectName({
      graderName:       (typeof graderParsed.prospect_name === 'string') ? graderParsed.prospect_name : null,
      turns:            normalized.turns,
      closerName:       normalized.closer_name,
      closerCandidates: closerCandidates,
      title:            callRow.title,
    });

    // ─── Phase 7: persist ────────────────────────────────────────────────
    var intro     = sanitizeSection(graderParsed.intro);
    var discovery = sanitizeSection(graderParsed.discovery);
    var pitch     = sanitizeSection(graderParsed.pitch);
    var objection = sanitizeSection(graderParsed.objection);
    var close     = sanitizeSection(graderParsed.close);
    var overallScore = (typeof graderParsed.overall_score === 'number'
                         && graderParsed.overall_score >= 0
                         && graderParsed.overall_score <= 100)
      ? Math.round(graderParsed.overall_score)
      : null;

    // Grader-inferred deal outcome (migration 012). This is only APPLIED when the
    // row isn't manually locked — the read-before-write guard below (manualLocked)
    // freezes a human-set 'manual' outcome, so a re-analysis never clobbers it.
    var inferredOutcome = (typeof graderParsed.outcome === 'string'
      && VALID_OUTCOMES.indexOf(graderParsed.outcome.toLowerCase()) !== -1)
      ? graderParsed.outcome.toLowerCase() : null;

    // "Why this call closed / didn't close / hasn't closed yet" (migration 018,
    // prompt v5). closed (win), lost (loss), AND follow_up (the blocker keeping
    // it open) all carry a decisive-cause object; only no_show/null force it null
    // (no real conversation to diagnose), so the review verdict shows on every
    // real call instead of just wins and losses.
    var whyRaw = graderParsed.why_outcome;
    var whyReason = null, whyQuote = null, whyTs = null;
    var producesVerdict = (inferredOutcome === 'closed' || inferredOutcome === 'lost' || inferredOutcome === 'follow_up');
    if (producesVerdict && whyRaw && typeof whyRaw === 'object'
        && typeof whyRaw.reason === 'string' && whyRaw.reason.trim()) {
      whyReason = whyRaw.reason.trim().slice(0, 2000);
      whyQuote  = (typeof whyRaw.quote === 'string' && whyRaw.quote.trim())
        ? whyRaw.quote.trim().slice(0, 1000) : null;
      whyTs     = boundTs(whyRaw.timestamp_seconds, callRow.duration_seconds);
    }
    var oneThingTs = boundTs(graderParsed.one_thing_timestamp_seconds, callRow.duration_seconds);

    // Manual-override protection (Thread 1, load-bearing): if a human tagged the
    // outcome, a re-analysis must NEVER overwrite it. Read the existing tag +
    // earned close score. The EFFECTIVE outcome (manual if locked, else inferred)
    // drives close_score (Thread 2) and payment_structure.
    var existingRow = await admin.from('call_analyses')
      .select('outcome, outcome_source, outcome_set_at, outcome_set_by, prospect_name, prospect_name_source, prospect_name_confidence')
      .eq('fathom_call_id', fathomCallId).maybeSingle();
    /* ⚠⚠ H707: A HUMAN NAME WINS OVER THE GRADER — a re-analysis never overwrites a person's
       rename. Same read-before-write rule as manualLocked on the outcome. */
    var humanNamed = !!(existingRow.data && existingRow.data.prospect_name_source === 'manual' && existingRow.data.prospect_name);
    if (humanNamed) resolvedProspect = { name: existingRow.data.prospect_name, source: 'manual', confidence: existingRow.data.prospect_name_confidence || 'high' };
    var manualLocked = !!(existingRow.data && existingRow.data.outcome_source === 'manual');
    var effectiveOutcome = manualLocked ? existingRow.data.outcome : inferredOutcome;
    var earnedClose = (typeof close.score === 'number') ? close.score : null;

    var analysisPayload = {
      fathom_call_id:      fathomCallId,
      user_id:             userId,
      // Outcome columns are FROZEN when a human tag exists.
      outcome:             manualLocked ? existingRow.data.outcome : inferredOutcome,
      outcome_source:      manualLocked ? 'manual' : (inferredOutcome ? 'inferred' : null),
      outcome_set_at:      manualLocked ? existingRow.data.outcome_set_at : (inferredOutcome ? new Date().toISOString() : null),
      outcome_set_by:      manualLocked ? existingRow.data.outcome_set_by : null,
      overall_score:       overallScore,
      overall_summary:     (typeof graderParsed.overall_summary === 'string') ? graderParsed.overall_summary.slice(0, 3000) : null,
      intro_grade:         intro.grade,
      intro_score:         intro.score,
      intro_notes:         intro.notes,
      discovery_grade:     discovery.grade,
      discovery_score:     discovery.score,
      discovery_notes:     discovery.notes,
      pitch_grade:         pitch.grade,
      pitch_score:         pitch.score,
      pitch_notes:         pitch.notes,
      objection_grade:     objection.grade,
      objection_score:     objection.score,
      objection_notes:     objection.notes,
      close_grade:         close.grade,
      // Thread 2: displayed Close = 100 when the effective outcome is 'closed';
      // the grader's earned score is preserved in close_score_earned.
      close_score:         effectiveCloseScore(effectiveOutcome, earnedClose, earnedClose),
      close_score_earned:  earnedClose,
      close_notes:         close.notes,
      one_thing:                   (typeof graderParsed.one_thing === 'string') ? graderParsed.one_thing.slice(0, 2000) : null,
      why_outcome:                 whyReason,
      why_quote:                   whyQuote,
      why_timestamp_seconds:       whyTs,
      one_thing_timestamp_seconds: oneThingTs,
      follow_up_email:     (typeof graderParsed.follow_up_email === 'string') ? graderParsed.follow_up_email.slice(0, 5000) : null,
      cash_collected:      sanitizeCashCollected(graderParsed.cash_collected),
      payment_structure:   sanitizePaymentStructure(graderParsed.payment_structure, effectiveOutcome),
      eod_summary:         sanitizeEodSummary(graderParsed.eod_summary),
      // v12 measurement-only: stored so coverage can be checked by READING, never
      // consumed by a score. What it eventually feeds is a separate decision.
      qualification_covered: sanitizeQualificationCovered(graderParsed.qualification_covered),
      // NULL when this rep has no criteria on file — "never evaluated", which is
      // a different fact from an empty array ("evaluated, nothing to check").
      qualification_check: qualCheckOut,
      coverage:              coverageOut,
      what_mattered:         whatMattered,
      barrier_trace:         barrierTrace,
      role_inverted:         (normalized.speaker_confidence === 'matched') ? roleInv.inverted : null,
      prospect_context:      prospectContextOut,
      // ── item (j): when the closer stated the price ──────────────────────
      // ⚠ DETERMINISTIC AND FREE — a lookup of the seller's OWN stored price in
      // their own transcript. No model call, no token budget, no prompt bump.
      // That is also why it is backfillable over existing transcripts rather
      // than being new-calls-only.
      // ⚠ NULL IS EXPECTED, roughly 1 in 5 closed calls: a second conversation
      // on an already-agreed deal has no pitch and no price drop. Do not read
      // the gaps as breakage — see lib/price-moment.js.
      price_stated_at_seconds: priceMoment ? priceMoment.seconds : null,
      price_quote:             priceMoment ? priceMoment.quote : null,
      transcript_stored:   { turns: normalized.turns, highlights: normalized.highlights },
      speaker_closer_name: normalized.closer_name,
      // PROSPECT NAMES 3a — resolve WHO this call was with, at write time.
      // Governing principle: a wrong name is worse than no name, so this stores
      // NULL rather than a plausible guess (renders "Unknown prospect").
      // Precedence grader → diarized → title; source + confidence recorded but
      // not surfaced until 3d's merge review (ruling 4).
      prospect_name:            resolvedProspect.name,
      prospect_name_source:     resolvedProspect.source,
      prospect_name_confidence: resolvedProspect.confidence,
      /* ⚠⚠ H708: the verdict and its reason are STORED FOR REVIEW ONLY. Nothing here or
         anywhere else writes fathom_calls.not_a_sales_call from them until Justin has
         seen the blind score and ruled the threshold. A human mark always wins. */
      sales_call_verdict:      salesCallVerdict(graderParsed).verdict,
      sales_call_reason_class: salesCallVerdict(graderParsed).reason_class,
      sales_call_reason:       salesCallVerdict(graderParsed).reason,
      analyzed_at:         new Date().toISOString(),
      prompt_version:      ANALYSIS_PROMPT_VERSION,
      status:              'done',
      /* ⚠⚠ WRITTEN ON EVERY ANALYSIS THAT REACHES THE HIGHLIGHT STEP, including
         the successful ones (as NULL). "No reason recorded" and "nothing went
         wrong" are opposite meanings and identical to a query — write the null.
         ⚠ IT BELONGS IN THIS PAYLOAD, NOT THE RETURN VALUE. The first draft put
         it beside `highlights_count` in the returned object, which reaches no
         database at all: the column would have stayed empty forever while every
         test passed. Same shape as the dead call site that hid for months. */
      highlight_error:     highlightErrorReason,
      /* ⚠ A CLEAN RUN CLEARS BOTH COUNTERS — the bounds are on CONSECUTIVE
         failures, not lifetime ones. Without this a call that flaked twice a
         month ago would arrive at its next real failure with no budget left. */
      transcript_attempts: 0,
      model_attempts:      0,
    };
    var upsert = await admin
      .from('call_analyses')
      .upsert(analysisPayload, { onConflict: 'fathom_call_id' });
    if (upsert.error) throw new Error('call_analyses upsert: ' + upsert.error.message);

    // Highlights: insert the new set FIRST, then delete the prior rows — so a
    // failed/empty extraction (or a failed insert) never wipes a call's existing
    // highlights. Non-fatal: grades are already saved.
    var sanitizedHighlights = sanitizeHighlights(highlightParsed, callRow.duration_seconds);

    // ─── 6a: verify each highlight's speaker against the transcript ──────
    // On a matched call the model is READING labelled turns rather than
    // inferring, which is far stronger — but it is still the model copying a
    // label, not proof. So attribute each quote independently: reconstruct it
    // from consecutive turns and take the speaker who opened it.
    //
    // speaker_verified (migration 034) is deliberately three-valued:
    //   true  — reconstructed from the transcript, proven
    //   false — could not be reconstructed (or two speakers could have said
    //           it); the label stands but is the model's guess
    //   null  — never assessed (no closer identity available at all)
    // Closer-side features must require true. Corrections are logged, because
    // a silent correction hides how often the extractor mis-attributes.
    if (normalized.speaker_confidence === 'matched') {
      var vStats = { proven: 0, unproven: 0, corrected: 0, resp_proven: 0, resp_rejected: 0 };
      sanitizedHighlights.forEach(function (h) {
        var label = labelForQuote(normalized.turns, h.quote);
        if (!label) { h.speaker_verified = false; vStats.unproven++; }
        else {
          if (label !== h.speaker) { h.speaker = label; vStats.corrected++; }
          h.speaker_verified = true;
          vStats.proven++;
        }

        // 6e: `closer_response` is model-quoted text on the PROSPECT's row. The
        // field name is not evidence — measured, 3 of 53 responses that
        // reconstruct were actually the prospect speaking. Prove it separately.
        var resp = (typeof h.closer_response === 'string') ? h.closer_response.trim() : '';
        if (!resp) return;
        // v29: a sentinel is a RESULT, not a quote. Running it through
        // labelForQuote would file "he did not reply" as a REJECTED quote and
        // count it against the extractor in resp_rejected.
        if (closerSide.isSentinel(resp)) { h.closer_response_verified = null; return; }
        var respLabel = labelForQuote(normalized.turns, resp);
        h.closer_response_verified = (respLabel === 'CLOSER');
        if (h.closer_response_verified) vStats.resp_proven++; else vStats.resp_rejected++;
      });
      // Verification can CORRECT speaker PROSPECT -> CLOSER. Re-apply the
      // anchoring guard on the PROVEN value: a row that only becomes a
      // violation after correction must not survive because the model's
      // original claim happened to pass.
      var beforeGuard = sanitizedHighlights.length;
      sanitizedHighlights = sanitizedHighlights.filter(function (h) {
        if (!violatesProspectAnchor(h)) return true;
        console.warn('[analysis] dropped %s after verification proved a CLOSER line: "%s"', h.type, String(h.quote).slice(0, 60));
        return false;
      });
      if (beforeGuard !== sanitizedHighlights.length) {
        console.log('[analysis] anchoring guard removed %d moment(s) post-verification (call=%s)',
          beforeGuard - sanitizedHighlights.length, fathomCallId);
      }

      console.log('[analysis] speaker verify call=%s proven=%d unproven=%d corrected=%d resp_proven=%d resp_rejected=%d',
        fathomCallId, vStats.proven, vStats.unproven, vStats.corrected, vStats.resp_proven, vStats.resp_rejected);
    } else {
      // No deterministic identity → every label is an inference. Say so, and
      // never let a response through on the strength of its field name.
      sanitizedHighlights.forEach(function (h) {
        h.speaker_verified = false;
        if ((typeof h.closer_response === 'string') && h.closer_response.trim()
            && !closerSide.isSentinel(h.closer_response)) h.closer_response_verified = false;
      });
    }
    var persisted = await persistHighlights(admin, fathomCallId, userId, sanitizedHighlights);
    /* ⚠⚠ A PERSIST FAILURE IS A SECOND WAY TO REACH ZERO HIGHLIGHTS, and the
       parse-time classifier cannot see it — the extraction succeeded and the
       WRITE failed. Without this the row would read "extraction fine, no
       moments", which is the opposite of what happened.
       ⚠ One extra write, and only on failure. The analysis row is already
       upserted by this point, so this amends it rather than racing it. */
    if (persisted && persisted.error) {
      await admin.from('call_analyses')
        .update({ highlight_error: 'persist_failed: ' + String(persisted.error).slice(0, 400) })
        .eq('fathom_call_id', fathomCallId);
    }

    // ─── Phase 7c: per-moment coaching (v30) ─────────────────────────────
    // ⚠⚠ ONE MODEL CALL PER CALL, COVERING ALL ITS MOMENTS. Never one per
    // moment — calls average 5.7 coachable moments, so per-moment would be a
    // 5.7x error. It carries no transcript (it works from the moments just
    // written), so it is ~2.5k input tokens against the ~23.7k the grader and
    // the extractor each send.
    //
    // NOT awaited, and fully swallowed, for the same reason as Phase 7b: the
    // analysis drain is fire-and-forget and dies on a redeploy, so nothing
    // optional may lengthen the window where a deploy kills a call mid-analysis.
    // A coaching failure leaves `coaching` NULL, which the panel already renders
    // as "no coaching" rather than as an error.
    //
    // ⚠ It runs AFTER persistHighlights because it needs the real row ids the
    // insert created — the rows are re-read rather than inferred.
    /* ⚠⚠ GATED ON not_a_sales_call, THE SAME WAY THE HARVEST BELOW IS. This was
       missing: the harvest checked the flag and the coaching one line above it
       did not, so a marked call still had per-moment coaching written for it.
       Justin found Discovery coaching on a closer's internal meeting with his
       own sales manager. */
    if (callRow && callRow.not_a_sales_call === true) {
      console.log('[coaching] call=%s skipped — not a sales call', fathomCallId);
    } else
    coachCallMoments(admin, fathomCallId, effectiveOutcome, whyReason, objection && objection.notes, userId)
      .then(function (r) {
        console.log('[coaching] call=%s moments=%d written=%d%s',
          fathomCallId, r.selected, r.written, r.skipped ? ' skipped=' + r.skipped : '');
      })
      .catch(function (e) {
        console.warn('[coaching] call=%s failed: %s', fathomCallId, e && e.message);
      });

    // ─── Phase 7b: auto-populate the rep's KB from a CLOSED call ─────────
    // KB Part 2, sub-stage 2d. Gated on effectiveOutcome — the manual-override-
    // aware value, so a human-tagged outcome drives this exactly as it drives
    // close_score and payment_structure. Ruling 4: outcome alone, never cash
    // (a payment-plan close legitimately records zero at signing).
    //
    // NOT awaited, on purpose. The analysis drain is fire-and-forget and dies on
    // a Railway redeploy; this adds ~2-10 Voyage round-trips per closed call and
    // must not lengthen the window where a deploy can kill a call mid-analysis.
    // Zero new Claude calls — it files moments the extractor already produced.
    //
    // Fully swallowed: a KB failure can never fail or stall an analysis (the same
    // degrade rule fetchSellingContext follows). Idempotent with the manual
    // Add-to-KB button by construction — identical dedupe key, so whichever runs
    // second is a no-op.
    // notASalesCall rides from the fathom_calls row; NULL (unassessed) must not block.
    if (shouldHarvest(effectiveOutcome, callRow && callRow.not_a_sales_call)) {
      harvestClosedCall(admin, {
        fathomCallId: fathomCallId,
        userId:       userId,
        outcome:      effectiveOutcome,
        highlights:   sanitizedHighlights,
        speakerConfidence: normalized.speaker_confidence,
      }).then(function (s) {
        console.log('[kb-harvest] call=%s added=%d duplicate=%d failed=%d unembedded=%d%s',
          fathomCallId, s.added, s.duplicate, s.failed, s.unembedded, s.skipped_reason ? ' skipped=' + s.skipped_reason : '');
        /* ⚠ LOUD, and naming the consequence. The degrade is correct — the rows
           are written — so nothing else about this run looks wrong. That is
           exactly how 386 unembedded moments accumulated unnoticed. */
        if (s.unembedded > 0) {
          console.error('[kb-harvest] ⚠ call=%s wrote %d moment(s) WITHOUT an embedding (%s) — ' +
            'they are keyword-searchable only and invisible to similarity search',
            fathomCallId, s.unembedded,
            s.embed_reason === 'no_capability'
              ? 'VOYAGE_API_KEY is not set in this environment'
              : 'the provider failed after retries');
        }
      }).catch(function (e) {
        console.error('[kb-harvest] unexpected: ' + ((e && e.message) || 'unknown'));
      });
    }

    // ─── Phase 7c: attach the call to its PROSPECT — LINKING (H705) ──────
    /* ⚠⚠ Justin's approved policy (CLAUDE.md §4b), built 2026-09-03:
         path 1 · exactly ONE external invitee email whose name agrees with the
                  speaker → keyed by the email (the only exact path);
         path 2 · a Fathom title segment / a two-word Zoom display name whose
                  first word is the resolved first name → keyed by the full name;
         path 3 · today's one-word key, unchanged.
       Silence at every step; a call with no resolved name gets NO prospect (never
       an "Unknown" bucket). New calls only — nothing here re-attaches history.
       `prospect_link_path` records which path fired so the first week's yield can
       be measured. Non-fatal throughout — a grouping failure never fails an
       analysis. Was: `nameKey(resolvedProspect.name)` alone, which refilled the
       one-word "Anthony" row with every new "Anthony Davis" call. */
    try {
      var prospectDisplayNames = (normalized.speaker_confidence === 'matched')
        ? normalized.turns.filter(function (t) { return t.speaker === 'PROSPECT'; }).map(function (t) { return t.display_name; })
            .filter(function (v, i, arr) { return arr.indexOf(v) === i; })
        : [];
      var link = chooseLink({
        humanName:            humanNamed ? resolvedProspect.name : null,   // H707: the human path, above the exact path
        resolvedName:         resolvedProspect.name,
        invitees:             callRow.calendar_invitees,
        titleSegment:         callRow.title_name_segment,
        title:                callRow.title,
        source:               transcriptSourceFor(callRow),
        prospectDisplayNames: prospectDisplayNames,
      });
      var attached = await attachProspect(admin, { userId: userId, callId: fathomCallId, link: link });
      if (link && link.path) console.log('[prospect-link] call=' + fathomCallId + ' path=' + link.path + ' prospect=' + (attached.prospect_id || 'none') + (attached.created ? ' (new)' : ''));
      /* ⚠⚠ THE FOLLOW-UP FLAG (H706): a LINKED later call for the prospect is a follow-up
         of its earliest booked call; otherwise booked. Path 3 never manufactures one.
         The setter writes only where no human has marked the call — the human mark
         always wins and a re-analysis never reverses it. */
      var earlier = attached.prospect_id ? await earlierCallsFor(admin, userId, attached.prospect_id, callRow.call_date, fathomCallId) : [];
      var kind = deriveCallKind({ linkPath: link.path, prospectId: attached.prospect_id, callDate: callRow.call_date, earlierCalls: earlier });
      await setCallKindAuto(admin, fathomCallId, userId, kind);
      console.log('[call-kind] call=' + fathomCallId + ' kind=' + kind.call_kind + ' source=' + kind.call_kind_source + (kind.follows_call_id ? ' follows=' + kind.follows_call_id : ''));
    } catch (pErr) {
      console.warn('[analysis] prospect attach failed for ' + fathomCallId + ': ' + ((pErr && pErr.message) || 'unknown'));
    }

    // ─── Phase 8: advance fathom_calls.sync_status ───────────────────────
    var processed = await admin
      .from('fathom_calls')
      .update({ sync_status: 'processed' })
      .eq('id', fathomCallId)
      .eq('user_id', userId);
    if (processed.error) {
      console.warn('[analysis] fathom_calls sync_status flip failed for ' + fathomCallId + ': ' + processed.error.message);
    }

    console.log('[analysis] Done for call ' + fathomCallId + ' (user=' + userId + ', overall=' + overallScore + ', highlights=' + sanitizedHighlights.length + ')');
    return {
      status:            'done',
      overall_score:     overallScore,
      highlights_count:  sanitizedHighlights.length,
      highlight_error:   highlightErrorReason,
      speaker_confidence: normalized.speaker_confidence,
    };
  } catch (err) {
    var msg = (err && err.message) || 'unknown';
    await setAnalysisStatus(admin, fathomCallId, userId, 'error', {
      overall_summary: 'analysis_error: ' + msg.slice(0, 1000),
      analyzed_at:     new Date().toISOString(),
    });
    await markFathomCallErrored(admin, fathomCallId, userId);
    console.error('[analysis] Failed for call ' + fathomCallId + ' (user=' + userId + '): ' + msg);
    return { status: 'error', reason: msg };
  }
}

/**
 * Generate coaching for every coachable moment on a call, in ONE model call.
 * Returns a summary; never throws — the caller treats failure as "no coaching".
 */
async function coachCallMoments(admin, fathomCallId, outcome, later, objectionNotes, userId) {
  var res = await admin.from('call_highlights')
    .select('id, type, resolution, section, timestamp_seconds, quote, observation, closer_response, closer_response_verified')
    .eq('fathom_call_id', fathomCallId);
  if (res.error) return { selected: 0, written: 0, skipped: 'read_failed' };

  var coachable = coachingLib.selectCoachableMoments(res.data || []);
  if (!coachable.length) return { selected: 0, written: 0, skipped: 'no_coachable_moments' };

  var moments = coachable.map(coachingLib.toMoment);
  /* ⚠⚠ FINE TUNE COACHING (2026-09-02): the team's own corrections join THIS
     prompt and no other — the grader and the extractor above never load them
     (substitution, not suppression). A read failure coaches without notes and
     says so, rather than failing the whole pass. Numbered in the prompt so the
     model can say which it applied; the numbers map back to row ids below. */
  var corrections = { rows: [], text: '', hash: 'none' };
  try {
    var cc = require('./coaching-corrections');
    corrections = await cc.loadCorrections(admin, await cc.teamKeyFor(admin, userId));
  } catch (ccErr) {
    console.warn('[coaching] call=%s manager notes unavailable (%s) \u2014 coaching without them', fathomCallId, (ccErr && ccErr.message) || 'unknown');
  }
  var prompt = coachingLib.buildCoachingPrompt(moments, { outcome: outcome, later: later,
    objectionNotes: objectionNotes || null, managerNotes: corrections.text || null });

  var reply = await createWithUsage({
    model: coachingLib.CLAUDE_COACHING_MODEL,
    max_tokens: coachingLib.COACHING_MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  }, { userId: userId || null, callId: fathomCallId, lane: 'coaching' });
  var raw = reply.content.map(function (c) { return c.text || ''; }).join('');
  var parsed = extractFirstJsonArray(stripCodeFences(raw));
  if (!Array.isArray(parsed)) return { selected: moments.length, written: 0, skipped: 'unparseable' };

  var written = 0;
  for (var k = 0; k < parsed.length; k++) {
    var entry = parsed[k];
    if (!entry || typeof entry.coaching !== 'string' || !entry.coaching.trim()) continue;
    // 1-based "moment" from the model; fall back to position.
    var idx = (Number.isInteger(entry.moment) && entry.moment >= 1 && entry.moment <= moments.length)
      ? entry.moment - 1 : k;
    var m = moments[idx];
    if (!m) continue;
    /* ⚠⚠ THE ASSEMBLED OPENING IS GONE, and removing it FIXES a regression it
       caused. Prepending "At HH:MM:SS the prospect said …" made the card show the
       quote twice, so the panel stripped that line — and because the card carried no
       timestamp of its own, the strip deleted the ONLY timestamp on the surface. The
       anchor now belongs to the CARD, rendered from timestamp_seconds, where neither
       a model nor a de-duplicator can remove it. */
    var patch = { coaching: entry.coaching.trim() };
    if (corrections.rows.length) {
      /* The checkable field: WHICH notes shaped this coaching, as row ids. */
      var applied = Array.isArray(entry.applied_manager_notes) ? entry.applied_manager_notes : [];
      patch.coaching_applied_notes = applied
        .map(function (n) { return (Number.isInteger(n) && n >= 1 && n <= corrections.rows.length) ? corrections.rows[n - 1].id : null; })
        .filter(Boolean);
    }
    var up = await admin.from('call_highlights').update(patch).eq('id', m.id);
    if (!up.error) written++;
  }
  return { selected: moments.length, written: written, skipped: null };
}

module.exports = {
  analyzeCall: analyzeCall,
  // Current grader prompt version — the dashboard uses this to surface calls
  // analyzed under an older version ("Update analyses (N outdated)").
  ANALYSIS_PROMPT_VERSION: ANALYSIS_PROMPT_VERSION,
  // Source-switch predicate (sub-stage 2) — 'zoom' | 'fathom'. Exported so the
  // branch decision is unit-testable without exercising the full analyzeCall.
  transcriptSourceFor: transcriptSourceFor,
  // Exported for tests / future internal callers — same precedent as me.js
  // (_computeCoachingPatterns, etc.).
  _extractFirstJsonObject:     extractFirstJsonObject,
  _salesCallVerdict:           salesCallVerdict,
  _SALES_CALL_VERDICTS:        SALES_CALL_VERDICTS,
  _SALES_CALL_REASON_CLASSES:  SALES_CALL_REASON_CLASSES,
  _extractFirstJsonArray:      extractFirstJsonArray,
  _sanitizeSection:            sanitizeSection,
  _sanitizeHighlights:         sanitizeHighlights,
  _violatesProspectAnchor:     violatesProspectAnchor,
  _VALID_HIGHLIGHT_TYPES:      VALID_HIGHLIGHT_TYPES,
  // ⚠ mirrored on the review page as HANDLING_TYPES (③-5) — test/duplicated-constants.test.js
  _PROSPECT_POSITION_TYPES:    PROSPECT_POSITION_TYPES,
  _persistHighlights:          persistHighlights,
  _coachCallMoments:           coachCallMoments,
  _findMeeting:                findMeeting,
  _formatTurnsForPrompt:       formatTurnsForPrompt,
  _formatSeconds:              formatSeconds,
  _buildSectionGraderPrompt:   buildSectionGraderPrompt,
  _sanitizeQualificationCovered: sanitizeQualificationCovered,
  _sanitizeCoverage:            sanitizeCoverage,
  _sanitizeProspectContext:     sanitizeProspectContext,
  _selectMissedCuePair:         selectMissedCuePair,
  MIN_CUE_GAP_SECONDS:          MIN_CUE_GAP_SECONDS,
  _resolveWhatMattered:         resolveWhatMattered,
  _detectRoleInversion:         detectRoleInversion,
  _buildHighlightExtractorPrompt: buildHighlightExtractorPrompt,
  _markFathomCallErrored:      markFathomCallErrored,
  _sanitizeCashCollected:      sanitizeCashCollected,
  _sanitizePaymentStructure:   sanitizePaymentStructure,
  _sanitizeEodSummary:         sanitizeEodSummary,
  _claimAnalysisRun:           claimAnalysisRun,
  _CLAIM_STALE_MS:             CLAIM_STALE_MS,
};
