# DSA Prep Tracker

A local-first tracker for LeetCode practice, built around one question: **can
you still solve it a month later, unaided?** Solve counts and revision counts
are activity. Retention is measured separately, or reported as unknown.

The app runs on your machine. Practice history stays in gitignored `data/` and
is never committed here.

## Running it

```
npm install
npm run dev      # http://localhost:5173
npm test         # resolver, retention and schema suites
npm run build
```

## For the coach

If you are an assistant asked to produce a coaching plan, start here:

| Read | For |
| --- | --- |
| [docs/coach-planning-protocol.md](docs/coach-planning-protocol.md) | **Entry point.** Which files to read, how to choose a review horizon, how to produce today plus three conditional days |
| [docs/coaching-workflow.md](docs/coaching-workflow.md) | Ownership, what counts as evidence, how work is selected |
| [docs/retention-policy.md](docs/retention-policy.md) | What the engine **actually computes**, and its known discrepancies |
| [docs/retention-policy.reference.json](docs/retention-policy.reference.json) | The **agreed target** policy, annotated with implementation status |
| [schemas/coaching-decision.schema.json](schemas/coaching-decision.schema.json) | Output contract |
| [fixtures/](fixtures/) | Synthetic worked examples, structured and legacy |
| [schemas/manifest.schema.json](schemas/manifest.schema.json) | The data repository's inventory, which is where to start reading |
| [schemas/evidence-shard.schema.json](schemas/evidence-shard.schema.json) | One month of practice facts, and the counting rules that are easy to get wrong |

Personal context — interview target, availability, rest days — lives in the
private data repository, not here. So does the evidence: read `manifest.json`
there first, then only the monthly shards your review actually covers.

## Two rules the design rests on

**The app owns facts; the coach owns advice.** A coaching decision can never
create, edit or clear a practice attempt, move a due date, or promote topic
health. Those are code changes.

**Absent evidence is unknown, not zero.** With no eligible cold test, debt is
reported as unknown rather than zero, because a published zero reads as
"retention verified". A forecast day whose dependency has no recorded result
says *awaiting result* rather than assuming the best case.

## Layout

```
src/utils/retention.js   anchors, spacing ladder, measured debt
src/utils/outlook.js     resolves a conditional forecast into one plan
src/components/          Calendar, Problems, Debt, Stats, Recursion
schemas/ fixtures/ docs/ the coaching contract
scripts/*.test.mjs       node --test, synthetic inputs only
data/                    gitignored: your practice history
```
