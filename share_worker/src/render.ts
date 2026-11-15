// Server-rendered public pages. No external resources, no cookies. The collection
// page carries ONE small inline script (search and filters); the page is fully
// readable without it, and the Content-Security-Policy only allows exactly that script.

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
  stat: { spools: string; weight: string; colors: string; brands: string }
  search: string
  allMaterials: string
  allBrands: string
  noResults: string
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
    stat: { spools: 'Spulen', weight: 'Gesamtgewicht', colors: 'Farben', brands: 'Hersteller' },
    search: 'Suche nach Farbe, Hersteller, Nummer …',
    allMaterials: 'Alle Materialien',
    allBrands: 'Alle Hersteller',
    noResults: 'Nichts gefunden.',
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
    stat: { spools: 'Spools', weight: 'Total weight', colors: 'Colours', brands: 'Brands' },
    search: 'Search colour, brand, number …',
    allMaterials: 'All materials',
    allBrands: 'All brands',
    noResults: 'Nothing found.',
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
    stat: { spools: 'Bobinas', weight: 'Peso total', colors: 'Colores', brands: 'Marcas' },
    search: 'Buscar color, marca, número …',
    allMaterials: 'Todos los materiales',
    allBrands: 'Todas las marcas',
    noResults: 'No se encontró nada.',
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
:root{color-scheme:light dark;--bg:#f2f4f7;--card:#fff;--line:#e2e6ec;--text:#111827;--muted:#5b6472;--accent:#0288d1;--ok:#15803d;--warn:#b45309;--crit:#c62828;--track:#e2e6ec;--chip:#eef1f5}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1c1f26;--line:#262a33;--text:#e3e6ec;--muted:#9aa3b2;--accent:#03a9f4;--ok:#8fdc92;--warn:#ffc163;--crit:#ff8a87;--track:#30353f;--chip:#262a33}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:20px 16px 32px}
header h1{margin:0;font-size:1.5rem;line-height:1.2;overflow-wrap:anywhere}
.sub{color:var(--muted);margin:4px 0 0;font-size:.9rem}
.stats{display:flex;flex-wrap:wrap;gap:8px 28px;margin:18px 0 0;padding:0;list-style:none}
.stats li{min-width:0}
.stats b{display:block;font-size:1.7rem;line-height:1.1;color:var(--accent)}
.stats span{color:var(--muted);font-size:.8rem}
.tools{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0}
.tools input,.tools select{font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;min-width:0;max-width:100%}
.tools input{flex:1 1 220px}
.tools select{flex:0 1 190px}
section{margin-top:24px}
h2{font-size:1rem;margin:0 0 10px;color:var(--muted);font-weight:600;letter-spacing:.02em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin:0;padding:0;list-style:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px;min-width:0}
.top{display:flex;gap:12px;align-items:center;min-width:0}
.sw{flex:none;width:44px;height:44px;border-radius:50%;border:1px solid rgba(127,127,127,.35)}
.txt{min-width:0}
.name{font-weight:600;overflow-wrap:anywhere}
.no{color:var(--accent);margin-right:4px}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.badge{font-size:.72rem;border:1px solid var(--line);background:var(--chip);border-radius:6px;padding:0 7px;color:var(--text);overflow-wrap:anywhere}
.meta{color:var(--muted);font-size:.82rem;overflow-wrap:anywhere;margin-top:2px}
.amt{font-size:.95rem}
.amt b{font-size:1.05rem}
.amt span{color:var(--muted);font-size:.82rem}
.bar{height:6px;border-radius:3px;background:var(--track);overflow:hidden}
.bar i{display:block;height:100%;border-radius:3px}
.none{color:var(--muted)}
footer{margin-top:32px;color:var(--muted);font-size:.8rem;text-align:center}
@media (max-width:520px){.tools input{flex:1 1 100%}.tools select{flex:1 1 calc(50% - 4px)}}
`

/** The only script on the page. Filters cards in place; without it everything stays visible. */
export const PAGE_SCRIPT =
  "(function(){var b=document.getElementById('tools');if(!b)return;" +
  "var q=document.getElementById('q'),m=document.getElementById('fm'),v=document.getElementById('fb')," +
  "no=document.getElementById('nores'),cards=[].slice.call(document.querySelectorAll('.card'))," +
  "secs=[].slice.call(document.querySelectorAll('section'));" +
  "function run(){var t=q.value.trim().toLowerCase(),mv=m.value,bv=v.value,n=0;" +
  "cards.forEach(function(c){var ok=(!t||c.getAttribute('data-q').indexOf(t)>-1)&&(!mv||c.getAttribute('data-m')===mv)&&(!bv||c.getAttribute('data-b')===bv);c.hidden=!ok;if(ok)n++});" +
  "secs.forEach(function(s){var k=s.querySelectorAll('.card:not([hidden])').length;s.hidden=!k;var c=s.querySelector('.n');if(c)c.textContent=k});" +
  "no.hidden=n>0}" +
  "b.addEventListener('input',run);b.addEventListener('change',run);b.hidden=false})();"

function page(lang: Lang, title: string, body: string, script = ''): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">` +
    `<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`
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
  /** Show only these brands / materials; an empty list means no filter on that field. */
  brands: string[]
  materials: string[]
  /** Show grams (remaining / nominal) instead of only the percentage. */
  show_weight: boolean
}

