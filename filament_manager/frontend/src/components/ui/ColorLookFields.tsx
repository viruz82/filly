// Colour look editor (1.18.0): mode switch (solid / gradient / multi-colour /
// special), 1–4 colour rows depending on the mode, effect choice for "special"
// and a live preview. Used by the spool form; values are '#rrggbb' or ''.
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import ColorValue from './ColorValue'
import {
  COLOR_EFFECTS, COLOR_MODES, HEX_RE, MODE_COLOR_RANGE, lookBackground,
  type ColorEffect, type ColorMode,
} from '../../utils/colorLook'

export interface ColorLookValue {
  color_hex: string
  color2_hex: string
  color3_hex: string
  color4_hex: string
  color_mode: ColorMode
  color_effect: ColorEffect | ''
}

const KEYS = ['color_hex', 'color2_hex', 'color3_hex', 'color4_hex'] as const

/** Number of filled colours, counted from the first gap-free run. */
export function filledColors(v: ColorLookValue): number {
  let n = 0
  for (const k of KEYS) { if (v[k]) n++; else break }
  return n
}

/** Payload-ready values: unused colours cleared, effect only with "special". */
export function cleanColorLook(v: ColorLookValue) {
  const [, max] = MODE_COLOR_RANGE[v.color_mode]
  const keep = (i: number) => i < max && !!v[KEYS[i]] && HEX_RE.test(v[KEYS[i]])
  return {
    color_mode: v.color_mode,
    color_effect: v.color_mode === 'special' && v.color_effect ? v.color_effect : null,
    color2_hex: keep(1) ? v.color2_hex : null,
    color3_hex: keep(2) ? v.color3_hex : null,
    color4_hex: keep(3) ? v.color4_hex : null,
  }
}

/** Validation message key or null. */
export function colorLookError(v: ColorLookValue): string | null {
  const [min] = MODE_COLOR_RANGE[v.color_mode]
  const valid = KEYS.filter(k => v[k] && HEX_RE.test(v[k])).length
  return min > 1 && valid < min ? 'colorLook.needTwo' : null
}

export default function ColorLookFields({
  value, onChange, colorLabel,
}: {
  value: ColorLookValue
  onChange: (patch: Partial<ColorLookValue>) => void
  colorLabel?: string
}) {
  const { t } = useTranslation()
  const mode = value.color_mode
  const [min, max] = MODE_COLOR_RANGE[mode]
  const shown = Math.min(max, Math.max(min, filledColors(value)))

  const setMode = (m: ColorMode) => {
    const patch: Partial<ColorLookValue> = { color_mode: m }
    const [mMin] = MODE_COLOR_RANGE[m]
    // a mode that needs two colours starts with a sensible second one
    if (mMin > 1 && !value.color2_hex) patch.color2_hex = '#ffffff'
    onChange(patch)
  }

  const removeAt = (i: number) => {
    // shift the following colours up so there is never a gap
    const vals = KEYS.map(k => value[k])
    vals.splice(i, 1)
    vals.push('')
    onChange(Object.fromEntries(KEYS.map((k, j) => [k, vals[j]])) as Partial<ColorLookValue>)
  }

  const err = colorLookError(value)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="label">{t('colorLook.mode')}</label>
        <div className="grid grid-cols-4 rounded-lg bg-surface-2 p-0.5 gap-0.5" role="radiogroup" aria-label={t('colorLook.mode')}>
          {COLOR_MODES.map(m => (
            <button
              key={m} type="button" role="radio" aria-checked={mode === m}
              className={`seg-item justify-center rounded-md px-1 ${mode === m ? 'seg-item-on' : ''}`}
              onClick={() => setMode(m)}
            >
              {t(`colorLook.modes.${m}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">{t(`colorLook.modeHint.${mode}`)}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {KEYS.slice(0, shown).map((key, i) => {
          const v = value[key]
          const ok = HEX_RE.test(v)
          return (
            <div key={key}>
              <label className="label">
                {i === 0 && colorLabel ? colorLabel : t('colorLook.color', { n: i + 1 })}{i === 0 ? ' *' : ''}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-9 w-16 rounded cursor-pointer bg-surface-3 border border-surface-3"
                  value={ok ? v : '#888888'}
                  onChange={e => onChange({ [key]: e.target.value } as Partial<ColorLookValue>)}
                  aria-label={t('colorLook.color', { n: i + 1 })}
                />
                <div className="flex items-center flex-1 min-w-0">
                  <span className="px-2 py-1.5 text-sm text-gray-400 bg-surface-3 border border-r-0 border-surface-3 rounded-l-lg select-none">#</span>
                  <input
                    className={`input flex-1 min-w-0 rounded-l-none ${v && !ok ? 'border-crit focus:border-crit' : ''}`}
                    value={v.replace(/^#/, '')}
                    onChange={e => onChange({ [key]: e.target.value ? '#' + e.target.value.replace(/^#/, '') : '' } as Partial<ColorLookValue>)}
                    placeholder="ffffff"
                    maxLength={6}
                  />
                </div>
                {i >= min && (
                  <button type="button" className="text-gray-500 hover:text-crit p-1" aria-label={t('common.clear')} onClick={() => removeAt(i)}>
                    <X size={14} />
                  </button>
                )}
              </div>
              {v && !ok && <p className="text-xs text-crit mt-1">{t('spools.form.colorHexInvalid')}</p>}
              {ok && <ColorValue hex={v} showHex={false} className="mt-1.5" />}
            </div>
          )
        })}
      </div>

      {shown < max && (
        <button
          type="button" className="chip self-start"
          onClick={() => onChange({ [KEYS[shown]]: '#ffffff' } as Partial<ColorLookValue>)}
        >
          <Plus size={12} /> {t('colorLook.addColor')}
        </button>
      )}

      {mode === 'special' && (
        <div className="sm:w-1/2 sm:pr-1.5">
          <label className="label">{t('colorLook.effect')}</label>
          <select
            className="input"
            value={value.color_effect}
            onChange={e => onChange({ color_effect: e.target.value as ColorEffect | '' })}
          >
            <option value="">{t('colorLook.effectNone')}</option>
            {COLOR_EFFECTS.map(e => <option key={e} value={e}>{t(`colorLook.effects.${e}`)}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="label">{t('colorLook.preview')}</label>
        <div className="flex items-center gap-3">
          <span
            className="w-10 h-10 rounded-full shrink-0 border border-black/30"
            style={{ background: lookBackground(cleanPreview(value)) }}
          />
          <span
            className="flex-1 h-6 rounded-md border border-black/30"
            style={{ background: lookBackground(cleanPreview(value), undefined, true) }}
          />
          {mode === 'special' && value.color_effect && (
            <span className="pill shrink-0">✦ {t('colorLook.specialBadge')}</span>
          )}
        </div>
        {err && <p className="text-xs text-crit mt-1">{t(err)}</p>}
      </div>
    </div>
  )
}

function cleanPreview(v: ColorLookValue) {
  return { ...v, ...cleanColorLook(v) }
}
