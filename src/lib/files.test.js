import { describe, expect, it } from 'vitest'
import { scanDirectory, sourcesFromFiles } from './files'

const file = (name, body = 'a,b\n1,2\n') => ({
  kind: 'file',
  name,
  getFile: async () => new File([body], name),
})

const dir = (name, ...children) => ({
  kind: 'directory',
  name,
  async *values() {
    for (const c of children) yield c
  },
})

describe('scanDirectory', () => {
  it('finds csv/tsv recursively, sorted, ignoring other files, hidden and junk folders', async () => {
    const root = dir(
      'data',
      file('b.csv'),
      file('a.CSV'),
      file('notes.txt'),
      file('image.png'),
      file('t.tsv'),
      dir('run1', file('hot.csv'), dir('deeper', file('x.csv'))),
      dir('.git', file('hidden.csv')),
      dir('node_modules', file('dep.csv')),
      dir('__pycache__', file('c.csv')),
    )
    const found = await scanDirectory(root)
    expect(found.map((s) => s.label)).toEqual([
      'a.CSV',
      'b.csv',
      'run1/deeper/x.csv',
      'run1/hot.csv',
      't.tsv',
    ])
  })
  it('stops descending after 3 levels', async () => {
    const l4 = dir('l4', file('too_deep.csv'))
    const root = dir(
      'r',
      file('top.csv'),
      dir('l1', file('one.csv'), dir('l2', file('two.csv'), dir('l3', file('three.csv'), l4))),
    )
    const labels = (await scanDirectory(root)).map((s) => s.label)
    expect(labels).toContain('l1/l2/l3/three.csv')
    expect(labels).not.toContain('l1/l2/l3/l4/too_deep.csv')
  })
  it('caps the list and reads file contents lazily', async () => {
    const many = Array.from({ length: 700 }, (_, i) =>
      file(`f${String(i).padStart(3, '0')}.csv`, `v\n${i}\n`),
    )
    const found = await scanDirectory(dir('big', ...many))
    expect(found.length).toBe(500)
    expect(await found[7].read()).toBe('v\n7\n')
  })
})

describe('sourcesFromFiles', () => {
  it('keeps csv/tsv/txt only and reads their text', async () => {
    const s = sourcesFromFiles([new File(['x'], 'a.csv'), new File(['y'], 'b.pdf'), new File(['z'], 'c.txt')])
    expect(s.map((x) => x.label)).toEqual(['a.csv', 'c.txt'])
    expect(await s[0].read()).toBe('x')
  })
})
