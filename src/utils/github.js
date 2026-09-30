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
