const DATA_FILE = /\.(csv|tsv)$/i
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'venv', '.venv'])
export const SAMPLE_ID = 'sample:hotfire'
export const sampleSource = () => ({
  id: SAMPLE_ID,
  label: 'Demo: hot-fire (sample data)',
  read: async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/hotfire_demo.csv`)
    if (!res.ok) throw new Error(`could not load the sample (${res.status})`)
    return res.text()
  },
})

export const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window

/** Recursively lists CSV/TSV files (3 levels deep, 500 max), like the desktop version did. */
export async function scanDirectory(root, maxDepth = 3, cap = 500) {
  const out = []
  const walk = async (dir, prefix, depth) => {
    const entries = []
    for await (const e of dir.values()) entries.push(e)
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (out.length >= cap) return
      if (e.kind === 'file') {
        if (DATA_FILE.test(e.name))
          out.push({
            id: prefix + e.name,
            label: prefix + e.name,
            read: async () => (await e.getFile()).text(),
          })
      } else if (depth < maxDepth && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) {
        await walk(e, prefix + e.name + '/', depth + 1)
      }
    }
  }
  await walk(root, '', 0)
  return out
}

export async function pickFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' })
    return { name: handle.name, handle, sources: await scanDirectory(handle) }
  } catch (e) {
    if (e.name === 'AbortError') return null
    throw e
  }
}

export const sourcesFromFiles = (files) =>
  files
    .filter((f) => /\.(csv|tsv|txt)$/i.test(f.name))
    .map((f) => ({ id: `file:${f.name}:${f.size}:${f.lastModified}`, label: f.name, read: () => f.text() }))
