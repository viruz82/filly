// Filly share Worker: holds a cleaned copy of the spool inventory and serves it
// under unguessable links. Filly pushes the copy (Bearer key); visitors only read.

import { DurableObject } from 'cloudflare:workers'
import { PAGE_SCRIPT, pickLang, renderCollection, renderNotFound, type PageLink } from './render'
import {
  LINK_ID_RE, MAX_BODY_BYTES, MAX_LINKS,
  cleanLinkInput, cleanLinkPatch, cleanSnapshot, newLinkId,
  type Lang, type LinkInput, type LinkPatch, type Snapshot,
} from './sanitize'

export interface Env {
  STORE: DurableObjectNamespace<ShareStore>
  /** Shared secret with the Filly add-on (wrangler secret put PUSH_KEY). */
  PUSH_KEY?: string
  /** Time zone for "updated" on the public page. */
  TZ?: string
}

export interface LinkRow {
  id: string
  name: string
  active: boolean
  expires_at: string | null
  hide_empty: boolean
  lang: Lang
  brands: string[]
  materials: string[]
  show_weight: boolean
  views: number
  last_view_at: string | null
  created_at: string
}

export interface LinkList {
  snapshot_received_at: string | null
  snapshot_generated_at: string | null
  spool_count: number
  links: LinkRow[]
}

type Row = Record<string, SqlStorageValue>

