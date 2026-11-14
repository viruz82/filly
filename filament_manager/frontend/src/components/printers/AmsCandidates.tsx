// Candidate spools for an AMS slot with an "Assign" button each (dashboard card and Printers page).
import { useTranslation } from 'react-i18next'
import { fmtNum } from '../../utils/number'
import type { SpoolCandidate } from '../../utils/amsMatch'

export function CandidateList({ candidates, onAssign, pending, moves = false }: {
  candidates: SpoolCandidate[]
  onAssign: (spoolId: number) => void
  pending: boolean
  /** show that the spool is taken out of the slot it sits in now */
  moves?: boolean
}) {
  const { t } = useTranslation()
  return (
    <>
      {candidates.map(c => (
        <div key={c.spool.id} className="flex items-center gap-2 mt-2 pl-6">
          <span
            className="w-3 h-3 rounded-full shrink-0 border border-white/20"
            style={{ background: c.spool.color_hex }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-white truncate">
              {c.spool.custom_id ? `#${c.spool.custom_id} ` : ''}{c.spool.brand} {c.spool.material}{c.spool.subtype ? ` ${c.spool.subtype}` : ''} — {c.spool.color_name}
            </p>
            <p className="text-[11px] text-gray-400">
              {fmtNum(c.spool.current_weight_g, 0)} g · {c.materialOk ? t('dashboard.amsReasonBoth') : t('dashboard.amsReasonColor')}
              {moves && c.spool.ams_slot ? ` · ${t('dashboard.amsMoves')}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="btn bg-surface-3 hover:bg-surface-4 text-xs shrink-0"
            disabled={pending}
            onClick={() => onAssign(c.spool.id)}
          >
            {t('dashboard.amsAssign')}
          </button>
        </div>
      ))}
    </>
  )
}
