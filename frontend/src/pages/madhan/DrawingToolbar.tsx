import { useState, useRef, useEffect } from 'react'
import { getToolRegistry } from 'lightweight-charts-drawing'
import { Trash2, ChevronRight, X } from 'lucide-react'

interface DrawingToolbarProps {
  activeTool: string | null
  onToolSelect: (toolType: string | null) => void
  drawingColor: string
  onColorChange: (color: string) => void
  lineWidth: number
  onLineWidthChange: (width: number) => void
  onClearAll: () => void
  onClose: () => void
}

function IconTrendLine() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <line x1="4" y1="20" x2="20" y2="4" />
      <circle cx="4" cy="20" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20" cy="4" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconHorizontal() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <line x1="2" y1="12" x2="22" y2="12" />
      <polyline points="18,8 22,12 18,16" />
    </svg>
  )
}

function IconChannel() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <line x1="3" y1="18" x2="21" y2="6" />
      <line x1="3" y1="21" x2="21" y2="9" strokeDasharray="3 2" />
    </svg>
  )
}

function IconPitchfork() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <line x1="4" y1="4" x2="12" y2="20" />
      <line x1="12" y1="20" x2="20" y2="8" />
      <line x1="4" y1="4" x2="12" y2="12" strokeDasharray="3 2" />
      <line x1="20" y1="8" x2="12" y2="12" strokeDasharray="3 2" />
      <circle cx="4" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20" cy="8" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconFib() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <line x1="3" y1="4" x2="21" y2="4" />
      <line x1="3" y1="10" x2="21" y2="10" strokeDasharray="3 2" />
      <line x1="3" y1="13" x2="21" y2="13" strokeDasharray="3 2" />
      <line x1="3" y1="16" x2="21" y2="16" strokeDasharray="3 2" />
      <line x1="3" y1="20" x2="21" y2="20" />
      <circle cx="3" cy="4" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="21" cy="20" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconGann() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <rect x="4" y="4" width="16" height="16" />
      <line x1="4" y1="4" x2="20" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2" />
      <line x1="4" y1="12" x2="20" y2="12" strokeDasharray="2 2" />
    </svg>
  )
}

function IconRectangle() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </svg>
  )
}

function IconArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <line x1="4" y1="20" x2="20" y2="4" />
      <polyline points="10,4 20,4 20,14" />
    </svg>
  )
}

function IconBrush() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <path d="M3 21c0 0 3-3 6-6s4-5 7-8 3-4 5-5" />
      <circle cx="18" cy="5" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconText() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
      <text x="4" y="18" fontSize="16" fontWeight="bold" fill="currentColor" stroke="none" fontFamily="serif">T</text>
    </svg>
  )
}

function IconRuler() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
      <rect x="3" y="8" width="18" height="8" rx="1" />
      <line x1="7" y1="8" x2="7" y2="12" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="15" y1="8" x2="15" y2="12" />
      <line x1="19" y1="8" x2="19" y2="14" />
    </svg>
  )
}

