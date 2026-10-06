/**
 * expression
 *
 * A small recursive-descent parser/compiler for custom formulas over CSV
 * columns ("chamber_psi - tank_psi", "time_ms * 1e-3", "sin(2*pi*time_s)").
 * Adapted from the dx/dt and dy/dt parser in vector-fields: raw eval() is
 * never used, the text is parsed once into an AST and compiled into a
 * closure, and that closure is then run once per row. Where vector-fields
 * closes over x and y, this closes over a row index and looks column
 * names up in the loaded table.
 *
 * Identifiers resolve, in order, to: a column (exact name, then
 * case-insensitive), the row number (`index` / `row`), then the constants
 * pi and e. Names that contain spaces or punctuation can be wrapped in
 * [brackets], "double quotes", 'single quotes' or `backticks`.
 */

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  hypot: Math.hypot,
}

// Functions that accept any number of arguments (everything else has a fixed arity).
const VARIADIC = new Set(['min', 'max', 'hypot'])

const CONSTANTS = {
  pi: Math.PI,
  e: Math.E,
}

export const FUNCTION_NAMES = Object.keys(FUNCTIONS)

const QUOTES = { '[': ']', '"': '"', "'": "'", '`': '`' }

/**
 * Split an expression string into a list of tokens
 *
 * @param {string} input - The expression to tokenize
 * @returns {array} The list of tokens, ending with an 'eof' token
 */
function tokenize(input) {
  const tokens = []
  let i = 0

  while (i < input.length) {
    const c = input[i]

    if (/\s/.test(c)) {
      i++
      continue
    }

    if (/[0-9.]/.test(c)) {
      const start = i
      while (i < input.length && /[0-9.]/.test(input[i])) i++

      if (input[i] === 'e' || input[i] === 'E') {
        let j = i + 1
        if (input[j] === '+' || input[j] === '-') j++
        if (/[0-9]/.test(input[j])) {
          i = j
          while (i < input.length && /[0-9]/.test(input[i])) i++
        }
      }

      // Number() rather than parseFloat() so "1.5.2" is an error instead of silently reading as 1.5.
      const text = input.slice(start, i)
      const value = Number(text)
      if (Number.isNaN(value)) throw new Error(`Malformed number '${text}'`)

      tokens.push({ type: 'num', value })
      continue
    }

    if (/[a-zA-Z_]/.test(c)) {
      const start = i
      while (i < input.length && /[a-zA-Z_0-9]/.test(input[i])) i++
      tokens.push({ type: 'ident', name: input.slice(start, i) })
      continue
    }

    if (c in QUOTES) {
      const end = input.indexOf(QUOTES[c], i + 1)
      if (end < 0) throw new Error(`Missing closing ${QUOTES[c]} for column name`)

      const name = input.slice(i + 1, end).trim()
      if (!name) throw new Error('Empty column name')

      tokens.push({ type: 'ident', name, quoted: true })
      i = end + 1
      continue
    }

    if (c === '*' && input[i + 1] === '*') {
      tokens.push({ type: '^' }) // ** is an alias for ^
      i += 2
      continue
    }

    if ('+-*/%^(),'.includes(c)) {
      tokens.push({ type: c })
      i++
      continue
    }

    throw new Error(`Unexpected character '${c}' in formula`)
  }

  tokens.push({ type: 'eof' })
  return tokens
}

/**
 * Parse a token list into an expression AST
 *
 * @param {array} tokens - The tokens produced by tokenize()
 * @returns {object} The root node of the expression AST
 */
function parseTokens(tokens) {
  let pos = 0

  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function expect(type) {
    if (peek().type !== type) {
      throw new Error(
        `Expected '${type}' but found '${peek().type === 'eof' ? 'end of formula' : peek().type}'`,
      )
    }
    return next()
  }

  function parseExpression() {
    let node = parseTerm()

    while (peek().type === '+' || peek().type === '-') {
      const op = next().type
      node = { type: 'binary', op, left: node, right: parseTerm() }
    }

    return node
  }

  function parseTerm() {
    let node = parseUnary()

    while (peek().type === '*' || peek().type === '/' || peek().type === '%') {
      const op = next().type
      node = { type: 'binary', op, left: node, right: parseUnary() }
    }

    return node
  }

  function parseUnary() {
    if (peek().type === '-' || peek().type === '+') {
      const op = next().type
      return { type: 'unary', op, arg: parseUnary() }
    }

    return parsePower()
  }

  function parsePower() {
    const base = parsePrimary()

    if (peek().type === '^') {
      next()
      return { type: 'binary', op: '^', left: base, right: parseUnary() }
    }

    return base
  }

  function parsePrimary() {
    const token = peek()

    if (token.type === 'num') {
      next()
      return { type: 'num', value: token.value }
    }

    if (token.type === '(') {
      next()
      const node = parseExpression()
      expect(')')
      return node
    }

    if (token.type === 'ident') {
      next()

      if (!token.quoted && peek().type === '(') {
        next()
        const args = [parseExpression()]
        while (peek().type === ',') {
          next()
          args.push(parseExpression())
        }
        expect(')')
        return { type: 'call', name: token.name, args }
      }

      return { type: 'ident', name: token.name }
    }

    throw new Error(`Unexpected '${token.type === 'eof' ? 'end of formula' : token.type}' in formula`)
  }

  const ast = parseExpression()
  expect('eof')
  return ast
}

