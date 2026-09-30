import { useState, useMemo, useEffect, useRef } from 'react'
import { getPattern, getPatterns } from '../utils/patterns'
import { todayStr } from '../utils/dateUtils'
import ProblemDrawer from './ProblemDrawer'
import TopicStats, { EMPTY_FILTERS, struggleBucket, filterCount } from './TopicStats'

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

export default function ProblemsPage({ problems, revisions }) {
  const [filter, setFilter] = useState('')
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [selectedProblem, setSelectedProblem] = useState(null)
  const [filters, setFilters] = useState(EMPTY_FILTERS)

  const toggleFilter = (dimension, value) => {
    setFilters(prev => {
      const current = prev[dimension]
      return {
        ...prev,
        [dimension]: current.includes(value)
          ? current.filter(v => v !== value)
          : [...current, value],
      }
    })
  }

  const pickTopic = topic => {
    setSelectedTopic(topic)
    setFilters(EMPTY_FILTERS)
  }

  const problemList = useMemo(() => Object.values(problems), [problems])

  const grouped = useMemo(() => {
    const out = {}
    for (const p of problemList) {
      for (const pattern of getPatterns(p.tags)) {
        if (!out[pattern]) out[pattern] = []
        out[pattern].push(p)
      }
    }
    return out
  }, [problemList])

  const revisionMap = useMemo(() => {
    const out = {}
    for (const r of revisions) {
      if (!out[r.slug]) out[r.slug] = []
      out[r.slug].push(r.date)
    }
    return out
  }, [revisions])

  const sortedTopics = useMemo(
    () => Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length),
    [grouped]
  )

  const defaultApplied = useRef(false)
  useEffect(() => {
    if (defaultApplied.current || !sortedTopics.length) return
    defaultApplied.current = true
    setSelectedTopic(sortedTopics[0])
  }, [sortedTopics])

  const q = filter.trim().toLowerCase()
  const filteredTopics = q
    ? sortedTopics.filter(t =>
      t.toLowerCase().includes(q) || grouped[t].some(p => p.title.toLowerCase().includes(q))
    )
    : sortedTopics

  const byDate = (a, b) => (a.dateSolved || '').localeCompare(b.dateSolved || '')

  // Values within a dimension are OR'd, dimensions are AND'd, so "Easy" plus
  // "Clean" narrows rather than widens.
  const matchesFilters = p => {
    if (filters.difficulty.length && !filters.difficulty.includes(p.difficulty)) return false
    if (filters.struggle.length && !filters.struggle.includes(struggleBucket(p.failedCount))) return false
    if (filters.revision.length) {
      const revised = (revisionMap[p.slug] || []).length > 0
      const key = revised ? 'some' : 'never'
      if (!filters.revision.includes(key)) return false
    }
    return true
  }

  // A search shows matches across every topic until one is picked, so results
  // are visible without having to guess which topic holds them. A topic name
  // matches all of its problems, not just titles containing the term.
  const searching = !!q && !selectedTopic
  const visibleProblems = selectedTopic
    ? [...(grouped[selectedTopic] || [])]
      .filter(p => !q || selectedTopic.toLowerCase().includes(q) || p.title.toLowerCase().includes(q))
      .filter(matchesFilters)
      .sort(byDate)
    : searching
      ? problemList
        .filter(p =>
          p.title.toLowerCase().includes(q) ||
          getPatterns(p.tags).some(t => t.toLowerCase().includes(q))
        )
        .sort(byDate)
      : []

  const sp = selectedProblem

  return (
    <div className={`problems-page ${selectedTopic ? 'with-stats' : ''}`}>
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
          {filteredTopics.map(topic => (
            <div key={topic} className="topic-group">
              <button
                className={`topic-header ${selectedTopic === topic ? 'active-topic' : ''}`}
                onClick={() => pickTopic(topic)}
              >
                <span className="topic-name">{topic}</span>
                <span className="topic-count">{grouped[topic].length}</span>
              </button>
            </div>
          ))}
          {filteredTopics.length === 0 && (
            <p className="empty-message">No topics match that filter.</p>
          )}
        </div>
      </div>

      {/* Middle: how the selected topic is going, and the filter control for the list */}
      {selectedTopic && (
        <div className="problems-stats">
          <TopicStats
            topic={selectedTopic}
            problems={grouped[selectedTopic] || []}
            revisionMap={revisionMap}
            filters={filters}
            onToggle={toggleFilter}
            onClear={() => setFilters(EMPTY_FILTERS)}
          />
        </div>
      )}

      {/* Right: the selected topic's problems, or search results across topics */}
      <div className="problems-right">
        {selectedTopic || searching ? (
          <>
            <div className="problems-header">
              <h2>{selectedTopic || `Results for “${filter.trim()}”`}</h2>
              <span className="problem-count">
                {selectedTopic && filterCount(filters) > 0
                  ? `${visibleProblems.length} of ${(grouped[selectedTopic] || []).length}`
                  : `${visibleProblems.length} problem${visibleProblems.length !== 1 ? 's' : ''}`}
              </span>
              {selectedTopic && (
                <button className="export-btn" onClick={() => pickTopic(null)}>
                  Clear topic
                </button>
              )}
            </div>

            <div className="topic-problems">
              {visibleProblems.map(p => {
                const revCount = (revisionMap[p.slug] || []).length
                return (
                  <button
                    key={p.slug}
                    className={`problem-row ${sp?.slug === p.slug ? 'active-row' : ''}`}
                    onClick={() => setSelectedProblem(p)}
                  >
                    <span className="problem-title">{p.title}</span>
                    {searching && <span className="pattern-tag">{getPattern(p.tags)}</span>}
                    <span className={`difficulty-badge ${(p.difficulty || '').toLowerCase()}`}>
                      {p.difficulty}
                    </span>
                    <span className="problem-date">{p.dateSolved}</span>
                    {(p.failedCount || 0) > 0 && (
                      <span className="fail-count">✗{p.failedCount}</span>
                    )}
                    {revCount > 0 && <span className="revision-badge">Revised {revCount}x</span>}
                  </button>
                )
              })}
              {visibleProblems.length === 0 && (
                <p className="empty-message">
                  {selectedTopic && filterCount(filters) > 0
                    ? 'No problems match those filters.'
                    : 'No problems match that search.'}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="empty-message">Select a topic, or search to see problems.</p>
        )}
      </div>

      {sp && (
        <ProblemDrawer
          problem={sp}
          revisions={revisions}
          onClose={() => setSelectedProblem(null)}
        />
      )}
    </div>
  )
}
