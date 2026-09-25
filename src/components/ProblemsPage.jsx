import { useState } from 'react'
import { getPattern, getPatterns } from '../utils/patterns'
import { todayStr } from '../utils/dateUtils'

function exportJSON(problemList, revisions) {
  const revisionMap = {}
  for (const r of revisions) {
    if (!revisionMap[r.slug]) revisionMap[r.slug] = []
    revisionMap[r.slug].push(r.date)
  }

  const data = problemList.map(p => {
    const revisionDates = (revisionMap[p.slug] || []).slice().sort()
    return {
      title: p.title,
      slug: p.slug,
      difficulty: p.difficulty,
      pattern: getPattern(p.tags),
      patterns: getPatterns(p.tags),
      tags: p.tags || [],
      acRate: p.acRate ?? null,
      dateSolved: p.dateSolved ?? null,
      failedCount: p.failedCount ?? 0,
      timesRevised: revisionDates.length,
      revisionDates,
      url: p.url,
    }
  })

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `leetcode_problems_${todayStr()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ProblemsPage({ problems, revisions, onRevise }) {
  const [expandedTopics, setExpandedTopics] = useState({})
  const [filter, setFilter] = useState('')
  const [selectedProblem, setSelectedProblem] = useState(null)
  const today = todayStr()

  const problemList = Object.values(problems)
  const grouped = {}
  for (const p of problemList) {
    const patterns = getPatterns(p.tags)
    for (const pattern of patterns) {
      if (!grouped[pattern]) grouped[pattern] = []
      grouped[pattern].push({ ...p, pattern, patterns })
    }
  }

  const sortedTopics = Object.keys(grouped).sort((a, b) =>
    grouped[b].length - grouped[a].length
  )

  const revisionMap = {}
  for (const r of revisions) {
    if (!revisionMap[r.slug]) revisionMap[r.slug] = []
    revisionMap[r.slug].push(r.date)
  }

  const toggle = topic => {
    setExpandedTopics(prev => ({ ...prev, [topic]: !prev[topic] }))
  }

  const filtered = filter
    ? sortedTopics.filter(t =>
        t.toLowerCase().includes(filter.toLowerCase()) ||
        grouped[t].some(p => p.title.toLowerCase().includes(filter.toLowerCase()))
      )
    : sortedTopics

  const sp = selectedProblem
  const patterns = sp ? getPatterns(sp.tags) : []
  const problemRevisions = sp
    ? revisions.filter(r => r.slug === sp.slug).sort((a, b) => b.date.localeCompare(a.date))
    : []
  const alreadyRevisedToday = sp ? problemRevisions.some(r => r.date === today) : false

  return (
    <div className="problems-page">
      {/* Left: topic list */}
      <div className="problems-left">
        <div className="problems-header">
          <h2>Problems by Topic</h2>
          <span className="problem-count">{problemList.length} problems</span>
          <button className="export-btn" onClick={() => exportJSON(problemList, revisions)}>
            Export JSON
          </button>
        </div>

        <input
          type="text"
          placeholder="Filter by topic or problem name..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="filter-input"
        />

        <div className="topic-list">
          {filtered.map(topic => (
            <div key={topic} className="topic-group">
              <button className="topic-header" onClick={() => toggle(topic)}>
                <span className="topic-arrow">{expandedTopics[topic] ? '▼' : '▶'}</span>
                <span className="topic-name">{topic}</span>
                <span className="topic-count">{grouped[topic].length}</span>
              </button>

              {expandedTopics[topic] && (
                <div className="topic-problems">
                  {grouped[topic]
                    .sort((a, b) => a.dateSolved.localeCompare(b.dateSolved))
                    .map(p => {
                      const revCount = (revisionMap[p.slug] || []).length
                      return (
                        <button
                          key={p.slug}
                          className={`problem-row ${sp?.slug === p.slug ? 'active-row' : ''}`}
                          onClick={() => setSelectedProblem(p)}
                        >
                          <span className="problem-title">{p.title}</span>
                          <span className={`difficulty-badge ${p.difficulty.toLowerCase()}`}>
                            {p.difficulty}
                          </span>
                          <span className="problem-date">{p.dateSolved}</span>
                          {revCount > 0 && (
                            <span className="revision-badge">Revised {revCount}x</span>
                          )}
                        </button>
                      )
                    })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: problem details */}
      <div className="problems-right">
        {sp ? (
          <>
            <h2 className="inline-detail-title">{sp.title}</h2>

            <div className="inline-detail-badges">
              <span className={`difficulty-badge ${sp.difficulty.toLowerCase()}`}>
                {sp.difficulty}
              </span>
              {patterns.map(pat => (
                <span key={pat} className="pattern-tag">{pat}</span>
              ))}
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

            <button
              className={`revise-btn large ${alreadyRevisedToday ? 'done' : ''}`}
              onClick={() => !alreadyRevisedToday && onRevise(sp.slug)}
              disabled={alreadyRevisedToday}
            >
              {alreadyRevisedToday ? '✓ Already Revised Today' : 'Mark as Revised'}
            </button>
          </>
        ) : (
          <p className="empty-message">Select a problem to see details.</p>
        )}
      </div>
    </div>
  )
}
