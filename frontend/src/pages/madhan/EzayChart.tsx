import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from 'lightweight-charts'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BarChart3, Home, Menu, Sun, Moon, Zap, ChevronLeft, ChevronRight } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { cn } from '@/lib/utils'
import { chartTheme } from './chartTheme'
import RealtimeTable from './RealtimeTable'

type OptionDataResponse = {
  status: string
  data?: {
    ce_data: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number; extrinsic_signal?: boolean }>
    pe_data: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number; extrinsic_signal?: boolean }>
    combined_data: Array<{
      time: number
      combined_premium: number
      ce_intrinsic: number
      pe_intrinsic: number
      ce_extrinsic: number
      pe_extrinsic: number
      combined_extrinsic: number
      combined_volume?: number
      cp_ce_signal?: boolean
      combined_extrinsic_signal?: boolean
    }>
    llp: number
    strike: number
    ce_symbol?: string
    pe_symbol?: string
    timezone?: string
  }
}

type AggCandle = { time: number; open: number; high: number; low: number; close: number }
type AggCombined = {
  time: number; combined_premium: number; ce_intrinsic: number; pe_intrinsic: number;
  ce_extrinsic: number; pe_extrinsic: number; combined_extrinsic: number;
  cp_ce_signal?: boolean; combined_extrinsic_signal?: boolean;
}
function aggregateCandles<T extends AggCandle & Record<string, any>>(data: T[], intervalMin: number): T[] {
  if (intervalMin <= 1 || !data.length) return data
  const bucketSec = intervalMin * 60
  const buckets = new Map<number, T>()
  for (const c of data) {
    const bucket = Math.floor(c.time / bucketSec) * bucketSec
    const existing = buckets.get(bucket)
    if (existing) {
      if (c.high > existing.high) existing.high = c.high
      if (c.low < existing.low) existing.low = c.low
      existing.close = c.close
      if ('extrinsic_signal' in c && c.extrinsic_signal) (existing as any).extrinsic_signal = true
      if ('cp_ce_signal' in c && c.cp_ce_signal) (existing as any).cp_ce_signal = true
      if ('combined_extrinsic_signal' in c && c.combined_extrinsic_signal) (existing as any).combined_extrinsic_signal = true
    } else {
      buckets.set(bucket, { ...c })
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time)
}

function aggregateCombined(data: AggCombined[], intervalMin: number): AggCombined[] {
  if (intervalMin <= 1 || !data.length) return data
  const bucketSec = intervalMin * 60
  const buckets = new Map<number, AggCombined>()
  for (const c of data) {
    const bucket = Math.floor(c.time / bucketSec) * bucketSec
    const existing = buckets.get(bucket)
    if (existing) {
      if (c.combined_premium > existing.combined_premium) existing.combined_premium = c.combined_premium
      existing.ce_intrinsic = c.ce_intrinsic
      existing.pe_intrinsic = c.pe_intrinsic
      existing.ce_extrinsic = c.ce_extrinsic
      existing.pe_extrinsic = c.pe_extrinsic
      existing.combined_extrinsic = c.combined_extrinsic
      if (c.cp_ce_signal) existing.cp_ce_signal = true
      if (c.combined_extrinsic_signal) existing.combined_extrinsic_signal = true
    } else {
      buckets.set(bucket, { ...c })
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time)
}

export default function EzayChart() {
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const strikeListRef = useRef<HTMLDivElement | null>(null)
  const ceSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const peSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const combinedSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const llpSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const ceIntrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const peIntrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const ceExtrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const peExtrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const combinedExtrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const volumeRef = useRef<ISeriesApi<any> | null>(null)
  const ceMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const peMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const cpCeMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const combinedExtrinsicMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const updaterRef = useRef<number | null>(null)
  const chartReadyRef = useRef(false)
  const rawDataRef = useRef<OptionDataResponse['data'] | null>(null)

  const chartTypeRef = useRef<'candlestick' | 'line'>('candlestick')
  const intervalRef = useRef('1m')
  const showSignalsRef = useRef(true)

  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick')
  const [interval, setInterval] = useState('1m')
  const [strikes, setStrikes] = useState<number[]>([])
  const [selectedStrike, setSelectedStrike] = useState<string>('')
  const [showIntrinsic, setShowIntrinsic] = useState(true)
  const [showExtrinsic, setShowExtrinsic] = useState(true)
  const [showCombinedAll, setShowCombinedAll] = useState(true)
  const [showSignals, setShowSignals] = useState(true)
  const [chartInfo, setChartInfo] = useState('')
  const [atmStrike, setAtmStrike] = useState<number | null>(null)
  const [strikePanelOpen, setStrikePanelOpen] = useState(true)
  const [showRealtime, setShowRealtime] = useState(false)

  const { mode: themeMode, toggleMode, appMode, toggleAppMode, isTogglingMode } = useThemeStore()
  const t = chartTheme[themeMode]
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const profileMenuItems = useProfileMenuItems()

  const getIntervalMinutes = (val: string) => {
    if (val.endsWith('m')) return Math.max(1, Number(val.slice(0, -1) || '1'))
    return 1
  }

  const getChartColors = useCallback(() => {
    const dark = document.documentElement.classList.contains('dark')
    return {
      background: dark ? '#131722' : '#ffffff',
      textColor: dark ? '#a6adbb' : '#333',
      gridVert: dark ? 'rgba(166,173,187,0.1)' : 'rgba(0,0,0,0.05)',
      gridHorz: dark ? 'rgba(166,173,187,0.1)' : 'rgba(0,0,0,0.05)',
      borderColor: dark ? 'rgba(166,173,187,0.2)' : 'rgba(0,0,0,0.2)',
    }
  }, [])

  const removeAllSeries = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    const refs = [
      ceSeriesRef, peSeriesRef, combinedSeriesRef, llpSeriesRef,
      ceIntrinsicRef, peIntrinsicRef, ceExtrinsicRef, peExtrinsicRef,
      combinedExtrinsicRef, volumeRef,
    ]
    for (const ref of refs) {
      if (ref.current) {
        try { chart.removeSeries(ref.current) } catch {}
        ref.current = null
      }
    }
    ceMarkersRef.current = null
    peMarkersRef.current = null
    cpCeMarkersRef.current = null
    combinedExtrinsicMarkersRef.current = null
  }, [])

  const createAllSeries = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    removeAllSeries()

    const ceDown = '#FF4444'
    const peDown = '#6610F2'
    const ct = chartTypeRef.current

    const makeSeries = (opts: Record<string, any>): ISeriesApi<any> => {
      if (ct === 'candlestick') {
        return chart.addSeries(CandlestickSeries, {
          upColor: '#00C851', downColor: ceDown, borderVisible: false,
          wickUpColor: '#00C851', wickDownColor: ceDown, ...opts,
        })
      }
      return chart.addSeries(LineSeries, {
        lineWidth: 2, priceLineVisible: false, lastValueVisible: false, ...opts,
      })
    }

    ceSeriesRef.current = makeSeries({ title: 'CE Premium', color: '#2962FF' })
    peSeriesRef.current = makeSeries({ title: 'PE Premium', color: '#ff6b6b', downColor: peDown })

    combinedSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#2196f3', lineWidth: 3, title: 'Combined Premium',
      priceLineVisible: false, lastValueVisible: false,
    })
    llpSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#1976d2', lineWidth: 2, title: 'LLP',
      priceLineVisible: false, lastValueVisible: false,
    })
    ceIntrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#4caf50', lineWidth: 1, lineStyle: 1, title: 'CE Intrinsic',
      priceLineVisible: false, lastValueVisible: false,
    })
    peIntrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#ef5350', lineWidth: 1, lineStyle: 1, title: 'PE Intrinsic',
      priceLineVisible: false, lastValueVisible: false,
    })
    ceExtrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#4caf50', lineWidth: 1, title: 'CE Extrinsic',
      priceLineVisible: false, lastValueVisible: false,
    })
    peExtrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#ef5350', lineWidth: 1, title: 'PE Extrinsic',
      priceLineVisible: false, lastValueVisible: false,
    })
    combinedExtrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#ffeb3b', lineWidth: 2, title: 'Combined Extrinsic',
      priceLineVisible: false, lastValueVisible: false,
    })

    volumeRef.current = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    ceMarkersRef.current = createSeriesMarkers(ceSeriesRef.current, [])
    peMarkersRef.current = createSeriesMarkers(peSeriesRef.current, [])
    cpCeMarkersRef.current = createSeriesMarkers(combinedSeriesRef.current, [])
    combinedExtrinsicMarkersRef.current = createSeriesMarkers(combinedExtrinsicRef.current, [])
  }, [removeAllSeries])

  const applyData = useCallback(() => {
    const d = rawDataRef.current
    if (!d) return
    const ct = chartTypeRef.current
    const intervalMin = getIntervalMinutes(intervalRef.current)
    const signals = showSignalsRef.current

    let ceData = d.ce_data || []
    let peData = d.pe_data || []
    let combinedData = d.combined_data || []

    if (intervalMin > 1) {
      ceData = aggregateCandles(ceData, intervalMin)
      peData = aggregateCandles(peData, intervalMin)
      combinedData = aggregateCombined(combinedData, intervalMin)
    }

    if (ceSeriesRef.current) {
      if (ct === 'candlestick') {
        ceSeriesRef.current.setData(ceData)
      } else {
        ceSeriesRef.current.setData(ceData.map((item) => ({ time: item.time, value: item.close })))
      }
    }

    if (peSeriesRef.current) {
      if (ct === 'candlestick') {
        peSeriesRef.current.setData(peData)
      } else {
        peSeriesRef.current.setData(peData.map((item) => ({ time: item.time, value: item.close })))
      }
    }

    if (combinedSeriesRef.current) {
      combinedSeriesRef.current.setData(combinedData.map((item) => ({ time: item.time, value: item.combined_premium })))
    }
    if (llpSeriesRef.current && d.llp != null) {
      llpSeriesRef.current.setData(combinedData.map((item) => ({ time: item.time, value: d.llp! })))
    }
    if (ceIntrinsicRef.current) {
      ceIntrinsicRef.current.setData(combinedData.map((item) => ({ time: item.time, value: item.ce_intrinsic })))
    }
    if (peIntrinsicRef.current) {
      peIntrinsicRef.current.setData(combinedData.map((item) => ({ time: item.time, value: item.pe_intrinsic })))
    }
    if (ceExtrinsicRef.current) {
      ceExtrinsicRef.current.setData(combinedData.map((item) => ({ time: item.time, value: item.ce_extrinsic })))
    }
    if (peExtrinsicRef.current) {
      peExtrinsicRef.current.setData(combinedData.map((item) => ({ time: item.time, value: item.pe_extrinsic })))
    }
    if (combinedExtrinsicRef.current) {
      combinedExtrinsicRef.current.setData(combinedData.map((item) => ({ time: item.time, value: item.combined_extrinsic })))
    }

    if (volumeRef.current) {
      const dark = document.documentElement.classList.contains('dark')
      volumeRef.current.setData(combinedData.map((item) => ({
        time: item.time,
        value: item.combined_volume || 0,
        color: dark ? 'rgba(38,166,154,0.5)' : 'rgba(38,166,154,0.6)',
      })))
    }

    const ceMarkers = signals
      ? ceData.filter((item) => item.extrinsic_signal).map((point) => ({
          time: point.time as Time, position: 'aboveBar' as const,
          color: '#00ff00', shape: 'circle' as const, text: 'CE↑',
        }))
      : []
    ceMarkersRef.current?.setMarkers(ceMarkers)

    const peMarkers = signals
      ? peData.filter((item) => item.extrinsic_signal).map((point) => ({
          time: point.time as Time, position: 'aboveBar' as const,
          color: '#ff0000', shape: 'circle' as const, text: 'PE↑',
        }))
      : []
    peMarkersRef.current?.setMarkers(peMarkers)

    const cpCeMarkers = signals
      ? combinedData.filter((item) => item.cp_ce_signal).map((point) => ({
          time: point.time as Time, position: 'aboveBar' as const,
          color: '#2196f3', shape: 'circle' as const, text: 'CP_CE',
        }))
      : []
    cpCeMarkersRef.current?.setMarkers(cpCeMarkers)

    const ceMarkers2 = signals
      ? combinedData.filter((item) => item.combined_extrinsic_signal).map((point) => ({
          time: point.time as Time, position: 'belowBar' as const,
          color: '#ffeb3b', shape: 'circle' as const, text: 'C P',
        }))
      : []
    combinedExtrinsicMarkersRef.current?.setMarkers(ceMarkers2)
  }, [])

  const loadData = useCallback(async () => {
    if (!selectedStrike) return
    try {
      const res = await fetch(`/madhan/api/ezayChart_data?strike=${selectedStrike}&_=${Date.now()}`)
      const json: OptionDataResponse = await res.json()
      if (json.status !== 'success' || !json.data) return
      rawDataRef.current = json.data
      setChartInfo(`Strike ${json.data.strike} - CE: ${json.data.ce_symbol || 'N/A'} | PE: ${json.data.pe_symbol || 'N/A'} (${json.data.timezone || 'UTC'})`)
      applyData()
    } catch (err) {
      console.error('Error loading EzayChart data:', err)
    }
  }, [selectedStrike, applyData])

  useEffect(() => {
    if (!chartContainerRef.current) return
    const colors = getChartColors()

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: Math.max(400, chartContainerRef.current.clientHeight),
      handleScroll: { pressedMouseMove: true, mouseWheel: true, horzTouchDrag: true, vertTouchDrag: true },
      crosshair: { mode: CrosshairMode.Normal },
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.textColor,
      },
      grid: {
        vertLines: { color: colors.gridVert },
        horzLines: { color: colors.gridHorz },
      },
      rightPriceScale: { borderColor: colors.borderColor },
      localization: {
        timeFormatter: (time: Time) => {
          return new Date((time as number) * 1000).toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
          })
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => {
          return new Date((time as number) * 1000).toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
          })
        },
      },
    })

    chartRef.current = chart
    chartReadyRef.current = true

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return
      chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight })
    })
    resizeObserver.observe(chartContainerRef.current)

    loadStrikes()

    return () => {
      if (updaterRef.current) window.clearInterval(updaterRef.current)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      chartReadyRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!chartReadyRef.current || !chartRef.current) return
    const colors = getChartColors()
    chartRef.current.applyOptions({
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.textColor },
      grid: { vertLines: { color: colors.gridVert }, horzLines: { color: colors.gridHorz } },
      rightPriceScale: { borderColor: colors.borderColor },
    })
  }, [themeMode, getChartColors])

  useEffect(() => {
    if (chartReadyRef.current && chartRef.current) {
      chartTypeRef.current = chartType
      createAllSeries()
      loadData()
    }
  }, [chartType, createAllSeries, loadData])

  useEffect(() => {
    if (ceIntrinsicRef.current) ceIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
    if (peIntrinsicRef.current) peIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
    if (ceExtrinsicRef.current) ceExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
    if (peExtrinsicRef.current) peExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
  }, [showIntrinsic, showExtrinsic])

  useEffect(() => {
    if (combinedSeriesRef.current) combinedSeriesRef.current.applyOptions({ visible: showCombinedAll })
    if (llpSeriesRef.current) llpSeriesRef.current.applyOptions({ visible: showCombinedAll })
    if (combinedExtrinsicRef.current) combinedExtrinsicRef.current.applyOptions({ visible: showCombinedAll })
  }, [showCombinedAll])

  useEffect(() => {
    showSignalsRef.current = showSignals
    applyData()
  }, [showSignals, applyData])

  useEffect(() => {
    intervalRef.current = interval
    applyData()
  }, [interval, applyData])

  useEffect(() => {
    if (updaterRef.current) window.clearInterval(updaterRef.current)
    if (selectedStrike) {
      updaterRef.current = window.setInterval(() => loadData(), 60000)
    }
    return () => { if (updaterRef.current) window.clearInterval(updaterRef.current) }
  }, [selectedStrike, loadData])

  useEffect(() => {
    if (!strikeListRef.current || !selectedStrike) return
    const el = strikeListRef.current.querySelector(`[data-strike="${selectedStrike}"]`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [selectedStrike, strikes])

  const loadStrikes = async () => {
    try {
      const res = await fetch('/madhan/api/strikes')
      const json = await res.json()
      if (json.status === 'success' && json.data) {
        const sorted = json.data.sort((a: number, b: number) => b - a)
        setStrikes(sorted)
        if (sorted.length > 0) {
          const mid = sorted[Math.floor(sorted.length / 2)]
          setAtmStrike(mid)
          setSelectedStrike(String(mid))
        }
      }
    } catch (err) {
      console.error('Error loading strikes:', err)
    }
  }

  return (
    <div className="h-full w-full p-0 flex flex-col">
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
            <Link to="/madhan/madhan01"><BarChart3 className="h-3.5 w-3.5 mr-1.5" />NiftyFetcher</Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/ATP-LTPStrategy"><BarChart3 className="h-3.5 w-3.5 mr-1.5" />ATPLTP</Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/nifty-chart"><BarChart3 className="h-3.5 w-3.5 mr-1.5" />NiftyChart</Link>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/ezay-chart"><BarChart3 className="h-3.5 w-3.5 mr-1.5" />EzayChart</Link>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={appMode === 'live' ? 'default' : 'secondary'}
            className={cn('text-xs hidden sm:flex', appMode === 'analyzer' && 'bg-purple-500 hover:bg-purple-600 text-white')}>
            {appMode === 'live' ? 'Live Mode' : 'Analyze Mode'}
          </Badge>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={async () => {
            const result = await toggleAppMode()
            if (result.success) {
              const { appMode: newMode } = useThemeStore.getState()
              const { toast } = await import('sonner')
              toast.success(result.message || `Switched to ${newMode === 'live' ? 'Analyze' : 'Live'} mode`)
            } else {
              const { toast } = await import('sonner')
              toast.error(result.message || 'Failed to toggle mode')
            }
          }} disabled={isTogglingMode} title={`Switch to ${appMode === 'live' ? 'Analyze' : 'Live'} mode`}>
            {isTogglingMode ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              : appMode === 'live' ? <Zap className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMode} title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {themeMode === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/dashboard"><Home className="h-3.5 w-3.5 mr-1.5" />Dashboard</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-primary text-primary-foreground">
                <span className="text-sm font-medium">{user?.username?.[0]?.toUpperCase() || 'O'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {profileMenuItems.map((item) => (
                <DropdownMenuItem key={item.href} onSelect={() => navigate(item.href)}>
                  <item.icon className="mr-2 h-4 w-4" /><span>{item.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2" style={{ backgroundColor: t.panelDarker, borderBottom: `1px solid ${t.border}` }}>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px]" style={{ color: t.textSecondary }}>Time:</Label>
          <Select value={interval} onValueChange={(v) => setInterval(v)}>
            <SelectTrigger className="h-7 w-16 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1m">1m</SelectItem>
              <SelectItem value="3m">3m</SelectItem>
              <SelectItem value="5m">5m</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px]" style={{ color: t.textSecondary }}>Chart:</Label>
          <Select value={chartType} onValueChange={(v) => setChartType(v as 'candlestick' | 'line')}>
            <SelectTrigger className="h-7 w-20 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="candlestick">Candle</SelectItem>
              <SelectItem value="line">Line</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Checkbox checked={showIntrinsic} onCheckedChange={(v) => setShowIntrinsic(!!v)} />
            <Label className="text-[11px]" style={{ color: t.textSecondary }}>Intrinsic</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={showExtrinsic} onCheckedChange={(v) => setShowExtrinsic(!!v)} />
            <Label className="text-[11px]" style={{ color: t.textSecondary }}>Extrinsic</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={showCombinedAll} onCheckedChange={(v) => setShowCombinedAll(!!v)} />
            <Label className="text-[11px] font-semibold" style={{ color: t.textSecondary }}>Combined</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={showSignals} onCheckedChange={(v) => setShowSignals(!!v)} />
            <Label className="text-[11px]" style={{ color: t.textSecondary }}>Signals</Label>
          </div>
          <div className="h-4 w-px" style={{ backgroundColor: t.border }} />
          <Button
            size="sm"
            variant={showRealtime ? 'default' : 'ghost'}
            className="h-6 px-2 text-[10px]"
            onClick={() => setShowRealtime(!showRealtime)}
          >
            Realtime
          </Button>
        </div>
        <div className="ml-auto">
          <span className="text-[11px]" style={{ color: chartInfo ? t.text : t.textMuted }}>{chartInfo || 'No Strike Selected'}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div
          className="shrink-0 flex flex-col overflow-hidden border-r transition-[width] duration-150"
          style={{
            width: strikePanelOpen ? 72 : 24,
            backgroundColor: t.panelDarker,
            borderColor: t.border,
          }}
        >
          <button
            onClick={() => setStrikePanelOpen(!strikePanelOpen)}
            className="h-7 flex items-center justify-center shrink-0 hover:bg-[rgba(128,128,128,0.15)] transition-colors"
            style={{ color: t.textSecondary }}
            title={strikePanelOpen ? 'Collapse strike list' : 'Expand strike list'}
          >
            {strikePanelOpen ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          {strikePanelOpen && (
            <>
              <div className="px-1 py-1 text-center shrink-0" style={{ borderBottom: `1px solid ${t.border}` }}>
                <span className="text-[10px] font-semibold" style={{ color: t.textSecondary }}>STRIKES</span>
              </div>
              <div ref={strikeListRef} className="flex-1 overflow-y-auto min-h-0" style={{ scrollbarWidth: 'thin' }}>
                {strikes.map((s) => {
                  const isSelected = String(s) === selectedStrike
                  const isAtm = s === atmStrike
                  return (
                    <button
                      key={s}
                      data-strike={s}
                      onClick={() => setSelectedStrike(String(s))}
                      className={cn(
                        'w-full text-center py-1 text-[11px] font-mono transition-colors',
                        isSelected
                          ? 'font-bold'
                          : 'hover:bg-[rgba(128,128,128,0.15)]',
                      )}
                      style={{
                        color: isSelected
                          ? (themeMode === 'dark' ? '#2962ff' : '#2563eb')
                          : isAtm
                            ? (themeMode === 'dark' ? '#d1d4dc' : '#1f2937')
                            : t.textSecondary,
                        backgroundColor: isSelected
                          ? (themeMode === 'dark' ? 'rgba(41,98,255,0.2)' : 'rgba(37,99,235,0.15)')
                          : undefined,
                        borderBottom: `1px solid ${t.border}`,
                      }}
                    >
                      {s}
                      {isAtm && <span className="ml-1 text-[9px] font-bold" style={{ color: themeMode === 'dark' ? '#2962ff' : '#2563eb' }}>ATM</span>}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
        <div className="flex-1 min-h-0 min-w-0 relative" style={{ backgroundColor: t.panelDarker }}>
          <div ref={chartContainerRef} className="absolute inset-0" />
          {showRealtime && <RealtimeTable onClose={() => setShowRealtime(false)} />}
        </div>
      </div>
    </div>
  )
}
