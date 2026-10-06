import Plotly from 'plotly.js-dist-min'
import { useEffect, useRef } from 'react'
import { layoutHasMath, loadMathJax } from '../lib/mathjax'

const CONFIG = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
  doubleClick: 'reset',
  toImageButtonOptions: { format: 'png', scale: 2, filename: 'plot' },
}

// Back to the full data range on every axis the plot has (the right axis only exists with R traces).
function resetView(el) {
  if (!el?.data) return
  const update = { 'xaxis.autorange': true, 'yaxis.autorange': true }
  if (el.layout.yaxis2) update['yaxis2.autorange'] = true
  void Plotly.relayout(el, update)
}

/**
 * The plot plus a slim bar above it: chips for anything quietly altering the data (filter, normalization,
 * log axes, limits — click to remove) and a reset-zoom button. When a combination can't be drawn, the last
 * good plot stays on screen dimmed under a banner instead of vanishing, so a half-typed formula doesn't make
 * the whole view flicker blank.
 */
export function PlotView({ figure, visible, chips, onChip }) {
  const ref = useRef(null)
  const wrap = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const failed = Boolean(figure.message) || !figure.data.length
    wrap.current?.classList.toggle('stale', failed && Boolean(el.data))
    if (failed) return

    // LaTeX in a title or axis label needs MathJax first; if it can't be fetched (offline) draw anyway and
    // the label just shows its raw text.
    let cancelled = false
    void (async () => {
      if (layoutHasMath(figure.layout)) await loadMathJax().catch(() => {})
      if (!cancelled) await Plotly.react(el, figure.data, figure.layout, CONFIG)
    })()
    return () => {
      cancelled = true
    }
  }, [figure])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const ro = new ResizeObserver(() => {
      if (el.offsetWidth > 0 && el.data) void Plotly.Plots.resize(el)
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      Plotly.purge(el)
    }
  }, [])

  useEffect(() => {
    if (visible && ref.current && ref.current.data) Plotly.Plots.resize(ref.current)
  }, [visible])

  return (
    <div className="plot-wrap" ref={wrap}>
      <div className="plot-bar">
        {chips.map((c) => (
          <button key={c.key} className="chip" title="Click to remove" onClick={() => onChip(c)}>
            {c.text} <span aria-hidden="true">×</span>
          </button>
        ))}
        <button
          className="btn small reset-view"
          title="Back to the full data range (double-click the plot does the same)"
          onClick={() => resetView(ref.current)}
        >
          Reset zoom
        </button>
      </div>
      <div className="plot-area">
        <div ref={ref} className="plot" />
        {figure.message && <div className="plot-message">{figure.message}</div>}
      </div>
    </div>
  )
}
