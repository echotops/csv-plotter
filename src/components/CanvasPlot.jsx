import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { panRange, subRange, zoomRange } from '../plot/axis'
import { drawBase, drawChart, drawOverlay } from '../plot/draw'
import { cssEase, fadeMs } from '../plot/ease'
import { ViewHistory } from '../plot/history'
import { createMath } from '../plot/math'

// How far up the y axis (0 at its low end, 1 at its high end) a pixel row is. A heatmap's y axis runs
// downwards, with its first row at the top.
const yFrac = (geo, y) => (geo.flipY ? 1 : 0) + (geo.flipY ? -1 : 1) * (1 - (y - geo.plot.y) / geo.plot.h)

// A box-zoom drag shorter than this (px) in one direction zooms only along the other, like Plotly.
const MIN_BOX = 20

/**
 * What a box-zoom drag will do: which axes it zooms, and the box to show for it. A drag that is nearly flat
 * (or nearly upright) snaps to a band across the whole plot and zooms only that way; one that is small both
 * ways does nothing.
 */
function snapBox(box, plot) {
  const wide = Math.abs(box.x1 - box.x0) >= MIN_BOX
  const tall = Math.abs(box.y1 - box.y0) >= MIN_BOX
  if (!wide && !tall) return { useX: false, useY: false, box }
  return {
    useX: wide,
    useY: tall,
    box: {
      x0: wide ? box.x0 : plot.x,
      x1: wide ? box.x1 : plot.x + plot.w,
      y0: tall ? box.y0 : plot.y,
      y1: tall ? box.y1 : plot.y + plot.h,
    },
  }
}

// Which part of the plot a point is over: the plot itself or the strip of labels along an axis.
function regionAt(geo, x, y) {
  if (!geo) return null
  const p = geo.plot
  const inX = x >= p.x && x <= p.x + p.w
  const inY = y >= p.y && y <= p.y + p.h
  if (inX && inY) return 'plot'
  if (inX && y > p.y + p.h) return 'x'
  if (inY && x < p.x) return 'y'
  if (inY && geo.hasY2 && x > p.x + p.w && x < geo.cb?.x) return 'y2'
  return null
}

/**
 * The plot, drawn on a canvas. Drag to box-zoom (or pan, in Pan mode, or with Shift held), drag along an
 * axis to pan just that axis, scroll to zoom about the cursor (over an axis, only that axis; with Shift, only
 * x), double-click to reset. The zoom is remembered while `chart.revision` stays the same, and ← / → step back
 * and forward through the views you have been to (a new view after stepping back replaces the ones ahead).
 *
 * The ref exposes reset() and exportPng().
 */
