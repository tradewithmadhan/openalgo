import { useState, useEffect, useCallback } from 'react'
import { getToolRegistry, type IDrawing, type DrawingManager } from 'lightweight-charts-drawing'
import { X, ChevronRight, Layers, Eye, EyeOff, Lock, Unlock, Search, Copy, Trash2 } from 'lucide-react'
import { useMadhanTheme } from './useMadhanTheme'
import { chartTheme } from './chartTheme'
import { TOOL_ICONS } from './DrawingToolIcons'

interface DrawingListPanelProps {
  drawingManager: DrawingManager | null
  selectedDrawingId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate?: (id: string) => void
  onClearAll?: () => void
}

export default function DrawingListPanel({
  drawingManager,
  selectedDrawingId,
  onSelect,
  onDelete,
  onDuplicate,
  onClearAll,
}: DrawingListPanelProps) {
  const registry = getToolRegistry()
  const { mode } = useMadhanTheme()
  const t = chartTheme[mode]
  const [, setTick] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  const forceUpdate = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    if (!drawingManager) return
    const unsubs = [
      drawingManager.on('drawing:added', forceUpdate),
      drawingManager.on('drawing:removed', forceUpdate),
      drawingManager.on('drawing:updated', forceUpdate),
      drawingManager.on('drawing:selected', forceUpdate),
      drawingManager.on('drawing:deselected', forceUpdate),
      drawingManager.on('drawing:cleared', forceUpdate),
    ]
    return () => unsubs.forEach((u) => u())
  }, [drawingManager, forceUpdate])

  if (!drawingManager) return null

  const allDrawings = drawingManager.getAllDrawings()
  const getName = (d: IDrawing) => registry.get(d.type)?.name ?? d.type
  const getCategory = (d: IDrawing) => registry.get(d.type)?.category ?? 'line'

  const drawings = searchQuery
    ? allDrawings.filter((d) => getName(d).toLowerCase().includes(searchQuery.toLowerCase()))
    : allDrawings

  const grouped = new Map<string, IDrawing[]>()
  for (const d of drawings) {
    const cat = getCategory(d)
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(d)
  }

  const CATEGORY_LABELS: Record<string, string> = {
    line: 'Lines',
    channel: 'Channels',
    fibonacci: 'Fibonacci',
    gann: 'Gann',
    pitchfork: 'Pitchforks',
    shape: 'Shapes',
    annotation: 'Annotations',
    trading: 'Trading',
    forecasting: 'Forecasting',
    measurement: 'Measurement',
  }

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const handleToggleVisibility = (e: React.MouseEvent, drawing: IDrawing) => {
    e.stopPropagation()
    try {
      drawing.updateOptions({ visible: !drawing.options.visible })
      drawing.requestUpdate()
    } catch {}
    forceUpdate()
  }

  const handleToggleLock = (e: React.MouseEvent, drawing: IDrawing) => {
    e.stopPropagation()
    try {
      drawing.updateOptions({ locked: !drawing.options.locked })
      drawing.requestUpdate()
    } catch {}
    forceUpdate()
  }

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
        {allDrawings.length > 0 && (
          <div className="relative">
            <Search className="absolute left-1 top-1/2 h-3 w-3 -translate-y-1/2" style={{ color: t.textMuted }} />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-[80px] rounded py-0.5 pl-5 pr-1 text-[10px] outline-none"
              style={{ backgroundColor: t.badge, color: t.text, border: `1px solid ${t.border}` }}
            />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto p-1">
        {drawings.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Layers className="mb-2 h-6 w-6" style={{ color: t.badge }} />
            <span className="text-[11px]" style={{ color: t.textMuted }}>
              {searchQuery ? 'No match' : 'No drawings'}
            </span>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([category, catDrawings]) => {
            const isCollapsed = collapsedCategories.has(category)
            return (
              <div key={category} className="mb-1">
                <button
                  className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  style={{ color: t.textSecondary }}
                  onClick={() => toggleCategory(category)}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
                >
                  <ChevronRight
                    className="h-2.5 w-2.5 shrink-0 transition-transform"
                    style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
                  />
                  <span>{CATEGORY_LABELS[category] ?? category}</span>
                  <span className="ml-auto rounded px-1 py-0.5 text-[8px]" style={{ backgroundColor: t.badge, color: t.textMuted }}>
                    {catDrawings.length}
                  </span>
                </button>
                {!isCollapsed &&
                  catDrawings.map((drawing) => {
                    const isSelected = selectedDrawingId === drawing.id
                    const isVisible = drawing.options.visible !== false
                    const isLocked = drawing.options.locked === true
                    const ToolIcon = TOOL_ICONS[drawing.type]
                    return (
                      <div
                        key={drawing.id}
                        className="group mb-px flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors"
                        style={{
                          backgroundColor: isSelected ? t.activeBg : undefined,
                          color: isSelected ? t.text : t.textSecondary,
                          opacity: isVisible ? 1 : 0.4,
                        }}
                        onClick={() => onSelect(drawing.id)}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: drawing.style.lineColor || t.textSecondary }}
                        />
                        {ToolIcon && (
                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" style={{ color: t.textMuted }}>
                            <ToolIcon />
                          </span>
                        )}
                        <span className="truncate flex-1" style={{ opacity: isLocked ? 0.5 : 1 }}>
                          {getName(drawing)}
                        </span>
                        <button
                          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ color: isVisible ? t.textMuted : t.danger }}
                          title={isVisible ? 'Hide' : 'Show'}
                          onClick={(e) => handleToggleVisibility(e, drawing)}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
                        >
                          {isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        </button>
                        <button
                          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ color: isLocked ? '#f59e0b' : t.textMuted }}
                          title={isLocked ? 'Unlock' : 'Lock'}
                          onClick={(e) => handleToggleLock(e, drawing)}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
                        >
                          {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        </button>
                        <button
                          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ color: t.textMuted }}
                          title="Duplicate"
                          onClick={(e) => {
                            e.stopPropagation()
                            try { onDuplicate?.(drawing.id) } catch {}
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <button
                          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ color: t.textMuted }}
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation()
                            try { onDelete(drawing.id) } catch {}
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })}
              </div>
            )
          })
        )}
      </div>
      {allDrawings.length > 0 && onClearAll && (
        <div className="flex items-center justify-center border-t px-2 py-1.5" style={{ borderColor: t.border }}>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors"
            style={{ color: t.textMuted }}
            onClick={() => { try { onClearAll?.() } catch {} }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.danger; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = t.textMuted }}
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear All</span>
          </button>
        </div>
      )}
    </div>
  )
}
