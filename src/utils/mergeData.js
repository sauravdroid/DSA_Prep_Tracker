const parse = (raw, fallback) => {
  if (raw == null) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const COLLECTION_KEYS = new Set([
  'dsa_problems',
  'dsa_revisions',
  'dsa_failures',
  'dsa_practice_log',
  'dsa_notes',
])

function mergeProblems(a, b) {
  const out = { ...a }
  for (const [slug, incoming] of Object.entries(b)) {
    const prev = out[slug]
    if (!prev) {
      out[slug] = incoming
      continue
    }
    const dates = [prev.dateSolved, incoming.dateSolved].filter(Boolean).sort()
    out[slug] = {
      ...prev,
      ...incoming,
      // Earliest solve wins; failure counts are cumulative so keep the larger.
      dateSolved: dates[0] || null,
      failedCount: Math.max(prev.failedCount || 0, incoming.failedCount || 0),
    }
  }
  return out
}

function unionBy(a, b, keyFn) {
  const seen = new Map()
  for (const item of [...a, ...b]) {
    if (!item) continue
    seen.set(keyFn(item), item)
  }
  return [...seen.values()]
}

function mergeNotes(a, b) {
  const out = { ...a }
  for (const [slug, notes] of Object.entries(b)) {
    out[slug] = unionBy(out[slug] || [], notes || [], n => String(n.ts))
      .sort((x, y) => x.ts - y.ts)
  }
  return out
}

/**
 * Union the collections, and let the newer snapshot win for single-value
 * settings. Nothing is ever dropped from either side.
 */
export function mergeTrackerData(local, remote, { localSavedAt, remoteSavedAt } = {}) {
  const localIsEmpty = Object.keys(local || {}).length === 0
  const remoteIsNewer = localIsEmpty || (!!remoteSavedAt && (!localSavedAt || remoteSavedAt > localSavedAt))
  const merged = { ...local }
  const summary = { problemsAdded: 0, revisionsAdded: 0, failuresAdded: 0, attemptsAdded: 0, settingsFrom: remoteIsNewer ? 'remote' : 'local' }

  const beforeProblems = Object.keys(parse(local.dsa_problems, {})).length
  const beforeRevisions = parse(local.dsa_revisions, []).length
  const beforeFailures = parse(local.dsa_failures, []).length
  const beforeAttempts = parse(local.dsa_practice_log, []).length

  for (const key of Object.keys({ ...local, ...remote })) {
    if (!COLLECTION_KEYS.has(key)) {
      const pick = remoteIsNewer ? (remote[key] ?? local[key]) : (local[key] ?? remote[key])
      if (pick != null) merged[key] = pick
      continue
    }

    switch (key) {
      case 'dsa_problems':
        merged[key] = JSON.stringify(
          mergeProblems(parse(local[key], {}), parse(remote[key], {}))
        )
        break
      case 'dsa_revisions':
        merged[key] = JSON.stringify(
          unionBy(parse(local[key], []), parse(remote[key], []), r => `${r.slug}|${r.date}`)
            .sort((x, y) => x.date.localeCompare(y.date))
        )
        break
      case 'dsa_failures':
        merged[key] = JSON.stringify(
          unionBy(parse(local[key], []), parse(remote[key], []), f => `${f.slug}|${f.ts}`)
            .sort((x, y) => x.ts - y.ts)
        )
        break
      case 'dsa_practice_log':
        merged[key] = JSON.stringify(
          unionBy(parse(local[key], []), parse(remote[key], []), e => e.id || `${e.slug}|${e.date}|${e.result}`)
            .sort((x, y) => x.date.localeCompare(y.date))
        )
        break
      case 'dsa_notes':
        merged[key] = JSON.stringify(mergeNotes(parse(local[key], {}), parse(remote[key], {})))
        break
      default:
        break
    }
  }

  summary.problemsAdded = Object.keys(parse(merged.dsa_problems, {})).length - beforeProblems
  summary.revisionsAdded = parse(merged.dsa_revisions, []).length - beforeRevisions
  summary.failuresAdded = parse(merged.dsa_failures, []).length - beforeFailures
  summary.attemptsAdded = parse(merged.dsa_practice_log, []).length - beforeAttempts

  return { merged, summary }
}

/**
 * Latest LeetCode activity present, used to resume the submission sync.
 * Graded attempts are excluded — they are self-reported, not submissions.
 */
export function latestActivityDate(data) {
  let latest = ''
  for (const p of Object.values(parse(data.dsa_problems, {}))) {
    if (p.dateSolved && p.dateSolved > latest) latest = p.dateSolved
  }
  for (const r of parse(data.dsa_revisions, [])) {
    if (r.date && r.date > latest) latest = r.date
  }
  for (const f of parse(data.dsa_failures, [])) {
    if (f.date && f.date > latest) latest = f.date
  }
  return latest || null
}
