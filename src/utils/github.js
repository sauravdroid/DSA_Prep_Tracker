import { mergeTrackerData, latestActivityDate } from './mergeData'
import { snapshotLocal, applySnapshot, saveNow, getSyncState } from './dataFile'

const BASE = '/api/github'
const DEFAULT_REPO = 'sauravdroid/dsa-leetcode-storage'
const REPO_KEY = 'dsa_github_repo'

export function getRepo() {
  return localStorage.getItem(REPO_KEY) || DEFAULT_REPO
}

export function setRepo(repo) {
  localStorage.setItem(REPO_KEY, repo.trim())
}

async function call(path, body) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

export function githubStatus() {
  return call('/status')
}

export function saveToken(token) {
  return call('/token', { token })
}

/**
 * Pull the cloud copy and merge it into local data. Collections are unioned,
 * so neither this machine's nor the remote machine's history is lost.
 */
export async function pullFromGithub() {
  const remote = await call('/pull', { repo: getRepo() })
  if (remote.empty) return { empty: true, summary: null }

  const local = snapshotLocal()
  const { merged, summary } = mergeTrackerData(local, remote.data, {
    localSavedAt: getSyncState().savedAt,
    remoteSavedAt: remote.savedAt,
  })

  applySnapshot(merged)
  await saveNow({ force: true })

  return {
    empty: false,
    summary,
    remoteSavedAt: remote.savedAt,
    resumeFrom: latestActivityDate(merged),
  }
}

export function pushToGithub() {
  return call('/push', { repo: getRepo() })
}

/**
 * Publish the tracker after evidence changed, so the coach never authors advice
 * against facts that have moved. Not being connected is a configuration choice,
 * not a failure, so it reports `skipped` rather than throwing.
 */
export async function backupIfConnected() {
  const gh = await githubStatus()
  if (!gh?.hasToken) return { skipped: true }
  await saveNow({ force: true })
  const pushed = await pushToGithub()
  return { skipped: false, committed: pushed.committed, bytes: pushed.bytes }
}

/**
 * Whether the remote tracker is behind local work, and what is missing.
 * Compared server-side so this stays a small response rather than the whole
 * tracker file.
 */
export function remoteStatus() {
  return call('/remote-status', { repo: getRepo() })
}

/* ---------- Coaching advice ---------- */

/**
 * Fetch the coach's current decision. Read-only and entirely separate from
 * tracker sync: this can never write practice facts, and a tracker push can
 * never overwrite advice.
 *
 * Returns the decision alongside its validation result, source commit and any
 * files the authoring commit touched outside `coaching/`. Adoption is a second,
 * explicit step — see `saveDecision` in coaching.js.
 */
export function pullCoaching(ref) {
  return call('/coaching/pull', { repo: getRepo(), ...(ref ? { ref } : {}) })
}

/** One earlier revision, retrieved at its commit SHA. */
export function coachingAtRef(ref) {
  return call('/coaching/at', { repo: getRepo(), ref })
}

/** Published decision history: commits that touched the coaching path. */
export function coachingHistory() {
  return call('/coaching/history', { repo: getRepo() })
}
