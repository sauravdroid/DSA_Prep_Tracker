import { getPattern } from '../utils/patterns'
import { todayStr } from '../utils/dateUtils'

export default function ProblemModal({ problem, revisions, onClose, onRevise }) {
  if (!problem) return null

  const pattern = getPattern(problem.tags)
  const problemRevisions = revisions
    .filter(r => r.slug === problem.slug)
    .sort((a, b) => b.date.localeCompare(a.date))
  const today = todayStr()
  const alreadyRevisedToday = problemRevisions.some(r => r.date === today)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <h2 className="modal-title">{problem.title}</h2>

        <div className="modal-badges">
          <span className={`difficulty-badge ${problem.difficulty.toLowerCase()}`}>
            {problem.difficulty}
          </span>
          <span className="pattern-tag">{pattern}</span>
        </div>

        <div className="modal-details">
          <div className="detail-row">
            <span className="detail-label">LeetCode Link</span>
            <a href={problem.url} target="_blank" rel="noopener noreferrer" className="detail-link">
              {problem.url}
            </a>
          </div>

          <div className="detail-row">
            <span className="detail-label">First Solved</span>
            <span>{problem.dateSolved}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">Tags</span>
            <div className="tags-list">
              {(problem.tags || []).map(t => (
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
    </div>
  )
}
