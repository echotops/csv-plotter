import { useLayoutEffect, useRef, useState } from 'react'
import { applyCompletion, asRef, completionsAt } from '../lib/autocomplete'
import { normalizeColor } from '../lib/color'
import { moveItem } from '../lib/list'
import { checkExpression, FUNCTION_NAMES } from '../lib/expression'
import { FILTER_NAMES, FILTERS } from '../lib/filters'
import { colorwayFor } from '../lib/plots'
import {
  AXIS2_KINDS,
  COLORMAPS,
  CUSTOM,
  FILTER_KINDS,
  HINTS,
  INDEX,
  KINDS,
  MAX_TRACES,
  NONE,
  NORMS,
  XY_KINDS,
} from '../lib/types'

const Field = ({ label, children }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
)

function NumInput({ value, onChange, min, max, step, disabled }) {
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)

  // The value can also change from outside (e.g. picking a filter resets its parameters), and the box
  // has to follow. Done while rendering rather than in an effect so the stale text never gets painted.
  if (value !== seen) {
    setSeen(value)
    if (Number(text) !== value) setText(String(value))
  }

  return (
    <input
      type="number"
      className="num"
      value={text}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value)
        const v = e.target.valueAsNumber
        if (Number.isFinite(v)) onChange(v)
      }}
    />
  )
}

const TextInput = ({ value, onChange, placeholder }) => (
  <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
)

// A native color picker (like vector-fields) plus a box to type an exact value into. The box takes hex
// ("#2ca02c", "2ca02c", "#2c0") or rgb ("rgb(44, 160, 44)", "44,160,44"); clearing it goes back to the
// palette color the trace started with. `value` is '' when the trace is on its default color.
function ColorInput({ value, fallback, onChange }) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)

  // Follow outside changes (the picker, a reset, switching files) — but leave the box alone when it already
  // describes this color, otherwise typing "rgb(44, 160, 4" would be rewritten to hex mid-keystroke.
  if (value !== seen) {
    setSeen(value)
    if ((normalizeColor(text) ?? '') !== value) setText(value)
  }

  return (
    <>
      <input
        type="color"
        className="color-picker"
        value={normalizeColor(value) ?? fallback}
        title="Pick a color"
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        className="color-text"
        value={text}
        placeholder={fallback}
        spellCheck={false}
        title="Type a hex or rgb color, like #2ca02c or 44,160,44. Clear it to reset."
        onChange={(e) => {
          setText(e.target.value)
          const hex = normalizeColor(e.target.value)
          if (hex) onChange(hex)
          else if (e.target.value.trim() === '') onChange('')
        }}
        onBlur={() => setText(value)}
      />
    </>
  )
}

