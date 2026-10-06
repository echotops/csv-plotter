export const INDEX = '(row index)'
export const NONE = '(none)'

// Picked from the X / trace column drop-downs to plot a formula of the columns instead of one column.
export const CUSTOM = 'ƒ custom formula…'
export const MAX_TRACES = 10
export const KINDS = [
  'Line',
  'Scatter',
  'Line + markers',
  'Step',
  'Area',
  'Bar',
  'Histogram',
  'Box',
  'Violin',
  'ECDF',
  '2D histogram',
  'Correlation heatmap',
  'Scatter matrix',
]

export const XY_KINDS = ['Line', 'Scatter', 'Line + markers', 'Step', 'Area', 'Bar']
export const AXIS2_KINDS = ['Line', 'Scatter', 'Line + markers', 'Step', 'Area']
export const FILTER_KINDS = ['Line', 'Line + markers', 'Step', 'Area']
export const HINTS = {
  Line: 'One line per trace. Use + to overlay up to 10, R to put a trace on the right axis.',
  Scatter: 'Points; optionally colored by a numeric column.',
  'Line + markers': 'Line with a marker at every sample.',
  Step: 'Staircase line (value held until the next sample).',
  Area: 'Filled line plot, overlaid for multiple traces.',
  Bar: 'Grouped bars, one group per row (first 300 rows). A text X column gives the mean per category.',
  Histogram: 'Distribution of each trace (X is ignored).',
  Box: 'Box-and-whisker of each trace.',
  Violin: 'Density shape of each trace.',
  ECDF: 'Empirical cumulative distribution of each trace.',
  '2D histogram': 'Square-bin density of the first trace against X.',
  'Correlation heatmap': 'Pairwise correlation of the traces (all traces blank = all numeric columns).',
  'Scatter matrix': 'Pairwise scatter of the traces (all traces blank = first 4 numeric columns).',
}

export const NORMS = ['None', 'Min-max (0-1)', 'Z-score', 'Subtract first value', 'Divide by first value']
export const COLORMAPS = [
  'Viridis',
  'Plasma',
  'Inferno',
  'Magma',
  'Cividis',
  'Turbo',
  'RdBu',
  'Spectral',
  'Jet',
]

export const THEMES = ['Light', 'Dark']
export const DEFAULT_OPTS = {
  kind: 'Line',
  x: INDEX,
  xExpr: '',
  traces: [{ col: NONE, side: 'L', expr: '', color: '' }],
  colorBy: NONE,
  title: '',
  xlabel: '',
  ylabel: '',
  lw: 1.5,
  ms: 4,
  alpha: 0.85,
  grid: true,
  legend: true,
  logx: false,
  logy: false,
  density: false,
  xlim: ['', ''],
  ylim: ['', ''],
  cmap: 'Viridis',
  bins: 30,
  filter: 'None',
  fp1: 11,
  fp2: 3,
  showRaw: true,
  norm: 'None',
  maxPts: 100000,
  theme: 'Dark',
}
