import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
import { toast } from 'sonner'
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
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

type AnnotationPoint = {
  index: number
  label: string
  yValue: number
  color: string
  direction: 'up' | 'down'
}

const signalArrowPlugin = {
  id: 'signalArrow',
  afterDraw(chart: any) {
    const annotations: AnnotationPoint[] = chart.options?.plugins?.signalArrow?.annotations
    if (!annotations || annotations.length === 0) return
    const ctx = chart.ctx
    const xScale = chart.scales.x
    const yScale = chart.scales.y

    for (const ann of annotations) {
      const x = xScale.getPixelForValue(ann.index)
      const y = yScale.getPixelForValue(ann.yValue)
      const arrowSize = 10

      ctx.save()
      ctx.fillStyle = ann.color
      ctx.strokeStyle = ann.color
      ctx.lineWidth = 2
      ctx.font = 'bold 11px monospace'
      ctx.textAlign = 'center'

      const lines = ann.label.split('\n')
      const lineGap = 13

      if (ann.direction === 'up') {
        // Arrow below the point pointing up
        const tipY = y + 18
        const baseY = tipY + arrowSize
        ctx.beginPath()
        ctx.moveTo(x, tipY)
        ctx.lineTo(x - arrowSize / 2, baseY)
        ctx.lineTo(x + arrowSize / 2, baseY)
        ctx.closePath()
        ctx.fill()
        lines.forEach((line, li) => {
          ctx.fillText(line, x, baseY + 14 + li * lineGap)
        })
      } else {
        // Arrow above the point pointing down
        const tipY = y - 18
        const baseY = tipY - arrowSize
        ctx.beginPath()
        ctx.moveTo(x, tipY)
        ctx.lineTo(x - arrowSize / 2, baseY)
        ctx.lineTo(x + arrowSize / 2, baseY)
        ctx.closePath()
        ctx.fill()
        lines.forEach((line, li) => {
          ctx.fillText(line, x, baseY - 6 - (lines.length - 1 - li) * lineGap)
        })
      }

      ctx.restore()
    }
  },
}

