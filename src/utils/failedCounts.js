/**
 * A problem's failedCount is its lifetime number of non-Accepted submissions.
 * A sync only sees its own date window, so the deduplicated failure log is the
 * reliable source: raise each count to what the log records, and never lower
 * it, since counts from before the log began can be larger.
 * Returns the same object when nothing changed.
 */
export function reconcileFailedCounts(problems, failures) {
  const logged = {}
  for (const f of failures || []) {
    if (f?.slug) logged[f.slug] = (logged[f.slug] || 0) + 1
  }
  let out = problems
  for (const [slug, p] of Object.entries(problems || {})) {
    const count = logged[slug] || 0
    if (count > (p.failedCount || 0)) {
      if (out === problems) out = { ...problems }
      out[slug] = { ...p, failedCount: count }
    }
  }
  return out
}
