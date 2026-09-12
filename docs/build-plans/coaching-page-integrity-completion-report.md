# Coaching Page Integrity, Design & Stage Classification — completion report

**Written 2026-09-11 (Block 008, `SCOUT-BUILD-SESSION.md`). Closes BUILD-LIST Task 1.** Every claim below points at the block, ruling (`H###`) or guard that carries it. Two items are carried out of this task rather than closed; they are named at the end and in `BUILD-LIST.md`. Nothing here is live: the work sits on `codex/team-coaching-ready`, unpushed.

## Stage-score integrity

- **Why the stage cards had different call counts.** They averaged whatever numeric grade happened to exist per section (`intro_score`, `discovery_score`…), so a call with a missing or inapplicable score for one stage dropped out of that stage only. Accidental grade availability, not an eligibility model (the September 6 investigation, `~/Desktop/scan-reports/coaching-integrity/investigation.md`).
- **The eligibility model now used.** Every stage on every call is one of four explicit states written by the normal grader and validated deterministically — `evaluated` · `not_applicable` · `expected_but_missed` · `unmeasured` — in `call_analyses.stage_eligibility` (`lib/stage-eligibility.js assessProduction`, live since 2026-09-08, Stage D). A stage contributes to a period average only when it is `evaluated` or `expected_but_missed` with a canonical grade (`stageMetric`); `not_applicable` and `unmeasured` never contribute and are never zero; rows graded before stage grading read `legacy_unreviewed` and are never counted (H765: the zero explains itself). A lowest area is named only at the floor of ten counted calls in that section (H768, `MIN_CALLS_TO_RANK`); below it the panel says "Not enough to judge" and names nothing.
- **Correct financial DQ in Discovery.** Discovery scores the qualification work; Pitch, Objection Handling and Close are `not_applicable` (H768, validator rule; Block 006 flow D).
- **Missed financial qualification found late.** Discovery may carry an evidenced `expected_but_missed`; Objection Handling and Close are still `not_applicable` — inability is never a failed close (H768; Block 006 flow E).
- **Other edge cases (validator, Block 006 flows A–G, `test/stage-definitions.test.js`).** No objection on record → Objection Handling is never scored. No purchase decision due (`close_due=false`) → Close is never scored. A correct continuation → later stages not due. A cut-off recording cannot manufacture a missed stage (H772). A follow-up grades only what became due on it; a prior presentation makes Objection Handling and Close scorable without repeating Discovery or Pitch. An invalid finance fact gates nothing (H771).
- **Unresolved product decisions.** None on the model itself. Two carried items are listed at the end.

## Design

- **Why Close 54 was green.** The weakest stage cell carried the accent as a FOCUS/selection treatment — a hardcoded green border and bar on the selected (weakest) card — not a score band (the September 6 investigation: "weakest-stage CSS is hardcoded green").
- **What changed.** The cell's focus state is a neutral strong border (`--border-strong`); the bar and score colour follow the existing score bands only (`scoreColor`: good ≥70, mid ≥50, bad). Weak is red, never green. Guarded rendered: `test/period-workspace.test.js` (the weak bar is `--bad`, the focus border is not the accent, the advice block's edge is not the accent).
- **Existing rules applied.** Scores coloured only when they cross a band (H657); Scout green means good/brand (H364); the seven-size type scale, three weights ≤500, three radii, no grey body text — the literal ratchet and type-scale guards stayed green through Blocks 004–006.
- **Tests.** `period-workspace.test.js`, `coaching-focus-selection.test.js`, `coaching-focus-diagnosis.test.js` (rendered at 1400 and 390 px, no horizontal overflow), `new-grading-copy.test.js`, `stage-dq-not-applicable.test.js`, `scale-literals-ratchet.test.js`, `customer-language.test.js`; real-payload renders in `~/Desktop/scan-reports/block-004-option4/` and `block-005-cross-stage/`.

## UX

- **Explanatory copy removed.** The "Examples cover N reviewed calls; N have not completed this review…" paragraph (September 6); the coaching-topic tag list and the five open accordions of five examples each (Block 004). The page now leads with one priority, its period diagnosis, what to coach, and one call example; the rest is collapsed ("More calls with this", "Other coaching from these calls", "Recent calls in this period").
- **"2 of 11 calls reviewed for examples".** Removed. It exposed the review-population mechanics; the reviewed denominator now appears only inside the diagnosis sentence where it carries meaning ("came up in 3 of 5 reviewed Close calls"), by the architect's Block 003 decision.
- **Explanatory UI that genuinely remains.** The H765 sentence beside a zero on a legacy window (temporary by construction); the floor sentence "Not enough to judge" with its reason; the insufficient/outlier/isolated sentences of the diagnosis (each says what the data supports, nothing about mechanism).
- **Carried, not closed: the per-cell "N graded calls" labels (§9).** Still rendered. The architect folded them into the deferred stage-cell decision (remove the cells, or return them to the top with the lowest stage emphasised) recorded at the end of `BUILD-LIST.md`; removing the labels alone would pre-empt that decision, and the H765 zero-sentence lives in the same slot. Not done in this task.

