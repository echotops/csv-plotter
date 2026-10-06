import { describe, expect, it } from 'vitest'
import { parseCsv, parseTime } from './csv'

const kinds = (t) => t.names.map((n) => `${n}:${t.cols[n].kind}`)

describe('parseCsv', () => {
  it('reads a plain header + numeric table', () => {
    const t = parseCsv('time_s,psi,phase\n0.0,15.5,ignition\n0.1,20.25,burn\n0.2,,burn\n', 'x.csv')
    expect(t.n).toBe(3)
    expect(kinds(t)).toEqual(['time_s:num', 'psi:num', 'phase:str'])
    const psi = t.cols.psi.values
    expect(psi[0]).toBe(15.5)
    expect(Number.isNaN(psi[2])).toBe(true)
  })
  it('detects semicolon delimiters and headerless files', () => {
    const t = parseCsv('0;1.5;2\n0.1;1.6;3\n0.2;1.7;4\n', 'x')
    expect(t.names).toEqual(['col_0', 'col_1', 'col_2'])
    expect(t.n).toBe(3)
    expect(t.cols.col_1.values[2]).toBe(1.7)
  })
  it('detects tab and pipe delimiters', () => {
    expect(parseCsv('a\tb\n1\t2\n3\t4', 'x').names).toEqual(['a', 'b'])
    expect(parseCsv('a|b\n1|2\n3|4', 'x').names).toEqual(['a', 'b'])
  })
  it('parses ISO timestamps as UTC epoch ms, including date-only and offsets', () => {
    const t = parseCsv('timestamp,v\n2026-10-03 14:00:00,1\n2026-10-03T14:00:30,2\n', 'x')
    expect(t.cols.timestamp.kind).toBe('time')
    const v = t.cols.timestamp.values
    expect(v[0]).toBe(Date.UTC(2026, 9, 3, 14, 0, 0))
    expect(v[1] - v[0]).toBe(30000)
    expect(parseTime('2026-10-03')).toBe(Date.UTC(2026, 9, 3))
    expect(parseTime('2026-10-03T14:00:00Z')).toBe(Date.UTC(2026, 9, 3, 14))
    expect(parseTime('2026-10-03T14:00:00-04:00')).toBe(Date.UTC(2026, 9, 3, 18))
  })
  it('parses US dates, slash dates and clock times; rejects junk', () => {
    expect(parseTime('01/02/2026 10:05:00')).toBe(Date.UTC(2026, 0, 2, 10, 5))
    expect(parseTime('2026/01/02')).toBe(Date.UTC(2026, 0, 2))
    expect(parseTime('10:05:30.5')).toBe(((10 * 60 + 5) * 60 + 30) * 1000 + 500)
    expect(Number.isNaN(parseTime('hello'))).toBe(true)
    expect(Number.isNaN(parseTime('13/45/2026'))).toBe(true)
    expect(Number.isNaN(parseTime('02/31/2026'))).toBe(true)
    expect(Number.isNaN(parseTime('25:00:00'))).toBe(true)
  })
  it('keeps plain integers (like years) numeric, not dates', () => {
    const t = parseCsv('year,v\n2024,1\n2025,2\n', 'x')
    expect(kinds(t)).toEqual(['year:num', 'v:num'])
  })
  it('dedupes header names and fills blank ones', () => {
    const t = parseCsv('a,a,,a\n1,2,3,4\n', 'x')
    expect(t.names).toEqual(['a', 'a_2', 'col_2', 'a_3'])
  })
  it('treats NA/null/blank tokens as missing', () => {
    const t = parseCsv('v\n1\nNA\nnull\n\n2\nN/A\nnan\n', 'x')
    const v = Array.from(t.cols.v.values)
    expect(t.n).toBe(6) // the blank line is skipped, not read as a missing value
    expect(v.filter(Number.isNaN).length).toBe(4)
    expect(t.cols.v.kind).toBe('num')
  })
  it('handles quotes, escaped quotes and embedded delimiters/newlines', () => {
    const t = parseCsv('name,note\n"Smith, J","said ""hi"""\n"multi\nline",ok\n', 'x')
    expect(t.n).toBe(2)
    const names = t.cols.name.values
    expect(names[0]).toBe('Smith, J')
    expect(t.cols.note.values[0]).toBe('said "hi"')
    expect(names[1]).toBe('multi\nline')
  })
  it('handles CRLF, BOM, comment lines, blank lines, ragged rows', () => {
    const text =
      '﻿# exported by DAQ\r\ndate,value,count\r\n\r\n01/02/2026 10:00:00,1.5,3\r\n01/02/2026 10:05:00,2.5\r\n01/02/2026 10:10:00,,7\r\n01/02/2026 10:15:00,3.5,9,extra\r\n'
    const t = parseCsv(text, 'x')
    expect(t.n).toBe(4)
    expect(t.names).toEqual(['date', 'value', 'count', 'col_3'])
    expect(t.cols.date.kind).toBe('time')
    expect(t.cols.col_3.values[3]).toBe('extra')
    expect(Number.isNaN(t.cols.count.values[1])).toBe(true)
  })
  it('falls back to text when a column mixes numbers and words', () => {
    const t = parseCsv('v\n1\ntwo\n3\n', 'x')
    expect(t.cols.v.kind).toBe('str')
  })
  it('errors clearly on empty or header-only input', () => {
    expect(() => parseCsv('', 'x')).toThrow(/no data/)
    expect(() => parseCsv('a,b\n', 'x')).toThrow(/no data/)
  })
  it('parses a million rows quickly', () => {
    const n = 1_000_000
    const parts = ['t,sig,walk']
    for (let i = 0; i < n; i++)
      parts.push(`${(i * 1e-3).toFixed(5)},${Math.sin(i / 100).toFixed(5)},${(i % 977).toFixed(5)}`)
    const text = parts.join('\n')
    const t0 = performance.now()
    const t = parseCsv(text, 'big')
    const ms = performance.now() - t0
    expect(t.n).toBe(n)
    expect(ms).toBeLessThan(6000)
  }, 60000)
})
