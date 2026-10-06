import { hasMath, loadMathJax } from '../lib/mathjax'

// LaTeX in titles and axis labels, for the canvas plot. Only the parts between dollar signs are math: MathJax
// typesets each one to an SVG, which is turned into an image once and then drawn inline with the ordinary text
// around it. (To get the math font for words too, put them inside the math: $\text{words}$.) Until an image is
// ready, or if MathJax can't be fetched (offline), the math is drawn as plain text.

// TeX's x-height is 0.43 em, and MathJax sizes its SVG in "ex"
// (scaled up a touch so it sits level with sans-serif text, whose x-height is taller)
const EX_PER_EM = 0.4306 * 1.12
const SCALE = Math.max(2, typeof devicePixelRatio === 'number' ? Math.ceil(devicePixelRatio) : 2)

/**
 * A label as a list of runs: ordinary text and $...$ math, in order. "abcde $3 + 2$" is the text "abcde "
 * followed by the math "3 + 2"; a label with no math is a single text run.
 *
 * @returns {({ text: string } | { tex: string })[]}
 */
export function splitRuns(text) {
  if (!hasMath(text)) return text ? [{ text }] : []
  return text
    .split(/\$([^$]+)\$/)
    .map((part, i) => (i % 2 ? { tex: part } : { text: part }))
    .filter((run) => run.tex !== undefined || run.text !== '')
}

function typeset(tex, color, px) {
  const node = window.MathJax.tex2svg(tex, { display: false })
  const svg = node.querySelector('svg')
  if (!svg) throw new Error('MathJax produced no SVG')
  const ex = px * EX_PER_EM
  // MathJax lifts or lowers the SVG so its baseline lines up with the text around it
  const lowered = parseFloat(/vertical-align:\s*(-?[\d.]+)ex/.exec(svg.getAttribute('style') ?? '')?.[1] ?? '0')
  const w = parseFloat(svg.getAttribute('width')) * ex
  const h = parseFloat(svg.getAttribute('height')) * ex
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('width', String(w * SCALE))
  svg.setAttribute('height', String(h * SCALE))
  svg.removeAttribute('style')
  const markup = new XMLSerializer().serializeToString(svg).replaceAll('currentColor', color)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ img, w, h, descent: -lowered * ex })
    img.onerror = () => reject(new Error('could not load typeset label'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })
}

/**
 * A cache of typeset labels. `get` returns { img, w, h, descent } (CSS pixels; `descent` is how far the image
 * hangs below the text baseline) once a label is ready, and
 * null while it is still being typeset or if that failed; `onReady` is called whenever a new one arrives so
 * the plot can redraw.
 */
export function createMath(onReady) {
  const cache = new Map()
  return {
    get(tex, color, px) {
      const key = `${px}|${color}|${tex}`
      const hit = cache.get(key)
      if (hit) return hit.ready ?? null
      const entry = { ready: null }
      cache.set(key, entry)
      loadMathJax()
        .then(() => typeset(tex, color, px))
        .then((r) => {
          entry.ready = r
          onReady()
        })
        .catch(() => {
          // stays null: the label is drawn as plain text
        })
      return null
    },
  }
}
