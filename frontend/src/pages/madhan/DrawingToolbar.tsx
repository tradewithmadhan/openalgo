import { useState, useRef, useEffect } from 'react'
import { getToolRegistry } from 'lightweight-charts-drawing'
import { useMadhanTheme } from './useMadhanTheme'
import { chartTheme } from './chartTheme'
import { TOOL_ICONS, TOOL_SVG } from './DrawingToolIcons'

interface DrawingToolbarProps {
  activeTool: string | null
  onToolSelect: (toolType: string | null) => void
  collapsed: boolean
  onToggleCollapse: () => void
  onHideAll?: () => void
  onLockAll?: () => void
  onClearAll?: () => void
  hasDrawings?: boolean
  allHidden?: boolean
  allLocked?: boolean
}

const SvgIcon: React.FC<{ svg: string }> = ({ svg }) => (
  <span
    className="h-6 w-6 inline-flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
    dangerouslySetInnerHTML={{ __html: svg }}
  />
)

const IconCrosshair: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <line x1="12" y1="1" x2="12" y2="23" />
    <line x1="1" y1="12" x2="23" y2="12" />
  </svg>
)

interface ToolGroup {
  id: string
  label: string
  icon: React.ReactNode
  tools: string[]
  defaultTool: string
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'crosshair',
    label: 'Cross',
    icon: <IconCrosshair />,
    tools: ['crosshair'],
    defaultTool: 'crosshair',
  },
  {
    id: 'lines',
    label: 'Trend Lines',
    icon: <SvgIcon svg={TOOL_SVG['trend-line']} />,
    tools: ['trend-line', 'ray', 'info-line', 'extended-line', 'trend-angle'],
    defaultTool: 'trend-line',
  },
  {
    id: 'horizontal',
    label: 'Horizontal Lines',
    icon: <SvgIcon svg={TOOL_SVG['horizontal-line']} />,
    tools: ['horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line'],
    defaultTool: 'horizontal-ray',
  },
  {
    id: 'channels',
    label: 'Parallel Channel',
    icon: <SvgIcon svg={TOOL_SVG['parallel-channel']} />,
    tools: ['parallel-channel', 'regression-trend', 'flat-top-bottom', 'disjoint-channel'],
    defaultTool: 'parallel-channel',
  },
  {
    id: 'pitchforks',
    label: 'Pitchfork',
    icon: <SvgIcon svg={TOOL_SVG['andrews-pitchfork']} />,
    tools: ['andrews-pitchfork', 'schiff-pitchfork', 'modified-schiff-pitchfork', 'inside-pitchfork'],
    defaultTool: 'andrews-pitchfork',
  },
  {
    id: 'fib',
    label: 'Fib Retracement',
    icon: <SvgIcon svg={TOOL_SVG['fib-retracement']} />,
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
    icon: <SvgIcon svg={TOOL_SVG['gann-box']} />,
    tools: ['gann-box', 'gann-fan', 'gann-square-fixed', 'gann-square'],
    defaultTool: 'gann-box',
  },
  {
    id: 'shapes',
    label: 'Geometric Shapes',
    icon: <SvgIcon svg={TOOL_SVG['rectangle']} />,
    tools: ['rectangle', 'circle', 'triangle', 'ellipse', 'arc', 'path', 'polyline', 'curve', 'double-curve', 'rotated-rectangle'],
    defaultTool: 'rectangle',
  },
  {
    id: 'arrows',
    label: 'Arrow',
    icon: <SvgIcon svg={TOOL_SVG['arrow']} />,
    tools: ['arrow', 'arrow-marker', 'arrow-mark-up', 'arrow-mark-down'],
    defaultTool: 'arrow',
  },
  {
    id: 'brush',
    label: 'Brush',
    icon: <SvgIcon svg={TOOL_SVG['brush']} />,
    tools: ['brush', 'highlighter'],
    defaultTool: 'brush',
  },
  {
    id: 'annotations',
    label: 'Text',
    icon: <SvgIcon svg={TOOL_SVG['text-annotation']} />,
    tools: [
      'text-annotation', 'callout', 'anchored-text', 'note', 'price-note',
      'price-label', 'flag-mark', 'pin', 'comment', 'signpost', 'table',
    ],
    defaultTool: 'text-annotation',
  },
  {
    id: 'measurement',
    label: 'Measure',
    icon: <SvgIcon svg={TOOL_SVG['price-range']} />,
    tools: ['price-range', 'date-range', 'date-price-range'],
    defaultTool: 'price-range',
  },
  {
    id: 'trading',
    label: 'Prediction',
    icon: <SvgIcon svg={TOOL_SVG['long-position']} />,
    tools: ['long-position', 'short-position', 'forecast', 'bars-pattern', 'projection'],
    defaultTool: 'long-position',
  },
]

export const TEXT_DRAWING_TYPES = [
  'text-annotation', 'callout', 'anchored-text', 'note', 'price-note',
  'price-label', 'flag-mark', 'pin', 'comment', 'signpost', 'table',
]

