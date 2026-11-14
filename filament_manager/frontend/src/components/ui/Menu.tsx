// Small pop-over menu ("⋯"): closes on outside click / Escape / scroll, never triggers the
// click handler of the element it sits in (tiles, rows).
// The menu is positioned from the trigger's screen position (position: fixed), so it is not
// clipped by scroll containers or the bars above the list. It opens in the preferred direction
// and flips to the other side when there is not enough room.
import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

interface Pos {
  goUp: boolean
  top: number
  bottom: number
  left: number
  right: number
  maxH: number
}

const ITEM_H = 36      // text-sm + py-2
const PAD = 12         // p-1 + breathing room
const MARGIN = 8
const PHONE_NAV_H = 64 // bottom navigation on small screens

export default function Menu({ trigger, items, label, up = false, align = 'right', triggerClassName = '' }: {
  trigger: React.ReactNode
  items: MenuItem[]
  label: string
  /** preferred direction: open upwards (for triggers at the bottom of a card) */
  up?: boolean
  align?: 'left' | 'right'
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    const onScroll = (e: Event) => {
      // scrolling inside the menu itself must not close it
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const toggle = () => {
    if (open) { setOpen(false); return }
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const need = items.length * ITEM_H + PAD
    const reserve = window.innerWidth < 1024 ? PHONE_NAV_H : MARGIN
    const below = window.innerHeight - r.bottom - reserve
    const above = r.top - MARGIN
    let goUp = up
    if (goUp && above < need && below > above) goUp = false
    else if (!goUp && below < need && above > below) goUp = true
    setPos({
      goUp,
      top: r.bottom + 4,
      bottom: window.innerHeight - r.top + 4,
      left: Math.max(MARGIN, r.left),
      right: Math.max(MARGIN, window.innerWidth - r.right),
      maxH: Math.max(ITEM_H * 2, (goUp ? above : below) - 4),
    })
    setOpen(true)
  }

  return (
    <div className="relative" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={toggle}
        className={`rounded-full transition-colors hover:bg-surface-3 ${open ? 'bg-surface-3' : ''} ${triggerClassName}`}
      >
        {trigger}
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            ...(pos.goUp ? { bottom: pos.bottom } : { top: pos.top }),
            ...(align === 'right' ? { right: pos.right } : { left: pos.left }),
            maxHeight: pos.maxH,
          }}
          className="z-50 min-w-[170px] overflow-y-auto bg-surface-3 rounded-xl p-1 shadow-xl flex flex-col"
        >
          {items.map(it => (
            <button
              key={it.key}
              role="menuitem"
              type="button"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick() }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors
                disabled:opacity-40 hover:bg-surface-4 ${it.danger ? 'text-crit' : 'text-gray-100'}`}
            >
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
