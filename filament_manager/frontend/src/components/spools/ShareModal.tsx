// "Share collection" (1.20.0): public read-only links served by the Filly share Worker.
// The browser only talks to /api/share/*; the Worker key stays in the backend.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { X, Copy, ExternalLink, RefreshCw, Trash2, Pencil, Plus, ShieldCheck, Loader2, Eye } from 'lucide-react'
import { api } from '../../api'
import type { ShareLang, ShareLink, ShareLinkInput, SharedSpool } from '../../types'
import { useConfirm, useToast } from '../ui/Feedback'
import { copyText } from '../ui/ColorValue'
import { useHATZ } from '../../hooks/useHATZ'
import { formatDateTimeTZ, parseUTC } from '../../utils/time'
import { lookBackground } from '../../utils/colorLook'

const LANGS: ShareLang[] = ['de', 'en', 'es']
const EXPIRY = ['never', 'd1', 'd7', 'd30', 'd90'] as const
type Expiry = typeof EXPIRY[number] | 'keep'
const EXPIRY_DAYS: Record<string, number> = { d1: 1, d7: 7, d30: 30, d90: 90 }

function expiryToIso(e: Expiry): string | null | undefined {
  if (e === 'keep') return undefined
  if (e === 'never') return null
  return new Date(Date.now() + EXPIRY_DAYS[e] * 86_400_000).toISOString()
}

/** "409: {"detail":"not_configured"}" → "not_configured" */
function errorCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return /"detail"\s*:\s*"([a-z_]+)"/.exec(msg)?.[1] ?? 'unknown'
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-surface-3'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span>{label}</span>
    </label>
  )
}

function Swatch({ s }: { s: SharedSpool }) {
  const bg = lookBackground({
    color_hex: s.colors[0], color2_hex: s.colors[1], color3_hex: s.colors[2], color4_hex: s.colors[3],
    color_mode: s.color_mode, color_effect: s.color_effect,
  })
  return <span className="inline-block w-4 h-4 rounded-full border border-surface-4 shrink-0" style={{ background: bg }} />
}

