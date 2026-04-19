import { useState } from 'react'
import { syncProblems } from '../services/leetcode'
import * as store from '../store'

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
      const { results: problems, resubmissions } = await syncProblems(session.trim(), startDate, setStatus)
      const merged = store.mergeProblems(problems)
      // Store re-submissions as revisions
      for (const r of resubmissions) {
        store.addRevision(r.slug, r.date)
      }
      setStatus(`Sync complete! ${Object.keys(merged).length} problems, ${resubmissions.length} re-submissions.`)
      onSyncComplete()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleClear = () => {
    if (window.confirm('Clear all local data? This will remove problems and revision history.')) {
      localStorage.clear()
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
    </div>
  )
}
