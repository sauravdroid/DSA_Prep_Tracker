/**
 * Comparing two tracker snapshots for facts rather than bytes.
 *
 * Each stored value is a JSON string, and the order inside it is incidental —
 * localStorage key order and array order shift whenever data is rehydrated or
 * merged. Comparing the strings reports those shifts as unpublished work, which
 * sends the reader to push a file that holds exactly what is already there.
 */

/** Order-insensitive rendering of a value, so reordering is not a difference. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Whether two stored values hold the same facts. */
export function sameFacts(a, b) {
  if (a === b) return true
  if (typeof a !== 'string' || typeof b !== 'string') return false
  try {
    return canonical(JSON.parse(a)) === canonical(JSON.parse(b))
  } catch {
    // Not JSON — a plain string like a date, where the bytes are the fact.
    return false
  }
}

/** Which keys local holds that the remote does not yet carry. */
export function unpublishedKeys(localData = {}, remoteData = {}) {
  const localKeys = Object.keys(localData)
  const remoteKeys = new Set(Object.keys(remoteData))
  return {
    missing: localKeys.filter(k => !remoteKeys.has(k)),
    changed: localKeys.filter(k => remoteKeys.has(k) && !sameFacts(localData[k], remoteData[k])),
  }
}