export default function DrawingToolbar({
  activeTool,
  onToolSelect,
  collapsed,
  onToggleCollapse,
  onHideAll,
  onLockAll,
  onClearAll,
  hasDrawings = false,
  allHidden = false,
  allLocked = false,
}: DrawingToolbarProps) {
  const registry = getToolRegistry()
  const { mode } = useMadhanTheme()
  const t = chartTheme[mode]
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

  if (collapsed) {
    return (
      <div className="relative flex h-full w-[5px] shrink-0 items-center" style={{ borderRight: `1px solid ${t.border}`, backgroundColor: t.panel }}>
        <button
          onClick={onToggleCollapse}
          className="absolute left-0 top-1/2 z-10 flex h-12 w-5 -translate-y-1/2 items-center justify-center rounded-r shadow-md"
          style={{ backgroundColor: t.panel, color: t.textSecondary }}
          title="Show Drawings"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
            <polyline points="9,18 15,12 9,6" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-[48px] shrink-0 flex-col" style={{ borderRight: `1px solid ${t.border}`, backgroundColor: t.panel }}>
        <div className="flex flex-col gap-1 py-1">
        {TOOL_GROUPS.map((group, i) => {
          const isActive = activeTool !== null && group.tools.includes(activeTool)
          const isCrosshair = group.id === 'crosshair'
          return (
            <div key={group.id} className="group/toolbar relative" ref={openFlyout === group.id ? flyoutRef : undefined}>
              {i === 1 && <div className="mx-2 my-0.5 border-t" style={{ borderColor: t.border }} />}
              <div className="relative mx-auto flex h-8 w-[44px] items-center justify-center">
                <button
                  className="flex h-8 w-8 items-center justify-center rounded transition-colors"
                  style={{
                    backgroundColor: isActive ? t.active : undefined,
                    color: isActive ? '#fff' : t.textSecondary,
                  }}
                  title={group.label}
                  onClick={() => handleGroupClick(group)}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = t.hover }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = '' }}
                >
                  {group.icon}
                </button>
                {!isCrosshair && group.tools.length > 1 && (
                  <button
                    className="absolute right-0 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover/toolbar:opacity-100"
                    style={{ color: t.textSecondary }}
                    onClick={(e) => handleFlyoutToggle(group.id, e)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
                      {openFlyout === group.id
                        ? <polyline points="15,6 9,12 15,18" />
                        : <polyline points="9,6 15,12 9,18" />
                      }
                    </svg>
                  </button>
                )}
              </div>

              {openFlyout === group.id && (
                <div
                  className="absolute left-full top-0 z-50 ml-1 min-w-[180px] rounded-md py-1 shadow-xl"
                  style={{ border: `1px solid ${t.border}`, backgroundColor: t.panel }}
                  onMouseEnter={() => setOpenFlyout(group.id)}
                  onMouseLeave={() => setOpenFlyout(null)}
                >
                  <div
                    className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ borderBottom: `1px solid ${t.border}`, color: t.textSecondary }}
                  >
                    {group.label}
                  </div>
                  {group.tools.map((toolType) => {
                    const ToolIcon = TOOL_ICONS[toolType]
                    return (
                      <button
                        key={toolType}
                        className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] transition-colors"
                        style={{
                          backgroundColor: activeTool === toolType ? t.active : undefined,
                          color: activeTool === toolType ? '#fff' : t.text,
                        }}
                        onClick={() => handleFlyoutToolSelect(toolType)}
                        onMouseEnter={(e) => { if (activeTool !== toolType) e.currentTarget.style.backgroundColor = t.hover }}
                        onMouseLeave={(e) => { if (activeTool !== toolType) e.currentTarget.style.backgroundColor = '' }}
                      >
                        {ToolIcon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<ToolIcon />}</span>}
                        <span>{getToolName(toolType)}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {hasDrawings && (
        <div className="mt-auto flex flex-col gap-1 border-t py-1" style={{ borderColor: t.border }}>
          <div className="mx-auto flex h-8 w-8 items-center justify-center">
            <button
              className="flex h-8 w-8 items-center justify-center rounded transition-colors"
              style={{ color: t.textSecondary }}
              title={allHidden ? 'Show All Drawings' : 'Hide All Drawings'}
              onClick={onHideAll}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
            >
              {allHidden ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="1" y1="1" x2="23" y2="23" strokeWidth="2" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          <div className="mx-auto flex h-8 w-8 items-center justify-center">
            <button
              className="flex h-8 w-8 items-center justify-center rounded transition-colors"
              style={{ color: t.textSecondary }}
              title={allLocked ? 'Unlock All Drawings' : 'Lock All Drawings'}
              onClick={onLockAll}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = t.hover }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
            >
              {allLocked ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                </svg>
              )}
            </button>
          </div>
          <div className="mx-auto flex h-8 w-8 items-center justify-center">
            <button
              className="flex h-8 w-8 items-center justify-center rounded transition-colors"
              style={{ color: '#ef4444' }}
              title="Delete All Drawings"
              onClick={onClearAll}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.15)' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <polyline points="3,6 5,6 21,6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
