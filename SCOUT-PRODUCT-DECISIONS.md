# Scout — settled product decisions and boundaries

One row per decision. A row here is closed; reopening it is Justin's call, made in `SCOUT-BUILD-SESSION.md`, not inferred from a prompt. Fuller rulings and their reasoning stay in `CLAUDE.md` and `SCOUT-HISTORY.md`.

| # | Decision | Settled boundary | Recorded |
|---|---|---|---|
| 1 | Coaching audience | Team Coaching is a manager-and-above view. A rep sees nothing aggregated. | CLAUDE.md §4b (H726) |
| 2 | Coaching page job | For each rep: one coaching priority, one real supporting call example, useful manager guidance. Nothing else is the page's job. | SCOUT-BUILD-BRIEF.md |
| 3 | Visual direction | The original Option 4: Coaching clearly separated from Call Example; clean page; not a broader analytics dashboard. | SCOUT-BUILD-BRIEF.md (see open question below on the reference) |
| 4 | Evidence and causality | The example and advice must support the named weakness. A Discovery miss counts as Close evidence only with a meaningful causal link to the weak or failed close. | SCOUT-BUILD-BRIEF.md; CLAUDE.md §4b (H724 "no unearned quotes") |
| 5 | Fine Tune boundary | Fine Tune Coaching adjusts advice for one coaching item only. It never re-grades a call or alters scores or metrics. | SCOUT-BUILD-BRIEF.md; CLAUDE.md §4b (H708–H709) |
| 6 | Simplicity | Smallest reliable solution. No reopening of completed architecture; no theoretical safeguards without a concrete product reason. | SCOUT-BUILD-BRIEF.md; CLAUDE.md §6 (the withholding counterweight) |
| 7 | Real-output verification | Passing tests alone does not prove a good product result. A coaching change is done when Justin has read real output. | CLAUDE.md §4b (H423) |
| 8 | Site-design tree | A separate GitHub tree owns site design. Its changes are never reverted or silently fixed; a break is reported. | CLAUDE.md §1, §3 (H738) |
| 9 | Scout AI, pre-launch | Later feature, admin-only in development, gated server-side. No MCP, BYO-AI or provider-abstraction project before launch. | CLAUDE.md §4c (H714) |
| 10 | Grade bands | 98–100 A+ · 90–97 A · 80–89 B · 70–79 C · 60–69 D · 0–59 F. The only mapping shown to a user. | CLAUDE.md §4a |
| 11 | Coaching selection rule (Justin, 2026-09-11, Block 002) | Lowest stage → the strongest supported coaching pattern or opportunity WITHIN that stage → one representative call → manager guidance. Prefer a recurring pattern when the period data genuinely supports one; no statistical pattern-detection built to satisfy the word. Without recurrence, the strongest supported opportunity in the lowest stage. The point must genuinely explain the lowest stage's weakness; never an unrelated weakness merely because it occurred on one of the rep's calls. Cross-stage evidence only when the causal relationship is actually supported (a Discovery finance miss is Close evidence only if it impaired the Close). Keep it simple; no causal-inference engine. | SCOUT-BUILD-SESSION.md Block 002; `lib/rep-period-coaching.js` (`focus`); guard `test/coaching-focus-selection.test.js` |

## Open question

- ~~Selection logic~~ **Answered in Block 002 (2026-09-11):** the stored period reviews are grouped by stage and skill and COUNTED across the rep's calls in the window, so recurrence is a count, not a detection. Before Block 002 the page put the lowest stage's patterns first but would still lead with a pattern from another stage when the lowest stage had none. After it, the payload carries `focus` (the lowest stage's strongest supported pattern: most calls, then most recent; `recurring` true from two calls) and `focus_note` when nothing supports the lowest stage. Whether the live data shows patterns or isolated issues per rep is a question about real output and stays for Justin to read on the page.
- **The Option 4 reference:** the phrase "Option 4" appears nowhere in the repository. The direction is recorded above from the architect's description; the architect should attach or restate the reference (mockup or written description) with the first Coaching prompt.
