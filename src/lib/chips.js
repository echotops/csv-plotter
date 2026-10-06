import { FILTERS } from './filters'
import { DEFAULT_OPTS, FILTER_KINDS } from './types'

const trimNum = (v) => String(Number(Number(v).toPrecision(4)))

/**
 * Everything that is quietly changing what the plot shows, as removable chips ("Moving average · 11
 * samples ×"). Each chip carries the option patch that undoes it, so the plot never hides a filter that
 * was set on another tab.
 *
 * @param {object} o - The plot options
 * @returns {{key: string, text: string, reset: object}[]} The chips, in display order
 */
export function activeChips(o) {
  const chips = []

  if (o.filter !== 'None' && FILTER_KINDS.includes(o.kind)) {
    const spec = FILTERS[o.filter]
    const params = [spec.p1 && `${trimNum(o.fp1)}`, spec.p2 && `${trimNum(o.fp2)}`].filter(Boolean)
    chips.push({
      key: 'filter',
      text: o.filter + (params.length ? ` · ${params.join(', ')}` : ''),
      reset: { filter: 'None', fp1: DEFAULT_OPTS.fp1, fp2: DEFAULT_OPTS.fp2 },
    })
  }

  if (o.norm !== 'None') chips.push({ key: 'norm', text: o.norm, reset: { norm: 'None' } })
  if (o.logx) chips.push({ key: 'logx', text: 'Log X', reset: { logx: false } })
  if (o.logy) chips.push({ key: 'logy', text: 'Log Y', reset: { logy: false } })

  for (const [key, label] of [
    ['xlim', 'X'],
    ['ylim', 'Y'],
  ]) {
    if (o[key][0].trim() !== '' || o[key][1].trim() !== '') {
      chips.push({
        key,
        text: `${label}: ${o[key][0].trim() || 'auto'} to ${o[key][1].trim() || 'auto'}`,
        reset: { [key]: ['', ''] },
      })
    }
  }

  return chips
}
