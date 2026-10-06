import { THEME_COLORS } from '../lib/plots'
import { isAscending } from './hover'
import { boxStats, density } from './stats'

// The canvas renderer's input. buildFigure() describes a plot as traces + layout (the vocabulary Plotly used,
// which is still a handy way to say "a bar trace with these x, y and width"), and this turns that into a plain
// chart spec:
//
//   { revision, title, theme, colors, grid, legend, hover: 'x' | 'cell',
//     x: { type: 'linear'|'log'|'time'|'category', title, range, ticks, labels, angle, pad },
//     y: { type, title, range, ticks, reversed, pad }, y2: null | { type, title, range },
//     series: [{ name, color, axis, x, y, mode, step, fill, width, size, alpha, ghost, inLegend, colors,
//                slot, slots, sorted, barWidth, stats, profile, grid, readout }],
//     colorbar: null | { title, scale, cmin, cmax } }
//
// Ranges are in data units (null = fit the data), `ticks` is a fixed list of { vals, labels } for bar, group
// and heatmap axes, and `pad` widens the fitted range by that many data units each side (half a bar).
// A scatter matrix is a different shape ({ kind: 'matrix', ... }, see matrixChart).
//
// Series `mode`: 'lines', 'markers', 'lines+markers', 'bars', 'box', 'violin' or 'heatmap'. Series x and y are
// always the points the autorange has to cover; for box, violin and heatmap series they are just the extent.

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

const baseOf = (fig) => ({
  revision: fig.layout.uirevision ?? '',
  title: fig.layout.title?.text ?? '',
  theme: THEME_COLORS[fig.theme] ? fig.theme : 'Dark',
  colors: THEME_COLORS[fig.theme] ?? THEME_COLORS.Dark,
  grid: fig.layout.xaxis?.showgrid !== false,
  legend: fig.layout.showlegend !== false,
  hover: 'x',
})

const SERIES_DEFAULTS = {
  axis: 'y',
  step: false,
  fill: null,
  width: 1.5,
  size: 0,
  alpha: 1,
  ghost: false,
  inLegend: false,
  colors: null,
  slot: 0,
  slots: 1,
  sorted: true,
  barWidth: 0,
}

const indices = (n) => Array.from({ length: n }, (_, i) => i)

/** Box and violin plots: one group per trace along a labelled axis, the values along the y axis. */
function groupChart(fig) {
  const { layout, data } = fig
  const names = data.map((t) => t.name ?? '')
  const series = data.map((t, i) => {
    const values = Float64Array.from(t.y)
    const stats = boxStats(values)
    const color = t.line?.color ?? '#888888'
    const isBox = t.type === 'box'
    const showPoints = isBox && t.boxpoints === 'outliers'
    const profile = isBox ? null : density(values)
    // the extent the y axis has to cover
    const reach = isBox
      ? [stats.lo, stats.hi, ...(showPoints && stats.outliers.length ? [stats.outliers[0], stats.outliers[stats.outliers.length - 1]] : [])]
      : [profile.ys[0], profile.ys[profile.ys.length - 1]]
    const mean = ['mean', stats.mean]
    return {
      ...SERIES_DEFAULTS,
      name: names[i],
      color,
      alpha: 1,
      mode: isBox ? 'box' : 'violin',
      x: Float64Array.from(reach, () => i),
      y: Float64Array.from(reach),
      slot: i,
      slots: data.length,
      inLegend: false,
      stats: { ...stats, showPoints },
      profile,
      fill: isBox ? null : t.fillcolor,
      readout: isBox
        ? [['max', stats.max], ['q3', stats.q3], ['median', stats.median], ['q1', stats.q1], ['min', stats.min]]
        : [['max', stats.max], ['mean', mean[1]], ['median', stats.median], ['min', stats.min]],
    }
  })
  return {
    ...baseOf(fig),
    legend: false,
    x: {
      type: 'category',
      title: layout.xaxis?.title?.text ?? '',
      range: null,
      labels: names,
      ticks: { vals: indices(names.length), labels: names },
      angle: 0,
      pad: 0.5,
    },
    y: axisOf(layout.yaxis, layout.yaxis?.type === 'log' ? 'log' : 'linear'),
    y2: null,
    series,
    colorbar: null,
  }
}

