import { useState, useMemo, useCallback } from 'react'
import { getPattern } from '../utils/patterns'
import { todayStr } from '../utils/dateUtils'
import { getAllPlans, getPlanById, getActivePlanId, setActivePlanId } from '../study_plan_data_source'
import { getTodayRevisionList, saveTodayRevisionList } from '../store'

function getPhase(phases, day) {
  return phases.find(p => p.days.includes(day))
}

function slugFromUrl(url) {
  const m = url.match(/\/problems\/([^/]+)/)
  return m ? m[1] : ''
}

export default function StudyPlanCalendar({ problems, revisions }) {
  const today = todayStr()
  const allPlans = getAllPlans()
  const [activePlanId, _setActivePlanId] = useState(() => getActivePlanId())
  const [detailTab, setDetailTab] = useState('new')
  const [selectedProblem, setSelectedProblem] = useState(null)
  const [revListSlugs, setRevListSlugs] = useState(() => getTodayRevisionList().slugs)

  const plan = useMemo(() => getPlanById(activePlanId), [activePlanId])
  const PLAN = plan?.days || []
  const PHASES = plan?.phases || []
  const WEEKS = plan?.weeks || []
  const PLAN_START = plan?.startDate || today

  const isInRevList = useCallback((slug) => revListSlugs.includes(slug), [revListSlugs])

  const toggleRevList = useCallback((slug) => {
    let next
    if (revListSlugs.includes(slug)) {
      next = revListSlugs.filter(s => s !== slug)
    } else {
      next = [...revListSlugs, slug]
    }
    setRevListSlugs(next)
    saveTodayRevisionList(next)
  }, [revListSlugs])

  const switchPlan = (id) => {
    _setActivePlanId(id)
    setActivePlanId(id)
    const p = getPlanById(id)
    if (p) {
      const start = p.startDate
      setSelectedDate(today >= start ? today : start)
    }
  }

  const [selectedDate, setSelectedDate] = useState(today >= PLAN_START ? today : PLAN_START)

  // Map of solved problems from store
  const solvedMap = useMemo(() => problems, [problems])

  // Revision lookup: slug -> [date, ...]
  const revisionsBySlug = useMemo(() => {
    const map = {}
    for (const r of revisions) {
      if (!map[r.slug]) map[r.slug] = []
      map[r.slug].push(r.date)
    }
    return map
  }, [revisions])

  // Auto-detect completion from synced data
  const isNewDone = (p) => {
    const slug = slugFromUrl(p.url)
    return !!solvedMap[slug]
  }

  const isRevDone = (rp) => {
    const dates = revisionsBySlug[rp.slug] || []
    // Count any revision from the day before the plan starts onwards
    const d = new Date(PLAN_START + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    const fromDate = d.toISOString().slice(0, 10)
    return dates.some(dt => dt >= fromDate)
  }

  const selectedDay = PLAN.find(d => d.date === selectedDate)

  // Stats
  const totalNew = PLAN.reduce((s, d) => s + d.newProblems.length, 0)
  const totalRev = PLAN.reduce((s, d) => s + d.revisionProblems.length, 0)
  const totalTimed = PLAN.filter(d => d.timed).length
  const completedNew = PLAN.reduce((s, d) =>
    s + d.newProblems.filter(p => isNewDone(p)).length, 0)
  const completedRev = PLAN.reduce((s, d) =>
    s + d.revisionProblems.filter(rp => isRevDone(rp)).length, 0)

  // Compute progress for each plan (for tab display)
  const planTabs = useMemo(() => {
    return allPlans.map(p => {
      const days = p.days || []
      const planStart = p.startDate
      const cutoff = (() => {
        const dt = new Date(planStart + 'T12:00:00')
        dt.setDate(dt.getDate() - 1)
        return dt.toISOString().slice(0, 10)
      })()
      let doneNew = 0, doneRev = 0
      for (const d of days) {
        doneNew += d.newProblems.filter(np => !!solvedMap[slugFromUrl(np.url)]).length
        doneRev += d.revisionProblems.filter(rp => {
          const dates = revisionsBySlug[rp.slug] || []
          return dates.some(dt => dt >= cutoff)
        }).length
      }
      const total = p.totalNew + p.totalRev
      const done = doneNew + doneRev
      return { ...p, doneNew, doneRev, total, done, complete: total > 0 && done >= total }
    })
  }, [allPlans, solvedMap, revisionsBySlug])

  return (
    <div className="study-plan-page">
      {/* Left: Calendar grid */}
      <div className="sp-calendar">
        {/* Plan tabs */}
        <div className="sp-plan-tabs">
          {planTabs.map(p => {
            const startLabel = new Date(p.startDate + 'T12:00:00').toLocaleDateString('default', { month: 'short', day: 'numeric' })
            const endLabel = new Date(p.endDate + 'T12:00:00').toLocaleDateString('default', { month: 'short', day: 'numeric' })
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
            return (
              <button
                key={p.id}
                className={`sp-plan-tab ${activePlanId === p.id ? 'active' : ''} ${p.complete ? 'complete' : ''}`}
                onClick={() => switchPlan(p.id)}
              >
                <span className="sp-plan-tab-check">{p.complete ? '✓' : '○'}</span>
                <div className="sp-plan-tab-info">
                  <span className="sp-plan-tab-dates">{startLabel} — {endLabel}</span>
                  <span className="sp-plan-tab-title">{p.title}</span>
                </div>
                <span className="sp-plan-tab-pct">{pct}%</span>
              </button>
            )
          })}
        </div>

        <div className="sp-header">
          <div className="sp-stats">
            <span className="sp-stat new-color">{completedNew}/{totalNew} new</span>
            <span className="sp-stat rev-color">{completedRev}/{totalRev} revisions</span>
            <span className="sp-stat timed-color">{totalTimed} timed</span>
          </div>
        </div>

        {plan?.description && (
          <p className="sp-description">{plan.description}</p>
        )}

        {/* Phase legend */}
        <div className="sp-phases">
          {PHASES.map(p => (
            <span key={p.label} className="sp-phase-chip" style={{ borderColor: p.color, color: p.color }}>
              {p.label}
            </span>
          ))}
        </div>

        {/* Render weeks dynamically */}
        {WEEKS.map((week, wi) => {
          const weekDays = PLAN.slice(wi * 7, wi * 7 + 7)
          return (
          <div key={wi}>
            <div className="sp-week-label">{week.label}</div>
            <div className="calendar-grid sp-calendar-grid">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                <div key={d} className="calendar-day-header">{d}</div>
              ))}

              {(() => {
                // pad empty cells before first day of the week
                const firstDate = new Date(weekDays[0].date + 'T12:00:00')
                const startDow = firstDate.getDay()
                const emptyCells = []
                for (let i = 0; i < startDow; i++) {
                  emptyCells.push(<div key={`empty-${wi}-${i}`} className="calendar-cell empty" />)
                }
                return emptyCells
              })()}

              {weekDays.map(day => {
                const phase = getPhase(PHASES, day.day)
                const isSelected = day.date === selectedDate
                const isPast = day.date < today
                const isToday = day.date === today
                const isFuture = day.date > today
                const newDone = day.newProblems.every(p => isNewDone(p))
                const revDone = day.revisionProblems.every(rp => isRevDone(rp))
                const allDone = newDone && revDone
                const dateObj = new Date(day.date + 'T12:00:00')
                const dayNum = dateObj.getDate()

                const newCount = day.newProblems.length
                const revCount = day.revisionProblems.length

                // Build pattern groups like CalendarView
                const patGroups = {}
                for (const p of day.newProblems) {
                  const pat = p.pattern
                  if (!patGroups[pat]) patGroups[pat] = []
                  patGroups[pat].push({ title: p.title, slug: slugFromUrl(p.url), isNew: true, isRev: false })
                }
                for (const rp of day.revisionProblems) {
                  const prob = solvedMap[rp.slug]
                  const pat = prob ? getPattern(prob.tags) : 'Unknown'
                  if (!patGroups[pat]) patGroups[pat] = []
                  patGroups[pat].push({ title: prob?.title || rp.slug, slug: rp.slug, isNew: false, isRev: true })
                }
                const patEntries = Object.entries(patGroups).sort((a, b) => b[1].length - a[1].length)

                return (
                  <button
                    key={day.date}
                    className={`calendar-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} active ${allDone ? 'past-solved sp-done' : ''} ${isPast && !allDone ? 'past-missed' : ''}`}
                    onClick={() => { setSelectedDate(day.date); setSelectedProblem(null) }}
                  >
                    {allDone && <span className="sp-done-check">✓</span>}
                    <span className="day-number">{dayNum}</span>
                    <div className="cell-top-row">
                      <div className="cell-progress">
                        {newCount > 0 && <div className="cell-progress-new" style={{ flex: newCount }}>{newCount} new</div>}
                        {revCount > 0 && <div className="cell-progress-rev" style={{ flex: revCount }}>{revCount} rev</div>}
                      </div>
                    </div>
                    <div className="cell-patterns">
                      {patEntries.map(([pat, items]) => {
                        const patNew = items.filter(p => p.isNew).length
                        const patRev = items.filter(p => p.isRev).length
                        const total = patNew + patRev
                        const newPct = Math.round((patNew / total) * 100)
                        const bg = patNew > 0 && patRev > 0
                          ? `linear-gradient(90deg, rgba(34,197,94,0.18) ${newPct}%, rgba(139,92,246,0.18) ${newPct}%)`
                          : patNew > 0 ? 'rgba(34,197,94,0.15)' : 'rgba(139,92,246,0.15)'
                        return (
                          <span key={pat} className="cell-pat-wrap">
                            <span className="cell-pat" style={{ background: bg }}>
                              <span className="cell-pat-count">{items.length}</span>{pat}
                            </span>
                            <span className="cell-pat-tooltip">
                              {items.map(p => (
                                <span
                                  key={p.slug}
                                  className="tooltip-row clickable"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedDate(day.date)
                                    setDetailTab(p.isNew ? 'new' : 'revised')
                                    const prob = solvedMap[p.slug]
                                    if (p.isNew) {
                                      const planProb = day.newProblems.find(np => slugFromUrl(np.url) === p.slug)
                                      if (planProb) {
                                        setSelectedProblem({
                                          ...(prob || {}),
                                          title: planProb.title,
                                          slug: p.slug,
                                          url: planProb.url,
                                          difficulty: prob?.difficulty || planProb.difficulty,
                                          _pattern: planProb.pattern,
                                          _done: !!prob,
                                          _type: 'new',
                                        })
                                      }
                                    } else {
                                      const rp = day.revisionProblems.find(r => r.slug === p.slug)
                                      if (rp) {
                                        setSelectedProblem({
                                          ...(prob || {}),
                                          title: prob?.title || rp.slug,
                                          slug: rp.slug,
                                          url: prob?.url || `https://leetcode.com/problems/${rp.slug}/`,
                                          difficulty: prob?.difficulty || 'Unknown',
                                          _pattern: prob ? getPattern(prob.tags) : 'Unknown',
                                          _done: isRevDone(rp),
                                          _type: 'revision',
                                          _reason: rp.reason,
                                        })
                                      }
                                    }
                                  }}
                                >
                                  <span className="tooltip-title">{p.title}</span>
                                  <span className="tooltip-tags">
                                    {p.isNew && <span className="tooltip-tag new">new</span>}
                                    {p.isRev && <span className="tooltip-tag rev">rev</span>}
                                  </span>
                                </span>
                              ))}
                            </span>
                          </span>
                        )
                      })}
                      {day.timed && <span className="cell-pat" style={{ background: 'rgba(255,161,22,0.15)' }}>⏱ Timed</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          )
        })}
      </div>

      {/* Right: Day details — reuses CalendarView's panel structure */}
      <div className="cal-middle">
        {selectedDay ? (
          <>
            <div className="cal-panel-header">
              <h3 className="cal-panel-title">
                Day {selectedDay.day} — {new Date(selectedDay.date + 'T12:00:00').toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' })}
              </h3>
              {(() => {
                const phase = getPhase(PHASES, selectedDay.day)
                return phase ? <span className="sp-phase-badge" style={{ background: phase.color }}>{phase.label}</span> : null
              })()}
            </div>

            {selectedDay.timed && (
              <div className="sp-timed-banner">
                ⏱ Timed practice day — solve 1 random medium in 35 min, no hints
              </div>
            )}

            <div className="detail-tabs">
              <button
                className={`detail-tab ${detailTab === 'new' ? 'active' : ''}`}
                onClick={() => { setDetailTab('new'); setSelectedProblem(null) }}
              >
                New
                <span className="detail-tab-count">{selectedDay.newProblems.length}</span>
              </button>
              <button
                className={`detail-tab ${detailTab === 'revised' ? 'active' : ''}`}
                onClick={() => { setDetailTab('revised'); setSelectedProblem(null) }}
              >
                Revision
                <span className="detail-tab-count">{selectedDay.revisionProblems.length}</span>
              </button>
            </div>

            {selectedProblem ? (
              <div className="cal-inline-detail">
                <button className="cal-detail-back" onClick={() => setSelectedProblem(null)}>← Back to list</button>

                <h2 className="inline-detail-title">{selectedProblem.title}</h2>

                <div className="inline-detail-badges">
                  <span className={`difficulty-badge ${selectedProblem.difficulty.toLowerCase()}`}>
                    {selectedProblem.difficulty}
                  </span>
                  <span className="pattern-tag">{selectedProblem._pattern}</span>
                  <span className={`sp-sync-indicator ${selectedProblem._done ? 'synced' : ''}`}>
                    {selectedProblem._done ? '✓ Synced' : selectedProblem._type === 'new' ? '○ Not solved' : '○ Not revised'}
                  </span>
                </div>

                <button
                  className={`sp-rev-list-btn ${isInRevList(selectedProblem.slug) ? 'added' : ''}`}
                  onClick={() => toggleRevList(selectedProblem.slug)}
                >
                  {isInRevList(selectedProblem.slug) ? '− Remove from Revision List' : '+ Add to Revision List'}
                </button>

                <div className="inline-detail-rows">
                  <div className="detail-row">
                    <span className="detail-label">LeetCode Link</span>
                    <a href={selectedProblem.url} target="_blank" rel="noopener noreferrer" className="detail-link">
                      Open on LeetCode ↗
                    </a>
                  </div>

                  {selectedProblem.dateSolved && (
                    <div className="detail-row">
                      <span className="detail-label">First Solved</span>
                      <span>{selectedProblem.dateSolved}</span>
                    </div>
                  )}

                  {selectedProblem.acRate != null && (
                    <div className="detail-row">
                      <span className="detail-label">Acceptance Rate</span>
                      <span>{Math.round(selectedProblem.acRate)}%</span>
                    </div>
                  )}

                  {(selectedProblem.failedCount || 0) > 0 && (
                    <div className="detail-row">
                      <span className="detail-label">Failed Submissions</span>
                      <span className="fail-count">{selectedProblem.failedCount}</span>
                    </div>
                  )}

                  {selectedProblem.tags && (
                    <div className="detail-row">
                      <span className="detail-label">Tags</span>
                      <div className="tags-list">
                        {selectedProblem.tags.map(t => (
                          <span key={t} className="tag-chip">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="detail-row">
                    <span className="detail-label">Times Revised</span>
                    <span>{(revisionsBySlug[selectedProblem.slug] || []).length}</span>
                  </div>
                </div>

                {(revisionsBySlug[selectedProblem.slug] || []).length > 0 && (
                  <div className="revision-history">
                    <h4>Revision History</h4>
                    <div className="revision-list">
                      {(revisionsBySlug[selectedProblem.slug] || []).sort().reverse().map((d, i) => (
                        <span key={i} className="revision-date">{d}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="detail-list" key={detailTab}>
                {detailTab === 'new' && (
                  selectedDay.newProblems.length > 0 ? (
                    <div className="cal-pattern-group">
                      <div className="cal-pattern-header">
                        <span>New Problem</span>
                        <span className="cal-pattern-count">{selectedDay.newProblems.length}</span>
                      </div>
                      {selectedDay.newProblems.map((p, idx) => {
                        const slug = slugFromUrl(p.url)
                        const done = isNewDone(p)
                        const synced = solvedMap[slug]
                        return (
                          <button
                            key={p.url}
                            className="problem-row"
                            onClick={() => setSelectedProblem({
                              ...(synced || {}),
                              title: p.title,
                              slug,
                              url: p.url,
                              difficulty: synced?.difficulty || p.difficulty,
                              _pattern: p.pattern,
                              _done: done,
                              _type: 'new',
                            })}
                          >
                            <span className="problem-row-num">{idx + 1}</span>
                            <span className="problem-title">{p.title}</span>
                            <span className="problem-row-meta">
                              {synced?.acRate != null && <span className="ac-rate">{Math.round(synced.acRate)}%</span>}
                              {(synced?.failedCount || 0) > 0 && <span className="fail-count">✗{synced.failedCount}</span>}
                              <span className={`difficulty-badge ${p.difficulty.toLowerCase()}`}>
                                {p.difficulty}
                              </span>
                              <span className={`sp-sync-indicator ${done ? 'synced' : ''}`}>
                                {done ? '✓' : '○'}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="empty-message">No new problems for this day.</p>
                  )
                )}

                {detailTab === 'revised' && (
                  selectedDay.revisionProblems.length > 0 ? (
                    <div className="cal-pattern-group">
                      <div className="cal-pattern-header">
                        <span>Revision Problem</span>
                        <span className="cal-pattern-count">{selectedDay.revisionProblems.length}</span>
                      </div>
                      {selectedDay.revisionProblems.map((rp, idx) => {
                        const done = isRevDone(rp)
                        const prob = solvedMap[rp.slug]
                        return (
                          <button
                            key={rp.slug}
                            className="problem-row"
                            onClick={() => setSelectedProblem({
                              ...(prob || {}),
                              title: prob?.title || rp.slug,
                              slug: rp.slug,
                              url: prob?.url || `https://leetcode.com/problems/${rp.slug}/`,
                              difficulty: prob?.difficulty || 'Unknown',
                              _pattern: prob ? getPattern(prob.tags) : 'Unknown',
                              _done: done,
                              _type: 'revision',
                              _reason: rp.reason,
                            })}
                          >
                            <span className="problem-row-num">{idx + 1}</span>
                            <span className="problem-title">{prob?.title || rp.slug}</span>
                            <span className="problem-row-meta">
                              {prob?.acRate != null && <span className="ac-rate">{Math.round(prob.acRate)}%</span>}
                              {(prob?.failedCount || 0) > 0 && <span className="fail-count">✗{prob.failedCount}</span>}
                              <span className={`difficulty-badge ${(prob?.difficulty || 'unknown').toLowerCase()}`}>
                                {prob?.difficulty || '?'}
                              </span>
                              <span className={`sp-sync-indicator ${done ? 'synced' : ''}`}>
                                {done ? '✓' : '○'}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="empty-message">No revision problems for this day.</p>
                  )
                )}
              </div>
            )}

            {/* Revision protocol reminder */}
            <div className="sp-protocol">
              <h4>Revision Protocol</h4>
              <ol>
                <li>Recall the pattern (3 min)</li>
                <li>Write algorithm in comments</li>
                <li>Code without old solution</li>
                <li>Compare after finishing</li>
                <li>Mark: ✅ clean · 🟡 hint · 🔴 forgot</li>
              </ol>
            </div>
          </>
        ) : (
          <p className="empty-message">Select a day from the calendar.</p>
        )}
      </div>
    </div>
  )
}
