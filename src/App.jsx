import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ControlsTabs } from './components/ControlsTabs'
import { FileMenu } from './components/FileMenu'
import { PlotView } from './components/PlotView'
import { DataTable, StatsTable } from './components/Tables'
import { useDebounced } from './hooks'
import { activeChips } from './lib/chips'
import { parseCsv } from './lib/csv'
import { evaluateColumn } from './lib/expression'
import { estimateFs, FILTERS } from './lib/filters'
import {
  canPickFolder,
  pickFolder,
  sampleSource,
  SAMPLE_ID,
  scanDirectory,
  sourcesFromFiles,
} from './lib/files'
import { buildFigure } from './lib/plots'
import { DEFAULT_OPTS, INDEX, MAX_TRACES, NONE, CUSTOM } from './lib/types'

const THEME_KEY = 'csv-explorer-theme'

// Dark is the default, matching echotops.github.io and vector-fields; the choice is remembered.
function savedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'Light' || saved === 'Dark') return saved
  } catch {
    // fall through to the default
  }
  return DEFAULT_OPTS.theme
}

const SIDEBAR_KEY = 'csv-explorer-sidebar'
const SIDEBAR_DEFAULT = 392
const SIDEBAR_MIN = 280
const SIDEBAR_MAX = 640

// Width and collapsed state of the controls column, remembered like the theme.
function savedSidebar() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? '{}')
    const width = Number(saved.width)
    return {
      width: width >= SIDEBAR_MIN && width <= SIDEBAR_MAX ? width : SIDEBAR_DEFAULT,
      collapsed: saved.collapsed === true,
    }
  } catch {
    return { width: SIDEBAR_DEFAULT, collapsed: false }
  }
}

// Keystrokes meant for a text box (or a drop-down) must never trigger a shortcut.
const typingTarget = (t) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))

/** Keep the user's picks across files where the columns still exist; otherwise choose sensible defaults. */
function reconcile(o, t) {
  const numeric = t.names.filter((n) => t.cols[n].kind === 'num')
  const firstKind = t.cols[t.names[0]].kind
  const x =
    t.names.includes(o.x) || o.x === CUSTOM
      ? o.x
      : firstKind === 'num' || firstKind === 'time'
        ? t.names[0]
        : INDEX
  // formula traces survive a file switch too (they may fail on the new file — the panel says why)
  let traces = o.traces.filter((tr) => t.names.includes(tr.col) || tr.col === CUSTOM).slice(0, MAX_TRACES)
  if (!traces.length) traces = [{ col: numeric.find((c) => c !== x) ?? NONE, side: 'L', expr: '', color: '' }]
  return { x, traces, colorBy: numeric.includes(o.colorBy) ? o.colorBy : NONE }
}

