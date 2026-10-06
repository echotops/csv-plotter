import { FUNCTION_NAMES } from './expression'

const MAX_ITEMS = 8
const WORDS = ['index', 'pi', 'e']

// Names that aren't plain identifiers have to be bracketed inside a formula.
export const asRef = (name) => (/^[A-Za-z_]\w*$/.test(name) ? name : `[${name}]`)

/**
 * What to suggest for the word being typed at `caret`, and which part of the text it would replace.
 * Returns null when there is nothing worth offering (no word under the caret, or no match).
 * Inside an unclosed `[` only column names are offered; elsewhere columns come first, then functions.
 *
 * @param {string} text formula text
 * @param {number} caret cursor position in `text`
 * @param {string[]} columns names of the columns a formula can use
 * @returns {{ start: number, end: number, items: { label: string, insert: string, kind: string }[] } | null}
 */
export function completionsAt(text, caret, columns) {
  const before = text.slice(0, caret)
  const open = before.lastIndexOf('[')
  const inBracket = open > before.lastIndexOf(']')
  let start
  let query
  if (inBracket) {
    start = open
    query = before.slice(open + 1)
  } else {
    const word = /[A-Za-z_]\w*$/.exec(before)
    if (!word) return null
    start = word.index
    query = word[0]
    // the "e" in 1e3 or 2.5e-3 is part of a number, not a name
    if (/[\d.]$/.test(before.slice(0, start))) return null
  }
  const q = query.toLowerCase()
  const starts = (s) => s.toLowerCase().startsWith(q)
  const items = columns
    .filter((c) => (inBracket ? c.toLowerCase().includes(q) : starts(c)))
    .map((c) => ({ label: c, insert: asRef(c), kind: 'column' }))
  if (!inBracket) {
    for (const w of WORDS) if (starts(w)) items.push({ label: w, insert: w, kind: 'constant' })
    for (const f of FUNCTION_NAMES) if (starts(f)) items.push({ label: `${f}()`, insert: `${f}(`, kind: 'function' })
  }
  // a name that is already typed out in full needs no suggestion
  if (items.length === 1 && !inBracket && items[0].insert === query) return null
  if (!items.length) return null
  const end = inBracket && text[caret] === ']' ? caret + 1 : caret
  return { start, end, items: items.slice(0, MAX_ITEMS) }
}

/** The text and caret position after taking `item` in place of the word that `completionsAt` found. */
export function applyCompletion(text, completion, item) {
  const next = text.slice(0, completion.start) + item.insert + text.slice(completion.end)
  return { text: next, caret: completion.start + item.insert.length }
}
