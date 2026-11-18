import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { PACKAGING_TYPES } from '../../types'
import type { Spool, BrandSpoolWeight, FilamentCatalog, Packaging } from '../../types'
import { Palette, X } from 'lucide-react'
import Section from '../ui/Section'
import ColorLookFields, { colorLookError } from '../ui/ColorLookFields'
import { effectiveMode, type ColorEffect, type ColorMode } from '../../utils/colorLook'
import { useCurrencySymbol } from '../../hooks/useHATZ'
import { parseDecimal, fmtNum } from '../../utils/number'
import { AmsSlotSelect } from '../../hooks/useAmsSlots'
import ColorLibraryPicker from '../ColorLibraryPicker'
import { useToast } from '../ui/Feedback'
import type { LibraryPick } from '../../types'

// ── Spool Form ────────────────────────────────────────────────────────────────

export const EMPTY_FORM = {
  custom_id: '',
  brand: '', material: 'PLA', subtype: '', subtype2: '', color_name: '', color_hex: '#888888',
  color2_hex: '', color3_hex: '', color4_hex: '',
  color_mode: 'solid' as ColorMode, color_effect: '' as ColorEffect | '',
  diameter_mm: '', initial_weight_g: 1000, current_weight_g: 1000,
  spool_weight_g: '',   // own empty-spool tare; '' = take it from the brand config
  purchase_price: '', purchased_at: '', purchase_location: '', storage_location: '',
  article_number: '', last_dried_at: '', packaging: '' as Packaging | '', ams_slot: '', notes: '',
  is_refill_pack: false,
}

