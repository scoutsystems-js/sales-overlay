# Scout — build session log (architect ↔ developer)

The one shared, append-only record of handoff blocks between the architect (ChatGPT) and the developer (Claude Code), with Justin between them. Read `SCOUT-BUILD-BRIEF.md` and `SCOUT-PRODUCT-DECISIONS.md` first. This file is a log, not a queue: the queue stays in `BUILD-LIST.md`; the standing rules stay in `CLAUDE.md`.

## The loop

1. Justin and the architect discuss the desired product result.
2. The architect appends a numbered prompt block to this file (`Block NNN`).
3. Every architect prompt begins with three fields, in this order: **Summary**, **Goal**, **How this relates to the overall build session**.
4. Justin pastes the prompt into Claude Code.
5. Claude Code performs only that bounded task and appends its report to the same numbered block. Prior blocks are never overwritten or edited; a correction is a new block that names the one it corrects.
6. Justin replies `c` or `check SCOUT-BUILD-SESSION.md`. The architect reads the latest report and supplies the next scoped prompt.

**`c` means:** "read the latest developer report and continue the architect review/handoff loop." It is not permission to keep altering code. Code changes need a new scoped prompt block.

## Handoff template

Copy this for every block. Fill the prompt half before handing off; the developer fills the report half.

```
## Block NNN — <short title> — <date>

### Prompt (architect)
Summary
Goal
How this relates to the overall build session
Read first
Scope
Preserve / do not change
Verification

### Report (developer) — report back in this block
Findings
Files changed, with the reason for each
Verification results (what was run, what it showed)
Assumptions made / decisions needed from Justin or the architect
Commit and deploy state (factual: hash if committed; pushed or not; deployed or not)
```

## Design interoperability

- ChatGPT mockups are **design references**, not executable specifications, and not proof that their sample data or logic is correct.
- Before an implementation block, the architect states: the page's user and job; the required hierarchy, interactions and states; the behaviour and data rules the UI may claim; the boundaries; and how the result will be verified visually.
- Claude adapts that intent to Scout's existing components, design system (`SCOUT-DESIGN.md`) and real data paths. It does not copy pixels or invent logic to make a mockup's sample content true.
- A material constraint or product choice met during the block is reported in the block, not chosen independently.

---

## Block 001 — Establish the shared handoff workflow — 2026-09-11

### Prompt (architect)

**Summary.** Set up a simple, repository-native shared handoff workflow for Scout. ChatGPT acts as product/technical architect; Claude Code acts as developer. The workflow must preserve current product decisions, make implementation reports visible to the architect, and prevent either side from silently expanding scope.

**Goal.** Create two short baseline context files and one ongoing append-only session/report file in the repository root. Update the existing reporting instruction only as needed so architect/developer handoff reports go into the shared session file instead of a separate Desktop file.

**How this relates to the overall build session.** Scout is in testing and a focused redesign of the Team Coaching page is beginning, using the approved "Option 4" direction. Before that page changes, establish a shared written record so the architect, developer and Justin work from the same current product context. Workflow/documentation only; not permission to redesign or modify Coaching yet.

**Read first.** `CLAUDE.md`, `SCOUT-DESIGN.md`, `BUILD-LIST.md`, the Team Coaching implementation (enough to locate future work), any existing workflow/handoff/report files.

**Scope.** (1) Inspect for a comparable existing workflow; reuse it if it truly satisfies the goal. (2) Create `SCOUT-BUILD-BRIEF.md`. (3) Create `SCOUT-PRODUCT-DECISIONS.md` with one open question on whether the Coaching selection logic finds a recurring stage-relevant pattern or an isolated issue. (4) Create `SCOUT-BUILD-SESSION.md` defining the loop, `c`, the template, design interoperability, and Block 001. (5) Make the smallest clear edit to `CLAUDE.md` so handoff-block reports append here instead of the Desktop file.

**Preserve / do not change.** No change to Coaching UI, scoring, grading, prompts, data, production records or business logic. No Option 4 implementation. Do not replace the detailed project rules. No planning system, backlog system, automation or new architecture. Do not deploy or push.

**Verification.** Three concise files in the repository root; the session file contains the loop and the required opening fields; the `CLAUDE.md` edit is narrow and does not conflict with unrelated reporting rules; the final diff has no duplicated or contradictory workflow instructions.

### Report (developer) — report back in this block

**Findings — what already existed.**
- `CLAUDE.md` §2 sends every block's report to `~/Desktop/scout-findings.md`, overwritten per block (H558). `AGENTS.md` (Codex's copy of the rules) carries the identical line at its line 37; it was not edited, because the prompt scoped the edit to `CLAUDE.md`.
- `gpt.md` is GPT/Codex's own progress log (newest at the top, not numbered, no prompt/report pairing); `current-state.md` is its state snapshot; `CODE-RESPONSE.md` is one architecture-review reply; `docs/build-plans/` holds one verbatim architect brief; `BUILD-LIST.md` is the queue. None is a numbered architect-prompt / developer-report loop shared by both sides, so nothing was reused. The three new files point at those files rather than restating them.
- No file in either tree mentions "Option 4". The approved direction is recorded from the prompt's own description only.
- **Two trees.** The canonical iCloud root (`sales-overlay/`, branch `main` at `1085f2e`) is 82 commits behind `origin/main` (`fc6bf77`), which equals this worktree's branch `codex/team-coaching-ready`. The root working tree also carries uncommitted, older versions of `CLAUDE.md`, `BUILD-LIST.md`, `SCOUT-HISTORY.md` and the doctrine files, plus untracked docs that are committed here. This session was moved into the `.codex/team-coaching` worktree, so the three files and the `CLAUDE.md` edit live here, on the branch production runs from. Nothing was written to the stale root.
- Team Coaching's code, for future blocks: `GET /team/coachable-moments` in `backend/routes/team.js`; `backend/lib/coachable-team.js`, `coachable-moments.js`, `rep-period-coaching.js`, `call-period-review.js`, `rep-line.js`, `section-ranking.js`, `stage-eligibility.js`; Fine Tune in `coaching-corrections.js`; the `team-coaching` view in `backend/web/dashboard.html`.

**Files changed, with reasons.**
- `SCOUT-BUILD-BRIEF.md` (new, 2.9 KB): the shared baseline — what Scout is, who decides what, working rules, the Team Coaching job and Option 4 direction, the evidence/causality rule, the Fine Tune boundary, Scout AI.
- `SCOUT-PRODUCT-DECISIONS.md` (new, 3.0 KB): ten settled decisions as a table with where each is recorded, plus the required open question on selection logic and a second on the missing Option 4 reference.
- `SCOUT-BUILD-SESSION.md` (new, this file): the loop, the meaning of `c`, the handoff template, design interoperability, Block 001.
- `CLAUDE.md`: one indented sub-bullet under the existing report rule (line 29). Nothing else moved.

**The reporting-rule conflict resolved.** The standing rule sends reports to the Desktop file, overwritten per block; this workflow needs them appended to a numbered block in a repo file the architect can read. The edit adds an exception scoped to tasks that arrive as a numbered block in this file; every other clause of the rule (evidence artefacts under `~/Desktop/scan-reports/`, the hold on an un-reviewed report) still applies. Reports for non-handoff work still go to the Desktop file.

