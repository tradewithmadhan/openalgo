import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { 
  AlertTriangle, 
  BarChart3, 
  Play, 
  Pause, 
  RefreshCw, 
  Table, 
  Menu, 
  Zap, 
  Sun, 
  Moon, 
  Home
} from 'lucide-react'
import { showToast } from '@/utils/toast'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { useAlertStore } from '@/stores/alertStore'
import { useMadhanSignalStore } from '@/stores/madhanSignalStore'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { useMadhanTheme } from './useMadhanTheme'
import { InstrumentProvider, useInstrument, type Instrument } from './InstrumentContext'
import { CoiTrendChart } from './components/CoiTrendChart'
import { CePeChangesChart } from './components/CePeChangesChart'
import { CePeStrikeChangesChart } from './components/CePeStrikeChangesChart'
import { CePeVolumeChangesChart } from './components/CePeVolumeChangesChart'
import { CePeStrikeVolumeChangesChart } from './components/CePeStrikeVolumeChangesChart'
import { OiActionChartPlotly } from './components/OiActionChartPlotly'
import { SupportResistanceChart } from './components/SupportResistanceChart'
import { FutStocks } from './components/FutStocks'
import { MultiOptionsChart } from './components/MultiOptionsChart'
import { Dash } from './components/Dash'

interface NiftyStatus {
  status: 'success' | 'error' | 'info'
  is_running: boolean
  message: string
  last_update: string | null
  server_time: string | null
  nifty_record_count: number
  banknifty_record_count: number
  open_atm_strike: number
  current_atm_strike: number
  expiry_date: string | null
  ce_count: number
  pe_count: number
}

interface PreviousDayOiRow {
  symbol: string
  close: number
  oi: number
  current_oi: number
  change_in_oi: number
  change_in_oi_3min: number
  change_in_oi_6min: number
  timestamp: number
}

interface NiftyCandle {
  symbol: string
  close: number
  volume: number
  oi: number | null
  timestamp: number
}

interface OptionCandle {
  symbol: string
  close: number
  volume: number
  oi: number | null
  candle_count: number | null
  timestamp: number
}

interface UnifiedStrikeRow {
  strike: number
  ce: PreviousDayOiRow | null
  pe: PreviousDayOiRow | null
}

export default function Madhan01() {
  return (
    <InstrumentProvider>
      <Madhan01Inner />
    </InstrumentProvider>
  )
}