ChartJS.register(signalArrowPlugin)

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
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { mode, toggleMode, appMode, toggleAppMode, isTogglingMode } = useThemeStore()
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

  const getFinalSignalClass = (value?: string) => {
    switch (value) {
      case 'Bullish':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'Bearish':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      case 'Sideways':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
      case 'Neutral':
        return 'bg-muted text-muted-foreground'
      default:
        return ''
    }
  }

  const fetchATPLTPData = useCallback(async () => {
    try {
      setError(null)
      const response = await fetch(`/madhan/api/atp-ltp-data?_=${Date.now()}`, {
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
  }, [])

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
        const res = await fetch(`/madhan/api/nifty/status?_=${Date.now()}`)
        const json = await res.json()
        if (json?.status === 'success' && json?.server_time) {
          const serverMs = new Date(json.server_time).getTime()
          timeOffsetRef.current = serverMs - Date.now()
        }
        if (!json?.is_running) {
          clearInterval(pollInterval)
          return
        }
        if (json?.status === 'success' && json?.is_running && json?.last_update) {
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
      const now = getServerNow()
      const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
      timer = setTimeout(() => {
        pollInterval = setInterval(fetchStatusAndCheck, 1000)
        fetchStatusAndCheck()
      }, Math.max(0, msToNextMinute))
    }

    fetchStatusAndCheck()
    scheduleNextMinute()
    return () => { clearTimeout(timer); clearInterval(pollInterval) }
  }, [fetchATPLTPData])

  const formatNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-'
    return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const formatTime = (timeStr: string) => {
    try {
      const date = new Date(timeStr)
      return date.toLocaleTimeString('en-IN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
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

  const chartData = (() => {
    const asc = [...atpLtpData].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    const labels = asc.map((r) => {
      try {
        return new Date(r.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      } catch { return r.time }
    })
    const spotValues = asc.map((r) => r.spot_ltp ?? null)
    const pointColors = asc.map((r) => {
      switch (r.final_signal) {
        case 'Bullish': return '#22c55e'
        case 'Bearish': return '#ef4444'
        case 'Sideways': return '#eab308'
        default: return '#6b7280'
      }
    })

    // Compute signal arrow annotations: after 2+ consecutive sideways, 2nd consecutive bullish/bearish
    // Signal Arrow Annotation Logic:
    // 1. Requires minimum 2 consecutive "Sideways" signals before arming
    // 2. After armed, wait for 2nd consecutive "Bullish" or "Bearish"
    // 3. Bullish: green arrow below with Strike + Call LTP
    // 4. Bearish: red arrow above with Strike + Put LTP
    // 5. Any other signal resets the count
    const annotations: AnnotationPoint[] = []
    const dotIndices = new Set<number>()
    let sidewaysCount = 0
    let consecutiveCount = 0
    let lastDirection: 'Bullish' | 'Bearish' | '' = ''

    for (let i = 0; i < asc.length; i++) {
      const sig = asc[i].final_signal
      if (sig === 'Sideways') {
        sidewaysCount++
        consecutiveCount = 0
        lastDirection = ''
        continue
      }
      if (sig === 'Bullish' || sig === 'Bearish') {
        if (sidewaysCount < 2) {
          sidewaysCount = 0
          consecutiveCount = 0
          lastDirection = sig
          continue
        }
        if (sig !== lastDirection) {
          lastDirection = sig
          consecutiveCount = 1
        } else {
          consecutiveCount++
        }
        // Show dots on 1st and 2nd consecutive after sideways
        if (consecutiveCount <= 2) {
          dotIndices.add(i)
        }
        if (consecutiveCount === 2) {
          const isBullish = sig === 'Bullish'
          const strike = asc[i].atm_strike
          const ltp = isBullish ? asc[i].atm_call_ltp : asc[i].atm_put_ltp
          const timeLabel = (() => {
            try { return new Date(asc[i].time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }
            catch { return '' }
          })()
          annotations.push({
            index: i,
            label: `${strike} ${isBullish ? 'Call' : 'Put'}\n${formatNumber(ltp)}\n${timeLabel}`,
            yValue: asc[i].spot_ltp ?? 0,
            color: isBullish ? '#22c55e' : '#ef4444',
            direction: isBullish ? 'up' : 'down',
          })
          sidewaysCount = 0
        }
      } else {
        sidewaysCount = 0
      }
    }

    return {
      labels,
      datasets: [
        {
          label: 'Spot LTP',
          data: spotValues,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          borderWidth: 2,
          pointRadius: spotValues.map((_, i) => dotIndices.has(i) ? 4 : 0),
          pointBackgroundColor: pointColors,
          pointBorderColor: pointColors,
          pointHoverRadius: 5,
          tension: 0.1,
          fill: false,
          segment: {
            borderColor: (ctx: any) => {
              const i = ctx.p0DataIndex
              const sig = asc[i]?.final_signal
              switch (sig) {
                case 'Bullish': return '#22c55e'
                case 'Bearish': return '#ef4444'
                case 'Sideways': return '#eab308'
                default: return '#6b7280'
              }
            },
          },
        },
      ],
      _annotations: annotations,
    }
  })()

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top' as const },
      signalArrow: { annotations: (chartData as any)._annotations || [] },
      tooltip: {
        callbacks: {
          afterLabel: (ctx: any) => {
            const idx = ctx.dataIndex
            const asc = [...atpLtpData].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
            const row = asc[idx]
            if (!row) return ''
            return `Signal: ${row.final_signal || '-'}`
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: 'Time' },
        ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 30 },
      },
      y: {
        title: { display: true, text: 'Spot LTP' },
      },
    },
  }

  const getChangeColor = (current: number | null | undefined, previous: number | null | undefined) => {
    if (previous === null || previous === undefined || current === null || current === undefined) return 'text-muted-foreground'
    if (current > previous) return 'text-green-600 dark:text-green-400'
    if (current < previous) return 'text-red-600 dark:text-red-400'
    return 'text-muted-foreground'
  }

  const getChangeIcon = (current: number | null | undefined, previous: number | null | undefined) => {
    if (previous === null || previous === undefined || current === null || current === undefined) return null
    if (current > previous) return '↗'
    if (current < previous) return '↘'
    return '→'
  }

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
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
                        toast.success(result.message || `Switched to ${appMode === "live" ? "Analyze" : "Live"} mode`)
                    } else {
                        toast.error(result.message || "Failed to toggle mode")
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
                onClick={toggleMode}
                title={
                mode === "light" ? "Switch to dark mode" : "Switch to light mode"
                }
            >
                {mode === "light" ? (
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
               <span className="font-semibold">Auto-refresh:</span>
               <span className="text-primary font-mono">30s</span>
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
              <Line data={chartData} options={chartOptions as any} />
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
                          <TableCell className={cn("text-right font-mono", getChangeColor(row.spot_ltp, prevRow?.spot_ltp))}>
                            {formatNumber(row.spot_ltp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.spot_ltp, prevRow?.spot_ltp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.spot_sma_signal && (
                          <TableCell className={cn("text-center font-mono", row.spot_sma_signal ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "")}>
                            {row.spot_sma_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.atm_strike && (
                          <TableCell className={cn("text-right font-mono", getChangeColor(row.atm_strike, prevRow?.atm_strike))}>
                            {formatNumber(row.atm_strike)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_strike, prevRow?.atm_strike)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.atm_call_atp && (
                          <TableCell className={cn("text-right font-mono", getChangeColor(row.atm_call_atp, prevRow?.atm_call_atp))}>
                            {formatNumber(row.atm_call_atp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_call_atp, prevRow?.atm_call_atp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.atm_call_ltp && (
                          <TableCell className={cn("text-right font-mono", getChangeColor(row.atm_call_ltp, prevRow?.atm_call_ltp))}>
                            {formatNumber(row.atm_call_ltp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_call_ltp, prevRow?.atm_call_ltp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.call_atp_diff && (
                          <TableCell className={cn("text-right font-mono", getChangeColor(row.atm_call_atp_ltp_diff, prevRow?.atm_call_atp_ltp_diff))}>
                            {formatNumber(row.atm_call_atp_ltp_diff)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_call_atp_ltp_diff, prevRow?.atm_call_atp_ltp_diff)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.call_atp_signal && (
                          <TableCell className={cn("text-center font-mono", row.call_atp_signal ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "")}>
                            {row.call_atp_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.call_sma_signal && (
                          <TableCell className={cn("text-center font-mono", row.call_sma_signal ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "")}>
                            {row.call_sma_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.atm_put_atp && (
                          <TableCell className={cn("text-right font-mono", getChangeColor(row.atm_put_atp, prevRow?.atm_put_atp))}>
                            {formatNumber(row.atm_put_atp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_put_atp, prevRow?.atm_put_atp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.atm_put_ltp && (
                          <TableCell className={cn("text-right font-mono", getChangeColor(row.atm_put_ltp, prevRow?.atm_put_ltp))}>
                            {formatNumber(row.atm_put_ltp)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_put_ltp, prevRow?.atm_put_ltp)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.put_atp_diff && (
                          <TableCell className={cn("text-right font-mono", getChangeColor(row.atm_put_atp_ltp_diff, prevRow?.atm_put_atp_ltp_diff))}>
                            {formatNumber(row.atm_put_atp_ltp_diff)}
                            <span className="ml-1 text-xs">
                              {getChangeIcon(row.atm_put_atp_ltp_diff, prevRow?.atm_put_atp_ltp_diff)}
                            </span>
                          </TableCell>
                        )}
                        {visibleColumns.put_atp_signal && (
                          <TableCell className={cn("text-center font-mono", row.put_atp_signal ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "")}>
                            {row.put_atp_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.put_sma_signal && (
                          <TableCell className={cn("text-center font-mono", row.put_sma_signal ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" : "")}>
                            {row.put_sma_signal ? "TRUE" : ""}
                          </TableCell>
                        )}
                        {visibleColumns.final_signal && (
                          <TableCell className={cn("text-center font-mono", getFinalSignalClass(row.final_signal))}>
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
