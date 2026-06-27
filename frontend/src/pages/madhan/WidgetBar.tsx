import { useState } from 'react'
import { Layers, Eye, BarChart3 } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { chartTheme } from './chartTheme'

interface WidgetTab {
  id: string
  label: string
  icon: React.ReactNode
}

const WIDGET_TABS: WidgetTab[] = [
  { id: 'object-tree', label: 'Object Tree', icon: <Layers className="h-4 w-4" /> },
  { id: 'watchlist', label: 'Watchlist', icon: <BarChart3 className="h-4 w-4" /> },
  { id: 'data-window', label: 'Data Window', icon: <Eye className="h-4 w-4" /> },
]

interface WidgetBarProps {
  children: React.ReactNode
}

export default function WidgetBar({ children }: WidgetBarProps) {
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const { mode } = useThemeStore()
  const t = chartTheme[mode]

  const toggleTab = (tabId: string) => {
    setActiveTab((prev) => (prev === tabId ? null : tabId))
  }

  return (
    <div className="flex h-full shrink-0 flex-row-reverse" style={{ borderLeft: `1px solid ${t.border}` }}>
      <div className="flex w-[40px] shrink-0 flex-col items-center" style={{ borderLeft: `1px solid ${t.border}`, backgroundColor: t.panelDarker }}>
        {WIDGET_TABS.map((tab) => (
          <button
            key={tab.id}
            className="flex h-[40px] w-full items-center justify-center transition-colors"
            style={{
              backgroundColor: activeTab === tab.id ? t.panel : undefined,
              color: activeTab === tab.id ? t.text : t.textSecondary,
            }}
            title={tab.label}
            onClick={() => toggleTab(tab.id)}
          >
            {tab.icon}
          </button>
        ))}
      </div>
      {activeTab && (
        <div className="flex w-[200px] min-w-0 flex-col overflow-hidden" style={{ backgroundColor: t.panel, borderLeft: `1px solid ${t.border}` }}>
          {activeTab === 'object-tree' && children}
          {activeTab === 'watchlist' && (
            <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
              <BarChart3 className="mb-2 h-8 w-8" style={{ color: t.badge }} />
              <span className="text-[12px]" style={{ color: t.textSecondary }}>Watchlist</span>
              <span className="text-[10px]" style={{ color: t.textMuted }}>Coming soon</span>
            </div>
          )}
          {activeTab === 'data-window' && (
            <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
              <Eye className="mb-2 h-8 w-8" style={{ color: t.badge }} />
              <span className="text-[12px]" style={{ color: t.textSecondary }}>Data Window</span>
              <span className="text-[10px]" style={{ color: t.textMuted }}>Coming soon</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
