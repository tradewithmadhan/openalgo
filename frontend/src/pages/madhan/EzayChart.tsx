import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  LineSeries,
  BarSeries,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
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
import { BarChart3, Home, Menu, Sun, Moon, Zap } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { cn } from '@/lib/utils'
import { chartTheme } from './chartTheme'

type ChartType = 'candlestick' | 'line' | 'area' | 'bar'

type OptionDataResponse = {
  status: string
  data?: {
    ce_data: Array<{ time: number; open: number; high: number; low: number; close: number; extrinsic_signal?: boolean }>
    pe_data: Array<{ time: number; open: number; high: number; low: number; close: number; extrinsic_signal?: boolean }>
    combined_data: Array<{
      time: number
      combined_premium: number
      ce_intrinsic: number
      pe_intrinsic: number
      ce_extrinsic: number
      pe_extrinsic: number
      combined_extrinsic: number
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

export default function EzayChart() {
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const ceSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const peSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const combinedSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const llpSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const ceIntrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const peIntrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const ceExtrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const peExtrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const combinedExtrinsicRef = useRef<ISeriesApi<any> | null>(null)
  const ceMarkersRef = useRef<any>(null)
  const peMarkersRef = useRef<any>(null)
  const cpCeMarkersRef = useRef<any>(null)
  const combinedExtrinsicMarkersRef = useRef<any>(null)
  const updaterRef = useRef<number | null>(null)
  const chartReadyRef = useRef(false)

  const [chartType, setChartType] = useState<ChartType>('candlestick')
  const [strikes, setStrikes] = useState<number[]>([])
  const [selectedStrike, setSelectedStrike] = useState<string>('')
  const [showIntrinsic, setShowIntrinsic] = useState(true)
  const [showExtrinsic, setShowExtrinsic] = useState(true)
  const [showCombinedAll, setShowCombinedAll] = useState(true)
  const [showSignals, setShowSignals] = useState(true)
  const [chartInfo, setChartInfo] = useState('')

  const { mode: themeMode, toggleMode, appMode, toggleAppMode, isTogglingMode } = useThemeStore()
  const t = chartTheme[themeMode]
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const profileMenuItems = useProfileMenuItems()

  const getChartColors = useCallback(() => {
    const dark = document.documentElement.classList.contains('dark')
    return {
      background: dark ? '#131722' : '#ffffff',
      textColor: dark ? '#a6adbb' : '#333',
      gridVert: dark ? 'rgba(166,173,187,0.1)' : 'rgba(0,0,0,0.05)',
      gridHorz: dark ? 'rgba(166,173,187,0.1)' : 'rgba(0,0,0,0.05)',
      crosshairLine: dark ? 'rgba(166,173,187,0.5)' : 'rgba(0,0,0,0.3)',
      borderColor: dark ? 'rgba(166,173,187,0.2)' : 'rgba(0,0,0,0.2)',
    }
  }, [])

  const removeAllSeries = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    const refs = [
      ceSeriesRef, peSeriesRef, combinedSeriesRef, llpSeriesRef,
      ceIntrinsicRef, peIntrinsicRef, ceExtrinsicRef, peExtrinsicRef,
      combinedExtrinsicRef,
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

  const createSeries = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    removeAllSeries()

    const ceColor = '#00C851'
    const ceDownColor = '#FF4444'
    const peDownColor = '#6610F2'

    const createSeriesByType = (
      type: ChartType,
      options: Record<string, any>,
    ): ISeriesApi<any> => {
      switch (type) {
        case 'candlestick':
          return chart.addSeries(CandlestickSeries, {
            upColor: ceColor,
            downColor: options.downColor || ceDownColor,
            borderVisible: false,
            wickUpColor: ceColor,
            wickDownColor: options.downColor || ceDownColor,
            ...options,
          })
        case 'line':
          return chart.addSeries(LineSeries, {
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            ...options,
          })
        case 'area':
          return chart.addSeries(AreaSeries, {
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            ...options,
          })
        case 'bar':
          return chart.addSeries(BarSeries, {
            upColor: ceColor,
            downColor: options.downColor || ceDownColor,
            ...options,
          })
      }
    }

    const ce = createSeriesByType(chartType, {
      title: 'CE Premium',
      color: '#2962FF',
    })
    ceSeriesRef.current = ce

    const pe = createSeriesByType(chartType, {
      title: 'PE Premium',
      color: '#ff6b6b',
      downColor: peDownColor,
    })
    peSeriesRef.current = pe

    combinedSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#2196f3',
      lineWidth: 3,
      title: 'Combined Premium',
      priceLineVisible: false,
      lastValueVisible: false,
    })

    llpSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#1976d2',
      lineWidth: 2,
      title: 'LLP',
      priceLineVisible: false,
      lastValueVisible: false,
    })

    ceIntrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#4caf50',
      lineWidth: 1,
      lineStyle: 1,
      title: 'CE Intrinsic',
      priceLineVisible: false,
      lastValueVisible: false,
    })

    peIntrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#ef5350',
      lineWidth: 1,
      lineStyle: 1,
      title: 'PE Intrinsic',
      priceLineVisible: false,
      lastValueVisible: false,
    })

    ceExtrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#4caf50',
      lineWidth: 1,
      title: 'CE Extrinsic',
      priceLineVisible: false,
      lastValueVisible: false,
    })

    peExtrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#ef5350',
      lineWidth: 1,
      title: 'PE Extrinsic',
      priceLineVisible: false,
      lastValueVisible: false,
    })

    combinedExtrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#ffeb3b',
      lineWidth: 2,
      title: 'Combined Extrinsic',
      priceLineVisible: false,
      lastValueVisible: false,
    })

    if (selectedStrike) loadData()
  }, [chartType, removeAllSeries, selectedStrike])

  const loadData = useCallback(async () => {
    if (!selectedStrike) return
    try {
      const res = await fetch(`/madhan/api/ezayChart_data?strike=${selectedStrike}&_=${Date.now()}`)
      const json: OptionDataResponse = await res.json()
      if (json.status !== 'success' || !json.data) return

      const d = json.data

      if (ceSeriesRef.current && d.ce_data) {
        if (chartType === 'candlestick' || chartType === 'bar') {
          ceSeriesRef.current.setData(d.ce_data)
        } else {
          ceSeriesRef.current.setData(d.ce_data.map((item) => ({ time: item.time, value: item.close })))
        }
      }

      if (peSeriesRef.current && d.pe_data) {
        if (chartType === 'candlestick' || chartType === 'bar') {
          peSeriesRef.current.setData(d.pe_data)
        } else {
          peSeriesRef.current.setData(d.pe_data.map((item) => ({ time: item.time, value: item.close })))
        }
      }

      if (combinedSeriesRef.current && d.combined_data) {
        combinedSeriesRef.current.setData(d.combined_data.map((item) => ({ time: item.time, value: item.combined_premium })))
      }

      if (llpSeriesRef.current && d.combined_data && d.llp != null) {
        llpSeriesRef.current.setData(d.combined_data.map((item) => ({ time: item.time, value: d.llp })))
      }

      if (ceIntrinsicRef.current && d.combined_data) {
        ceIntrinsicRef.current.setData(d.combined_data.map((item) => ({ time: item.time, value: item.ce_intrinsic })))
      }

      if (peIntrinsicRef.current && d.combined_data) {
        peIntrinsicRef.current.setData(d.combined_data.map((item) => ({ time: item.time, value: item.pe_intrinsic })))
      }

      if (ceExtrinsicRef.current && d.combined_data) {
        ceExtrinsicRef.current.setData(d.combined_data.map((item) => ({ time: item.time, value: item.ce_extrinsic })))
      }

      if (peExtrinsicRef.current && d.combined_data) {
        peExtrinsicRef.current.setData(d.combined_data.map((item) => ({ time: item.time, value: item.pe_extrinsic })))
      }

      if (combinedExtrinsicRef.current && d.combined_data) {
        combinedExtrinsicRef.current.setData(d.combined_data.map((item) => ({ time: item.time, value: item.combined_extrinsic })))
      }

      if (ceSeriesRef.current && d.ce_data) {
        const markers = showSignals
          ? d.ce_data.filter((item) => item.extrinsic_signal).map((point) => ({
              time: point.time as Time,
              position: 'aboveBar' as const,
              color: '#00ff00',
              shape: 'circle' as const,
              text: 'CE↑',
            }))
          : []
        if (ceMarkersRef.current) {
          ceMarkersRef.current.setMarkers(markers)
        } else if (markers.length > 0) {
          const { createSeriesMarkers } = await import('lightweight-charts')
          ceMarkersRef.current = createSeriesMarkers(ceSeriesRef.current, markers)
        }
      }

      if (peSeriesRef.current && d.pe_data) {
        const markers = showSignals
          ? d.pe_data.filter((item) => item.extrinsic_signal).map((point) => ({
              time: point.time as Time,
              position: 'aboveBar' as const,
              color: '#ff0000',
              shape: 'circle' as const,
              text: 'PE↑',
            }))
          : []
        if (peMarkersRef.current) {
          peMarkersRef.current.setMarkers(markers)
        } else if (markers.length > 0) {
          const { createSeriesMarkers } = await import('lightweight-charts')
          peMarkersRef.current = createSeriesMarkers(peSeriesRef.current, markers)
        }
      }

      if (combinedSeriesRef.current && d.combined_data) {
        const markers = showSignals
          ? d.combined_data.filter((item) => item.cp_ce_signal).map((point) => ({
              time: point.time as Time,
              position: 'aboveBar' as const,
              color: '#2196f3',
              shape: 'circle' as const,
              text: 'CP_CE',
            }))
          : []
        if (cpCeMarkersRef.current) {
          cpCeMarkersRef.current.setMarkers(markers)
        } else if (markers.length > 0) {
          const { createSeriesMarkers } = await import('lightweight-charts')
          cpCeMarkersRef.current = createSeriesMarkers(combinedSeriesRef.current, markers)
        }
      }

      if (combinedExtrinsicRef.current && d.combined_data) {
        const markers = showSignals
          ? d.combined_data.filter((item) => item.combined_extrinsic_signal).map((point) => ({
              time: point.time as Time,
              position: 'belowBar' as const,
              color: '#ffeb3b',
              shape: 'circle' as const,
              text: 'C P',
            }))
          : []
        if (combinedExtrinsicMarkersRef.current) {
          combinedExtrinsicMarkersRef.current.setMarkers(markers)
        } else if (markers.length > 0) {
          const { createSeriesMarkers } = await import('lightweight-charts')
          combinedExtrinsicMarkersRef.current = createSeriesMarkers(combinedExtrinsicRef.current, markers)
        }
      }

      setChartInfo(`Strike ${d.strike} - CE: ${d.ce_symbol || 'N/A'} | PE: ${d.pe_symbol || 'N/A'} (${d.timezone || 'UTC'})`)
    } catch (err) {
      console.error('Error loading EzayChart data:', err)
    }
  }, [selectedStrike, chartType, showSignals])

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
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => {
          return new Date(time * 1000).toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          })
        },
      },
    })

    chartRef.current = chart
    chartReadyRef.current = true

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      })
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
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.textColor,
      },
      grid: {
        vertLines: { color: colors.gridVert },
        horzLines: { color: colors.gridHorz },
      },
      rightPriceScale: { borderColor: colors.borderColor },
    })
  }, [themeMode, getChartColors])

  useEffect(() => {
    if (chartReadyRef.current && chartRef.current) {
      createSeries()
    }
  }, [chartType, createSeries])

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
    if (chartReadyRef.current && selectedStrike) {
      loadData()
    }
  }, [showSignals, loadData, selectedStrike])

  useEffect(() => {
    if (updaterRef.current) window.clearInterval(updaterRef.current)
    if (selectedStrike) {
      updaterRef.current = window.setInterval(() => loadData(), 60000)
    }
    return () => {
      if (updaterRef.current) window.clearInterval(updaterRef.current)
    }
  }, [selectedStrike, loadData])

  const loadStrikes = async () => {
    try {
      const res = await fetch('/madhan/api/strikes')
      const json = await res.json()
      if (json.status === 'success' && json.data) {
        const sorted = json.data.sort((a: number, b: number) => b - a)
        setStrikes(sorted)
        if (sorted.length > 0) {
          const mid = sorted[Math.floor(sorted.length / 2)]
          setSelectedStrike(String(mid))
        }
      }
    } catch (err) {
      console.error('Error loading strikes:', err)
    }
  }

  const handleStrikeChange = (val: string) => {
    setSelectedStrike(val)
    if (chartReadyRef.current && chartRef.current && val) {
      createSeries()
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
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={appMode === 'live' ? 'default' : 'secondary'}
            className={cn('text-xs hidden sm:flex', appMode === 'analyzer' && 'bg-purple-500 hover:bg-purple-600 text-white')}
          >
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
            {isTogglingMode ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : appMode === 'live' ? (
              <Zap className="h-4 w-4" />
            ) : (
              <BarChart3 className="h-4 w-4" />
            )}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMode} title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {themeMode === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/dashboard">
              <Home className="h-3.5 w-3.5 mr-1.5" />
              Dashboard
            </Link>
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
                  <item.icon className="mr-2 h-4 w-4" />
                  <span>{item.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2" style={{ backgroundColor: t.panelDarker, borderBottom: `1px solid ${t.border}` }}>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px]" style={{ color: t.textSecondary }}>Strike:</Label>
          <Select value={selectedStrike} onValueChange={handleStrikeChange}>
            <SelectTrigger className="h-7 w-24 text-[11px]">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {strikes.map((s) => (
                <SelectItem key={s} value={String(s)}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px]" style={{ color: t.textSecondary }}>Chart:</Label>
          <Select value={chartType} onValueChange={(v) => setChartType(v as ChartType)}>
            <SelectTrigger className="h-7 w-24 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="candlestick">Candle</SelectItem>
              <SelectItem value="line">Line</SelectItem>
              <SelectItem value="area">Area</SelectItem>
              <SelectItem value="bar">Bar</SelectItem>
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
        </div>
        <div className="ml-auto">
          <span className="text-[11px]" style={{ color: chartInfo ? t.text : t.textMuted }}>{chartInfo || 'No Strike Selected'}</span>
        </div>
      </div>

      <div ref={chartContainerRef} className="flex-1 min-h-0" style={{ backgroundColor: t.panelDarker }} />
    </div>
  )
}
