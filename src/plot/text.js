import { splitRuns } from './math'

// Text on the canvas: labels made of ordinary text and typeset $...$ math.

export const TICK = 12

export const fontOf = (env, size, weight = 400) => `${weight} ${size}px ${env.font}`

// A label becomes runs of ordinary text and typeset math, each with its width; a math run that isn't ready yet
// (or failed to load) is drawn as its plain TeX.
function runsOf(ctx, env, text, size, color, weight = 400) {
  ctx.font = fontOf(env, size, weight)
  return splitRuns(text).map((run) => {
    if (run.tex !== undefined) {
      const m = env.math.get(run.tex, color, size)
      if (m) return { m, w: m.w, h: m.h }
      ctx.font = fontOf(env, size, weight)
      return { text: run.tex, w: ctx.measureText(run.tex).width, h: size }
    }
    return { text: run.text, w: ctx.measureText(run.text).width, h: size }
  })
}

export function measure(ctx, env, text, size, color) {
  const runs = runsOf(ctx, env, text, size, color)
  return { w: runs.reduce((sum, r) => sum + r.w, 0), h: Math.max(size, ...runs.map((r) => r.h)) }
}

// Draws a label anchored at (x, y); `align` is the horizontal anchor, and the text is vertically centered.
export function label(ctx, env, text, x, y, { size = TICK, color, align = 'left', rotate = 0, weight = 400 }) {
  const runs = runsOf(ctx, env, text, size, color, weight)
  const total = runs.reduce((sum, r) => sum + r.w, 0)
  const baseline = size * 0.35 // text is centered on y; this puts its baseline there
  ctx.save()
  ctx.translate(x, y)
  if (rotate) ctx.rotate(rotate)
  let at = align === 'center' ? -total / 2 : align === 'right' ? -total : 0
  ctx.font = fontOf(env, size, weight)
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const r of runs) {
    if (r.m) ctx.drawImage(r.m.img, at, baseline + r.m.descent - r.m.h, r.m.w, r.m.h)
    else ctx.fillText(r.text, at, baseline)
    at += r.w
  }
  ctx.restore()
}


/**
 * A small card next to (ax, ay): a heading and rows of text, each optionally with a colored dot. It stays
 * inside `bounds` (a { x, y, w, h } rectangle), flipping to the other side of the anchor when it would stick out.
 */
export function drawCard(ctx, env, colors, bounds, ax, ay, head, rows) {
  ctx.font = fontOf(env, TICK)
  const w = Math.max(ctx.measureText(head).width, ...rows.map((r) => ctx.measureText(r.text).width + (r.color ? 16 : 0))) + 20
  const h = 12 + (head ? 18 : 0) + rows.length * 17
  let x = ax + 14
  if (x + w > bounds.x + bounds.w) x = ax - 14 - w
  x = Math.max(bounds.x, x)
  const y = Math.min(Math.max(bounds.y, ay - h / 2), bounds.y + bounds.h - h)
  ctx.fillStyle = colors.paper
  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x + 0.5, y + 0.5, w, h, 6)
  ctx.fill()
  ctx.stroke()
  if (head) label(ctx, env, head, x + 10, y + 16, { color: colors.muted, weight: 600 })
  rows.forEach((r, k) => {
    const cy = y + 16 + (head ? 19 : 0) + k * 17
    if (r.color) {
      ctx.fillStyle = r.color
      ctx.beginPath()
      ctx.arc(x + 14, cy, 4, 0, 2 * Math.PI)
      ctx.fill()
    }
    label(ctx, env, r.text, x + (r.color ? 26 : 10), cy, { color: r.muted ? colors.muted : colors.font })
  })
}