function list(v: SqlStorageValue): string[] {
  try {
    const a = JSON.parse(String(v ?? '[]'))
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function toLink(r: Row): LinkRow {
  return {
    id: String(r.id),
    name: String(r.name),
    active: r.active === 1,
    expires_at: r.expires_at === null ? null : String(r.expires_at),
    hide_empty: r.hide_empty === 1,
    lang: String(r.lang) as Lang,
    brands: list(r.brands),
    materials: list(r.materials),
    show_weight: r.show_weight !== 0,
    views: Number(r.views),
    last_view_at: r.last_view_at === null ? null : String(r.last_view_at),
    created_at: String(r.created_at),
  }
}

export function isExpired(expiresAt: string | null, now: Date): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= now.getTime()
}

/** One instance ("main") holds everything; SQLite keeps the view counter exact. */
export class ShareStore extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS snapshot (
      k INTEGER PRIMARY KEY CHECK (k = 1), body TEXT NOT NULL, received_at TEXT NOT NULL)`)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT, hide_empty INTEGER NOT NULL DEFAULT 1, lang TEXT NOT NULL DEFAULT 'de',
      views INTEGER NOT NULL DEFAULT 0, last_view_at TEXT, created_at TEXT NOT NULL)`)
    // 1.21.0: filters and weight switch. Links from 1.20.0 keep showing everything, as before.
    const have = new Set(this.sql.exec('PRAGMA table_info(links)').toArray().map((c) => String(c.name)))
    if (!have.has('brands')) this.sql.exec(`ALTER TABLE links ADD COLUMN brands TEXT NOT NULL DEFAULT '[]'`)
    if (!have.has('materials')) this.sql.exec(`ALTER TABLE links ADD COLUMN materials TEXT NOT NULL DEFAULT '[]'`)
    if (!have.has('show_weight')) this.sql.exec(`ALTER TABLE links ADD COLUMN show_weight INTEGER NOT NULL DEFAULT 0`)
  }

  private readSnapshot(): { snap: Snapshot; received_at: string } | null {
    const rows = this.sql.exec('SELECT body, received_at FROM snapshot WHERE k = 1').toArray()
    if (!rows.length) return null
    return { snap: JSON.parse(String(rows[0].body)) as Snapshot, received_at: String(rows[0].received_at) }
  }

  private getLink(id: string): LinkRow | null {
    const rows = this.sql.exec('SELECT * FROM links WHERE id = ?', id).toArray()
    return rows.length ? toLink(rows[0]) : null
  }

  putSnapshot(snap: Snapshot): { received_at: string; spool_count: number } {
    const now = new Date().toISOString()
    this.sql.exec(
      `INSERT INTO snapshot (k, body, received_at) VALUES (1, ?, ?)
       ON CONFLICT(k) DO UPDATE SET body = excluded.body, received_at = excluded.received_at`,
      JSON.stringify(snap), now)
    return { received_at: now, spool_count: snap.spools.length }
  }

  listLinks(): LinkList {
    const s = this.readSnapshot()
    return {
      snapshot_received_at: s?.received_at ?? null,
      snapshot_generated_at: s?.snap.generated_at ?? null,
      spool_count: s?.snap.spools.length ?? 0,
      links: this.sql.exec('SELECT * FROM links ORDER BY created_at').toArray().map(toLink),
    }
  }

  createLink(input: LinkInput): LinkRow | null {
    const count = Number(this.sql.exec('SELECT COUNT(*) AS n FROM links').one().n)
    if (count >= MAX_LINKS) return null
    const id = newLinkId()
    this.sql.exec(
      `INSERT INTO links (id, name, active, expires_at, hide_empty, lang, brands, materials, show_weight, views, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?)`,
      id, input.name, input.expires_at, input.hide_empty ? 1 : 0, input.lang,
      JSON.stringify(input.brands), JSON.stringify(input.materials), input.show_weight ? 1 : 0,
      new Date().toISOString())
    return this.getLink(id)
  }

  updateLink(id: string, patch: LinkPatch): LinkRow | null {
    if (!this.getLink(id)) return null
    const sets: string[] = []
    const vals: SqlStorageValue[] = []
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name) }
    if (patch.expires_at !== undefined) { sets.push('expires_at = ?'); vals.push(patch.expires_at) }
    if (patch.hide_empty !== undefined) { sets.push('hide_empty = ?'); vals.push(patch.hide_empty ? 1 : 0) }
    if (patch.active !== undefined) { sets.push('active = ?'); vals.push(patch.active ? 1 : 0) }
    if (patch.lang !== undefined) { sets.push('lang = ?'); vals.push(patch.lang) }
    if (patch.brands !== undefined) { sets.push('brands = ?'); vals.push(JSON.stringify(patch.brands)) }
    if (patch.materials !== undefined) { sets.push('materials = ?'); vals.push(JSON.stringify(patch.materials)) }
    if (patch.show_weight !== undefined) { sets.push('show_weight = ?'); vals.push(patch.show_weight ? 1 : 0) }
    if (sets.length) this.sql.exec(`UPDATE links SET ${sets.join(', ')} WHERE id = ?`, ...vals, id)
    return this.getLink(id)
  }

  deleteLink(id: string): boolean {
    if (!this.getLink(id)) return false
    this.sql.exec('DELETE FROM links WHERE id = ?', id)
    return true
  }

  /** New address for an existing link: the old one stops working, settings stay, counter restarts. */
  renewLink(id: string): LinkRow | null {
    if (!this.getLink(id)) return null
    const fresh = newLinkId()
    this.sql.exec(
      'UPDATE links SET id = ?, views = 0, last_view_at = NULL, created_at = ? WHERE id = ?',
      fresh, new Date().toISOString(), id)
    return this.getLink(fresh)
  }

  /** Public read. Unknown, inactive and expired links all return null. */
  view(id: string, count: boolean): { link: PageLink; snapshot: Snapshot | null } | null {
    const link = this.getLink(id)
    const now = new Date()
    if (!link || !link.active || isExpired(link.expires_at, now)) return null
    if (count) {
      this.sql.exec('UPDATE links SET views = views + 1, last_view_at = ? WHERE id = ?', now.toISOString(), id)
    }
    return {
      link: {
        name: link.name, hide_empty: link.hide_empty, lang: link.lang,
        brands: link.brands, materials: link.materials, show_weight: link.show_weight,
      },
      snapshot: this.readSnapshot()?.snap ?? null,
    }
  }
}

const BASE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
}

const PAGE_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

