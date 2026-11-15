// Server-rendered public pages. No JavaScript, no external resources:
// everything a visitor gets is in this one HTML response.

import type { Lang, PublicSpool, Snapshot } from './sanitize'

interface Texts {
  locale: string
  title: string
  spools: (n: number) => string
  updated: string
  none: string
  footer: string
  modes: Record<string, string>
  effects: Record<string, string>
  notFoundTitle: string
  notFound: string
  pct: (n: number) => string
}

const T: Record<Lang, Texts> = {
  de: {
    locale: 'de-DE',
    title: 'Spulen-Sammlung',
    spools: (n) => (n === 1 ? '1 Spule' : `${n} Spulen`),
    updated: 'Stand',
    none: 'Keine Spulen vorhanden.',
    footer: 'Geteilt mit Filly',
    modes: { gradient: 'Verlauf', multicolor: 'Multi-Color' },
    effects: { glitter: 'Glitzer', glow: 'Leuchtend', thermo: 'Temperaturwechsel', marble: 'Marmor' },
    notFoundTitle: 'Link nicht verfügbar',
    notFound: 'Dieser Link ist ungültig, abgelaufen oder wurde abgeschaltet.',
    pct: (n) => `${n} %`,
  },
  en: {
    locale: 'en-GB',
    title: 'Spool collection',
    spools: (n) => (n === 1 ? '1 spool' : `${n} spools`),
    updated: 'Updated',
    none: 'No spools.',
    footer: 'Shared with Filly',
    modes: { gradient: 'Gradient', multicolor: 'Multi-colour' },
    effects: { glitter: 'Glitter', glow: 'Glow', thermo: 'Colour change', marble: 'Marble' },
    notFoundTitle: 'Link not available',
    notFound: 'This link is invalid, has expired or was switched off.',
    pct: (n) => `${n}%`,
  },
  es: {
    locale: 'es-ES',
    title: 'Colección de bobinas',
    spools: (n) => (n === 1 ? '1 bobina' : `${n} bobinas`),
    updated: 'Actualizado',
    none: 'No hay bobinas.',
    footer: 'Compartido con Filly',
    modes: { gradient: 'Degradado', multicolor: 'Multicolor' },
    effects: { glitter: 'Brillantina', glow: 'Fluorescente', thermo: 'Termocromático', marble: 'Mármol' },
    notFoundTitle: 'Enlace no disponible',
    notFound: 'Este enlace no es válido, ha caducado o se ha desactivado.',
    pct: (n) => `${n} %`,
  },
}

