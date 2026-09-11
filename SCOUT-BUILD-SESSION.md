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

