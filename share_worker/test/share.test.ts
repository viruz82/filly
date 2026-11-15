import { SELF, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanSnapshot, cleanSpool, newLinkId, LINK_ID_RE } from '../src/sanitize'
import { esc, swatch } from '../src/render'

const KEY = 'test-push-key-0123456789abcdef0123456789'
const BASE = 'https://share.example'

function api(path: string, init: RequestInit = {}, key: string | null = KEY) {
  const headers = new Headers(init.headers)
  if (key !== null) headers.set('authorization', `Bearer ${key}`)
  if (init.body) headers.set('content-type', 'application/json')
  return SELF.fetch(BASE + path, { ...init, headers })
}

const spool = (over: Record<string, unknown> = {}) => ({
  brand: 'SUNLU', material: 'PLA', subtype: 'Matte', color_name: 'Mint Green',
  colors: ['#00C7B1'], color_mode: 'solid', color_effect: null, remaining_pct: 55, ...over,
})

async function pushSnapshot(spools: unknown[], extra: Record<string, unknown> = {}) {
  const r = await api('/api/snapshot', {
    method: 'PUT', body: JSON.stringify({ generated_at: '2026-11-15T12:00:00Z', spools, ...extra }),
  })
  expect(r.status).toBe(200)
  return r.json() as Promise<{ spool_count: number }>
}

async function createLink(body: Record<string, unknown> = { name: 'Meine Spulen' }) {
  const r = await api('/api/links', { method: 'POST', body: JSON.stringify(body) })
  expect(r.status).toBe(201)
  return r.json() as Promise<{ id: string; views: number; active: boolean }>
}

beforeEach(() => reset())

const XSS = '<' + 'script>alert(1)</' + 'script>'

describe('sanitize', () => {
  it('keeps only whitelisted fields', () => {
    const s = cleanSpool({
      ...spool(), purchase_price: 19.99, storage_location: 'Regal 3', notes: 'geheim',
      purchase_location: 'Amazon', current_weight_g: 512, id: 7, custom_id: 12, ams_slot: 'A1',
    })
    expect(Object.keys(s!).sort()).toEqual(
      ['brand', 'color_effect', 'color_mode', 'color_name', 'colors', 'material', 'remaining_pct', 'subtype'])
  })

  it('validates colours, modes and effects', () => {
    expect(cleanSpool(spool({ colors: ['red', '#12345G'] }))!.colors).toEqual(['#888888'])
    expect(cleanSpool(spool({ colors: ['abcdef'] }))!.colors).toEqual(['#ABCDEF'])
    expect(cleanSpool(spool({ color_mode: 'gradient', colors: ['#111111'] }))!.color_mode).toBe('solid')
    expect(cleanSpool(spool({ color_mode: 'solid', colors: ['#111111', '#222222'] }))!.colors).toEqual(['#111111'])
    expect(cleanSpool(spool({ color_mode: 'solid', color_effect: 'glitter' }))!.color_effect).toBeNull()
    expect(cleanSpool(spool({ color_mode: 'special', color_effect: 'glitter' }))!.color_effect).toBe('glitter')
    expect(cleanSpool(spool({ color_mode: 'special', color_effect: 'url(x)' }))!.color_effect).toBeNull()
    expect(cleanSpool(spool({ color_mode: 'evil' }))!.color_mode).toBe('solid')
  })

  it('clamps percentages and text', () => {
    expect(cleanSpool(spool({ remaining_pct: 140.4 }))!.remaining_pct).toBe(100)
    expect(cleanSpool(spool({ remaining_pct: -3 }))!.remaining_pct).toBe(0)
    expect(cleanSpool(spool({ remaining_pct: 'x' }))!.remaining_pct).toBe(0)
    expect(cleanSpool(spool({ brand: 'a'.repeat(200) }))!.brand).toHaveLength(60)
    expect(cleanSpool(spool({ material: '' }))).toBeNull()
  })

  it('rejects bad snapshots', () => {
    expect(cleanSnapshot({ spools: 'x' })).toBeNull()
    expect(cleanSnapshot([])).toBeNull()
    expect(cleanSnapshot({ spools: new Array(1001).fill(spool()) })).toBeNull()
    expect(cleanSnapshot({ spools: [spool()], empty_pct: 50, low_pct: 20 })!.empty_pct).toBe(20)
  })

  it('makes unguessable link ids', () => {
    const ids = new Set(Array.from({ length: 200 }, newLinkId))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(LINK_ID_RE)
  })

  it('escapes html and draws swatches like the add-on', () => {
    expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
    expect(swatch(cleanSpool(spool({ color_mode: 'gradient', colors: ['#111111', '#222222'] }))!))
      .toBe('linear-gradient(135deg, #111111, #222222)')
    expect(swatch(cleanSpool(spool({ color_mode: 'multicolor', colors: ['#111111', '#222222'] }))!))
      .toBe('conic-gradient(#111111 0deg 180deg, #222222 180deg 360deg)')
  })
})

