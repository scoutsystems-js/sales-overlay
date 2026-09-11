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
