import { useEffect, useRef, useState } from 'react'

/**
 * The file picker as one compact chip showing the current file; clicking it (or pressing /) opens a
 * searchable list of the loaded files with the open / reload actions underneath. Replaces a wide drop-down
 * plus a row of buttons, so the top bar stays one quiet line.
 */
export function FileMenu({ sources, selected, onSelect, folder, canPickFolder, actions, open, setOpen }) {
  const [query, setQuery] = useState('')
  const root = useRef(null)
  const search = useRef(null)
  const current = sources.find((s) => s.id === selected)

  useEffect(() => {
    if (!open) return
    search.current?.focus()
    const away = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open, setOpen])

  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const matches = sources.filter((s) => s.label.toLowerCase().includes(query.trim().toLowerCase()))
  const choose = (id) => {
    onSelect(id)
    close()
  }
  const run = (fn) => () => {
    close()
    fn()
  }

  return (
    <div className="file-menu" ref={root}>
      <button
        className="btn file-chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose a file (/)"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="file-name">{current?.label ?? 'Choose a file'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          className="popover"
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
          }}
        >
          <input
            ref={search}
            type="text"
            placeholder={`Search ${sources.length} file${sources.length === 1 ? '' : 's'}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) choose(matches[0].id)
            }}
          />
          <div className="file-list" role="listbox">
            {matches.map((s) => (
              <button
                key={s.id}
                role="option"
                aria-selected={s.id === selected}
                className={s.id === selected ? 'file-item current' : 'file-item'}
                onClick={() => choose(s.id)}
              >
                {s.label}
              </button>
            ))}
            {!matches.length && <p className="muted pad">No file matches “{query}”.</p>}
          </div>
          <div className="popover-actions">
            {canPickFolder && (
              <button className="btn small" onClick={run(actions.openFolder)}>
                Open folder…
              </button>
            )}
            <button className="btn small" onClick={run(actions.openFiles)}>
              Open files…
            </button>
            <button className="btn small" onClick={run(actions.reload)}>
              Reload
            </button>
          </div>
          <p className="muted hint">
            {folder ? `Scanning ${folder.name}` : 'Or drag CSV files onto the page.'}
          </p>
        </div>
      )}
    </div>
  )
}
