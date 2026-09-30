import { getPatterns } from '../utils/patterns'
import ProblemNotes from './ProblemNotes'

/**
 * The problem detail body shared by the calendar panel and the coaching
 * drawer, so both stay identical. `children` holds surface-specific actions.
 */
export default function ProblemDetail({ problem, revisions, children }) {
  if (!problem) return null

  const patterns = getPatterns(problem.tags)
  const hasTags = (problem.tags || []).length > 0
  const problemRevisions = (revisions || [])
    .filter(r => r.slug === problem.slug)
    .sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <h2 className="inline-detail-title">{problem.title}</h2>

      <div className="inline-detail-badges">
        {problem.difficulty && (
          <span className={`difficulty-badge ${problem.difficulty.toLowerCase()}`}>
            {problem.difficulty}
          </span>
        )}
        {hasTags && <span className="pattern-tag">{patterns.join(' · ')}</span>}
      </div>

      <div className="inline-detail-rows">
        {problem.url && (
          <div className="detail-row">
            <span className="detail-label">LeetCode Link</span>
            <a href={problem.url} target="_blank" rel="noopener noreferrer" className="detail-link">
              Open on LeetCode ↗
            </a>
          </div>
        )}

        {problem.dateSolved && (
          <div className="detail-row">
            <span className="detail-label">First Solved</span>
            <span>{problem.dateSolved}</span>
          </div>
        )}

        {problem.acRate != null && (
          <div className="detail-row">
            <span className="detail-label">Acceptance Rate</span>
            <span>{Math.round(problem.acRate)}%</span>
          </div>
        )}

        {(problem.failedCount || 0) > 0 && (
          <div className="detail-row">
            <span className="detail-label">Failed Submissions</span>
            <span className="fail-count">{problem.failedCount}</span>
          </div>
        )}

        {hasTags && (
          <div className="detail-row">
            <span className="detail-label">Tags</span>
            <div className="tags-list">
              {problem.tags.map(t => (
                <span key={t} className="tag-chip">{t}</span>
              ))}
            </div>
          </div>
        )}

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

      {children}

      <ProblemNotes slug={problem.slug} />
    </>
  )
}
