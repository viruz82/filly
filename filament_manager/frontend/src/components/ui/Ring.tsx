// Colour disc with a "remaining" ring around it (spool colour look: solid,
// gradient, multi-colour split or special effect, see utils/colorLook).
import { lookBackground, type ColorLook } from '../../utils/colorLook'

export type RingSpool = ColorLook

/** Ring colour by remaining percent: accent, warn below 40 %, crit below 15 %. */
export function ringColor(pct: number): string {
  return pct > 40 ? 'rgb(var(--fm-accent))' : pct > 15 ? 'rgb(var(--fm-warn))' : 'rgb(var(--fm-crit))'
}

export function discBackground(spool: RingSpool): string {
  return lookBackground(spool)
}

export default function Ring({ spool, pct, size = 48, title }: { spool: RingSpool; pct: number; size?: number; title?: string }) {
  const inner = size - 10
  return (
    <div
      className="rounded-full shrink-0 grid place-items-center"
      style={{ width: size, height: size, background: `conic-gradient(${ringColor(pct)} ${pct * 3.6}deg, rgba(128,128,128,0.25) 0)` }}
      title={title ?? `${pct}%`}
    >
      <span className="rounded-full border border-black/30" style={{ width: inner, height: inner, background: discBackground(spool) }} />
    </div>
  )
}
