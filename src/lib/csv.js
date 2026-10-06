const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none'])
const DELIMS = [',', ';', '\t', '|']
const isMissing = (s) => MISSING.has(s.trim().toLowerCase())

function sniffDelimiter(text) {
  const lines = text
    .slice(0, 16384)
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
    .slice(0, 20)
  let best = ','
  let bestScore = -1
  for (const d of DELIMS) {
    const counts = lines.map((l) => l.split(d).length - 1)
    const tally = new Map()
    for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1)
    let mode = 0
    let modeLines = 0
    for (const [c, k] of tally) {
      if (c > 0 && k > modeLines) {
        mode = c
        modeLines = k
      }
    }
    if (mode === 0) continue
    const score = modeLines * 1000 + mode
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/** Column-major split of delimited text. Handles quotes, CRLF, comment lines and blank lines. */
export function parseColumns(text, delim) {
  const cols = []
  const D = delim.charCodeAt(0)
  const n = text.length
  let rows = 0
  let i = 0
  const row = []
  while (i < n) {
    // skip blank lines and '#' comment lines
    let k = i
    while (k < n && (text.charCodeAt(k) === 32 || text.charCodeAt(k) === 9) && text.charCodeAt(k) !== D) k++
    const c0 = text.charCodeAt(k)
    if (c0 === 10 || c0 === 13) {
      i = k + 1
      continue
    }
    if (c0 === 35 /* # */) {
      while (k < n && text.charCodeAt(k) !== 10 && text.charCodeAt(k) !== 13) k++
      i = k
      continue
    }
    row.length = 0
    for (;;) {
      let val
      if (text.charCodeAt(i) === 34) {
        let j = i + 1
        let out = ''
        for (;;) {
          const q = text.indexOf('"', j)
          if (q < 0) {
            out += text.slice(j)
            i = n
            break
          }
          out += text.slice(j, q)
          if (text.charCodeAt(q + 1) === 34) {
            out += '"'
            j = q + 2
          } else {
            i = q + 1
            break
          }
        }
        val = out
        while (i < n) {
          const ch = text.charCodeAt(i)
          if (ch === D || ch === 10 || ch === 13) break
          i++
        }
      } else {
        let j = i
        while (j < n) {
          const ch = text.charCodeAt(j)
          if (ch === D || ch === 10 || ch === 13) break
          j++
        }
        val = text.slice(i, j)
        i = j
      }
      row.push(val)
      if (i >= n) break
      const ch = text.charCodeAt(i)
      if (ch === D) {
        i++
        if (i >= n) {
          row.push('')
          break
        }
        continue
      }
      i += ch === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1
      break
    }
    if (row.every((v) => v.trim() === '')) continue
    while (cols.length < row.length) cols.push(new Array(rows).fill(''))
    for (let c = 0; c < cols.length; c++) cols[c].push(c < row.length ? row[c] : '')
    rows++
  }
  return cols
}

const TIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/
const YMD_SLASH_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/
const CLOCK_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/
const frac = (f) => (f ? Number('0.' + f) * 1000 : 0)

function utc(y, mo, d, h = '0', mi = '0', sec = '0', f) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || +h > 23 || +mi > 59 || +sec > 59) return NaN
  const t = Date.UTC(y, mo - 1, d, +h, +mi, +sec)
  // reject impossible dates like Feb 31 that Date.UTC would silently roll over
  return new Date(t).getUTCDate() === d ? t + frac(f) : NaN
}

/** Epoch milliseconds, treating timezone-less timestamps as UTC so axis labels match the file. */
export function parseTime(raw) {
  const s = raw.trim().replace(/Z$/, '')
  if (ISO_RE.test(s)) {
    const hasTz = /[+-]\d{2}:?\d{2}$/.test(s)
    const iso = s.replace(' ', 'T')
    return Date.parse(hasTz || iso.length === 10 ? iso : iso + 'Z')
  }
  let m = TIME_RE.exec(s)
  if (m) return utc(+m[3], +m[1], +m[2], m[4], m[5], m[6], m[7])
  m = YMD_SLASH_RE.exec(s)
  if (m) return utc(+m[1], +m[2], +m[3], m[4], m[5], m[6], m[7])
  m = CLOCK_RE.exec(s)
  if (m && +m[1] < 24 && +m[2] < 60 && +(m[3] ?? 0) < 60)
    return ((+m[1] * 60 + +m[2]) * 60 + +(m[3] ?? 0)) * 1000 + frac(m[4])
  return NaN
}

function toNumber(s) {
  const t = s.trim()
  if (t.length > 1 && t.charCodeAt(0) === 48 && /[xXbBoO]/.test(t[1])) return NaN
  return Number(t)
}

export function convertColumn(vals) {
  const n = vals.length
  const nums = new Float64Array(n)
  let ok = true
  for (let i = 0; i < n; i++) {
    const v = vals[i]
    if (isMissing(v)) {
      nums[i] = NaN
      continue
    }
    const x = toNumber(v)
    if (Number.isNaN(x)) {
      ok = false
      break
    }
    nums[i] = x
  }
  if (ok) return { kind: 'num', values: nums }
  const times = new Float64Array(n)
  ok = true
  let any = false
  for (let i = 0; i < n; i++) {
    const v = vals[i]
    if (isMissing(v)) {
      times[i] = NaN
      continue
    }
    const t = parseTime(v)
    if (Number.isNaN(t)) {
      ok = false
      break
    }
    times[i] = t
    any = true
  }
  if (ok && any) return { kind: 'time', values: times }
  return { kind: 'str', values: vals.map((v) => v.trim()) }
}

export function parseCsv(text, name) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const cols = parseColumns(text, sniffDelimiter(text))
  if (cols.length === 0 || cols[0].length === 0) throw new Error('file has no data rows')
  const rowCount = cols[0].length
  const first = cols.map((c) => c[0])
  const headerless = rowCount > 1 && first.every((c) => c.trim() === '' || !Number.isNaN(toNumber(c)))
  const names = []
  let data
  if (headerless) {
    for (let i = 0; i < cols.length; i++) names.push(`col_${i}`)
    data = cols
  } else {
    first.forEach((c, i) => {
      let nm = c.trim() || `col_${i}`
      const base = nm
      let k = 2
      while (names.includes(nm)) nm = `${base}_${k++}`
      names.push(nm)
    })
    data = cols.map((c) => c.slice(1))
    if (data[0].length === 0) throw new Error('file has a header but no data rows')
  }
  const table = { name, n: data[0].length, names, cols: {} }
  names.forEach((nm, i) => (table.cols[nm] = convertColumn(data[i])))
  return table
}
