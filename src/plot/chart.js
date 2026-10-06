import { THEME_COLORS } from '../lib/plots'
import { isAscending } from './hover'

// The canvas renderer's input. buildFigure() still describes a plot as traces + layout (the shape the
// Plotly-drawn plot types use), so this reads that and produces a plain chart spec:
//
//   { revision, title, theme, grid, legend,
//     x: { type: 'linear'|'log'|'time'|'category', title, range, ticks, labels, angle, pad },
//     y: { type, title, range }, y2: null | { type, title, range },
//     series: [{ name, color, axis, x, y, mode, step, fill, width, size, alpha, ghost, inLegend, colors,
//                slot, slots, sorted }],
//     colorbar: null | { title, scale, cmin, cmax } }
//
// Ranges are in data units (null = fit the data), `ticks` is a fixed list of { vals, labels } for bar and
// category axes, and `pad` widens the fitted x range by that many data units each side (half a bar).

const AXIS_TYPES = { log: 'log', date: 'time', category: 'category' }

const toFloat = (a) => (a instanceof Float64Array ? a : Float64Array.from(a))

// Plotly stores a log axis range as exponents; the canvas works in data units.
const rangeOf = (axis, type) => {
  const r = axis?.range
  if (!r || !Number.isFinite(r[0]) || !Number.isFinite(r[1])) return null
  return type === 'log' ? [10 ** r[0], 10 ** r[1]] : [r[0], r[1]]
}

function axisOf(axis, type) {
  return { type, title: axis?.title?.text ?? '', range: rangeOf(axis, type) }
}

/** @param {object} fig what buildFigure() returned for a line-style or bar plot */
export function chartFromFigure(fig) {
  const { layout, data } = fig
  const xaxis = layout.xaxis ?? {}
  const xType = AXIS_TYPES[xaxis.type] ?? 'linear'
  const hasY2 = Boolean(layout.yaxis2)

  const categories = xaxis.type === 'category' ? xaxis.categoryarray : null
  const codes = categories ? new Map(categories.map((c, i) => [c, i])) : null
  const bars = data.filter((t) => t.type === 'bar')

  const series = data.map((t) => {
    const x = codes ? Float64Array.from(t.x, (v) => codes.get(v) ?? NaN) : toFloat(t.x)
    const y = toFloat(t.y)
    const isBar = t.type === 'bar'
    const colorArray = Array.isArray(t.marker?.color) || ArrayBuffer.isView(t.marker?.color)
    return {
      name: t.name ?? '',
      color: t.line?.color ?? (colorArray ? '#888888' : t.marker?.color) ?? '#888888',
      axis: hasY2 && t.yaxis === 'y2' ? 'y2' : 'y',
      x,
      y,
      mode: isBar ? 'bars' : (t.mode ?? 'lines'),
      step: t.line?.shape === 'hv',
      fill: t.fill === 'tozeroy' ? t.fillcolor : null,
      width: t.line?.width ?? 1.5,
      size: isBar ? 0 : (t.marker?.size ?? 6),
      alpha: t.opacity ?? 1,
      ghost: t.hoverinfo === 'skip',
      inLegend: t.showlegend !== false && t.hoverinfo !== 'skip',
      colors: colorArray
        ? { values: toFloat(t.marker.color), scale: t.marker.colorscale, cmin: t.marker.cmin, cmax: t.marker.cmax }
        : null,
      slot: isBar ? bars.indexOf(t) : 0,
      slots: bars.length,
      sorted: isAscending(x),
    }
  })

  const withScale = data.find((t) => t.marker?.showscale)
  const ticked = xaxis.tickmode === 'array'
  return {
    revision: layout.uirevision ?? '',
    title: layout.title?.text ?? '',
    theme: THEME_COLORS[fig.theme] ? fig.theme : 'Dark',
    colors: THEME_COLORS[fig.theme] ?? THEME_COLORS.Dark,
    grid: xaxis.showgrid !== false,
    legend: layout.showlegend !== false,
    x: {
      ...axisOf(xaxis, xType),
      labels: categories,
      ticks: ticked
        ? { vals: xaxis.tickvals, labels: xaxis.ticktext }
        : categories
          ? { vals: categories.map((_, i) => i), labels: categories }
          : null,
      angle: xaxis.tickangle ?? 0,
      pad: xType === 'category' || bars.length ? 0.5 : 0,
    },
    y: axisOf(layout.yaxis, layout.yaxis?.type === 'log' ? 'log' : 'linear'),
    y2: hasY2 ? axisOf(layout.yaxis2, layout.yaxis2.type === 'log' ? 'log' : 'linear') : null,
    series,
    colorbar: withScale
      ? {
          title: withScale.marker.colorbar?.title?.text ?? '',
          scale: withScale.marker.colorscale,
          cmin: withScale.marker.cmin,
          cmax: withScale.marker.cmax,
        }
      : null,
  }
}
