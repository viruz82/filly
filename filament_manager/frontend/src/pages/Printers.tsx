// Printers page: live print card, one card per AMS slot (spool, state, questions), maintenance line.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronUp, Wrench, Info } from 'lucide-react'
import { api } from '../api'
import type { AMSTray, PrinterConfig, PrinterStatus, Spool } from '../types'
import PageHeader from '../components/ui/PageHeader'
import Ring from '../components/ui/Ring'
import ColorValue from '../components/ui/ColorValue'
import { useConfirm, useToast } from '../components/ui/Feedback'
import { CandidateList } from '../components/printers/AmsCandidates'
import { materialMatches, rankSpoolCandidates } from '../utils/amsMatch'
import { COLOR_TOLERANCE, colorDelta } from '../utils/color'
import { fmtNum } from '../utils/number'

const RUNNING_STATES = ['RUNNING', 'PAUSE', 'PREPARE']

function fmtDuration(minutes: string | null | undefined): string | null {
  const m = Number(minutes)
  if (!Number.isFinite(m) || minutes == null || minutes === '') return null
  const h = Math.floor(m / 60)
  return h > 0 ? `${h} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="relative w-16 h-16 shrink-0" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(128,128,128,0.25)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(var(--fm-accent))" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">{Math.round(pct)} %</span>
    </div>
  )
}

/** "ams1_tray3" → "3"; with several AMS units "2·3" (unit · tray). */
function slotNumber(key: string): string {
  return key.replace(/ams(\d+)_tray(\d+)/, (_m, u, n) => (u === '1' ? `${n}` : `${u}·${n}`))
}

// ── Live card ────────────────────────────────────────────────────────────────

function LiveCard({ printer, status }: { printer: PrinterConfig; status: PrinterStatus | undefined }) {
  const { t, i18n } = useTranslation()
  const { confirm } = useConfirm()
  const qc = useQueryClient()

  const { data: stats } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.getDashboard(), refetchInterval: 30_000 })
  const job = stats?.running_job && stats.running_job.printer_name === printer.name ? stats.running_job : null
  const last = stats?.recent_prints?.find(p => p.printer_name === printer.name) ?? stats?.recent_prints?.[0] ?? null

  const finishMut = useMutation({
    mutationFn: () => api.updatePrint(job!.id, { finished_at: new Date().toISOString(), success: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })

  const state = (status?.print_stage ?? '').toUpperCase()
  const running = RUNNING_STATES.includes(state)

  if (!running) {
    return (
      <div className="card flex items-center gap-3 flex-wrap">
        <span className="pill pill-ok shrink-0">{state && state !== 'IDLE' ? t(`printers.state.${state}`, { defaultValue: state }) : t('printers.state.IDLE')}</span>
        <div className="min-w-0 flex-1">
          {last ? (
            <>
              <p className="text-xs text-gray-500">{t('printers.lastPrint')}</p>
              <p className="text-sm font-semibold text-white truncate">{last.name}</p>
              <p className="text-xs text-gray-400 tabular-nums">{fmtNum(last.total_grams, 1)} g</p>
            </>
          ) : (
            <p className="text-sm text-gray-400">{t('printers.noPrintYet')}</p>
          )}
        </div>
        {last && <Link to="/prints" className="btn bg-surface-3 hover:bg-surface-4 text-xs">{t('printers.toPrints')}</Link>}
      </div>
    )
  }

  const pct = status?.print_progress != null && status.print_progress !== '' ? Number(status.print_progress) : 0
  const code = status?.stage_code
  const stageKnown = code != null && !['255', '-1', '0'].includes(code)
  const stageText = stageKnown ? t(`printers.stage.${code}`, { defaultValue: '' }) : ''
  const layers = status?.layer_num != null && status?.total_layer_num != null
    ? `${t('printers.layer')} ${status.layer_num} / ${status.total_layer_num}` : null
  const remaining = fmtDuration(status?.remaining_time)
  const remMin = status?.remaining_time != null && status.remaining_time !== '' ? Number(status.remaining_time) : NaN
  let finishAt: string | null = null
  if (Number.isFinite(remMin) && remMin >= 0) {
    const end = new Date(Date.now() + remMin * 60000)
    const clock = end.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
    finishAt = end.toDateString() === new Date().toDateString()
      ? t('printers.finishAt', { time: clock })
      : t('printers.finishAtTomorrow', { time: clock })
  }

  return (
    <div className="card border border-info/40 bg-info/10">
      <div className="flex items-center gap-4 flex-wrap">
        <ProgressRing pct={Number.isFinite(pct) ? pct : 0} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">{t('printers.running')}</p>
          <p className="text-base font-semibold text-white truncate">{job?.name ?? status?.current_file ?? '—'}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {layers && <span className="pill">{layers}</span>}
            {remaining && <span className="pill">{t('printers.remaining', { time: remaining })}</span>}
            {finishAt && <span className="pill">{finishAt}</span>}
            {status?.active_tray && <span className="pill pill-info">{t('printers.activeSlot', { slot: slotNumber(status.active_tray) })}</span>}
            {status?.nozzle_temp && <span className="pill">{t('printers.nozzle')} {fmtNum(Number(status.nozzle_temp), 0)} °C</span>}
            {status?.bed_temp && <span className="pill">{t('printers.bed')} {fmtNum(Number(status.bed_temp), 0)} °C</span>}
          </div>
          <p className="mt-2 text-sm text-white flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
            {stageText || t(`printers.state.${state}`, { defaultValue: state })}
          </p>
        </div>
        {job && (
          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5 text-xs flex items-center gap-1 border border-surface-3 shrink-0"
            disabled={finishMut.isPending}
            onClick={async () => { if (await confirm({ title: t('dashboard.forceFinishConfirm') })) finishMut.mutate() }}
          >
            <CheckCircle2 size={13} /> {t('dashboard.forceFinish')}
          </button>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden mt-3">
        <div className="h-full bg-accent rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  )
}

// ── One AMS slot ─────────────────────────────────────────────────────────────

type SlotKind = 'empty' | 'assigned' | 'changed' | 'ask'

function slotKind(tr: AMSTray): SlotKind {
  const hasFilament = !!tr.ha_material && !!tr.ha_color_hex && tr.ha_remaining !== '0' && tr.ha_remaining !== '0.0'
  if (tr.spool) {
    if (!hasFilament || tr.confirmed) return 'assigned'
    const d = colorDelta(tr.ha_color_hex, tr.spool.color_hex)
    const fits = materialMatches(tr.ha_material as string, tr.spool) && d !== null && d <= COLOR_TOLERANCE
    return fits ? 'assigned' : 'changed'
  }
  return hasFilament ? 'ask' : 'empty'
}

function SlotCard({ tr, spools, lowPct, active, open, onToggle, onAssign, pending }: {
  tr: AMSTray
  spools: Spool[]
  lowPct: number
  active: boolean
  open: boolean
  onToggle: () => void
  onAssign: (spoolId: number | null) => void
  pending: boolean
}) {
  const { t } = useTranslation()
  const kind = slotKind(tr)
  const n = slotNumber(tr.slot_key)

  if (kind === 'empty') {
    return (
      <div className="rounded-2xl border border-dashed border-surface-3 p-3 flex items-center gap-3 text-gray-500">
        <span className="w-12 h-12 rounded-full border border-dashed border-surface-3 grid place-items-center text-xs shrink-0">{n}</span>
        <div>
          <p className="text-sm">{t('printers.empty')}</p>
          <p className="text-xs">{t('printers.noFilament')}</p>
        </div>
      </div>
    )
  }

  if (kind === 'ask' || kind === 'changed') {
    const candidates = rankSpoolCandidates(tr, spools, tr.spool ? new Set([tr.spool.id]) : undefined).slice(0, 3)
    return (
      <div className="rounded-2xl border border-warn/40 bg-warn/10 p-3">
        <div className="flex items-center gap-3">
          <span className="w-4 h-4 rounded-full shrink-0 border border-white/20" style={{ background: tr.ha_color_hex ?? '#888' }} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{t('dashboard.amsWhichSpool', { slot: tr.slot_key.replace(/ams(\d+)_tray(\d+)/, 'AMS $1 · T$2') })}</p>
            <p className="text-xs text-gray-400">
              {kind === 'changed' && tr.spool
                ? t('printers.changed', { spool: tr.spool.color_name, material: tr.ha_material })
                : t('printers.printerReports', { material: tr.ha_material })}
            </p>
          </div>
        </div>
        {candidates.length === 0 && <p className="text-xs text-gray-400 mt-2 pl-7">{t('dashboard.amsNoMatch')}</p>}
        <CandidateList candidates={candidates} pending={pending} onAssign={id => onAssign(id)} moves />
        <div className="mt-3 pl-6">
          <SpoolPicker spools={spools} onPick={id => onAssign(id)} pending={pending} placeholder={t('printers.pickOther')} />
        </div>
      </div>
    )
  }

  const s = tr.spool as Spool
  const pct = Math.round(s.remaining_pct)
  const low = pct <= lowPct
  const almost = pct <= 8
  return (
    <div className={`rounded-2xl border bg-surface p-3 ${active ? 'border-accent/60' : 'border-surface-3'}`}>
      <button type="button" onClick={onToggle} className="w-full text-left flex items-center gap-3" aria-expanded={open}>
        <Ring spool={s} pct={pct} size={48} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{s.custom_id ? `#${s.custom_id} ` : ''}{s.color_name}</p>
          <p className="text-xs text-gray-400 truncate">{s.brand} {s.material}{s.subtype ? ` ${s.subtype}` : ''}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <span className="pill pill-ok">{t('printers.chip.assigned')}</span>
            {tr.ha_material && <span className="pill">{t('printers.chip.printer', { material: tr.ha_material })}</span>}
            {active && <span className="pill pill-info">{t('printers.chip.active')}</span>}
            {almost ? <span className="pill pill-crit">{t('printers.chip.almostEmpty')}</span>
              : low ? <span className="pill pill-warn">{t('printers.chip.low')}</span> : null}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-semibold tabular-nums leading-none">{fmtNum(s.current_weight_g, 0)} g</p>
          <p className="text-xs text-gray-400 tabular-nums">{fmtNum(s.remaining_pct, 1)} %</p>
          <span className="text-gray-500 inline-block mt-1">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
        </div>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-surface-3 flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-gray-400">{t('printers.printerReportsLabel')}</dt>
            <dd className="text-right text-gray-100 break-words">
              {tr.ha_material ?? '—'}{tr.ha_remaining ? ` · ${fmtNum(Number(tr.ha_remaining), 0)} %` : ''}
            </dd>
            <dt className="text-gray-400">{t('printers.slotColour')}</dt>
            <dd className="flex justify-end"><ColorValue hex={tr.ha_color_hex} className="justify-end" /></dd>
            <dt className="text-gray-400">{t('printers.spoolColour')}</dt>
            <dd className="flex justify-end"><ColorValue hex={s.color_hex} className="justify-end" /></dd>
            {s.moisture?.pct != null && (
              <>
                <dt className="text-gray-400">{t('moisture.title')}</dt>
                <dd className="text-right text-gray-100">{Math.round(s.moisture.pct)} % · {t(`moisture.level.${s.moisture.level}`)}</dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/spools?spool=${s.id}`} className="btn bg-surface-3 hover:bg-surface-4 text-xs">{t('printers.toSpool')}</Link>
            <button type="button" className="btn bg-surface-3 hover:bg-surface-4 text-xs" disabled={pending} onClick={() => onAssign(null)}>
              {t('printers.clearSlot')}
            </button>
            <SpoolPicker spools={spools.filter(x => x.id !== s.id)} onPick={id => onAssign(id)} pending={pending} placeholder={t('printers.changeSpool')} />
          </div>
        </div>
      )}
    </div>
  )
}

function SpoolPicker({ spools, onPick, pending, placeholder }: {
  spools: Spool[]; onPick: (id: number) => void; pending: boolean; placeholder: string
}) {
  const options = spools.filter(s => !s.archived && s.current_weight_g > 0)
  return (
    <select
      className="input !py-1 text-xs max-w-[14rem]"
      value=""
      disabled={pending}
      aria-label={placeholder}
      onChange={e => { if (e.target.value) onPick(Number(e.target.value)) }}
    >
      <option value="">{placeholder}</option>
      {options.map(s => (
        <option key={s.id} value={s.id}>
          {s.custom_id ? `#${s.custom_id} ` : ''}{s.brand} {s.material} — {s.color_name}
        </option>
      ))}
    </select>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Printers() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [selPrinter, setSelPrinter] = useState<number | null>(null)
  const [openSlot, setOpenSlot] = useState<string | null>(null)

  const { data: printers = [], isLoading } = useQuery({ queryKey: ['printers'], queryFn: () => api.getPrinters() })
  const cloud = printers.filter(p => p.bambu_serial && p.is_active)
  const printer = cloud.find(p => p.id === selPrinter) ?? cloud[0] ?? null

  const { data: status } = useQuery<PrinterStatus>({
    queryKey: ['printer-status-live', printer?.id],
    queryFn: () => api.getPrinterStatus(printer!.id),
    enabled: !!printer,
    refetchInterval: 10_000,
  })
  const { data: trays = [] } = useQuery<AMSTray[]>({
    queryKey: ['printer-ams', printer?.id],
    queryFn: () => api.getPrinterAMS(printer!.id),
    enabled: !!printer,
    refetchInterval: 15_000,
  })
  const { data: spools = [] } = useQuery({ queryKey: ['spools'], queryFn: () => api.getSpools() })
  const { data: prefs } = useQuery({ queryKey: ['user-prefs'], queryFn: () => api.getUserPrefs() })
  const { data: tasks = [] } = useQuery({ queryKey: ['maintenance'], queryFn: () => api.getMaintenance() })

  const assignMut = useMutation({
    mutationFn: ({ slot, spoolId }: { slot: string; spoolId: number | null }) =>
      api.assignAMSTray(printer!.id, slot, spoolId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printer-ams'] })
      qc.invalidateQueries({ queryKey: ['spools'] })
      toast(t('dashboard.amsAssigned'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) return null

  if (!printer) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('printers.title')} />
        <div className="card text-sm text-gray-400">
          {t('printers.none')} <Link to="/settings" className="text-accent underline">{t('nav.settings')}</Link>
        </div>
      </div>
    )
  }

  const lowPct = prefs?.low_stock_threshold_pct ?? 20
  const kinds = trays.map(slotKind)
  const nLow = trays.filter((tr, i) => kinds[i] === 'assigned' && tr.spool && Math.round(tr.spool.remaining_pct) <= lowPct).length
  const nAsk = kinds.filter(k => k === 'ask' || k === 'changed').length
  const nEmpty = kinds.filter(k => k === 'empty').length
  const summary = [
    t('printers.slots', { count: trays.length }),
    nAsk > 0 ? t('printers.needYou', { count: nAsk }) : null,
    nLow > 0 ? t('printers.lowCount', { count: nLow }) : null,
    nEmpty > 0 ? t('printers.emptyCount', { count: nEmpty }) : null,
  ].filter(Boolean).join(' · ')

  const due = tasks.filter(x => x.enabled && x.level === 'due').length
  const soon = tasks.filter(x => x.enabled && x.level === 'soon').length
  const nextTask = [...tasks].filter(x => x.enabled && x.pct != null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('printers.title')}
        actions={
          <>
            {cloud.length > 1 && cloud.map(p => (
              <button key={p.id} type="button" onClick={() => { setSelPrinter(p.id); setOpenSlot(null) }}
                className={`chip ${p.id === printer.id ? 'chip-on' : ''}`}>{p.name}</button>
            ))}
            <span className={`pill ${status ? 'pill-ok' : ''}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${status ? 'bg-ok' : 'bg-gray-500'}`} /> {status ? t('printers.live') : t('printers.offline')}
            </span>
            {cloud.length === 1 && <span className="pill">{printer.name}</span>}
          </>
        }
      />

      <LiveCard printer={printer} status={status} />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold">{t('printers.slotsTitle')} <span className="text-xs font-normal text-gray-500 ml-1">{summary}</span></h3>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2">
        {trays.map(tr => (
          <SlotCard
            key={tr.slot_key}
            tr={tr}
            spools={spools}
            lowPct={lowPct}
            active={status?.active_tray === tr.slot_key && RUNNING_STATES.includes((status?.print_stage ?? '').toUpperCase())}
            open={openSlot === tr.slot_key}
            onToggle={() => setOpenSlot(openSlot === tr.slot_key ? null : tr.slot_key)}
            pending={assignMut.isPending}
            onAssign={spoolId => assignMut.mutate({ slot: tr.slot_key, spoolId })}
          />
        ))}
      </div>

      <details className="card text-xs text-gray-400">
        <summary className="cursor-pointer flex items-center gap-2 text-gray-300"><Info size={13} /> {t('printers.legendTitle')}</summary>
        <ul className="mt-2 space-y-1.5">
          {['assigned', 'printer', 'active', 'low', 'almostEmpty'].map(k => (
            <li key={k}><span className="text-gray-200">{t(`printers.chip.${k}`, { material: 'PLA' })}</span> — {t(`printers.legend.${k}`)}</li>
          ))}
          <li><span className="text-gray-200">{t('printers.legendAsk')}</span> — {t('printers.legend.ask')}</li>
        </ul>
      </details>

      <Link to="/maintenance" className="card flex items-center gap-3 hover:bg-surface-2 transition-colors">
        <Wrench size={18} className={due > 0 ? 'text-crit' : soon > 0 ? 'text-warn' : 'text-ok'} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('nav.maintenance')}</p>
          <p className="text-xs text-gray-400 truncate">
            {due > 0 ? t('printers.maintDue', { count: due }) : soon > 0 ? t('printers.maintSoon', { count: soon }) : t('printers.maintOk', { count: tasks.filter(x => x.enabled).length })}
            {nextTask ? ` · ${t('printers.maintNext', { name: nextTask.name })}` : ''}
          </p>
        </div>
        <span className="text-xs text-accent shrink-0">{t('printers.maintOpen')}</span>
      </Link>
    </div>
  )
}
