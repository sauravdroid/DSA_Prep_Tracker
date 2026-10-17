# Coaching workflow

Repository-owned copy of the reusable protocol. This file is the authority for
how coaching works; refresh any ChatGPT project upload from this version rather
than editing a separate copy.

**Writing a worklist?** Start with
[coach-planning-protocol.md](./coach-planning-protocol.md). It is the entry
point: which files to read, what a version contains, and how to publish one.
This document supplies the rules that protocol applies.

**Personal context is deliberately absent.** Interview target, weekday time
ceilings, rest days and current focus live in the private data repository
(`context/coaching-context.json`), not here. This repository is public-facing
application code.

## Ownership

| Party | Owns |
| --- | --- |
| Application | Practice facts: recording attempts and publishing them. Rendering the accepted worklist exactly as written. Checking that a published version is valid and kept to its paths |
| Coach | Every decision about what to do: which problems, which list, which pattern, what order, when to repair, when to retest, when an item comes off. The reasoning and explanation |

The coach cannot manufacture attempts or override recorded evidence. The
application makes no learning judgements. It computes no plan, due date, debt
or branch, and it never adopts a worklist the user has not reviewed.

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
evidence. [retention-policy.md](./retention-policy.md) describes the spacing
and eligibility rules. They are guidance for the coach; the app no longer
enforces them.

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

For each item, say its purpose in `reason`, and put the evidence used and what
result would change the plan in `detail`. Keep the list small enough to finish
before the next update.

## Authoring a worklist

Write against [`schemas/worklist.schema.json`](../schemas/worklist.schema.json),
and update [`schemas/worklist-manifest.schema.json`](../schemas/worklist-manifest.schema.json)
in the same commit. Worked examples:
- [`fixtures/worklist.example.json`](../fixtures/worklist.example.json)
- [`fixtures/worklist.migrated.example.json`](../fixtures/worklist.migrated.example.json)
- [`fixtures/worklist-manifest.example.json`](../fixtures/worklist-manifest.example.json)

Rules the app enforces before it lets the user accept a version:

- The version and the manifest are schema-valid.
- `id` is `writtenAt` without punctuation.
- No problem appears twice, and no pattern name repeats within a list.
- The publishing commit touched only `coaching/worklists/`.
- The commit added version files without editing or deleting any.
- The version the user currently follows still has the content they accepted.

The app works out what changed between versions on its own. A version's
`changes` supplies the reasons it shows; it cannot hide a change.

## Legacy coaching files

`coaching/decision.json`, `index.json`, `days/`, `assessments/`, `outcomes/`,
`weeks/` and `months/` are frozen history from the dated-plan era. Nothing
writes to them anymore. They became the first worklist version through the
rules in [worklist-migration.md](./worklist-migration.md).
