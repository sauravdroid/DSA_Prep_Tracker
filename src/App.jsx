import { useState, useCallback, useMemo, useEffect } from 'react'
import ProblemsPage from './components/ProblemsPage'
import CalendarView from './components/CalendarView'
import DailyRevisions from './components/DailyRevisions'
import ProblemModal from './components/ProblemModal'
import SyncSettings from './components/SyncSettings'
import StudyPlanCalendar from './components/StudyPlanCalendar'
import StatsPage from './components/StatsPage'
import RecursionVisualizer from './components/RecursionVisualizer'
import DebtPage from './components/DebtPage'
import SyncNotesPanel from './components/SyncNotesPanel'
import ColdTestModal from './components/ColdTestModal'
import SyncDock from './components/SyncDock'
import { syncToday, syncProblems } from './services/leetcode'
import { backupIfConnected } from './utils/github'
import { startAutoSync } from './utils/autoSync'
import { computeRetention } from './utils/retention'
import { todayStr } from './utils/dateUtils'
import * as store from './store'

// Study Plan and Today's Revision are intentionally not navigable while the
// coaching page owns daily planning; their components are still wired below.
const TABS = ['Calendar', 'Problems', 'Debt', 'Stats', 'Recursion', 'Settings']

export default function App() {
  const [tab, setTab] = useState('Calendar')
  const [problems, setProblems] = useState(store.getProblems())
  const [revisions, setRevisions] = useState(store.getRevisions())
  const [failures, setFailures] = useState(store.getFailures())
  const [selectedProblem, setSelectedProblem] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [syncedItems, setSyncedItems] = useState([])
  const [grading, setGrading] = useState(null)
  const [practiceLog, setPracticeLog] = useState(() => store.getPracticeLog())

  const reload = useCallback(() => {
    setProblems(store.getProblems())
    setRevisions(store.getRevisions())
    setFailures(store.getFailures())
    setPracticeLog(store.getPracticeLog())
  }, [])

  const handleRevise = useCallback(slug => {
    store.addRevision(slug)
    setRevisions(store.getRevisions())
  }, [])
  const handleRemoveRevision = useCallback((slug, date) => {
    store.removeRevision(slug, date)
    setRevisions(store.getRevisions())
  }, [])

  useEffect(() => startAutoSync({ onChanged: reload }), [reload])

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
      setFailures(store.getFailures())
      if (resubmissions.length > 0) setRevisions(store.getRevisions())
      setSyncMsg(`Synced ${results.length} problem${results.length !== 1 ? 's' : ''}, ${resubmissions.length} revision${resubmissions.length !== 1 ? 's' : ''}`)

      // Offer a note while the attempt is still fresh.
      const seen = new Set()
      const items = []
      for (const p of results) {
        if (seen.has(p.slug)) continue
        seen.add(p.slug)
        items.push({ slug: p.slug, title: p.title, type: 'new' })
      }
      const all = store.getProblems()
      for (const r of resubmissions) {
        if (seen.has(r.slug)) continue
        seen.add(r.slug)
        items.push({ slug: r.slug, title: all[r.slug]?.title || r.slug, type: 'revision' })
      }
      if (items.length > 0) setSyncedItems(items)

      // Back up too, so the published tracker the coach reads cannot quietly
      // fall behind. A failure here must not look like a failed sync: the work
      // is already saved locally.
      if (results.length > 0 || resubmissions.length > 0 || failures.length > 0) {
        try {
          setSyncMsg(m => `${m} · backing up…`)
          const r = await backupIfConnected()
          setSyncMsg(m => {
            const base = m.replace(' · backing up…', '')
            if (r.skipped) return base
            return `${base} · backed up${r.committed ? ` (${r.committed})` : ''}`
          })
        } catch (e) {
          setSyncMsg(m => `${m.replace(' · backing up…', '')} · backup failed: ${e.message}`)
        }
      }
    } catch (err) {
      setSyncMsg('Sync failed: ' + err.message)
    }
    setSyncing(false)
    setTimeout(() => setSyncMsg(''), 6000)
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

  const debtSummary = useMemo(
    () => {
      const r = computeRetention({
        problems,
        revisions,
        log: practiceLog,
        anchorOverrides: store.getAnchors(),
        topicRoles: store.getTopicRoles(),
        today: todayStr(),
      })
      return { totalDebt: r.totalDebt, calculable: r.debtCalculable }
    },
    [problems, revisions, practiceLog, tab]
  )

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
              {t === 'Debt' && debtSummary.calculable && debtSummary.totalDebt > 0 && (
                <span className={`tab-badge debt ${debtSummary.totalDebt >= 6 ? 'critical' : debtSummary.totalDebt >= 3 ? 'warn' : ''}`}>
                  {debtSummary.totalDebt}
                </span>
              )}
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
          />
        )}
        {tab === 'Calendar' && (
          <CalendarView
            problems={problems}
            revisions={revisions}
            failures={failures}
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
        {tab === 'Debt' && (
          <DebtPage
            problems={problems}
            revisions={revisions}
            onChanged={reload}
          />
        )}
        {tab === 'Recursion' && <RecursionVisualizer />}
        {tab === 'Settings' && <SyncSettings onSyncComplete={reload} />}
      </main>

      <ProblemModal
        problem={selectedProblem}
        revisions={revisions}
        onClose={() => setSelectedProblem(null)}
      />

      <SyncDock />

      {syncedItems.length > 0 && (
        <SyncNotesPanel
          items={syncedItems}
          onClose={() => setSyncedItems([])}
          onGrade={slug => setGrading(slug)}
        />
      )}

      {grading && (
        <ColdTestModal
          slug={grading}
          problem={problems[grading]}
          defaultMode="warm"
          existing={store.practiceEntryFor(grading)}
          onClose={() => setGrading(null)}
          onSave={entry => {
            setPracticeLog(store.recordAttempt(entry))
            setGrading(null)
            setSyncMsg('Recorded · publishing…')
            backupIfConnected()
              .then(r => setSyncMsg(r.skipped
                ? 'Recorded'
                : `Recorded · published${r.committed ? ` (${r.committed})` : ''}`))
              .catch(e => setSyncMsg(`Recorded and saved locally, but publishing failed: ${e.message}`))
              .finally(() => setTimeout(() => setSyncMsg(''), 6000))
          }}
        />
      )}
    </div>
  )
}