// Text box for a formula, with the parser's complaint shown underneath as you type. Typing a word offers
// matching columns and functions; Tab (or Enter) takes the highlighted one, ↑/↓ move, Esc dismisses.
function FormulaInput({ value, onChange, table, placeholder }) {
  const error = checkExpression(table, value)
  const input = useRef(null)
  const pendingCaret = useRef(null)
  const [caret, setCaret] = useState(0)
  const [pick, setPick] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const columns = table ? table.names.filter((n) => table.cols[n].kind !== 'str') : []
  const completion = dismissed ? null : completionsAt(value, caret, columns)
  const active = completion ? Math.min(pick, completion.items.length - 1) : 0

  // after taking a suggestion the caret has to land behind it, once React has put the new text in the box
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !input.current) return
    input.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  })

  const sync = (el) => {
    setCaret(el.selectionStart ?? el.value.length)
    setDismissed(false)
  }
  const accept = (item) => {
    const next = applyCompletion(value, completion, item)
    pendingCaret.current = next.caret
    setCaret(next.caret)
    setPick(0)
    onChange(next.text)
  }

  return (
    <div className="formula-block">
      <input
        ref={input}
        type="text"
        className={error ? 'formula input-error' : 'formula'}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-expanded={Boolean(completion)}
        aria-autocomplete="list"
        onChange={(e) => {
          sync(e.target)
          setPick(0)
          onChange(e.target.value)
        }}
        onSelect={(e) => setCaret(e.target.selectionStart ?? 0)}
        onBlur={() => setDismissed(true)}
        onKeyDown={(e) => {
          if (!completion) return
          if (e.key === 'Tab' || e.key === 'Enter') {
            if (e.shiftKey) return
            e.preventDefault()
            accept(completion.items[active])
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = completion.items.length
            setPick((active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDismissed(true)
          }
        }}
      />
      {completion && (
        <ul className="suggest" role="listbox">
          {completion.items.map((item, k) => (
            <li
              key={item.label}
              role="option"
              aria-selected={k === active}
              className={k === active ? 'on' : undefined}
              // mousedown, not click: the box must keep focus or its blur handler would close the list first
              onMouseDown={(e) => {
                e.preventDefault()
                accept(item)
              }}
            >
              <span>{item.label}</span>
              <span className="muted">{item.kind}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="formula-error">{error}</div>}
    </div>
  )
}

const numericNames = (t) => (t ? t.names.filter((n) => t.cols[n].kind === 'num') : [])

function nextTraceColumn(opts, table) {
  if (!table) return NONE
  const used = new Set([...opts.traces.map((t) => t.col), opts.x])
  return numericNames(table).find((c) => !used.has(c)) ?? NONE
}

function FormulaHelp() {
  return (
    <details className="help">
      <summary>Formula help</summary>
      <p>
        A formula is computed for every row. Use column names (case doesn't matter) with{' '}
        <code>+ - * / % ^</code> and parentheses — e.g. <code>chamber_psi - tank_psi</code>,{' '}
        <code>TIME_MS * 1e-3</code> or <code>sin(2*pi*time_s)</code>.
      </p>
      <p>
        Wrap names containing spaces or punctuation in brackets: <code>[sensor A] / [pressure (psi)]</code>.
        <br />
        <code>index</code> is the row number; <code>pi</code> and <code>e</code> are constants. A date column
        counts as milliseconds since 1970.
      </p>
      <p>Functions: {FUNCTION_NAMES.join(', ')}</p>
    </details>
  )
}

// A titled group of controls; the small caps heading is what breaks a long panel into scannable chunks.
const Section = ({ title, children }) => (
  <section className="section">
    <h3>{title}</h3>
    {children}
  </section>
)

// One trace: a compact row (drag handle, show/hide swatch, column, axis, expand, remove) and, when expanded,
// the color controls. A formula box always shows under a formula trace, since that's the thing being edited.
function TraceRow({
  t,
  i,
  n,
  color,
  fallback,
  names,
  axisOn,
  table,
  placeholder,
  drag,
  onChange,
  onRemove,
  onMove,
}) {
  const open = Boolean(t.open)
  return (
    <div
      className={['trace', t.hidden && 'is-hidden', drag.over === i && 'drop-here'].filter(Boolean).join(' ')}
      onDragOver={(e) => {
        if (drag.from === null) return
        e.preventDefault()
        drag.setOver(i)
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (drag.from !== null) onMove(drag.from, i)
        drag.end()
      }}
    >
      <div className="trace-row">
        <button
          className="grip"
          draggable
          title="Drag to reorder (or focus and press Alt+↑ / Alt+↓)"
          aria-label={`Reorder trace ${i + 1}`}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(i))
            e.dataTransfer.setDragImage(e.currentTarget.closest('.trace'), 12, 12)
            drag.start(i)
          }}
          onDragEnd={drag.end}
          onKeyDown={(e) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
            e.preventDefault()
            onMove(i, i + (e.key === 'ArrowUp' ? -1 : 1))
          }}
        >
          ⠿
        </button>
        <button
          className="swatch"
          style={{ '--swatch': color }}
          aria-pressed={!t.hidden}
          title={t.hidden ? 'Hidden — click to show this trace' : 'Click to hide this trace'}
          onClick={() => onChange({ hidden: !t.hidden })}
        />
        <select value={t.col} onChange={(e) => onChange({ col: e.target.value })}>
          {[NONE, ...names, CUSTOM].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button
          className="btn small axis-btn"
          disabled={!axisOn}
          title={
            t.side === 'L'
              ? 'On the left axis — click for the right axis'
              : 'On the right axis — click for the left axis'
          }
          onClick={() => onChange({ side: t.side === 'L' ? 'R' : 'L' })}
        >
          {t.side}
        </button>
        <button
          className={open ? 'btn small icon open' : 'btn small icon'}
          aria-expanded={open}
          title="Name and color"
          onClick={() => onChange({ open: !open })}
        >
          ▾
        </button>
        <button className="btn small icon" disabled={n <= 1} title="Remove trace" onClick={onRemove}>
          −
        </button>
      </div>
      {open && (
        <div className="trace-more">
          <label className="trace-more-row">
            <span className="muted">Name</span>
            <input
              type="text"
              className="trace-name"
              value={t.name ?? ''}
              placeholder={t.col === CUSTOM ? t.expr.trim() || 'legend name' : t.col}
              title="Legend name for this trace. Clear it to go back to the column name."
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </label>
          <div className="trace-more-row">
            <span className="muted">Color</span>
            <ColorInput value={t.color} fallback={fallback} onChange={(c) => onChange({ color: c })} />
          </div>
        </div>
      )}
      {t.col === CUSTOM && (
        <FormulaInput
          value={t.expr}
          onChange={(expr) => onChange({ expr })}
          table={table}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}

export function PlotPanel({ opts, table, patch }) {
  const [dragFrom, setDragFrom] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const names = table?.names ?? []
  const numeric = numericNames(table)
  const setTrace = (i, p) => patch({ traces: opts.traces.map((t, k) => (k === i ? { ...t, ...p } : t)) })
  const axisOn = AXIS2_KINDS.includes(opts.kind)
  const n = opts.traces.length
  const colorway = colorwayFor(opts.theme)

  // Reordering changes which palette slot a trace sits in, which would recolor it — so every trace keeps
  // the color it is showing now (clearing a color box still resets it to the palette).
  const reorder = (from, to) => {
    if (from === to) return
    const baked = opts.traces.map((t, k) => ({ ...t, color: t.color || colorway[k % colorway.length] }))
    patch({ traces: moveItem(baked, from, to) })
  }
  const drag = {
    from: dragFrom,
    over: dragOver,
    start: setDragFrom,
    setOver: setDragOver,
    end: () => {
      setDragFrom(null)
      setDragOver(null)
    },
  }

  // Example text built from the file's own columns (skipping whichever one is already the X axis).
  const examples = numeric.filter((c) => c !== opts.x)
  const xPlaceholder = `e.g. ${asRef(numeric[0] ?? 'col1')} * 1e-3`
  const yPlaceholder = `e.g. ${asRef(examples[0] ?? 'col1')} - ${asRef(examples[1] ?? 'col2')}`
  const anyFormula = opts.x === CUSTOM || opts.traces.some((t) => t.col === CUSTOM)

  return (
    <div className="panel">
      <Section title="Plot">
        <Field label="Plot type">
          <select value={opts.kind} onChange={(e) => patch({ kind: e.target.value })}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <p className="muted hint">{HINTS[opts.kind]}</p>

        <Field label="X axis">
          <select
            value={opts.x}
            onChange={(e) => patch({ x: e.target.value })}
            disabled={!(XY_KINDS.includes(opts.kind) || opts.kind === '2D histogram')}
          >
            {[INDEX, ...names, CUSTOM].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        {opts.x === CUSTOM && (
          <FormulaInput
            value={opts.xExpr}
            onChange={(xExpr) => patch({ xExpr })}
            table={table}
            placeholder={xPlaceholder}
          />
        )}
      </Section>

      <Section title="Traces (Y)">
        <div className="trace-head">
          <span className="muted">
            {n}/{MAX_TRACES} · click a swatch to show/hide
          </span>
          <button
            className="btn small"
            disabled={n >= MAX_TRACES}
            onClick={() =>
              patch({
                traces: [
                  ...opts.traces,
                  { col: nextTraceColumn(opts, table), side: 'L', expr: '', color: '' },
                ],
              })
            }
          >
            + Add
          </button>
        </div>
        {opts.traces.map((t, i) => (
          <TraceRow
            key={i}
            t={t}
            i={i}
            n={n}
            color={normalizeColor(t.color) ?? colorway[i % colorway.length]}
            fallback={colorway[i % colorway.length]}
            names={names}
            axisOn={axisOn}
            table={table}
            placeholder={yPlaceholder}
            drag={drag}
            onChange={(p) => setTrace(i, p)}
            onRemove={() => patch({ traces: opts.traces.filter((_, k) => k !== i) })}
            onMove={reorder}
          />
        ))}
        {anyFormula && <FormulaHelp />}

        <Field label="Color by (scatter)">
          <select
            value={opts.colorBy}
            disabled={opts.kind !== 'Scatter'}
            onChange={(e) => patch({ colorBy: e.target.value })}
          >
            {[NONE, ...numeric].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </Section>
    </div>
  )
}

export function StylePanel({ opts, patch }) {
  const check = (label, key, disabled = false) => (
    <label className="check">
      <input
        type="checkbox"
        checked={opts[key]}
        disabled={disabled}
        onChange={(e) => patch({ [key]: e.target.checked })}
      />
      {label}
    </label>
  )
  const lim = (key, i) => (
    <input
      type="text"
      className="lim"
      value={opts[key][i]}
      placeholder="auto"
      onChange={(e) =>
        patch({ [key]: i === 0 ? [e.target.value, opts[key][1]] : [opts[key][0], e.target.value] })
      }
    />
  )
  return (
    <div className="panel">
      <Section title="Labels">
        <Field label="Title">
          <TextInput value={opts.title} onChange={(title) => patch({ title })} placeholder="file name" />
        </Field>
        <Field label="X label">
          <TextInput value={opts.xlabel} onChange={(xlabel) => patch({ xlabel })} placeholder="auto" />
        </Field>
        <Field label="Y label">
          <TextInput value={opts.ylabel} onChange={(ylabel) => patch({ ylabel })} placeholder="auto" />
        </Field>
        <p className="muted hint">
          LaTeX works between dollar signs, e.g. <code>{'Velocity ($\\frac{m}{s}$)'}</code>. The first use
          loads MathJax from the internet.
        </p>
      </Section>

      <Section title="Marks">
        <div className="grid2">
          <span>Line width</span>
          <NumInput value={opts.lw} min={0.25} max={10} step={0.25} onChange={(lw) => patch({ lw })} />
          <span>Marker size</span>
          <NumInput value={opts.ms} min={1} max={30} step={1} onChange={(ms) => patch({ ms })} />
          <span>Opacity</span>
          <NumInput
            value={opts.alpha}
            min={0.05}
            max={1}
            step={0.05}
            onChange={(alpha) => patch({ alpha })}
          />
          <span>Bins</span>
          <NumInput
            value={opts.bins}
            min={3}
            max={500}
            step={5}
            onChange={(bins) => patch({ bins })}
            disabled={!['Histogram', '2D histogram'].includes(opts.kind)}
          />
        </div>
      </Section>

      <Section title="Display">
        <div className="checks">
          {check('Grid', 'grid')}
          {check('Legend', 'legend')}
          {check('Log X', 'logx')}
          {check('Log Y', 'logy')}
          {check('Density (histogram)', 'density', opts.kind !== 'Histogram')}
        </div>
      </Section>

      <Section title="Axes">
        <fieldset className="limits">
          <legend>Axis limits (blank = auto)</legend>
          <span>X</span>
          {lim('xlim', 0)}
          <span>to</span>
          {lim('xlim', 1)}
          <span>Y</span>
          {lim('ylim', 0)}
          <span>to</span>
          {lim('ylim', 1)}
        </fieldset>

        <Field label="Colormap">
          <select value={opts.cmap} onChange={(e) => patch({ cmap: e.target.value })}>
            {COLORMAPS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </Section>
    </div>
  )
}

export function ProcessPanel({ opts, patch, onFilterChange }) {
  const spec = FILTERS[opts.filter]
  const enabled = FILTER_KINDS.includes(opts.kind)
  return (
    <div className="panel">
      <Section title="Filter">
        <Field label="Filter / denoise">
          <select value={opts.filter} disabled={!enabled} onChange={(e) => onFilterChange(e.target.value)}>
            {FILTER_NAMES.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </Field>
        <p className="muted hint">{spec.desc}</p>
        {(spec.p1 || spec.p2) && (
          <div className="grid2">
            {spec.p1 && (
              <>
                <span>{spec.p1.label}</span>
                <NumInput
                  value={opts.fp1}
                  min={spec.p1.min}
                  max={spec.p1.max}
                  step={spec.p1.step}
                  disabled={!enabled}
                  onChange={(fp1) => patch({ fp1 })}
                />
              </>
            )}
            {spec.p2 && (
              <>
                <span>{spec.p2.label}</span>
                <NumInput
                  value={opts.fp2}
                  min={spec.p2.min}
                  max={spec.p2.max}
                  step={spec.p2.step}
                  disabled={!enabled}
                  onChange={(fp2) => patch({ fp2 })}
                />
              </>
            )}
          </div>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={opts.showRaw}
            disabled={!enabled || opts.filter === 'None'}
            onChange={(e) => patch({ showRaw: e.target.checked })}
          />
          Show unfiltered data faintly underneath
        </label>
        <p className="muted hint">
          Filters run on each trace in row order, after normalization, on line-style plots (Line, Line +
          markers, Step, Area). Blank cells are dropped first.
        </p>
      </Section>

      <Section title="Normalize">
        <Field label="Normalize each series">
          <select value={opts.norm} onChange={(e) => patch({ norm: e.target.value })}>
            {NORMS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Performance">
        <Field label="Max plotted points per series">
          <NumInput
            value={opts.maxPts}
            min={1000}
            max={5000000}
            step={10000}
            onChange={(maxPts) => patch({ maxPts })}
          />
        </Field>
        <p className="muted hint">
          Longer series are decimated for drawing (min/max per bucket, so spikes survive). Statistics and
          filters always use every sample.
        </p>
      </Section>
    </div>
  )
}
