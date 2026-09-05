# GPT updates — Scout

## Current state — 2026-09-05
Code deployed: Railway SUCCESS at 4b17f8b2f4941030887bc07a5c422aba11aadb7a. Migration 075 is applied. Two confirmed incorrect notes on the one approved test call have been removed in production, with rejection provenance; their quote timestamps are corrected to transcript positions. No historical backfill.

## Approved page and sidebar
Compact team/date/score header; expandable Coaching Focus; closer selector with one improvement area; expandable Team Strengths with full exchanges and outcomes; compact sidebar icons and persistent Team subpages. Original Scout wordmark and browser-local artwork toggle preserved. These changes are deployed; signed-in checks passed.

## Coaching contradiction fix
The old pass read a truncated saved closer reply and treated an earlier observation as authoritative. The transcript shows the closer did ask the feared-result question, isolate, offer a refundable deposit, and ask for conditional commitment. That contradicts both stored criticisms on call 99e6f117-562f-4b64-9473-04b02f58d682.

The generator now sees complete turns in a bounded window plus the ending, can explicitly return no change, and cannot supply timestamps in its advice. Code locates quote timestamps in the stored transcript. One separate review per call compares proposed advice with the exchange and applicable knowledge/manager material. Missing, rejected, uncertain, malformed or ungrounded approval writes no advice. Approval provenance records reviewer version, knowledge hash and transcript context hash. A retry clears this call's prior advice before generating replacements.

Team Coaching requires current approved provenance, matching transcript context and current knowledge. It verifies all candidate areas before ranking, so a rejected example cannot hide a valid alternative. The chosen area is the one with most distinct evidenced calls, then recency; this is not a prediction of which change will yield the most closes. Existing historical advice is not retroactively certified. Initially the new panel may have no supported improvement available.

## Actual-output test and limits
Justin approved the one-call test and ongoing reviews, expressly excluding a historical backfill. The reviewer rejected both existing incorrect notes. A fresh draft still made a similar mistake and was rejected. After allowing no-change explicitly, one moment returned no advice and the other proposed a new unsupported criticism, also rejected. Correct result for these moments: withhold coaching. This demonstrates the safeguard on this specific regression, not general model accuracy or infallibility. No further prompt tuning or paid test is authorized implicitly.

Targeted production correction removed only highlights 75e12224-15f9-43ad-9e24-f96eb77df193 and 7fabcd4c-ae08-4505-bca7-09e093fe02c3, retaining quotes, outcomes and rejection provenance. Located timestamps: 1635 and 1765 seconds. The original rows are backed up locally in the evidence report directory.

## Verification
2,480 backend tests passed; zero failures. Changed modules and extracted dashboard inline scripts parse. Desktop/mobile checks cover 1400, 979 and 390 CSS pixels, closer switching and Fine Tune targets. Independent-review regression tests fail both when the gate is removed and when it is called but its effect ignored. Current-knowledge mismatch and selecting a valid alternative after rejecting another area are exercised through the real gather. Model stubs test plumbing only; the actual one-call review above tests the reported contradiction.

## Deployment
New analyses finished before the push. Three stable polls returned only the eight previously approved stale rows; the last also showed no active coaching. Railway reports SUCCESS at 4b17f8b. Served-page markers verified RAW/comment-stripped: coaching-rep-workspace 5/5, workspaceTeamPages 2/2, selectCoachingRep 2/2. Authenticated live checks passed: closer selection, My Team navigation and return, original wordmark, one detail panel and no horizontal overflow. Artwork on persisted through reload; restored to the user’s original off preference. Previous live commit: 8909310. Local preview now withholds unreviewed advice; its priority headlines remain illustrative.