function IconPosition() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.5" className="h-4 w-4">
      <rect x="4" y="10" width="16" height="10" fill="rgba(38,166,154,0.2)" stroke="currentColor" />
      <rect x="4" y="4" width="16" height="6" fill="rgba(239,83,80,0.2)" stroke="currentColor" />
      <line x1="4" y1="10" x2="20" y2="10" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
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
    icon: <IconTrendLine />,
    tools: ['trend-line', 'ray', 'info-line', 'extended-line', 'trend-angle'],
    defaultTool: 'trend-line',
  },
  {
    id: 'horizontal',
    label: 'Horizontal/Vertical',
    icon: <IconHorizontal />,
    tools: ['horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line'],
    defaultTool: 'horizontal-ray',
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: <IconChannel />,
    tools: ['parallel-channel', 'regression-trend', 'flat-top-bottom', 'disjoint-channel'],
    defaultTool: 'parallel-channel',
  },
  {
    id: 'pitchforks',
    label: 'Pitchforks',
    icon: <IconPitchfork />,
    tools: ['andrews-pitchfork', 'schiff-pitchfork', 'modified-schiff-pitchfork', 'inside-pitchfork'],
    defaultTool: 'andrews-pitchfork',
  },
  {
    id: 'fib',
    label: 'Fibonacci',
    icon: <IconFib />,
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
    icon: <IconGann />,
    tools: ['gann-box', 'gann-fan', 'gann-square-fixed', 'gann-square'],
    defaultTool: 'gann-box',
  },
  {
    id: 'shapes',
    label: 'Shapes',
    icon: <IconRectangle />,
    tools: ['rectangle', 'circle', 'triangle', 'ellipse', 'arc', 'path', 'polyline', 'curve', 'double-curve', 'rotated-rectangle'],
    defaultTool: 'rectangle',
  },
  {
    id: 'arrows',
    label: 'Arrows & Markers',
    icon: <IconArrow />,
    tools: ['arrow', 'arrow-marker', 'arrow-mark-up', 'arrow-mark-down'],
    defaultTool: 'arrow',
  },
  {
    id: 'brush',
    label: 'Brush & Highlight',
    icon: <IconBrush />,
    tools: ['brush', 'highlighter'],
    defaultTool: 'brush',
  },
  {
    id: 'annotations',
    label: 'Text & Annotations',
    icon: <IconText />,
    tools: [
      'text-annotation', 'callout', 'anchored-text', 'note', 'price-note',
      'price-label', 'flag-mark', 'pin', 'comment', 'signpost', 'table',
    ],
    defaultTool: 'text-annotation',
  },
  {
    id: 'measurement',
    label: 'Measurement',
    icon: <IconRuler />,
    tools: ['price-range', 'date-range', 'date-price-range'],
    defaultTool: 'price-range',
  },
  {
    id: 'trading',
    label: 'Trading',
    icon: <IconPosition />,
    tools: ['long-position', 'short-position', 'forecast', 'bars-pattern', 'projection'],
    defaultTool: 'long-position',
  },
]

export const TEXT_DRAWING_TYPES = [
  'text-annotation', 'callout', 'anchored-text', 'note', 'price-note',
  'flag-mark', 'pin', 'comment', 'signpost', 'table',
]

export default function DrawingToolbar({
  activeTool,
  onToolSelect,
  drawingColor,
  onColorChange,
  lineWidth,
  onLineWidthChange,
  onClearAll,
  onClose,
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
    <div className="flex h-full w-[44px] shrink-0 flex-col border-r border-[#2a2e39] bg-[#1e222d]">
      <button
        onClick={onClose}
        className="flex h-8 w-8 items-center justify-center rounded text-[#787b86] hover:bg-[#2a2e39] hover:text-[#d1d4dc]"
        title="Hide Drawings"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex flex-col gap-0.5 p-1">
        {TOOL_GROUPS.map((group) => {
          const isActive = activeTool !== null && group.tools.includes(activeTool)
          return (
            <div key={group.id} className="relative" ref={openFlyout === group.id ? flyoutRef : undefined}>
              <div className="flex items-center">
                <button
                  className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
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
                    className="flex w-2.5 items-center justify-center text-[#787b86] hover:text-[#d1d4dc]"
                    onClick={(e) => handleFlyoutToggle(group.id, e)}
                  >
                    <ChevronRight className="h-2 w-2" />
                  </button>
                )}
              </div>

              {openFlyout === group.id && (
                <div className="absolute left-full top-0 z-50 ml-1 min-w-[180px] rounded border border-[#2a2e39] bg-[#1e222d] py-1 shadow-xl">
                  <div className="border-b border-[#2a2e39] px-2 py-1 text-[10px] font-semibold uppercase text-[#787b86]">
                    {group.label}
                  </div>
                  {group.tools.map((toolType) => (
                    <button
                      key={toolType}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors ${
                        activeTool === toolType
                          ? 'bg-[#2962ff] text-white'
                          : 'text-[#d1d4dc] hover:bg-[#2a2e39]'
                      }`}
                      onClick={() => handleFlyoutToolSelect(toolType)}
                    >
                      <span>{getToolName(toolType)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-auto border-t border-[#2a2e39] p-1">
        <div className="flex flex-col items-center gap-1.5 py-1">
          <input
            type="color"
            className="h-6 w-6 cursor-pointer rounded border border-[#363a45] bg-transparent p-0"
            value={drawingColor}
            onChange={(e) => onColorChange(e.target.value)}
            title="Drawing Color"
          />
          <div className="flex gap-0.5">
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
            className="flex h-7 w-7 items-center justify-center rounded text-[#787b86] hover:bg-[#f23645] hover:text-white"
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
