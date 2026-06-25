import { getToolRegistry, type IDrawing, type DrawingManager } from 'lightweight-charts-drawing'
import { X, Layers, ChevronRight } from 'lucide-react'

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
  if (!drawingManager) return null

  const drawings = drawingManager.getAllDrawings()
  const getName = (d: IDrawing) => registry.get(d.type)?.name ?? d.type

  return (
    <div className="flex h-full w-[200px] shrink-0 flex-col border-l bg-[#1e222d]">
      <div className="flex items-center justify-between border-b border-[#2a2e39] px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3 w-3 text-[#787b86]" />
          <span className="text-[11px] font-medium text-[#d1d4dc]">Object Tree</span>
        </div>
        <span className="rounded bg-[#363a45] px-1.5 py-0.5 text-[9px] text-[#787b86]">
          {drawings.length}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-1">
        {drawings.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Layers className="mb-2 h-6 w-6 text-[#363a45]" />
            <span className="text-[11px] text-[#4a4e59]">No drawings</span>
          </div>
        ) : (
          drawings.map((drawing) => {
            const isSelected = selectedDrawingId === drawing.id
            return (
              <div
                key={drawing.id}
                className={`group mb-px flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors ${
                  isSelected
                    ? 'bg-[#2962ff]/20 text-[#d1d4dc]'
                    : 'text-[#787b86] hover:bg-[#2a2e39] hover:text-[#d1d4dc]'
                }`}
                onClick={() => onSelect(drawing.id)}
              >
                <ChevronRight className="h-2.5 w-2.5 shrink-0 text-[#4a4e59]" />
                <span className="truncate flex-1">{getName(drawing)}</span>
                <button
                  className="shrink-0 rounded p-0.5 text-[#4a4e59] opacity-0 transition-opacity hover:text-[#d1d4dc] group-hover:opacity-100"
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
