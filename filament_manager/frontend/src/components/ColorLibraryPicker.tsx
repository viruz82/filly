// Manufacturer colour library (1.19.0): browse the bundled colours of the
// common filament brands (official manufacturer values or community values
// from SpoolmanDB) and either take one into the spool form ("single") or copy
// several into the filament catalog ("multi").
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, Search, X } from 'lucide-react'
import Modal from './Modal'
import { useToast } from './ui/Feedback'
import { api } from '../api'
import type { LibraryColor, LibraryLine, LibraryPick } from '../types'
import { lookBackground } from '../utils/colorLook'

/** Save-ready values of one library colour. */
export function libraryPick(line: LibraryLine, c: LibraryColor): LibraryPick {
  return {
    brand: line.brand,
    material: line.material,
    subtype: line.subtype,
    subtype2: line.subtype2,
    color_name: c.name,
    hex: c.hex,
    color_mode: c.mode ?? 'solid',
    color_effect: c.mode === 'special' ? c.effect ?? null : null,
    article_number: c.sku ?? null,
  }
}

function swatch(c: LibraryColor) {
  return lookBackground({
    color_hex: c.hex[0], color2_hex: c.hex[1], color3_hex: c.hex[2], color4_hex: c.hex[3],
    color_mode: c.mode ?? 'solid', color_effect: c.effect ?? null,
  })
}

function lineTitle(l: LibraryLine, withBrand: boolean) {
  const name = !l.line ? l.material
    : l.line.toLowerCase().includes(l.material.toLowerCase()) ? l.line : `${l.material} ${l.line}`
  return withBrand ? `${l.brand} · ${name}` : name
}

const keyOf = (l: LibraryLine, c: LibraryColor) => `${l.brand}|${l.material}|${l.line}|${c.name}`

