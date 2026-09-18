export default function ArrayView({ name, value, previous, pointers }) {
  return (
    <div className="rec-array">
      <div className="rec-array-head">
        <span className="rec-array-name">{name}</span>
        <span className="rec-array-len">{value.length}</span>
      </div>
      <div className="rec-array-cells">
        {value.items.length === 0 && <span className="rec-array-empty">empty</span>}
        {value.items.map((item, i) => {
          const marks = pointers.filter(p => p.value === i).map(p => p.name)
          const changed = previous?.items?.[i] !== item
          return (
            <div key={i} className={`rec-cell ${changed ? 'changed' : ''} ${marks.length ? 'marked' : ''}`}>
              <span className="rec-cell-idx">{i}</span>
              <span className="rec-cell-val">{item}</span>
              <span className="rec-cell-ptr">{marks.join(' ')}</span>
            </div>
          )
        })}
        {value.length > value.items.length && (
          <div className="rec-cell more">+{value.length - value.items.length}</div>
        )}
      </div>
    </div>
  )
}
