# Scout — Coaching Page Integrity, Design & Stage Classification

**Do not interrupt the current broader-coaching work block. Begin this task after that work is complete.**

This task addresses several issues discovered on the Coaching page.

Treat these as potential **systemic implementation, data-integrity, coaching-logic, and UX issues**, not isolated screenshot fixes.

Before changing anything, inspect the live/current implementation and trace the relevant data paths.

Read and use:

- `current-state.md`
- `SCOUT-DESIGN.md`
- `SCOUT-BRAND.md`
- `scout-doctrine.md`
- Relevant portions of `CLAUDE.md`, particularly rulings referenced by `SCOUT-DESIGN.md`
- Existing tests and implementation relevant to Coaching

For product UI implementation, `SCOUT-DESIGN.md` and its referenced rulings are the current design authority.

For coaching behavior, `scout-doctrine.md` plus the approved financial-DQ clarification below are the current coaching authority.

Existing rules are authoritative but not untouchable. If you find a rule that you believe should change to produce a materially better product, do not silently violate it or contort the implementation around it. Surface the conflict and recommendation to me for a ruling.

Preserve unrelated functionality and do not regress the broader-coaching work completed immediately before this task.

---

# 1. Fix the Incorrect Green Treatment

Scout already defines green as both the brand color and a positive/good semantic color.

Do not invent a new semantic-color system.

Scout already has established semantic good/mid/bad treatment and score-band rules.

The Coaching implementation appears to be violating or misapplying those existing rules.

## Current example

The stage cards currently show approximately:

- Intro — 55
- Discovery — 59
- Pitch — 60
- Objection Handling — 59
- Close — 54

Close is the weakest displayed score, yet its card has a bright Scout-green border and green progress treatment.

That makes a weak area look positive.

Trace exactly why the green treatment is appearing.

Determine whether it represents:

- Selection
- Active state
- Coaching priority
- Score band
- Focus
- Generic accent styling
- Something else

Then correct the underlying implementation according to Scout's existing design rules.

Do not simply replace green with red without understanding what the state represents.

---

# 2. Preserve Scout's Existing Design System

Use existing Scout primitives wherever possible.

Do not casually introduce:

- Another green
- New semantic colors
- New font sizes
- New font weights
- New radii
- New grey body-text conventions
- New button treatments
- New card treatments
- Decorative green usage
- New abstractions duplicating existing design rules

Preserve the established system, including:

- Saira
- The closed type scale and ruled exceptions
- Existing weight rules
- Existing radii
- Existing semantic colors
- Existing score-band behavior
- Existing surface/ground rules
- Existing ruled exemptions

Do not create a new primitive when Scout already has one for the intended meaning.

Review the Coaching page for other obvious occurrences of the **same underlying semantic-state bug**, but do not turn this into a product-wide design sweep.

---

# 3. Remove Unnecessary Explanatory UI Copy

There is a recurring tendency to add explanatory prose when better information architecture and labeling should make the interface understandable without it.

For example, copy such as:

> “Examples cover 2 reviewed calls; 9 have not completed this review. The section averages use all available grades in your selected period.”

should generally not be necessary.

Scout should remain quiet, precise, and certain.

## UX principle

Before adding explanatory copy, ask:

**Can the interface itself make this obvious?**

Prefer:

1. Correct information architecture
2. Clear labeling
3. Visual hierarchy
4. Appropriate state/design treatment
5. Concise contextual wording when genuinely necessary
6. Explanatory prose only when the concept cannot reasonably be made clear otherwise

Do not expose internal mechanics merely because the interface would otherwise be confusing.

Fix the interface rather than explaining the implementation.

Do not blindly remove useful customer information.

If removing text creates genuine ambiguity, improve the underlying design first.

Do not simply relocate unnecessary explanation into:

- Tooltips
- Info icons
- Footnotes
- Hover states
- Another helper sentence

unless the customer genuinely needs it.

**Scout should not explain what good product design can make obvious.**

---

# 4. Investigate the Inconsistent Stage Call Counts

The stage cards currently show different numbers of graded calls:

- Intro — 9
- Discovery — 8
- Pitch — 7
- Objection Handling — 6
- Close — 7

This requires investigation.

Do **not** merely remove those labels and leave the calculation untouched.

Trace the calculation/data path responsible for each score.

Identify the exact calls contributing to:

- Intro
- Discovery
- Pitch
- Objection Handling
- Close

Determine exactly why those populations differ.

---

# 5. Comparable Scores Must Represent Comparable Performance

When Scout presents:

**Intro · Discovery · Pitch · Objection Handling · Close**

