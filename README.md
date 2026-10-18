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

If you are an assistant asked to write a prep sheet, start here:

| Read | For |
| --- | --- |
| [docs/coach-planning-protocol.md](docs/coach-planning-protocol.md) | **Entry point.** Which files to read, what a version contains, how to publish one |
| [docs/coaching-workflow.md](docs/coaching-workflow.md) | Ownership, what counts as evidence, how work is selected |
| [schemas/worklist.schema.json](schemas/worklist.schema.json) | Output contract: one prep sheet |
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
publishes them, and renders the prep sheet you made current, exactly as
written. The coach decides what goes on it and in what order. A sheet can
never create, edit or clear a practice attempt.

**Nothing changes without review.** When the coach updates your sheet or
recommends a different one, the background sync spots it and the Sheets page
offers **Review update** or **Review new sheet**, with its summary, what
changed and the checks it passed. It applies only when you choose. The coach
archives sheets instead of deleting them, so every sheet stays viewable under
**All sheets**.

A problem on the sheet shows as done once you get an Accepted on LeetCode on
or after the day the coach wrote the sheet (a plain ✓). Recording a graded
attempt replaces that with its result, which is what the coach goes by.

## Layout

```
src/utils/worklist.js          rendering helpers and the sheet diff
src/utils/validateWorklist.js  schema, publishing-rule and content-hash checks
src/components/Worklist*.jsx   the Sheets page and review panel
src/components/SheetItemDetail.jsx  the sheet's section in the shared problem drawer
src/components/SheetStatusIcon.jsx  a problem's status: graded result, solved, or not yet
src/components/Roadmap.jsx     the problem roadmap tree
src/components/                Calendar, Problems, Stats, Recursion
schemas/ fixtures/ docs/       the coaching contract
scripts/*.test.mjs             node --test, synthetic inputs only
scripts/migrate-worklist.mjs   one-time migration of the dated plans
data/                          gitignored: your practice history
```
