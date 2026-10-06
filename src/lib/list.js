/**
 * Move one item of a list to a new position (drag-to-reorder), returning a new list.
 *
 * @param {array} list - The original list (left untouched)
 * @param {number} from - Index of the item to move
 * @param {number} to - Index it should end up at
 * @returns {array} The reordered list; the same list if nothing would change
 */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
