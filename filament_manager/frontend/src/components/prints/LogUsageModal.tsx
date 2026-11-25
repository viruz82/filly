import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import type { PrintJob, Spool, AMSTray, PrinterConfig } from '../../types'
import { X, RefreshCw } from 'lucide-react'
import { fmtNum } from '../../utils/number'

// ── Log / change usage modal ──────────────────────────────────────────────────
// Used for prints without a confirmed usage ("Verbrauch fehlt") and, since 1.23.0,
// also to change the spool or the grams of an already booked print.

export interface UsageSave { spool_id: number | null; grams_used: number; ams_slot: string | null }

/** One editable row. spool_id '' = not chosen yet, null = explicitly "without spool". */
interface Row {
  spool_id: number | '' | null
  grams: string
  ams_slot: string | null
  color: string | null
  filament_type: string
  estimated: boolean
  swap_index: number | null
  guess: boolean          // spool only taken from what sits in the tray NOW
  extra: boolean          // added by the user
}

const spoolText = (s: Spool) =>
  `${s.custom_id != null ? `#${s.custom_id} ` : ''}${s.brand} ${s.material}${s.subtype ? ` ${s.subtype}` : ''} · ${s.color_name} (${Math.round(s.remaining_pct)}%)`

export function LogUsageModal({
  job,
  onSave,
  onCancel,
  onEdit,
}: {
  job: PrintJob
  onSave: (usages: UsageSave[]) => void
  onCancel: () => void
  onEdit: () => void
}) {
  const { t } = useTranslation()

  const { data: spools = [] } = useQuery<Spool[]>({
    queryKey: ['spools'],
    queryFn: () => api.getSpools(),
  })

  const confirmed = job.usages.length > 0
  const suggestions = job.suggested_usages ?? []
  // Booked as "no usage (0 g)": no usages and the suggestions were cleared on confirm.
  const zeroBooked = !confirmed && job.suggested_usages === null

  // Older suggestions have no spool_id: look up the tray (what sits there NOW, so only a guess).
  const { data: printers = [] } = useQuery<PrinterConfig[]>({
    queryKey: ['printers'],
    queryFn: api.getPrinters,
  })
  const printer = printers.find(p => p.name === job.printer_name) ?? null
  const { data: trays = [], isLoading: traysLoading, refetch: refetchTrays } = useQuery<AMSTray[]>({
    queryKey: ['printer-ams', printer?.id],
    queryFn: () => api.getPrinterAMS(printer!.id),
    enabled: !!printer && !confirmed && suggestions.length > 0,
  })

  const [rows, setRows] = useState<Row[]>(() =>
    confirmed
      ? job.usages.map(u => ({
          spool_id: u.spool_id, grams: String(u.grams_used), ams_slot: u.ams_slot,
          color: u.spool?.color_hex ?? null, filament_type: u.spool?.material ?? '',
          estimated: false, swap_index: null, guess: false, extra: false,
        }))
      : zeroBooked
        ? [{
            spool_id: '', grams: '', ams_slot: null, color: null, filament_type: '',
            estimated: false, swap_index: null, guess: false, extra: true,
          }]
        : suggestions.map(s => ({
            spool_id: s.spool_id ?? '', grams: String(s.grams), ams_slot: s.ams_slot,
            color: s.color, filament_type: s.filament_type,
            estimated: !!s.estimated, swap_index: s.swap_index ?? null, guess: false, extra: false,
          })),
  )

  // A row may point to an archived spool (e.g. a suggestion for a spool used up since):
  // load it with the archived ones so the row shows its number and name, not the internal id.
  const activeIds = new Set(spools.map(s => s.id))
  const needArchived = rows.some(r => typeof r.spool_id === 'number' && !activeIds.has(r.spool_id))
  const { data: allSpools = [] } = useQuery<Spool[]>({
    queryKey: ['spools', 'with-archived'],
    queryFn: () => api.getSpools(true),
    enabled: needArchived,
  })

  // Fill rows without a spool from the current tray content, marked as a guess.
  useEffect(() => {
    if (!trays.length) return
    setRows(rs => rs.map(r => {
      if (r.spool_id !== '' || r.extra || !r.ams_slot) return r
      const tray = trays.find(tr => tr.slot_key === r.ams_slot)
      return tray?.spool ? { ...r, spool_id: tray.spool.id, guess: true } : r
    }))
  }, [trays])

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  // Spools in the AMS first, then the rest by number; empty ones only when already chosen.
  const chosen = new Set(rows.map(r => r.spool_id).filter((v): v is number => typeof v === 'number'))
  const { inAms, others } = useMemo(() => {
    const byNr = (a: Spool, b: Spool) => (a.custom_id ?? 1e9) - (b.custom_id ?? 1e9) || a.id - b.id
    const usable = spools.filter(s => Math.round(s.remaining_pct) > 0 || chosen.has(s.id))
    return {
      inAms: usable.filter(s => s.ams_slot).sort(byNr),
      others: usable.filter(s => !s.ams_slot).sort(byNr),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spools, rows])

  const hasUnresolved = !traysLoading && rows.some(r => r.spool_id === '')
  const canSave = rows.some(r => (parseFloat(r.grams) || 0) > 0)

  const handleSave = () => {
    const usages: UsageSave[] = []
    rows.forEach(r => {
      const g = parseFloat(r.grams || '0')
      if (g <= 0 || r.spool_id === '') return        // no spool chosen → not booked
      usages.push({ spool_id: r.spool_id, grams_used: g, ams_slot: r.ams_slot })
    })
    onSave(usages)
  }

  // Failed / aborted print without any filament used: book 0 g (reverts earlier usage).
  const handleNoUsage = () => {
    if (confirmed && !window.confirm(t('prints.noUsageConfirm'))) return
    onSave([])
  }

  const addRow = () => setRows(rs => [...rs, {
    spool_id: '', grams: '', ams_slot: null, color: null, filament_type: '',
    estimated: false, swap_index: null, guess: false, extra: true,
  }])

  const NO_SPOOL = 'none'
  const selectValue = (r: Row) => (r.spool_id === null ? NO_SPOOL : String(r.spool_id))

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-2 border border-surface-3 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <div>
            <h2 className="font-semibold">{confirmed || zeroBooked ? t('prints.changeUsage') : t('prints.logUsage')}</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{job.name}</p>
          </div>
          <button onClick={onCancel} className="btn-ghost p-1"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <p className="text-xs text-info bg-info/15 rounded px-3 py-1.5">
            {confirmed ? t('prints.changeUsageHint') : zeroBooked ? t('prints.zeroBookedHint') : t('prints.cloudSuggestion')}
          </p>

          {rows.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">{t('prints.noCloudData')}</p>
              <button className="btn-secondary w-full" onClick={onEdit}>
                {t('prints.logManually')}
              </button>
            </div>
          )}

          {rows.map((r, i) => {
            const spool = typeof r.spool_id === 'number'
              ? spools.find(sp => sp.id === r.spool_id) ?? allSpools.find(sp => sp.id === r.spool_id) ?? null
              : null
            const inactive = typeof r.spool_id === 'number' && !activeIds.has(r.spool_id)
            const swapLabel = r.swap_index === 0 ? t('prints.swapOriginal') : r.swap_index === 1 ? t('prints.swapReplacement') : null
            return (
              <div key={i} className={`flex items-start gap-3 ${r.swap_index != null ? 'rounded-lg border border-warn/40 bg-warn/15 p-2' : ''}`}>
                <span
                  className="w-3 h-3 rounded-full shrink-0 mt-2"
                  style={{ background: spool?.color_hex ?? r.color ?? '#888' }}
                />
                <div className="flex-1 min-w-0">
                  <select
                    className="input w-full text-sm py-1"
                    value={r.spool_id === '' ? '' : selectValue(r)}
                    onChange={e => {
                      const v = e.target.value
                      setRow(i, { spool_id: v === '' ? '' : v === NO_SPOOL ? null : Number(v), guess: false })
                    }}
                  >
                    <option value="">{t('prints.pickSpool')}</option>
                    <option value={NO_SPOOL}>{t('prints.noSpoolOption')}</option>
                    {inactive && (
                      <option value={r.spool_id as number}>
                        {spool
                          ? (spool.archived ? `${spoolText(spool)} – ${t('prints.archivedSpool')}` : spoolText(spool))
                          : needArchived && allSpools.length === 0 ? '…' : t('prints.spoolGone')}
                      </option>
                    )}
                    {inAms.length > 0 && (
                      <optgroup label={t('prints.groupAms')}>
                        {inAms.map(s => <option key={s.id} value={s.id}>{spoolText(s)}</option>)}
                      </optgroup>
                    )}
                    <optgroup label={t('prints.groupOthers')}>
                      {others.map(s => <option key={s.id} value={s.id}>{spoolText(s)}</option>)}
                    </optgroup>
                  </select>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.ams_slot ? `${r.ams_slot}` : ''}
                    {!r.ams_slot && r.filament_type ? r.filament_type : ''}
                    {spool && ` · ${fmtNum(spool.current_weight_g / 1000, 3)} kg`}
                    {swapLabel && <span className="ml-1.5 text-warn">({swapLabel})</span>}
                    {r.estimated && <span className="ml-1.5 text-warn">{t('common.est')}</span>}
                  </p>
                  {r.guess && <p className="text-xs text-warn">{t('prints.spoolFromTray')}</p>}
                  {r.spool_id === '' && !r.extra && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-warn">{t('prints.spoolNotMatched')}</p>
                      {printer && (
                        <button
                          className="text-xs text-info flex items-center gap-0.5"
                          onClick={() => refetchTrays()}
                          disabled={traysLoading}
                          title={t('prints.reloadSlot')}
                        >
                          <RefreshCw size={10} className={traysLoading ? 'animate-spin' : ''} />
                          {t('prints.reloadSlot')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    className="input w-20 text-sm py-1 text-right"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={r.grams}
                    onChange={e => setRow(i, { grams: e.target.value })}
                  />
                  <span className="text-xs text-gray-500">g</span>
                  {r.extra && (
                    <button
                      className="text-crit ml-1"
                      onClick={() => setRows(rs => rs.filter((_, k) => k !== i))}
                      title={t('common.delete')}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          <button className="btn-ghost text-xs py-0.5" onClick={addRow}>{t('prints.addSpoolRow')}</button>

          <p className="text-xs text-gray-500 pt-1">{t('prints.gramsHint')}</p>
        </div>

        {/* Labels stay on one line; on narrow screens the buttons wrap into a second row. */}
        <div className="flex flex-wrap justify-end gap-2 px-5 py-4 border-t border-surface-3 [&>button]:whitespace-nowrap">
          <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
          {hasUnresolved && rows.length > 0 && !confirmed && !zeroBooked && (
            <button className="btn-secondary" onClick={onEdit}>
              {t('prints.logManually')}
            </button>
          )}
          {!zeroBooked && (
            <button className="btn-secondary" onClick={handleNoUsage}>
              {t('prints.noUsage')}
            </button>
          )}
          <button className="btn-primary" onClick={handleSave} disabled={!canSave}>
            {t('prints.saveUsage')}
          </button>
        </div>
      </div>
    </div>
  )
}