**Verification performed.**
- The three files exist in the worktree root; sizes 2,866 / 2,973 / 5,070 bytes.
- The session file contains the six-step loop, the `c` definition, the template, and every required field (Summary, Goal, How this relates…, Read first, Scope, Preserve / do not change, Verification, report back in this block) — checked by grep, each present.
- `git diff CLAUDE.md` is a single added line; `wc -c CLAUDE.md` = 145,817 (the 150,000 ceiling holds; it was 145,334 before and is not "well under").
- Report-destination mentions across the four files were listed together: one rule, one scoped exception, no second instruction anywhere.
- `git status` shows no change under `backend/` (the `node_modules` entries are pre-existing untracked directories). No Coaching UI, scoring, grading, prompt, data or production record was touched. No tests were run: no code changed.

**Assumptions and decisions needed.**
- Option 4 reference: the architect should attach or restate it with the first Coaching prompt (see the open question in `SCOUT-PRODUCT-DECISIONS.md`).
- The two trees: someone must decide how the canonical root is brought forward to `origin/main`. A fast-forward there is blocked by its local edits and untracked files; not attempted, as it is outside this task.
- `AGENTS.md` carries the same Desktop-report rule for Codex. If Codex will ever take a handoff block, it needs the same exception; not edited here.
- Convention: `CLAUDE.md` rules normally carry an `H###` pointer with reasoning in `SCOUT-HISTORY.md`. The exception carries a date instead; adding a history entry was left out to keep the edit narrow. Justin's call whether it gets one.
- `BUILD-LIST.md` was not updated (it is updated after a push; no push happened).

**Commit and deploy state.** These files and the `CLAUDE.md` edit are committed together in one local commit on `codex/team-coaching-ready` in the `.codex/team-coaching` worktree (the hash is `git log -1` on that branch). **Not pushed. Not deployed. No deployment or push occurred.**

---

## Block 002 — Validate and tighten Team Coaching selection logic — 2026-09-11

### Prompt (architect)

**Summary.** Validate, and correct only if needed, the logic that picks what Team → Coaching says about each rep.

**Goal.** For each rep the page tells the manager: (1) the ONE stage the rep most needs coaching on; (2) the specific coaching issue driving that weakness; (3) ONE representative real-call example showing it; (4) what the manager should coach. Manager-facing; not a broad analytics page.

**How this relates to the overall build session.** Newly approved product decision, recorded in `SCOUT-PRODUCT-DECISIONS.md`: *lowest stage → strongest supported coaching pattern/opportunity within that stage → one representative call → manager guidance.* Prefer a recurring pattern when the period data genuinely supports one; no statistical pattern-detection system to satisfy the word "recurring"; without recurrence, the strongest supported opportunity within the lowest stage; the coaching point must genuinely explain the lowest stage's weakness; never an unrelated weakness merely because it occurred on one of the rep's calls. Cross-stage evidence only when the causal relationship is actually supported (a Discovery finance miss is Close evidence only if it impaired the Close). Keep it simple; no causal-inference engine. This block validates/corrects the selection contract; the Option 4 visual redesign is the NEXT block.

**Read first.** `SCOUT-BUILD-BRIEF.md`, `SCOUT-PRODUCT-DECISIONS.md`, `SCOUT-BUILD-SESSION.md`, `current-state.md`, `CLAUDE.md`, the Team Coaching selection code and tests. Use the clean `.codex/team-coaching` worktree.

**Scope.** Inspect first: trace the production path for the lowest stage, the topic/title, the advice, the example call, the transcript evidence, and how they are tied to the stage. If the rule already holds: no rewrite, minimum tests/docs. If a real mismatch: smallest cause, smallest correction; preserve the simplified stage grading and the verified-only population contract. Do not assume the GPT mockup's mismatched example is a bug — it used illustrative content.

**Preserve / do not change.** No stage-grading architecture change, no score/grade mapping change, no regrade, backfill, migration or production data change; no push, deploy or Railway; no canonical-root Git cleanup; no CLAUDE.md refactor; no AGENTS.md sync; no unrelated analytics; no new paid AI/model operations; no paid API calls without Justin's explicit approval; no Option 4 UI.

**Verification.** At the product boundary: A. a Close-weakest rep gets a Close-supported issue. B. an unrelated Discovery weakness cannot become the Close point because it was on the same call. C. a Discovery weakness CAN support Close when the evidence explicitly establishes it affected the Close. D. a recurring supported pattern can be preferred. E. without recurrence, one strong supported opportunity in the lowest stage, no invented trend. F. the representative example supports the claim.

**Report back in this block.** The ten numbered items in the prompt, then `PAID API COST THIS BLOCK = $0` if true, then STOP.

### Report (developer) — report back in this block

**1. What the current production selection path actually does.** `GET /team/coachable-moments` calls `loadCoachableTeam` with `periodOnly:true` (the legacy `improvements`/`items` lanes are empty on this page), then per rep `rep-period-coaching.summarize`:
- *Lowest stage:* `sectionStatsFromAnalyses` over each call's `stage_eligibility` record (`stageMetric`, verified-only), then `rankSections` with the H768 floor (ten counted calls in the section). Below the floor no stage is named.
- *Topic/title (e.g. "qualifying financially"):* the stored `rep_period_coaching` findings on the rep's calls in the window, each carrying a `section` and a `move`. The writer proposes both; the independent reviewer's `skill_check` overwrites them with its own classification of the proposed improvement; `period-stage-facts.allows` withholds a close/objection finding unless two agreeing fact reads located a purchase decision. `storedExamples` re-verifies every finding against the transcript (or its verified slice) at read time.
- *Advice:* the finding's `observation` and `recommendation`.
- *Example call and exchange:* the finding's cited `turn_ids`, quoted from the stored transcript; the pattern's examples are ordered newest first.
- *Association with the stage:* only the finding's `section`. Patterns (grouped by `section|move`) were sorted lowest-stage-first, then by call count, and the page opened `patterns[0]` under the "Lowest-scoring area" header.

**2. Was the suspected mismatch real?** Real, but narrow. When the lowest stage had a supporting finding it led. When it had none, the page still opened the first pattern from another stage directly under "Lowest-scoring area: Close" — the mockup's scenario could happen in production, and nothing in the payload distinguished "the reason for the lowest stage" from "other reviewed coaching". Cross-stage support had no representation at all: a Discovery finding could never count for Close, and nothing said so.

