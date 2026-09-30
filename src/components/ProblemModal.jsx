import ProblemDetail from './ProblemDetail'

export default function ProblemModal({ problem, revisions, onClose }) {
  if (!problem) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <ProblemDetail problem={problem} revisions={revisions} />
      </div>
    </div>
  )
}
