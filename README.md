# CSV Explorer (web)

A static, in-browser CSV plotting tool: pick a file, overlay up to 10 traces, denoise, and explore.
Everything runs locally in the browser. Nothing is uploaded.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (CSV parser, formulas, colors, filters vs. scipy, figure builder, folder scanner)
npm run lint     # eslint, same flat config as echotops.github.io
npm run build    # static site in dist/ — host anywhere, or open via any static file server
```

## Opening data

- The file chip in the top bar (or press `/`) opens a searchable list of loaded files with the actions below it.
- **Open folder…** (Chrome/Edge) lists every `.csv`/`.tsv` under the folder (3 levels deep). **Reload** rescans and re-reads.
- **Open files…** or **drag & drop** works in every browser.
- A built-in demo dataset loads on start.

## Features

- 13 plot types: Line, Scatter (colored by a column), Line + markers, Step, Area, Bar, Histogram, Box, Violin, ECDF, 2D histogram, Correlation heatmap, Scatter matrix.
- Up to 10 overlaid **traces** (`+ Add` stays pinned while the list scrolls; `−` removes). Each row is compact: **drag the ⠿ handle** (or Alt+↑/↓ on it) to reorder, **click the colored swatch to hide/show** the trace, the `L`/`R` button picks the axis, `▾` expands the color controls. Reordering keeps every trace's color.
- **Colors**: every trace has a color picker plus a box that takes `#2ca02c`, `2ca02c`, `rgb(44, 160, 44)` or `44,160,44`; clear the box to go back to the default palette color.
- **Formulas**: pick `ƒ custom formula…` for any trace *or the X axis* and type an expression of the columns, evaluated for every row — `chamber_psi - tank_psi`, `TIME_MS * 1e-3`, `sin(2*pi*time_s)`. Column names are case-insensitive; names with spaces go in brackets (`[sensor A] / [pressure (psi)]`). Supports `+ - * / % ^ **`, parentheses, the usual math functions (`sqrt`, `log`, `atan2`, `min`, `max`, …), `pi`, `e`, and `index` (the row number). Mistakes are explained under the box as you type. The formula text becomes the axis title / legend entry, and formulas work with filters and every plot type.
- **Filters**: moving average, median, Gaussian, exponential, Savitzky–Golay, Butterworth low/high-pass (cutoff in Hz, sample rate taken from the X column), Hampel despike.
- Normalization, log axes, axis limits, light/dark theme, PNG export (camera icon on the plot).
- **LaTeX** in the title and axis labels: write it between dollar signs, e.g. `Velocity ($\frac{m}{s}$)`. MathJax is fetched from jsdelivr the first time a label uses it (offline, the label shows as plain text).
- **Plot bar**: chips for anything altering the data (filter, normalization, log axes, limits) — click one to remove it — plus **Reset zoom** (double-clicking the plot does the same). A dotted crosshair follows the cursor next to the hover readout.
- If a combination can't be drawn (say a half-typed formula), the last good plot stays dimmed under an explanatory banner instead of going blank.
- **Layout**: drag the divider to resize the controls (double-click resets), click its arrow or press `[` to collapse them; below 900 px wide they become a slide-over drawer (☰ Controls). Widths are remembered.
- **Shortcuts** (ignored while typing): `/` file search, `T` theme, `[` sidebar, `Esc` closes the drawer.
- Handles `,` `;` tab and `|` delimiters, quoted fields, headerless files, `#` comments, NA/blank cells, ISO / US dates. 1M rows loads and plots in about a second.

## Layout

| Path | What |
|---|---|
| `src/lib/csv.js` | parser + type inference (numbers, UTC timestamps, text) |
| `src/lib/expression.js` | formula tokenizer/parser/compiler (adapted from vector-fields' `expression.js`) with per-table caching |
| `src/lib/color.js` | parses typed hex/rgb colors |
| `src/lib/list.js`, `src/lib/chips.js` | trace reordering; the removable "active filter" chips |
| `src/lib/filters.js` | all filters; `filters.test.js` checks them against scipy output in `__fixtures__/filters.json` |
| `src/lib/plots.js` | turns a table + options into a Plotly figure (no DOM, fully unit-tested) |
| `src/lib/files.js` | folder scanning / file sources |
| `src/components/` | React UI (controls, plot, tables) |

The Python desktop prototype (`../csv_explorer.py`) is kept for reference.
