import { useMemo, useRef, useState } from 'react'
import { chartFromFigure } from '../plot/chart'
import { CanvasPlot } from './CanvasPlot'

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

  const chart = useMemo(() => (shown ? chartFromFigure(shown) : null), [shown])
  const zoomable = chart && chart.kind !== 'matrix' // the scatter matrix has nothing to zoom or pan
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
          {zoomable && (
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
          )}
          {chart && (
            <button
              className="btn small"
              title="Save the plot as a PNG image"
              onClick={() => view.current?.exportPng()}
            >
              PNG
            </button>
          )}
          {zoomable && (
            <button
              className="btn small reset-view"
              title="Back to the full data range (double-clicking the plot does the same)"
              onClick={() => view.current?.reset()}
            >
              Reset zoom
            </button>
          )}
        </span>
      </div>
      <div className="plot-area">
        {chart && <CanvasPlot ref={view} chart={chart} mode={mode} active={visible} />}
        {figure.message && <div className="plot-message">{figure.message}</div>}
      </div>
    </div>
  )
}
