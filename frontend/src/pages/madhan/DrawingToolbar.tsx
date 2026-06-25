import { useState, useRef, useEffect } from 'react'
import { getToolRegistry } from 'lightweight-charts-drawing'
import { Input } from '@/components/ui/input'
import {
  Minus,
  Trash2,
  ChevronRight,
  Square,
  Type,
  TrendingUp,
  GitBranch,
  Target,
  ArrowUpRight,
  Ruler,
  Pen,
} from 'lucide-react'

interface DrawingToolbarProps {
  activeTool: string | null
  onToolSelect: (toolType: string | null) => void
  drawingColor: string
  onColorChange: (color: string) => void
  lineWidth: number
  onLineWidthChange: (width: number) => void
  onClearAll: () => void
}

interface ToolGroup {
  id: string
  label: string
  icon: React.ReactNode
  tools: string[]
  defaultTool: string
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'lines',
    label: 'Trend Lines',
    icon: <TrendingUp className="h-4 w-4" />,
    tools: ['trend-line', 'ray', 'info-line', 'extended-line', 'trend-angle'],
    defaultTool: 'trend-line',
  },
  {
    id: 'horizontal',
    label: 'Horizontal/Vertical',
    icon: <Minus className="h-4 w-4" />,
    tools: ['horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line'],
    defaultTool: 'horizontal-ray',
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: <GitBranch className="h-4 w-4" />,
    tools: ['parallel-channel', 'regression-trend', 'flat-top-bottom', 'disjoint-channel'],
    defaultTool: 'parallel-channel',
  },
  {
    id: 'pitchforks',
    label: 'Pitchforks',
    icon: <GitBranch className="h-4 w-4 rotate-180" />,
    tools: ['andrews-pitchfork', 'schiff-pitchfork', 'modified-schiff-pitchfork', 'inside-pitchfork'],
    defaultTool: 'andrews-pitchfork',
  },
  {
    id: 'fib',
    label: 'Fibonacci',
    icon: <span className="text-xs font-bold">F</span>,
    tools: [
      'fib-retracement', 'fib-extension', 'fib-channel', 'fib-time-zone',
      'fib-speed-fan', 'fib-time-extension', 'fib-circles', 'fib-spiral',
      'fib-arcs', 'fib-wedge', 'pitchfan',
    ],
    defaultTool: 'fib-retracement',
  },
  {
    id: 'gann',
    label: 'Gann',
    icon: <span className="text-xs font-bold">G</span>,
    tools: ['gann-box', 'gann-fan', 'gann-square-fixed', 'gann-square'],
    defaultTool: 'gann-box',
  },
  {
    id: 'shapes',
    label: 'Shapes',
    icon: <Square className="h-4 w-4" />,
    tools: ['rectangle', 'circle', 'triangle', 'ellipse', 'arc', 'path', 'polyline', 'curve', 'double-curve', 'rotated-rectangle'],
    defaultTool: 'rectangle',
  },
  {
    id: 'arrows',
    label: 'Arrows & Markers',
    icon: <ArrowUpRight className="h-4 w-4" />,
    tools: ['arrow', 'arrow-marker', 'arrow-mark-up', 'arrow-mark-down'],
    defaultTool: 'arrow',
  },
  {
    id: 'brush',
    label: 'Brush & Highlight',
    icon: <Pen className="h-4 w-4" />,
    tools: ['brush', 'highlighter'],
    defaultTool: 'brush',
  },
  {
    id: 'annotations',
    label: 'Text & Annotations',
    icon: <Type className="h-4 w-4" />,
    tools: [
      'text-annotation', 'callout', 'anchored-text', 'note', 'price-note',
      'price-label', 'flag-mark', 'pin', 'comment', 'signpost', 'table',
    ],
    defaultTool: 'text-annotation',
  },
  {
    id: 'measurement',
    label: 'Measurement',
    icon: <Ruler className="h-4 w-4" />,
    tools: ['price-range', 'date-range', 'date-price-range'],
    defaultTool: 'price-range',
  },
  {
    id: 'trading',
    label: 'Trading',
    icon: <Target className="h-4 w-4" />,
    tools: ['long-position', 'short-position', 'forecast', 'bars-pattern', 'projection'],
    defaultTool: 'long-position',
  },
]