side by side, it communicates that these are meaningfully comparable measures of the closer's performance.

Scout must not silently cherry-pick materially different call subsets and then present their averages as equivalent comparisons.

However:

**Do not interpret this as a requirement that every eligible call must contribute a score to every stage.**

There are legitimate reasons a call may correctly stop before later stages.

The important distinction is whether a stage is:

**Not reached for a legitimate reason**

versus

**Reached or supposed to be reached, but performed poorly.**

Those are not equivalent.

---

# 6. Critical Financial-Disqualification Rule

Use the following approved rule.

## Financial DQ discovered correctly during Discovery

If the closer properly discovers during Discovery that the prospect is genuinely financially unqualified:

**That is good Discovery behavior.**

The closer successfully qualified the prospect and correctly identified that the sale should not proceed.

The fact that the call then does not legitimately progress through Pitch, Objection Handling, or Close must **not** be treated as poor performance.

Do not:

- Penalize the rep for later stages not occurring
- Give those stages zeroes
- Treat the call as a failed Close
- Treat the call as a lost deal caused by the rep
- Manufacture downstream grades for stages that correctly never happened

The closer did the right thing.

The call should not hurt their performance data merely because proper qualification prevented an inappropriate sales attempt.

## Financial DQ discovered only at the Close

This is different.

If the prospect is genuinely financially unqualified, but the closer fails to establish that during Discovery and proceeds through the sale until the lack of financial qualification only becomes apparent while attempting to Close:

**That is a Discovery failure.**

It is still **not a failed Close**.

The downstream symptom appeared during the Close, but the coaching cause is upstream:

**Financial qualification was missed during Discovery.**

Coach and score the actual failure appropriately without punishing Close for a sale that should never have reached that stage.

## Core principle

Financial disqualification itself is not failure.

The question is:

**Did the closer discover it when they were supposed to?**

Correctly identifying an unqualified prospect during Discovery is successful qualification.

Failing to identify that fact until the Close is a Discovery miss.

Build and test the data model accordingly.

---

# 7. Determine the Correct Stage Eligibility Model

Trace what currently happens when:

- A normal sales call reaches all stages
- A call ends early
- A financial DQ is correctly discovered during Discovery
- A financial DQ is missed during Discovery and discovered at Close
- No objection occurs
- Pitch never legitimately occurs
- Price is never dropped
- Close never legitimately occurs
- Evidence is insufficient to grade a stage
- Analysis fails for one stage
- The call itself is incomplete
- A follow-up has a different structure
- Another legitimate call type does not follow the complete five-stage progression

The system needs to distinguish at least conceptually between:

**Stage occurred and can be evaluated**

**Stage appropriately did not occur**

**Stage should have occurred but did not**

**Stage cannot be measured because evidence/data is insufficient**

Do not collapse these states into the same thing.

Do not invent measurements for stages that appropriately never occurred.

Do not turn unmeasured into zero.

Use existing Scout rules wherever they answer these cases.

If another case is genuinely undefined, report:

**Current behavior**  
**Why it creates ambiguity**  
**Possible treatments**  
**Your recommendation**  
**Decision needed from me**

and wait for my ruling where product philosophy is required.

---

# 8. Reconcile Stage Comparability With Legitimate Stage Eligibility

The current different denominators may indicate cherry-picking, but matching denominators alone is **not** the objective.

Investigate what the correct model should be.

For example, a properly financially disqualified call may legitimately contribute to Discovery performance while not contributing to Close performance.

That is not cherry-picking if the exclusion follows a consistent, principled eligibility rule.

What would be unacceptable is allowing each stage to independently include/exclude calls based merely on whether a grade happened to be available, creating hidden selection bias.

Determine whether the current implementation has a real **eligibility model** or merely averages whatever grades happen to exist.

If it is the latter, fix the architecture.

The population for each metric should be determined by explicit Scout eligibility rules, not accidental data availability.

---

# 9. Remove the Per-Card “Graded Calls” Labels

Once the underlying population/eligibility logic has been validated or corrected, remove:

> “X graded calls”

from each individual stage card.

The primary purpose of these cards is:

**Stage → Score → Performance state**

The repeated denominator does not need to compete visually with that information.

Do not automatically replace it with:

- “Based on X calls”
- Another counter
- A tooltip
- An info icon
- A footnote
- Helper copy

If there is a genuine customer need to expose sample size, bring that product question to me.

---

# 10. Investigate “2 of 11 Calls Reviewed for Examples”

The Coaching page also currently shows:

> “2 of 11 calls reviewed for examples”

Trace exactly what this means.

Do not assume this is the same population used for stage scoring.

There may legitimately be:

