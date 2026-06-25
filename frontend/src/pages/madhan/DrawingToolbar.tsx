import { useState } from 'react'
import { getToolRegistry, type DrawingCategory, type IDrawing, type DrawingManager } from 'lightweight-charts-drawing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Trash2, X } from 'lucide-react'

interface DrawingToolbarProps {
  drawingManager: DrawingManager | null
  activeTool: string | null
  onToolSelect: (toolType: string | null) => void
  drawingColor: string
  onColorChange: (color: string) => void
  lineWidth: number
  onLineWidthChange: (width: number) => void
  onClearAll: () => void
  selectedDrawingId: string | null
  selectedDrawing: IDrawing | null
  onDeleteSelected: () => void
  onDeselect: () => void
}

const CATEGORY_LABELS: Record<DrawingCategory, string> = {
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

const CATEGORY_ORDER: DrawingCategory[] = [
  'line',
  'channel',
  'fibonacci',
  'gann',
  'pitchfork',
  'shape',
  'annotation',
  'trading',
  'measurement',
]

export default function DrawingToolbar({
  drawingManager,
  activeTool,
  onToolSelect,
  drawingColor,
  onColorChange,
  lineWidth,
  onLineWidthChange,
  onClearAll,
  selectedDrawingId,
  selectedDrawing,
  onDeleteSelected,
  onDeselect,
}: DrawingToolbarProps) {
  const registry = getToolRegistry()
  const categories = registry.getCategories().filter((c) => CATEGORY_ORDER.includes(c))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  return (
    <div className="space-y-3">
      <Label className="text-xs font-semibold">Drawing Tools</Label>

      <div className="space-y-1">
        <Label className="text-[11px]">Color</Label>
        <Input
          type="color"
          className="h-7 w-full p-1"
          value={drawingColor}
          onChange={(e) => onColorChange(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px]">Line Width</Label>
        <div className="flex gap-1">
          {[1, 2, 3].map((w) => (
            <Button
              key={w}
              variant={lineWidth === w ? 'default' : 'outline'}
              size="sm"
              className="h-7 w-8 px-0 text-[11px]"
              onClick={() => onLineWidthChange(w)}
            >
              {w}px
            </Button>
          ))}
        </div>
      </div>

      {selectedDrawingId && selectedDrawing && (
        <div className="space-y-2 rounded border border-yellow-500/30 bg-yellow-500/5 p-2">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-medium text-yellow-600 dark:text-yellow-400">
              Selected: {selectedDrawing.type}
            </Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={onDeselect}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex gap-1">
            <Label className="text-[10px] text-muted-foreground">
              {selectedDrawing.anchors.length} anchor{selectedDrawing.anchors.length !== 1 ? 's' : ''}
            </Label>
          </div>
          <div className="flex gap-1">
            <Label className="text-[11px]">Color</Label>
            <Input
              type="color"
              className="h-6 w-12 p-0.5"
              value={selectedDrawing.style.lineColor}
              onChange={(e) => {
                selectedDrawing.updateStyle({ lineColor: e.target.value })
                drawingManager?.deselectAll()
              }}
            />
            <Label className="text-[11px]">Width</Label>
            <div className="flex gap-0.5">
              {[1, 2, 3].map((w) => (
                <Button
                  key={w}
                  variant={selectedDrawing.style.lineWidth === w ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 w-6 px-0 text-[10px]"
                  onClick={() => {
                    selectedDrawing.updateStyle({ lineWidth: w })
                    drawingManager?.deselectAll()
                  }}
                >
                  {w}
                </Button>
              ))}
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 w-full text-[11px]"
            onClick={onDeleteSelected}
          >
            <Trash2 className="mr-1 h-3 w-3" /> Delete Drawing
          </Button>
        </div>
      )}

      <div className="space-y-1 overflow-auto" style={{ maxHeight: 'calc(100vh - 420px)' }}>
        {CATEGORY_ORDER.filter((cat) => categories.includes(cat)).map((cat) => {
          const tools = registry.getByCategory(cat)
          if (tools.length === 0) return null
          const isCollapsed = collapsed[cat]
          return (
            <div key={cat} className="rounded border">
              <button
                className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-medium hover:bg-muted/50"
                onClick={() => toggleCategory(cat)}
              >
                {CATEGORY_LABELS[cat] || cat}
                <span className="text-[9px] text-muted-foreground">{isCollapsed ? '\u25BC' : '\u25B2'}</span>
              </button>
              {!isCollapsed && (
                <div className="flex flex-wrap gap-1 border-t px-1.5 py-1.5">
                  {tools.map((tool) => (
                    <Button
                      key={tool.type}
                      variant={activeTool === tool.type ? 'default' : 'outline'}
                      size="sm"
                      className="h-6 px-1.5 text-[10px]"
                      title={`${tool.name} (${tool.requiredAnchors} anchor${tool.requiredAnchors !== 1 ? 's' : ''})`}
                      onClick={() => onToolSelect(activeTool === tool.type ? null : tool.type)}
                    >
                      {tool.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="h-7 w-full text-[11px]"
        onClick={onClearAll}
      >
        Clear All Drawings
      </Button>
    </div>
  )
}