/** Spools this link is allowed to show: link filters first, then "hide empty". */
export function visibleSpools(link: PageLink, snap: Snapshot | null): PublicSpool[] {
  const brands = new Set(link.brands.map((b) => b.toLowerCase()))
  const materials = new Set(link.materials.map((m) => m.toLowerCase()))
  return (snap?.spools ?? []).filter((s) =>
    (!brands.size || brands.has(s.brand.toLowerCase())) &&
    (!materials.size || materials.has(s.material.toLowerCase())) &&
    (!link.hide_empty || s.remaining_pct > 0))
}

export function renderCollection(link: PageLink, snap: Snapshot | null, tz: string): string {
  const t = T[link.lang]
  const spools = visibleSpools(link, snap)
  const coll = new Intl.Collator(t.locale, { sensitivity: 'base', numeric: true })
  const num = new Intl.NumberFormat(t.locale)
  const byMaterial = new Map<string, PublicSpool[]>()
  for (const s of spools) {
    const list = byMaterial.get(s.material)
    if (list) list.push(s)
    else byMaterial.set(s.material, [s])
  }
  const materials = [...byMaterial.keys()].sort(coll.compare)
  const brands = [...new Set(spools.map((s) => s.brand).filter(Boolean))].sort(coll.compare)

  const card = (s: PublicSpool) => {
    const level = s.remaining_pct <= (snap?.empty_pct ?? 8) ? 'crit' : s.remaining_pct <= (snap?.low_pct ?? 20) ? 'warn' : 'ok'
    const kind = s.color_mode === 'special' && s.color_effect ? t.effects[s.color_effect] : t.modes[s.color_mode]
    const name = s.color_name || s.colors[0]
    const tags = [s.subtype, kind].filter(Boolean).map((x) => `<span class="badge">${esc(x!)}</span>`).join('')
    const amount = link.show_weight
      ? `<b>${num.format(s.weight_g)} g</b> <span>/ ${num.format(s.spool_g)} g</span>`
      : `<b>${t.pct(s.remaining_pct)}</b>`
    const search = [s.number ? `#${s.number}` : '', name, s.brand, s.material, s.subtype ?? ''].join(' ').toLowerCase()
    return `<li class="card" data-q="${esc(search)}" data-m="${esc(s.material)}" data-b="${esc(s.brand)}">` +
      `<div class="top"><span class="sw" style="background:${swatch(s)}"></span>` +
      `<div class="txt"><div class="name">${s.number ? `<span class="no">#${s.number}</span>` : ''}${esc(name)}</div>` +
      (tags ? `<div class="tags">${tags}</div>` : '') +
      (s.brand ? `<div class="meta">${esc(s.brand)}</div>` : '') + `</div></div>` +
      `<div class="amt">${amount}</div>` +
      `<div class="bar"><i style="width:${s.remaining_pct}%;background:var(--${level})"></i></div></li>`
  }

  const sections = materials.map((m) => {
    const list = byMaterial.get(m)!.sort((a, b) =>
      coll.compare(a.brand, b.brand) || coll.compare(a.color_name, b.color_name) || b.remaining_pct - a.remaining_pct)
    return `<section><h2>${esc(m)} · <span class="n">${list.length}</span></h2><ul class="grid">${list.map(card).join('')}</ul></section>`
  }).join('')

  const colors = new Set(spools.map((s) => (s.color_name || s.colors[0]).toLowerCase())).size
  const totalKg = spools.reduce((n, s) => n + s.weight_g, 0) / 1000
  const stats: string[] = [`<li><b>${spools.length}</b><span>${t.stat.spools}</span></li>`]
  if (link.show_weight) {
    stats.push(`<li><b>${new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(totalKg)} kg</b><span>${t.stat.weight}</span></li>`)
  }
  stats.push(`<li><b>${colors}</b><span>${t.stat.colors}</span></li>`, `<li><b>${brands.length}</b><span>${t.stat.brands}</span></li>`)

  const options = (all: string, list: string[]) =>
    `<option value="">${esc(all)}</option>` + list.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')
  const tools = spools.length
    ? `<div class="tools" id="tools" hidden><input id="q" type="search" placeholder="${esc(t.search)}" autocomplete="off" aria-label="${esc(t.search)}">` +
      `<select id="fm" aria-label="${esc(t.allMaterials)}">${options(t.allMaterials, materials)}</select>` +
      `<select id="fb" aria-label="${esc(t.allBrands)}">${options(t.allBrands, brands)}</select></div>`
    : ''

  const updated = snap ? `${t.updated}: ${esc(formatTime(snap.generated_at, t, tz))}` : ''
  const body = `<main><header><h1>${esc(link.name)}</h1>` +
    `<p class="sub">${t.spools(spools.length)}${updated ? ' · ' + updated : ''}</p>` +
    (spools.length ? `<ul class="stats">${stats.join('')}</ul>` : '') + tools + `</header>` +
    (sections || `<p class="none">${t.none}</p>`) +
    `<p class="none" id="nores" hidden>${t.noResults}</p>` +
    `<footer>${t.footer}</footer></main>`
  return page(link.lang, `${link.name} · ${t.title}`, body, spools.length ? PAGE_SCRIPT : '')
}

export function renderNotFound(lang: Lang): string {
  const t = T[lang]
  return page(lang, t.notFoundTitle,
    `<main><header><h1>${t.notFoundTitle}</h1><p class="sub">${t.notFound}</p></header></main>`)
}
