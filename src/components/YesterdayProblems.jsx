import { useMemo } from 'react'
import { getPattern } from '../utils/patterns'
import { toLocalDateStr } from '../utils/dateUtils'

function getYesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return toLocalDateStr(d)
}

export default function YesterdayProblems({ problems, revisions, onSelectProblem }) {
  const yesterday = getYesterdayStr()

  const { newProblems, revisedProblems } = useMemo(() => {
    const newProbs = Object.values(problems).filter(p => p.dateSolved === yesterday)
    const revSlugs = revisions.filter(r => r.date === yesterday).map(r => r.slug)
    const revProbs = revSlugs.map(slug => problems[slug]).filter(Boolean)
    return { newProblems: newProbs, revisedProblems: revProbs }
  }, [problems, revisions, yesterday])

  function groupByPattern(list) {
    const groups = {}
    for (const p of list) {
      const pat = getPattern(p.tags)
      if (!groups[pat]) groups[pat] = []
      groups[pat].push(p)
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  }

  const groupedNew = useMemo(() => groupByPattern(newProblems), [newProblems])
  const groupedRevised = useMemo(() => groupByPattern(revisedProblems), [revisedProblems])
  const total = newProblems.length + revisedProblems.length

  return (
    <div className="yesterday-page">
      <div className="yesterday-header">
        <h2>Yesterday's Activity</h2>
        <span className="yesterday-date">{yesterday}</span>
        <div className="yesterday-stats">
          <span className="yesterday-stat new">{newProblems.length} new</span>
          <span className="yesterday-stat rev">{revisedProblems.length} revised</span>
        </div>
      </div>

      {total === 0 ? (
        <p className="empty-message">No problems solved or revised yesterday.</p>
      ) : (
        <div className="yesterday-content">
          {groupedNew.length > 0 && (
            <div className="yesterday-section">
              <h3 className="yesterday-section-title new-color">New Solved</h3>
              {groupedNew.map(([pat, items]) => (
                <div key={pat} className="cal-pattern-group">
                  <div className="cal-pattern-header">
                    <span>{pat}</span>
                    <span className="cal-pattern-count">{items.length}</span>
                  </div>
                  {items.map((p, idx) => (
                    <button
                      key={p.slug}
                      className="problem-row"
                      onClick={() => onSelectProblem(p)}
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
              ))}
            </div>
          )}

          {groupedRevised.length > 0 && (
            <div className="yesterday-section">
              <h3 className="yesterday-section-title rev-color">Revised</h3>
              {groupedRevised.map(([pat, items]) => (
                <div key={pat} className="cal-pattern-group">
                  <div className="cal-pattern-header">
                    <span>{pat}</span>
                    <span className="cal-pattern-count">{items.length}</span>
                  </div>
                  {items.map((p, idx) => (
                    <button
                      key={p.slug}
                      className="problem-row"
                      onClick={() => onSelectProblem(p)}
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
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