### Performance scoring population
Calls eligible for particular performance measurements.

### Coaching-example review population
Calls that have completed additional processing required to surface specific coaching examples.

If those are intentionally separate systems, preserve that distinction internally.

But the customer should not need a paragraph explaining the architecture.

Determine whether the “2 of 11” state gives the customer useful or actionable information.

If it represents meaningful processing progress that materially affects what the customer currently sees, determine the cleanest treatment using existing Scout patterns.

If it merely exposes internal processing mechanics, remove it.

Do not invent a new progress/loading pattern without checking Scout's existing design system first.

---

# 11. Investigate the Apparent Call-Stage Classification Error

A coaching example references an exchange at approximately **2:33 into the call**, while the Coaching experience appears to associate the coaching area with **Close**.

Do not assume the screenshot tells us which layer is wrong.

Trace the complete path through:

- Call analysis
- Stage classification
- Coaching identification
- Coaching-category assignment
- Stage scoring
- UI presentation

Determine exactly what the displayed Close category represents.

Possible causes include:

- The moment itself was incorrectly classified
- The coaching category is mapped to Close
- The UI is presenting coaching cause as event location
- Stage scoring and coaching categorization are conflated
- The classifier lacks conversational structure
- Another architecture issue

Find the root cause before changing behavior.

---

# 12. Enforce Scout Doctrine's Existing Structural Rules

Scout Doctrine already establishes that the moment within the conversation changes the meaning of behavior.

For example:

An objection only exists after the Pitch and after the price drop.

The same statement can be a Discovery disclosure earlier and an objection later.

Scout therefore cannot reliably classify important sales behavior from isolated wording alone.

Ensure the implementation honors this principle.

---

# 13. Stage Classification Must Understand Conversation Progression

Where classification is required, consider appropriate structural evidence together:

- Scout Doctrine
- Relative position within the call
- Surrounding conversation
- What happened before
- What happened after
- Whether prerequisite events occurred
- Pitch location
- Price-drop location where relevant
- Semantic content
- Actual conversational transitions

Do not implement a rigid absolute timestamp rule.

Timing is evidence, not the sole classifier.

Likewise, early-call language should not become a late-stage classification merely because isolated words resemble language that often occurs later.

The goal is understanding **conversation progression and structure**.

---

# 14. Preserve Event Location vs. Coaching Cause

Scout must distinguish:

**Where something happened**

from

**Where the coachable cause occurred.**

The financial-DQ rule is an important example.

### Correct Discovery

Financial DQ identified during Discovery:

**Good qualification. No downstream failure.**

### Missed Discovery

Financial DQ identified only while attempting Close:

**The symptom appears at Close, but the failure belongs to Discovery.**

Do not automatically assign coaching to the stage containing the timestamp.

Do not automatically assign it based only on a coaching-category label either.

Model the actual causal relationship.

---

# 15. Use Existing Discovery and Objection Doctrine

Do not redefine these areas.

Scout Doctrine already defines Discovery around:

- Pain
- Goals
- Current situation
- Decision makers
- Why now
- Financial resources

It establishes relationships between Discovery weaknesses and downstream objections.

Doctrine also establishes that an objection cannot exist before Pitch and price drop.

Use these as canonical Scout behavior.

Do not substitute generic sales methodology.

---

# 16. Audit Intro, Pitch, and Close Definitions

Determine whether Scout's existing materials sufficiently define:

- Intro
- Pitch
- Close

Do not silently fill missing definitions with generic sales knowledge.

If existing Scout materials are sufficient, use them.

If not, report:

1. What Scout currently defines
2. What the implementation currently assumes
3. Where those differ
4. What remains ambiguous
5. Specific product decisions needed from me

Stop that portion if necessary.

I would rather define Scout's sales philosophy correctly once than have the system infer it.

Once approved, missing definitions should be added to the appropriate canonical Doctrine.

---

# 17. Existing Rules Can Be Challenged — Never Silently

Existing Scout design and coaching rules are the default authority.

They are not immutable.

If following an existing rule creates what you believe is a materially worse:

- UX
- Visual hierarchy
- Coaching result
- Accessibility outcome
- Product behavior
- Architecture

surface the conflict.

Use:

**Existing rule:**  
What Scout currently requires.

**Conflict:**  
What this task exposes.

**Alternative:**  
What you recommend.

**Reason:**  
Why it improves Scout.

**Impact:**  
What implementation, documentation and tests would change.

Ask for my ruling before changing the canonical rule.

---

# 18. Validation — Stage Eligibility and Data Integrity

For the selected Coaching period, identify the actual calls behind each stage score.

