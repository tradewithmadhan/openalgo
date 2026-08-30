import { Link, useNavigate } from 'react-router'
import { BarChart3, Menu, Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { useMadhanTheme } from './useMadhanTheme'
import { InstrumentProvider } from './InstrumentContext'
import { PriceDiffMatrix } from './components/PriceDiffMatrix'

export default function SKWork() {
  return (
    <InstrumentProvider>
      <SKWorkInner />
    </InstrumentProvider>
  )
}

function SKWorkInner() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { mode: madhanMode, toggleMode: toggleMadhanMode, style: madhanStyle } = useMadhanTheme()
  const profileMenuItems = useProfileMenuItems()

  return (
    <div className={cn("h-full flex flex-col bg-background text-foreground madhan-theme", madhanMode === 'dark' ? 'dark' : 'madhan-light')} style={madhanStyle}>
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-4 bg-card/50 shrink-0 justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent md:hidden">
            <Menu className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <img src="/images/android-chrome-192x192.png" alt="OpenAlgo" className="w-6 h-6" />
            <span className="font-semibold text-sm">openalgo</span>
          </div>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/madhan01">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              SpotFetcher
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/ATP-LTPStrategy">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              ATPLTP
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/nifty-chart">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              SpotChart
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/ezay-chart">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              EzayChart
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/realtime-table">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              EzayOptionsTable
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/sk-work">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              SK Work
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMadhanMode} title={madhanMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {madhanMode === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-primary text-primary-foreground">
                <span className="text-sm font-medium">
                  {user?.username?.[0]?.toUpperCase() || "O"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {profileMenuItems.map((item) => (
                <DropdownMenuItem key={item.href} onSelect={() => navigate(item.href)}>
                  <item.icon className="mr-2 h-4 w-4" />
                  <span>{item.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-2">
        <Tabs defaultValue="price-diff" className="h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-3 h-9 shrink-0">
            <TabsTrigger value="price-diff">CE-PE Price Diff</TabsTrigger>
            <TabsTrigger value="tab2">Tab 2</TabsTrigger>
            <TabsTrigger value="tab3">Tab 3</TabsTrigger>
          </TabsList>
          <TabsContent value="price-diff" className="flex-1 overflow-hidden mt-2 data-[state=inactive]:hidden">
            <PriceDiffMatrix />
          </TabsContent>
          <TabsContent value="tab2" className="flex-1 overflow-auto p-4 data-[state=inactive]:hidden">
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Tab 2 — Coming soon
            </div>
          </TabsContent>
          <TabsContent value="tab3" className="flex-1 overflow-auto p-4 data-[state=inactive]:hidden">
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Tab 3 — Coming soon
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
