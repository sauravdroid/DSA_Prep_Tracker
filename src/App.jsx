import { useState, useCallback } from 'react'
import ProblemsPage from './components/ProblemsPage'
import CalendarView from './components/CalendarView'
import DailyRevisions from './components/DailyRevisions'
import ProblemModal from './components/ProblemModal'
import SyncSettings from './components/SyncSettings'
import StudyPlanCalendar from './components/StudyPlanCalendar'
import StatsPage from './components/StatsPage'
import RecursionVisualizer from './components/RecursionVisualizer'
import { syncToday, syncProblems } from './services/leetcode'
import * as store from './store'

const TABS = ['Calendar', 'Study Plan', "Today's Revision", 'Problems', 'Stats', 'Recursion', 'Settings']

export default function App() {
  const [tab, setTab] = useState('Calendar')
  const [problems, setProblems] = useState(store.getProblems())
  const [revisions, setRevisions] = useState(store.getRevisions())
  const [selectedProblem, setSelectedProblem] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const reload = useCallback(() => {
    setProblems(store.getProblems())
    setRevisions(store.getRevisions())
  }, [])

  const handleRevise = useCallback(slug => {
    store.addRevision(slug)
    setRevisions(store.getRevisions())
  }, [])

  const handleRemoveRevision = useCallback((slug, date) => {
    store.removeRevision(slug, date)
    setRevisions(store.getRevisions())
  }, [])

  const runSync = useCallback(async fetcher => {
    const session = store.getSession()
    if (!session) {
      setSyncMsg('Set your session cookie in Settings first.')
      setTimeout(() => setSyncMsg(''), 3000)
      return
    }
    setSyncing(true)
    setSyncMsg('Syncing...')
    try {
      const { results, resubmissions, failures } = await fetcher(session)
      if (results.length > 0) {
        const merged = store.mergeProblems(results)
        setProblems(merged)
      }
      for (const r of resubmissions) {
        store.addRevision(r.slug, r.date)
      }
      store.addFailures(failures)
      if (resubmissions.length > 0) setRevisions(store.getRevisions())
      setSyncMsg(`Synced ${results.length} problem${results.length !== 1 ? 's' : ''}, ${resubmissions.length} revision${resubmissions.length !== 1 ? 's' : ''}`)
    } catch (err) {
      setSyncMsg('Sync failed: ' + err.message)
    }
    setSyncing(false)
    setTimeout(() => setSyncMsg(''), 4000)
  }, [])

  const handleQuickSync = useCallback(
    () => runSync(session => syncToday(session, msg => setSyncMsg(msg), store.getProblems(), store.getLastSync())),
    [runSync]
  )

  const handleSyncMonth = useCallback(
    monthStartDate => runSync(session => syncProblems(session, monthStartDate, msg => setSyncMsg(msg), store.getProblems())),
    [runSync]
  )

  const count = Object.keys(problems).length

  return (
    <div className="app">
      <header className="app-header">
        <nav className="tabs">
          {TABS.map(t => (
            <button
              key={t}
              className={`tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
              {t === 'Problems' && count > 0 && <span className="tab-badge">{count}</span>}
            </button>
          ))}
          <div className="quick-sync">
            <button
              className="quick-sync-btn"
              onClick={handleQuickSync}
              disabled={syncing}
            >
              {syncing ? '⟳ Syncing...' : '⟳ Sync Today'}
            </button>
            {syncMsg && <span className="quick-sync-msg">{syncMsg}</span>}
          </div>
        </nav>
      </header>

      <main className="app-main">
        {tab === 'Problems' && (
          <ProblemsPage
            problems={problems}
            revisions={revisions}
            onRevise={handleRevise}
          />
        )}
        {tab === 'Calendar' && (
          <CalendarView
            problems={problems}
            revisions={revisions}
            onRevise={handleRevise}
            onRemoveRevision={handleRemoveRevision}
            onSyncMonth={handleSyncMonth}
            syncing={syncing}
          />
        )}
        {tab === "Today's Revision" && (
          <DailyRevisions
            problems={problems}
            revisions={revisions}
            onSelectProblem={setSelectedProblem}
            onRevise={handleRevise}
          />
        )}
        {tab === 'Study Plan' && (
          <StudyPlanCalendar
            problems={problems}
            revisions={revisions}
          />
        )}
        {tab === 'Stats' && (
          <StatsPage
            problems={problems}
            revisions={revisions}
          />
        )}
        {tab === 'Recursion' && <RecursionVisualizer />}
        {tab === 'Settings' && <SyncSettings onSyncComplete={reload} />}
      </main>

      <ProblemModal
        problem={selectedProblem}
        revisions={revisions}
        onClose={() => setSelectedProblem(null)}
        onRevise={handleRevise}
      />
    </div>
  )
}
