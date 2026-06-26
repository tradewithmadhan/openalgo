import { useState, useMemo } from 'react'
import { indicatorRegistry } from 'lightweight-charts-indicators'
import { X, ChevronRight, Activity, Eye, EyeOff, GripVertical } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { chartTheme } from './chartTheme'

export type IndicatorInstance = {
  key: string
  indicatorId: string
  visible: boolean
  plotVisibility: Record<string, boolean>
}

interface IndicatorPanelProps {
  activeIndicators: IndicatorInstance[]
  onAdd: (indicatorId: string) => void
  onRemove: (instanceKey: string) => void
  expandedKey: string | null
  onToggleExpand: (key: string | null) => void
  inputs: Record<string, Record<string, unknown>>
  onUpdateInput: (instanceKey: string, inputId: string, value: unknown) => void
  onToggleVisibility: (instanceKey: string) => void
  onTogglePlotVisibility: (instanceKey: string, plotKey: string) => void
  onClose?: () => void
  onDragStart?: (e: React.MouseEvent) => void
}

export const INDICATOR_CATEGORIES = [
  'Moving Averages',
  'Oscillators',
  'Momentum',
  'Trend',
  'Volatility',
  'Channels & Bands',
  'Volume',
] as const

export default function IndicatorPanel({
  activeIndicators,
  onAdd,
  onRemove,
  expandedKey,
  onToggleExpand,
  inputs,
  onUpdateInput,
  onToggleVisibility,
  onTogglePlotVisibility,
  onClose,
  onDragStart,
}: IndicatorPanelProps) {
  const { mode } = useThemeStore()
  const t = chartTheme[mode]
  const [search, setSearch] = useState('')
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  const groupedIndicators = useMemo(() => {
    const query = search.trim().toLowerCase()
    const groups: Record<string, typeof indicatorRegistry> = {}
    for (const cat of INDICATOR_CATEGORIES) groups[cat] = []
    for (const item of indicatorRegistry) {
      if (!groups[item.category]) groups[item.category] = []
      if (!query) {
        groups[item.category].push(item)
        continue
      }
      if (
        item.id.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query) ||
        item.shortName.toLowerCase().includes(query)
      ) {
        groups[item.category].push(item)
      }
    }
    return groups
  }, [search])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: t.panel }}>
      <div className="flex items-center justify-between px-2 py-1.5" style={{ borderBottom: `1px solid ${t.border}` }}>
        <div className="flex items-center gap-1.5">
          <GripVertical
            className="h-3 w-3 cursor-grab active:cursor-grabbing shrink-0"
            style={{ color: t.textMuted }}
            onMouseDown={onDragStart}
          />
          <Activity className="h-3 w-3" style={{ color: t.textSecondary }} />
          <span className="text-[11px] font-medium" style={{ color: t.text }}>Indicators</span>
          <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ backgroundColor: t.badge, color: t.textSecondary }}>
            {activeIndicators.length}
          </span>
        </div>
        {onClose && (
          <button
            className="rounded p-0.5"
            style={{ color: t.textMuted }}
            onClick={onClose}
            title="Close panel"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="p-1.5" style={{ borderBottom: `1px solid ${t.border}` }}>
        <input
          className="w-full rounded px-2 py-1 text-[11px] outline-none"
          style={{ border: `1px solid ${t.border}`, backgroundColor: t.panelDarker, color: t.text }}
          value={search}
          placeholder="Search indicators..."
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-auto p-1">
        {activeIndicators.length > 0 && (
          <div className="mb-2 space-y-0.5">
            <div className="px-1 py-0.5 text-[9px] font-semibold uppercase" style={{ color: t.textMuted }}>
              Active
            </div>
            {activeIndicators.map((indicator) => {
              const entry = indicatorRegistry.find((item) => item.id === indicator.indicatorId)
              if (!entry) return null
              const expanded = expandedKey === indicator.key
              const config = Array.isArray(entry.inputConfig) ? entry.inputConfig : []
              const values = inputs[indicator.key] || {}
              const plotConfigList = Array.isArray((entry as any).plotConfig) ? (entry as any).plotConfig : []
              const indicatorVisible = indicator.visible !== false
              return (
                <div key={indicator.key} className="rounded p-1.5" style={{ border: `1px solid ${t.border}`, backgroundColor: t.panelDarker }}>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-1 text-left text-[11px]"
                      style={{ color: indicatorVisible ? t.text : t.textMuted, opacity: indicatorVisible ? 1 : 0.5 }}
                      onClick={() => onToggleExpand(expanded ? null : indicator.key)}
                    >
                      <ChevronRight
                        className="h-2.5 w-2.5 shrink-0 transition-transform"
                        style={{ color: t.textMuted, transform: expanded ? 'rotate(90deg)' : undefined }}
                      />
                      <span className="truncate">{entry.name}</span>
                      <span className="text-[9px]" style={{ color: t.textSecondary }}>{entry.shortName}</span>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        className="rounded p-0.5 text-[10px]"
                        style={{ color: indicatorVisible ? t.active : t.textMuted }}
                        onClick={() => onToggleVisibility(indicator.key)}
                        title={indicatorVisible ? 'Hide indicator' : 'Show indicator'}
                      >
                        {indicatorVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      </button>
                      <button
                        className="rounded p-0.5 text-[10px]"
                        style={{ color: t.danger }}
                        onClick={() => onRemove(indicator.key)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-1.5 pt-1.5 space-y-1" style={{ borderTop: `1px solid ${t.border}` }}>
                      <button
                        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-[10px] transition-colors"
                        style={{ color: indicatorVisible ? t.active : t.textMuted, opacity: indicatorVisible ? 1 : 0.6 }}
                        onClick={() => onToggleVisibility(indicator.key)}
                      >
                        {indicatorVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        <span>{indicatorVisible ? 'Hide indicator' : 'Show indicator'}</span>
                      </button>
                    </div>
                  )}
                  {expanded && plotConfigList.length > 1 && (
                    <div className="mt-1 pt-1 space-y-1" style={{ borderTop: `1px solid ${t.border}` }}>
                      <div className="px-1 text-[9px] font-semibold uppercase" style={{ color: t.textMuted }}>Levels</div>
                      {plotConfigList.map((plot: any) => {
                        if (!plot || !plot.id) return null
                        if (plot.display === 'none') return null
                        if (typeof plot.lineWidth === 'number' && plot.lineWidth <= 0) return null
                        const plotVisible = indicator.plotVisibility[plot.id] !== false
                        return (
                          <div key={plot.id} className="flex items-center gap-1.5 px-1">
                            <button
                              className="shrink-0"
                              style={{ color: plotVisible ? (plot.color || t.active) : t.textMuted, opacity: plotVisible ? 1 : 0.4 }}
                              onClick={() => onTogglePlotVisibility(indicator.key, plot.id)}
                              title={plotVisible ? `Hide ${plot.title || plot.id}` : `Show ${plot.title || plot.id}`}
                            >
                              {plotVisible ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                            </button>
                            <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: plot.color || t.active, opacity: plotVisible ? 1 : 0.3 }} />
                            <span className="text-[10px] flex-1" style={{ color: plotVisible ? t.textSecondary : t.textMuted, opacity: plotVisible ? 1 : 0.5 }}>
                              {plot.title || plot.id}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {expanded && config.length > 0 && (
                    <div className="mt-2 space-y-1.5 pt-2" style={{ borderTop: `1px solid ${t.border}` }}>
                      {config.map((input: any) => {
                        const value = values[input.id] ?? input.defval
                        const inputType = String(input.type || '')
                        if (inputType === 'bool') {
                          return (
                            <div key={input.id} className="flex items-center justify-between">
                              <span className="text-[10px]" style={{ color: t.textSecondary }}>{input.title || input.id}</span>
                              <label className="relative inline-flex cursor-pointer items-center">
                                <input
                                  type="checkbox"
                                  className="peer sr-only"
                                  checked={Boolean(value)}
                                  onChange={(e) => onUpdateInput(indicator.key, input.id, e.target.checked)}
                                />
                                <div className="h-4 w-7 rounded-full after:absolute after:left-[2px] after:top-[2px] after:h-3 after:w-3 after:rounded-full after:transition-all after:content-[''] peer-checked:after:translate-x-full" style={{ backgroundColor: t.badge, ...(Boolean(value) ? { backgroundColor: t.active } : {}) }}>
                                  <span className="absolute left-[2px] top-[2px] h-3 w-3 rounded-full transition-all" style={{ backgroundColor: '#fff', transform: Boolean(value) ? 'translateX(12px)' : undefined }} />
                                </div>
                              </label>
                            </div>
                          )
                        }
                        if (inputType === 'source' || Array.isArray(input.options)) {
                          const options = input.options || ['open', 'high', 'low', 'close']
                          return (
                            <div key={input.id}>
                              <span className="text-[10px]" style={{ color: t.textSecondary }}>{input.title || input.id}</span>
                              <select
                                className="mt-0.5 w-full rounded px-1.5 py-0.5 text-[10px] outline-none"
                                style={{ border: `1px solid ${t.border}`, backgroundColor: t.panel, color: t.text }}
                                value={String(value)}
                                onChange={(e) => onUpdateInput(indicator.key, input.id, e.target.value)}
                              >
                                {options.map((option: string) => (
                                  <option key={option} value={String(option)}>{String(option)}</option>
                                ))}
                              </select>
                            </div>
                          )
                        }
                        return (
                          <div key={input.id}>
                            <span className="text-[10px]" style={{ color: t.textSecondary }}>{input.title || input.id}</span>
                            <input
                              type="number"
                              className="mt-0.5 w-full rounded px-1.5 py-0.5 text-[10px] outline-none"
                              style={{ border: `1px solid ${t.border}`, backgroundColor: t.panel, color: t.text }}
                              value={String(value ?? '')}
                              onChange={(e) => {
                                const raw = e.target.value
                                const num = inputType === 'int' ? Number.parseInt(raw || '0', 10) : Number.parseFloat(raw || '0')
                                if (!Number.isNaN(num)) onUpdateInput(indicator.key, input.id, num)
                              }}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {INDICATOR_CATEGORIES.map((cat) => {
          const items = groupedIndicators[cat]
          if (!items || items.length === 0) return null
          const collapsed = collapsedCategories[cat]
          return (
            <div key={cat} className="mb-1">
              <button
                className="flex w-full items-center rounded px-1 py-0.5 text-left text-[10px] font-semibold uppercase transition-colors"
                style={{ color: t.textSecondary }}
                onClick={() => toggleCategory(cat)}
              >
                <ChevronRight
                  className="mr-1 h-2.5 w-2.5 shrink-0 transition-transform"
                  style={{ transform: collapsed ? undefined : 'rotate(90deg)' }}
                />
                <span className="flex-1">{cat}</span>
                <span className="text-[9px]" style={{ color: t.textMuted }}>{items.length}</span>
              </button>
              {!collapsed && (
                <div className="space-y-px pl-2">
                  {items.map((item) => {
                    const isActive = activeIndicators.some((x) => x.indicatorId === item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] transition-colors"
                        style={{
                          borderLeft: `2px solid ${isActive ? t.active : 'transparent'}`,
                          backgroundColor: isActive ? t.activeBg : undefined,
                          color: isActive ? t.text : t.textSecondary,
                        }}
                        onClick={() => onAdd(item.id)}
                        title={item.description || item.name}
                      >
                        <span className="truncate flex-1">{item.name}</span>
                        {item.overlay && (
                          <span className="rounded px-1 py-0.5 text-[8px]" style={{ backgroundColor: t.badge, color: t.textMuted }}>OVL</span>
                        )}
                        {isActive && <span style={{ color: t.active }}>+</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