export function pickLang(acceptLanguage: string | null): Lang {
  const first = (acceptLanguage ?? '').slice(0, 2).toLowerCase()
  return first === 'de' || first === 'es' ? first : 'en'
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

// Same look as the add-on (frontend/src/utils/colorLook.ts).
const EFFECT_LAYERS: Record<string, string> = {
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

/** CSS background of a swatch. Colours are validated #RRGGBB values (sanitize.ts). */
export function swatch(s: PublicSpool): string {
  const c = s.colors
  if (s.color_mode === 'gradient') return `linear-gradient(135deg, ${c.join(', ')})`
  if (s.color_mode === 'multicolor') {
    const step = 360 / c.length
    return `conic-gradient(${c.map((x, i) => `${x} ${i * step}deg ${(i + 1) * step}deg`).join(', ')})`
  }
  const layer = s.color_effect ? EFFECT_LAYERS[s.color_effect] : undefined
  return layer ? `${layer}, ${c[0]}` : c[0]
}

const CSS = `
:root{color-scheme:light dark;--bg:#f2f4f7;--card:#fff;--line:#e2e6ec;--text:#111827;--muted:#5b6472;--accent:#0288d1;--ok:#15803d;--warn:#b45309;--crit:#c62828;--track:#e2e6ec}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1c1f26;--line:#262a33;--text:#e3e6ec;--muted:#9aa3b2;--accent:#03a9f4;--ok:#8fdc92;--warn:#ffc163;--crit:#ff8a87;--track:#30353f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px 32px}
header h1{margin:0;font-size:1.5rem;line-height:1.2;overflow-wrap:anywhere}
.sub{color:var(--muted);margin:4px 0 0;font-size:.9rem}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 0;padding:0;list-style:none}
.chips li{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:.85rem}
section{margin-top:24px}
h2{font-size:1rem;margin:0 0 10px;color:var(--muted);font-weight:600;letter-spacing:.02em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0;padding:0;list-style:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;min-width:0}
.top{display:flex;gap:10px;align-items:center;min-width:0}
.sw{flex:none;width:40px;height:40px;border-radius:50%;border:1px solid rgba(127,127,127,.35)}
.txt{min-width:0}
.name{font-weight:600;overflow-wrap:anywhere}
.meta{color:var(--muted);font-size:.82rem;overflow-wrap:anywhere}
.badge{align-self:flex-start;font-size:.72rem;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}
.bar{height:6px;border-radius:3px;background:var(--track);overflow:hidden}
.bar i{display:block;height:100%;border-radius:3px}
.pct{font-size:.82rem;color:var(--muted);text-align:right;margin-top:-4px}
.none{color:var(--muted)}
footer{margin-top:32px;color:var(--muted);font-size:.8rem;text-align:center}
@media (max-width:420px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.card{padding:10px}.sw{width:34px;height:34px}}
`

function page(lang: Lang, title: string, body: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">` +
    `<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`
}

function formatTime(iso: string, t: Texts, tz: string): string {
  try {
    return new Intl.DateTimeFormat(t.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat(t.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso)) + ' UTC'
  }
}

export interface PageLink {
  name: string
  hide_empty: boolean
  lang: Lang
}

export function renderCollection(link: PageLink, snap: Snapshot | null, tz: string): string {
  const t = T[link.lang]
  const all = snap?.spools ?? []
  const spools = link.hide_empty ? all.filter((s) => s.remaining_pct > 0) : all
  const coll = new Intl.Collator(t.locale, { sensitivity: 'base', numeric: true })
  const byMaterial = new Map<string, PublicSpool[]>()
  for (const s of spools) {
    const key = s.material
    const list = byMaterial.get(key)
    if (list) list.push(s)
    else byMaterial.set(key, [s])
  }
  const materials = [...byMaterial.keys()].sort(coll.compare)

  const card = (s: PublicSpool) => {
    const level = s.remaining_pct <= (snap?.empty_pct ?? 8) ? 'crit' : s.remaining_pct <= (snap?.low_pct ?? 20) ? 'warn' : 'ok'
    const kind = s.color_mode === 'special' && s.color_effect ? t.effects[s.color_effect]
      : t.modes[s.color_mode]
    const meta = [s.brand, s.subtype].filter(Boolean).join(' · ')
    return `<li class="card"><div class="top"><span class="sw" style="background:${swatch(s)}"></span>` +
      `<div class="txt"><div class="name">${esc(s.color_name || s.colors[0])}</div>` +
      (meta ? `<div class="meta">${esc(meta)}</div>` : '') + `</div></div>` +
      (kind ? `<span class="badge">${esc(kind)}</span>` : '') +
      `<div class="bar"><i style="width:${s.remaining_pct}%;background:var(--${level})"></i></div>` +
      `<div class="pct">${t.pct(s.remaining_pct)}</div></li>`
  }

  const sections = materials.map((m) => {
    const list = byMaterial.get(m)!.sort((a, b) =>
      coll.compare(a.brand, b.brand) || coll.compare(a.color_name, b.color_name) || b.remaining_pct - a.remaining_pct)
    return `<section><h2>${esc(m)} · ${list.length}</h2><ul class="grid">${list.map(card).join('')}</ul></section>`
  }).join('')

  const chips = materials.map((m) => `<li>${esc(m)} ${byMaterial.get(m)!.length}</li>`).join('')
  const updated = snap ? `${t.updated}: ${esc(formatTime(snap.generated_at, t, tz))}` : ''
  const body = `<main><header><h1>${esc(link.name)}</h1>` +
    `<p class="sub">${t.spools(spools.length)}${updated ? ' · ' + updated : ''}</p>` +
    (chips ? `<ul class="chips">${chips}</ul>` : '') + `</header>` +
    (sections || `<p class="none">${t.none}</p>`) +
    `<footer>${t.footer}</footer></main>`
  return page(link.lang, `${link.name} · ${t.title}`, body)
}

export function renderNotFound(lang: Lang): string {
  const t = T[lang]
  return page(lang, t.notFoundTitle,
    `<main><header><h1>${t.notFoundTitle}</h1><p class="sub">${t.notFound}</p></header></main>`)
}
