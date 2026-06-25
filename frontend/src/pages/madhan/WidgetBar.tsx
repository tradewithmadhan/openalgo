import { useState } from 'react'
import { Layers, Eye, BarChart3, ChevronLeft } from 'lucide-react'

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
  collapsed: boolean
  onToggleCollapse: () => void
  children: React.ReactNode
}

export default function WidgetBar({ collapsed, onToggleCollapse, children }: WidgetBarProps) {
  const [activeTab, setActiveTab] = useState('object-tree')

  if (collapsed) {
    return (
      <div className="relative flex h-full w-[5px] shrink-0 items-center border-l border-[#2a2e39] bg-[#131722]">
        <button
          onClick={onToggleCollapse}
          className="absolute right-0 top-1/2 z-10 flex h-12 w-5 -translate-y-1/2 items-center justify-center rounded-l bg-[#1e222d] text-[#787b86] shadow-md hover:bg-[#2a2e39] hover:text-[#d1d4dc]"
          title="Show Object Tree"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
            <polyline points="15,18 9,12 15,6" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-[346px] shrink-0 border-l border-[#2a2e39] bg-[#1e222d]">
      <div className="flex w-[45px] shrink-0 flex-col items-center border-r border-[#2a2e39] bg-[#131722]">
        {WIDGET_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`flex h-[45px] w-full items-center justify-center transition-colors ${
              activeTab === tab.id
                ? 'bg-[#1e222d] text-[#d1d4dc]'
                : 'text-[#787b86] hover:bg-[#2a2e39] hover:text-[#d1d4dc]'
            }`}
            title={tab.label}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
          </button>
        ))}
        <div className="mt-auto">
          <button
            onClick={onToggleCollapse}
            className="flex h-[45px] w-full items-center justify-center text-[#787b86] hover:bg-[#2a2e39] hover:text-[#d1d4dc]"
            title="Hide Panel"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'object-tree' && children}
        {activeTab === 'watchlist' && (
          <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
            <BarChart3 className="mb-2 h-8 w-8 text-[#363a45]" />
            <span className="text-[12px] text-[#787b86]">Watchlist</span>
            <span className="text-[10px] text-[#4a4e59]">Coming soon</span>
          </div>
        )}
        {activeTab === 'data-window' && (
          <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
            <Eye className="mb-2 h-8 w-8 text-[#363a45]" />
            <span className="text-[12px] text-[#787b86]">Data Window</span>
            <span className="text-[10px] text-[#4a4e59]">Coming soon</span>
          </div>
        )}
      </div>
    </div>
  )
}
