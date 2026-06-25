import { useState, useEffect, useRef } from 'react'
import type { IDrawing } from 'lightweight-charts-drawing'

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
      <div className="w-[350px] rounded-lg border border-[#2a2e39] bg-[#1e222d] p-4 shadow-xl">
        <h3 className="mb-3 text-sm font-medium text-white">{title}</h3>
        <textarea
          ref={textareaRef}
          className="w-full min-h-[80px] rounded border border-[#2a2e39] bg-[#131722] p-2 text-[13px] text-[#d1d4dc] outline-none focus:border-[#2962ff]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter text..."
        />
        <div className="mt-1 text-[10px] text-[#787b86]">Enter to save, Shift+Enter for newline, Escape to cancel</div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded bg-[#363a45] px-3 py-1.5 text-[12px] text-[#d1d4dc] hover:bg-[#4a4e59]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="rounded bg-[#2962ff] px-3 py-1.5 text-[12px] text-white hover:bg-[#1e53e4]"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
