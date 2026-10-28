import Drawer from './Drawer'
import ProblemDetail from './ProblemDetail'

/** A problem's details in the shared slide-in drawer. */
export default function ProblemDrawer({ problem, revisions, notice, onClose, children }) {
  if (!problem) return null

  return (
    <Drawer onClose={onClose} label={problem.title}>
      {notice && (
        <p className="tw mb-4 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{notice}</p>
      )}

      <ProblemDetail problem={problem} revisions={revisions}>
        {children}
      </ProblemDetail>
    </Drawer>
  )
}