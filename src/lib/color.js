/**
 * color
 *
 * Accepts the ways a person is likely to type a color into the trace color box — "#2ca02c", "#2c0",
 * "rgb(44, 160, 44)" or just "44,160,44" — and normalizes it to the "#rrggbb" form that
 * <input type="color"> and Plotly both understand.
 */

const clamp255 = (n) => Math.min(255, Math.max(0, Math.round(n)))
const hex2 = (n) => clamp255(n).toString(16).padStart(2, '0')

/**
 * Normalize a typed color
 *
 * @param {string} text - Hex ("#rgb" / "#rrggbb", with or without the #) or three 0-255 components
 * @returns {string|null} "#rrggbb" (lowercase), or null if the text isn't a color
 */
export function normalizeColor(text) {
  const t = text.trim().toLowerCase()

  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return '#' + h
  }

  const rgb =
    /^(?:rgba?\()?\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*(?:,\s*[\d.]+\s*)?\)?$/.exec(
      t,
    )
  if (rgb) {
    const parts = rgb.slice(1, 4).map(Number)
    if (parts.every((n) => n >= 0 && n <= 255)) return '#' + parts.map(hex2).join('')
  }

  return null
}

/**
 * Format a "#rrggbb" color as the rgb(r, g, b) text people recognize
 *
 * @param {string} hex - A "#rrggbb" color
 * @returns {string} e.g. "rgb(44, 160, 44)"
 */
export function toRgbText(hex) {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`
}
