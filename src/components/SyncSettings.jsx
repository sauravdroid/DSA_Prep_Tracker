import { useState, useEffect } from 'react'
import { syncProblems } from '../services/leetcode'
import { subscribe, saveNow, reloadFromDisk } from '../utils/dataFile'
import { githubStatus, saveToken, pullFromGithub, pushToGithub, getRepo, setRepo } from '../utils/github'
import * as store from '../store'

// Overlap by a day so a timezone boundary can't drop a submission.
function stepBackOneDay(dateStr) {
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

const STATUS_STYLE = {
  idle: 'bg-slate-100 text-slate-600',
  saving: 'bg-sky-100 text-sky-700',
  saved: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700',
  conflict: 'bg-amber-100 text-amber-800',
  unavailable: 'bg-amber-100 text-amber-800',
}

function DataFilePanel() {
  const [sync, setSync] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribe(setSync), [])
  if (!sync) return null

  const unavailable = sync.status === 'unavailable'

  return (
    <div className="tw mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Data file</h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[sync.status]}`}>
          {sync.status}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-500">
        {unavailable
          ? 'No dev server behind this page, so data is only in this browser. Run npm run dev to persist to disk.'
          : 'Your tracker data is mirrored to a file on disk, so it survives this browser profile and can be read by other tools.'}
      </p>

      {sync.path && (
        <code className="mt-3 block overflow-x-auto rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">
          {sync.path}
        </code>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {sync.savedAt && <span>Last written {new Date(sync.savedAt).toLocaleString()}</span>}
        {sync.keys > 0 && <span>{sync.keys} keys</span>}
        {sync.error && <span className="text-rose-600">{sync.error}</span>}
      </div>

      {!unavailable && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); await saveNow(); setBusy(false) }}
            className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:bg-slate-300"
          >
            Save now
          </button>
          <button
            disabled={busy}
            onClick={async () => { setBusy(true); await reloadFromDisk() }}
            className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Reload from disk
          </button>
          {sync.status === 'conflict' && (
            <button
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Overwrite the file with this browser\u2019s data? The other profile\u2019s changes will be replaced (a .bak copy is kept).')) return
                setBusy(true)
                await saveNow({ force: true })
                setBusy(false)
              }}
              className="rounded-lg border border-rose-200 px-4 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
            >
              Overwrite anyway
            </button>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-400">
        The LeetCode session cookie is deliberately excluded from this file and stays in the browser.
      </p>
    </div>
  )
}

