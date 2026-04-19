import { useState, useMemo } from 'react'
import { getPattern } from '../utils/patterns'
import { toLocalDateStr, todayStr } from '../utils/dateUtils'
import { getStartDate } from '../store'

function getWeekDates(refDate) {
  const d = new Date(refDate)
  const day = d.getDay()
  const sun = new Date(d)
  sun.setDate(d.getDate() - day)
  const dates = []
  for (let i = 0; i < 7; i++) {
    const dt = new Date(sun)
    dt.setDate(sun.getDate() + i)
    dates.push(toLocalDateStr(dt))
  }
  return dates
}

export default function CalendarView({ problems, revisions, onRevise, onRemoveRevision }) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [detailTab, setDetailTab] = useState('new')
  const [selectedProblem, setSelectedProblem] = useState(null)
  const [calView, setCalView] = useState('week')
  const [weekDrillDate, setWeekDrillDate] = useState(null) // date string for drill-down
  const [weekDrillDir, setWeekDrillDir] = useState(null) // 'open' | 'close'

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })

  const problemsByDate = {}
  const revisionsByDate = {}

  const problemList = Object.values(problems)
  for (const p of problemList) {
    if (!problemsByDate[p.dateSolved]) problemsByDate[p.dateSolved] = []
    problemsByDate[p.dateSolved].push(p)
  }
  for (const r of revisions) {
    if (!revisionsByDate[r.date]) revisionsByDate[r.date] = []
    revisionsByDate[r.date].push(r)
  }

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1))

  const prevWeek = () => {
    const d = new Date(currentDate)
    d.setDate(d.getDate() - 7)
    setCurrentDate(d)
  }
  const nextWeek = () => {
    const d = new Date(currentDate)
    d.setDate(d.getDate() + 7)
    setCurrentDate(d)
  }

  const toDateStr = day => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const today = todayStr()
  const startDate = getStartDate()

  const days = []
  for (let i = 0; i < firstDay; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)

  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate])
  const weekLabel = `${weekDates[0]} — ${weekDates[6]}`

  // weekly summary
  const weekNewTotal = weekDates.reduce((s, d) => s + (problemsByDate[d] || []).length, 0)
  const weekRevTotal = weekDates.reduce((s, d) => s + (revisionsByDate[d] || []).length, 0)

  const selectedNewProblems = selectedDate ? (problemsByDate[selectedDate] || []) : []
  const selectedRevisions = selectedDate ? (revisionsByDate[selectedDate] || []) : []
  const selectedRevisionProblems = selectedRevisions.map(r => problems[r.slug]).filter(Boolean)

  // Group a list of problems by pattern
  function groupByPattern(list) {
    const groups = {}
    for (const p of list) {
      const pat = getPattern(p.tags)
      if (!groups[pat]) groups[pat] = []
      groups[pat].push(p)
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  }

  const groupedNew = useMemo(() => groupByPattern(selectedNewProblems), [selectedNewProblems])
  const groupedRevised = useMemo(() => groupByPattern(selectedRevisionProblems), [selectedRevisionProblems])

  // Week drill-down data
  const drillData = useMemo(() => {
    if (!weekDrillDate) return null
    const newProbs = problemsByDate[weekDrillDate] || []
    const revProbs = (revisionsByDate[weekDrillDate] || []).map(r => problems[r.slug]).filter(Boolean)
    const allProbs = [...newProbs]
    const revSlugs = new Set(revProbs.map(p => p.slug))
    for (const p of revProbs) {
      if (!allProbs.some(x => x.slug === p.slug)) allProbs.push(p)
    }
    const grouped = {}
    for (const p of allProbs) {
      const pat = getPattern(p.tags)
      if (!grouped[pat]) grouped[pat] = []
      grouped[pat].push({
        ...p,
        isNew: newProbs.some(x => x.slug === p.slug),
        isRevised: revSlugs.has(p.slug),
      })
    }
    const groups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)
    return {
      date: weekDrillDate,
      groups,
      patternCount: groups.length,
      totalProblems: allProbs.length,
      newCount: newProbs.length,
      revCount: revProbs.length,
    }
  }, [weekDrillDate, problemsByDate, revisionsByDate, problems])

  const sp = selectedProblem
  const pattern = sp ? getPattern(sp.tags) : ''
  const problemRevisions = sp
    ? revisions.filter(r => r.slug === sp.slug).sort((a, b) => b.date.localeCompare(a.date))
    : []
  const alreadyRevisedToday = sp ? problemRevisions.some(r => r.date === today) : false

  const shiftDay = (delta) => {
    if (!selectedDate) return
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    const ds = toLocalDateStr(d)
    setSelectedDate(ds)
    setSelectedProblem(null)
    // Keep calendar in sync — shift month if date leaves current view
    if (d.getFullYear() !== year || d.getMonth() !== month) {
      setCurrentDate(new Date(d.getFullYear(), d.getMonth(), 1))
    }
  }

  return (
    <div className="calendar-page">
      {/* Details */}
      <div className="cal-middle">
        <div className="cal-panel-header">
          <button className="day-nav-btn" onClick={() => shiftDay(-1)}>◀</button>
          <h3 className="cal-panel-title">{selectedDate || 'Select a date'}</h3>
          <button className="day-nav-btn" onClick={() => shiftDay(1)}>▶</button>
          {selectedDate && (selectedNewProblems.length > 0 || selectedRevisionProblems.length > 0) && (
            <div className="cal-panel-progress">
              {selectedNewProblems.length > 0 && <div className="cell-progress-new" style={{ flex: selectedNewProblems.length }}>{selectedNewProblems.length} new</div>}
              {selectedRevisionProblems.length > 0 && <div className="cell-progress-rev" style={{ flex: selectedRevisionProblems.length }}>{selectedRevisionProblems.length} rev</div>}
            </div>
          )}
        </div>

        <div className="detail-tabs">
          <button
            className={`detail-tab ${detailTab === 'new' ? 'active' : ''}`}
            onClick={() => { setDetailTab('new'); setSelectedProblem(null) }}
          >
            New Solved
            {selectedNewProblems.length > 0 && (
              <span className="detail-tab-count">{selectedNewProblems.length}</span>
            )}
          </button>
          <button
            className={`detail-tab ${detailTab === 'revised' ? 'active' : ''}`}
            onClick={() => { setDetailTab('revised'); setSelectedProblem(null) }}
          >
            Revised
            {selectedRevisionProblems.length > 0 && (
              <span className="detail-tab-count">{selectedRevisionProblems.length}</span>
            )}
          </button>
        </div>

        {sp ? (
          /* Inline problem detail */
          <div className="cal-inline-detail">
            <button className="cal-detail-back" onClick={() => setSelectedProblem(null)}>← Back to list</button>

            <h2 className="inline-detail-title">{sp.title}</h2>

            <div className="inline-detail-badges">
              <span className={`difficulty-badge ${sp.difficulty.toLowerCase()}`}>
                {sp.difficulty}
              </span>
              <span className="pattern-tag">{pattern}</span>
            </div>

            <div className="inline-detail-rows">
              <div className="detail-row">
                <span className="detail-label">LeetCode Link</span>
                <a href={sp.url} target="_blank" rel="noopener noreferrer" className="detail-link">
                  Open on LeetCode ↗
                </a>
              </div>

              <div className="detail-row">
                <span className="detail-label">First Solved</span>
                <span>{sp.dateSolved}</span>
              </div>

              {sp.acRate != null && (
                <div className="detail-row">
                  <span className="detail-label">Acceptance Rate</span>
                  <span>{Math.round(sp.acRate)}%</span>
                </div>
              )}

              {(sp.failedCount || 0) > 0 && (
                <div className="detail-row">
                  <span className="detail-label">Failed Submissions</span>
                  <span className="fail-count">{sp.failedCount}</span>
                </div>
              )}

              <div className="detail-row">
                <span className="detail-label">Tags</span>
                <div className="tags-list">
                  {(sp.tags || []).map(t => (
                    <span key={t} className="tag-chip">{t}</span>
                  ))}
                </div>
              </div>

              <div className="detail-row">
                <span className="detail-label">Times Revised</span>
                <span>{problemRevisions.length}</span>
              </div>
            </div>

            {problemRevisions.length > 0 && (
              <div className="revision-history">
                <h4>Revision History</h4>
                <div className="revision-list">
                  {problemRevisions.map((r, i) => (
                    <span key={i} className="revision-date">{r.date}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Problem list */
          <div className="detail-list" key={detailTab}>
            {detailTab === 'new' && (
              groupedNew.length > 0 ? (
                groupedNew.map(([pat, items]) => (
                  <div key={pat} className="cal-pattern-group">
                    <div className="cal-pattern-header">
                      <span>{pat}</span>
                      <span className="cal-pattern-count">{items.length}</span>
                    </div>
                    {items.map((p, idx) => (
                      <button
                        key={p.slug}
                        className="problem-row"
                        onClick={() => setSelectedProblem(p)}
                      >
                        <span className="problem-row-num">{idx + 1}</span>
                        <span className="problem-title">{p.title}</span>
                        <span className="problem-row-meta">
                          {p.acRate != null && <span className="ac-rate">{Math.round(p.acRate)}%</span>}
                          {(p.failedCount || 0) > 0 && <span className="fail-count">✗{p.failedCount}</span>}
                          <span className={`difficulty-badge ${p.difficulty.toLowerCase()}`}>
                            {p.difficulty}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              ) : (
                <p className="empty-message">No new problems on this date.</p>
              )
            )}

            {detailTab === 'revised' && (
              groupedRevised.length > 0 ? (
                groupedRevised.map(([pat, items]) => (
                  <div key={pat} className="cal-pattern-group">
                    <div className="cal-pattern-header">
                      <span>{pat}</span>
                      <span className="cal-pattern-count">{items.length}</span>
                    </div>
                    {items.map((p, idx) => (
                      <button
                        key={p.slug}
                        className="problem-row"
                        onClick={() => setSelectedProblem(p)}
                      >
                        <span className="problem-row-num">{idx + 1}</span>
                        <span className="problem-title">{p.title}</span>
                        <span className="problem-row-meta">
                          {p.acRate != null && <span className="ac-rate">{Math.round(p.acRate)}%</span>}
                          {(p.failedCount || 0) > 0 && <span className="fail-count">✗{p.failedCount}</span>}
                          <span className={`difficulty-badge ${p.difficulty.toLowerCase()}`}>
                            {p.difficulty}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              ) : (
                <p className="empty-message">No revisions on this date.</p>
              )
            )}
          </div>
        )}
      </div>

      {/* Calendar */}
      <div className="cal-right">
        {/* Month view only */}
        {true ? (
          <>
            <div className="calendar-nav">
              <button onClick={prevMonth} className="nav-btn">◀</button>
              <div className="calendar-nav-center">
                <h3>{monthName}
                  {(() => {
                    const startDate = getStartDate()
                    let activeDays = 0, missedDays = 0
                    for (let d = 1; d <= daysInMonth; d++) {
                      const ds = toDateStr(d)
                      if (ds >= today) continue
                      if (ds < startDate) continue
                      const hasNew = (problemsByDate[ds] || []).length > 0
                      const hasRev = (revisionsByDate[ds] || []).length > 0
                      if (hasNew || hasRev) activeDays++
                      else missedDays++
                    }
                    return (
                      <span className="month-stats">
                        <span className="month-stat active">{activeDays} active</span>
                        <span className="month-stat missed">{missedDays} missed</span>
                      </span>
                    )
                  })()}
                </h3>
                <button
                  className="today-btn"
                  onClick={() => {
                    setCurrentDate(new Date())
                    setSelectedDate(todayStr())
                    setSelectedProblem(null)
                  }}
                >
                  Today
                </button>
              </div>
              <button onClick={nextMonth} className="nav-btn">▶</button>
            </div>

            <div className="calendar-grid">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                <div key={d} className="calendar-day-header">{d}</div>
              ))}

              {days.map((day, i) => {
                if (!day) return <div key={`empty-${i}`} className="calendar-cell empty" />
                const dateStr = toDateStr(day)
                const dayNew = problemsByDate[dateStr] || []
                const dayRev = (revisionsByDate[dateStr] || []).map(r => problems[r.slug]).filter(Boolean)
                const newCount = dayNew.length
                const revCount = dayRev.length
                const isToday = dateStr === today
                const isPast = dateStr < today
                const isSelected = dateStr === selectedDate
                const hasActivity = newCount > 0 || revCount > 0

                // Group by pattern for this day's tile
                const patGroups = {}
                const newSlugs = new Set(dayNew.map(p => p.slug))
                const revSlugs = new Set(dayRev.map(p => p.slug))
                for (const p of dayNew) {
                  const pat = getPattern(p.tags)
                  if (!patGroups[pat]) patGroups[pat] = []
                  if (!patGroups[pat].some(x => x.slug === p.slug)) {
                    patGroups[pat].push({ title: p.title, slug: p.slug, isNew: true, isRev: revSlugs.has(p.slug) })
                  }
                }
                for (const p of dayRev) {
                  const pat = getPattern(p.tags)
                  if (!patGroups[pat]) patGroups[pat] = []
                  if (!patGroups[pat].some(x => x.slug === p.slug)) {
                    patGroups[pat].push({ title: p.title, slug: p.slug, isNew: newSlugs.has(p.slug), isRev: true })
                  }
                }
                const patEntries = Object.entries(patGroups).sort((a, b) => b[1].length - a[1].length)

                const isMissed = isPast && !isToday && dateStr >= startDate && !hasActivity
                const isFuture = dateStr > today

                return (
                  <button
                    key={day}
                    className={`calendar-cell ${isToday ? 'today' : ''} ${isSelected && !isMissed && !isFuture ? 'selected' : ''} ${hasActivity ? 'active' : ''} ${isFuture ? 'future' : ''} ${isPast && !isToday && dateStr >= startDate ? (hasActivity ? 'past-solved' : 'past-missed') : ''}`}
                    onClick={() => { if (!isMissed && !isFuture) { setSelectedDate(dateStr); setSelectedProblem(null) } }}
                    style={isMissed || isFuture ? { cursor: 'default' } : undefined}
                  >
                    <span className="day-number">{day}</span>
                    <div className="cell-top-row">
                      {hasActivity && (
                        <div className="cell-progress">
                          {newCount > 0 && <div className="cell-progress-new" style={{ flex: newCount }}>{newCount} new</div>}
                          {revCount > 0 && <div className="cell-progress-rev" style={{ flex: revCount }}>{revCount} rev</div>}
                        </div>
                      )}
                    </div>
                    {hasActivity && (
                      <div className="cell-patterns">
                        {patEntries.slice(0, 6).map(([pat, items]) => {
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
                                  onClick={(e) => { e.stopPropagation(); setSelectedDate(dateStr); setSelectedProblem(problems[p.slug]); setDetailTab(p.isNew ? 'new' : 'revised') }}
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
                        {patEntries.length > 6 && (
                          <span className="cell-pat cell-pat-more">+{patEntries.length - 6} more</span>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </>
        ) : weekDrillDate && drillData ? (
          /* Week drill-down: show patterns + problems for a day */
          <div className={`week-drill ${weekDrillDir === 'open' ? 'wk-slide-in' : weekDrillDir === 'close' ? 'wk-slide-out' : ''}`}>
            <div className="week-drill-header">
              <button className="week-drill-back" onClick={() => {
                setWeekDrillDir('close')
                setTimeout(() => { setWeekDrillDate(null); setWeekDrillDir(null) }, 200)
              }}>← Back to Week</button>
              <h3>{new Date(drillData.date + 'T12:00:00').toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
              <div className="week-drill-stats">
                <span className="wk-stat-chip new-color">{drillData.newCount} new</span>
                <span className="wk-stat-chip rev-color">{drillData.revCount} revised</span>
                <span className="wk-stat-chip">{drillData.patternCount} patterns</span>
              </div>
            </div>

            <div className="week-drill-groups">
              {drillData.groups.length === 0 ? (
                <p className="empty-message">No activity on this day.</p>
              ) : drillData.groups.map(([pat, items]) => (
                <div key={pat} className="wk-drill-group">
                  <div className="wk-drill-group-header">
                    <span className="wk-drill-pat-name">{pat}</span>
                    <span className="wk-drill-pat-count">{items.length}</span>
                  </div>
                  {items.map(p => (
                    <button
                      key={p.slug}
                      className={`wk-drill-problem ${sp?.slug === p.slug ? 'active-row' : ''}`}
                      onClick={() => { setSelectedProblem(p); setSelectedDate(drillData.date) }}
                    >
                      <div className="wk-drill-problem-info">
                        <span className="wk-drill-problem-title">{p.title}</span>
                        <div className="wk-drill-problem-meta">
                          <span className={`difficulty-badge ${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
                          {p.acRate != null && <span className="ac-rate">{Math.round(p.acRate)}% ac</span>}
                          {(p.failedCount || 0) > 0 && <span className="fail-count">{p.failedCount} fails</span>}
                          {p.isNew && <span className="wk-tag-new">new</span>}
                          {p.isRevised && <span className="wk-tag-rev">revised</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="calendar-nav">
              <button onClick={prevWeek} className="nav-btn">◀</button>
              <h3>{weekLabel}</h3>
              <button onClick={nextWeek} className="nav-btn">▶</button>
            </div>

            <div className="week-summary">
              <div className="week-stat">
                <span className="week-stat-num new-color">{weekNewTotal}</span>
                <span className="week-stat-label">New Solved</span>
              </div>
              <div className="week-stat">
                <span className="week-stat-num rev-color">{weekRevTotal}</span>
                <span className="week-stat-label">Revised</span>
              </div>
            </div>

            <div className="week-grid">
              {weekDates.map(dateStr => {
                const dayObj = new Date(dateStr + 'T12:00:00')
                const dayLabel = dayObj.toLocaleString('default', { weekday: 'short' })
                const dayNum = dayObj.getDate()
                const newCount = (problemsByDate[dateStr] || []).length
                const revCount = (revisionsByDate[dateStr] || []).length
                const isToday = dateStr === today
                const isPast = dateStr < today
                const isSelected = dateStr === selectedDate
                const dayProblems = [
                  ...(problemsByDate[dateStr] || []),
                  ...(revisionsByDate[dateStr] || []).map(r => problems[r.slug]).filter(Boolean),
                ]
                const dayPatterns = new Set(dayProblems.map(p => getPattern(p.tags)))
                const patCount = dayPatterns.size
                const hasActivity = newCount > 0 || revCount > 0

                return (
                  <button key={dateStr} className={`week-day-row ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isPast && !isToday && dateStr >= startDate ? (hasActivity ? 'past-solved' : 'past-missed') : ''}`}
                    onClick={() => { setSelectedDate(dateStr); setSelectedProblem(null) }}
                  >
                    <div className="week-day-main">
                      <span className="week-day-label">{dayLabel}</span>
                      <span className="week-day-num">{dayNum}</span>
                    </div>
                    <div className="week-day-bottom">
                      <span className={`cell-count-pill ${newCount > 0 ? 'new' : 'dim'}`}>
                        {newCount} new
                      </span>
                      <span className={`cell-count-pill ${revCount > 0 ? 'rev' : 'dim'}`}>
                        {revCount} revised
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