## Coaching

- **Root cause of the 2:33 / Close issue.** Presentation and selection, not classification: the page put the period's lowest-scoring stage label above whichever finding sat first, so a Discovery example at 2:33 could appear under "Close" (Block 002's finding). The example's own stage was correct.
- **What changed.** Blocks 002–006: the diagnosis is period-wide and belongs to the lowest stage (`focus`); the representative example is selected separately and must support that stage; a finding from another stage is never the lowest stage's reason unless it is an EARLIER stage's gap whose cited exchange carries the located purchase decision (Blocks 002 and 005); a follow-up-booking finding is Close evidence only where a purchase decision was located (Block 006); one call is isolated, never a trend; a low average carried by one call says so; insufficient evidence keeps the stage and substitutes nothing (Block 003).
- **How conversational structure is incorporated.** The grader's stage rules and Justin's canonical definitions (Block 006, `STAGE_DEFINITIONS`/`STAGE_BOUNDARIES`: behavioural stages that interleave; first ask = Pitch; loop re-asks = Objection Handling; Close = commitment and transaction); the period review's two agreeing fact reads that locate each purchase decision; the doctrine's after-pitch-and-price objection rule; no timestamp rule anywhere.
- **Real-call validation.** Real payloads pulled read-only and diffed rep by rep after Blocks 005 and 006 (only the intended reps moved); every focus state rendered from real data (Block 004); Block 007's $0 audit read three findings by hand against their transcripts.
- **Regressions found and resolved.** Block 004 (visual): a long recommendation pushed the score under the text — fixed. Block 005 (real data): a Close finding served as an Objection Handling diagnosis — fixed by the direction rule. Block 006: the old Close rubric bullet graded price and the first ask as Close — replaced by the canonical definitions.

## Doctrine

- **Financial-DQ clarification.** Reflected: the doctrine's money boundary (a genuine inability is never an objection or a failed close; coach the upstream qualification), the grader prompt (v61 → v62), the validator (H768), Block 006 flows D and E.
- **Intro, Pitch, Close definitions.** Sufficiently defined as of Block 006, in Justin's words, canonical in `lib/stage-eligibility.js` and printed by both grader prompts. **Carried: the brief (§16, §22) asks that approved definitions also be added to the canonical Doctrine file.** They are in code, not in `backend/doctrine/scout-doctrine.md`; adding them there is a doctrine edit (a version bump and a KB reload) — Justin's call, filed.
- **Product decisions still needed.** The two carried items only.

## Rule conflicts surfaced (not changed)

- The per-cell graded-call labels conflict with the H765 zero-sentence sharing the slot (§9, carried).
- The period-review lane's ask lens and single "asking for the sale" move cannot separate first ask / re-ask / close ask (Block 006 filed it; Block 007 measured zero impact; left alone by decision).

## Section-by-section status

| § | Requirement | Status | Where |
|---|---|---|---|
| 1 | Green treatment | Closed | Block 004; `period-workspace.test.js` |
| 2 | Preserve the design system | Closed | Blocks 004–006 under the ratchet and scale guards |
| 3 | Remove explanatory copy | Closed except §9 | Block 004; September 6 |
| 4 | Investigate stage call counts | Closed | September 6 investigation; H768 |
| 5 | Comparable scores | Closed | stage records, verified-only, the floor (H768) |
| 6 | Financial-DQ rule | Closed | H768; Block 006 D/E |
| 7 | Stage eligibility model | Closed | four states, `assessProduction` |
| 8 | Comparability vs eligibility | Closed | explicit eligibility, never availability |
| 9 | Remove "N graded calls" labels | **Carried** | deferred stage-cell decision, end of `BUILD-LIST.md` |
| 10 | "2 of 11 calls reviewed" | Closed | removed |
| 11 | 2:33 / Close root cause | Closed | Blocks 002–003 |
| 12 | Doctrine's structural rules | Closed | after-pitch-and-price in grader and review |
| 13 | Conversation progression | Closed | Block 006 boundaries; located decisions |
| 14 | Event location vs cause | Closed | Blocks 002, 005, 006 |
| 15 | Existing Discovery/Objection doctrine | Closed | unchanged, used |
| 16 | Audit Intro/Pitch/Close | Closed in code; **carried** into the doctrine file | Block 006 |
| 17 | Challenge rules openly | Closed | every block's decision list |
| 18 | Validation — eligibility | Closed | Block 006 A–G; real-payload diffs |
| 19 | Validation — coaching structure | Closed | Blocks 004–007 |
| 20 | Validation — UX/design | Closed except §9 | Block 004 renders |
| 21 | Regression protection | Closed | full suite green at every block (2,780 at Block 006) |
| 22 | Documentation | Closed except the doctrine-file item | `current-state.md`, decisions table, this report |
| 23 | Completion report | This document | — |