/** The collection page carries one small inline script (search + filters); only exactly that script may run. */
let collectionCsp: Promise<string> | null = null
async function collectionHeaders(): Promise<Record<string, string>> {
  collectionCsp ??= sha256(PAGE_SCRIPT).then((d) => {
    let bin = ''
    for (const b of new Uint8Array(d)) bin += String.fromCharCode(b)
    return PAGE_HEADERS['content-security-policy'].replace('default-src \'none\';', `default-src 'none'; script-src 'sha256-${btoa(bin)}';`)
  })
  return { ...PAGE_HEADERS, 'content-security-policy': await collectionCsp }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  })
}

function notFoundPage(req: Request): Response {
  const body = req.method === 'HEAD' ? null : renderNotFound(pickLang(req.headers.get('accept-language')))
  return new Response(body, { status: 404, headers: PAGE_HEADERS })
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
}

export async function authorized(req: Request, key: string | undefined): Promise<boolean> {
  if (!key || key.length < 32) return false
  const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') ?? '')
  if (!m) return false
  const [a, b] = await Promise.all([sha256(m[1]), sha256(key)])
  return crypto.subtle.timingSafeEqual(a, b)
}

async function readJson(req: Request): Promise<unknown | Response> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
  const buf = await req.arrayBuffer()
  if (buf.byteLength > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413)
  try {
    return JSON.parse(new TextDecoder().decode(buf))
  } catch {
    return json({ error: 'bad_json' }, 400)
  }
}

async function handleApi(req: Request, path: string, store: DurableObjectStub<ShareStore>): Promise<Response> {
  const method = req.method

  if (path === '/api/health' && method === 'GET') return json({ ok: true })

  if (path === '/api/snapshot' && method === 'PUT') {
    const body = await readJson(req)
    if (body instanceof Response) return body
    const snap = cleanSnapshot(body)
    if (!snap) return json({ error: 'bad_snapshot' }, 400)
    return json(await store.putSnapshot(snap))
  }

  if (path === '/api/links' && method === 'GET') return json(await store.listLinks())

  if (path === '/api/links' && method === 'POST') {
    const body = await readJson(req)
    if (body instanceof Response) return body
    const input = cleanLinkInput(body)
    if (typeof input === 'string') return json({ error: input }, 400)
    const link = await store.createLink(input)
    return link ? json(link, 201) : json({ error: 'too_many_links' }, 409)
  }

  const m = /^\/api\/links\/([^/]+)(\/renew)?$/.exec(path)
  if (m && LINK_ID_RE.test(m[1])) {
    const id = m[1]
    if (m[2] && method === 'POST') {
      const link = await store.renewLink(id)
      return link ? json(link) : json({ error: 'not_found' }, 404)
    }
    if (!m[2] && method === 'PATCH') {
      const body = await readJson(req)
      if (body instanceof Response) return body
      const patch = cleanLinkPatch(body)
      if (typeof patch === 'string') return json({ error: patch }, 400)
      const link = await store.updateLink(id, patch)
      return link ? json(link) : json({ error: 'not_found' }, 404)
    }
    if (!m[2] && method === 'DELETE') {
      return (await store.deleteLink(id)) ? json({ ok: true }) : json({ error: 'not_found' }, 404)
    }
  }
  return json({ error: 'not_found' }, 404)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname
    const store = () => env.STORE.get(env.STORE.idFromName('main'))

    if (path === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
      })
    }

    const share = /^\/s\/([^/]+)\/?$/.exec(path)
    if (share) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return notFoundPage(req)
      if (!LINK_ID_RE.test(share[1])) return notFoundPage(req)
      const hit = await store().view(share[1], req.method === 'GET')
      if (!hit) return notFoundPage(req)
      const body = req.method === 'HEAD' ? null : renderCollection(hit.link, hit.snapshot, env.TZ || 'Europe/Berlin')
      return new Response(body, { status: 200, headers: await collectionHeaders() })
    }

    if (path === '/api' || path.startsWith('/api/')) {
      if (!env.PUSH_KEY) return json({ error: 'not_configured' }, 503)
      if (!(await authorized(req, env.PUSH_KEY))) return json({ error: 'unauthorized' }, 401)
      return handleApi(req, path, store())
    }

    return notFoundPage(req)
  },
} satisfies ExportedHandler<Env>
