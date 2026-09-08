# Stage Grading Simplification Plan

Date: 2026-09-07  
Scope: architecture only; no model calls, database writes, migrations, source changes, deployments, or regrading were performed.

## Product decision this plan serves

Coaching stage metrics must be fair and useful. A score enters a stage population only when the transcript supports a trustworthy measurement. A stage that never became due, or that the recording does not let Scout judge, is not a zero and does not enter the population. The equal failure is losing an obvious, gradeable Pitch or Close because an explanatory sentence or a second model response was too strict.

The audit demonstrates the second failure in real calls: Darran's paid pitch/close, Sharon's extended pitch, the Unknown prospect's Discovery financial DQ, and Khalifah's observed Discovery work were withheld. This is an actual product failure, not a hypothetical model concern.

## What exists now

Normal analysis first normalizes the transcript and loads selling material. Its normal grader already reads that material and grades Intro, Discovery, Pitch, Objection Handling, and Close as part of its broad call-analysis response. In parallel an extractor produces moments. The newer Integrity lane then reads the same transcript and material again in a dedicated stage-candidate call, sends its output through a large deterministic gate, sends the surviving result to a separate independent reviewer, and only then projects it into `stage_eligibility` and the compatibility columns. The Coaching readers use `stageMetric` and admit only valid explicit eligibility records.

The reader side is the right shape. The writer side has accidentally made a score depend on three separate propositions:

1. The stage occurred and was scoreable.
2. The numeric score is supported by the rubric and selected transcript turns.
3. One very short note satisfies a custom grammar, every clause maps to the selected turns, and the reviewer returns an exact machine shape.

The third proposition is not necessary to establish the first two. Today, failure of any of them turns the entire stage into `unmeasured`.

The saved audit trace found 35 unmeasured stages. Twenty-two were stopped by the candidate gate, including 21 factual-note/selected-evidence failures; ten were actual independent-review semantic rejections; two were reviewer atomic-contract failures; one was genuinely incomplete source evidence. Of the 18 rows later labelled `supported` by review, 16 had already been replaced with a blank `unmeasured` review candidate by `reviewableCandidate`; they were not independently approved scores that a later parser lost. This is more fundamental than a parser repair: note validity is currently a veto on score validity.

## Current layers and recommendation

| Layer | Product problem solved | Audit effect | Recommendation |
| --- | --- | --- | --- |
| Transcript normalization and speaker/timestamp preservation | Gives every decision a stable, auditable source | Necessary; no evidence it caused loss | **KEEP** |
| Selling material/context loaded once | Lets grades use the actual offer and approved method | Necessary to judge the offer, DQ and follow-up context | **KEEP** |
| Existing normal grader's five section rubric | Grades sales work and already sees the full transcript/context | It duplicates the later stage producer today, but is the natural single grade operation | **KEEP and MERGE into the stage writer** |
| Dedicated stage candidate (`stage-assessment` → `stage-eligibility`) | Adds explicit five-stage applicability and evidence references | It duplicates a transcript read and its note gate erased many gradeable stages | **REMOVE FROM PRODUCTION PATH; retain only as experiment/QA until retired** |
| Explicit applicability states | Prevents N/A and unseen work becoming a penalty | Essential to the product and Coaching populations | **KEEP** |
| Stage context invariants (sales call, DQ, pitch/price, continuation, cutoff) | Stops fabricated stages and unfair downstream scores | Necessary when narrow, source-backed and deterministic | **SIMPLIFY and KEEP** |
| Fixed eight-turn evidence selection | Bounds payloads and makes audit practical | The cap/selection has omitted needed evidence in saved examples | **KEEP A SMALLER CLAIM-SPECIFIC SET**; make it select the strongest 2–4 references for each stage, never prose quotations |
| Factual-note grammar and banned-word list | Attempts to prevent misleading explanations | Directly caused valid work to become unmeasured; it tests wording rather than the grade | **REMOVE AS A SCORE GATE**; a bad explanation is suppressed, not a deleted score |
| Independent stage reviewer | Intended to catch unsupported candidate assertions | It adds a second full transcript operation yet does not independently calibrate a numeric score; exact response rules introduce false withholding | **OFFLINE QA ONLY**, not a per-call production dependency |
| Atomic note-claim audit | Ensures each explanatory clause has selected evidence | Useful for testing/coaching copy QA, but makes note prose a second grading system | **OFFLINE QA ONLY**; production displays source clips and an optional short reason |
| Paired factual-proof reads | High-confidence adversarial validation of saved observations | Useful release/sample QA, intentionally not production | **OFFLINE QA ONLY** |
| Provider transport schemas and review parser | Makes model output parseable | Extra candidate/reviewer contracts magnify harmless format failures | **MERGE** into one compact stage portion of the normal grader response plus a local validator |
| Reviewed eligibility persistence and compatibility projection | Makes one record the shared source for saved stage fields | Necessary; prevents legacy numeric fallback | **KEEP, simplified to consume the unified stage record** |
| `stageMetric` and verified-only Coaching readers | Uses the same population rule across cards, rankings, drilldowns and comparisons | Correctly prevents legacy/unverified scores from re-entering metrics | **KEEP UNCHANGED** |
| Broader-coaching grounding/review | Grounds separate coaching language and moments | Not part of stage population problem | **DO NOT CHANGE** |

