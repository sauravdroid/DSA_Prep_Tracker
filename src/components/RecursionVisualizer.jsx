import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { layoutTree, NODE_HEIGHT } from '../utils/treeLayout'
import { EXAMPLES } from '../utils/recursionExamples'
import { slugFromUrl, parseQuestion } from '../utils/leetcodeProblem'
import { detectViews } from '../utils/viewDetect'
import DataViews from './views'
import { fetchQuestion } from '../services/leetcode'
import { getSession } from '../store'

const RUN_TIMEOUT_MS = 5000
const LINE_HEIGHT = 20
const EDITOR_PAD = 10

const SPEEDS = [
  { label: '0.5\u00d7', ms: 900 },
  { label: '1\u00d7', ms: 450 },
  { label: '2\u00d7', ms: 200 },
  { label: '4\u00d7', ms: 80 },
]

const CODE_KEY = 'dsa_recursion_code'
const CASES_KEY = 'dsa_recursion_cases'
const ENTRY_KEY = 'dsa_recursion_entry'
const URL_KEY = 'dsa_recursion_url'
const TYPES_KEY = 'dsa_recursion_types'

let caseSeq = 0
const newCase = (input = '', expected = '') => ({ id: `c${caseSeq++}`, input, expected })

// Cheap scan just to populate the entry dropdown before the first run; the worker
// resolves the real entry point from the parsed AST.
function scanTopLevel(code) {
  const names = []
  const decl = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm
  const assigned = /^(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/gm
  let m
  while ((m = decl.exec(code))) names.push(m[1])
  while ((m = assigned.exec(code))) names.push(m[1])
  return [...new Set(names)]
}

function loadCases() {
  try {
    const raw = JSON.parse(localStorage.getItem(CASES_KEY))
    if (Array.isArray(raw) && raw.length > 0) return raw.map(c => newCase(c.input, c.expected))
  } catch { /* fall through to default */ }
  return [newCase()]
}

const STATUS_LABEL = {
  pass: 'Accepted',
  fail: 'Wrong Answer',
  error: 'Runtime Error',
  aborted: 'Stopped',
  ran: 'Finished',
}

// Conventional index names. Matching on the name rather than "any integer in range"
// keeps value-carrying numbers (targets, counts) from being drawn as pointers.

export default function RecursionVisualizer() {
  const [code, setCode] = useState(() => localStorage.getItem(CODE_KEY) || EXAMPLES[0].code)
  const [cases, setCases] = useState(loadCases)
  const [entry, setEntry] = useState(() => localStorage.getItem(ENTRY_KEY) || '')
  const [activeCase, setActiveCase] = useState(0)

  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [running, setRunning] = useState(false)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(SPEEDS[1].ms)
  const [stepMode, setStepMode] = useState('line')
  const [zoom, setZoom] = useState(1)
  const [pinned, setPinned] = useState(null)
  const [editorScroll, setEditorScroll] = useState(0)

  const [problemUrl, setProblemUrl] = useState(() => localStorage.getItem(URL_KEY) || '')
  const [loadingProblem, setLoadingProblem] = useState(false)
  const [problemMsg, setProblemMsg] = useState(null)
  const [types, setTypes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(TYPES_KEY)) || { params: [], return: '' }
    } catch {
      return { params: [], return: '' }
    }
  })

  const workerRef = useRef(null)
  const timeoutRef = useRef(null)
  const canvasRef = useRef(null)
  const editorRef = useRef(null)
  const gutterRef = useRef(null)

  useEffect(() => () => {
    workerRef.current?.terminate()
    clearTimeout(timeoutRef.current)
  }, [])

  const topLevelNames = useMemo(() => {
    // `entry` is included so a name fetched from LeetCode stays selectable before
    // the matching solution has been pasted in.
    const names = [...(result?.topLevel ?? []), ...scanTopLevel(code)]
    if (entry) names.push(entry)
    return [...new Set(names)]
  }, [code, result, entry])

  const run = useCallback(() => {
    workerRef.current?.terminate()
    clearTimeout(timeoutRef.current)

    localStorage.setItem(CODE_KEY, code)
    localStorage.setItem(CASES_KEY, JSON.stringify(cases.map(c => ({ input: c.input, expected: c.expected }))))
    localStorage.setItem(ENTRY_KEY, entry)
    localStorage.setItem(TYPES_KEY, JSON.stringify(types))

    setRunning(true)
    setError(null)
    setPlaying(false)
    setPinned(null)

    const worker = new Worker(new URL('../workers/recursionWorker.js', import.meta.url), { type: 'module' })
    workerRef.current = worker

    const finish = () => {
      clearTimeout(timeoutRef.current)
      worker.terminate()
      workerRef.current = null
      setRunning(false)
    }

    timeoutRef.current = setTimeout(() => {
      finish()
      setResult(null)
      setError(`Timed out after ${RUN_TIMEOUT_MS / 1000}s. There is probably an infinite loop outside the recursion.`)
    }, RUN_TIMEOUT_MS)

    worker.onmessage = e => {
      finish()
      if (!e.data.ok) {
        setResult(null)
        setError(e.data.error)
        return
      }
      setResult(e.data)
      setActiveCase(0)
      setStep(e.data.results[0]?.events.length > 0 ? 1 : 0)
      setZoom(1)
    }

    worker.onerror = err => {
      finish()
      setResult(null)
      setError(err.message || 'Failed to run the code.')
    }

    worker.postMessage({
      code,
      entry,
      cases: cases.map(c => ({ id: c.id, input: c.input, expected: c.expected })),
      paramTypes: types.params,
      returnType: types.return,
    })
  }, [code, cases, entry, types])

  const trace = result?.results[activeCase] ?? null

  // Callbacks handed to reduce/map/sort are real calls but they are not the
  // recursion under study, and they push the actual tree off to one side.
  const hiddenNodes = useMemo(() => {
    if (!trace) return null
    const hasChildren = new Set(trace.nodes.map(n => n.parentId).filter(id => id != null))
    const recursiveFns = new Set()
    for (const n of trace.nodes) {
      for (let p = n.parentId; p != null; p = trace.nodes[p].parentId) {
        if (trace.nodes[p].fnId === n.fnId) { recursiveFns.add(n.fnId); break }
      }
    }
    const hidden = new Set()
    for (const n of trace.nodes) {
      if (n.name === '(anonymous)' && !hasChildren.has(n.id) && !recursiveFns.has(n.fnId)) hidden.add(n.id)
    }
    return hidden
  }, [trace])

  const layout = useMemo(() => (trace ? layoutTree(trace.nodes, hiddenNodes) : null), [trace, hiddenNodes])
  const totalSteps = trace?.events.length ?? 0

  const isNavigable = useCallback(
    s => s === 0 || stepMode === 'line' || trace?.events[s - 1]?.type !== 'line',
    [stepMode, trace]
  )

  const advance = useCallback(dir => {
    if (!trace) return
    let s = step + dir
    while (s > 0 && s < totalSteps && !isNavigable(s)) s += dir
    setStep(Math.max(0, Math.min(totalSteps, s)))
  }, [trace, step, totalSteps, isNavigable])

  useEffect(() => {
    if (!playing) return
    if (step >= totalSteps) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => advance(1), speed)
    return () => clearTimeout(t)
  }, [playing, step, totalSteps, speed, advance])

  const currentEvent = step > 0 ? trace?.events[step - 1] : null
  const currentNodeId = currentEvent?.id ?? null
  const activeLine = currentEvent?.line ?? null

  const stack = useMemo(() => {
    if (!trace) return []
    return trace.nodes.filter(n => step > n.enterStep && step <= n.exitStep).sort((a, b) => a.depth - b.depth)
  }, [trace, step])

  // The two most recent snapshots for the frame in view, so changed values can be
  // flagged. Falls back to any frame on call boundaries, where the new frame has
  // not recorded a snapshot yet — closure state is shared anyway.
  const watch = useMemo(() => {
    if (!trace) return null
    const recent = matchId => {
      const found = []
      for (let i = step - 1; i >= 0 && found.length < 2; i--) {
        const e = trace.events[i]
        if (!e.vars) continue
        if (matchId != null && e.id !== matchId) continue
        found.push(e.vars)
      }
      return found
    }
    let found = currentNodeId != null ? recent(currentNodeId) : []
    if (found.length === 0) found = recent(null)
    if (found.length === 0) return null
    return { current: found[0], previous: found[1] ?? null }
  }, [trace, step, currentNodeId])

  // Keep the node being executed in view as the animation walks the tree.
  useEffect(() => {
    if (currentNodeId == null || !layout || !canvasRef.current) return
    const node = layout.nodes[currentNodeId]
    if (!node || node.hidden) return
    const el = canvasRef.current
    const x = node.x * zoom
    const y = node.y * zoom
    if (x < el.scrollLeft + 80 || x > el.scrollLeft + el.clientWidth - 80) el.scrollLeft = x - el.clientWidth / 2
    if (y < el.scrollTop + 60 || y > el.scrollTop + el.clientHeight - 60) el.scrollTop = y - el.clientHeight / 2
  }, [currentNodeId, layout, zoom])

  // Follow the highlighted line in the editor.
  useEffect(() => {
    const el = editorRef.current
    if (activeLine == null || !el) return
    const top = (activeLine - 1) * LINE_HEIGHT
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - LINE_HEIGHT * 3) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2)
      setEditorScroll(el.scrollTop)
      if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop
    }
  }, [activeLine])

  const onEditorScroll = e => {
    setEditorScroll(e.target.scrollTop)
    if (gutterRef.current) gutterRef.current.scrollTop = e.target.scrollTop
  }

  const selectCase = i => {
    setActiveCase(i)
    setPlaying(false)
    setPinned(null)
    setStep(result?.results[i]?.events.length > 0 ? 1 : 0)
  }

  const updateCase = (i, patch) => setCases(cs => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))

  const loadExample = name => {
    const ex = EXAMPLES.find(x => x.name === name)
    if (!ex) return
    setCode(ex.code)
    setCases(ex.cases.length > 0 ? ex.cases.map(c => newCase(c.input, c.expected)) : [newCase()])
    setEntry(ex.entry || '')
    setTypes({ params: ex.paramTypes || [], return: ex.returnType || '' })
    setResult(null)
    setError(null)
    setStep(0)
    setActiveCase(0)
  }

  const loadFromLeetCode = async () => {
    const slug = slugFromUrl(problemUrl)
    if (!slug) {
      setProblemMsg({ tone: 'error', text: 'Paste a leetcode.com/problems/... URL or a problem slug.' })
      return
    }
    setLoadingProblem(true)
    setProblemMsg(null)
    try {
      const problem = parseQuestion(await fetchQuestion(slug, getSession()))
      localStorage.setItem(URL_KEY, problemUrl)

      setCases(problem.cases.map(c => newCase(c.input, c.expected)))
      setEntry(problem.entry)
      setTypes({ params: problem.paramTypes, return: problem.returnType })
      setActiveCase(0)
      setResult(null)
      setError(null)
      setStep(0)

      // Only seed the editor when it is empty, so a solution in progress is never lost.
      const editorEmpty = code.trim().length === 0
      if (editorEmpty && problem.starterCode) setCode(problem.starterCode)

      const notes = []
      if (problem.missingExpected) notes.push('some expected outputs could not be read')
      if (!editorEmpty && problem.starterCode) notes.push('kept your code')
      setProblemMsg({
        tone: 'ok',
        text: `${problem.title} · ${problem.cases.length} case${problem.cases.length !== 1 ? 's' : ''}${notes.length ? ` · ${notes.join(', ')}` : ''}`,
      })
    } catch (e) {
      setProblemMsg({ tone: 'error', text: e.message })
    }
    setLoadingProblem(false)
  }

  const onKeyDown = e => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
    if (e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); advance(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); advance(-1) }
    else if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
  }

  const detailNode = pinned != null ? trace?.nodes[pinned] : (currentNodeId != null ? trace?.nodes[currentNodeId] : null)

  const stateOf = node => {
    if (step <= node.enterStep) return 'pending'
    if (step > node.exitStep) return node.threw ? 'threw' : 'done'
    return 'active'
  }

  const graded = result?.results.filter(r => r.status === 'pass' || r.status === 'fail') ?? []
  const overall = !result ? null
    : result.results.some(r => r.status === 'error' || r.status === 'aborted') ? 'error'
    : graded.length > 0 && graded.every(r => r.status === 'pass') ? 'pass'
    : graded.some(r => r.status === 'fail') ? 'fail'
    : 'ran'

  const lineCount = useMemo(() => code.split('\n').length, [code])

  // After a run, show the types the worker actually resolved rather than the
  // remembered ones — they can differ when a JSDoc header overrides stale metadata.
  const shownTypes = result?.types ?? types

  const views = useMemo(() => (watch ? detectViews(watch.current) : []), [watch])

  return (
    <div className="rec-page" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="rec-left">
        <div className="rec-toolbar">
          <select className="rec-example-select" value="" onChange={e => loadExample(e.target.value)}>
            <option value="">Load example…</option>
            {EXAMPLES.map(ex => <option key={ex.name} value={ex.name}>{ex.name}</option>)}
          </select>
          <button className="rec-run-btn" onClick={run} disabled={running}>
            {running ? 'Running\u2026' : '\u25b6 Run'}
          </button>
        </div>

        <div className="rec-editor-wrap">
          <div className="rec-gutter" ref={gutterRef}>
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className={`rec-gutter-line ${activeLine === i + 1 ? 'active' : ''}`}>{i + 1}</div>
            ))}
          </div>
          <div className="rec-editor-scroll">
            {activeLine != null && (
              <div className="rec-hl-band" style={{ top: EDITOR_PAD + (activeLine - 1) * LINE_HEIGHT - editorScroll }} />
            )}
            <textarea
              ref={editorRef}
              className="rec-editor"
              value={code}
              spellCheck={false}
              onScroll={onEditorScroll}
              onChange={e => setCode(e.target.value)}
              placeholder="Paste a LeetCode solution, or write a function and call it on the last line…"
            />
          </div>
        </div>

        {error && <div className="rec-error">{error}</div>}
        {trace?.error && <div className="rec-error">{trace.error}</div>}
        {trace?.aborted && <div className="rec-warn">{trace.aborted}</div>}

        {trace && trace.nodes.length > 0 && (
          <div className="rec-summary">
            <span><strong>{trace.nodes.length}</strong> calls</span>
            <span><strong>{Math.max(...trace.nodes.map(n => n.depth)) + 1}</strong> max depth</span>
            <span><strong>{totalSteps}</strong> steps</span>
            {hiddenNodes?.size > 0 && <span>{hiddenNodes.size} helper calls hidden</span>}
          </div>
        )}

        {trace && (
          <div className="rec-stack">
            <h4 className="rec-panel-title">Call stack</h4>
            {stack.length === 0 ? (
              <p className="rec-muted">empty</p>
            ) : (
              [...stack].reverse().map(n => (
                <button
                  key={n.id}
                  className={`rec-stack-row ${n.id === currentNodeId ? 'current' : ''}`}
                  onClick={() => setPinned(n.id)}
                >
                  <span className="rec-stack-depth">{n.depth}</span>
                  <span className="rec-stack-label">{n.name}({n.args.join(', ')})</span>
                  <span className="rec-stack-line">L{n.id === currentNodeId && activeLine != null ? activeLine : n.curLine}</span>
                </button>
              ))
            )}
          </div>
        )}

        {watch && Object.keys(watch.current).length > 0 && (
          <div className="rec-detail">
            <h4 className="rec-panel-title">Variables</h4>
            {Object.entries(watch.current).map(([name, value]) => (
              <div
                key={name}
                className={`rec-var-row ${watch.previous && watch.previous[name]?.text !== value.text ? 'changed' : ''}`}
              >
                <span className="rec-var-name">{name}</span>
                <code className="rec-var-value">{value.text}</code>
              </div>
            ))}
          </div>
        )}

        {detailNode && (
          <div className="rec-detail">
            <h4 className="rec-panel-title">
              Frame
              {pinned != null && <button className="rec-unpin" onClick={() => setPinned(null)}>unpin</button>}
            </h4>
            <div className="rec-detail-row"><span>call</span><code>{detailNode.name}({detailNode.args.join(', ')})</code></div>
            <div className="rec-detail-row"><span>depth</span><code>{detailNode.depth}</code></div>
            <div className="rec-detail-row">
              <span>returns</span>
              <code className={step > detailNode.exitStep ? 'rec-ret' : 'rec-muted'}>
                {step > detailNode.exitStep
                  ? (detailNode.threw ? 'threw' : detailNode.returned ? detailNode.result : 'undefined')
                  : 'not yet returned'}
              </code>
            </div>
            {detailNode.logs.length > 0 && (
              <div className="rec-logs">
                {detailNode.logs.filter(l => l.step < step).map((l, i) => (
                  <div key={i} className="rec-log">{l.text}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rec-right">
          <div className="rec-lc-loader">
            <div className="rec-lc-row">
              <input
                className="rec-lc-input"
                value={problemUrl}
                placeholder="leetcode.com/problems/…"
                spellCheck={false}
                onChange={e => setProblemUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') loadFromLeetCode() }}
              />
              <button className="rec-lc-btn" onClick={loadFromLeetCode} disabled={loadingProblem}>
                {loadingProblem ? '…' : 'Load'}
              </button>
            </div>
            {problemMsg && <p className={`rec-lc-msg ${problemMsg.tone}`}>{problemMsg.text}</p>}
          </div>

          <div className="rec-case-panel">
            <div className="rec-case-head">
              <div className="rec-case-tabs">
                {cases.map((c, i) => {
                  const r = result?.mode === 'cases' ? result.results[i] : null
                  return (
                    <button
                      key={c.id}
                      className={`rec-case-tab ${activeCase === i ? 'active' : ''} ${r ? r.status : ''}`}
                      onClick={() => selectCase(i)}
                    >
                      {r?.status === 'pass' && <span className="rec-case-dot pass">✓</span>}
                      {(r?.status === 'fail' || r?.status === 'error') && <span className="rec-case-dot fail">✕</span>}
                      Case {i + 1}
                      {cases.length > 1 && (
                        <span
                          className="rec-case-del"
                          onClick={ev => {
                            ev.stopPropagation()
                            setCases(cs => cs.filter((_, idx) => idx !== i))
                            setActiveCase(a => Math.max(0, a >= i ? a - 1 : a))
                          }}
                        >×</span>
                      )}
                    </button>
                  )
                })}
                <button className="rec-case-add" onClick={() => { setCases(cs => [...cs, newCase()]); setActiveCase(cases.length) }}>+</button>
              </div>

              <select
                className="rec-entry-select"
                value={entry}
                onChange={e => setEntry(e.target.value)}
                title="Function the test cases call"
              >
                <option value="">auto{topLevelNames[0] ? ` (${topLevelNames[0]})` : ''}</option>
                {topLevelNames.map(n => <option key={n} value={n}>{n}()</option>)}
              </select>
            </div>

            {shownTypes.params.length > 0 && (
              <p className="rec-sig">
                {entry || 'auto'}({shownTypes.params.join(', ')}){shownTypes.return ? ` → ${shownTypes.return}` : ''}
              </p>
            )}

            {cases[activeCase] && (
              <div className="rec-case-body">
                <label className="rec-case-label">
                  Input
                  <span className="rec-case-hint">one argument per line, JSON</span>
                </label>
                <textarea
                  className="rec-case-input"
                  value={cases[activeCase].input}
                  spellCheck={false}
                  placeholder={'[["a","b"],["b","c"]]\n[2.0,3.0]'}
                  onChange={e => updateCase(activeCase, { input: e.target.value })}
                />
                <label className="rec-case-label">
                  Expected
                  <span className="rec-case-hint">optional</span>
                </label>
                <textarea
                  className="rec-case-input short"
                  value={cases[activeCase].expected}
                  spellCheck={false}
                  placeholder="[6.0,0.5,-1.0]"
                  onChange={e => updateCase(activeCase, { expected: e.target.value })}
                />
                <p className="rec-case-note">Leave every input empty to run the code as a plain script.</p>
              </div>
            )}
          </div>

          <div className="rec-result">
            {result?.mode === 'cases' ? (
              <>
                <div className="rec-result-head">
                  <span className={`rec-verdict ${overall}`}>{STATUS_LABEL[overall] ?? ''}</span>
                  <span className="rec-entry-tag">{result.entry}()</span>
                </div>
                {trace && (
                  <div className="rec-io">
                    <div className="rec-io-row">
                      <span>Output</span>
                      <code className={trace.status === 'fail' ? 'bad' : ''}>{trace.output ?? '—'}</code>
                    </div>
                    {trace.expected?.trim() && (
                      <div className="rec-io-row">
                        <span>Expected</span>
                        <code>{trace.expected}</code>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="rec-result-head">
                  <span className="rec-verdict ran">{result ? 'Script run' : 'Result'}</span>
                </div>
                <p className="rec-muted">
                  {result ? 'Ran as a plain script — add a test case input to call a function directly.' : 'Run to see output here.'}
                </p>
              </>
            )}
          </div>
      </div>

      {/* Only collapse the canvas when there is no tree to draw at all — a wide
          tree of sibling calls is still worth seeing alongside a grid. */}
      <div className={`rec-middle ${trace && trace.nodes.length <= 1 && views.length > 0 ? 'flat' : ''}`}>
        <div className="rec-controls">
          <button className="rec-ctrl" onClick={() => { setPlaying(false); setStep(0) }} disabled={!trace} title="Reset">↺</button>
          <button className="rec-ctrl" onClick={() => { setPlaying(false); advance(-1) }} disabled={!trace || step === 0} title="Previous step">◀</button>
          <button
            className="rec-ctrl primary"
            onClick={() => { if (step >= totalSteps) setStep(0); setPlaying(p => !p) }}
            disabled={!trace || totalSteps === 0}
            title="Play / pause"
          >
            {playing ? '\u2758\u2758' : '\u25b6'}
          </button>
          <button className="rec-ctrl" onClick={() => { setPlaying(false); advance(1) }} disabled={!trace || step >= totalSteps} title="Next step">▶</button>

          <input
            type="range"
            className="rec-scrubber"
            min={0}
            max={totalSteps}
            value={step}
            disabled={!trace}
            onChange={e => { setPlaying(false); setStep(Number(e.target.value)) }}
          />
          <span className="rec-step-count">{step} / {totalSteps}</span>

          <div className="rec-speeds" title="Step by every line, or jump between calls only">
            <button className={`rec-speed ${stepMode === 'line' ? 'active' : ''}`} onClick={() => setStepMode('line')}>lines</button>
            <button className={`rec-speed ${stepMode === 'call' ? 'active' : ''}`} onClick={() => setStepMode('call')}>calls</button>
          </div>

          <div className="rec-speeds">
            {SPEEDS.map(s => (
              <button key={s.label} className={`rec-speed ${speed === s.ms ? 'active' : ''}`} onClick={() => setSpeed(s.ms)}>
                {s.label}
              </button>
            ))}
          </div>

          <div className="rec-zoom">
            <button className="rec-ctrl" onClick={() => setZoom(z => Math.max(0.2, z - 0.15))} disabled={!trace}>−</button>
            <span className="rec-zoom-val">{Math.round(zoom * 100)}%</span>
            <button className="rec-ctrl" onClick={() => setZoom(z => Math.min(2, z + 0.15))} disabled={!trace}>+</button>
          </div>
        </div>

        {currentEvent && (
          <div className="rec-now">
            <span className="rec-now-line">L{currentEvent.line ?? '?'}</span>
            {currentEvent.type === 'enter' && <><span className="rec-tag enter">call</span> {trace.nodes[currentEvent.id].name}({trace.nodes[currentEvent.id].args.join(', ')})</>}
            {currentEvent.type === 'exit' && <><span className="rec-tag exit">return</span> {trace.nodes[currentEvent.id].name}({trace.nodes[currentEvent.id].args.join(', ')}) → {trace.nodes[currentEvent.id].returned ? trace.nodes[currentEvent.id].result : 'undefined'}</>}
            {currentEvent.type === 'line' && <><span className="rec-tag step">run</span> {trace.nodes[currentEvent.id].name}({trace.nodes[currentEvent.id].args.join(', ')})</>}
            {currentEvent.type === 'log' && <><span className="rec-tag log">log</span> {currentEvent.text}</>}
          </div>
        )}

        <div className="rec-canvas" ref={canvasRef}>
          {!result && !running && <p className="empty-message">Write a recursive function and hit Run.</p>}
          {result && trace && trace.nodes.length === 0 && (
            <p className="empty-message">No recursive calls were traced for this case.</p>
          )}
          {layout && trace.nodes.length > 0 && (
            <svg width={layout.width * zoom + 40} height={layout.height * zoom + 40} className="rec-svg">
              <g transform={`translate(20, 20) scale(${zoom})`}>
                {layout.edges.map(({ from, to }) => {
                  const a = layout.nodes[from]
                  const b = layout.nodes[to]
                  return (
                    <path
                      key={`${from}-${to}`}
                      className={`rec-edge ${step > b.enterStep ? 'visible' : ''}`}
                      d={`M ${a.x} ${a.y + NODE_HEIGHT} C ${a.x} ${a.y + NODE_HEIGHT + 24}, ${b.x} ${b.y - 24}, ${b.x} ${b.y}`}
                    />
                  )
                })}
                {layout.nodes.map(n => (
                  n.hidden ? null : (
                  <g
                    key={n.id}
                    className={`rec-node ${stateOf(n)} ${n.id === currentNodeId ? 'current' : ''} ${pinned === n.id ? 'pinned' : ''}`}
                    transform={`translate(${n.x - n.w / 2}, ${n.y})`}
                    onClick={() => setPinned(p => (p === n.id ? null : n.id))}
                  >
                    <rect width={n.w} height={n.h} rx="6" />
                    <text x={n.w / 2} y={n.h / 2 + 4} textAnchor="middle">{n.label}</text>
                    {step > n.exitStep && n.returned && (
                      <text className="rec-node-result" x={n.w / 2} y={n.h + 13} textAnchor="middle">→ {n.result}</text>
                    )}
                  </g>
                  )
                ))}
              </g>
            </svg>
          )}
        </div>

        {watch && <DataViews snapshot={watch.current} previous={watch.previous} />}
      </div>
    </div>
  )
}
