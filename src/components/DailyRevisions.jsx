import { useState, useMemo, useCallback } from 'react'
import { getPattern } from '../utils/patterns'
import { todayStr } from '../utils/dateUtils'
import { getTodayRevisionList, saveTodayRevisionList } from '../store'

const PROBLEMS_PER_PATTERN = 3

export default function DailyRevisions({ problems, revisions, onSelectProblem, onRevise }) {
  const today = todayStr()
  const [pickedSlugs, setPickedSlugs] = useState(() => getTodayRevisionList().slugs)
  const [openPattern, setOpenPattern] = useState(null)
  const [drawerDir, setDrawerDir] = useState(null) // 'open' | 'close'
  const [searchQuery, setSearchQuery] = useState('')

  const todayRevisedSlugs = useMemo(
    () => new Set(revisions.filter(r => r.date === today).map(r => r.slug)),
    [revisions, today]
  )

  const pickedSet = useMemo(() => new Set(pickedSlugs), [pickedSlugs])

  // Score all problems once
  const { scoredMap, byPattern } = useMemo(() => {
    const problemList = Object.values(problems)
    const revisionMap = {}
    for (const r of revisions) {
      if (!revisionMap[r.slug]) revisionMap[r.slug] = { count: 0, lastDate: '' }
      revisionMap[r.slug].count++
      if (r.date > revisionMap[r.slug].lastDate) revisionMap[r.slug].lastDate = r.date
    }

    const sMap = {}
    const bp = {}
    for (const p of problemList) {
      const rev = revisionMap[p.slug]
      const lastTouched = rev ? rev.lastDate : p.dateSolved
      const daysSince = Math.floor(
        (new Date(today).getTime() - new Date(lastTouched).getTime()) / 86400000
      )
      const revCount = rev ? rev.count : 0
      const score = daysSince * 2 - revCount * 5
      const pattern = getPattern(p.tags)
      const scored = { ...p, pattern, score, daysSince, revCount }
      sMap[p.slug] = scored
      if (!bp[pattern]) bp[pattern] = []
      bp[pattern].push(scored)
    }

    for (const key of Object.keys(bp)) {
      // Sort by: higher acRate + higher failedCount = needs more revision practice
      // Composite: acRate (0-100) normalized + failedCount weight + staleness
      bp[key].sort((a, b) => {
        const aAc = a.acRate ?? 50
        const bAc = b.acRate ?? 50
        const aFail = a.failedCount || 0
        const bFail = b.failedCount || 0
        // Problems with high acceptance but many personal failures need more work
        const aScore = aAc * 0.3 + aFail * 10 + a.daysSince * 2 - a.revCount * 5
        const bScore = bAc * 0.3 + bFail * 10 + b.daysSince * 2 - b.revCount * 5
        return bScore - aScore
      })
    }
    return { scoredMap: sMap, byPattern: bp }
  }, [problems, revisions, today])

  // Pattern list sorted by least revised
  const patternOptions = useMemo(() => {
    return Object.entries(byPattern)
      .map(([pattern, items]) => {
        const totalRevisions = items.reduce((s, p) => s + p.revCount, 0)
        const avgDaysSince = items.length
          ? Math.round(items.reduce((s, p) => s + p.daysSince, 0) / items.length)
          : 0
        const pickedCount = items.filter(p => pickedSet.has(p.slug)).length
        return { pattern, count: items.length, totalRevisions, avgDaysSince, pickedCount }
      })
      .sort((a, b) => a.totalRevisions - b.totalRevisions)
  }, [byPattern, pickedSet])

  // Left panel: today's picked problems grouped by pattern
  const todayGroups = useMemo(() => {
    const groups = {}
    for (const slug of pickedSlugs) {
      const p = scoredMap[slug]
      if (!p) continue
      if (!groups[p.pattern]) groups[p.pattern] = []
      groups[p.pattern].push(p)
    }
    return Object.entries(groups).map(([pattern, items]) => {
      const doneCount = items.filter(p => todayRevisedSlugs.has(p.slug)).length
      return { pattern, items, doneCount }
    })
  }, [pickedSlugs, scoredMap, todayRevisedSlugs])

  const updatePicked = useCallback((next) => {
    setPickedSlugs(next)
    saveTodayRevisionList(next)
  }, [])

  const addSlugs = useCallback((slugs) => {
    const next = [...pickedSlugs, ...slugs.filter(s => !pickedSet.has(s))]
    updatePicked(next)
  }, [pickedSlugs, pickedSet, updatePicked])

  const removeSlugs = useCallback((slugs) => {
    const removeSet = new Set(slugs)
    updatePicked(pickedSlugs.filter(s => !removeSet.has(s)))
  }, [pickedSlugs, updatePicked])

  const addTopN = useCallback((pattern) => {
    const items = byPattern[pattern]
    if (!items) return
    const top = items.slice(0, PROBLEMS_PER_PATTERN).map(p => p.slug)
    addSlugs(top)
  }, [byPattern, addSlugs])

  const removePattern = useCallback((pattern) => {
    const patSlugs = (byPattern[pattern] || []).map(p => p.slug)
    removeSlugs(patSlugs)
  }, [byPattern, removeSlugs])

  // Filter patterns and problems by search query
  const filteredPatternOptions = useMemo(() => {
    if (!searchQuery.trim()) return patternOptions
    const q = searchQuery.toLowerCase()
    return patternOptions.filter(opt => {
      if (opt.pattern.toLowerCase().includes(q)) return true
      const items = byPattern[opt.pattern] || []
      return items.some(p => p.title.toLowerCase().includes(q))
    })
  }, [patternOptions, byPattern, searchQuery])

  // Search results: individual problems matching query
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    const results = []
    for (const items of Object.values(byPattern)) {
      for (const p of items) {
        if (p.title.toLowerCase().includes(q)) results.push(p)
      }
    }
    return results.slice(0, 20)
  }, [byPattern, searchQuery])

  const totalDone = todayGroups.reduce((s, g) => s + g.doneCount, 0)

  // Drawer content
  const drawerItems = openPattern ? (byPattern[openPattern] || []) : []

  return (
    <div className="rev-page">
      {/* Left: today's revision list */}
      <div className="rev-main">
        <div className="rev-main-header">
          <h2>Today's Revision</h2>
          <span className="rev-main-stat">
            {totalDone}/{pickedSlugs.length} done &middot; {today}
          </span>
        </div>

        {todayGroups.length === 0 ? (
          <p className="empty-message">Pick patterns from the right to build today's list.</p>
        ) : (
          <div className="rev-groups">
            {todayGroups.map(g => (
              <div key={g.pattern} className="rev-group">
                <div className="rev-group-header">
                  <span className="rev-group-name">{g.pattern}</span>
                  <span className="rev-group-progress">{g.doneCount}/{g.items.length}</span>
                  <button
                    className="rev-group-remove"
                    onClick={() => removePattern(g.pattern)}
                    title="Remove pattern"
                  >×</button>
                </div>
                {g.items.map(p => {
                  const done = todayRevisedSlugs.has(p.slug)
                  return (
                    <div key={p.slug} className={`rev-problem-card ${done ? 'revised' : ''}`}>
                      <span className={`rev-check ${done ? 'done' : ''}`}>{done ? '✓' : ''}</span>
                      <div className="rev-problem-info">
                        <button className="rev-problem-title" onClick={() => onSelectProblem(p)}>
                          {p.title}
                        </button>
                        <div className="rev-problem-meta">
                          <span className={`difficulty-badge ${p.difficulty.toLowerCase()}`}>
                            {p.difficulty}
                          </span>
                          <span className="days-ago">{p.daysSince}d ago</span>
                          {p.revCount > 0 && <span className="rev-count">Revised {p.revCount}x</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: pattern picker + drawer */}
      <div className="rev-picker">
        {openPattern ? (
          /* Drawer: show problems in selected pattern */
          <div className={`rev-drawer ${drawerDir === 'open' ? 'slide-in' : drawerDir === 'close' ? 'slide-out' : ''}`}>
            <div className="rev-drawer-header">
              <button className="rev-drawer-back" onClick={() => {
                setDrawerDir('close')
                setTimeout(() => { setOpenPattern(null); setDrawerDir(null) }, 200)
              }}>← Back</button>
              <h3>{openPattern}</h3>
            </div>
            <button
              className="rev-drawer-add-all"
              onClick={() => addTopN(openPattern)}
            >
              + Add Top {Math.min(PROBLEMS_PER_PATTERN, drawerItems.length)}
            </button>
            <div className="rev-drawer-list">
              {drawerItems.map(p => {
                const added = pickedSet.has(p.slug)
                return (
                  <div key={p.slug} className={`rev-drawer-item ${added ? 'added' : ''}`}>
                    <div className="rev-drawer-item-info">
                      <span className="rev-drawer-item-title">{p.title}</span>
                      <div className="rev-drawer-item-meta">
                        <span className={`difficulty-badge ${p.difficulty.toLowerCase()}`}>
                          {p.difficulty}
                        </span>
                        <span className="days-ago">{p.daysSince}d ago</span>
                        {p.acRate != null && <span className="ac-rate">{Math.round(p.acRate)}% ac</span>}
                        {(p.failedCount || 0) > 0 && <span className="fail-count">{p.failedCount} fails</span>}
                        {p.revCount > 0 && <span className="rev-count">{p.revCount}x</span>}
                      </div>
                    </div>
                    <button
                      className={`rev-drawer-add-btn ${added ? 'added' : ''}`}
                      onClick={() => added ? removeSlugs([p.slug]) : addSlugs([p.slug])}
                    >
                      {added ? '−' : '+'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* Pattern list */
          <>
            <div className="rev-picker-header">
              <h3>Add Pattern</h3>
              <span className="rev-picker-hint">Least revised first</span>
            </div>
            <input
              type="text"
              className="rev-search-input"
              placeholder="Search patterns or problems..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery.trim() && searchResults.length > 0 && (
              <div className="rev-search-results">
                <div className="rev-search-results-header">Problems matching "{searchQuery}"</div>
                {searchResults.map(p => {
                  const added = pickedSet.has(p.slug)
                  return (
                    <div key={p.slug} className={`rev-drawer-item ${added ? 'added' : ''}`}>
                      <div className="rev-drawer-item-info">
                        <span className="rev-drawer-item-title">{p.title}</span>
                        <div className="rev-drawer-item-meta">
                          <span className="pattern-tag-sm">{p.pattern}</span>
                          <span className={`difficulty-badge ${p.difficulty.toLowerCase()}`}>{p.difficulty}</span>
                          <span className="days-ago">{p.daysSince}d ago</span>
                        </div>
                      </div>
                      <button
                        className={`rev-drawer-add-btn ${added ? 'added' : ''}`}
                        onClick={() => added ? removeSlugs([p.slug]) : addSlugs([p.slug])}
                      >
                        {added ? '−' : '+'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {searchQuery.trim() && filteredPatternOptions.length > 0 && (
              <div className="rev-search-results-header" style={{ padding: '8px 14px 0' }}>Patterns matching "{searchQuery}"</div>
            )}
            <div className="rev-picker-list">
              {filteredPatternOptions.map(opt => (
                <button
                  key={opt.pattern}
                  className="rev-picker-item"
                  onClick={() => { setDrawerDir('open'); setOpenPattern(opt.pattern) }}
                >
                  <div className="rev-picker-item-top">
                    <span className="rev-picker-name">{opt.pattern}</span>
                    {opt.pickedCount > 0 && (
                      <span className="rev-picker-check">{opt.pickedCount} added</span>
                    )}
                  </div>
                  <div className="rev-picker-item-meta">
                    <span>{opt.count} problems</span>
                    <span>{opt.totalRevisions} revisions</span>
                    <span>~{opt.avgDaysSince}d avg</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
