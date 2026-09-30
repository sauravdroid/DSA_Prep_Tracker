# Coaching workflow

Repository-owned copy of the reusable protocol. This file is the authority for
how coaching works; refresh any ChatGPT project upload from this version rather
than editing a separate copy.

**Personal context is deliberately absent.** Interview target, weekday time
ceilings, rest days and current focus live in the private data repository
(`context/coaching-context.json`), not here. This repository is public-facing
application code.

## Ownership

| Party | Owns |
| --- | --- |
| Application | Practice facts, eligibility, dates, debt arithmetic, enforced scheduling constraints |
| Coach | Learning focus, anchor coverage, task selection, reasoning, explanation |

The coach cannot manufacture attempts or override recorded evidence. The
application does not invent learning judgements. A recommendation that would
change a fixed formula is a request for a code change, not a decision the app
will honour.

## What counts as evidence

Four separate things, never averaged into one confidence number:

- **Conceptual understanding** — the invariant, correctness argument, complexity
  and counterexamples, sourced to notes or conversation turns.
- **Delayed recall** — an eligible cold attempt on a previously learned anchor,
  with elapsed gap, result, timing and help recorded.
- **Transfer** — an unseen problem solved without its pattern being disclosed.
- **Interview execution** — clarification, explanation, implementation, testing,
  time management, recovery.

A Green on a familiar anchor does not prove transfer. An unseen pass does not
retroactively create an anchor cold attempt. A self-reported strong topic is a
hypothesis until verified. A topic with no recent practice is *uncertain*, not
automatically weak.

### What does not establish retention

- Accepted LeetCode submissions
- Revision counts
- Failed-submission counts (these indicate difficulty, not a graded Red)
- Positive assistant feedback in a conversation
- Assisted attempts (`help !== 'none'`)
- Same-session repeats (`sessionRepeat`)

Only a recorded cold attempt that is unaided and not a repeat is eligible
evidence. See [retention-policy.md](./retention-policy.md) for what the engine
currently implements versus what remains agreed-but-unimplemented.

## Review horizons

- **Daily** — adjust next actions from the latest results, handle repair and
  retests, account for work already done.
- **Weekly** — the main planning horizon. Review repeated errors, due checks,
  coverage of older and strong topics, unseen performance, progress in the
  active new pattern. A midweek review is partial; future dates are not missed
  work.
- **Monthly** — breadth and readiness. Pattern map, retained versus unmeasured
  skills, neglected coverage. A rolling four-week window may supplement the
  calendar month if its range is labelled.
- **Full history** — initial assessment, conflicting reports, or when a monthly
  review cannot establish coverage.

Check at every update whether a weekly or monthly review is due. This protocol
describes what happens when a review is requested; it does not create a
background schedule.

## Requesting missing evidence

Ask when the missing evidence could materially change the plan, and say which
decision each input resolves. Do not request an export because its name is on a
checklist, and do not mistake a missing upload for missing data when the tracker
already supplies it.

Absent evidence is **unknown**, never a negative finding. "No graded attempt
found" does not prove the work was skipped.

## Selecting work

1. Unresolved failures and eligible due checks come first. A failed cold attempt
   cannot be displaced by easier new problems.
2. Revisit older patterns through representative anchors and coverage gaps.
   Paused topics are distinct from topics merely absent from the tracking setup;
   surface coverage gaps without charging invented debt.
3. Reserve unseen transfer practice in already-learned patterns. Check the full
   solved set before calling a problem blind; if prior exposure is unknown,
   label the uncertainty.
4. Keep a deliberate new-pattern learning track. Assistance during learning is
   useful but is not an independent blind pass.
5. Sample apparently strong topics periodically rather than dropping them.
6. Include mixed interview-style practice as capacity permits. A mock occupies a
   session; it is not piled on top of a full day.

For each task state its purpose, the evidence used, expected time, and what
result would change the plan. Keep the next three days conditional and the rest
of the week provisional.

## Authoring a decision

Write against [`schemas/coaching-decision.schema.json`](../schemas/coaching-decision.schema.json).
Worked examples: [`fixtures/coaching-decision.structured.example.json`](../fixtures/coaching-decision.structured.example.json)
(resolvable) and [`fixtures/coaching-decision.legacy-prose.example.json`](../fixtures/coaching-decision.legacy-prose.example.json)
(preview-only).

Three independent version fields:

| Field | Current | Meaning |
| --- | --- | --- |
| `version` | 1 | Decision-document format |
| `outlookSchemaVersion` | 2 | `nextThreeDays` contract |
| retention policy | see policy doc | What the engine computes |

Raising one does not raise the others. A structured outlook still lives inside a
`version: 1` document.

Rules the resolver enforces, so authoring against them is worthwhile:

- Conditions evaluate to true / false / **unknown**. Scenarios run in ascending
  `priority`, and resolution *stops* at the first unknown — a higher-priority
  recovery branch that cannot be evaluated prevents a lower branch from being
  selected on the assumption that it is false.
- Dependencies are matched by explicit slug + local date + mode. For a `cold`
  dependency, assisted or repeat records make it **ambiguous**, not Green.
- An unrecognised predicate produces **Needs review**, never a guessed branch.
- Only `type: "problem"` items count toward workload. "Record the result" and
  "refresh coaching" are actions.
- `followUps` describe later days and are never counted as work for this day.
- Omit `minutes` rather than guessing; the app reports an incomplete estimate
  instead of treating a missing value as zero.

Prose in `conditional[].if` and in `branches[]` is display-only. It never selects
a branch.
