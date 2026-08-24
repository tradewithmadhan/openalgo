import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { 
  AlertTriangle, 
  BarChart3, 
  RefreshCw, 
  Table, 
  Menu, 
  Zap, 
  Sun, 
  Moon, 
  Home,
  TrendingUp,
  Clock
} from 'lucide-react'
import { showToast } from '@/utils/toast'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useMarketData } from '@/hooks/useMarketData'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { useMadhanTheme } from './useMadhanTheme'
import { useInstrument, InstrumentProvider, type Instrument } from './InstrumentContext'
import Plot from '@/lib/Plot2D'

interface ATPLTPData {
  time: string
  spot_ltp: number | null
  spot_sma_signal?: boolean
  atm_strike: number
  atm_call_atp: number | null
  atm_call_ltp: number | null
  atm_call_atp_ltp_diff: number
  atm_put_atp: number | null
  atm_put_ltp: number | null
  atm_put_atp_ltp_diff: number
  call_atp_signal: boolean
  put_atp_signal: boolean
  call_sma_signal?: boolean
  put_sma_signal?: boolean
  final_signal?: string
}

export default function ATPLTPStrategy() {
  return (
    <InstrumentProvider>
      <ATPLTPStrategyInner />
    </InstrumentProvider>
  );
}

function ATPLTPStrategyInner() {
  const { instrument, setInstrument } = useInstrument();
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { appMode, toggleAppMode, isTogglingMode } = useThemeStore()
  const { mode: madhanMode, toggleMode: toggleMadhanMode, style: madhanStyle } = useMadhanTheme()
  const profileMenuItems = useProfileMenuItems()
  
  const [atpLtpData, setAtpLtpData] = useState<ATPLTPData[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [chartView, setChartView] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState({
    time: true,
    spot_ltp: true,
    spot_sma_signal: true,
    atm_strike: true,
    atm_call_atp: true,
    atm_call_ltp: true,
    call_atp_diff: true,
    call_atp_signal: true,
    call_sma_signal: true,
    atm_put_atp: true,
    atm_put_ltp: true,
    put_atp_diff: true,
    put_atp_signal: true,
    put_sma_signal: true,
    final_signal: true,
  })

  const [fetcherRunning, setFetcherRunning] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const liveSpotRef = useRef(0)
  const [liveSpot, setLiveSpot] = useState(0)

  const wsSymbols = useMemo(() => fetcherRunning ? [{ symbol: instrument, exchange: 'NSE_INDEX' }] : [], [fetcherRunning, instrument])

  const { data: wsData } = useMarketData({ symbols: wsSymbols, mode: 'LTP' })

  const columnConfig = [
    { key: 'time', label: 'Time' },
    { key: 'spot_ltp', label: 'Spot LTP' },
    { key: 'spot_sma_signal', label: 'Spot SMA Signal' },
    { key: 'atm_strike', label: 'ATM Strike' },
    { key: 'atm_call_atp', label: 'ATM Call ATP' },
    { key: 'atm_call_ltp', label: 'ATM Call LTP' },
    { key: 'call_atp_diff', label: 'Call (ATP-LTP)' },
    { key: 'call_atp_signal', label: 'Call ATP Signal' },
    { key: 'call_sma_signal', label: 'Call SMA Signal' },
    { key: 'atm_put_atp', label: 'ATM Put ATP' },
    { key: 'atm_put_ltp', label: 'ATM Put LTP' },
    { key: 'put_atp_diff', label: 'Put (ATP-LTP)' },
    { key: 'put_atp_signal', label: 'Put ATP Signal' },
    { key: 'put_sma_signal', label: 'Put SMA Signal' },
    { key: 'final_signal', label: 'Final Signal' },
  ] as const

  const toggleColumn = (key: keyof typeof visibleColumns, checked: boolean) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: checked }))
  }

  const getSignalStyle = (value?: string): React.CSSProperties => {
    const dark = madhanMode === 'dark'
    switch (value) {
      case 'Bullish':
        return dark ? { backgroundColor: '#14532d', color: '#bbf7d0' } : { backgroundColor: '#dcfce7', color: '#166534' }
      case 'Bearish':
        return dark ? { backgroundColor: '#7f1d1d', color: '#fecaca' } : { backgroundColor: '#fee2e2', color: '#991b1b' }
      case 'Sideways':
        return dark ? { backgroundColor: '#713f12', color: '#fef08a' } : { backgroundColor: '#fef9c3', color: '#854d0e' }
      case 'Neutral':
        return dark ? { backgroundColor: '#1e2128', color: '#787b86' } : { backgroundColor: '#f5f5f5', color: '#787b86' }
      default:
        return {}
    }
  }

  const getSignalTrueStyle = (isTrue: boolean): React.CSSProperties => {
    if (!isTrue) return {}
    const dark = madhanMode === 'dark'
    return dark ? { backgroundColor: '#14532d', color: '#bbf7d0' } : { backgroundColor: '#dcfce7', color: '#166534' }
  }

  const fetchATPLTPData = useCallback(async () => {
    try {
      setError(null)
      const response = await fetch(`/madhan/api/atp-ltp-data?instrument=${instrument}&_=${Date.now()}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })

      if (!response.ok) {
        setError('Failed to fetch ATP-LTP data')
        return
      }

      const data = await response.json()
      if (data.status === 'success' && Array.isArray(data.data)) {
        setAtpLtpData(data.data as ATPLTPData[])
      } else {
        setError(data.message || 'Failed to fetch ATP-LTP data')
      }
    } catch (_e) {
      setError('Failed to fetch ATP-LTP data')
    }
  }, [instrument])

  const refreshData = useCallback(async () => {
    setIsRefreshing(true)
    await fetchATPLTPData()
    setIsRefreshing(false)
  }, [fetchATPLTPData])

  const timeOffsetRef = useRef(0)

  useEffect(() => {
    fetchATPLTPData()

    let timer: ReturnType<typeof setTimeout>
    let pollInterval: ReturnType<typeof setInterval>
    let isFetching = false
    const getServerNow = () => new Date(Date.now() + timeOffsetRef.current)

    const fetchStatusAndCheck = async () => {
      if (isFetching) return
      isFetching = true
      try {
        const res = await fetch(`/madhan/api/nifty/status?instrument=${instrument}&_=${Date.now()}`)
        const json = await res.json()
        if (json?.status === 'success' && json?.server_time) {
          const serverMs = new Date(json.server_time).getTime()
          timeOffsetRef.current = serverMs - Date.now()
        }
        if (!json?.is_running) {
          setFetcherRunning(false)
          setStatusMessage(json?.message || 'Stopped')
          clearInterval(pollInterval)
          return
        }
        if (json?.status === 'success' && json?.is_running && json?.last_update) {
          setFetcherRunning(true)
          setStatusMessage(json?.message || 'Running')
          const lastUpdate = new Date(json.last_update)
          const serverNow = getServerNow()
          if (lastUpdate.getMinutes() === serverNow.getMinutes()) {
            await fetchATPLTPData()
            clearInterval(pollInterval)
            scheduleNextMinute()
          }
        }
      } catch {} finally {
        isFetching = false
      }
    }

    const scheduleNextMinute = () => {
      clearTimeout(timer)
      const now = getServerNow()
      const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
      timer = setTimeout(() => {
        pollInterval = setInterval(fetchStatusAndCheck, 1000)
      }, Math.max(0, msToNextMinute))
    }

    fetchStatusAndCheck()
    scheduleNextMinute()
    return () => { clearTimeout(timer); clearInterval(pollInterval) }
  }, [fetchATPLTPData, instrument])

  useEffect(() => {
    if (!wsData || wsData.size === 0) return
    const spotEntry = wsData.get(`NSE_INDEX:${instrument}`)
    const spotLtp = spotEntry?.data?.ltp
    if (spotLtp) {
      liveSpotRef.current = spotLtp
      setLiveSpot(spotLtp)
    }
  }, [wsData])

  const formatNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-'
    return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const toISTISOString = (ts: number) => {
    const istOffset = 5.5 * 60 * 60 * 1000
    const istDate = new Date(ts + istOffset)
    const y = istDate.getUTCFullYear()
    const m = String(istDate.getUTCMonth() + 1).padStart(2, '0')
    const d = String(istDate.getUTCDate()).padStart(2, '0')
    const h = String(istDate.getUTCHours()).padStart(2, '0')
    const mi = String(istDate.getUTCMinutes()).padStart(2, '0')
    const s = String(istDate.getUTCSeconds()).padStart(2, '0')
    return `${y}-${m}-${d}T${h}:${mi}:${s}+05:30`
  }

  const formatTime = (timeStr: string) => {
    try {
      const date = new Date(timeStr)
      return date.toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    } catch {
      return timeStr
    }
  }

  const sortedData = [...atpLtpData].sort((a, b) => {
    const aTime = new Date(a.time).getTime()
    const bTime = new Date(b.time).getTime()
    return bTime - aTime
  })

  const { plotData, plotLayout } = useMemo(() => {
    const asc = [...atpLtpData].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    const dark = madhanMode === 'dark'

    // Build segments by grouping consecutive same-signal points
    const segments: { x: number[]; y: (number|null)[]; color: string }[] = []
    let currentSegment: { x: number[]; y: (number|null)[]; color: string } | null = null

    const getLineColor = (signal?: string) => {
      switch (signal) {
        case 'Bullish': return '#22c55e'
        case 'Bearish': return '#ef4444'
        case 'Sideways': return '#eab308'
        default: return '#6b7280'
      }
    }

    for (let i = 0; i < asc.length; i++) {
      const ts = new Date(asc[i].time).getTime()
      const val = asc[i].spot_ltp ?? null
      const color = getLineColor(asc[i].final_signal)

      if (!currentSegment || currentSegment.color !== color) {
        if (currentSegment && currentSegment.x.length > 0) segments.push(currentSegment)
        currentSegment = { x: [], y: [], color }
      }
      // Overlap last point of previous segment for continuity
      if (currentSegment.x.length === 0 && segments.length > 0) {
        const prev = segments[segments.length - 1]
        currentSegment.x.push(prev.x[prev.x.length - 1])
        currentSegment.y.push(prev.y[prev.y.length - 1])
      }
      currentSegment.x.push(ts)
      currentSegment.y.push(val)
    }
    if (currentSegment && currentSegment.x.length > 0) segments.push(currentSegment)

    // Build traces from segments
    const traces: any[] = segments.map((seg, i) => ({
      x: seg.x.map(t => toISTISOString(t)),
      y: seg.y,
      type: 'scatter',
      mode: 'lines',
      line: { color: seg.color, width: 2 },
      showlegend: i === 0,
      legendgroup: 'spot',
      name: 'Spot LTP',
      hoverinfo: 'x+y',
    }))

    // Signal dot markers (separate trace for all points with trade_signal)
    const dotX: string[] = []
    const dotY: (number|null)[] = []
    const dotColors: string[] = []
    const dotText: string[] = []

    const annotations: any[] = []

    for (let i = 0; i < asc.length; i++) {
      if (!(asc[i] as any).trade_signal) continue
      const ts = toISTISOString(new Date(asc[i].time).getTime())
      const sig = asc[i].final_signal
      const isBullish = sig === 'Bullish'
      dotX.push(ts)
      dotY.push(asc[i].spot_ltp ?? 0)
      dotColors.push(isBullish ? '#22c55e' : '#ef4444')

      const label = `${asc[i].atm_strike} ${isBullish ? 'Call' : 'Put'}<br>${formatNumber(isBullish ? asc[i].atm_call_ltp : asc[i].atm_put_ltp)}<br>${(() => {
        try { return new Date(asc[i].time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) }
        catch { return '' }
      })()}`
      const yVal = asc[i].spot_ltp ?? 0
      const isUp = isBullish

      annotations.push({
        x: ts,
        y: yVal,
        xref: 'x',
        yref: 'y',
        text: label,
        showarrow: true,
        arrowhead: 2,
        arrowsize: 1,
        arrowwidth: 2,
        arrowcolor: isBullish ? '#22c55e' : '#ef4444',
        ax: 0,
        ay: isUp ? 50 : -50,
        font: { size: 10, color: isBullish ? '#22c55e' : '#ef4444', family: 'monospace' },
        bgcolor: dark ? '#1e2128' : '#ffffff',
        bordercolor: isBullish ? '#22c55e' : '#ef4444',
        borderwidth: 1,
        borderpad: 2,
      })
    }

    if (dotX.length > 0) {
      traces.push({
        x: dotX,
        y: dotY,
        type: 'scatter',
        mode: 'markers',
        marker: { color: dotColors, size: 8, symbol: 'triangle-up' },
        showlegend: false,
        hoverinfo: 'text',
        text: dotText.length > 0 ? dotText : undefined,
      })
    }

    // Live spot point
    if (liveSpot > 0) {
      const now = toISTISOString(Date.now() + timeOffsetRef.current)
      traces.push({
        x: [now],
        y: [liveSpot],
        type: 'scatter',
        mode: 'markers',
        marker: { color: '#3b82f6', size: 6, symbol: 'circle' },
        showlegend: false,
        name: 'Live',
        hoverinfo: 'x+y',
      })
    }

    const layout: any = {
      autosize: true,
      margin: { l: 60, r: 20, t: 30, b: 50 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: dark ? '#d1d4dc' : '#131722' },
      xaxis: {
        type: 'date',
        tickformat: '%H:%M',
        hoverformat: '%H:%M:%S IST',
        tickangle: -45,
        title: { text: 'Time' },
        gridcolor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
        nticks: 30,
        timezone: 'Asia/Kolkata',
      },
      yaxis: {
        title: { text: 'Spot LTP' },
        gridcolor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
        automargin: true,
        tickformat: ',d',
        hoverformat: ',d',
        dtick: instrument === 'BANKNIFTY' ? 200 : 50,
      },
      hovermode: 'x unified',
      legend: { orientation: 'h', y: 1.02, x: 0.5, xanchor: 'center' },
      annotations,
    }

    return { plotData: traces, plotLayout: layout }
  }, [atpLtpData, liveSpot, madhanMode, timeOffsetRef.current])

  const getChangeStyle = (current: number | null | undefined, previous: number | null | undefined): React.CSSProperties => {
    if (previous === null || previous === undefined || current === null || current === undefined) return {}
    const dark = madhanMode === 'dark'
    if (current > previous) return { color: dark ? '#4ade80' : '#16a34a' }
    if (current < previous) return { color: dark ? '#f87171' : '#dc2626' }
    return {}
  }

  const getChangeIcon = (current: number | null | undefined, previous: number | null | undefined) => {
    if (previous === null || previous === undefined || current === null || current === undefined) return null
    if (current > previous) return '↗'
    if (current < previous) return '↘'
    return '→'
  }

  return (
    <div className={cn("h-full flex flex-col text-foreground madhan-theme", madhanMode === 'dark' ? 'dark' : 'madhan-light')} style={{ ...madhanStyle, backgroundColor: madhanMode === 'dark' ? '#131722' : '#ffffff', color: madhanMode === 'dark' ? '#d1d4dc' : '#131722' }}>
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
      
      <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-6 w-6" />
            ATP-LTP Strategy
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>Real-time ATP and LTP data</span>
            </div>
            <span className="text-muted-foreground/30">|</span>
            <div className="flex items-center gap-1">
               <span className="text-sm" style={{ color: fetcherRunning ? (madhanMode === 'dark' ? '#4ade80' : '#16a34a') : (madhanMode === 'dark' ? '#f87171' : '#dc2626') }}>
                 {statusMessage}
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
                    "px-2.5 py-1 text-[11px] font-medium rounded transition-colors",
                    instrument === inst
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {inst}
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <div className="flex gap-2">
           <Button 
              variant={chartView ? "default" : "outline"} 
              size="sm" 
              onClick={() => setChartView(!chartView)}
           >
              <BarChart3 className="mr-2 h-3 w-3" />
              {chartView ? 'Table View' : 'Chart View'}
           </Button>
           <Button 
              variant="outline" 
              size="sm" 
              onClick={refreshData}
              disabled={isRefreshing}
           >
              <RefreshCw className={`mr-2 h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
           </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="ml-2">{error}</AlertDescription>
        </Alert>
      )}

      {chartView ? (
        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              ATP-LTP Chart
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[calc(100vh-12rem)]">
            {atpLtpData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No data available</div>
            ) : (
              <Plot
                data={plotData}
                layout={plotLayout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: '100%' }}
                useResizeHandler
              />
            )}
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Table className="h-4 w-4" />
              ATP-LTP Data Table
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">Columns</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {columnConfig.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={visibleColumns[col.key]}
                    onCheckedChange={(checked) => toggleColumn(col.key, Boolean(checked))}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          {atpLtpData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No data available
            </div>
          ) : (
            <div className="rounded-md border">
              <UITable>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.time && <TableHead className="w-[120px]">Time</TableHead>}
                    {visibleColumns.spot_ltp && <TableHead className="text-right">Spot LTP</TableHead>}
                    {visibleColumns.spot_sma_signal && <TableHead className="text-right">Spot SMA Signal</TableHead>}
                    {visibleColumns.atm_strike && <TableHead className="text-right">ATM Strike</TableHead>}
                    {visibleColumns.atm_call_atp && <TableHead className="text-right">ATM Call ATP</TableHead>}
                    {visibleColumns.atm_call_ltp && <TableHead className="text-right">ATM Call LTP</TableHead>}
                    {visibleColumns.call_atp_diff && <TableHead className="text-right">Call (ATP-LTP)</TableHead>}
                    {visibleColumns.call_atp_signal && <TableHead className="text-right">Call ATP Signal</TableHead>}
                    {visibleColumns.call_sma_signal && <TableHead className="text-right">Call SMA Signal</TableHead>}
                    {visibleColumns.atm_put_atp && <TableHead className="text-right">ATM Put ATP</TableHead>}
                    {visibleColumns.atm_put_ltp && <TableHead className="text-right">ATM Put LTP</TableHead>}
                    {visibleColumns.put_atp_diff && <TableHead className="text-right">Put (ATP-LTP)</TableHead>}
                    {visibleColumns.put_atp_signal && <TableHead className="text-right">Put ATP Signal</TableHead>}
                    {visibleColumns.put_sma_signal && <TableHead className="text-right">Put SMA Signal</TableHead>}
                    {visibleColumns.final_signal && <TableHead className="text-right">Final Signal</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedData.map((row, index) => {
                    const prevRow = index < sortedData.length - 1 ? sortedData[index + 1] : null
                    
                    return (
                      <TableRow key={`${row.time}-${index}`}>
                        {visibleColumns.time && (
                          <TableCell className="font-mono text-xs">
                            {formatTime(row.time)}
                          </TableCell>
                        )}
                        {visibleColumns.spot_ltp && (
                          <TableCell className="text-right font-mono" style={getChangeStyle(row.spot_ltp, prevRow?.spot_ltp)}>
                            {formatNumber(row.spot_ltp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.spot_ltp, prevRow?.spot_ltp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.spot_sma_signal && (
                          <TableCell className="text-center font-mono" style={getSignalTrueStyle(!!row.spot_sma_signal)}>
                            {row.spot_sma_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.atm_strike && (
                          <TableCell className="text-right font-mono" style={getChangeStyle(row.atm_strike, prevRow?.atm_strike)}>
                            {formatNumber(row.atm_strike)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_strike, prevRow?.atm_strike)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.atm_call_atp && (
                          <TableCell className="text-right font-mono" style={getChangeStyle(row.atm_call_atp, prevRow?.atm_call_atp)}>
                            {formatNumber(row.atm_call_atp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_call_atp, prevRow?.atm_call_atp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.atm_call_ltp && (
                          <TableCell className="text-right font-mono" style={getChangeStyle(row.atm_call_ltp, prevRow?.atm_call_ltp)}>
                            {formatNumber(row.atm_call_ltp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_call_ltp, prevRow?.atm_call_ltp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.call_atp_diff && (
                          <TableCell className="text-right font-mono" style={getChangeStyle(row.atm_call_atp_ltp_diff, prevRow?.atm_call_atp_ltp_diff)}>
                            {formatNumber(row.atm_call_atp_ltp_diff)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_call_atp_ltp_diff, prevRow?.atm_call_atp_ltp_diff)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.call_atp_signal && (
                          <TableCell className="text-center font-mono" style={getSignalTrueStyle(!!row.call_atp_signal)}>
                            {row.call_atp_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.call_sma_signal && (
                          <TableCell className="text-center font-mono" style={getSignalTrueStyle(!!row.call_sma_signal)}>
                            {row.call_sma_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.atm_put_atp && (
                          <TableCell className="text-right font-mono" style={getChangeStyle(row.atm_put_atp, prevRow?.atm_put_atp)}>
                            {formatNumber(row.atm_put_atp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_put_atp, prevRow?.atm_put_atp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.atm_put_ltp && (
                          <TableCell className="text-right font-mono" style={getChangeStyle(row.atm_put_ltp, prevRow?.atm_put_ltp)}>
                            {formatNumber(row.atm_put_ltp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_put_ltp, prevRow?.atm_put_ltp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.put_atp_diff && (
                          <TableCell className="text-right font-mono" style={getChangeStyle(row.atm_put_atp_ltp_diff, prevRow?.atm_put_atp_ltp_diff)}>
                            {formatNumber(row.atm_put_atp_ltp_diff)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_put_atp_ltp_diff, prevRow?.atm_put_atp_ltp_diff)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.put_atp_signal && (
                          <TableCell className="text-center font-mono" style={getSignalTrueStyle(!!row.put_atp_signal)}>
                            {row.put_atp_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.put_sma_signal && (
                          <TableCell className="text-center font-mono" style={getSignalTrueStyle(!!row.put_sma_signal)}>
                            {row.put_sma_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.final_signal && (
                          <TableCell className="text-center font-mono" style={getSignalStyle(row.final_signal)}>
                            {row.final_signal || ""}
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </UITable>
            </div>
          )}
        </CardContent>
      </Card>
      )}
      </div>
    </div>
  )
}
