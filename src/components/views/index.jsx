import ArrayView from './ArrayView'
import GridView from './GridView'
import { detectViews, indexPointers, gridCursor, applyViewSpec } from '../../utils/viewDetect'

// Adding a structure = one component plus one entry here.
const REGISTRY = {
  array: ArrayView,
  grid: GridView,
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
          />
        )
      })}
    </div>
  )
}
