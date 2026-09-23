import ArrayView from './ArrayView'
import GridView from './GridView'
import TreeView from './TreeView'
import { detectViews, indexPointers, gridCursor, treeCursors, applyViewSpec } from '../../utils/viewDetect'

// Adding a structure = one component plus one entry here.
const REGISTRY = {
  array: ArrayView,
  grid: GridView,
  tree: TreeView,
}

export default function DataViews({ snapshot, previous, spec }) {
  if (!snapshot) return null

  const views = applyViewSpec(spec, snapshot, detectViews(snapshot))
  if (views.length === 0) return null

  const pointers = indexPointers(snapshot)
  const cursor = gridCursor(snapshot)

  return (
    <div className="rec-data">
      {views.map(view => {
        const View = REGISTRY[view.kind]
        if (!View) return null
        return (
          <View
            key={view.name}
            name={view.name}
            value={snapshot[view.name]}
            previous={previous?.[view.name]}
            pointers={pointers}
            cursor={cursor}
            cursors={view.kind === 'tree' ? treeCursors(snapshot, view.name) : undefined}
          />
        )
      })}
    </div>
  )
}