const TEXT_DRAWING_TYPES = [
  'text-annotation', 'callout', 'anchored-text', 'note', 'price-note',
  'flag-mark', 'pin', 'comment', 'signpost', 'table',
]

export { TEXT_DRAWING_TYPES }

export default function DrawingToolbar({
  activeTool,
  onToolSelect,
  drawingColor,
  onColorChange,
  lineWidth,
  onLineWidthChange,
  onClearAll,
}: DrawingToolbarProps) {
  const registry = getToolRegistry()
  const [openFlyout, setOpenFlyout] = useState<string | null>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as HTMLElement)) {
        setOpenFlyout(null)
      }
    }
    if (openFlyout) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openFlyout])

  const handleGroupClick = (group: ToolGroup) => {
    if (activeTool && group.tools.includes(activeTool)) {
      onToolSelect(null)
    } else {
      onToolSelect(group.defaultTool)
    }
    setOpenFlyout(null)
  }

  const handleFlyoutToggle = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenFlyout(openFlyout === groupId ? null : groupId)
  }

  const handleFlyoutToolSelect = (toolType: string) => {
    onToolSelect(toolType)
    setOpenFlyout(null)
  }

  const getToolName = (type: string) => registry.get(type)?.name ?? type

  return (
    <div className="flex h-full flex-col border-r bg-[#1e222d]">
      <div className="flex flex-col gap-0.5 p-1">
        {TOOL_GROUPS.map((group) => {
          const isActive = activeTool !== null && group.tools.includes(activeTool)
          return (
            <div key={group.id} className="relative" ref={openFlyout === group.id ? flyoutRef : undefined}>
              <div className="flex">
                <button
                  className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                    isActive
                      ? 'bg-[#2962ff] text-white'
                      : 'text-[#787b86] hover:bg-[#2a2e39] hover:text-[#d1d4dc]'
                  }`}
                  title={group.label}
                  onClick={() => handleGroupClick(group)}
                >
                  {group.icon}
                </button>
                {group.tools.length > 1 && (
                  <button
                    className="flex w-3 items-center justify-center text-[#787b86] hover:text-[#d1d4dc]"
                    onClick={(e) => handleFlyoutToggle(group.id, e)}
                  >
                    <ChevronRight className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>

              {openFlyout === group.id && (
                <div className="absolute left-full top-0 z-50 ml-1 min-w-[160px] rounded border border-[#2a2e39] bg-[#1e222d] py-1 shadow-xl">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase text-[#787b86]">
                    {group.label}
                  </div>
                  {group.tools.map((toolType) => (
                    <button
                      key={toolType}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-[12px] transition-colors ${
                        activeTool === toolType
                          ? 'bg-[#2962ff] text-white'
                          : 'text-[#d1d4dc] hover:bg-[#2a2e39]'
                      }`}
                      onClick={() => handleFlyoutToolSelect(toolType)}
                    >
                      {getToolName(toolType)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-auto border-t border-[#2a2e39] p-1">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1 px-1">
            <Input
              type="color"
              className="h-6 w-6 cursor-pointer border-0 p-0"
              value={drawingColor}
              onChange={(e) => onColorChange(e.target.value)}
              title="Drawing Color"
            />
          </div>
          <div className="flex gap-0.5 px-1">
            {[1, 2, 3].map((w) => (
              <button
                key={w}
                className={`flex h-5 w-5 items-center justify-center rounded text-[9px] ${
                  lineWidth === w ? 'bg-[#2962ff] text-white' : 'text-[#787b86] hover:bg-[#2a2e39]'
                }`}
                onClick={() => onLineWidthChange(w)}
                title={`${w}px`}
              >
                {w}
              </button>
            ))}
          </div>
          <button
            className="flex h-7 items-center justify-center rounded text-[#787b86] hover:bg-[#f23645] hover:text-white"
            title="Clear All Drawings"
            onClick={onClearAll}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