## Existing rubric and doctrine that the simpler path must preserve

The current stage prompt and Doctrine already establish the material rules. Intro is judged at the actual opening, not a fixed first-minute cutoff. Discovery is the observed work on pain, goals, current situation, decision makers, why now, and financial resources when due. Pitch is an offer framed against discovered needs, not a generic description. An objection is resistance after offer presentation and price (or proven prior presentation); no objection means no Objection Handling score. Close is a purchase decision, not the mere end of a recording; a correctly booked continuation is not a purchase-Close failure. A genuine financial DQ properly found during Discovery makes later work not applicable, while a late DQ can expose an evidenced Discovery miss. Cutoff/ambiguous source is unmeasured. Follow-ups are judged only for work due on that call.

The documented numeric bands are: 85–100 exceptional, 70–84 strong, 55–69 adequate with real gaps, 40–54 weak, below 40 significant failure or barely attempted work that was due. The existing code verifies that a letter is one of A/B/C/D/F but does not contain a canonical numeric-to-letter mapping. Before the unified writer can enforce the requested “score/grade match” deterministically, the product needs that mapping stated explicitly. The natural mapping mirrors these already-written bands (A 85–100, B 70–84, C 55–69, D 40–54, F below 40), but it should be confirmed rather than silently invented.

## Recommended production architecture

Use the existing normal grader as the one authoritative stage assessment. It already has the normalized transcript, duration, selling material, rubric and ordinary analysis context. Its five stage outputs should become a compact, versioned `stage_eligibility` payload, rather than producing one ordinary section score and then asking two more models to decide whether that score can exist.

For each of the five fixed stages, the same response supplies:

- `state`: `evaluated`, `expected_but_missed`, `not_applicable`, or `unmeasured`;
- numeric `score` and canonical `grade` only for `evaluated`/`expected_but_missed`;
- a small set of exact transcript turn identifiers for the grade or state decision;
- a short optional plain-language reason.

The model sends identifiers, not copied or reconstructed quotes. Code resolves them to the stored speaker, timestamp and transcript text. This makes the visible audit evidence real even if the optional prose reason is absent.

The local validator remains strict where strictness protects a product fact:

- exactly one record for Intro, Discovery, Pitch, Objection Handling and Close;
- legal states and score/grade presence rules;
- grade equals the approved score band;
- evidence identifiers exist, are bounded, and code attaches their actual text;
- `not_applicable`/`unmeasured` have null score and grade, never zero;
- no Objection Handling score without price plus pitch/proven prior presentation;
- no downstream score after a source-established, properly handled early financial DQ;
- a cut-off or genuinely ambiguous source stays unmeasured;
- only the stage record creates compatibility score/grade/note fields;
- an invalid unified stage payload becomes a complete five-stage unmeasured record, while the rest of normal analysis completes.

The validator must not demand one special sentence grammar as proof of a numeric grade. If the optional reason is missing, too long, unsafe, or cannot be displayed cleanly, persist the score with `notes: null` (or a deterministic neutral label) and show the real source turns. A source-reference error that makes the score itself un-auditable remains a reason to withhold the score.

This is not trusting a free-form producer. It is one rubric-aware grade decision constrained by stable doctrine and a deterministic shape/evidence validator. The same saved record continues to be the only source accepted by `stageMetric`; legacy rows remain excluded.

## Decision tree

1. Normalize transcript and load existing selling material once. If source/speaker/timing cannot be trusted, save all five as `unmeasured`.
2. The normal grader returns a record for all five stages with stage state, score/grade when applicable, and small exact source-turn identifiers.
3. Validate structural completeness and hard doctrine/context invariants.
   - Structural or safety-relevant failure: save a five-stage `unmeasured` record; do not use ordinary legacy section fields.
4. For each valid stage:
   - `not_applicable`: source establishes it was not due. Null score/grade; do not contribute.
   - `unmeasured`: source cannot establish occurrence/due work or enough work to grade. Null score/grade; do not contribute.
   - `evaluated`: observed, rubric-gradeable work with valid source identifiers and matching score/grade. Contribute.
   - `expected_but_missed`: source establishes due work and the miss, with valid source identifiers and matching score/grade. Contribute.
