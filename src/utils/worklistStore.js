const ENDPOINT = '/api/coaching/worklist'

/** The accepted worklist: `{ version, manifest, source }`, or null before the first accept. */
export async function loadAccepted() {
  try {
    const res = await fetch(ENDPOINT)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    return { accepted: body.accepted || null, available: true }
  } catch (e) {
    return { accepted: null, available: false, error: e.message }
  }
}

/**
 * Stores exactly the snapshot that was reviewed. The server rejects it if the
 * content no longer matches the reviewed hash.
 */
export async function acceptWorklist({ version, manifest, source }) {
  const res = await fetch(ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, manifest, source }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = (body.errors || []).slice(0, 5).join('; ')
    throw new Error([body.error || `HTTP ${res.status}`, detail].filter(Boolean).join(' — '))
  }
  return body.accepted
}