For each call/stage combination, determine why it is:

- Eligible and graded
- Correctly not applicable
- Expected but missed
- Unmeasured because of insufficient data
- Excluded for another explicit reason

Do not validate this merely by making the displayed counts match.

Specifically test:

### Financial DQ during Discovery

Verify that:

- Scout recognizes successful financial qualification
- Discovery receives appropriate treatment
- Later stages that correctly never occur do not penalize the rep
- The call is not treated as a failed Close
- No downstream zeroes are fabricated

### Financial DQ discovered at Close

Verify that:

- Scout recognizes the missed financial qualification
- The coaching failure belongs to Discovery
- Close is not blamed for the prospect being genuinely unable to afford the purchase
- The call is not treated as though the closer simply failed to overcome a money objection

Also test:

- Normal full calls
- Early-ended calls
- Calls with no objection
- Calls where Pitch never legitimately occurs
- Insufficient evidence
- Analysis failures
- Follow-ups where applicable

Prove the eligibility behavior using actual underlying call data.

---

# 19. Validation — Coaching Structure

Test representative real calls including:

- Normal Discovery
- Short Discovery
- Long Discovery
- Early disclosures
- Disclosure later becoming objection
- Concern before price
- Genuine objection after price
- Correct financial qualification
- Correct financial DQ
- Missed financial qualification discovered downstream
- Coaching whose cause belongs upstream from its symptom
- Short calls progressing quickly
- Long calls progressing slowly
- Calls revisiting earlier topics

Verify Scout uses conversational structure and Doctrine rather than isolated keywords or arbitrary timestamps.

---

# 20. Validation — UX and Design

Verify:

- Weak/negative states are not presented as positive
- Positive states retain correct positive semantics
- Mid/bad/good treatment follows existing rules
- Selection/focus cannot be mistaken for positive performance
- Stage cards remain immediately understandable without repeated call-count labels
- Removing helper copy does not create ambiguity
- No unnecessary tooltip/footnote/info-icon replacements appear
- Processing state appears only when useful to the customer
- Existing typography rules remain intact
- Existing colors remain intact
- Existing radii/surface rules remain intact
- Relevant rendered/design-system tests pass

---

# 21. Regression Protection

Do not destabilize the broader-coaching improvements or previously approved examples.

Re-run relevant approved examples after structural changes.

If an existing correct example begins failing, investigate the conflict rather than accepting the regression.

Fix systemic logic rather than patching individual calls unless an explicit Scout business-rule exception genuinely requires it.

Every coaching claim must remain grounded in something that actually happened on the call.

---

# 22. Documentation

After implementation is verified:

## Scout Doctrine

The approved financial-DQ distinction should be reflected canonically:

- Correct financial DQ during Discovery = successful qualification
- Financial DQ missed until Close = Discovery failure
- Neither should be treated as a failed Close merely because the prospect cannot afford the purchase

Integrate this cleanly into the existing financial-disqualification doctrine rather than creating a conflicting duplicate rule.

Do not alter other approved Doctrine philosophy without surfacing it to me.

## Design

If the design problem was simply an implementation violation, fix the implementation rather than duplicating existing rules into another document.

If I approve a change to a design rule, update the canonical source and appropriate tests.

## Current state

Update `current-state.md` to describe the resulting implementation accurately.

Revise obsolete descriptions rather than using it as an append-only changelog.

---

# 23. Completion Report

When complete, report:

## Stage-score integrity

- Why the stage cards previously had different call counts
- Whether this represented legitimate eligibility differences or accidental grade availability
- The eligibility model now used
- How correct financial DQs affect the metrics
- How missed financial qualification affects the metrics
- Treatment of other important edge cases
- Any unresolved product decisions

## Design

- Why Close 54 was green
- What the green represented
- What changed
- Existing Scout design rules applied
- Tests performed

## UX

- Explanatory/helper copy removed
- Whether “2 of 11 calls reviewed for examples” remains
- If it remains, why the customer benefits from seeing it
- Any explanatory UI that genuinely remains necessary

## Coaching

- Root cause of the apparent 2:33 / Close issue
- Whether it was classification, mapping, scoring, presentation, or another layer
- What changed
- How conversational structure is now incorporated
- Real-call validation performed
- Regressions found and resolved

## Doctrine

- Confirmation that the financial-DQ clarification is reflected correctly
- Whether Intro is sufficiently defined
- Whether Pitch is sufficiently defined
- Whether Close is sufficiently defined
- Product decisions still needed from me

## Rule conflicts

Surface separately any existing Scout rule you believe should be reconsidered.

Do not begin unrelated backlog work as part of this task.