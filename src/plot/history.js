const sameRange = (a, b) => (!a && !b) || Boolean(a && b && a[0] === b[0] && a[1] === b[1])

/** Whether two views (the x / y / y2 ranges the user has zoomed to; a missing axis shows everything) match. */
export const sameView = (a, b) => sameRange(a.x, b.x) && sameRange(a.y, b.y) && sameRange(a.y2, b.y2)

/**
 * Back / forward through the views of a plot, like a browser's history: recording a new view while stepped
 * back throws away everything that was ahead.
 *
 *   original -> pan left -> zoom in -> pan up
 *   back, back            -> pan left
 *   zoom out (recorded)   -> original -> pan left -> zoom out      ("zoom in" and "pan up" are gone)
 */
export class ViewHistory {
  constructor(initial = {}) {
    this.reset(initial)
  }

  /** Start over with a single entry. */
  reset(initial = {}) {
    this.entries = [initial]
    this.at = 0
    this.merging = false
  }

  get current() {
    return this.entries[this.at]
  }

  get canBack() {
    return this.at > 0
  }

  get canForward() {
    return this.at < this.entries.length - 1
  }

  /**
   * Record the view the user just arrived at. A view identical to the current one is ignored. With `merge`
   * (used for the many small steps of one scroll-wheel gesture) a recording right after another merging one
   * replaces that entry instead of adding a new one.
   *
   * @returns {boolean} whether anything was recorded
   */
  record(view, { merge = false } = {}) {
    if (sameView(this.current, view)) return false
    if (merge && this.merging) {
      this.entries[this.at] = view
    } else {
      this.entries.length = this.at + 1
      this.entries.push(view)
      this.at++
    }
    this.merging = merge
    return true
  }

  /** The view one step back (or null at the start); moves there. */
  back() {
    if (!this.canBack) return null
    this.merging = false
    return this.entries[--this.at]
  }

  /** The view one step forward (or null at the end); moves there. */
  forward() {
    if (!this.canForward) return null
    this.merging = false
    return this.entries[++this.at]
  }
}