function GithubPanel({ onChanged, onResume }) {  const [status, setStatus] = useState(null)
  const [repo, setRepoState] = useState(getRepo())
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { githubStatus().then(setStatus).catch(e => setError(e.message)) }, [])

  const run = async (label, fn) => {
    setBusy(label); setMsg(''); setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  const handlePull = () => run('pull', async () => {
    const result = await pullFromGithub()
    if (result.empty) {
      setMsg('Cloud copy is empty. Push first to create it.')
      return
    }
    const s = result.summary
    setMsg(
      `Merged from GitHub: +${s.problemsAdded} problems, +${s.revisionsAdded} revisions, ` +
      `+${s.attemptsAdded} graded attempts. Settings taken from ${s.settingsFrom}.`
    )
    onResume?.(result.resumeFrom)
    onChanged?.()
  })

  const handlePush = () => run('push', async () => {
    const r = await pushToGithub()
    setMsg(`Pushed ${(r.bytes / 1024).toFixed(0)} KB${r.committed ? ` (commit ${r.committed})` : ''}.`)
  })

  const handleToken = () => run('token', async () => {
    await saveToken(token)
    setToken('')
    setStatus(await githubStatus())
    setMsg('Token saved to .github-token (gitignored).')
  })

  return (
    <div className="tw mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-900">GitHub backup</h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          status?.hasToken ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
        }`}>
          {status?.hasToken ? `token from ${status.tokenSource}` : 'no token'}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-500">
        Keeps a copy in your repo so any machine can pick up where the last one left off.
        Pulling merges rather than replaces, so no history is lost either way.
      </p>

      <label className="mt-4 block">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">Repository</span>
        <div className="mt-1.5 flex gap-2">
          <input
            value={repo}
            onChange={e => setRepoState(e.target.value)}
            onBlur={() => setRepo(repo)}
            placeholder="owner/name"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
          />
        </div>
      </label>

      {!status?.hasToken && (
        <label className="mt-3 block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Personal access token
          </span>
          <div className="mt-1.5 flex gap-2">
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="github_pat_..."
              autoComplete="off"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-900/5"
            />
            <button
              onClick={handleToken}
              disabled={!token.trim() || busy === 'token'}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:bg-slate-300"
            >
              Save
            </button>
          </div>
          <span className="mt-1 block text-xs text-slate-400">
            Needs <code className="rounded bg-slate-100 px-1">Contents: read and write</code> on that repo only.
            Stored in .github-token and never sent to the browser again.
          </span>
        </label>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={handlePull}
          disabled={!status?.hasToken || !!busy}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:bg-slate-300"
        >
          {busy === 'pull' ? 'Pulling...' : 'Pull all data from GitHub'}
        </button>
        <button
          onClick={handlePush}
          disabled={!status?.hasToken || !!busy}
          className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === 'push' ? 'Pushing...' : 'Push to GitHub'}
        </button>
      </div>

      {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900 ring-1 ring-emerald-200/60">{msg}</p>}
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-900 ring-1 ring-rose-200/60">{error}</p>}
    </div>
  )
}

export default function SyncSettings({ onSyncComplete }) {
  const [session, setSession] = useState(store.getSession())
  const [startDate, setStartDate] = useState(store.getStartDate())
  const [status, setStatus] = useState('')
  const [syncing, setSyncing] = useState(false)

  const lastSync = store.getLastSync()

  const handleSync = async () => {
    if (!session.trim()) {
      setStatus('Please enter your LEETCODE_SESSION cookie.')
      return
    }
    store.saveSession(session.trim())
    store.saveStartDate(startDate)
    setSyncing(true)
    setStatus('Starting sync...')
    try {
      // Pull the cloud copy first, then resume LeetCode from wherever it ends.
      let resumeFrom = null
      let cloudNote = ''
      const gh = await githubStatus().catch(() => null)
      if (gh?.hasToken) {
        setStatus('Pulling from GitHub...')
        try {
          const pulled = await pullFromGithub()
          if (!pulled.empty) {
            resumeFrom = pulled.resumeFrom
            cloudNote = ` Merged +${pulled.summary.problemsAdded} problems from GitHub.`
          }
        } catch (e) {
          cloudNote = ` (GitHub pull failed: ${e.message})`
        }
      }

      const syncFrom = resumeFrom ? stepBackOneDay(resumeFrom) : store.getLastSync() || startDate
      setStatus(`Fetching LeetCode submissions since ${String(syncFrom).slice(0, 10)}...`)
      const { results: problems, resubmissions, failures } = await syncProblems(session.trim(), syncFrom, setStatus, store.getProblems())
      const merged = store.mergeProblems(problems)
      for (const r of resubmissions) {
        store.addRevision(r.slug, r.date)
      }
      store.addFailures(failures)

      let pushNote = ''
      if (gh?.hasToken) {
        setStatus('Pushing to GitHub...')
        try {
          await saveNow({ force: true })
          const pushed = await pushToGithub()
          pushNote = pushed.committed ? ` Pushed (commit ${pushed.committed}).` : ' Pushed to GitHub.'
        } catch (e) {
          pushNote = ` (GitHub push failed: ${e.message})`
        }
      }

      setStatus(`Sync complete! ${Object.keys(merged).length} problems, ${resubmissions.length} re-submissions.${cloudNote}${pushNote}`)
      onSyncComplete()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleClear = async () => {
    if (window.confirm('Clear all local data? This also clears the data file on disk (a .bak copy is kept).')) {
      localStorage.clear()
      await saveNow()
      setSession('')
      setStatus('All data cleared.')
      onSyncComplete()
    }
  }

  return (
    <div className="sync-page">
      <h2>Sync Settings</h2>

      <div className="form-group">
        <label htmlFor="session">LEETCODE_SESSION Cookie</label>
        <textarea
          id="session"
          value={session}
          onChange={e => setSession(e.target.value)}
          placeholder="Paste your LEETCODE_SESSION cookie value here..."
          rows={3}
          className="session-input"
        />
        <p className="help-text">
          Open DevTools (F12) → Application → Cookies → leetcode.com → LEETCODE_SESSION
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="startDate">Sync From Date</label>
        <input
          id="startDate"
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          className="date-input"
        />
      </div>

      <div className="form-actions">
        <button onClick={handleSync} disabled={syncing} className="sync-btn">
          {syncing ? 'Syncing...' : 'Sync from LeetCode'}
        </button>
        <button onClick={handleClear} className="clear-btn" disabled={syncing}>
          Clear All Data
        </button>
      </div>

      {status && <div className="sync-status">{status}</div>}
      {lastSync && <p className="last-sync">Last synced: {new Date(lastSync).toLocaleString()}</p>}

      <DataFilePanel />
      <GithubPanel onChanged={onSyncComplete} />
    </div>
  )
}
