import { getToolRegistry, type IDrawing, type DrawingManager } from 'lightweight-charts-drawing'
import { X, ChevronRight, Layers } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { chartTheme } from './chartTheme'

interface DrawingListPanelProps {
  drawingManager: DrawingManager | null
  selectedDrawingId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

export default function DrawingListPanel({
  drawingManager,
  selectedDrawingId,
  onSelect,
  onDelete,
}: DrawingListPanelProps) {
  const registry = getToolRegistry()
  const { mode } = useThemeStore()
  const t = chartTheme[mode]
  if (!drawingManager) return null

  const drawings = drawingManager.getAllDrawings()
  const getName = (d: IDrawing) => registry.get(d.type)?.name ?? d.type

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden" style={{ backgroundColor: t.panel }}>
      <div className="flex items-center justify-between px-2 py-1.5" style={{ borderBottom: `1px solid ${t.border}` }}>
        <div className="flex items-center gap-1.5">
          <Layers className="h-3 w-3" style={{ color: t.textSecondary }} />
          <span className="text-[11px] font-medium" style={{ color: t.text }}>Object Tree</span>
          <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ backgroundColor: t.badge, color: t.textSecondary }}>
            {drawings.length}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-1">
        {drawings.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Layers className="mb-2 h-6 w-6" style={{ color: t.badge }} />
            <span className="text-[11px]" style={{ color: t.textMuted }}>No drawings</span>
          </div>
        ) : (
          drawings.map((drawing) => {
            const isSelected = selectedDrawingId === drawing.id
            return (
              <div
                key={drawing.id}
                className="group mb-px flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors"
                style={{
                  backgroundColor: isSelected ? t.activeBg : undefined,
                  color: isSelected ? t.text : t.textSecondary,
                }}
                onClick={() => onSelect(drawing.id)}
              >
                <ChevronRight className="h-2.5 w-2.5 shrink-0" style={{ color: t.textMuted }} />
                <span className="truncate flex-1">{getName(drawing)}</span>
                <button
                  className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: t.textMuted }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(drawing.id)
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
