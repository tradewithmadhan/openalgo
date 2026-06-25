import { useState, useEffect, useRef } from 'react'
import type { IDrawing } from 'lightweight-charts-drawing'
import { useThemeStore } from '@/stores/themeStore'
import { chartTheme } from './chartTheme'

interface TextEditorModalProps {
  drawing: IDrawing | null
  onSave: (text: string) => void
  onClose: () => void
}

function getDrawingText(drawing: IDrawing): string {
  const d = drawing as any
  if (typeof d.getText === 'function') return d.getText()
  if (typeof d.getNote === 'function') return d.getNote()
  if (typeof d.getLabel === 'function') return d.getLabel()
  if (typeof d.getRows === 'function') return d.getRows().map((r: string[]) => r.join('\t')).join('\n')
  return ''
}

function setDrawingText(drawing: IDrawing, text: string) {
  const d = drawing as any
  if (typeof d.setText === 'function') { d.setText(text); return }
  if (typeof d.setNote === 'function') { d.setNote(text); return }
  if (typeof d.setLabel === 'function') { d.setLabel(text); return }
  if (typeof d.setRows === 'function') { d.setRows(text.split('\n').map((r: string) => r.split('\t'))); return }
}

const TYPE_TITLES: Record<string, string> = {
  'text-annotation': 'Edit Text',
  'callout': 'Edit Callout',
  'anchored-text': 'Edit Anchored Text',
  'note': 'Edit Note',
  'price-note': 'Edit Price Note',
  'flag-mark': 'Edit Flag Label',
  'pin': 'Edit Pin Label',
  'comment': 'Edit Comment',
  'signpost': 'Edit Signpost',
  'table': 'Edit Table (tab-separated)',
}

export default function TextEditorModal({ drawing, onSave, onClose }: TextEditorModalProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { mode } = useThemeStore()
  const t = chartTheme[mode]

  useEffect(() => {
    if (drawing) {
      setText(getDrawingText(drawing))
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      }, 50)
    }
  }, [drawing])

  if (!drawing) return null

  const title = TYPE_TITLES[drawing.type] ?? 'Edit Text'

  const handleSave = () => {
    setDrawingText(drawing, text)
    onSave(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-[350px] rounded-lg p-4 shadow-xl" style={{ border: `1px solid ${t.border}`, backgroundColor: t.panel }}>
        <h3 className="mb-3 text-sm font-medium" style={{ color: t.text }}>{title}</h3>
        <textarea
          ref={textareaRef}
          className="w-full min-h-[80px] rounded p-2 text-[13px] outline-none"
          style={{ border: `1px solid ${t.border}`, backgroundColor: t.panelDarker, color: t.text }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter text..."
        />
        <div className="mt-1 text-[10px]" style={{ color: t.textSecondary }}>Enter to save, Shift+Enter for newline, Escape to cancel</div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-[12px]"
            style={{ backgroundColor: t.badge, color: t.text }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded px-3 py-1.5 text-[12px] text-white"
            style={{ backgroundColor: t.active }}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
