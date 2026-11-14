// Shows a colour as hex and as R / G / B, each value copies to the clipboard on click
// (Bambu Studio asks for R, G and B; the hex value is for everything else).
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { hexLabel, hexToRgb, rgbCopyText, rgbLabel } from '../../utils/color'
import { useToast } from './Feedback'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // clipboard API is blocked in some embedded views (iframe without permission) → old way
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function CopyChip({ text, display }: { text: string; display: string }) {
  const { t } = useTranslation()
  const toast = useToast()
  return (
    <button
      type="button"
      title={t('common.copy')}
      aria-label={`${t('common.copy')}: ${text}`}
      onClick={async e => {
        e.stopPropagation()
        if (await copyText(text)) toast(t('common.copied', { value: text }))
        else toast.error(t('common.copyFailed'))
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs bg-surface-3 hover:bg-surface-4 text-gray-100 whitespace-nowrap"
    >
      {display}
      <Copy size={10} className="text-gray-400" />
    </button>
  )
}

export default function ColorValue({ hex, showHex = true, className = '' }: {
  hex: string | null | undefined
  /** hide the hex chip when the hex value is already visible right next to it (form) */
  showHex?: boolean
  className?: string
}) {
  const rgb = hexToRgb(hex)
  if (!hex || !rgb) return null
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="h-4 w-4 rounded border border-white/20 shrink-0" style={{ background: hexLabel(hex) }} aria-hidden />
      {showHex && <CopyChip text={hexLabel(hex)} display={hexLabel(hex)} />}
      <CopyChip text={rgbCopyText(rgb)} display={rgbLabel(rgb)} />
    </div>
  )
}
