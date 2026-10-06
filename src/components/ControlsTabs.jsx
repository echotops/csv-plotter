import { useState } from 'react'
import { PlotPanel, ProcessPanel, StylePanel } from './Controls'

const TABS = ['Plot', 'Style', 'Process']

export function ControlsTabs(props) {
  const [tab, setTab] = useState('Plot')
  return (
    <>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="tab-card scroll">
        {tab === 'Plot' && <PlotPanel {...props} />}
        {tab === 'Style' && <StylePanel {...props} />}
        {tab === 'Process' && <ProcessPanel {...props} />}
      </div>
    </>
  )
}
