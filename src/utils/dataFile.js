const ENDPOINT = '/api/data'
const PREFIX = 'dsa_'
const DEBOUNCE_MS = 500

// The LeetCode session cookie is a credential — it stays in the browser rather
// than being written to a file that other tools can read.
const EXCLUDED_KEYS = new Set(['dsa_session'])

let state = { status: 'idle', savedAt: null, path: null, error: null, keys: 0 }
const listeners = new Set()
let timer = null
let inFlight = false
let dirty = false
// Version of the file this tab last saw; guards against clobbering another profile.
let baseSavedAt = null

export function subscribe(fn) {
  listeners.add(fn)
  fn(state)
  return () => listeners.delete(fn)
}

function set(patch) {
  state = { ...state, ...patch }
  for (const fn of listeners) fn(state)
}

export function getSyncState() {
  return state
}

function snapshot() {
  const out = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(PREFIX) && !EXCLUDED_KEYS.has(key)) {
      out[key] = localStorage.getItem(key)
    }
  }
  return out
}

export function snapshotLocal() {
  return snapshot()
}

/** Replace the tracker keys wholesale, leaving excluded keys (the cookie) alone. */
export function applySnapshot(data) {
  for (const key of Object.keys(snapshot())) {
    if (!(key in data)) localStorage.removeItem(key)
  }
  for (const [key, value] of Object.entries(data)) {
    if (EXCLUDED_KEYS.has(key)) continue
    localStorage.setItem(key, value)
  }
}

export async function saveNow({ force = false } = {}) {
  if (state.status === 'unavailable') return state
  if (inFlight) {
    dirty = true
    return state
  }
  inFlight = true
  set({ status: 'saving', error: null })
  try {
    const res = await fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: snapshot(), baseSavedAt, force }),
    })

    if (res.status === 409) {
      const body = await res.json()
      set({
        status: 'conflict',
        savedAt: body.savedAt,
        path: body.path,
        error: 'Another profile or tab wrote this file. Reload from disk before saving.',
      })
      return state
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    baseSavedAt = body.savedAt
    set({ status: 'saved', savedAt: body.savedAt, path: body.path, keys: body.keys, error: null })
  } catch (e) {
    set({ status: 'error', error: e.message })
  } finally {
    inFlight = false
    if (dirty) {
      dirty = false
      scheduleSave()
    }
  }
  return state
}

export function scheduleSave() {
  if (state.status === 'unavailable' || state.status === 'conflict') return
  clearTimeout(timer)
  timer = setTimeout(saveNow, DEBOUNCE_MS)
}

/**
 * The file is the source of truth. If it is empty but the browser has data,
 * the browser copy seeds it — that keeps an existing profile from being wiped
 * the first time this runs.
 */
export async function hydrateFromDisk() {
  let body
  try {
    const res = await fetch(ENDPOINT)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    body = await res.json()
  } catch (e) {
    // No dev server middleware (e.g. a static build) — fall back to localStorage only.
    set({ status: 'unavailable', error: e.message })
    return { mode: 'unavailable' }
  }

  const data = body.data || {}
  const fileKeys = Object.keys(data)
  const localKeys = Object.keys(snapshot())
  baseSavedAt = body.savedAt || null

  if (fileKeys.length === 0) {
    set({ status: 'idle', savedAt: body.savedAt, path: body.path })
    if (localKeys.length > 0) {
      await saveNow()
      return { mode: 'seeded', keys: localKeys.length }
    }
    return { mode: 'empty' }
  }

  for (const key of localKeys) {
    if (!(key in data)) localStorage.removeItem(key)
  }
  for (const [key, value] of Object.entries(data)) {
    localStorage.setItem(key, value)
  }

  set({ status: 'saved', savedAt: body.savedAt, path: body.path, keys: fileKeys.length })
  return { mode: 'loaded', keys: fileKeys.length }
}

export async function reloadFromDisk() {
  const result = await hydrateFromDisk()
  if (result.mode === 'loaded' || result.mode === 'empty') window.location.reload()
  return result
}
