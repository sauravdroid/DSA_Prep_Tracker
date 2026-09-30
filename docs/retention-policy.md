# Implemented retention policy

**Policy version: 1 (partial).** This documents what the engine in
`src/utils/retention.js` *actually computes today*, which is not yet the same as
the agreed policy. Where they differ it is recorded below as a discrepancy.

The agreed target is [`retention-policy.reference.json`](./retention-policy.reference.json).
Read that for what the rules *should* be; read this for what runs.

This version is a third, independent concept from the decision-document
`version` (1) and the `outlookSchemaVersion` (2). Raising one does not raise the
others.

> The code does not currently expose a policy-version constant. Adding one, and
> removing the `forecastValidity` comparison against `DECISION_VERSION`, is
> scheduled work — see discrepancy D5.

## Implemented

### Eligibility

`isEligibleColdTest` is the single definition of qualifying evidence: `mode`
is `cold`, `help` is `none`, and the entry is not a `sessionRepeat`. A `cold`
label alone is not enough.

It currently gates **whether debt is calculable**. The spacing ladder does not
yet use it — see discrepancy D4.

`src/utils/outlook.js` applies the same rule when resolving a forecast
dependency; anything failing it leaves the dependency **ambiguous** rather than
supplying a grade.

### Spacing ladder

```
INTERVALS            [3, 7, 14, 30]   days
YELLOW_INTERVAL      3
RED_INTERVAL         1
MIN_PROMOTION_GAP    2                days
```

`ladderPosition` walks a problem's cold history in date order:

- **green** advances one rung, but only when the attempt is not a
  `sessionRepeat` *and* at least `MIN_PROMOTION_GAP_DAYS` have elapsed since the
  previous cold test.
- **yellow** drops one rung and sets the interval to 3 days.
- **red** resets to rung 0 with a 1-day interval.

### Anchor state

Mutually exclusive, in this precedence:

| State | Condition |
| --- | --- |
| `failed cold test` | last cold result was `red` |
| `unmeasured` | no cold test has ever been recorded |
| `due for validation` | due date has passed |
| `scheduled` | otherwise |

`needsRepair` is true when the last result was `red` and no `repair` entry
exists on or after that date. A repair does **not** clear the Red by itself —
only a later cold test can.

### Debt

Per scheduled anchor:

| Contribution | Points |
| --- | --- |
| Due | 1 |
| Overdue by ≥ 7 days | 2 (instead of 1) |
| Last result `yellow` | 1 |
| Last result `red` | 3 |

Never-tested anchors are explicitly excluded from the due term — charging debt
for them would bury a cold start. Unmeasured *topics* are likewise charged
nothing.

**Unknown is not zero.** `debtCalculable` is true only when some anchor on a
*scheduled* topic has an eligible cold test. Until then `totalDebt` is `null`
and every surface reports unknown; evidence on a paused or untracked topic does
not satisfy the gate.

Mode thresholds: `≥ 6` Consolidation, `≥ 3` Mixed, otherwise Expansion. When
debt is not calculable the mode is a **provisional Mixed** that reserves one
baseline slot, rather than an Expansion derived from absent evidence
(`modeProvisional`).

### Health

`deriveHealth` groups anchors by **subpattern**. A topic is promoted only when
*every* configured subpattern has passing evidence — one anchor passing
repeatedly cannot promote a topic whose other subpatterns are untested.

| Health | Requirement |
| --- | --- |
| `unmeasured` | no anchor cold tested |
| `fragile` | measured but incomplete or failing |
| `maintained` | every subpattern validated, all green, minimum stage reached |
| `stable` | as above at the top rung |

## Known discrepancies

These are agreed rules the engine does **not** yet implement correctly. Reported
output that depends on them should be treated as provisional.

**D1 — Unmeasured topics are charged one point.** ✅ *Resolved.*
The topic-level `+1` is removed. Unmeasured topics contribute nothing and report
`debt: null` rather than a number.

**D2 — Cold start reports an authoritative mode.** ✅ *Resolved.*
A cold start is now provisional Mixed with one baseline reserved. Previously the
removed D1 penalty totalled 2, below the Mixed threshold, so the engine derived
Expansion from absent evidence while the saved recommendation said Mixed.

**D3 — Promotion respects a fixed 2-day gap, not the elapsed interval.**
`MIN_PROMOTION_GAP_DAYS = 2` permits greens two days apart to climb to the 30-day
rung. The agreed rule is that each scheduled interval must actually elapse, and
`stable` requires a genuine 30-day delayed pass. *Scheduled: Task 2.*

**D4 — Eligibility is not applied to the spacing ladder.**
`anchorStatus` builds `coldTests` from any `mode: 'cold'` entry, so
`ladderPosition` can promote on an assisted or repeat attempt that
`isEligibleColdTest` rejects. The gate and the ladder can therefore disagree
about the same record. *Scheduled: Task 2.*

**D5 — Policy compatibility is compared to the wrong constant.**
`forecastValidity` in `src/utils/coaching.js` compares a decision's policy
version against `DECISION_VERSION` (the document-format constant). These are
unrelated concepts. *Scheduled: Task 2.*

**D6 — Capacity does not account for completed work.**
Completing a baseline can surface another unmeasured anchor rather than
returning a finished state. *Scheduled: Task 2.*

## Rules that must not be changed by a recommendation

A coaching decision is advice. It cannot:

- create, edit or delete practice attempts
- clear an unresolved failure
- advance a spacing stage or move a due date
- promote topic health
- redefine any threshold above

Those are code changes, made deliberately and tested. A decision file that
implies otherwise is rejected rather than honoured.