export default function ColorLibraryPicker({
  mode, initialBrand, onPick, onClose,
}: {
  mode: 'single' | 'multi'
  initialBrand?: string
  onPick?: (pick: LibraryPick) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()

  const { data: overview, isError: overviewError } = useQuery({
    queryKey: ['color-library'], queryFn: () => api.getColorLibrary(), staleTime: Infinity,
  })
  const brands = overview?.brands ?? []
  const [brand, setBrand] = useState('')
  const [material, setMaterial] = useState('')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [officialOnly, setOfficialOnly] = useState(false)
  const [selected, setSelected] = useState<Map<string, LibraryPick>>(new Map())

  // start with the brand of the form when the library knows it
  useEffect(() => {
    if (!brands.length || brand) return
    const hit = brands.find(b => b.brand.toLowerCase() === (initialBrand ?? '').trim().toLowerCase())
    if (hit) setBrand(hit.brand)
  }, [brands, initialBrand]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 250)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const active = !!(brand || q)
  const { data, isFetching, isError } = useQuery({
    queryKey: ['color-library', brand, q],
    queryFn: () => api.getColorLibrary({ brand: brand || undefined, q: q || undefined, limit: brand ? 1500 : 400 }),
    enabled: active, staleTime: Infinity,
  })

  const lines = useMemo(() => (data?.lines ?? [])
    .filter(l => !material || l.material === material)
    .map(l => ({ ...l, colors: officialOnly ? l.colors.filter(c => c.src === 'official') : l.colors }))
    .filter(l => l.colors.length), [data, material, officialOnly])

  const materials = useMemo(
    () => [...new Set((data?.lines ?? []).map(l => l.material))].sort((a, b) => a.localeCompare(b)),
    [data])
  useEffect(() => { if (material && !materials.includes(material)) setMaterial('') }, [materials]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = lines.reduce((n, l) => n + l.colors.length, 0)

  const toCatalog = useMutation({
    mutationFn: () => api.colorLibraryToCatalog([...selected.values()]),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['filament-catalog'] })
      qc.invalidateQueries({ queryKey: ['filament-brands'] })
      qc.invalidateQueries({ queryKey: ['filament-materials'] })
      qc.invalidateQueries({ queryKey: ['filament-subtypes'] })
      qc.invalidateQueries({ queryKey: ['materials'] })
      qc.invalidateQueries({ queryKey: ['subtypes'] })
      toast(t('colorLibrary.toCatalogResult', { added: r.added, skipped: r.skipped }))
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const choose = (l: LibraryLine, c: LibraryColor) => {
    if (mode === 'single') { onPick?.(libraryPick(l, c)); onClose(); return }
    setSelected(prev => {
      const next = new Map(prev)
      const k = keyOf(l, c)
      if (next.has(k)) next.delete(k); else next.set(k, libraryPick(l, c))
      return next
    })
  }

  return (
    <Modal>
      <div className="fixed inset-0 bg-black/60 z-[60] flex items-end sm:items-center justify-center sm:p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div role="dialog" aria-modal="true" aria-label={t('colorLibrary.title')}
          className="bg-surface-2 sm:border border-surface-3 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl h-[94dvh] sm:h-[85vh] flex flex-col overflow-hidden">
          {/* header */}
          <div className="flex-none flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-surface-3">
            <div className="min-w-0">
              <h2 className="font-semibold">{t('colorLibrary.title')}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {t(mode === 'single' ? 'colorLibrary.hintSingle' : 'colorLibrary.hintMulti')}
              </p>
            </div>
            <button onClick={onClose} className="btn-ghost p-1 shrink-0" aria-label={t('common.close')}><X size={16} /></button>
          </div>

          {/* filters */}
          <div className="flex-none px-4 sm:px-5 py-3 space-y-2 border-b border-surface-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
              <input className="input pl-8 w-full" value={query} onChange={e => setQuery(e.target.value)}
                placeholder={t('colorLibrary.search')} aria-label={t('colorLibrary.search')} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select className="input" value={brand} onChange={e => { setBrand(e.target.value); setMaterial('') }}
                aria-label={t('settings.filamentCatalog.brand')}>
                <option value="">{t('colorLibrary.allBrands')}</option>
                {brands.map(b => <option key={b.brand} value={b.brand}>{b.brand} ({b.colors})</option>)}
              </select>
              <select className="input" value={material} onChange={e => setMaterial(e.target.value)}
                disabled={!active} aria-label={t('settings.filamentCatalog.material')}>
                <option value="">{t('colorLibrary.allMaterials')}</option>
                {materials.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between gap-2">
              <button type="button" className={`chip border ${officialOnly ? 'chip-on border-accent' : 'border-surface-3'}`} aria-pressed={officialOnly}
                onClick={() => setOfficialOnly(v => !v)}>
                {officialOnly && <Check size={12} />} {t('colorLibrary.officialOnly')}
              </button>
              {active && (
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {isFetching ? t('common.loading') : t('colorLibrary.count', { count: shown })}
                </span>
              )}
            </div>
          </div>

          {/* body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-3">
            {(overviewError || isError) && <p className="text-sm text-crit">{t('colorLibrary.loadFailed')}</p>}

            {!active && !overviewError && (
              <div>
                <p className="text-xs text-gray-500 mb-2">{t('colorLibrary.chooseBrand')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {brands.map(b => (
                    <button key={b.brand} type="button"
                      className="text-left rounded-xl border border-surface-3 bg-surface px-3 py-2 hover:border-accent/60 transition-colors"
                      onClick={() => setBrand(b.brand)}>
                      <div className="text-sm font-medium">{b.brand}</div>
                      <div className="text-xs text-gray-500">
                        {b.official
                          ? t('colorLibrary.brandCounts', { colors: b.colors, official: b.official })
                          : t('colorLibrary.brandCountsCommunity', { colors: b.colors })}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {active && !isFetching && !isError && shown === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-gray-500">{t('colorLibrary.noResults')}</p>
                {brand && q && (
                  <button type="button" className="chip" onClick={() => { setBrand(''); setMaterial('') }}>
                    <Search size={12} /> {t('colorLibrary.searchAllBrands')}
                  </button>
                )}
              </div>
            )}

            {active && lines.map(l => (
              <section key={`${l.brand}|${l.material}|${l.line}`} className="mb-4">
                <h3 className="text-xs font-semibold text-gray-300 mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{lineTitle(l, !brand)}</span>
                  {[l.subtype, l.subtype2].filter(Boolean).map(s => (
                    <span key={s} className="pill pill-info">{s}</span>
                  ))}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {l.colors.map(c => {
                    const k = keyOf(l, c)
                    const on = selected.has(k)
                    return (
                      <button key={k} type="button" onClick={() => choose(l, c)} aria-pressed={mode === 'multi' ? on : undefined}
                        className={`flex items-center gap-2 min-w-0 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                          on ? 'border-accent bg-accent/10' : 'border-surface-3 hover:border-accent/60'}`}>
                        <span className="relative w-7 h-7 rounded-full shrink-0 border border-black/30" style={{ background: swatch(c) }}>
                          {on && (
                            <span className="absolute -right-1 -bottom-1 w-4 h-4 rounded-full bg-accent text-on-accent flex items-center justify-center">
                              <Check size={10} strokeWidth={3} />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs truncate" title={c.name}>{c.name}</span>
                          <span className="flex items-center gap-1 text-[10px] text-gray-500 min-w-0">
                            <span className="truncate font-mono">{c.hex.join(' ')}</span>
                            <span className={`shrink-0 ${c.src === 'official' ? 'text-ok' : ''}`}
                              title={t(c.src === 'official' ? 'colorLibrary.officialTitle' : 'colorLibrary.communityTitle')}>
                              · {t(`colorLibrary.${c.src}`)}
                            </span>
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}

            {active && data?.truncated && (
              <p className="text-xs text-warn">{t('colorLibrary.truncated', { count: data.count })}</p>
            )}

            <p className="text-[11px] text-gray-500 mt-4 leading-snug">{t('colorLibrary.notice')}</p>
          </div>

          {/* footer (multi) */}
          {mode === 'multi' && (
            <div className="flex-none flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-t border-surface-3"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-gray-400 whitespace-nowrap">{t('colorLibrary.selected', { count: selected.size })}</span>
                {selected.size > 0 && (
                  <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => setSelected(new Map())}>
                    {t('common.clear')}
                  </button>
                )}
              </div>
              <button type="button" className="btn-primary text-xs px-3 py-1.5"
                disabled={!selected.size || toCatalog.isPending} onClick={() => toCatalog.mutate()}>
                {t('colorLibrary.toCatalog')}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