5. Independently validate display prose, if supplied.
   - Safe short reason: persist/display it with exact source clips.
   - Bad, interpretive, missing, or overlong reason while stage/score/evidence remain valid: suppress the reason only; retain the grade and actual clips.
   - Incorrect/missing source references such that the score cannot be audited: withhold that stage as `unmeasured`.
6. `stageMetric` admits only persisted validated `evaluated` and `expected_but_missed` records. All Coaching readers remain unchanged and therefore agree.

## Model operations and cost/latency

Current normal analysis has a full-transcript normal grader and extractor. Stage grading additionally makes one full-transcript Sonnet candidate call and one full-transcript Opus independent-review call. Thus dedicated stage grading costs **two added model operations per call**, while **three transcript-wide operations produce stage-related judgment** when the normal grader's existing five section scores are included. The extractor is a fourth normal analysis operation but does not grade stages. Offline factual-proof QA adds **two more calls per surviving scored observation** and is not in the live writer.

The proposed design adds **zero stage-specific production calls**: the already-required normal grader is the one stage segmentation/applicability/rubric-grade operation. Normal analysis remains the grader plus extractor (two baseline operations) before any separate broader-coaching lanes. Independent review and paired proof remain opt-in offline audit tools for representative release samples, prompt changes, and disputed calls—not required per analyzed call.

## Why this is the smallest reliable change

It repairs the actual failure: legitimate, measurable work disappearing before it can enter a verified population. It does not make non-occurring work scoreable, infer eligibility from old numbers, or put ungrounded evidence on screen. It avoids repairing a complex candidate/reviewer transport that cannot demonstrate numeric-score correctness and whose note rules turned explanation quality into score truth.

The tradeoff is intentional: production loses a separate per-call adversarial model veto. In return it eliminates duplicate transcript reads, lower latency/cost, and the demonstrated false-negative bottleneck. Accuracy protection moves to deterministic invariants, exact displayed source clips, versioned records, verified-only readers, and small offline human/paired-proof samples. That is a better match for the product’s real risk: unfair or unexplained displayed performance, not syntactically imperfect prose.

## Exact source areas for a future implementation block

- `backend/lib/analysis-worker.js` — change the existing normal grader’s five-section contract and parse it into the unified eligibility record; remove the production `stageColumnsForAnalysis` model invocation while retaining normal non-stage outputs.
- `backend/lib/stage-eligibility.js` — reduce to state/rubric/evidence/persistence validation and compatibility projection; remove factual-note grammar as a score veto; retain five-stage and hard context safeguards.
- `backend/lib/stage-output-schema.js` — retire the production candidate/reviewer transport or reduce it to the compact unified stage payload if a schema is retained.
- `backend/lib/stage-assessment.js` — remove it from the normal production writer; preserve/relabel its candidate/reviewer/proof facilities as offline QA until a later cleanup decision.
- `backend/lib/stage-eligibility-review.js` and `backend/lib/stage-observation-review.js` — retain as offline sampling tools only; no normal-worker invocation.
- `backend/test/stage-eligibility.test.js`, `backend/test/stage-assessment.test.js`, `backend/test/stage-eligibility-review.test.js`, `backend/test/analysis-worker*.test.js` — replace production-path assumptions with fixtures that prove source-backed grades survive bad/missing prose, while invalid source/state payloads still fail closed.

No change is needed in `stageMetric`, `section-ranking.js`, `section-breakdown.js`, `coachable-team.js`, or `routes/me.js` for the writer simplification. They already consume validated eligibility records and keep legacy data outside verified populations. No broader-coaching file should change.

## Smallest future implementation block

After the score-to-grade mapping is confirmed, write local fixtures first for: a normal completed sale with Pitch/Close; a correct Discovery financial DQ; a late-DQ Discovery miss; no objection; no Pitch/price; booked continuation; cutoff; and a follow-up. Make the normal grader's existing five stage results emit the compact state/score/grade/evidence form. Validate and project that one form into `stage_eligibility` and compatibility columns. Prove an invalid record becomes five unmeasured stages, a bad note only loses its note, and verified readers include only valid contributing states. Use no production calls during that implementation block. Only then take a small human audit sample before discussing migration or deployment.

## One product ruling

Justin should confirm the canonical score-to-letter mapping. The score bands exist in Scout’s current rubric, but no deterministic A/B/C/D/F boundary is implemented. Engineering should not quietly create it. No other product ruling is needed to simplify the architecture: Doctrine already answers applicability for DQs, continuations, cutoff, objections, pitch/price, and follow-ups.

## Scope check

This plan directly fixes trustworthy Coaching populations: observable work becomes a source-backed score, legitimate N/A stays out, truly unknown stays out, and every accepted metric uses the existing shared eligibility reader. It does not reopen word bans, producer perfection, isolated audit judgments, historical grading, migration/cutover, broader coaching, or deployment. Those are either offline QA concerns or later operational work.