function Preview() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({ queryKey: ['share-preview'], queryFn: api.getSharePreview })
  if (isLoading || !data) return <p className="text-xs text-gray-500 px-1 py-2">{t('common.loading')}</p>
  return (
    <div className="max-h-60 overflow-y-auto rounded-lg border border-surface-3">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-2">
          <tr className="text-left text-gray-400">
            <th className="px-2 py-1.5">{t('share.col.color')}</th>
            <th className="px-2 py-1.5">{t('share.col.brand')}</th>
            <th className="px-2 py-1.5">{t('share.col.material')}</th>
            <th className="px-2 py-1.5 text-right">{t('share.col.rest')}</th>
          </tr>
        </thead>
        <tbody>
          {data.spools.map((s, i) => (
            <tr key={i} className="border-t border-surface-3/50">
              <td className="px-2 py-1"><span className="flex items-center gap-1.5"><Swatch s={s} /><span className="truncate">{s.color_name}</span></span></td>
              <td className="px-2 py-1 truncate">{s.brand}</td>
              <td className="px-2 py-1 truncate">{s.material}{s.subtype ? ` ${s.subtype}` : ''}</td>
              <td className="px-2 py-1 text-right tabular-nums">{s.remaining_pct} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LinkFields({ name, setName, expiry, setExpiry, lang, setLang, withKeep }: {
  name: string; setName: (v: string) => void
  expiry: Expiry; setExpiry: (v: Expiry) => void
  lang: ShareLang; setLang: (v: ShareLang) => void
  withKeep?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <label className="flex flex-col gap-1">
        <span className="label">{t('share.name')}</span>
        <input className="input" value={name} maxLength={60} onChange={e => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">{t('share.expires')}</span>
        <select className="input" value={expiry} onChange={e => setExpiry(e.target.value as Expiry)}>
          {withKeep && <option value="keep">{t('share.expiry.keep')}</option>}
          {EXPIRY.map(x => <option key={x} value={x}>{t(`share.expiry.${x}`)}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">{t('share.pageLang')}</span>
        <select className="input" value={lang} onChange={e => setLang(e.target.value as ShareLang)}>
          {LANGS.map(l => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}
        </select>
      </label>
    </div>
  )
}

function LinkCard({ link, onError }: { link: ShareLink; onError: (e: unknown) => void }) {
  const { t } = useTranslation()
  const tz = useHATZ()
  const qc = useQueryClient()
  const toast = useToast()
  const { confirm } = useConfirm()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(link.name)
  const [expiry, setExpiry] = useState<Expiry>('keep')
  const [lang, setLang] = useState<ShareLang>(link.lang)

  const refresh = () => qc.invalidateQueries({ queryKey: ['share-links'] })
  const update = useMutation({
    mutationFn: (data: ShareLinkInput) => api.updateShareLink(link.id, data),
    onSuccess: () => { refresh(); setEditing(false) },
    onError,
  })
  const renew = useMutation({ mutationFn: () => api.renewShareLink(link.id), onSuccess: refresh, onError })
  const remove = useMutation({ mutationFn: () => api.deleteShareLink(link.id), onSuccess: refresh, onError })
  const busy = update.isPending || renew.isPending || remove.isPending

  const expired = link.expires_at != null && parseUTC(link.expires_at).getTime() <= Date.now()
  const state = expired ? 'expired' : link.active ? 'active' : 'off'
  const stateClass = state === 'active' ? 'text-ok border-ok/40' : state === 'expired' ? 'text-warn border-warn/40' : 'text-gray-400 border-surface-4'

  const copy = async () => {
    if (await copyText(link.url)) toast(t('share.copied'))
    else toast.error(t('common.copyFailed'))
  }
  const askRenew = async () => {
    if (await confirm({ title: t('share.renewConfirm', { name: link.name }), message: t('share.renewMessage'), confirmLabel: t('share.renew') })) renew.mutate()
  }
  const askDelete = async () => {
    if (await confirm({ title: t('share.deleteConfirm', { name: link.name }), message: t('share.deleteMessage'), danger: true })) remove.mutate()
  }
  const save = () => {
    const data: ShareLinkInput = { name: name.trim(), lang }
    const iso = expiryToIso(expiry)
    if (iso !== undefined) data.expires_at = iso
    update.mutate(data)
  }

  return (
    <li className="rounded-xl border border-surface-3 bg-surface/40 p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-start gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="font-semibold break-words">{link.name}</div>
          <div className="text-xs text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            <span>{t('share.views', { count: link.views })}</span>
            {link.last_view_at && <span>{t('share.lastView', { time: formatDateTimeTZ(link.last_view_at, tz) })}</span>}
            <span>{link.expires_at
              ? t(expired ? 'share.expiredAt' : 'share.expiresAt', { time: formatDateTimeTZ(link.expires_at, tz) })
              : t('share.noExpiry')}</span>
            <span>{t(`lang.${link.lang}`)}</span>
          </div>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${stateClass}`}>{t(`share.state.${state}`)}</span>
      </div>

      <div className="flex items-center gap-1 min-w-0">
        <code className="flex-1 min-w-0 truncate text-xs bg-surface-3/60 rounded-md px-2 py-1.5" title={link.url}>{link.url}</code>
        <button className="btn-ghost p-2" onClick={copy} title={t('share.copy')} aria-label={t('share.copy')}><Copy size={15} /></button>
        <a className="btn-ghost p-2" href={link.url} target="_blank" rel="noopener noreferrer" title={t('share.open')} aria-label={t('share.open')}><ExternalLink size={15} /></a>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Switch on={link.active} label={t('share.active')} disabled={busy} onChange={v => update.mutate({ active: v })} />
        <Switch on={link.hide_empty} label={t('share.hideEmpty')} disabled={busy} onChange={v => update.mutate({ hide_empty: v })} />
        <div className="ml-auto flex items-center gap-1">
          {busy && <Loader2 size={15} className="animate-spin text-gray-400" />}
          <button className="btn-ghost p-2" onClick={() => setEditing(e => !e)} title={t('common.edit')} aria-label={t('common.edit')}><Pencil size={15} /></button>
          <button className="btn-ghost p-2" onClick={askRenew} disabled={busy} title={t('share.renew')} aria-label={t('share.renew')}><RefreshCw size={15} /></button>
          <button className="btn-ghost p-2 text-crit" onClick={askDelete} disabled={busy} title={t('common.delete')} aria-label={t('common.delete')}><Trash2 size={15} /></button>
        </div>
      </div>

      {editing && (
        <div className="flex flex-col gap-2 border-t border-surface-3 pt-2">
          <LinkFields name={name} setName={setName} expiry={expiry} setExpiry={setExpiry} lang={lang} setLang={setLang} withKeep />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={save} disabled={busy || !name.trim()}>{t('common.save')}</button>
          </div>
        </div>
      )}
    </li>
  )
}

export default function ShareModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const tz = useHATZ()
  const qc = useQueryClient()
  const toast = useToast()
  const uiLang = (i18n.resolvedLanguage ?? 'en') as ShareLang
  const [name, setName] = useState(t('share.defaultName'))
  const [expiry, setExpiry] = useState<Expiry>('never')
  const [lang, setLang] = useState<ShareLang>(LANGS.includes(uiLang) ? uiLang : 'en')
  const [hideEmpty, setHideEmpty] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const errorText = (e: unknown) => {
    const code = errorCode(e)
    return code === 'unknown' ? t('share.errors.unknown', { msg: e instanceof Error ? e.message : String(e) }) : t(`share.errors.${code}`, code)
  }
  const onError = (e: unknown) => toast.error(errorText(e))

  const status = useQuery({ queryKey: ['share-status'], queryFn: api.getShareStatus })
  const configured = status.data?.configured === true
  const links = useQuery({
    queryKey: ['share-links'], queryFn: api.getShareLinks, enabled: configured, retry: false,
  })

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['share-links'] })
    qc.invalidateQueries({ queryKey: ['share-status'] })
  }
  const create = useMutation({
    mutationFn: () => api.createShareLink({ name: name.trim(), expires_at: expiryToIso(expiry) ?? null, hide_empty: hideEmpty, lang }),
    onSuccess: async (link) => {
      refreshAll()
      setShowNew(false)
      setName(t('share.defaultName'))
      toast((await copyText(link.url)) ? t('share.createdCopied') : t('share.created'))
    },
    onError,
  })
  const push = useMutation({
    mutationFn: api.pushShare,
    onSuccess: () => { refreshAll(); toast(t('share.pushed')) },
    onError,
  })

  const st = status.data
  const list = links.data

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="fm-share-title"
        className="bg-surface-2 border border-surface-3 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-surface-3 shrink-0">
          <h2 id="fm-share-title" className="font-semibold">{t('share.title')}</h2>
          <button onClick={onClose} className="btn-ghost p-1" aria-label={t('common.close')}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 sm:px-5 py-4 flex flex-col gap-4">
          <p className="text-sm text-gray-300">{t('share.intro')}</p>
          <div className="flex gap-2 text-xs text-gray-400 bg-surface-3/40 rounded-lg p-2.5">
            <ShieldCheck size={16} className="text-ok shrink-0 mt-0.5" />
            <span>{t('share.sharedFields')}</span>
          </div>

          {status.isLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}

          {st && !configured && (
            <div className="rounded-xl border border-warn/40 p-3 text-sm flex flex-col gap-1">
              <div className="font-semibold text-warn">{t('share.setupTitle')}</div>
              {st.problem && st.problem !== 'not_configured' && <div>{t(`share.errors.${st.problem}`)}</div>}
              <div className="text-gray-300">{t('share.setupHint')}</div>
            </div>
          )}

          {configured && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                <span>
                  {st?.last_push_at
                    ? t('share.lastPush', { time: formatDateTimeTZ(st.last_push_at, tz), count: st.spool_count ?? 0 })
                    : t('share.neverPushed')}
                </span>
                {st?.last_error && <span className="text-crit">{t(`share.errors.${st.last_error}`, st.last_error)}</span>}
                <button className="btn-ghost !py-1 !px-2 flex items-center gap-1 ml-auto" onClick={() => push.mutate()} disabled={push.isPending}>
                  {push.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}{t('share.pushNow')}
                </button>
              </div>

              {links.isLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
              {links.isError && <p className="text-sm text-crit">{errorText(links.error)}</p>}

              {list && (
                list.links.length === 0
                  ? <p className="text-sm text-gray-500">{t('share.noLinks')}</p>
                  : <ul className="flex flex-col gap-2">{list.links.map(l => <LinkCard key={l.id} link={l} onError={onError} />)}</ul>
              )}

              {list && (showNew ? (
                <div className="rounded-xl border border-accent/40 p-3 flex flex-col gap-2">
                  <div className="font-semibold text-sm">{t('share.newLink')}</div>
                  <LinkFields name={name} setName={setName} expiry={expiry} setExpiry={setExpiry} lang={lang} setLang={setLang} />
                  <Switch on={hideEmpty} label={t('share.hideEmpty')} onChange={setHideEmpty} />
                  <div className="flex justify-end gap-2">
                    <button className="btn-ghost" onClick={() => setShowNew(false)}>{t('common.cancel')}</button>
                    <button className="btn-primary flex items-center gap-1.5" onClick={() => create.mutate()} disabled={create.isPending || !name.trim()}>
                      {create.isPending && <Loader2 size={14} className="animate-spin" />}{t('share.create')}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn-primary self-start flex items-center gap-1.5" onClick={() => setShowNew(true)}>
                  <Plus size={14} />{t('share.newLink')}
                </button>
              ))}
            </>
          )}

          <div className="flex flex-col gap-2">
            <button className="btn-ghost self-start !px-2 flex items-center gap-1.5 text-sm" onClick={() => setShowPreview(p => !p)} aria-expanded={showPreview}>
              <Eye size={14} />{t('share.preview')}
            </button>
            {showPreview && <Preview />}
          </div>
        </div>
      </div>
    </div>
  )
}
