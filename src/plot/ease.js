/** A CSS-style cubic-bezier timing function, so canvas animations can move exactly like CSS transitions. */
export function cubicBezier(x1, y1, x2, y2) {
  const at = (s, a, b) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let lo = 0
    let hi = 1
    let s = t
    for (let i = 0; i < 24; i++) {
      if (at(s, x1, x2) < t) lo = s
      else hi = s
      s = (lo + hi) / 2
    }
    return at(s, y1, y2)
  }
}

/** CSS's default `ease`, which the page's own color fades use. */
export const cssEase = cubicBezier(0.25, 0.1, 0.25, 1)

/** The page's color-fade time (the --fade variable) in milliseconds. */
export function fadeMs(fallback = 200) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--fade').trim()
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return fallback
  return raw.endsWith('ms') ? n : n * 1000
}
