import type { AMSTray, Spool } from '../types'

// Strip '#' prefix and alpha channel suffix, uppercase — e.g. "#ff5733ff" → "FF5733"
function normalizeHex(hex: string): string {
  return hex.replace(/^#/, '').slice(0, 6).toUpperCase()
}

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

/**
 * Find the best spool for a given AMS tray based on material + color match.
 * Tie-breaking: lowest remaining weight first (use partial spools), then oldest
 * purchase date (FiFo).  Returns null if no spool matches or tray has no MQTT data.
 * Pass excludeIds to prevent the same spool being assigned to multiple trays.
 */
export function findBestSpoolMatch(tray: AMSTray, spools: Spool[], excludeIds?: Set<number>): Spool | null {
  if (!tray.ha_material || !tray.ha_color_hex) return null

  const col = normalizeHex(tray.ha_color_hex)

  const candidates = spools.filter(s => {
    if (excludeIds?.has(s.id)) return false
    if (s.archived) return false
    return (
      materialMatches(tray.ha_material as string, s) &&
      normalizeHex(s.color_hex) === col &&
      s.current_weight_g > 0
    )
  })

  if (candidates.length === 0) return null

  return [...candidates].sort((a, b) => {
    const dw = a.current_weight_g - b.current_weight_g
    if (dw !== 0) return dw
    const aDate = a.purchased_at ? new Date(a.purchased_at).getTime() : Infinity
    const bDate = b.purchased_at ? new Date(b.purchased_at).getTime() : Infinity
    return aDate - bDate
  })[0]
}
