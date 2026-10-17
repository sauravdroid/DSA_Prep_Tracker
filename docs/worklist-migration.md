# Worklist migration

How the dated coaching plans became the first worklist version. This ran once;
the rules are kept so the result can be checked against them.

Implementation: [`src/utils/worklistMigration.js`](../src/utils/worklistMigration.js),
driven by [`scripts/migrate-worklist.mjs`](../scripts/migrate-worklist.mjs).
Tests: [`scripts/worklistMigration.test.mjs`](../scripts/worklistMigration.test.mjs).

## What it reads, and what it leaves alone

Everything is read at **one data-repository commit**, recorded as
`migration.sourceCommit` and `basedOn.trackerCommit`:

- every `coaching/days/<date>.json`
- `tracker-data.json`, for the practice log and problem titles and difficulty
- `manifest.json`, for the tracker fingerprint

No legacy file is changed, moved or deleted. `coaching/decision.json`,
`index.json`, `days/`, `assessments/`, `outcomes/`, `weeks/` and `months/`
remain as frozen history. Before the snapshot, the app's legacy writers were
switched off. The archive endpoint now refuses, and background sync no longer
adopts or archives plans.

## Output

Written in one commit, and nothing else:

- `coaching/worklists/<id>.json`: version 1, with a `migration` block
- `coaching/worklists/manifest.json`: `latest` set to that id, the version
  marked `migrated: true`

## Rules

Only `problem` items with a slug are considered. Actions are guidance and were
never trackable work.

1. **Resolve each day's branches against the recorded practice log**, using
   the resolver the old Debt page used (`buildDayTree`). Each scenario ends up
   in one of three states:

   | State | Meaning | Outcome |
   | --- | --- | --- |
   | taken | its condition held, or it was `always` | candidate for active |
   | ruled-out | its condition resolved false | excluded: `not-selected` |
   | open | its condition is still unknown | excluded: `unresolved-alternative` |

   Alternatives are never flattened into work: a branch that never applied
   does not become an assignment.

2. **A taken item is completed** if a qualifying Green was recorded on or
   after the day it was planned for. That item is excluded as `completed`.
   - A cold item needs a cold, unaided, non-repeat Green. Repair practice does
     not stand in for a cold check.
   - A repair item needs a repair or cold Green.
   - Anything else needs any Green.

   A Yellow or Red keeps the item active.

3. **A taken item planned more than 7 days before the migration** and not
   completed is excluded as `past-day`.

4. **Everything else is active.** If several days plan the same problem, the
   newest plan wins: its list, pattern, mode and text are used. Every mention
   is kept in `sources[]`.

5. **Mapping an item:**

   | Legacy | Worklist |
   | --- | --- |
   | `kind` `new` / `learn` | list `new`, mode `learn` |
   | `kind` `cold` / `warm` / `repair` | list `revision`, same mode |
   | `kind` `repair` | `flag: "repair"` |
   | `topic` | pattern; falls back to the problem's first tag, then `Other` |
   | `purpose` | `reason`, clipped to 140 characters; falls back to `why` |
   | `why` + `detail` | `detail` |
   | `minutes` | `minutes` |
   | tracker | `title`, `difficulty` |

6. **Order.** Patterns, and the items within them, are ordered by their newest
   planned date.

## Completeness check

Every problem mentioned in any day is accounted for at its source, either
active or listed in `migration.excluded` with one of the reasons above. The
script refuses to write output otherwise, and refuses to publish when either
file fails validation.

## Publishing

`--push <id>` publishes exactly the reviewed files. If `main` has moved since
the snapshot, it compares every `coaching/` path between the snapshot and the
new head, and stops if any differ. The ref update is not forced.
