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

## Open question

- **Selection logic:** does the current Coaching selection (the coachable-moments gather, section ranking and per-rep period review) already identify a *recurring, stage-relevant pattern* for a rep, or does it pick an *isolated issue* on one call? The answer decides whether the Option 4 page can present its one priority as a pattern with confidence, or whether selection has to change first. To be answered by inspection of real output in the first Coaching block, not assumed.
- **The Option 4 reference:** the phrase "Option 4" appears nowhere in the repository. The direction is recorded above from the architect's description; the architect should attach or restate the reference (mockup or written description) with the first Coaching prompt.
