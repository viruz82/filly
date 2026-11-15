// Colour look (1.18.0): mode + effect of a filament, shared by spools and the catalog.

export const COLOR_MODES = ['solid', 'gradient', 'multicolor', 'special'] as const
export type ColorMode = typeof COLOR_MODES[number]

export const COLOR_EFFECTS = ['glitter', 'glow', 'thermo', 'marble'] as const
export type ColorEffect = typeof COLOR_EFFECTS[number]

/** How many colours each mode uses: [min, max]. */
export const MODE_COLOR_RANGE: Record<ColorMode, [number, number]> = {
  solid: [1, 1],
  gradient: [2, 4],
  multicolor: [2, 3],
  special: [1, 1],
}

export interface ColorLook {
  color_hex?: string | null
  color2_hex?: string | null
  color3_hex?: string | null
  color4_hex?: string | null
  color_mode?: string | null
  color_effect?: string | null
}

export const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function lookColors(s: ColorLook): string[] {
  return [s.color_hex, s.color2_hex, s.color3_hex, s.color4_hex].filter((h): h is string => !!h && HEX_RE.test(h))
}

/** Mode as displayed. Rows without a mode (older data, cloud sync) that carry
 *  more than one colour are shown as multi-colour, exactly as before 1.18.0. */
export function effectiveMode(s: ColorLook): ColorMode {
  const m = s.color_mode as ColorMode | undefined
  const many = lookColors(s).length > 1
  if (m === 'gradient' || m === 'multicolor') return many ? m : 'solid'
  if (m === 'special') return 'special'
  return many ? 'multicolor' : 'solid'
}

export function effectiveEffect(s: ColorLook): ColorEffect | null {
  if (effectiveMode(s) !== 'special') return null
  const e = s.color_effect as ColorEffect | null | undefined
  return e && (COLOR_EFFECTS as readonly string[]).includes(e) ? e : null
}

/** Light overlay layers that hint at a special effect on top of the base colour. */
const EFFECT_LAYERS: Record<ColorEffect, string> = {
  glitter:
    'radial-gradient(circle at 28% 32%, rgba(255,255,255,.95) 0 1px, transparent 1.6px),' +
    'radial-gradient(circle at 68% 26%, rgba(255,255,255,.85) 0 1px, transparent 1.6px),' +
    'radial-gradient(circle at 56% 66%, rgba(255,255,255,.9) 0 1px, transparent 1.6px),' +
    'radial-gradient(circle at 30% 72%, rgba(255,255,255,.75) 0 .8px, transparent 1.4px),' +
    'radial-gradient(circle at 78% 58%, rgba(255,255,255,.8) 0 .8px, transparent 1.4px)',
  glow: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,.55), rgba(255,255,255,0) 65%)',
  thermo: 'linear-gradient(135deg, rgba(255,255,255,0) 45%, rgba(255,255,255,.55))',
  marble:
    'linear-gradient(60deg, transparent 30%, rgba(255,255,255,.45) 33%, transparent 36%),' +
    'linear-gradient(-35deg, transparent 58%, rgba(255,255,255,.35) 61%, transparent 64%)',
}

/** CSS background for a colour disc/swatch; `bar` draws multi-colour as stripes left to right. */
export function lookBackground(s: ColorLook, empty = '#2a2a2e', bar = false): string {
  const colors = lookColors(s)
  if (!colors.length) return empty
  const mode = effectiveMode(s)
  if (mode === 'gradient') return `linear-gradient(135deg, ${colors.join(', ')})`
  if (mode === 'multicolor') {
    if (bar) {
      const w = 100 / colors.length
      return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${i * w}% ${(i + 1) * w}%`).join(', ')})`
    }
    const step = 360 / colors.length
    return `conic-gradient(${colors.map((c, i) => `${c} ${i * step}deg ${(i + 1) * step}deg`).join(', ')})`
  }
  const effect = effectiveEffect(s)
  return effect ? `${EFFECT_LAYERS[effect]}, ${colors[0]}` : colors[0]
}

/** Save-ready look: colours beyond the mode's maximum and a non-special effect are dropped. */
export function clampLook(v: ColorLook) {
  const mode = (COLOR_MODES as readonly string[]).includes(v.color_mode ?? '') ? v.color_mode as ColorMode : effectiveMode(v)
  const [, max] = MODE_COLOR_RANGE[mode]
  const keep = (i: number, h: string | null | undefined) => (i < max && h && HEX_RE.test(h) ? h : null)
  return {
    color_mode: mode,
    color_effect: mode === 'special' && v.color_effect ? v.color_effect as ColorEffect : null,
    color2_hex: keep(1, v.color2_hex),
    color3_hex: keep(2, v.color3_hex),
    color4_hex: keep(3, v.color4_hex),
  }
}
