import type { AMSTray, Spool } from '../types'
import { COLOR_TOLERANCE, colorDelta } from './color'

/** Basic filament type: "PLA+ 2.0" → "pla", "PETG HF" → "petg"; "PLA-CF" stays "pla-cf". */
export function baseMaterial(material: string): string {
  return material.trim().toLowerCase().split(/[\s+]/)[0]
}

/**
 * Does the material the printer reports for a tray fit the spool?
 * Third-party filament has no RFID chip, so the AMS only knows the basic type the user set
 * ("PLA"), while the inventory often holds the product line ("PLA+ 2.0").
 * Keep in sync with `material_matches` in backend/app/ha_publisher.py.
 */
export function materialMatches(trayMaterial: string, spool: Pick<Spool, 'material' | 'subtype'>): boolean {
  const tray = trayMaterial.trim().toLowerCase()
  const mat = spool.material.trim().toLowerCase()
  const full = spool.subtype ? `${mat} ${spool.subtype}`.toLowerCase() : mat
  return tray === mat || tray === full || tray === baseMaterial(mat)
}

export interface SpoolCandidate {
  spool: Spool
  /** material fits (equal, material + subtype, or basic type) */
  materialOk: boolean
  /** perceptual colour distance to the colour the printer reports (0 = identical) */
  delta: number
}

/**
 * Spools that could be the one in an AMS tray, best first.
 * A spool is a candidate when its colour is within COLOR_TOLERANCE of the tray colour; the material
 * does not have to fit ("colour fits, other material" is shown as a suggestion, like a spool whose
 * product line is named differently). Order: material fits first, then identical colour, then the
 * lowest remaining weight (use partial spools), then the oldest purchase date (FiFo).
 * Pass excludeIds to keep the same spool from being offered for several trays.
 */
export function rankSpoolCandidates(tray: AMSTray, spools: Spool[], excludeIds?: Set<number>): SpoolCandidate[] {
  if (!tray.ha_material || !tray.ha_color_hex) return []
  const trayMaterial = tray.ha_material

  const candidates: SpoolCandidate[] = []
  for (const s of spools) {
    if (excludeIds?.has(s.id)) continue
    if (s.archived || s.current_weight_g <= 0) continue
    const delta = colorDelta(tray.ha_color_hex, s.color_hex)
    if (delta === null || delta > COLOR_TOLERANCE) continue
    candidates.push({ spool: s, materialOk: materialMatches(trayMaterial, s), delta })
  }

  return candidates.sort((a, b) => {
    if (a.materialOk !== b.materialOk) return a.materialOk ? -1 : 1
    const ea = a.delta <= 1 ? 0 : 1
    const eb = b.delta <= 1 ? 0 : 1
    if (ea !== eb) return ea - eb
    const dw = a.spool.current_weight_g - b.spool.current_weight_g
    if (dw !== 0) return dw
    const aDate = a.spool.purchased_at ? new Date(a.spool.purchased_at).getTime() : Infinity
    const bDate = b.spool.purchased_at ? new Date(b.spool.purchased_at).getTime() : Infinity
    return aDate - bDate
  })
}

/**
 * Find the best spool for a given AMS tray based on material + colour (within tolerance).
 * Returns null if no spool matches or the tray has no MQTT data.
 * Pass excludeIds to prevent the same spool being assigned to multiple trays.
 */
export function findBestSpoolMatch(tray: AMSTray, spools: Spool[], excludeIds?: Set<number>): Spool | null {
  return rankSpoolCandidates(tray, spools, excludeIds).find(c => c.materialOk)?.spool ?? null
}
