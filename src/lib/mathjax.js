// Plotly typesets LaTeX ($...$) in titles and axis labels only when MathJax is on the page, and its
// bundle doesn't include MathJax (it is several MB). So it is fetched on demand — the first time a label
// actually contains a $...$ — and kept for the rest of the session.
const SRC = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js'

let loading = null

/** Whether the text has a $...$ span for MathJax to typeset. */
export const hasMath = (text) => typeof text === 'string' && /\$[^$]+\$/.test(text)

const ESCAPES = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '%': '\\%',
  '#': '\\#',
  '&': '\\&',
  _: '\\_',
  '^': '\\^{}',
  '~': '\\~{}',
}

/**
 * Plotly typesets a label either entirely as text or entirely as one math expression, so "Velocity
 * ($\frac{m}{s}$)" would lose its words. Rewrite mixed labels as a single expression with the plain parts
 * in \text{}: "$\text{Velocity (}\frac{m}{s}\text{)}$". Labels without a $...$ span come back untouched.
 *
 * @param {string} text - The label as the user typed it
 * @returns {string} The label in a form Plotly typesets correctly
 */
export function mixedToTex(text) {
  if (!hasMath(text)) return text

  const plain = (t) => (t ? `\\text{${t.replace(/[\\{}%#&_^~]/g, (c) => ESCAPES[c])}}` : '')
  const parts = text.split(/\$([^$]+)\$/)

  // split() with a capture group alternates plain text (even indices) and the captured math (odd indices)
  return `$${parts.map((p, i) => (i % 2 ? p : plain(p))).join('')}$`
}

const textOf = (title) => (typeof title === 'string' ? title : title?.text)

/** Whether any of a Plotly layout's titles / axis labels need MathJax. */
export function layoutHasMath(layout) {
  return [layout.title, layout.xaxis?.title, layout.yaxis?.title, layout.yaxis2?.title].some((t) =>
    hasMath(textOf(t)),
  )
}

/**
 * Load MathJax once. Resolves when it is ready for Plotly to use; rejects (and allows a retry later) when
 * the script can't be fetched, e.g. offline — the label then shows as plain text.
 */
export function loadMathJax() {
  if (window.MathJax?.startup?.promise) return window.MathJax.startup.promise
  if (loading) return loading

  // typeset: false stops MathJax from scanning and rewriting the whole page itself
  window.MathJax = { startup: { typeset: false } }
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