export function SpoolForm({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial?: Partial<Spool>
  isNew?: boolean
  onSave: (data: typeof EMPTY_FORM, quantity: number) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const currencySymbol = useCurrencySymbol()
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    ...initial,
    // New and duplicated spools get their number from the backend (empty = automatic).
    custom_id: (isNew ? '' : initial?.custom_id ?? '') as string | number,
    subtype: initial?.subtype ?? '',
    subtype2: initial?.subtype2 ?? '',
    purchase_price: initial?.purchase_price?.toString() ?? '',
    purchased_at: initial?.purchased_at ? initial.purchased_at.slice(0, 10) : '',
    purchase_location: initial?.purchase_location ?? '',
    storage_location: initial?.storage_location ?? '',
    article_number: initial?.article_number ?? '',
    last_dried_at: initial?.last_dried_at ? initial.last_dried_at.slice(0, 10) : '',
    // new (and duplicated = newly bought) spools come vacuum-packed
    packaging: (isNew ? 'vacuum' : initial?.packaging ?? '') as Packaging | '',
    initial_weight_g: initial?.initial_weight_g ?? 1000,
    current_weight_g: initial?.current_weight_g ?? 1000,
    spool_weight_g: initial?.spool_weight_g ? String(initial.spool_weight_g) : '',
    color2_hex: initial?.color2_hex ?? '',
    color3_hex: initial?.color3_hex ?? '',
    color4_hex: initial?.color4_hex ?? '',
    color_mode: initial ? effectiveMode(initial) : 'solid' as ColorMode,
    color_effect: (initial?.color_effect ?? '') as ColorEffect | '',
  })

  const toast = useToast()
  const [editNumber, setEditNumber] = useState(false)   // number field unlocked by "change"
  const { data: numbers } = useQuery({ queryKey: ['spools', 'next-number'], queryFn: api.getNextSpoolNumber })
  const freeNumbers = numbers?.free ?? []
  const [showLibrary, setShowLibrary] = useState(false)
  const [measuredTotal, setMeasuredTotal] = useState('')
  const [quantity, setQuantity] = useState(1)
  const weightInputRef = useRef<HTMLInputElement>(null)

  const { data: materials = [] } = useQuery({ queryKey: ['materials'], queryFn: api.getMaterials })
  const { data: subtypes = [] } = useQuery({ queryKey: ['subtypes'], queryFn: api.getSubtypes })
  const { data: brandWeights = [] } = useQuery<BrandSpoolWeight[]>({ queryKey: ['brand-weights'], queryFn: api.getBrandWeights })
  const { data: brands = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['filament-brands'], queryFn: api.getFilamentBrands })
  const { data: locations = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['purchase-locations'], queryFn: api.getPurchaseLocations })
  const { data: storageLocations = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['storage-locations'], queryFn: api.getStorageLocations })
  const { data: filamentCatalog = [] } = useQuery<FilamentCatalog[]>({ queryKey: ['filament-catalog'], queryFn: api.getFilamentCatalog })
  const { data: activeSpools = [] } = useQuery<Spool[]>({ queryKey: ['spools', false], queryFn: () => api.getSpools(false) })

  const matchedBrand = brandWeights.find(b => b.brand.toLowerCase() === form.brand.toLowerCase())
  const brandTareG = matchedBrand?.spool_weight_g ?? 0
  const ownTareG = parseDecimal(form.spool_weight_g as string)
  const tareG = ownTareG ?? brandTareG
  // Tare variants of the same brand, e.g. "SUNLU (V1)" / "SUNLU (V2)"
  const tareVariants = form.brand.trim()
    ? brandWeights.filter(b => b.brand.toLowerCase().startsWith(form.brand.trim().toLowerCase()))
    : []

  const recalcFromScale = (total: string, tare: number) => {
    const totalG = parseFloat(total)
    if (!isNaN(totalG)) {
      setForm(f => ({ ...f, current_weight_g: Math.max(0, Math.round((totalG - tare) * 10) / 10) }))
    }
  }

  const onBrandChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // A new brand brings its own tare: drop the per-spool value
    setForm(f => ({ ...f, brand: e.target.value, spool_weight_g: '' }))
  }

  // 1.19.0: take brand, material, subtypes and the whole colour look from the library
  const applyLibrary = (p: LibraryPick) => {
    setForm(f => ({
      ...f,
      brand: p.brand,
      spool_weight_g: p.brand.toLowerCase() === f.brand.toLowerCase() ? f.spool_weight_g : '',
      material: p.material,
      subtype: p.subtype ?? '',
      subtype2: p.subtype2 ?? '',
      color_name: p.color_name,
      color_hex: p.hex[0],
      color2_hex: p.hex[1] ?? '',
      color3_hex: p.hex[2] ?? '',
      color4_hex: p.hex[3] ?? '',
      color_mode: p.color_mode,
      color_effect: (p.color_effect ?? '') as ColorEffect | '',
    }))
    toast(t('colorLibrary.applied', { name: `${p.brand} ${p.material} ${p.color_name}` }))
  }

  const setOwnTare = (val: string) => {
    setForm(f => ({ ...f, spool_weight_g: val }))
    if (measuredTotal) recalcFromScale(measuredTotal, parseDecimal(val) ?? brandTareG)
  }

  const onMeasuredChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setMeasuredTotal(val)
    recalcFromScale(val, tareG)
  }

  const set = (k: keyof typeof EMPTY_FORM) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm(f => ({ ...f, [k]: e.target.value }))

  const hexOk = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v)
  const priceBad = form.purchase_price.trim() !== '' && parseDecimal(form.purchase_price) === null
  const missing: string[] = []
  if (!form.brand) missing.push(t('spools.form.brand'))
  if (!form.material) missing.push(t('spools.form.material'))
  if (!form.color_name) missing.push(t('spools.form.colorName'))
  if (!hexOk(form.color_hex)) missing.push(t('spools.form.colorSwatch'))
  if (colorLookError(form)) missing.push(t('colorLook.color', { n: 2 }))
  if (priceBad) missing.push(t('spools.form.purchasePrice'))
  const canSave = missing.length === 0

  // optional groups: open when they already hold values, otherwise folded away
  const purchaseFilled = [form.purchase_price, form.purchased_at, form.purchase_location].filter(v => String(v ?? '').trim() !== '').length
    + (form.is_refill_pack ? 1 : 0)
  const storageFilled = [form.storage_location, form.ams_slot, form.last_dried_at, form.packaging, form.notes]
    .filter(v => String(v ?? '').trim() !== '').length
  const filledHint = (n: number) => (n > 0 ? t('spools.form.filledCount', { count: n }) : undefined)
  const [initialPurchaseFilled] = useState(purchaseFilled)
  const [initialStorageFilled] = useState(storageFilled)

  const fieldClass = 'grid grid-cols-1 sm:grid-cols-2 gap-3'

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-surface-2 sm:border border-surface-3 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl h-[94dvh] sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex-none flex items-center justify-between px-5 py-4 border-b border-surface-3">
          <h2 className="font-semibold">{initial?.id ? t('spools.editSpool') : t('spools.addSpool')}</h2>
          <button onClick={onCancel} className="btn-ghost p-1" aria-label={t('common.close')}><X size={16} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-3">
          {/* 1 — basics */}
          <Section title={t('spools.form.groupBasics')}>
            <div>
              <label className="label">{t('spools.form.articleNumber')}</label>
              <select
                className="input"
                autoFocus={isNew}
                value={form.article_number ?? ''}
                onChange={e => {
                  const val = e.target.value
                  const entry = filamentCatalog.find(c => c.article_number === val)
                  if (entry) {
                    setForm(f => ({
                      ...f,
                      article_number: val,
                      brand: entry.brand,
                      material: entry.material,
                      subtype: entry.subtype ?? '',
                      subtype2: entry.subtype2 ?? '',
                      color_name: entry.color_name,
                      color_hex: entry.color_hex,
                      color2_hex: entry.color2_hex ?? '',
                      color3_hex: entry.color3_hex ?? '',
                      color4_hex: entry.color4_hex ?? '',
                      color_mode: effectiveMode(entry),
                      color_effect: (entry.color_effect ?? '') as ColorEffect | '',
                    }))
                    setTimeout(() => weightInputRef.current?.focus(), 0)
                  } else {
                    setForm(f => ({ ...f, article_number: val }))
                  }
                }}
              >
                <option value="">{t('common.select')}</option>
                {filamentCatalog.filter(c => c.article_number).map(c => (
                  <option key={c.id} value={c.article_number!}>
                    {c.article_number} — {c.brand} {c.material} {c.color_name}
                  </option>
                ))}
              </select>
            </div>

            <div className={fieldClass}>
              <div>
                <label className="label">{t('spools.form.brand')} *</label>
                <input className="input" value={form.brand} onChange={onBrandChange}
                  placeholder={t('spools.form.brandPlaceholder')}
                  list="brand-list" />
                <datalist id="brand-list">
                  {brands.map(b => <option key={b.id} value={b.name} />)}
                </datalist>
              </div>
              <div>
                <label className="label">{t('spools.form.material')} *</label>
                <select className="input" value={form.material} onChange={set('material')}>
                  {form.material && !materials.includes(form.material) && <option>{form.material}</option>}
                  {materials.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('spools.form.subtype')}</label>
                <select className="input" value={form.subtype ?? ''} onChange={set('subtype')}>
                  <option value="">{t('common.none')}</option>
                  {form.subtype && !subtypes.includes(form.subtype) && <option>{form.subtype}</option>}
                  {subtypes.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('spools.form.subtype2')}</label>
                <select className="input" value={form.subtype2 ?? ''} onChange={set('subtype2')}>
                  <option value="">{t('common.none')}</option>
                  {form.subtype2 && !subtypes.includes(form.subtype2) && <option>{form.subtype2}</option>}
                  {subtypes.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('spools.form.diameter')}</label>
                <select className="input" value={form.diameter_mm} onChange={set('diameter_mm')}>
                  <option value={1.75}>1.75 mm</option>
                  <option value={2.85}>2.85 mm</option>
                </select>
              </div>
              <div>
                <label className="label">{t('spools.form.customId')}</label>
                {!editNumber ? (
                  <div className="input flex items-center justify-between gap-2">
                    <span>
                      {isNew
                        ? <>{numbers?.next != null ? `#${numbers.next}` : '—'} <span className="text-gray-500 text-xs">({t('spools.form.customIdAuto')})</span></>
                        : (form.custom_id !== '' ? `#${form.custom_id}` : '—')}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-accent hover:underline"
                      onClick={() => {
                        setEditNumber(true)
                        if (isNew && numbers?.next != null) setForm(f => ({ ...f, custom_id: String(numbers.next) }))
                      }}
                    >
                      {t('spools.form.customIdChange')}
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="9999"
                      step="1"
                      placeholder="—"
                      autoFocus
                      value={form.custom_id ?? ''}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                        setForm(f => ({ ...f, custom_id: v }))
                      }}
                    />
                    {isNew && (
                      <button
                        type="button"
                        className="text-xs text-accent hover:underline mt-1"
                        onClick={() => { setEditNumber(false); setForm(f => ({ ...f, custom_id: '' })) }}
                      >
                        {t('spools.form.customIdAutoReset')}
                      </button>
                    )}
                    {freeNumbers.length > 0 && (
                      <p className="text-[11px] text-gray-500 mt-1">
                        {t('spools.form.customIdFree', { list: '' })}
                        {freeNumbers.slice(0, 12).map(n => (
                          <button
                            key={n}
                            type="button"
                            className="text-accent hover:underline mr-1.5"
                            onClick={() => setForm(f => ({ ...f, custom_id: String(n) }))}
                          >
                            #{n}
                          </button>
                        ))}
                        {freeNumbers.length > 12 && '…'}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </Section>

          {/* 2 — colour */}
          <Section title={t('spools.form.groupColor')}>
            <button type="button" className="chip self-start" onClick={() => setShowLibrary(true)}>
              <Palette size={12} /> {t('colorLibrary.open')}
            </button>
            <div className={fieldClass}>
              <div>
                <label className="label">{t('spools.form.colorName')} *</label>
                <input className="input" value={form.color_name} onChange={set('color_name')}
                  placeholder={t('spools.form.colorPlaceholder')} />
              </div>
            </div>

            <ColorLookFields
              value={form}
              onChange={patch => setForm(f => ({ ...f, ...patch }))}
              colorLabel={t('spools.form.colorSwatch')}
            />
          </Section>

          {/* 3 — weight */}
          <Section title={t('spools.form.weight')}>
            <div className={fieldClass}>
              <div>
                <label className="label">{t('spools.form.nominalWeight')} *</label>
                <div className="flex items-center gap-2">
                  <input
                    ref={weightInputRef}
                    className="input" type="number" step="50" min="0"
                    value={form.initial_weight_g}
                    onChange={e => setForm(f => ({
                      ...f,
                      initial_weight_g: parseFloat(e.target.value) || 0,
                      current_weight_g: initial?.id ? f.current_weight_g : parseFloat(e.target.value) || 0,
                    }))}
                    placeholder="1000"
                  />
                  <span className="text-xs text-gray-500 shrink-0">g</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{t('spools.form.nominalWeightHint')}</p>
              </div>

              <div>
                <label className="label">{t('spools.form.emptySpoolTare')}</label>
                <div className="flex items-center gap-2">
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    value={form.spool_weight_g as string}
                    onChange={e => setOwnTare(e.target.value)}
                    placeholder={brandTareG > 0 ? String(brandTareG) : '—'}
                  />
                  <span className="text-xs text-gray-500 shrink-0">g</span>
                </div>
                {ownTareG != null ? (
                  <p className="text-xs text-gray-400 mt-0.5">{t('spools.form.tareOwn')}</p>
                ) : matchedBrand ? (
                  <p className="text-xs text-ok mt-0.5">{t('spools.form.brandConfig', { brand: form.brand })}</p>
                ) : form.brand ? (
                  <p className="text-xs text-gray-500 mt-0.5">{t('spools.form.noBrandConfig')}</p>
                ) : null}
                {tareVariants.length > 1 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {tareVariants.map(v => (
                      <button
                        key={v.id}
                        type="button"
                        className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${
                          tareG === v.spool_weight_g ? 'border-accent text-white' : 'border-surface-3 text-gray-400 hover:text-white'
                        }`}
                        onClick={() => setOwnTare(String(v.spool_weight_g))}
                      >
                        {v.brand} · {fmtNum(v.spool_weight_g, 0)} g
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Scale-based remaining calculator */}
            <div className="border-t border-surface-3 pt-3">
              <p className="text-xs text-gray-400 mb-2">{t('spools.form.scaleHint')}</p>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="label">{t('spools.form.scaleReading')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      className="input" type="number" step="1" min="0"
                      value={measuredTotal}
                      onChange={onMeasuredChange}
                      placeholder="750"
                    />
                    <span className="text-xs text-gray-500 shrink-0">g</span>
                  </div>
                </div>
                <div className="text-gray-500 text-xs mt-4">→</div>
                <div className="flex-1">
                  <label className="label">{t('spools.form.remainingFilament')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      className="input" type="number" step="1" min="0"
                      value={form.current_weight_g}
                      onChange={e => {
                        setMeasuredTotal('')
                        setForm(f => ({ ...f, current_weight_g: parseFloat(e.target.value) || 0 }))
                      }}
                    />
                    <span className="text-xs text-gray-500 shrink-0">g</span>
                  </div>
                </div>
              </div>
              {form.initial_weight_g > 0 && (
                <p className="text-xs text-gray-500 mt-1.5">
                  {t('spools.form.percentRemaining', { pct: fmtNum(((form.current_weight_g / form.initial_weight_g) * 100), 1) })}
                </p>
              )}
            </div>
          </Section>

          {/* 4 — purchase (folded unless it holds values) */}
          <Section title={t('spools.form.groupPurchase')} hint={filledHint(purchaseFilled)} collapsible defaultOpen={initialPurchaseFilled > 0}>
            <div className={fieldClass}>
              <div>
                <label className="label">{t('spools.form.purchasePrice')}</label>
                {/* type="text" + inputMode="decimal": a native number input rejects the
                    comma decimal separator German/etc. keyboards produce (issue #18) */}
                <div className="flex items-center gap-2">
                  <input
                    className={`input ${priceBad ? 'border-crit focus:border-crit' : ''}`}
                    type="text" inputMode="decimal"
                    value={form.purchase_price}
                    onChange={set('purchase_price')}
                    placeholder={t('spools.form.purchasePricePlaceholder')}
                  />
                  <span className="text-xs text-gray-500 shrink-0">{currencySymbol}</span>
                </div>
              </div>
              <div>
                <label className="label">{t('spools.form.purchaseDate')}</label>
                <input className="input" type="date" value={form.purchased_at} onChange={set('purchased_at')} />
              </div>
              <div>
                <label className="label">{t('spools.form.purchaseLocation')}</label>
                <select className="input" value={form.purchase_location} onChange={set('purchase_location')}>
                  <option value="">{t('common.select')}</option>
                  {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer sm:self-end sm:pb-2">
                <input
                  type="checkbox" className="accent-accent"
                  checked={form.is_refill_pack}
                  onChange={e => setForm(f => ({ ...f, is_refill_pack: e.target.checked }))}
                />
                {t('spools.form.refillPack')}
              </label>
            </div>
          </Section>

          {/* 5 — storage & notes (folded unless it holds values) */}
          <Section title={t('spools.form.groupStorage')} hint={filledHint(storageFilled)} collapsible defaultOpen={initialStorageFilled > 0}>
            <div className={fieldClass}>
              <div>
                <label className="label">{t('spools.form.storageLocation')}</label>
                <select className="input" value={form.storage_location} onChange={set('storage_location')}>
                  <option value="">{t('common.select')}</option>
                  {storageLocations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('spools.form.amsSlot')}</label>
                <AmsSlotSelect
                  spoolId={isNew ? undefined : initial?.id}
                  value={form.ams_slot || null}
                  onChange={slot => setForm(f => ({ ...f, ams_slot: slot ?? '' }))}
                  spools={activeSpools}
                />
              </div>
              <div>
                <label className="label">{t('spools.form.lastDried')}</label>
                <input className="input" type="date" value={form.last_dried_at ?? ''} onChange={set('last_dried_at')} />
                {isNew && (
                  <label className="flex items-center gap-2 mt-1.5 text-xs text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={form.last_dried_at === new Date().toISOString().slice(0, 10)}
                      onChange={e => setForm(f => ({ ...f, last_dried_at: e.target.checked ? new Date().toISOString().slice(0, 10) : '' }))}
                    />
                    {t('spools.form.justDried')}
                  </label>
                )}
              </div>
              <div>
                <label className="label">{t('spools.form.packaging')}</label>
                <select className="input" value={form.packaging ?? ''} onChange={e => setForm(f => ({ ...f, packaging: e.target.value as Packaging | '' }))}>
                  <option value="">{t('common.select')}</option>
                  {PACKAGING_TYPES.map(k => <option key={k} value={k}>{t(`moisture.storage.${k}`)}</option>)}
                </select>
                <p className="text-xs text-gray-500 mt-0.5">{t('spools.form.packagingHint')}</p>
              </div>
              <div className="sm:col-span-2">
                <label className="label">{t('spools.form.notes')}</label>
                <textarea className="input h-16 resize-none" value={form.notes ?? ''} onChange={set('notes')} />
              </div>
            </div>
          </Section>
        </div>

        <div className="flex-none border-t border-surface-3 px-4 sm:px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
          {!canSave && (
            <p className="text-xs text-warn">{t('spools.form.missing', { fields: missing.join(', ') })}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            {isNew && (
              <div className="flex items-center gap-2 shrink-0">
                <label className="text-xs text-gray-400">{t('spools.form.qty')}</label>
                <input
                  className="input w-16 text-sm py-1 text-center"
                  type="number" min="1" max="50"
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>
            )}
            <div className="flex gap-2 ml-auto">
              <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
              <button
                className="btn-primary"
                onClick={() => onSave(form as typeof EMPTY_FORM, quantity)}
                disabled={!canSave}
              >
                {isNew && quantity > 1 ? t('spools.form.addN', { n: quantity }) : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showLibrary && (
        <ColorLibraryPicker
          mode="single"
          initialBrand={form.brand}
          onPick={applyLibrary}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  )
}
