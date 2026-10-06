import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { layoutHasMath, loadMathJax, texLayout } from '../lib/mathjax'
import { XY_KINDS } from '../lib/types'
import { chartFromFigure } from '../plot/chart'
import { CanvasPlot } from './CanvasPlot'

// Plotly is big, and only the plot types the canvas plot doesn't draw yet (distributions, heatmaps, the
// scatter matrix) need it, so it is fetched the first time one of those is shown.
let plotly = null
let plotlyLoading = null
const loadPlotly = () =>
  (plotlyLoading ??= import('plotly.js-dist-min').then((m) => (plotly = m.default)))

const CONFIG = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
  doubleClick: 'reset',
  toImageButtonOptions: { format: 'png', scale: 2, filename: 'plot' },
}

// Back to the full data range on every axis the plot has (the right axis only exists with R traces).
function resetView(el) {
  if (!el?.data || !plotly) return
  const update = { 'xaxis.autorange': true, 'yaxis.autorange': true }
  if (el.layout.yaxis2) update['yaxis2.autorange'] = true
  void plotly.relayout(el, update)
}

const PlotlyView = forwardRef(function PlotlyView({ figure, visible }, ref) {
  const el = useRef(null)

  useImperativeHandle(ref, () => ({ reset: () => resetView(el.current) }))

  useEffect(() => {
    const node = el.current
    if (!node) return
    // LaTeX in a title or axis label needs MathJax first; if it can't be fetched (offline) draw anyway and
    // the label just shows its raw text.
    let cancelled = false
    void (async () => {
      const Plotly = await loadPlotly()
      if (layoutHasMath(figure.layout)) await loadMathJax().catch(() => {})
      if (!cancelled) await Plotly.react(node, figure.data, texLayout(figure.layout), CONFIG)
    })()
    return () => {
      cancelled = true
    }
  }, [figure])

  useEffect(() => {
    const node = el.current
    const ro = new ResizeObserver(() => {
      if (node.offsetWidth > 0 && node.data && plotly) void plotly.Plots.resize(node)
    })
    ro.observe(node)
    return () => {
      ro.disconnect()
      plotly?.purge(node)
    }
  }, [])

  useEffect(() => {
    if (visible && el.current?.data && plotly) plotly.Plots.resize(el.current)
  }, [visible])

  return <div ref={el} className="plot" />
})

/**
 * The plot plus a slim bar above it: chips for anything quietly altering the data (filter, normalization,
 * log axes, limits — click to remove) and the view controls. When a combination can't be drawn, the last
 * good plot stays on screen dimmed under a banner instead of vanishing, so a half-typed formula doesn't make
 * the whole view flicker blank.
 */
export function PlotView({ figure, visible, chips, onChip }) {
  const failed = Boolean(figure.message) || !figure.data.length
  const [good, setGood] = useState(null)
  if (!failed && good !== figure) setGood(figure)
  const shown = failed ? good : figure

  const canvas = shown && XY_KINDS.includes(shown.kind)
  const chart = useMemo(() => (canvas ? chartFromFigure(shown) : null), [canvas, shown])
  const [mode, setMode] = useState('zoom')
  const view = useRef(null)

  return (
    <div className={failed && shown ? 'plot-wrap stale' : 'plot-wrap'}>
      <div className="plot-bar">
        {chips.map((c) => (
          <button key={c.key} className="chip" title="Click to remove" onClick={() => onChip(c)}>
            {c.text} <span aria-hidden="true">×</span>
          </button>
        ))}
        <span className="plot-tools">
          {canvas && (
            <>
              <span className="seg" role="group" aria-label="Drag action">
                {[
                  ['zoom', 'Zoom', 'Drag a box to zoom in (hold Shift to pan)'],
                  ['pan', 'Pan', 'Drag to move the view'],
                ].map(([id, text, tip]) => (
                  <button
                    key={id}
                    className={mode === id ? 'btn small on' : 'btn small'}
                    aria-pressed={mode === id}
                    title={tip}
                    onClick={() => setMode(id)}
                  >
                    {text}
                  </button>
                ))}
              </span>
              <button
                className="btn small"
                title="Save the plot as a PNG image"
                onClick={() => view.current?.exportPng()}
              >
                PNG
              </button>
            </>
          )}
          <button
            className="btn small reset-view"
            title="Back to the full data range (double-clicking the plot does the same)"
            onClick={() => view.current?.reset()}
          >
            Reset zoom
          </button>
        </span>
      </div>
      <div className="plot-area">
        {chart && <CanvasPlot ref={view} chart={chart} mode={mode} active={visible} />}
        {shown && !canvas && <PlotlyView ref={view} figure={shown} visible={visible} />}
        {figure.message && <div className="plot-message">{figure.message}</div>}
      </div>
    </div>
  )
}