function Madhan01Inner() {
  const navigate = useNavigate()
  const { instrument, setInstrument } = useInstrument()
  const { user } = useAuthStore()
  const { appMode, toggleAppMode, isTogglingMode } = useThemeStore()
  const { mode: madhanMode, toggleMode: toggleMadhanMode, style: madhanStyle } = useMadhanTheme()
  const alertStore = useAlertStore()
  const { atp_ltp_signal, volume_spike, atp_ltp_nifty, atp_ltp_banknifty, volume_spike_nifty, volume_spike_banknifty, setToggle } = useMadhanSignalStore()
  const profileMenuItems = useProfileMenuItems()
  
  const [status, setStatus] = useState<NiftyStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prevDayOi, setPrevDayOi] = useState<PreviousDayOiRow[]>([])
  const [liveRows, setLiveRows] = useState<Array<NiftyCandle | OptionCandle>>([])
  const [showLiveTable, setShowLiveTable] = useState(false)
  const [showPrevDayTable, setShowPrevDayTable] = useState(false)
  const [showSessionChange, setShowSessionChange] = useState(true)
  const [showThreeMinChange, setShowThreeMinChange] = useState(true)
  const [showSixMinChange, setShowSixMinChange] = useState(true)
  const [fullView, setFullView] = useState(false)
  const [showOiChain, setShowOiChain] = useState(true)
  const [_refreshTrigger, setRefreshTrigger] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const latestStatusRef = useRef<NiftyStatus | null>(null)
  const timeOffsetRef = useRef(0)

  const getServerNow = useCallback(() => new Date(Date.now() + timeOffsetRef.current), [])

  const fetchStatus = useCallback(async () => {
    try {
      setError(null)
      const response = await fetch(`/madhan/api/nifty/status?instrument=${instrument}&_=${Date.now()}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })

      if (!response.ok) {
        setError('Failed to fetch Nifty status')
        return null
      }

      const data = await response.json()
      if (data.status === 'success') {
        const statusData = data as NiftyStatus
        // Re-sync time offset from server_time on every status response
        if (statusData.server_time) {
          const serverMs = new Date(statusData.server_time).getTime()
          timeOffsetRef.current = serverMs - Date.now()
        }
        setStatus(statusData)
        latestStatusRef.current = statusData
        return statusData
      } else {
        setError(data.message || 'Failed to fetch Nifty status')
        return null
      }
    } catch (_e) {
      setError('Failed to fetch Nifty status')
      return null
    }
  }, [instrument])

  const startFetcher = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await fetch(`/madhan/api/nifty/start?instrument=${instrument}`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const data = await response.json()
      if (response.ok && (data.status === 'success' || data.status === 'info')) {
        showToast.success(data.message || 'Fetcher started successfully')
        await fetchStatus()
      } else {
        setError(data.message || 'Failed to start fetcher')
      }
    } catch (_e) {
      setError('Failed to start fetcher')
    } finally {
      setIsLoading(false)
    }
  }, [fetchStatus])

  const stopFetcher = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await fetch(`/madhan/api/nifty/stop?instrument=${instrument}`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const data = await response.json()
      if (response.ok && data.status === 'success') {
        showToast.success(data.message || 'Fetcher stopped successfully')
        await fetchStatus()
      } else {
        const msg = data.message || 'Failed to stop fetcher'
        setError(msg)
        showToast.error(msg)
      }
    } catch (_e) {
      const msg = 'Failed to stop fetcher'
      setError(msg)
      showToast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }, [fetchStatus])



  const fetchPrevDayOi = useCallback(async () => {
    try {
      const response = await fetch(`/madhan/api/nifty/previous-day-oi?instrument=${instrument}&_=${Date.now()}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        return
      }
      const data = await response.json()
      if (data.status === 'success' && Array.isArray(data.data)) {
        setPrevDayOi(data.data as PreviousDayOiRow[])
      }
    } catch {
    }
  }, [instrument])

  const fetchLiveData = useCallback(async (): Promise<number | null> => {
    try {
      const [niftyResponse, optionResponse] = await Promise.all([
        fetch(`/madhan/api/nifty/data?instrument=${instrument}&_=${Date.now()}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }),
        fetch(`/madhan/api/nifty/option-data?instrument=${instrument}&_=${Date.now()}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }),
      ])

      const rows: Array<NiftyCandle | OptionCandle> = []
      let lastTimestamp: number | null = null

      if (niftyResponse.ok) {
        const niftyJson = await niftyResponse.json()
        if (niftyJson.status === 'success' && Array.isArray(niftyJson.data) && niftyJson.data.length > 0) {
          const latest = niftyJson.data[niftyJson.data.length - 1] as NiftyCandle
          rows.push(latest)
          lastTimestamp = latest.timestamp
        }
      }

      if (optionResponse.ok) {
        const optionJson = await optionResponse.json()
        if (optionJson.status === 'success' && Array.isArray(optionJson.data)) {
          const sorted = [...optionJson.data] as OptionCandle[]
          sorted.sort((a, b) => a.symbol.localeCompare(b.symbol))
          rows.push(...sorted)
          // If nifty data didn't provide timestamp, check option data? 
          // Usually Nifty data is the reference.
          if (!lastTimestamp && sorted.length > 0) {
              lastTimestamp = sorted[0].timestamp
          }
        }
      }

      setLiveRows(rows)
      return lastTimestamp
    } catch {
        return null
    }
  }, [instrument])

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>
    let intervalId: ReturnType<typeof setInterval>
    let isFetching = false

    const scheduleNextMinute = () => {
      const serverNow = getServerNow()
      const msToNextMinute = (60 - serverNow.getSeconds()) * 1000 - serverNow.getMilliseconds()
      timeoutId = setTimeout(startPolling, Math.max(0, msToNextMinute))
    }

    const fetchDataAndScheduleNext = async () => {
      if (intervalId) clearInterval(intervalId)
      await fetchPrevDayOi()
      await fetchLiveData()
      setRefreshTrigger(prev => prev + 1)
      scheduleNextMinute()
    }

    const startPolling = () => {
      intervalId = setInterval(async () => {
        if (isFetching) return
        isFetching = true
        try {
          const statusData = await fetchStatus()
          if (!statusData?.is_running) {
            clearInterval(intervalId)
            return
          }
          if (statusData.last_update) {
            const lastUpdate = new Date(statusData.last_update)
            const serverNow = getServerNow()
            if (lastUpdate.getMinutes() === serverNow.getMinutes()) {
              fetchDataAndScheduleNext()
            }
          }
        } finally {
          isFetching = false
        }
      }, 1000)
    }

    // Immediate fetch on mount so data loads right away
    fetchPrevDayOi()
    fetchLiveData()

    startPolling()
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [fetchStatus, fetchPrevDayOi, fetchLiveData, getServerNow])

  const buildUnifiedStrikes = (): UnifiedStrikeRow[] => {
    if (!prevDayOi.length) return []
    const strikeRegex = /(\d{5})(CE|PE)$/
    const map = new Map<number, UnifiedStrikeRow>()
    prevDayOi.forEach((row) => {
      if (!row || !row.symbol) return
      const match = row.symbol.match(strikeRegex)
      if (!match) return
      const strike = Number.parseInt(match[1], 10)
      const type = match[2]
      if (!map.has(strike)) {
        map.set(strike, { strike, ce: null, pe: null })
      }
      const entry = map.get(strike)
      if (!entry) return
      if (type === 'CE') {
        entry.ce = row
      } else {
        entry.pe = row
      }
    })
    let rows = Array.from(map.values()).sort((a, b) => b.strike - a.strike)
    if (!fullView && status?.open_atm_strike) {
      const atm = status.open_atm_strike
      const index = rows.findIndex((r) => r.strike === atm)
      if (index !== -1) {
        const start = Math.max(0, index - 5)
        const end = Math.min(rows.length, index + 6)
        rows = rows.slice(start, end)
      }
    }
    return rows
  }

  const formatCompactNumber = (value: number) => {
    if (!value) return '0'
    const abs = Math.abs(value)
    const sign = value < 0 ? '-' : ''
    if (abs >= 100000) {
      return `${sign}${(abs / 100000).toFixed(1)}L`
    }
    if (abs >= 1000) {
      return `${sign}${(abs / 1000).toFixed(1)}K`
    }
    return value.toLocaleString('en-IN')
  }

  const formatChangeValue = (change: number, prevOi: number) => {
    const base = formatCompactNumber(change || 0)
    if (!prevOi || !change) return base
    const percent = (change / prevOi) * 100
    const sign = change >= 0 ? '+' : ''
    return `${base} (${sign}${percent.toFixed(1)}%)`
  }

  const computeMaxValues = (rows: UnifiedStrikeRow[]) => {
    let maxOi = 0
    let maxSession = 0
    let max3m = 0
    let max6m = 0
    rows.forEach((row) => {
      const items: PreviousDayOiRow[] = []
      if (row.ce) items.push(row.ce)
      if (row.pe) items.push(row.pe)
      items.forEach((item) => {
        maxOi = Math.max(maxOi, item.current_oi || 0)
        maxSession = Math.max(maxSession, Math.abs(item.change_in_oi || 0))
        max3m = Math.max(max3m, Math.abs(item.change_in_oi_3min || 0))
        max6m = Math.max(max6m, Math.abs(item.change_in_oi_6min || 0))
      })
    })
    return { maxOi, maxSession, max3m, max6m }
  }

  const renderOiBarWidth = (value: number, max: number) => {
    if (!max || !value) return 0
    return Math.max((value / max) * 90, 2)
  }

  const renderChangeWidth = (value: number, max: number) => {
    if (!max || !value) return 0
    return (Math.abs(value) / max) * 50
  }


  const unifiedRows = buildUnifiedStrikes()
  const { maxOi, maxSession, max3m, max6m } = computeMaxValues(unifiedRows)

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
                NiftyFetcher
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
                NiftyChart
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
          </div>

          <div className="flex items-center gap-2">
             {/* Mode Badge */}
            <Badge
                variant={appMode === "live" ? "default" : "secondary"}
                className={cn(
                "text-xs hidden sm:flex",
                appMode === "analyzer" &&
                    "bg-purple-500 hover:bg-purple-600 text-white",
                )}
            >
                {appMode === "live" ? "Live Mode" : "Analyze Mode"}
            </Badge>

            {/* Mode Toggle */}
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={async () => {
                    const result = await toggleAppMode()
                    if (result.success) {
                        showToast.success(result.message || `Switched to ${appMode === "live" ? "Analyze" : "Live"} mode`)
                        if (appMode === "live") { // Note: appMode here is the *old* mode before toggle completes if we use the destructured value directly, but toggleAppMode is async. Actually, toggleAppMode updates the store. We should probably use the *new* mode from store or result.
                             // Wait, useThemeStore state might not update immediately in this render cycle.
                             // Playground uses: const newMode = useThemeStore.getState().appMode;
                        }
                    } else {
                        showToast.error(result.message || "Failed to toggle mode")
                    }
                }}
                disabled={isTogglingMode}
                title={`Switch to ${appMode === "live" ? "Analyze" : "Live"} mode`}
            >
                {isTogglingMode ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : appMode === "live" ? (
                <Zap className="h-4 w-4" />
                ) : (
                <BarChart3 className="h-4 w-4" />
                )}
            </Button>

            {/* Theme Toggle */}
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={toggleMadhanMode}
                title={
                madhanMode === "light" ? "Switch to dark mode" : "Switch to light mode"
                }
            >
                {madhanMode === "light" ? (
                <Sun className="h-4 w-4" />
                ) : (
                <Moon className="h-4 w-4" />
                )}
            </Button>

            <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
                <Link to="/dashboard">
                <Home className="h-3.5 w-3.5 mr-1.5" />
                Dashboard
                </Link>
            </Button>

            {/* Profile Dropdown */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full bg-primary text-primary-foreground"
                >
                    <span className="text-sm font-medium">
                    {user?.username?.[0]?.toUpperCase() || "O"}
                    </span>
                </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                {profileMenuItems.map((item) => (
                    <DropdownMenuItem
                    key={item.href}
                    onSelect={() => navigate(item.href)}
                    >
                    <item.icon className="mr-2 h-4 w-4" />
                    <span>{item.label}</span>
                    </DropdownMenuItem>
                ))}
                </DropdownMenuContent>
            </DropdownMenu>
          </div>
      </div>
      
      <div className="flex-1 overflow-auto p-2 space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight shrink-0">Data Fetcher</h1>
          <span className="text-muted-foreground/30 hidden sm:inline">|</span>
          <div className="flex items-center gap-1">
            <span className={`flex h-2 w-2 rounded-full ${status?.is_running ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            <span className={status?.is_running ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
              {status?.message || "Checking status..."}
            </span>
          </div>
          <span className="text-muted-foreground/30">|</span>
          {/* Instrument Toggle */}
          <div className="flex items-center bg-muted rounded-md p-0.5">
            {(['NIFTY', 'BANKNIFTY'] as Instrument[]).map((inst) => (
              <button
                key={inst}
                onClick={() => setInstrument(inst)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                  instrument === inst
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {inst}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground/30">|</span>
          <div className="flex items-center gap-1">
             <span className="font-semibold">Records:</span>
             <span className="text-primary font-mono">
               {instrument === 'BANKNIFTY'
                 ? (status?.banknifty_record_count?.toLocaleString('en-IN') ?? 0)
                 : (status?.nifty_record_count?.toLocaleString('en-IN') ?? 0)}
             </span>
          </div>
          <span className="text-muted-foreground/30">|</span>
          <div className="flex items-center gap-1">
             <span className="font-semibold">Updated:</span>
             <span className="text-secondary-foreground font-mono text-[11px]">
               {status?.last_update
                 ? new Date(status.last_update).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                 : "-"}
             </span>
          </div>
          <span className="text-muted-foreground/30">|</span>
          <div className="flex items-center gap-1">
             <span className="font-semibold">Expiry:</span>
             <span className="text-secondary-foreground font-medium">{status?.expiry_date || "-"}</span>
          </div>
        </div>
        
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
           <div className="flex items-center gap-2 bg-muted/50 p-1.5 rounded-lg border text-xs">
              <div className="px-2 py-0.5 rounded bg-background shadow-sm border">
                 <span className="text-muted-foreground mr-1">Open ATM:</span>
                  <span className="font-bold" style={{ color: madhanMode === 'dark' ? '#fbbf24' : '#d97706' }}>{status?.open_atm_strike || "-"}</span>
              </div>
              <div className="px-2 py-0.5 rounded bg-background shadow-sm border animate-pulse-yellow">
                 <span className="text-muted-foreground mr-1">Current ATM:</span>
                  <span className="font-bold" style={{ color: madhanMode === 'dark' ? '#fbbf24' : '#d97706' }}>{status?.current_atm_strike || "-"}</span>
              </div>
              <div className="px-2 py-0.5 rounded bg-background shadow-sm border">
                 <span className="text-muted-foreground mr-1">Tracked:</span>
                 <span className="font-medium text-emerald-600">{status?.ce_count || 0} CE</span>
                 <span className="text-muted-foreground mx-1">&</span>
                 <span className="font-medium text-red-600">{status?.pe_count || 0} PE</span>
              </div>
           </div>

           <div className="flex gap-2">
              <Button 
                variant={status?.is_running ? "outline" : "default"} 
                size="sm" 
                onClick={startFetcher}
                disabled={status?.is_running || isLoading}
                className={cn(!status?.is_running && "bg-emerald-600 hover:bg-emerald-700 text-white")}
              >
                {isLoading && !status?.is_running ? <RefreshCw className="mr-2 h-3 w-3 animate-spin" /> : <Play className="mr-2 h-3 w-3" />}
                Start
              </Button>
              <Button 
                variant={status?.is_running ? "destructive" : "outline"} 
                size="sm" 
                onClick={stopFetcher}
                disabled={!status?.is_running || isLoading}
              >
                {isLoading && status?.is_running ? <RefreshCw className="mr-2 h-3 w-3 animate-spin" /> : <Pause className="mr-2 h-3 w-3" />}
                Stop
              </Button>
            </div>
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="ml-2">{error}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="dash" className="w-full">
      <TabsList className="grid w-full grid-cols-4 md:grid-cols-6 lg:grid-cols-12">
        <TabsTrigger value="dash">Dash</TabsTrigger>
        <TabsTrigger value="unified-oi-chain">Unified OI Chain</TabsTrigger>
        <TabsTrigger value="ce-pe-analysis">CE/PE OI</TabsTrigger>
        <TabsTrigger value="oi-vs-vol">OI vs Vol</TabsTrigger>
        <TabsTrigger value="ce-pe-volume-analysis">CE/PE Volume</TabsTrigger>
        <TabsTrigger value="coi-trend">COI Trend</TabsTrigger>
        <TabsTrigger value="multi-options">Multi-Options</TabsTrigger>
        <TabsTrigger value="oi-action-plotly">OI Action</TabsTrigger>
        <TabsTrigger value="support-resistance">Support & Resistance</TabsTrigger>
        <TabsTrigger value="data-check">Data Check</TabsTrigger>
        <TabsTrigger value="signal-settings">Signal Settings</TabsTrigger>
        <TabsTrigger value="fut-stocks">FUT Stocks</TabsTrigger>
      </TabsList>
        
        <TabsContent value="dash">
          <Dash refreshTrigger={_refreshTrigger} />
        </TabsContent>

        <TabsContent value="unified-oi-chain">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    <CardTitle className="text-base font-semibold">Unified OI Chain</CardTitle>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                        <span>Session</span>
                        <Switch 
                            checked={showSessionChange} 
                            onCheckedChange={setShowSessionChange} 
                            className="scale-75 origin-right"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span>3Min</span>
                        <Switch 
                            checked={showThreeMinChange} 
                            onCheckedChange={setShowThreeMinChange} 
                            className="scale-75 origin-right"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span>6Min</span>
                        <Switch 
                            checked={showSixMinChange} 
                            onCheckedChange={setShowSixMinChange} 
                            className="scale-75 origin-right"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span>Full view</span>
                        <Switch 
                            checked={fullView} 
                            onCheckedChange={setFullView} 
                            className="scale-75 origin-right"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span>Show chain</span>
                        <Switch 
                            checked={showOiChain} 
                            onCheckedChange={setShowOiChain} 
                            className="scale-75 origin-right"
                        />
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                            setIsRefreshing(true)
                            fetchPrevDayOi().finally(() => setIsRefreshing(false))
                        }}
                        title="Refresh Data"
                    >
                        <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
                </CardHeader>
                <CardContent className="space-y-2">
                {!showOiChain && (
                    <div className="text-xs text-muted-foreground">OI chain hidden. Enable Show chain.</div>
                )}
                {showOiChain && !unifiedRows.length && (
                    <div className="text-xs text-muted-foreground">
                    No OI chain data yet. Start the fetcher and wait for data.
                    </div>
                )}
                {showOiChain && unifiedRows.length > 0 && (
                    <div className="space-y-1">
                    <div
                        className="text-[11px] font-medium text-muted-foreground"
                        style={{
                        display: 'grid',
                        gridTemplateColumns: [
                            'minmax(80px,1fr)',
                            'minmax(180px,2fr)',
                            showSessionChange ? 'minmax(180px,2fr)' : null,
                            showThreeMinChange ? 'minmax(180px,2fr)' : null,
                            showSixMinChange ? 'minmax(180px,2fr)' : null,
                        ]
                            .filter(Boolean)
                            .join(' '),
                        gap: '0.25rem',
                        alignItems: 'center',
                        justifyItems: 'center',
                        textAlign: 'center',
                        }}
                    >
                        <div>Strike</div>
                        <div>Open Interest</div>
                        {showSessionChange && <div>Session Change</div>}
                        {showThreeMinChange && <div>3Min Change</div>}
                        {showSixMinChange && <div>6Min Change</div>}
                    </div>
                    <div className="space-y-1">
                        {unifiedRows.map((row, index) => {
                        const isOpenAtm = status?.open_atm_strike && row.strike === status.open_atm_strike
                        const isCurrentAtm =
                            status?.current_atm_strike && row.strike === status.current_atm_strike
                        
                        // Base row classes with alternating background
                        const rowClasses = [
                            'flex items-stretch rounded-md border px-1 py-1 text-xs transition-colors',
                        ]

                        if (isCurrentAtm) {
                            rowClasses.push('current-atm-row border-amber-400/50 shadow-[0_0_15px_rgba(251,191,36,0.15)]')
                        } else {
                            rowClasses.push('border-transparent')
                        }

                        const strikeClasses = ['flex items-center justify-center font-bold text-sm rounded px-1']
                        if (isCurrentAtm) strikeClasses.push('scale-110 transform transition-transform')
                        
                        const gridCols = [
                            'minmax(80px,1fr)',
                            'minmax(180px,2fr)',
                            showSessionChange ? 'minmax(180px,2fr)' : null,
                            showThreeMinChange ? 'minmax(180px,2fr)' : null,
                            showSixMinChange ? 'minmax(180px,2fr)' : null,
                        ]
                            .filter(Boolean)
                            .join(' ')

                        const rowStyle: React.CSSProperties = {
                            display: 'grid',
                            gridTemplateColumns: gridCols,
                            gap: '0.25rem',
                            alignItems: 'center',
                            backgroundColor: index % 2 === 0 ? (madhanMode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)') : (madhanMode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)'),
                        }

                        const strikeStyle: React.CSSProperties = isOpenAtm
                            ? { backgroundColor: madhanMode === 'dark' ? 'rgba(146,123,15,0.3)' : 'rgba(253,230,138,1)', color: madhanMode === 'dark' ? '#fbbf24' : '#a16207' }
                            : isCurrentAtm
                                ? { color: madhanMode === 'dark' ? '#fbbf24' : '#d97706' }
                                : {} as React.CSSProperties
                        return (
                            <div
                            key={row.strike}
                            className={rowClasses.join(' ')}
                            style={rowStyle}
                            >
                            <div className={strikeClasses.join(' ')} style={strikeStyle}>{row.strike}</div>
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                <span className="w-6 text-center text-[11px] font-semibold text-muted-foreground">
                                    CE
                                </span>
                                <span className="w-24 text-right font-mono text-xs">
                                    {formatCompactNumber(row.ce?.current_oi || 0)}
                                </span>
                                <div className="h-4 flex-1 rounded bg-transparent">
                                    <div
                                    className="h-full rounded bg-red-500/70"
                                    style={{
                                        width: `${renderOiBarWidth(row.ce?.current_oi || 0, maxOi)}%`,
                                    }}
                                    />
                                </div>
                                </div>
                                <div className="flex items-center gap-2">
                                <span className="w-6 text-center text-[11px] font-semibold text-muted-foreground">
                                    PE
                                </span>
                                <span className="w-24 text-right font-mono text-xs">
                                    {formatCompactNumber(row.pe?.current_oi || 0)}
                                </span>
                                <div className="h-4 flex-1 rounded bg-transparent">
                                    <div
                                    className="h-full rounded bg-emerald-500/70"
                                    style={{
                                        width: `${renderOiBarWidth(row.pe?.current_oi || 0, maxOi)}%`,
                                    }}
                                    />
                                </div>
                                </div>
                            </div>
                            {showSessionChange && (
                                <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-6 text-center text-[11px] font-semibold text-muted-foreground">
                                    CE
                                    </span>
                                    <span className={`w-28 text-center font-mono text-xs ${(row.ce?.change_in_oi || 0) > 0 ? 'text-emerald-500' : (row.ce?.change_in_oi || 0) < 0 ? 'text-red-500' : ''}`}>
                                    {formatChangeValue(
                                        row.ce?.change_in_oi || 0,
                                        row.ce?.oi || 0,
                                    )}
                                    </span>
                                    <div className="relative h-4 flex-1 rounded bg-transparent">
                                    <div className="absolute inset-y-[15%] left-1/2 w-px bg-border" />
                                    <div
                                        className={`absolute inset-y-0 rounded ${(row.ce?.change_in_oi || 0) < 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                                        style={{
                                        right:
                                            (row.ce?.change_in_oi || 0) < 0 ? '50%' : undefined,
                                        left:
                                            (row.ce?.change_in_oi || 0) > 0 ? '50%' : undefined,
                                        width: `${renderChangeWidth(
                                            row.ce?.change_in_oi || 0,
                                            maxSession,
                                        )}%`,
                                        }}
                                    />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-6 text-center text-[11px] font-semibold text-muted-foreground">
                                    PE
                                    </span>
                                    <span className={`w-28 text-center font-mono text-xs ${(row.pe?.change_in_oi || 0) > 0 ? 'text-emerald-500' : (row.pe?.change_in_oi || 0) < 0 ? 'text-red-500' : ''}`}>
                                    {formatChangeValue(
                                        row.pe?.change_in_oi || 0,
                                        row.pe?.oi || 0,
                                    )}
                                    </span>
                                    <div className="relative h-4 flex-1 rounded bg-transparent">
                                    <div className="absolute inset-y-[15%] left-1/2 w-px bg-border" />
                                    <div
                                        className={`absolute inset-y-0 rounded ${(row.pe?.change_in_oi || 0) < 0 ? 'bg-red-500/70' : 'bg-emerald-500/70'}`}
                                        style={{
                                        right:
                                            (row.pe?.change_in_oi || 0) < 0 ? '50%' : undefined,
                                        left:
                                            (row.pe?.change_in_oi || 0) > 0 ? '50%' : undefined,
                                        width: `${renderChangeWidth(
                                            row.pe?.change_in_oi || 0,
                                            maxSession,
                                        )}%`,
                                        }}
                                    />
                                    </div>
                                </div>
                                </div>
                            )}
                            {showThreeMinChange && (
                                <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-6 text-center text-[11px] font-semibold text-muted-foreground">
                                    CE
                                    </span>
                                    <span className={`w-28 text-center font-mono text-xs ${(row.ce?.change_in_oi_3min || 0) > 0 ? 'text-emerald-500' : (row.ce?.change_in_oi_3min || 0) < 0 ? 'text-red-500' : ''}`}>
                                    {formatChangeValue(
                                        row.ce?.change_in_oi_3min || 0,
                                        row.ce?.oi || 0,
                                    )}
                                    </span>
                                    <div className="relative h-4 flex-1 rounded bg-transparent">
                                    <div className="absolute inset-y-[15%] left-1/2 w-px bg-border" />
                                    <div
                                        className={`absolute inset-y-0 rounded ${(row.ce?.change_in_oi_3min || 0) < 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                                        style={{
                                        right:
                                            (row.ce?.change_in_oi_3min || 0) < 0 ? '50%' : undefined,
                                        left:
                                            (row.ce?.change_in_oi_3min || 0) > 0 ? '50%' : undefined,
                                        width: `${renderChangeWidth(
                                            row.ce?.change_in_oi_3min || 0,
                                            max3m,
                                        )}%`,
                                        }}
                                    />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-6 text-center text-[11px] font-semibold text-muted-foreground">
                                    PE
                                    </span>
                                    <span className="w-28 text-center font-mono text-xs">
                                    {formatChangeValue(
                                        row.pe?.change_in_oi_3min || 0,
                                        row.pe?.oi || 0,
                                    )}
                                    </span>
                                    <div className="relative h-4 flex-1 rounded bg-transparent">
                                    <div className="absolute inset-y-[15%] left-1/2 w-px bg-border" />
                                    <div
                                        className={`absolute inset-y-0 rounded ${(row.pe?.change_in_oi_3min || 0) < 0 ? 'bg-red-500/70' : 'bg-emerald-500/70'}`}
                                        style={{
                                        right:
                                            (row.pe?.change_in_oi_3min || 0) < 0 ? '50%' : undefined,
                                        left:
                                            (row.pe?.change_in_oi_3min || 0) > 0 ? '50%' : undefined,
                                        width: `${renderChangeWidth(
                                            row.pe?.change_in_oi_3min || 0,
                                            max3m,
                                        )}%`,
                                        }}
                                    />
                                    </div>
                                </div>
                                </div>
                            )}
                            {showSixMinChange && (
                                <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-6 text-center text-[11px] font-semibold text-muted-foreground">
                                    CE
                                    </span>
                                    <span className="w-28 text-center font-mono text-xs">
                                    {formatChangeValue(
                                        row.ce?.change_in_oi_6min || 0,
                                        row.ce?.oi || 0,
                                    )}
                                    </span>
                                    <div className="relative h-4 flex-1 rounded bg-transparent">
                                    <div className="absolute inset-y-[15%] left-1/2 w-px bg-border" />
                                    <div
                                        className={`absolute inset-y-0 rounded ${(row.ce?.change_in_oi_6min || 0) < 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                                        style={{
                                        right:
                                            (row.ce?.change_in_oi_6min || 0) < 0 ? '50%' : undefined,
                                        left:
                                            (row.ce?.change_in_oi_6min || 0) > 0 ? '50%' : undefined,
                                        width: `${renderChangeWidth(
                                            row.ce?.change_in_oi_6min || 0,
                                            max6m,
                                        )}%`,
                                        }}
                                    />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-6 text-center text-[11px] font-semibold text-muted-foreground">
                                    PE
                                    </span>
                                    <span className={`w-28 text-center font-mono text-xs ${(row.pe?.change_in_oi_6min || 0) > 0 ? 'text-emerald-500' : (row.pe?.change_in_oi_6min || 0) < 0 ? 'text-red-500' : ''}`}>
                                    {formatChangeValue(
                                        row.pe?.change_in_oi_6min || 0,
                                        row.pe?.oi || 0,
                                    )}
                                    </span>
                                    <div className="relative h-4 flex-1 rounded bg-transparent">
                                    <div className="absolute inset-y-[15%] left-1/2 w-px bg-border" />
                                    <div
                                        className={`absolute inset-y-0 rounded ${(row.pe?.change_in_oi_6min || 0) < 0 ? 'bg-red-500/70' : 'bg-emerald-500/70'}`}
                                        style={{
                                        right:
                                            (row.pe?.change_in_oi_6min || 0) < 0 ? '50%' : undefined,
                                        left:
                                            (row.pe?.change_in_oi_6min || 0) > 0 ? '50%' : undefined,
                                        width: `${renderChangeWidth(
                                            row.pe?.change_in_oi_6min || 0,
                                            max6m,
                                        )}%`,
                                        }}
                                    />
                                    </div>
                                </div>
                                </div>
                            )}
                            </div>
                        )
                        })}
                    </div>
                    </div>
                )}
                </CardContent>
            </Card>
        </TabsContent>

        <TabsContent value="ce-pe-analysis" className="space-y-6">
          <div className="flex flex-col gap-6">
            <CePeChangesChart refreshTrigger={_refreshTrigger} />
            <CePeStrikeChangesChart refreshTrigger={_refreshTrigger} atmStrike={status?.current_atm_strike} />
          </div>
        </TabsContent>

        <TabsContent value="ce-pe-volume-analysis" className="space-y-3">
          <div className="flex flex-col gap-3">
            <CePeVolumeChangesChart refreshTrigger={_refreshTrigger} />
            <CePeStrikeVolumeChangesChart refreshTrigger={_refreshTrigger} atmStrike={status?.current_atm_strike} />
          </div>
        </TabsContent>

        <TabsContent value="oi-vs-vol" className="space-y-3">
          <div className="flex flex-col gap-3">
            <CePeChangesChart refreshTrigger={_refreshTrigger} />
            <CePeVolumeChangesChart refreshTrigger={_refreshTrigger} />
          </div>
        </TabsContent>

        <TabsContent value="coi-trend">
          <CoiTrendChart refreshTrigger={_refreshTrigger} />
        </TabsContent>

        <TabsContent value="multi-options">
            <MultiOptionsChart 
                refreshTrigger={_refreshTrigger} 
                atmStrike={status?.open_atm_strike || status?.current_atm_strike}
                expiryDate={status?.expiry_date}
            />
        </TabsContent>

        <TabsContent value="oi-action-plotly">
          <OiActionChartPlotly refreshTrigger={_refreshTrigger} atmStrike={status?.open_atm_strike} />
        </TabsContent>

        <TabsContent value="support-resistance">
          <SupportResistanceChart refreshTrigger={_refreshTrigger} />
        </TabsContent>

        <TabsContent value="data-check" className="space-y-6">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                    <Table className="h-4 w-4" />
                    <CardTitle className="text-base font-semibold">Live Data</CardTitle>
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <span>Show table</span>
                    <Switch 
                        checked={showLiveTable} 
                        onCheckedChange={setShowLiveTable} 
                        className="scale-75 origin-right"
                    />
                </div>
                </CardHeader>
                <CardContent className="space-y-2">
                {!showLiveTable && (
                    <div className="text-xs text-muted-foreground">Table hidden. Enable Show table.</div>
                )}
                {showLiveTable && (
                    <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                        <thead>
                        <tr className="border-b text-[11px] text-muted-foreground">
                            <th className="px-2 py-1 text-left">Symbol</th>
                            <th className="px-2 py-1 text-right">LTP</th>
                            <th className="px-2 py-1 text-right">Volume</th>
                            <th className="px-2 py-1 text-right">OI</th>
                            <th className="px-2 py-1 text-left">Last Updated</th>
                            <th className="px-2 py-1 text-right">Candle Count</th>
                        </tr>
                        </thead>
                        <tbody>
                        {liveRows.length === 0 && (
                            <tr>
                            <td colSpan={6} className="h-24 text-center text-xs text-muted-foreground">
                                No data available. Start the fetcher.
                            </td>
                            </tr>
                        )}
                        {liveRows.map((row) => {
                            const dt = new Date(row.timestamp * 1000)
                            const rawSymbol = (row as any).symbol
                            const symbol = typeof rawSymbol === 'string' ? rawSymbol : ''
                            const isNifty = symbol === 'NIFTY'
                            const isCall = typeof symbol === 'string' && symbol.endsWith('CE')
                            
                            let rowClass = "border-b last:border-0 hover:bg-muted/50 transition-colors"
                            if (isNifty) rowClass += ' bg-blue-500/5'
                            else if (isCall) rowClass += ' bg-emerald-500/5'
                            else rowClass += ' bg-red-500/5'

                            const candleCount =
                            'candle_count' in row && row.candle_count != null
                                ? row.candle_count.toLocaleString('en-IN')
                                : (instrument === 'BANKNIFTY'
                                    ? status?.banknifty_record_count?.toLocaleString('en-IN')
                                    : status?.nifty_record_count?.toLocaleString('en-IN')) ?? '0'
                            
                            return (
                            <tr key={`${symbol}-${row.timestamp}`} className={rowClass}>
                                <td className="px-2 py-1 font-mono font-medium">{symbol}</td>
                                <td className="px-2 py-1 text-right">{row.close.toFixed(2)}</td>
                                <td className="px-2 py-1 text-right">
                                {'volume' in row ? row.volume.toLocaleString('en-IN') : '-'}
                                </td>
                                <td className="px-2 py-1 text-right">
                                {row.oi != null ? row.oi.toLocaleString('en-IN') : '-'}
                                </td>
                                <td className="px-2 py-1 text-left">{dt.toLocaleTimeString()}</td>
                                <td className="px-2 py-1 text-right">{candleCount}</td>
                            </tr>
                            )
                        })}
                        </tbody>
                    </table>
                    </div>
                )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                    <Table className="h-4 w-4" />
                    <CardTitle className="text-base font-semibold">Previous Day Closing Analysis</CardTitle>
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <span>Show table</span>
                    <Switch 
                        checked={showPrevDayTable} 
                        onCheckedChange={setShowPrevDayTable} 
                        className="scale-75 origin-right"
                    />
                </div>
                </CardHeader>
                <CardContent className="space-y-2">
                {!showPrevDayTable && (
                    <div className="flex items-center justify-center h-20 text-xs text-muted-foreground bg-muted/10 rounded-md border border-dashed">
                    Table hidden. Enable Show table.
                    </div>
                )}
                {showPrevDayTable && (
                    <div className="rounded-md border">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b bg-muted/50 text-[11px] font-medium text-muted-foreground">
                            <th className="h-8 px-3 text-left">Symbol</th>
                            <th className="h-8 px-3 text-right">Prev. Close</th>
                            <th className="h-8 px-3 text-right">Prev. OI</th>
                            <th className="h-8 px-3 text-right">Current OI</th>
                            <th className="h-8 px-3 text-right">Session Change</th>
                            <th className="h-8 px-3 text-right">3Min Change</th>
                            <th className="h-8 px-3 text-right">6Min Change</th>
                            <th className="h-8 px-3 text-left">Timestamp</th>
                            </tr>
                        </thead>
                        <tbody>
                            {prevDayOi.length === 0 && (
                            <tr>
                                <td colSpan={8} className="h-24 text-center text-xs text-muted-foreground">
                                No previous day data available yet.
                                </td>
                            </tr>
                            )}
                            {prevDayOi
                            .slice()
                            .sort((a, b) => a.symbol.localeCompare(b.symbol))
                            .map((row) => {
                                const dt = new Date(row.timestamp * 1000)
                                const symbol = row.symbol || ''
                                const isCall = typeof symbol === 'string' && symbol.endsWith('CE')
                                const isPut = typeof symbol === 'string' && symbol.endsWith('PE')
                                
                                let rowClass = "border-b last:border-0 hover:bg-muted/50 transition-colors"
                                if (isCall) rowClass += ' bg-emerald-500/5'
                                else if (isPut) rowClass += ' bg-red-500/5'
                                else rowClass += ' bg-blue-500/5'

                                const formatChangeStyle = (value: number): React.CSSProperties =>
                                value > 0 ? { color: madhanMode === 'dark' ? '#34d399' : '#059669', fontWeight: 500 } : value < 0 ? { color: madhanMode === 'dark' ? '#f87171' : '#dc2626', fontWeight: 500 } : { color: undefined }
                                
                                const formatChangeText = (value: number) => {
                                if (!value) return '0'
                                const sign = value > 0 ? '+' : ''
                                return `${sign}${value.toLocaleString('en-IN')}`
                                }
                                return (
                                <tr key={`${symbol}-${row.timestamp}`} className={rowClass}>
                                    <td className="p-2 px-3 font-mono font-medium">{symbol}</td>
                                    <td className="p-2 px-3 text-right">{row.close.toFixed(2)}</td>
                                    <td className="p-2 px-3 text-right font-mono">
                                    {(row.oi || 0).toLocaleString('en-IN')}
                                    </td>
                                    <td className="p-2 px-3 text-right font-mono">
                                    {(row.current_oi || 0).toLocaleString('en-IN')}
                                    </td>
                                    <td className="p-2 px-3 text-right" style={formatChangeStyle(row.change_in_oi)}>
                                    {formatChangeText(row.change_in_oi)}
                                    </td>
                                    <td
                                    className="p-2 px-3 text-right"
                                    style={formatChangeStyle(
                                        row.change_in_oi_3min,
                                    )}
                                    >
                                    {formatChangeText(row.change_in_oi_3min)}
                                    </td>
                                    <td
                                    className="p-2 px-3 text-right"
                                    style={formatChangeStyle(
                                        row.change_in_oi_6min,
                                    )}
                                    >
                                    {formatChangeText(row.change_in_oi_6min)}
                                    </td>
                                    <td className="p-2 px-3 text-left text-muted-foreground">{dt.toLocaleTimeString()}</td>
                                </tr>
                                )
                            })}
                        </tbody>
                        </table>
                    </div>
                    </div>
                )}
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="signal-settings">
          <Card>
            <CardContent className="pt-4 space-y-1">
              <div className="flex items-center justify-between py-1">
                <span className="text-sm font-medium">Notifications</span>
                <Switch
                  checked={alertStore.categories.madhan}
                  onCheckedChange={(checked) => alertStore.setCategoryEnabled('madhan', checked)}
                />
              </div>
              {alertStore.categories.madhan && (
                <>
                  <div className="flex items-center justify-between py-1 pl-3 border-l-2">
                    <span className="text-sm">ATP-LTP Signal</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">NY</span>
                      <Switch
                        checked={atp_ltp_nifty}
                        onCheckedChange={(checked) => setToggle('atp_ltp_nifty', checked)}
                      />
                      <span className="text-[10px] text-muted-foreground">BN</span>
                      <Switch
                        checked={atp_ltp_banknifty}
                        onCheckedChange={(checked) => setToggle('atp_ltp_banknifty', checked)}
                      />
                      <div className="w-px h-4 bg-border" />
                      <Switch
                        checked={atp_ltp_signal}
                        onCheckedChange={(checked) => setToggle('atp_ltp_signal', checked)}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-1 pl-3 border-l-2">
                    <span className="text-sm">Volume Spike</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">NY</span>
                      <Switch
                        checked={volume_spike_nifty}
                        onCheckedChange={(checked) => setToggle('volume_spike_nifty', checked)}
                      />
                      <span className="text-[10px] text-muted-foreground">BN</span>
                      <Switch
                        checked={volume_spike_banknifty}
                        onCheckedChange={(checked) => setToggle('volume_spike_banknifty', checked)}
                      />
                      <div className="w-px h-4 bg-border" />
                      <Switch
                        checked={volume_spike}
                        onCheckedChange={(checked) => setToggle('volume_spike', checked)}
                      />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fut-stocks">
          <FutStocks refreshTrigger={_refreshTrigger} />
        </TabsContent>
      </Tabs>
    </div>
    </div>
  )
}
