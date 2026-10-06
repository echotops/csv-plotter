// LaTeX ($...$) in titles and axis labels is typeset by MathJax, which is several MB, so it is fetched on
// demand — the first time a label actually contains a $...$ — and kept for the rest of the session.
const SRC = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js'

let loading = null

/** Whether the text has a $...$ span for MathJax to typeset. */
export const hasMath = (text) => typeof text === 'string' && /\$[^$]+\$/.test(text)

/**
 * Load MathJax once. Resolves when it is ready; rejects (and allows a retry later) when
 * the script can't be fetched, e.g. offline — the label then shows as plain text.
 */
export function loadMathJax() {
  if (window.MathJax?.startup?.promise) return window.MathJax.startup.promise
  if (loading) return loading

  // typeset: false stops MathJax from scanning and rewriting the whole page itself
  // fontCache 'none' makes every rendered SVG self-contained, so it can also be drawn onto a canvas as an image
  window.MathJax = { startup: { typeset: false }, svg: { fontCache: 'none' } }
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SRC
    script.async = true
    script.onload = () => resolve(window.MathJax.startup.promise)
    script.onerror = () => {
      script.remove()
      loading = null
      window.MathJax = undefined
      reject(new Error('Could not load MathJax'))
    }
    document.head.appendChild(script)
  })
  return loading
}
