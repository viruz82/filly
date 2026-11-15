// Whitelist for everything that reaches the public share page.
// Filly already sends only these fields; the Worker checks them again so that
// a bug on the add-on side can never leak more than this.

export const MAX_SPOOLS = 1000
export const MAX_LINKS = 20
export const MAX_BODY_BYTES = 512 * 1024
export const MAX_TEXT = 60

export const COLOR_MODES = ['solid', 'gradient', 'multicolor', 'special'] as const
export const COLOR_EFFECTS = ['glitter', 'glow', 'thermo', 'marble'] as const
export const LANGS = ['de', 'en', 'es'] as const
export type Lang = typeof LANGS[number]

/** Link ids are 16 random bytes, base64url without padding (22 characters). */
export const LINK_ID_RE = /^[A-Za-z0-9_-]{22}$/
const HEX_RE = /^#?([0-9a-fA-F]{6})$/

export interface PublicSpool {
  brand: string
  material: string
  subtype: string | null
  color_name: string
  colors: string[]
  color_mode: string
  color_effect: string | null
  remaining_pct: number
}

export interface Snapshot {
  generated_at: string
  low_pct: number
  empty_pct: number
  spools: PublicSpool[]
}

export interface LinkInput {
  name: string
  expires_at: string | null
  hide_empty: boolean
  lang: Lang
}

export interface LinkPatch {
  name?: string
  expires_at?: string | null
  hide_empty?: boolean
  active?: boolean
  lang?: Lang
}

function text(v: unknown, max = MAX_TEXT): string {
  if (typeof v !== 'string') return ''
  // Drop control characters, collapse whitespace.
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function pct(v: unknown, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function isoOrNull(v: unknown): string | null | undefined {
  if (v === null) return null
  if (typeof v !== 'string' || !v) return undefined
  const t = Date.parse(v)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}

export function cleanSpool(raw: unknown): PublicSpool | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const material = text(o.material)
  if (!material) return null
  const colors = (Array.isArray(o.colors) ? o.colors : [])
    .slice(0, 4)
    .map((c) => (typeof c === 'string' ? HEX_RE.exec(c.trim()) : null))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => '#' + m[1].toUpperCase())
  if (!colors.length) colors.push('#888888')
  let mode = typeof o.color_mode === 'string' && (COLOR_MODES as readonly string[]).includes(o.color_mode)
    ? o.color_mode : 'solid'
  if ((mode === 'gradient' || mode === 'multicolor') && colors.length < 2) mode = 'solid'
  if (mode === 'solid' || mode === 'special') colors.splice(1)
  const effect = mode === 'special' && typeof o.color_effect === 'string'
    && (COLOR_EFFECTS as readonly string[]).includes(o.color_effect) ? o.color_effect : null
  return {
    brand: text(o.brand),
    material,
    subtype: text(o.subtype) || null,
    color_name: text(o.color_name),
    colors,
    color_mode: mode,
    color_effect: effect,
    remaining_pct: pct(o.remaining_pct, 0),
  }
}

/** Returns null when the body is not a usable snapshot (wrong shape or too many spools). */
export function cleanSnapshot(raw: unknown, now = new Date()): Snapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.spools) || o.spools.length > MAX_SPOOLS) return null
  const low = pct(o.low_pct, 20)
  return {
    generated_at: isoOrNull(o.generated_at) ?? now.toISOString(),
    low_pct: low,
    empty_pct: Math.min(pct(o.empty_pct, 8), low),
    spools: o.spools.map(cleanSpool).filter((s): s is PublicSpool => s !== null),
  }
}

function lang(v: unknown): Lang | undefined {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v) ? v as Lang : undefined
}

/** Validates a new link. Returns an error code string on bad input. */
export function cleanLinkInput(raw: unknown): LinkInput | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'bad_body'
  const o = raw as Record<string, unknown>
  const name = text(o.name)
  if (!name) return 'name_required'
  const expires = o.expires_at === undefined ? null : isoOrNull(o.expires_at)
  if (expires === undefined) return 'bad_expires_at'
  return { name, expires_at: expires, hide_empty: o.hide_empty !== false, lang: lang(o.lang) ?? 'de' }
}

export function cleanLinkPatch(raw: unknown): LinkPatch | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'bad_body'
  const o = raw as Record<string, unknown>
  const p: LinkPatch = {}
  if ('name' in o) {
    const name = text(o.name)
    if (!name) return 'name_required'
    p.name = name
  }
  if ('expires_at' in o) {
    const e = isoOrNull(o.expires_at)
    if (e === undefined) return 'bad_expires_at'
    p.expires_at = e
  }
  if ('hide_empty' in o) {
    if (typeof o.hide_empty !== 'boolean') return 'bad_hide_empty'
    p.hide_empty = o.hide_empty
  }
  if ('active' in o) {
    if (typeof o.active !== 'boolean') return 'bad_active'
    p.active = o.active
  }
  if ('lang' in o) {
    const l = lang(o.lang)
    if (!l) return 'bad_lang'
    p.lang = l
  }
  return p
}

export function newLinkId(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
