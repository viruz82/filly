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