export default function App() {
  const [sources, setSources] = useState([sampleSource()])
  const [selected, setSelected] = useState(SAMPLE_ID)
  const [folder, setFolder] = useState(null)
  const [table, setTable] = useState(null)
  const [loadMsg, setLoadMsg] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  const [opts, setOpts] = useState(() => ({ ...DEFAULT_OPTS, theme: savedTheme() }))
  const [main, setMain] = useState('plot')
  const [dragging, setDragging] = useState(false)
  const [sidebar, setSidebar] = useState(savedSidebar)
  const [drawer, setDrawer] = useState(false)
  const [fileOpen, setFileOpen] = useState(false)
  const request = useRef(0)
  const sourcesRef = useRef(sources)
  useEffect(() => {
    sourcesRef.current = sources
  }, [sources])
  const fileInput = useRef(null)
  const patch = useCallback((p) => setOpts((o) => ({ ...o, ...p })), [])
  const firstTheme = useRef(true)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = opts.theme.toLowerCase()
    // fade between themes, but not on page load
    let timer
    if (firstTheme.current) firstTheme.current = false
    else {
      root.classList.add('theme-fade')
      timer = setTimeout(() => root.classList.remove('theme-fade'), 250)
    }
    try {
      localStorage.setItem(THEME_KEY, opts.theme)
    } catch {
      // storage can be blocked (private windows, strict settings) — the theme just won't be remembered
    }
    return () => clearTimeout(timer)
  }, [opts.theme])
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify(sidebar))
    } catch {
      // not remembered, same as the theme
    }
  }, [sidebar])
  useEffect(() => {
    const src = sourcesRef.current.find((s) => s.id === selected)
    if (!src) return
    const req = ++request.current
    setLoadMsg(`Loading ${src.label}…`)
    void (async () => {
      try {
        const text = await src.read()
        await new Promise((r) => setTimeout(r, 0))
        if (req !== request.current) return
        const t = parseCsv(text, src.label.split('/').pop() ?? src.label)
        setTable(t)
        setOpts((o) => ({ ...o, ...reconcile(o, t) }))
        setLoadMsg('')
      } catch (e) {
        if (req === request.current) setLoadMsg(`Could not read ${src.label}: ${e.message}`)
      }
    })()
  }, [selected, reloadTick])
  const addFiles = (files) => {
    const fresh = sourcesFromFiles(files)
    if (!fresh.length) {
      setLoadMsg('No CSV/TSV/TXT files found in that selection.')
      return
    }
    setSources((prev) => [...fresh, ...prev.filter((p) => !fresh.some((f) => f.id === p.id))])
    setSelected(fresh[0].id)
  }
  const adoptFolder = (f) => {
    if (!f.sources.length) {
      setLoadMsg(`No CSV files found under ${f.name}.`)
      return false
    }
    setFolder(f)
    setSources(f.sources)
    return true
  }
  const openFolder = async () => {
    try {
      const f = await pickFolder()
      if (f && adoptFolder(f)) setSelected(f.sources[0].id)
    } catch (e) {
      setLoadMsg(`Could not open folder: ${e.message}`)
    }
  }
  const reload = async () => {
    if (folder) {
      const sources = await scanDirectory(folder.handle)
      adoptFolder({ ...folder, sources })
      if (sources.length && !sources.some((s) => s.id === selected)) setSelected(sources[0].id)
    }
    setReloadTick((n) => n + 1)
  }
  const onDrop = (e) => {
    setDragging(false)
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    addFiles(Array.from(e.dataTransfer.files))
  }
  // Sample rate of the current X axis, used to pick a sensible default Butterworth cutoff. A formula X
  // (say TIME_MS * 1e-3) is evaluated so the cutoff comes out in the units the formula produces.
  const currentFs = () => {
    let col = table?.cols[opts.x]
    if (opts.x === CUSTOM && table) {
      try {
        col = { kind: 'num', values: evaluateColumn(table, opts.xExpr) }
      } catch {
        col = null
      }
    }
    if (!col || col.kind === 'str') return 1
    return estimateFs(col.values.filter(Number.isFinite), col.kind)
  }
  const onFilterChange = (name) => {
    const spec = FILTERS[name]
    let fp1 = spec.p1?.def ?? opts.fp1
    if (name.endsWith('(Butterworth)'))
      fp1 = Number((currentFs() / (name.startsWith('Low') ? 20 : 200)).toPrecision(3))
    patch({ filter: name, fp1, fp2: spec.p2?.def ?? opts.fp2 })
  }
  // Keyboard: / file search, T theme, [ sidebar, Esc closes the drawer.
  const keys = useRef()
  useEffect(() => {
    keys.current = { patch, opts }
  })
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return
      const { patch, opts } = keys.current
      if (e.key === '/') setFileOpen(true)
      else if (e.key === 't' || e.key === 'T') patch({ theme: opts.theme === 'Dark' ? 'Light' : 'Dark' })
      else if (e.key === '[') setSidebar((s) => ({ ...s, collapsed: !s.collapsed }))
      else if (e.key === 'Escape') setDrawer(false)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Drag the divider to size the controls column; double-click it to go back to the default width.
  const startResize = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebar.width
    const move = (ev) => {
      const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX))
      setSidebar({ width, collapsed: false })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // the theme is applied at once so the plot fades together with the rest of the page, not 120 ms later
  const debounced = useDebounced(opts, 120)
  const dopts = useMemo(() => ({ ...debounced, theme: opts.theme }), [debounced, opts.theme])
  const figure = useMemo(() => {
    try {
      return buildFigure(table, dopts)
    } catch (e) {
      console.error(e)
      return { data: [], layout: {}, notes: [], message: `Could not draw this combination: ${e.message}` }
    }
  }, [table, dopts])
  const chips = useMemo(() => activeChips(opts), [opts])
  const status =
    loadMsg ||
    (table
      ? `${table.name}: ${table.n.toLocaleString()} rows × ${table.names.length} columns` +
        (figure.notes.length ? '   |   ' + figure.notes.join('; ') : '')
      : '')
  return (
    <div
      className="app"
      onDragOver={(e) => {
        // only a drag carrying files is a CSV drop; reordering traces drags text and must not show the overlay
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        <button className="btn menu-btn" onClick={() => setDrawer(true)}>
          ☰ Controls
        </button>
        <FileMenu
          sources={sources}
          selected={selected}
          onSelect={setSelected}
          folder={folder}
          canPickFolder={canPickFolder}
          actions={{ openFolder, openFiles: () => fileInput.current?.click(), reload }}
          open={fileOpen}
          setOpen={setFileOpen}
        />
        <span className="muted folder">{folder ? `in ${folder.name}` : ''}</span>
        <button
          className="btn theme-toggle"
          title={`Switch to ${opts.theme === 'Dark' ? 'light' : 'dark'} mode (T)`}
          onClick={() => patch({ theme: opts.theme === 'Dark' ? 'Light' : 'Dark' })}
        >
          {opts.theme === 'Dark' ? '☀ Light' : '☾ Dark'}
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept=".csv,.tsv,.txt,text/csv"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </header>

      <div
        className={['body', sidebar.collapsed && 'sidebar-collapsed', drawer && 'drawer-open']
          .filter(Boolean)
          .join(' ')}
        style={{ '--sidebar-w': `${sidebar.width}px` }}
      >
        <div className="backdrop" onClick={() => setDrawer(false)} />
        <aside className="sidebar">
          <ControlsTabs opts={opts} table={table} patch={patch} onFilterChange={onFilterChange} />
        </aside>
        <div
          className="resizer"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize · double-click to reset · [ to collapse"
          onPointerDown={startResize}
          onDoubleClick={() => setSidebar({ width: SIDEBAR_DEFAULT, collapsed: false })}
        >
          <button
            className="collapse"
            title={sidebar.collapsed ? 'Show controls ([)' : 'Hide controls ([)'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setSidebar((s) => ({ ...s, collapsed: !s.collapsed }))}
          >
            {sidebar.collapsed ? '›' : '‹'}
          </button>
        </div>
        <main className="main">
          <nav className="tabs">
            {['plot', 'data', 'stats'].map((t) => (
              <button key={t} className={main === t ? 'tab active' : 'tab'} onClick={() => setMain(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
          <div className="tab-card">
            <div className="view" hidden={main !== 'plot'}>
              <PlotView
                figure={figure}
                visible={main === 'plot'}
                chips={chips}
                onChip={(c) => patch(c.reset)}
              />
            </div>
            {main === 'data' && table && <DataTable table={table} />}
            {main === 'stats' && table && <StatsTable table={table} />}
            {main !== 'plot' && !table && <p className="muted pad">No file loaded.</p>}
          </div>
        </main>
      </div>

      <footer className="status" title={status}>
        <span className="status-text">{status}</span>
        <span className="shortcuts">/ files · ← → views · T theme · [ sidebar</span>
      </footer>
      {dragging && <div className="drop-overlay">Drop CSV files to add them</div>}
    </div>
  )
}
