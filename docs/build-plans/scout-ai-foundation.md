# Scout AI — foundation contract

## Product job

Scout AI answers questions about Scout's own calls and measurements.  It makes a
useful claim only when Scout can show the facts, calls and exact moments behind
it.  It is not a general sales chatbot and it does not replace the existing
grader or coaching pages.

## First release

Development access is owner-only.  The first release handles the high-value
question families already supported by stored Scout facts:

1. measured close and objection-handle rates for a closer, team or stated date
   range, including a clearly labelled cohort rate only when the person asks
   for that cohort;
2. the largest or weakest objection category, with the count and rate used;
3. up to three handled and three not-handled examples for a closer and
   objection category; and
4. direct call, timestamp and recording links for every displayed example.

The default window is the preceding 90 calendar days.  Every answer names the
actual window and the set of calls included.  A requested date range replaces
that default.

Question-specific cohort calculations are answer-only.  They do not add a
dashboard card, alter Scout's normal closing-rate definition, or become a
permanent metric simply because somebody asked for one.

## Evidence contract

- The model may choose only from named backend tools.  It cannot write SQL,
  select an arbitrary user, fetch an unbounded transcript, or change data.
- Tool output is role-scoped before it reaches the model.  During development,
  only an owner may ask questions; a later manager/closer rollout must use the
  existing team-membership rule rather than a new permission copy.
- A metric answer includes its numerator, denominator, definition and range.
  Existing Scout metric definitions remain the source of truth.
- A call example includes only stored call metadata plus an exact saved
  objection moment.  It links to the existing call review and, where a stored
  recording URL and timestamp exist, to that exact moment.
- The final writer receives only validated tool output.  It must cite the
  evidence cards it used and say "Scout does not have enough verified data to
  answer that" when no supported tool result exists.
- The assistant never treats an unmatched appointment, missing outcome, a
  closed call alone, or a model summary as proof that an objection was handled.
  Existing `resolution`, outcome and transcript-evidence rules remain intact.

## Phrase-specific asks

Scout's canonical categories are Fear, Timing, Partner, Logistical and Other.
For a phrase such as "spouse," Scout will first look for exact stored objection
moments containing that phrase.  It may report the enclosing canonical category
when one exists, but it must say whether the answer is about the exact phrase or
the broader category.  It must not quietly equate every Partner objection with a
spouse objection.

## Non-goals for this release

- no unrestricted transcript chat or database search;
- no vectors, embeddings, new model pass, regrading or historical backfill;
- no automatic coaching changes, score changes, outcomes or calendar changes;
- no customer-facing access or chat-history retention; and
- no answer without visible Scout evidence.

## Build sequence

1. Implement and test the read-only, role-scoped fact tools with planted call
   data.  This is the source of truth for every future answer.
2. Add a small model planner/writer around those tools, using the existing
   Anthropic usage recorder under a dedicated `scout-ai` lane.  Test the model
   boundary with fixture tool calls; do not spend on production calls during
   development.
3. Add the owner-only Scout AI page: question, answer, named range, evidence
   cards, call review and clip links.
4. Run a fixed acceptance set that includes the questions in the product brief,
   missing data, phrase/category mismatch, unauthorized scope and conflicting
   evidence.  Review real outputs before widening access.

## Definition of done for the first release

The three example questions can be asked on the owner-only page.  Each answer
is numerically reconcilable, uses only the caller's permitted data, shows its
range, and opens the supporting Scout call/moment.  Unsupported questions fail
plainly instead of producing a plausible answer.
