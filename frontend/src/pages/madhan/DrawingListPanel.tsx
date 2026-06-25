import { getToolRegistry, type IDrawing, type DrawingManager } from 'lightweight-charts-drawing'
import { X } from 'lucide-react'

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
    <div className="flex h-full w-[180px] flex-col border-l bg-[#1e222d]">
      <div className="flex items-center justify-between border-b border-[#2a2e39] px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase text-[#787b86]">Drawings</span>
        <span className="rounded bg-[#363a45] px-1.5 py-0.5 text-[9px] text-[#787b86]">
          {drawings.length}
        </span>
      </div>
      <div className="flex-1 overflow-auto p-1">
        {drawings.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-[#4a4e59]">No drawings yet</div>
        ) : (
          drawings.map((drawing) => (
            <div
              key={drawing.id}
              className={`mb-0.5 flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-[11px] transition-colors ${
                selectedDrawingId === drawing.id
                  ? 'bg-[#2962ff] text-white'
                  : 'text-[#d1d4dc] hover:bg-[#2a2e39]'
              }`}
              onClick={() => onSelect(drawing.id)}
            >
              <span className="truncate">{getName(drawing)}</span>
              <button
                className={`ml-1 shrink-0 rounded px-1 text-[12px] ${
                  selectedDrawingId === drawing.id
                    ? 'text-white/70 hover:bg-white/20 hover:text-white'
                    : 'text-[#787b86] hover:bg-[#f23645] hover:text-white'
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(drawing.id)
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
