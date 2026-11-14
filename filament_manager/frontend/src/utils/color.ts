// Colour helpers. Spool colours are stored as hex ("#C2B29A"); Bambu Studio's colour dialog asks
// for R, G and B (0–255), so the UI shows both.

export type Rgb = [number, number, number]

/** "#C2B29A" / "c2b29a" / "#C2B29AFF" → [194, 178, 154]; null if it is not a 6-digit hex colour. */
export function hexToRgb(hex: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec((hex ?? '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Display form: "R 194  G 178  B 154". */
export function rgbLabel(rgb: Rgb): string {
  return `R ${rgb[0]}  G ${rgb[1]}  B ${rgb[2]}`
}

/** Copy form: "194, 178, 154". */
export function rgbCopyText(rgb: Rgb): string {
  return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`
}

/** "#c2b29a" → "#C2B29A" (display only). */
export function hexLabel(hex: string): string {
  return '#' + hex.replace(/^#/, '').slice(0, 6).toUpperCase()
}

// ── Colour distance ──────────────────────────────────────────────────────────
// Third-party filament: the colour set at the AMS slot is never exactly the colour stored in
// the inventory, so spools are compared by perceptual distance (CIE76 ΔE in Lab space).
// Keep in sync with `color_delta` in backend/app/ha_publisher.py.

/** ΔE up to which two colours count as "the same colour" for an AMS slot. */
export const COLOR_TOLERANCE = 10

export function rgbToLab(rgb: Rgb): [number, number, number] {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const [r, g, b] = [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])]
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const [fx, fy, fz] = [f(x), f(y), f(z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** Perceptual distance between two hex colours; null if one of them is not a valid hex colour. */
export function colorDelta(a: string | null | undefined, b: string | null | undefined): number | null {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return null
  const [la, lb] = [rgbToLab(ra), rgbToLab(rb)]
  return Math.sqrt((la[0] - lb[0]) ** 2 + (la[1] - lb[1]) ** 2 + (la[2] - lb[2]) ** 2)
}
