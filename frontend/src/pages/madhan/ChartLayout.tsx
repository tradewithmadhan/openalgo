import { type ReactNode } from 'react'

interface ChartLayoutProps {
  leftToolbar?: ReactNode
  rightPanel?: ReactNode
  bottomBar?: ReactNode
  children: ReactNode
}

export default function ChartLayout({ leftToolbar, rightPanel, bottomBar, children }: ChartLayoutProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {leftToolbar}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {children}
        </div>
        {rightPanel}
      </div>
      {bottomBar}
    </div>
  )
}