**3. Implementation change made.** The smallest one that states the rule in data: `period_summary.focus` and `period_summary.focus_note`.
- `focus` = the lowest stage's strongest supported pattern: same stage, or (the one cross-stage signal the stored record can establish) an example whose cited exchange carries the located purchase decision when the lowest stage is a decision stage (close, objection). Most supporting calls first, then most recent; `recurring` is true from two calls; one call is a focus with `recurring:false`. It carries the representative `example` (the most recent supporting finding).
- `focus_note` = one sentence when a lowest stage exists, patterns exist, and none supports it. Nothing is deleted or hidden: every pattern stays listed and counted.
- `call-period-review.storedExamples` attaches `decision_turns` (the finding's cited turns that are the located decision) by re-locating the stored fact reads, for every record version. The same computation the v16 gate already ran per finding, now run once per record.
- The page opens only the focus pattern; with no focus nothing opens and the note renders. No other page change.

**4. Files changed.** `backend/lib/rep-period-coaching.js` (focus, focus_note, focus-first order); `backend/lib/call-period-review.js` (decision_turns; stage facts computed once); `backend/web/dashboard.html` (two lines in `coachingPeriodWorkspaceHtml`); `backend/test/coaching-focus-selection.test.js` (new); `SCOUT-PRODUCT-DECISIONS.md` (row 11, open question answered); `current-state.md` (a dated local-not-live note at the top); this file.

**5. Tests run and results.** New guard, eight tests, written first and watched fail (8/8 failed before the change), then A–F plus the below-floor case and the rendered page pass. Planted three times, each caught and each file restored: the section check kept with its effect discarded (A, B, C and the page fail), `decision_turns` never attached (C fails), the page opening the first pattern regardless of focus (the page test fails). Full backend suite: 2,759 passed, 0 failed (2,751 before this block). `node -c` on both libs.

**6. Recurring-pattern behaviour.** Already existed as a count: patterns group findings by stage and skill across the rep's window calls and sort by call count. The bounded change is that the focus now counts only the examples that support the lowest stage, and says `recurring` explicitly instead of leaving a manager to infer it from "2 calls".

**7. Cross-stage causality after this block.** A finding from another stage supports the lowest stage in exactly one case: the lowest stage is close or objection and the finding's cited exchange contains the turns the two independent fact reads agreed are the purchase decision. That is a structural fact the manager can see in the quoted exchange, not an inference. Everything else stays under its own stage and never becomes the lowest stage's reason. The writer prompt forbids causal claims in observations, so no stored prose "explicitly establishes" impact; the located decision is the only explicit link available without a new model pass.

**8. Remaining product questions for architect/Justin.**
- Is "the cited exchange carries the located purchase decision" the right bar for cross-stage support, or too loose (proximity, not proof of impairment) or too strict (a Discovery miss whose consequence at the close was not cited)? It is the only stored signal; a stricter one needs a new field the writer does not produce.
- Should `objection` count as a decision stage for cross-stage support alongside `close`? Built that way because the existing stage-facts gate treats the two alike; a ruling can narrow it to close.
- Whether live reps show recurring patterns or isolated issues is a question about real output. Justin should read the live page (after a deploy that is not this block's) before Option 4 fixes the presentation.
- The `focus_note` wording ("No reviewed change in Close for these dates. The coaching below is from other areas.") is customer-facing and Justin's to approve or cut.

**9. Git state.** Working tree: the six files above plus the new test, committed together in one local commit on `codex/team-coaching-ready` in `.codex/team-coaching` (the hash is `git log -1` on that branch). Ahead of `origin/main` by two commits (Block 001 and this one).

**10. Explicit confirmation.** No grading architecture redesign. No migration, no backfill. No production write. No push, no deploy, no Railway. No paid API or model calls; every test ran on fixtures over a fake wire.

PAID API COST THIS BLOCK = $0

---

## Block 003 — Period-wide diagnosis of the lowest stage — 2026-09-11

### Prompt (architect)

**Summary.** Product correction: "lowest stage → strongest bad example in it" is too shallow. The stage score tells Scout WHERE the manager should look; the period-wide evidence for that stage tells Scout WHY it needs coaching. Separate jobs.

**Goal.** For each rep: the lowest eligible stage by the existing verified-only rules; then every eligible instance of that stage in the period; then behaviour patterns from the structured findings, preferring recurring weaknesses, then repeated strengths in the same stage, then occasional secondary issues, then isolated problems only when no pattern exists. The focus describes the period-wide pattern, not the representative call. A low average carried by one outlier is said plainly. Too little evidence is an explicit low-confidence state that keeps the stage. The representative example is evidence for the diagnosis, never the diagnosis. An optional concise "what they do well" from the same stage.

**How this relates to the overall build session.** Builds directly on Block 002's `focus`; the Option 4 visual redesign remains the next block. Manager-and-above page; simple job: rep · lowest stage · why across the period · one representative example · optionally a strength · Fine Tune action.

**Read first.** The shared handoff files, `CLAUDE.md`, the canonical state file, Block 002's implementation and report, the aggregation/selection code, the manager-card renderer, the period/section/focus tests.

**Scope.** Deterministic pattern logic from data Scout already stores (structured labels, finding types, rubric criteria, stable identifiers); no LLM pass; no fuzzy clustering; if no stable identifier exists, stop and report the gap. Recurrence: one distinct call is isolated, two or more may be recurring; stronger frequency outranks weaker; ties by recency/severity. Evolve Block 002's `focus` payload, no parallel object. UI stays Option 4-shaped and minor: no extra cards, tabs, badges, charts, evidence lists or controls.

**Preserve / do not change.** No grading architecture redesign; stage grading touched only to consume verified records; no migration, backfill, regrade, deploy or push; no paid model calls; not a generalised coaching engine; Block 002's cross-stage guard kept as is (diagnose primarily from the stage's own findings; never invent causality). Supabase Pro is infrastructure context only — no new persistence merely because capacity exists.

**Verification.** Tests first: A recurring weakness on several calls; B two issues, the recurrent one primary, the smaller secondary; C one outlier among solid calls, no recurring claim, the outlier explained; D recurring weakness plus recurring strength, both represented, the strength never displacing the focus; E one eligible call, isolated, never a trend; F no supporting finding, stage kept, explicit insufficient state, no substitution; G a cross-stage finding without causal support cannot explain the lowest stage; H Block 002 and the verified-only population intact. Focused tests, then the full suite.

**Report back in this block.** The thirteen numbered items in the prompt, ending with the confirmations and `PAID API COST THIS BLOCK = $0`. Commit locally when tests pass; no push, no deploy.

### Report (developer) — report back in this block

**1. What Block 002 actually did.** Found the lowest stage (verified-only stage records, the H768 floor), grouped the period's reviewed findings by stage and skill, and picked the lowest stage's pattern with the most calls as `focus`, with its most recent finding as the example. The page showed the stage and opened that pattern. It said nothing about WHY the stage was low across the period: no denominator, no secondary issue, no strength, no outlier, and an unsupported stage was a null focus with a one-line note.

**2. What changed.** `focus` is now the period-wide diagnosis of the lowest stage, computed in code from stored data. It carries a `state` (pattern · isolated · outlier · insufficient), a one-sentence `summary`, the primary behaviour (`move`, `move_section`, distinct `calls`, `recurring`, `support`), up to two `secondary` behaviours with their counts, `reviewed_calls` (the denominator), an optional Discovery `strength`, an `outlier` when one call carries the low average, and the representative `example`. The stage is always kept; nothing is substituted. The page renders the summary and the strength beneath the lowest-scoring area (their own class, `coaching-period-diagnosis`, because `.coaching-period-note` means the new-grading sentence and a guard asserts its absence) and opens a pattern only when the focus has one. Nothing else on the page moved.

**3. Exact data source for period-wide patterns.** Two stored, structured sources, no new pass:
- Weaknesses: `call_analyses.rep_period_coaching.findings[]` on the rep's window calls, re-verified at read time by `storedExamples`. The behaviour identity is the finding's `move` — a closed vocabulary (`lib/arc-cause.js ALL_MOVES` plus "tying back in") assigned by the independent reviewer's `skill_check`, not the writer's suggestion and not text. Grouped by `section|move` (already Block 002's grouping).
- Strength (Discovery only): `call_analyses.stage_eligibility.context.discovery.areas[]` — the normal grader's evidenced work record of the six Discovery areas per call, stored with the stage assessment since Stage D. No structured per-stage positive exists for intro, pitch, objection or close without re-reading `call_highlights` (a read the speed release removed from this route), so no strength is claimed there.
- The stage itself and the denominator: `stage-eligibility.stageMetric` (verified-only), unchanged.

**4. Exact recurrence rule.** Distinct calls carrying the same reviewer-classified `move` in the lowest stage. Two or more distinct calls → `recurring: true`, state `pattern`. One call → state `isolated`, `recurring: false`, the sentence says "came up in one call" and never uses "pattern", "recurring" or "consistent". Primary = most distinct calls, then the most recent example, then move name; the next two become `secondary`. Denominator `reviewed_calls` = the window's calls where the stage counted and a current period review exists, plus any call carrying a finding in that stage.

**5. Isolated outliers.** When no recurring pattern exists, the stage has at least three counted calls and a second ranked stage exists: drop the single lowest score; if the mean of the rest is above the second-lowest stage's mean (the stage would no longer be the lowest without that call), `outlier = {call_id, score, mean_without}` and the sentence reads "…the reviewed calls do not show a consistent Close problem. The low average is driven mostly by one call." An isolated finding, if any, is still offered after it, as isolated.

**6. Positive behaviour.** Discovery only: an area with evidenced work on two or more counted Discovery calls AND on more than half of them; the top two by count (ties by name); the sentence states "Goals and current situation were established in 8 of 10 graded Discovery calls." Omitted when nothing qualifies; never displaces or softens the focus.

**7. Representative example.** The primary pattern's most recent finding — in the data model `focus.example`, distinct from `focus.summary`; on the page it is the one open pattern's first article. Severity was not used as a tie-break: recency is Block 002's rule and it stands. Evidence for the diagnosis, never the diagnosis.

**8. Schema / payload changes.** No database change. Payload: `focus` gained `state, summary, label, move_section, secondary, reviewed_calls, strength, outlier`; `focus` now exists whenever a lowest stage exists (state `insufficient` when nothing supports it); `focus_note` is gone (the insufficient sentence is `focus.summary`). Block 002's `move, calls, recurring, support, example, section` keep their meaning, with `section` now the diagnosed stage and `move_section` the pattern's own.

**9. Files changed.** `backend/lib/rep-period-coaching.js` (the diagnosis); `backend/web/dashboard.html` (two render lines, one CSS selector added to an existing rule); `backend/test/coaching-focus-diagnosis.test.js` (new, 10 tests); `backend/test/coaching-focus-selection.test.js` (Block 002's guard re-pinned to the evolved contract: an unsupported stage is an explicit state, not a null); `SCOUT-PRODUCT-DECISIONS.md` (row 12); `current-state.md` (the top note now covers Blocks 002–003); this file.

**10. Tests written first.** Before the change: 12 of 18 failed across the new file and the re-pinned Block 002 guard (the six that passed were the parts of Block 002 this block does not alter, including H). After: 18/18. Planted four ways, each caught, each file restored: recurrence at one call (C, both E tests and the Block 002 page test fail); the outlier computed with its effect discarded (C fails); the strength majority removed (D2 fails); the page never rendering the summary (both page tests fail). One full-suite failure surfaced on the first run — `new-grading-copy.test.js` asserting no `.coaching-period-note` on a ready window — which was the guard doing its job; fixed by giving the diagnosis its own class, not by loosening the guard.

**11. Full verification.** Focused guards 18/18; the neighbouring suites (new-grading copy, period workspace, layout, customer language, literal ratchet) green; full backend suite 2,769 passed, 0 failed (2,759 before this block). `node -c` on the lib. Rendered at 1400 and 390 px with no horizontal overflow.

**12. Product decisions still needed.**
- The wording of the four sentences and the strength line is customer-facing and Justin's to approve or cut (all in `lib/rep-period-coaching.js`, code, no model).
- The outlier rule is "would the stage still be lowest without its worst call". A different bar (a fixed gap, or one standard deviation) is a ruling, not a defect.
- Strengths outside Discovery need a structured source. The nearest one is the buying-signal `cause.move` on `call_highlights` (the same vocabulary as the weaknesses, H719), which this route no longer reads for speed. Reading only the small columns for the window is a bounded change if Justin wants strengths for every stage; not built.
- Fine Tune on a period example is not on the page today (the period examples carry Watch clip and Review Full Call); it was queued before this session and is untouched — Option 4's block or its own.
- Whether the live reps show patterns or isolated issues is still a question about real output, to be read on the page after a deploy.

**13. Confirmation.** No migration. No historical regrade or backfill. No production write. No deployment. No push. No new persistence (Supabase Pro noted, unused). Committed locally on `codex/team-coaching-ready` in the commit that carries this report (`git log -1`); three commits ahead of `origin/main`.

PAID API COST THIS BLOCK = $0

---

## Block 004 — Implement the approved Option 4 Team Coaching presentation — 2026-09-11

### Prompt (architect)

**Summary.** Implement the approved Option 4 presentation for the existing Team Coaching page, using the period-wide focus from Blocks 002 and 003. Primarily a UI/hierarchy block; no coaching-logic redesign unless a concrete mismatch prevents the approved behaviour from rendering.

**Goal.** At a glance per rep: the one stage needing the most attention; the period-wide reason; one representative real-call example supporting that diagnosis; the coaching advice for the manager. Visually simple, close to the existing design; never a trends dashboard, analytics workspace, scorecard or action plan.

**How this relates to the overall build session.** Block 002 stopped the lowest stage borrowing an unrelated point; Block 003 diagnoses the period (pattern · isolated · outlier · insufficient) with the example separate from the diagnosis. This block makes that understandable in the manager-facing UI.

**Read first.** The shared handoff files, Blocks 002–003, `current-state.md`, `SCOUT-DESIGN.md`, `CLAUDE.md`, the Team Coaching components, styles and data path. Verify the checkout is `.codex/team-coaching` on `codex/team-coaching-ready`.

**Scope.** Option 4: a clear separation between COACHING (priority stage · concise period diagnosis · manager advice · a lightweight Fine tune control) and CALL EXAMPLE (one representative call, the existing excerpt and clip/full-call actions), the example reading as evidence, not a competing card. Translate the four focus states to plain language; never word one call as a trend; insufficient support never substitutes another stage. Keep the Block 003 strength line only if it displays simply; no new reads or aggregation for strengths. Quieter than the mockups: no cards in cards, charts, trend graphs, multiple badges, long labels, tabs, extra counts, "AI analysis" language, internal terminology, or the stage name repeated in several places. Fine tune: preserve its boundary; if the interaction does not exist yet, render only what can be supported cleanly and report the decision.

**Preserve / do not change.** Stage grading architecture, eligibility, `stageMetric`, scores and grade mapping, historical records, outcomes, Block 003 selection logic (unless required to render an approved field), the broader-coaching review architecture, schema, migrations, production data, unrelated Team pages, the site-design tree. No new model calls.

**Verification.** Real/local representative payloads, not only fixtures: recurring pattern, isolated issue, outlier, insufficient support, a rep with an example, a rep without the strength line; desktop and narrow widths; one priority dominates; diagnosis and example visually distinct; the example belongs to the payload's priority; no isolated issue worded as recurring; insufficient never substitutes a stage; Fine tune subordinate; no navigation or evidence action broken. A visible rendered check, not unit tests alone.

**Report back in this block.** The thirteen numbered items in the prompt. Do not push or deploy.

### Report (developer) — report back in this block

**1. Inspected before editing.** Checkout confirmed: `.codex/team-coaching`, branch `codex/team-coaching-ready`, clean at `ae2ee1b`. Read: the two period render functions (`coachingPeriodWorkspaceHtml`, `coachingPeriodExampleHtml`), their CSS block (lines ~5425–5537), the Fine Tune page function and its route (`POST /kb/fine-tune` reads a `call_highlights` row by id), the six tests that render this surface, `SCOUT-DESIGN.md`. Then pulled the REAL payload read-only from the live database (service key from `API Keys.md`; the same `loadCoachableTeam` call the route makes, `periodOnly`, both teams, last 30 and 7 days) and read every rep's focus before designing.

**2. The hierarchy implemented.** In the selected rep's panel, top to bottom: the rep and window (unchanged) → the COACHING box: eyebrow LOWEST-SCORING AREA, the stage, the Block 003 diagnosis sentence, the strength sentence when present, then WHAT TO COACH (the representative finding's recommendation) with the stage score at the right → a hairline and the heading CALL EXAMPLE: one call (prospect · closer · date · outcome), what happened, "Read the call exchange" (collapsed), Watch clip / Review Full Call → "More calls with this" (collapsed; the primary pattern's other calls, up to four) → "Other coaching from these calls" (collapsed; every other pattern, its stage and count, up to three calls each, with its own recommendation) → STAGE SCORES THIS PERIOD (the existing five cells, moved after the coaching) → Recent calls (unchanged). Removed: the topic-tag list and the five open accordions of five examples each. Nothing new was added except the two collapsed sections.

**3. Visible verification.** Rendered by Electron from the real payload with the page's own functions and stylesheet; PNGs in `~/Desktop/scan-reports/block-004-option4/` (eight files): `pattern-nathan-30d` (and `-narrow` at 390 px), `isolated-nick-30d`, `outlier-joshn-30d`, `outlier-noexample-yazan-7d`, `insufficient-gabriel-30d` (and `-narrow`), `strength-synthetic`. Looked at each at 1400 px, two at 390 px. One defect found by looking, not by tests: nick's long recommendation pushed the score under the text (the box wraps its flex children); fixed with one rule, re-rendered, confirmed. No horizontal overflow at either width (asserted in the guards too).

**4. The four states as they render.** *Pattern* (nathan.m, Close): "Close needs the most attention. Booking the follow-up came up in 5 of 10 reviewed Close calls. Qualifying financially in 1." + WHAT TO COACH + Marlene's call + More calls with this (4) + Other coaching (2). *Isolated* (nick, Objection Handling): "…the reviewed calls show no repeated issue. Anchoring price came up in one call." + advice + the one call. *Outlier* (josh.n, Close): "…do not show a consistent Close problem. The low average is driven mostly by one call. Booking the follow-up came up in one call." + that call; (yazan, 7 days, Discovery): the outlier sentence, no advice, "No reviewed call in Discovery to show for these dates." *Insufficient* (gabriel, Objection Handling): "…not yet enough reviewed evidence to identify a reliable coaching pattern.", no advice, no example, the two other-stage findings collapsed under Other coaching. No internal state name appears anywhere.

**5. Diagnosis vs example.** Two blocks under two headings with a hairline between: the diagnosis and the advice live in the bordered COACHING box; the example is an article under CALL EXAMPLE with no recommendation of its own (its recommendation IS the advice above). In data: `focus.summary` vs `focus.example`; the page renders the example from `focus.example` only, and the guards assert the rendered example's call id equals the focus's.

**6. The strength line.** Rendered as a second sentence in the COACHING box when `focus.strength` exists (synthetic render). ON REAL DATA IT NEVER EXISTS: all 200 newest stage records carry a `context` whose keys are `call_kind, close_due, ending, finance, objection, pitch, price, prior_presentation, sales_conversation` — no `discovery` at all (v17, v18, v19, normal grader). The schema defines `context.discovery.areas`, the production grader does not write it. Block 003's strength is therefore dormant in production. Not fixed here (a grader output change is grading work); recorded as item 10.

**7. Fine tune coaching.** NOT rendered on a period example, deliberately. The only door, `POST /kb/fine-tune`, requires a `call_highlights` row id (it reads the moment's quote, observation and coaching from that row, 404s otherwise); a period-review finding is stored inside `call_analyses.rep_period_coaching` and has no highlight row. A dead button would violate "a control that does nothing". The existing Fine Tune on the legacy improvements path and on Call Review is untouched. Size of the real thing, for the decision: a second identity on the route (`call id + moment number`, reading the finding and building the same moment shape), the page passing it, "Noted ✓" persistence keyed on that identity — roughly 40 lines plus a guard; its boundary (advice only, never the stage, scores or metrics) is already the route's.

**8. Files changed.** `backend/web/dashboard.html` — the two render functions rewritten to the Option 4 shape; four CSS lines (advice spacing inside the box, the text column yielding to the score, the collapsed groups, sentence-case summaries). `backend/test/period-workspace.test.js` — headings re-pinned. `backend/test/coaching-focus-selection.test.js`, `backend/test/coaching-focus-diagnosis.test.js` — page probes re-pinned to the new shape (the example belongs to the focus; other coaching collapsed; no example on insufficient). `current-state.md` — the top note. This file.

**9. Tests and checks.** The six render guards plus customer-language and the literal ratchet: green. Full backend suite: 2,769 passed, 0 failed. Rendered checks as in item 3. No logic file changed: `rep-period-coaching.js`, `call-period-review.js`, stage grading, routes — untouched.

**10. Real-data cases where the design exposed a logic/data problem.**
- **Cross-stage support runs the wrong way.** Three reps (joshua 6 of 15, godwin.o, yazan, 30 days) have Objection Handling lowest, and the focus is "Booking the follow-up, carried into the purchase decision" — a CLOSE-stage finding counting as the Objection Handling diagnosis because its cited exchange contains the located decision (Block 002's rule, built for an EARLIER stage's gap reaching the decision). A missed follow-up booking is not an objection-handling weakness. The one-line correction is to allow cross-stage support only from an earlier stage than the diagnosed one (`SECTION_ORDER` index of `move_section` below the diagnosed stage). Not made: it changes Block 003 semantics, which this block was told to report, not alter.
- **The strength source is empty in production** (item 6).
- **One skill dominates.** "Booking the follow-up" is the focus for six of nine reps with a focus over 30 days. That is the data on file (the period review's findings lean to follow-up and finance, as `gpt.md` recorded on 2026-09-06), not a rendering fault; it will read as monotonous on the page.
- The stage name in the COACHING box renders as a small uppercase label rather than a title: an existing later rule (`#content .coaching-rep-detail h4`) outranks the priority box's own rule by order. Pre-existing; left as is; a one-line reorder if Justin wants the stage larger.

**11. Decisions needed.** (a) Adopt the earlier-stage-only rule for cross-stage support (item 10, first bullet) — recommended. (b) Whether to build the period-finding Fine Tune door (item 7). (c) Whether to keep the five stage cells on this page at all, now below the coaching; and the "N graded calls" line under each (Justin filed removing per-card graded-call labels on 2026-09-06). (d) The strength source: leave dormant, or have the grader write `context.discovery.areas` (grading work, its own block). (e) The copy: LOWEST-SCORING AREA, WHAT TO COACH, CALL EXAMPLE, "More calls with this", "Other coaching from these calls", "No reviewed call in X to show for these dates" — Justin's to approve or cut.

**12. Commit.** One local commit on `codex/team-coaching-ready` in `.codex/team-coaching` carrying these files and this report (`git log -1`); four commits ahead of `origin/main`.

**13. State.** Not pushed. Not deployed. No production write: the live database was READ once for the payload and once for the stage-record shape, with the service key, nothing written. No migration, no regrade, no backfill, no model call.

PAID API COST THIS BLOCK = $0

---

## Block 005 — Correct real-data diagnosis defects exposed by Block 004 — 2026-09-11

### Prompt (architect)

**Summary.** Block 004 exposed three data/logic issues on real payloads. Correct the cross-stage direction defect; make the approved Discovery strength path populate if the existing grader/schema supports it cleanly; investigate why "Booking the follow-up" is the focus for six of nine reps before deciding whether that needs correction. No UI or architecture redesign.

**Goal.** The period diagnosis explains the actual lowest stage with evidence that legitimately supports it; a later-stage finding never becomes the explanation for an earlier-stage weakness merely because its exchange contains a decision moment; the grounded Discovery strength surfaces where the architecture already intends to produce it; the repeated follow-up focus is left alone until it is known to be stored evidence or a grouping defect.

**How this relates to the overall build session.** Blocks 002–003: scores say where, period evidence says why, one example shows it. Block 004 rendered that against real payloads and found failures unit tests had not. A targeted correctness follow-up, not an architecture pass.

**Read first.** The shared handoff files, Blocks 002–004, `current-state.md`, the repository rules, the Block 003 diagnosis implementation, the grader/schema path for the Discovery work record. Verify `.codex/team-coaching` on `codex/team-coaching-ready`.

**Scope.** Part 1: the smallest correction so cross-stage evidence supports a LATER stage from an EARLIER stage's demonstrated relationship only, never the reverse; keep the evidence requirement; verify the three affected reps. Part 2: inspect whether the production assessment already has the information, whether writing the field is part of the existing contract rather than new grading behaviour, and whether it needs no new model call, reviewer, proof pass, persistence or inference; if yes, the smallest change plus tests; if not, STOP and report. Part 3: no change; audit the six reps (lowest stage, eligible calls, distinct supporting calls, what the findings say, whether they are the same behaviour, other recurring behaviour, why the ranking chose it) and classify: truthful recurrence · grouping/vocabulary defect · ranking defect · mixed/insufficient. Record the deferred stage-cell UI item at the END of the build list, not implemented.

**Preserve / do not change.** Option 4 hierarchy, stage-cell placement, Fine Tune, score calculations, grade mapping, eligibility architecture, `stageMetric`, broader coaching, schema, historical and production data, unrelated pages, the site-design tree. No migration, backfill, regrade, paid call, push or deploy.

**Verification.** Focused tests first, then the full suite; re-inspect the affected real reps' payload/render after Part 1 (lowest stage unchanged, no later-stage substitution, no unrelated stage substituted, the example still supports the focus, isolated/outlier/insufficient still correct). Part 2 changes, if any, verified on local fixtures only.

**Report back in this block.** The fifteen numbered items in the prompt, ending with `PAID API COST THIS BLOCK = $0`.

### Report (developer) — report back in this block

**1. Exact cause of the cross-stage defect.** Block 002's rule let ANY pattern from another stage support a decision stage (close, objection) when an example's cited turns included the located purchase decision. It was written for an earlier stage's gap reaching the decision, but it never tested direction. A "booking the follow-up" finding is Close-stage and, by its nature, its exchange holds the decision the prospect just deferred — so for a rep whose lowest stage was Objection Handling, every such Close finding qualified as the Objection Handling diagnosis.

**2. Exact correction.** One condition in `lib/rep-period-coaching.js`: cross-stage support requires the pattern's stage to be EARLIER in `SECTION_ORDER` than the diagnosed stage. Same-stage support and the evidence requirement (the located decision in the cited turns) are unchanged; nothing was loosened. No other logic moved.

**3. Before/after on the real payload (read-only pull, same window as Block 004, every rep compared).** Exactly the three reps changed; every other rep in both windows is byte-for-byte the same focus.
- godwin.o (Objection Handling, 71): before `isolated` on a Close "booking the follow-up" finding carried into the decision → after `insufficient`; the two Close findings stay listed under Other coaching.
- yazan (Objection Handling, 77): before `isolated` on a Close finding → after `insufficient`; four Close findings remain as other coaching.
- joshua (Objection Handling, 69): before `pattern` "6 of 15" on Close findings → after `outlier` — no Objection Handling finding exists, and without his single lowest Objection Handling score the stage would no longer be the lowest (the Block 003 rule, now reachable). His nine Close findings remain as other coaching.
Lowest stage unchanged for all three; nothing substituted; the isolated/outlier/insufficient states behave as designed. Rendered all three at 1400 px (`~/Desktop/scan-reports/block-005-cross-stage/`); joshua's reads "…do not show a consistent Objection Handling problem. The low average is driven mostly by one call." with "No reviewed call in Objection Handling to show for these dates." and Other coaching (1).

**4. Discovery strength-path findings.** The production stage assessment rides the normal grader: `analysis-worker.js` asks for `stage_assessment.context` with nine fields (`sales_conversation, call_kind, ending, pitch, price, prior_presentation, objection, finance, close_due`) and `checkProductionContext` validates exactly those nine. `context.discovery.areas` — the "DISCOVERY WORK RECORD" — exists only in the offline candidate contract (`stage-output-schema.js producer`, the `INSTRUCTIONS`/`promptInstructions` prompt used by `buildPrompt` for offline QA). So (1) the production assessment does NOT already have the information — the grader is never asked for it; (2) writing it is not part of the production contract; (3) populating it needs no new model call, but it does need an output field added to the production grader prompt, validated per area against the transcript, with `ANALYSIS_PROMPT_VERSION` bumped — a grader prompt change (H402: one pass grades everything, any change can move outcomes) that cannot be measured here without a paid run on a fresh sample.

**5. Strength-path change made?** No. Stopped, as instructed, because the field cannot be populated from the existing production assessment without changing the grader's contract. The exact change and its cost are filed at the end of `BUILD-LIST.md` for Justin's ruling. Block 003's strength logic stays in place and dormant.

**6. No historical regrade or backfill occurred.** The live database was read twice (the payload pull, the stage-record shape probe); nothing was written.

**7. The six-rep audit (30-day window, from the stored findings).**
- nathan.m — lowest Close (66); 21 counted Close calls, 10 reviewed; 5 distinct calls with "booking the follow-up"; other patterns: qualifying financially (Discovery ×2, Objection ×1). The five findings all describe the same act: the call ended with a follow-up expected but no specific day and time agreed (texting to book, a vague third-party callback, "in a week", a personal cell number, "text me").
- preston — lowest Close (74); 10 counted, 6 reviewed; 2 distinct calls; the only pattern. Same act (text to arrange; "Saturday or Monday" with no time).
- josh.n — lowest Close (67); 10 counted, 1 reviewed; 1 call; the only pattern; outlier state. Same act (Monday agreed, no time).
- joshua — lowest Objection Handling (69); 51 counted Objection calls, 15 reviewed; 0 Objection Handling findings; 9 distinct Close calls with the follow-up finding (only 6 had the decision inside the cited turns). Same act across all nine (assistant delegated, conditional five o'clock, "beginning of the year", mid-November, "text whenever ready"…).
- godwin.o — lowest Objection Handling (71); 54 counted, 6 reviewed; 0 Objection findings; 2 Close follow-up findings. Same act.
- yazan — lowest Objection Handling (77); 54 counted, 16 reviewed; 0 Objection findings; 4 Close follow-up findings. Same act.
Why the ranking chose it: it was the only pattern with two or more calls in (or, before this block, "carried into") the lowest stage; for godwin.o, yazan and joshua nothing else existed at all in the lowest stage.

**8. Classification: truthful recurrence — with one caveat that is not a grouping or ranking defect.** The findings under the label are substantively one behaviour (an open sale ended without a specific day and time), so the label is honest and the counts are real. The caveat is survivorship in what passes review: "booking the follow-up" has its own dedicated factual gate (`applySchedulingFacts`, H751) and does not depend on a located purchase decision, while every other Close or Objection Handling finding must survive the stage-facts gate and two agreeing observation reads. Three reps have 51–54 counted Objection Handling calls and zero surviving Objection Handling findings. That is consistent with the follow-up finding being easier to prove than a genuine objection-handling finding, not with a vocabulary collapse. It is a hypothesis about the review pipeline, not a measurement.

**9. Product decision needed before changing that behaviour.** Whether to measure the survivorship hypothesis: count, per stage, how many draft findings the writer proposed versus how many survived each gate on the stored records (a $0 read of `rep_period_coaching.decisions` and `independent_review.decisions`). If Objection Handling drafts exist and die at the decision gate, that is a gate question for Justin, not a grouping fix. Until then, the repetition stands as reported.

**10. Files changed.** `backend/lib/rep-period-coaching.js` — the earlier-stage-only condition. `backend/test/coaching-focus-diagnosis.test.js` — G2, the direction guard. `BUILD-LIST.md` — two filed items at the end (the deferred stage-cell UI; the Discovery work record's production contract). `current-state.md` — the top note. This file.

**11. Tests and visible verification.** G2 written first and failed; passes after; planted (the direction check kept, its effect discarded) → G2 fails; restored. Focus and period guards 25/25; full backend suite 2,770 passed, 0 failed. Real payload re-pulled and diffed rep by rep (item 3); the three affected reps rendered and inspected.

**12. Deferred stage-cell item.** Recorded at the end of `BUILD-LIST.md` verbatim in substance; NOT implemented. The stage cells stay where Block 004 put them.

**13. Commit.** One local commit on `codex/team-coaching-ready` in `.codex/team-coaching` carrying these files and this report (`git log -1`); five commits ahead of `origin/main`.

**14. State.** Not pushed. Not deployed. No production write. No migration, no regrade, no backfill.

**15.** PAID API COST THIS BLOCK = $0

---

## Block 006 — Lock down the five stage definitions — 2026-09-11

### Prompt (architect)

**Summary.** Before continuing Team Coaching diagnosis work, lock down what Scout means by each sales stage. Justin supplied the authoritative definitions (Intro · Discovery · Pitch + price drop + first ask · Objection Handling with its loop and re-asks · Close as commitment/transaction, never "did it sell"). Inspect how Scout currently defines, segments, prompts, validates and grades the five stages; compare; correct only meaningful mismatches; make the definitions canonical enough that call grading and period diagnosis reason from the same semantics. No new architecture, reviewer, evidence layer or rewrite.

**Goal.** Part 1 audit (grader prompt, doctrine, schema, eligibility validation, projection, helpers, Team Coaching assumptions) with each stage classified aligned / minor / material — especially where the first ask sits, whether price is Pitch, where loop re-asks go, what makes Close due, whether Close equals end-of-call, whether five hard chronological chunks are assumed. Part 2 the smallest coherent correction (prompt/doctrine clarification, narrow deterministic validation, existing fields). Part 3 local fixtures for seven flows A–G. Part 4 check the Blocks 002–005 diagnosis under the clarified definitions (re-ask as Close finding? booking-the-follow-up vs the Close stage? first ask vs re-ask vs final close? vocabulary blur?) — a tiny correction if needed, otherwise report and file.

**How this relates to the overall build session.** Period-wide diagnosis only works if the stage labels mean the right thing; Close-lowest must be diagnosed from real closing behaviour, never from discovery qualification, generic end-of-call activity, an objection-loop ask or follow-up booking unless the semantics support it.

**Read first.** `scout-shared-context.md` (now the primary handoff document), the session, brief, decisions and build-list files, `current-state.md`, the doctrine, the production stage-grading prompt and eligibility code, the Team Coaching logic of Blocks 002–005. Work in `.codex/team-coaching` on `codex/team-coaching-ready`.

**Preserve / do not change.** No model calls, no live stage review, no new grading architecture, no score/grade scale change (A+ 98–100 · A 90–97 · B 80–89 · C 70–79 · D 60–69 · F ≤59), no migration, backfill, regrade, production write, deploy, push, Team Coaching redesign, deferred stage-cell tweak, or Discovery strengths unless required; unrelated observations go to the END of `BUILD-LIST.md`. Follow-up booking being common is not suspicious; the question is truthful classification.

**Verification.** Local fixtures/mocks; the behavioural guard before the correction where practical; focused suites, then the full backend suite if implementation changed.

**Report back.** In `scout-shared-context.md` (primary) and this block: what current definitions were, mismatches, changes, fixture results A–G, Team Coaching impact, full-suite result, files, commit, decisions for Justin, confirmations, `PAID API COST THIS BLOCK = $0`.

### Report (developer) — report back in this block

**1. What Scout's definitions actually were (Part 1 audit, before any edit).** The production stage assessment rides the normal grader (`analysis-worker.js buildSectionGraderPrompt`): five "sections to grade" bullets, the v58–v61 STAGE RULES, the doctrine's stage lane (`what_an_objection_is`, `the_three_way_boundary_on_money`, `discovery…upstream`, `follow_ups`, `what_good_looks_like`, `never_do`), a nine-field context (`sales_conversation, call_kind, ending, pitch, price, prior_presentation, objection, finance, close_due`), and `assessProduction` enforcing eligibility deterministically. Per stage:
- INTRO — "useful direction for the conversation that actually took place: frame and control, credibility without overselling, an agenda the prospect agreed to"; judged when the conversation starts, no 60-second rule. **Aligned**; minor: the manager-tunable frame was implicit (the team's script is in the prompt as material) and never stated.
- DISCOVERY — the six areas with the ruled caveats (pain as a relation, the logical sale, DQ is success, an in-discovery concern is discovery work), "not a required script", volunteered counts, decision-maker-absent is qualification, late DQ → an evidenced Discovery miss. **Aligned.**
- PITCH — "solution framing tied directly to discovery findings; a pre-price concern answered well is pitch work". Price and the first ask were NOT here. **Material mismatch.**
- OBJECTION — "handling resistance via isolation + framework rebuttal", with the STAGE RULES' after-pitch-and-price definition, the positional partner objection, disclosures and inability excluded. Definition aligned; **minor mismatch**: nothing placed the re-asks inside the loop — the CLOSE bullet claimed "were final objections handled before the call ended".
- CLOSE — the bullet read "was a clear assumptive or direct close attempted, was price presented confidently without apologizing, were final objections handled before the call ended" — price, the first ask and the objection tail all inside Close; while the v58+ STAGE RULES said "Close is the purchase decision, not the end of the recording and not the booking of another meeting", `close_due` gated it, a price question made a decision due, a genuine DQ made it not applicable. **Material mismatch** in the rubric bullet, aligned in the eligibility rules.
- Chronology: the prompt's HOW TO JUDGE line already allowed a different order and a thread picked up later; nothing stated the three end-of-call stages interleave. Minor.
- The validator (`assessProduction`) was already aligned with every deterministic consequence of Justin's definitions: fixtures A–G passed on it BEFORE any change (that is the audit's cleanest finding — the eligibility architecture needed nothing).
- Team Coaching (Blocks 002–005): groups reviewed findings by the reviewer's `section` + `move`; the period-review writer lens says "Close: assess asking for the sale or an appropriate agreed next step"; the move vocabulary puts "asking for the sale" under PITCH AND CLOSE and "booking the follow-up" under OBJECTIONS; a booking finding is exempt from the located-decision gate at review time (H751's own scheduling reader).

**2. Exact mismatches found.** (a) Price presentation and the first ask graded as Close, not Pitch. (b) Nothing assigned loop re-asks to Objection Handling; the Close bullet pulled "final objections" into Close. (c) Close's rubric bullet was an attempt/price/objection checklist rather than commitment and transaction; "did it sell" was not in the validator (correct) but nothing said outcome is not the rubric. (d) Pitch quality had no relevance/clarity/concision standard. (e) Intro's manager-tunable frame unstated. (f) Interleaving unstated. (g) Team Coaching: a follow-up-booking finding on a call paused before any decision was due could be Close-stage evidence for a low Close score. (h) Reported, not changed: the period-review writer lens and the ask vocabulary cannot tell the first ask, a loop re-ask and the final close ask apart (filed).

**3. Exact changes.** `lib/stage-eligibility.js`: `STAGE_DEFINITIONS` (five entries in Justin's words; Discovery keeps every ruled caveat verbatim) and `STAGE_BOUNDARIES` (behavioural stages that interleave; first ask = Pitch; loop re-ask = Objection Handling; Close = final commitment and transaction; outcome is evidence, never the rubric), exported; the offline `promptInstructions` STAGE DEFINITIONS line now prints them. `lib/analysis-worker.js`: the five bullets print `STAGE_DEFINITIONS` verbatim and `STAGE_BOUNDARIES` follows them; `ANALYSIS_PROMPT_VERSION` v61 → `v62-2026-09-11` (new calls only; nothing re-graded). Team Coaching: `call-period-review.storedExamples` attaches `decision_located` (the two fact reads located a purchase decision on that call); `rep-period-coaching` counts a "booking the follow-up" finding as Close-stage evidence only when `decision_located` — it stays listed and counted as coaching either way. No validator rule, score, grade, schema, migration or doctrine change.

**4. Fixture results A–G (`test/stage-definitions.test.js`, on the real `assessProduction`).** A clean close: Pitch cites offer+price+first ask, Close the commitment, Objection Handling N/A — and a scored Objection Handling with no objection on record is withheld. B loop: Pitch/Objection Handling (with the re-ask in its evidence)/Close all scorable together; the first ask never in Close evidence. C lost after the loop: Objection Handling and Close grade; a Close of 86 on a lost call stands; with `close_due=false` a low Close becomes not applicable. D early DQ: Discovery 91, Pitch/Objection/Close not applicable. E late DQ: Discovery expected_but_missed 45 stands; Objection/Close not applicable. F continuation: Pitch/Objection not applicable, a scored "missed" Close coerced to not applicable. G follow-up: Discovery/Pitch not applicable, Objection Handling via the prior presentation and Close both grade. All seven passed before AND after the change (the validator was already right); the two prompt-identity tests and the Team Coaching G3 test failed before and pass after; two plants (the booking gate's effect discarded; the old Close bullet printed) caught and restored.

**5. Team Coaching semantics (Part 4).** Q1 — can a loop re-ask become a Close finding? Yes, still: the reviewer files the section and the writer lens invites it; a correction bumps `call-period-review` VERSION, which would drop every stored v16 example until a paid re-review — filed, not made. Q2 — is a recurring "booking the follow-up" legitimate without being synonymous with Close? Yes: it is real coaching (listed, counted) always; it is Close-stage evidence only where a purchase decision was located (built this block). Q3 — can Team Coaching distinguish first ask / re-ask / final close? No; the move vocabulary has one "asking for the sale" — filed. Q4 — vocabulary blur: as above, filed. Real payload re-pulled read-only and diffed rep by rep: exactly the booking-on-a-paused-call cases moved — nathan.m 5 → 4 of 10 (the rescheduled-for-a-setup-issue call left Close evidence), preston 2 → 1 (the partner-present rebook), josh.n's lone example left; every other rep unchanged.

**6. Full suite.** 2,780 passed, 0 failed (2,770 before this block). One run surfaced a `v61-` prefix pin in `kb-material.test.js` that the literal search had missed; re-pinned to v62 with the other ten.

**7. Files changed.** `backend/lib/stage-eligibility.js` (canonical definitions and boundaries; offline prompt prints them; exports); `backend/lib/analysis-worker.js` (bullets printed from the constant; v62); `backend/lib/call-period-review.js` (`decision_located`); `backend/lib/rep-period-coaching.js` (the booking-as-Close-evidence gate); `backend/test/stage-definitions.test.js` (new: definitions, prompt identity, flows A–G); `backend/test/coaching-focus-diagnosis.test.js` (G3; booking fixture carries the H751 scheduling facts); eleven test files re-pinned v61 → v62; `SCOUT-PRODUCT-DECISIONS.md` (row 13); `BUILD-LIST.md` (two filed taxonomy items); `current-state.md`; this file; `scout-shared-context.md` (the concise handoff report, at the canonical root).

**8. Commit.** One local commit on `codex/team-coaching-ready` in `.codex/team-coaching` carrying these files and this report (`git log -1`); six commits ahead of `origin/main`.

**9. Deferred to BUILD-LIST.md.** The period-review lens/section for asks (needs a lane version bump with a paid re-review behind it); splitting "asking for the sale" into first ask / re-ask / close ask in the move vocabulary.

**10. Decisions for Justin.** (a) Whether to authorise the period-review lane bump (v17) so Team Coaching's own findings carry the first-ask/re-ask/close distinction — it costs a re-review of the stored examples. (b) The v62 grader prompt ships to new calls only and was validated on fixtures and the validator, not on a paid sample; the first live calls graded under v62 should be read by Justin (the DoD for a coaching prompt is real output). (c) Whether the strength path (Block 005, filed) rides the same grader contract change if (b) is ever measured. No decision was invented where the doctrine and the definitions already answer.

**11. Confirmations.** No production write (the live database was read once, for the payload diff). No migration. No regrade, no backfill. No deploy. No push. No model call.

PAID API COST THIS BLOCK = $0

