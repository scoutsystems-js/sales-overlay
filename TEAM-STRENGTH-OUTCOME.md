# Team Strengths: call evidence and outcome

Not yet pushed. Implements the approved strength card with full transcript excerpts, the following exchange, call-level outcome and its saved explanation, clip links, full call review and existing Fine Tune target. No internal knowledge-base guidance is rendered.

Evidence is added to cached and fresh recommendation responses by reading at most three selected calls already in the authorized team window. Missing, ambiguous, wrong-speaker or unpaired quotes withhold the strength. Direct contradictions between the stored outcome and explanation also withhold it. The stored outcome is not inferred from the moment. No new model calls, prompt changes or cache invalidation were introduced. Existing knowledge-base retrieval/generation grounding remains; this change is not a new independent semantic verifier for all coaching.

Validation: 2,474 tests passed before the final response-grouping adjustment; focused evidence tests and inline-script parsing passed after it. Actual cached team data produced one eligible strength (Yazan). One Gabriel excerpt did not match uniquely; a second Gabriel record says closed while its explanation explicitly says it did not close, and is withheld. Underlying records were not changed. Real-data rendering has no overflow at 1400, 979 and 390px.

Follow-up finding: call 3ec3b1fb-529d-4439-91a1-5a1b4098e9a9 has outcome closed/inferred and a why_outcome describing a partner deferral without a close. Diagnose separately; do not silently repair or reanalyze it as part of presentation work.
