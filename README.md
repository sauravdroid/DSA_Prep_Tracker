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
npm test         # worklist, migration, schema and legacy suites
npm run build
```

## For the coach

If you are an assistant asked to write the worklist, start here:

| Read | For |
| --- | --- |
| [docs/coach-planning-protocol.md](docs/coach-planning-protocol.md) | **Entry point.** Which files to read, what a version contains, how to publish one |
| [docs/coaching-workflow.md](docs/coaching-workflow.md) | Ownership, what counts as evidence, how work is selected |
| [schemas/worklist.schema.json](schemas/worklist.schema.json) | Output contract: one worklist version |
| [schemas/worklist-manifest.schema.json](schemas/worklist-manifest.schema.json) | The manifest you update in the same commit |
| [fixtures/](fixtures/) | Synthetic worked examples |
| [docs/retention-policy.md](docs/retention-policy.md) | Spacing and eligibility guidance |
| [schemas/manifest.schema.json](schemas/manifest.schema.json) | The data repository's inventory, which is where to start reading |
| [schemas/evidence-shard.schema.json](schemas/evidence-shard.schema.json) | One month of practice facts, and the counting rules that are easy to get wrong |

Personal context — interview target, availability, rest days — lives in the
private data repository, not here. So does the evidence: read `manifest.json`
there first, then only the monthly shards your review actually covers.

## Two rules the design rests on

**The app owns facts; the coach owns decisions.** The app records attempts,
publishes them, and renders the worklist the user accepted, exactly as
written. The coach decides what goes on it. A worklist can never create, edit
or clear a practice attempt.

**Nothing changes without review.** A new version from the coach appears as
**Sync** on the Worklist page, with what changed and the checks it passed. It
replaces the current list only when you accept it. Versions are append-only,
so every earlier list stays readable.

## Layout

```
src/utils/worklist.js          rendering helpers and the version diff
src/utils/validateWorklist.js  schema, publishing-rule and content-hash checks
src/components/Worklist*.jsx   the page, problem drawer and Sync review
src/components/                Calendar, Problems, Stats, Recursion
schemas/ fixtures/ docs/       the coaching contract
scripts/*.test.mjs             node --test, synthetic inputs only
scripts/migrate-worklist.mjs   one-time migration of the dated plans
data/                          gitignored: your practice history
```