export const CanvasPlot = forwardRef(function CanvasPlot({ chart, mode, active = true }, ref) {
  const wrap = useRef(null)
  const canvas = useRef(null)
  const state = useRef({
    chart,
    mode,
    view: {},
    history: new ViewHistory(),
    active,
    revision: chart.revision,
    hover: null,
    drag: null,
    geo: null,
    size: { w: 0, h: 0, dpr: 1 },
    frame: 0,
    fade: null,
    lastTheme: chart.theme,
    math: null,
    mathVersion: 0,
    base: null,
    baseKey: null,
  })

  // The paint routine lives in a ref so event handlers and the animation loop always call the latest one.
  const paint = useRef(null)
  const schedule = () => {
    const s = state.current
    if (!s.frame) s.frame = requestAnimationFrame(() => ((s.frame = 0), paint.current?.()))
  }
  paint.current = () => {
    const s = state.current
    const el = canvas.current
    if (!el || !s.size.w || !s.size.h) return
    const { w, h, dpr } = s.size
    const ctx = el.getContext('2d')
    const env = { font: getComputedStyle(el).fontFamily, math: (s.math ??= createMath(() => (s.mathVersion++, schedule()))) }
    const snapped = s.drag?.kind === 'box' && s.geo ? snapBox(s.drag.box, s.geo.plot) : null
    const ui = { hover: s.hover, box: snapped && { ...snapped.box, useX: snapped.useX, useY: snapped.useY } }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (s.fade) {
      // theme change: cross-fade from a snapshot of the old picture to the new one, on the same curve and
      // clock as the page's own color fade. The new picture is drawn once; each frame only blends the two.
      // the clock starts at the first painted frame, which is also when the page's CSS fade begins
      s.fade.t0 ??= performance.now()
      const k = (performance.now() - s.fade.t0) / s.fade.ms
      if (k < 1) {
        if (!s.fade.ready) {
          const nctx = s.fade.next.getContext('2d')
          nctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          s.geo = drawChart(nctx, s.chart, w, h, s.view, { hover: null, box: null }, env)
          s.fade.ready = true
        }
        ctx.globalAlpha = 1
        ctx.drawImage(s.fade.from, 0, 0, w, h)
        ctx.globalAlpha = cssEase(Math.max(0, k))
        ctx.drawImage(s.fade.next, 0, 0, w, h)
        ctx.globalAlpha = 1
        schedule()
        return
      }
      s.fade = null
    }
    // Hovering or dragging a zoom box only moves the overlay, so the data is drawn once into a picture and
    // reused until the chart, zoom, size or a typeset label changes.
    const k = s.baseKey
    if (!s.base || !k || k.chart !== s.chart || k.view !== s.view || k.w !== w || k.h !== h || k.dpr !== dpr || k.math !== s.mathVersion) {
      s.base ??= document.createElement('canvas')
      if (s.base.width !== el.width || s.base.height !== el.height) {
        s.base.width = el.width
        s.base.height = el.height
      }
      const bctx = s.base.getContext('2d')
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      s.geo = drawBase(bctx, s.chart, w, h, s.view, env)
      s.baseKey = { chart: s.chart, view: s.view, w, h, dpr, math: s.mathVersion }
    }
    ctx.drawImage(s.base, 0, 0, w, h)
    drawOverlay(ctx, s.chart, s.geo, ui, env)
  }

  useImperativeHandle(ref, () => ({
    reset() {
      const s = state.current
      s.view = {}
      s.history.record(s.view)
      schedule()
    },
    exportPng() {
      const s = state.current
      if (!s.size.w) return
      const out = document.createElement('canvas')
      const scale = 2
      out.width = s.size.w * scale
      out.height = s.size.h * scale
      const ctx = out.getContext('2d')
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      const env = { font: getComputedStyle(canvas.current).fontFamily, math: (s.math ??= createMath(schedule)) }
      drawChart(ctx, s.chart, s.size.w, s.size.h, s.view, { hover: null, box: null }, env)
      out.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'plot.png'
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/png')
    },
  }))

  // A new chart: keep the zoom while the plot's structure is the same, and fade when only the theme changed.
  useEffect(() => {
    const s = state.current
    if (chart.theme !== s.lastTheme && s.size.w && canvas.current) {
      const from = document.createElement('canvas')
      from.width = canvas.current.width
      from.height = canvas.current.height
      from.getContext('2d').drawImage(canvas.current, 0, 0)
      const next = document.createElement('canvas')
      next.width = from.width
      next.height = from.height
      s.fade = { from, next, t0: null, ms: fadeMs(), ready: false }
    }
    s.lastTheme = chart.theme
    if (chart.revision !== s.revision) {
      s.view = {}
      s.history.reset()
      s.revision = chart.revision
    }
    s.chart = chart
    schedule()
  }, [chart])

  useEffect(() => {
    state.current.mode = mode
    state.current.active = active
  }, [mode, active])

  // size: follow the container, drawing at the screen's pixel density
  useEffect(() => {
    const el = wrap.current
    const s = state.current
    const ro = new ResizeObserver(() => {
      const w = Math.floor(el.clientWidth)
      const h = Math.floor(el.clientHeight)
      const dpr = window.devicePixelRatio || 1
      if (!w || !h) return
      s.size = { w, h, dpr }
      canvas.current.width = Math.round(w * dpr)
      canvas.current.height = Math.round(h * dpr)
      schedule()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(s.frame)
      s.frame = 0
    }
  }, [])

  // scroll to zoom needs a non-passive listener so the page doesn't scroll as well
  useEffect(() => {
    const el = canvas.current
    const onWheel = (e) => {
      const s = state.current
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const where = s.chart.kind === 'matrix' ? null : regionAt(s.geo, x, y)
      if (!where) return
      e.preventDefault()
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      const factor = Math.min(2, Math.max(0.5, Math.exp(e.deltaY * lines * 0.0015)))
      const { plot, ranges, xs, ys, y2s } = s.geo
      const next = { ...s.view }
      const both = where === 'plot'
      if (where === 'x' || both) next.x = zoomRange(xs.type, ranges.x, factor, (x - plot.x) / plot.w)
      if (where === 'y' || (both && !e.shiftKey))
        next.y = zoomRange(ys.type, ranges.y, factor, yFrac(s.geo, y))
      if (y2s && (where === 'y2' || (both && !e.shiftKey)))
        next.y2 = zoomRange(y2s.type, ranges.y2, factor, yFrac(s.geo, y))
      s.view = next
      s.history.record(next, { merge: true }) // the steps of one scroll gesture count as one view
      schedule()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ← / → walk back and forth through the views, unless a text box or drop-down has the keys
  useEffect(() => {
    const onKey = (e) => {
      const s = state.current
      if (!s.active || s.drag || s.chart.kind === 'matrix' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return
      const view = e.key === 'ArrowLeft' ? s.history.back() : s.history.forward()
      e.preventDefault()
      if (!view) return
      s.view = view
      schedule()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const local = (e) => {
    const rect = canvas.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e) => {
    const s = state.current
    if (e.button !== 0 && e.button !== 1) return
    const { x, y } = local(e)
    const where = s.chart.kind === 'matrix' ? null : regionAt(s.geo, x, y)
    if (!where) return
    const panning = e.button === 1 || where !== 'plot' || s.mode === 'pan' || e.shiftKey || e.pointerType === 'touch'
    s.drag = {
      kind: panning ? 'pan' : 'box',
      where,
      x0: x,
      y0: y,
      ranges: s.geo.ranges,
      box: { x0: x, y0: y, x1: x, y1: y },
    }
    s.hover = null
    try {
      canvas.current.setPointerCapture(e.pointerId) // keeps the drag going outside the canvas
    } catch {
      // not an active pointer (or capture unsupported): the drag still works while inside the canvas
    }
    e.preventDefault()
    schedule()
  }

  const onPointerMove = (e) => {
    const s = state.current
    const { x, y } = local(e)
    const d = s.drag
    if (!d) {
      s.hover = { x, y }
      const where = s.chart.kind === 'matrix' ? null : regionAt(s.geo, x, y)
      canvas.current.style.cursor =
        where === 'plot' ? (s.mode === 'pan' ? 'grab' : 'crosshair') : where === 'x' ? 'ew-resize' : where ? 'ns-resize' : 'default'
      schedule()
      return
    }
    if (d.kind === 'box') {
      d.box = { x0: d.x0, y0: d.y0, x1: x, y1: y }
    } else {
      const { plot, xs, ys, y2s } = s.geo
      const next = { ...s.view }
      if (d.where !== 'y' && d.where !== 'y2') next.x = panRange(xs.type, d.ranges.x, -(x - d.x0) / plot.w)
      if (d.where !== 'x') {
        if (d.where !== 'y2') next.y = panRange(ys.type, d.ranges.y, (y - d.y0) / plot.h * (s.geo.flipY ? -1 : 1))
        if (y2s && d.where !== 'y') next.y2 = panRange(y2s.type, d.ranges.y2, (y - d.y0) / plot.h * (s.geo.flipY ? -1 : 1))
      }
      s.view = next
      canvas.current.style.cursor = 'grabbing'
    }
    schedule()
  }

  const onPointerUp = (e) => {
    const s = state.current
    const d = s.drag
    if (!d) return
    s.drag = null
    try {
      canvas.current.releasePointerCapture?.(e.pointerId)
    } catch {
      // the capture was already gone
    }
    if (d.kind === 'pan') s.history.record(s.view)
    if (d.kind === 'box' && s.geo) {
      const { plot, xs, ys, y2s } = s.geo
      const { useX, useY, box } = snapBox(d.box, plot)
      const clamp = (v) => Math.min(1, Math.max(0, v))
      const next = { ...s.view }
      if (useX) next.x = subRange(xs.type, d.ranges.x, clamp((box.x0 - plot.x) / plot.w), clamp((box.x1 - plot.x) / plot.w))
      if (useY) {
        const f0 = clamp(yFrac(s.geo, box.y0))
        const f1 = clamp(yFrac(s.geo, box.y1))
        next.y = subRange(ys.type, d.ranges.y, f0, f1)
        if (y2s) next.y2 = subRange(y2s.type, d.ranges.y2, f0, f1)
      }
      s.view = next
      s.history.record(next)
    }
    schedule()
  }

  const label = [chart.title, ...(chart.series ?? []).filter((s) => s.inLegend).map((s) => s.name)].filter(Boolean).join(': ')

  return (
    <div ref={wrap} className="canvas-wrap">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Plot — ${label}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          const s = state.current
          if (s.drag) return
          s.hover = null
          schedule()
        }}
        onDoubleClick={() => {
          const s = state.current
          s.view = {}
          s.history.record(s.view)
          schedule()
        }}
      />
    </div>
  )
})