/** The 2D histogram and the correlation heatmap: a grid of colored cells. */
function heatmapChart(fig) {
  const { layout } = fig
  const t = fig.data[0]
  const categoricalX = typeof t.x[0] === 'string'
  const categoricalY = typeof t.y[0] === 'string'
  const xs = categoricalX ? Float64Array.from(t.x, (_, i) => i) : Float64Array.from(t.x)
  const ys = categoricalY ? Float64Array.from(t.y, (_, i) => i) : Float64Array.from(t.y)
  const nx = xs.length
  const ny = ys.length
  const z = new Float64Array(nx * ny)
  let lo = Infinity
  let hi = -Infinity
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const v = t.z[r][c]
      const value = v === null || v === undefined ? NaN : v
      z[r * nx + c] = value
      if (Number.isFinite(value)) {
        lo = Math.min(lo, value)
        hi = Math.max(hi, value)
      }
    }
  }
  const dx = nx > 1 ? xs[1] - xs[0] : 1
  const dy = ny > 1 ? ys[1] - ys[0] : 1
  const cmin = t.zmin ?? (Number.isFinite(lo) ? lo : 0)
  const cmax = t.zmax ?? (Number.isFinite(hi) ? hi : 1)
  const zName = t.colorbar?.title?.text ?? ''
  const series = [
    {
      ...SERIES_DEFAULTS,
      name: zName,
      color: '#888888',
      mode: 'heatmap',
      x: Float64Array.of(xs[0] - dx / 2, xs[nx - 1] + dx / 2),
      y: Float64Array.of(ys[0] - dy / 2, ys[ny - 1] + dy / 2),
      grid: {
        xs,
        ys,
        z,
        nx,
        ny,
        dx,
        dy,
        cmin,
        cmax,
        scale: t.colorscale,
        gap: t.xgap ?? 0,
        showText: Boolean(t.texttemplate),
        xLabels: categoricalX ? t.x : null,
        yLabels: categoricalY ? t.y : null,
        zName,
      },
    },
  ]
  const axis = (def, categorical, labels, angle) => ({
    ...axisOf(def, 'linear'),
    type: categorical ? 'category' : 'linear',
    labels: categorical ? labels : null,
    ticks: categorical ? { vals: indices(labels.length), labels } : null,
    angle,
    pad: 0,
  })
  return {
    ...baseOf(fig),
    legend: false,
    hover: 'cell',
    x: axis(layout.xaxis, categoricalX, t.x, layout.xaxis?.tickangle ?? 0),
    y: { ...axis(layout.yaxis, categoricalY, t.y, 0), reversed: layout.yaxis?.autorange === 'reversed' },
    y2: null,
    series,
    colorbar: { title: zName, scale: t.colorscale, cmin, cmax },
  }
}

/** The scatter matrix: every pair of columns plotted against each other in a grid. */
function matrixChart(fig) {
  const t = fig.data[0]
  return {
    ...baseOf(fig),
    kind: 'matrix',
    legend: false,
    labels: t.dimensions.map((d) => d.label),
    columns: t.dimensions.map((d) => Float64Array.from(d.values)),
    color: t.marker.color,
    size: t.marker.size,
    alpha: t.marker.opacity,
  }
}

/** @param {object} fig what buildFigure() returned */
export function chartFromFigure(fig) {
  if (fig.kind === 'Scatter matrix') return matrixChart(fig)
  if (fig.kind === 'Box' || fig.kind === 'Violin') return groupChart(fig)
  if (fig.kind === '2D histogram' || fig.kind === 'Correlation heatmap') return heatmapChart(fig)
  const { layout, data } = fig
  const xaxis = layout.xaxis ?? {}
  const xType = AXIS_TYPES[xaxis.type] ?? 'linear'
  const hasY2 = Boolean(layout.yaxis2)

  const categories = xaxis.type === 'category' ? xaxis.categoryarray : null
  const codes = categories ? new Map(categories.map((c, i) => [c, i])) : null
  // a bar trace with a width is a histogram (bars on top of each other); without one, bars sit side by side
  const bars = data.filter((t) => t.type === 'bar' && t.width === undefined)

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
      slot: isBar ? Math.max(0, bars.indexOf(t)) : 0,
      slots: Math.max(1, bars.length),
      barWidth: isBar && t.width !== undefined ? t.width : 0,
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
