# Scout — build brief (shared baseline)

Short context every party reads before a handoff block. It does not replace `CLAUDE.md` (the standing rules) or `BUILD-LIST.md` (the queue); where they say more, they win. Settled decisions are tabulated in `SCOUT-PRODUCT-DECISIONS.md`; the running prompt/report log is `SCOUT-BUILD-SESSION.md`.

## What Scout is

Post-call intelligence for high-ticket sales teams. Fathom/Zoom recordings sync in; a grader, a highlight extractor and a coaching pass analyse each call; managers and reps read the results at `/dashboard`. The desktop overlay is dead and not coming back.

## Who decides what

- **Justin** owns every product and business decision.
- **ChatGPT (architect)** turns those decisions into bounded behavioural requirements: what the page must do, for whom, with what rules and boundaries.
- **Claude Code (developer)** owns implementation details and verification, and reports back in the session file.

## How we work

- Prefer the smallest reliable solution. Do not reopen completed architecture, and do not build theoretical safeguards without a concrete product reason.
- Customer usefulness matters alongside technical correctness. A green test suite does not prove a good product result; Justin reading real output does.
- Site design lives in a separate GitHub tree that is not ours. Never revert or silently "fix" a design change from it; report a break instead.
- Neither side expands scope silently. A material constraint or product choice discovered mid-task is reported, not chosen.

## Team Coaching (the next block of work)

- **Audience:** managers and above.
- **The page's one job:** for each rep, show one coaching priority, one real supporting call example, and useful manager guidance.
- **Approved visual direction — the original "Option 4":** Coaching and Call Example are clearly separated; the page stays clean; it does not become a broader analytics dashboard.
- **Evidence must support the claim:** if Scout names Close as the biggest coaching area, the call example and advice must actually show a Close weakness. A Discovery miss is valid Close evidence only when the call shows a meaningful causal connection to the weak or failed close.
- **Fine Tune Coaching** may adjust the advice for one coaching item. It never re-grades a call and never alters scores or metrics.
- **Where the work will occur:** `backend/routes/team.js` (`GET /team/coachable-moments`), `backend/lib/coachable-team.js`, `coachable-moments.js`, `rep-period-coaching.js`, `call-period-review.js`, `rep-line.js`, `section-ranking.js`, `stage-eligibility.js`, `coaching-corrections.js` (Fine Tune), and the `team-coaching` view in `backend/web/dashboard.html`.

## Scout AI

A later feature, admin-only while in development. Do not start an MCP, bring-your-own-AI or provider-abstraction project before launch.