/**
 * Compile an expression AST into a closure over a row index
 *
 * @param {object} node - An AST node produced by parseTokens()
 * @param {function} lookup - (name) => Float64Array column, or undefined if there is no such column
 * @returns {function} A function (i) => number
 */
function compile(node, lookup) {
  switch (node.type) {
    case 'num': {
      const value = node.value
      return () => value
    }

    case 'ident': {
      const column = lookup(node.name)
      if (column) return (i) => column[i]

      if (!node.quoted) {
        const lower = node.name.toLowerCase()
        if (lower === 'index' || lower === 'row') return (i) => i

        if (lower in CONSTANTS) {
          const value = CONSTANTS[lower]
          return () => value
        }
      }

      throw new Error(`Unknown column '${node.name}'`)
    }

    case 'unary': {
      const arg = compile(node.arg, lookup)
      return node.op === '-' ? (i) => -arg(i) : arg
    }

    case 'binary': {
      const left = compile(node.left, lookup)
      const right = compile(node.right, lookup)

      switch (node.op) {
        case '+':
          return (i) => left(i) + right(i)
        case '-':
          return (i) => left(i) - right(i)
        case '*':
          return (i) => left(i) * right(i)
        case '/':
          return (i) => left(i) / right(i)
        case '%':
          return (i) => left(i) % right(i)
        case '^':
          return (i) => Math.pow(left(i), right(i))
      }

      throw new Error(`Unknown operator '${node.op}'`)
    }

    case 'call': {
      const fn = FUNCTIONS[node.name.toLowerCase()]
      if (!fn) throw new Error(`Unknown function '${node.name}'`)

      const args = node.args.map((arg) => compile(arg, lookup))
      if (!VARIADIC.has(node.name.toLowerCase()) && args.length !== fn.length) {
        throw new Error(`'${node.name}' expects ${fn.length} argument(s), got ${args.length}`)
      }

      if (args.length === 1) {
        const [a] = args
        return (i) => fn(a(i))
      }

      return (i) => fn(...args.map((arg) => arg(i)))
    }
  }

  throw new Error(`Unknown node type '${node.type}'`)
}

/**
 * Find a numeric column by name: exact match first, then a unique case-insensitive match.
 * Time columns are usable too (their values are epoch milliseconds).
 *
 * @param {object} table - The loaded table
 * @param {string} name - The identifier as written in the formula
 * @returns {Float64Array|undefined} The column's values, or undefined if there is no such column
 */
function findColumn(table, name) {
  let key = table.names.includes(name) ? name : undefined

  if (key === undefined) {
    const lower = name.toLowerCase()
    const matches = table.names.filter((n) => n.toLowerCase() === lower)
    if (matches.length === 1) key = matches[0]
  }

  if (key === undefined) return undefined

  const col = table.cols[key]
  if (col.kind === 'str') throw new Error(`Column '${key}' is text, so it can't be used in a formula`)

  return col.values
}

/**
 * Parse and compile a formula into a fast closure over a row index
 *
 * @param {string} input - The formula, e.g. "chamber_psi - tank_psi"
 * @param {object} table - The loaded table that column names are looked up in
 * @returns {function} A function (i) => number
 */
export function compileExpression(input, table) {
  if (!input.trim()) throw new Error('Enter a formula')
  return compile(parseTokens(tokenize(input)), (name) => findColumn(table, name))
}

// Evaluating a formula over a million rows takes a moment, and the figure is rebuilt on every
// settings change — so results are remembered per table (the entry vanishes with the table).
const cache = new WeakMap()

/**
 * Evaluate a formula for every row of a table
 *
 * @param {object} table - The loaded table
 * @param {string} input - The formula
 * @returns {Float64Array} One value per row (NaN/Infinity where the math is undefined)
 * @throws {Error} If the formula doesn't parse or refers to something that doesn't exist
 */
export function evaluateColumn(table, input) {
  const key = input.trim()

  let perTable = cache.get(table)
  if (!perTable) cache.set(table, (perTable = new Map()))

  let entry = perTable.get(key)
  if (!entry) {
    try {
      const fn = compileExpression(key, table)
      const values = new Float64Array(table.n)
      for (let i = 0; i < table.n; i++) values[i] = fn(i)
      entry = { values }
    } catch (error) {
      entry = { error }
    }
    perTable.set(key, entry)
  }

  if (entry.error) throw entry.error
  return entry.values
}

/**
 * Check a formula without evaluating it (cheap enough to run on every keystroke)
 *
 * @param {object} table - The loaded table
 * @param {string} input - The formula
 * @returns {string} An error message, or '' if the formula is valid
 */
export function checkExpression(table, input) {
  if (!input.trim()) return ''
  if (!table) return 'Load a file first'

  try {
    compileExpression(input, table)
    return ''
  } catch (error) {
    return error.message
  }
}