describe('api auth', () => {
  it('refuses missing and wrong keys', async () => {
    expect((await api('/api/health', {}, null)).status).toBe(401)
    expect((await api('/api/health', {}, 'wrong-key-0123456789abcdef0123456789')).status).toBe(401)
    expect((await api('/api/health', {}, KEY.slice(0, -1))).status).toBe(401)
    expect((await api('/api/links', { method: 'POST', body: '{"name":"x"}' }, null)).status).toBe(401)
    const ok = await api('/api/health')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })
  })

  it('rejects oversized and broken bodies', async () => {
    const big = JSON.stringify({ spools: [spool({ brand: 'x'.repeat(600 * 1024) })] })
    expect((await api('/api/snapshot', { method: 'PUT', body: big })).status).toBe(413)
    expect((await api('/api/snapshot', { method: 'PUT', body: '{nope' })).status).toBe(400)
    expect((await api('/api/snapshot', { method: 'PUT', body: '{"spools":1}' })).status).toBe(400)
  })
})

describe('public page', () => {
  it('shows only cleaned data and counts views', async () => {
    await pushSnapshot([
      { ...spool(), purchase_price: 19.99, storage_location: 'Regal 3', notes: 'geheim' },
      spool({ brand: XSS, color_name: 'Rot', colors: ['#FF0000'], remaining_pct: 0 }),
    ])
    const link = await createLink({ name: 'Kais <Spulen>', hide_empty: false })
    expect(link.id).toMatch(LINK_ID_RE)

    const r = await SELF.fetch(`${BASE}/s/${link.id}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(r.headers.get('x-robots-tag')).toContain('noindex')
    expect(r.headers.get('cache-control')).toBe('no-store')
    const html = await r.text()
    expect(html).toContain('Mint Green')
    expect(html).toContain('Kais &lt;Spulen&gt;')
    expect(html).toContain('&lt;script&gt;alert(1)')
    expect(html.toLowerCase()).not.toContain('<' + 'script')
    expect(html).not.toContain('Regal 3')
    expect(html).not.toContain('19.99')
    expect(html).not.toContain('geheim')

    await SELF.fetch(`${BASE}/s/${link.id}`, { method: 'HEAD' })
    const list = await (await api('/api/links')).json() as { spool_count: number; links: { views: number }[] }
    expect(list.spool_count).toBe(2)
    expect(list.links[0].views).toBe(1)
  })

  it('hides empty spools when asked', async () => {
    await pushSnapshot([spool({ color_name: 'Voll' }), spool({ color_name: 'Leer', remaining_pct: 0 })])
    const link = await createLink({ name: 'x', hide_empty: true })
    const html = await (await SELF.fetch(`${BASE}/s/${link.id}`)).text()
    expect(html).toContain('Voll')
    expect(html).not.toContain('Leer')
  })

  it('answers unknown, inactive and expired links the same way', async () => {
    await pushSnapshot([spool()])
    const off = await createLink({ name: 'aus' })
    await api(`/api/links/${off.id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) })
    const old = await createLink({ name: 'alt', expires_at: '2020-01-01T00:00:00Z' })

    const unknown = await SELF.fetch(`${BASE}/s/${newLinkId()}`)
    const inactive = await SELF.fetch(`${BASE}/s/${off.id}`)
    const expired = await SELF.fetch(`${BASE}/s/${old.id}`)
    const malformed = await SELF.fetch(`${BASE}/s/abc`)
    const bodies = await Promise.all([unknown, inactive, expired, malformed].map((r) => r.text()))
    for (const r of [unknown, inactive, expired, malformed]) expect(r.status).toBe(404)
    expect(new Set(bodies).size).toBe(1)

    const list = await (await api('/api/links')).json() as { links: { id: string; views: number }[] }
    expect(list.links.every((l) => l.views === 0)).toBe(true)
  })

  it('renews and deletes links', async () => {
    await pushSnapshot([spool()])
    const link = await createLink({ name: 'neu' })
    await SELF.fetch(`${BASE}/s/${link.id}`)
    const renewed = await (await api(`/api/links/${link.id}/renew`, { method: 'POST' })).json() as
      { id: string; views: number; name: string }
    expect(renewed.id).not.toBe(link.id)
    expect(renewed.views).toBe(0)
    expect(renewed.name).toBe('neu')
    expect((await SELF.fetch(`${BASE}/s/${link.id}`)).status).toBe(404)
    expect((await SELF.fetch(`${BASE}/s/${renewed.id}`)).status).toBe(200)

    expect((await api(`/api/links/${renewed.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await SELF.fetch(`${BASE}/s/${renewed.id}`)).status).toBe(404)
    expect((await api(`/api/links/${renewed.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('validates link input and caps the number of links', async () => {
    expect((await api('/api/links', { method: 'POST', body: '{"name":""}' })).status).toBe(400)
    expect((await api('/api/links', { method: 'POST', body: '{"name":"x","expires_at":"bald"}' })).status).toBe(400)
    const l = await createLink({ name: 'x' })
    expect((await api(`/api/links/${l.id}`, { method: 'PATCH', body: '{"active":"ja"}' })).status).toBe(400)
    expect((await api(`/api/links/${l.id}`, { method: 'PATCH', body: '{"lang":"fr"}' })).status).toBe(400)
    for (let i = 0; i < 19; i++) await createLink({ name: `l${i}` })
    expect((await api('/api/links', { method: 'POST', body: '{"name":"zu viel"}' })).status).toBe(409)
  })

  it('works before the first snapshot and blocks robots', async () => {
    const link = await createLink({ name: 'leer', lang: 'en' })
    const html = await (await SELF.fetch(`${BASE}/s/${link.id}`)).text()
    expect(html).toContain('No spools.')
    const robots = await SELF.fetch(`${BASE}/robots.txt`)
    expect(await robots.text()).toContain('Disallow: /')
    expect((await SELF.fetch(`${BASE}/`)).status).toBe(404)
  })
})
