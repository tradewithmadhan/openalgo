import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
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
  createTextWatermark,
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
import { BarChart3, Home, Menu, Sun, Moon, Zap, ChevronLeft, ChevronRight, Wifi, WifiOff } from 'lucide-react'
// import { toast } from 'sonner' // used via dynamic import below
import { useMarketData } from '@/hooks/useMarketData'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { useMadhanTheme } from './useMadhanTheme'
import { cn } from '@/lib/utils'
import { tradingApi } from '@/api/trading'
import { setTimeOffset, getTimeOffset } from '@/utils/timeSync'
import { chartTheme } from './chartTheme'
import { PositionLinePrimitive, type PositionDatum, OrderLinePrimitive, type OrderLineDatum } from './chartPrimitives'
import { useOrderEventRefresh } from '@/hooks/useOrderEventRefresh'
import RealtimeTable from './RealtimeTable'
import EzaySignals, { type SignalRow, type FirstSignalInfo, type BackendSignals } from './components/EzaySignals'
import QuickTradePanel from './components/QuickTradePanel'

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
      spot_close?: number
      combined_volume?: number
      cp_ce_signal?: boolean
      combined_extrinsic_signal?: boolean
      llp?: number
    }>
    llp: number
    strike: number
    ce_symbol?: string
    pe_symbol?: string
    timezone?: string
    trades?: Record<string, BacktestTrade[]>
    summary?: Record<string, { total: number; wins: number; losses: number; winRate: number; totalPnl: number; totalPnlAmount: number }>
    strategies?: string[]
  }
}

type AggCandle = { time: number; open: number; high: number; low: number; close: number }
type AggCombined = {
  time: number; combined_premium: number; ce_intrinsic: number; pe_intrinsic: number;
  ce_extrinsic: number; pe_extrinsic: number; combined_extrinsic: number; combined_volume?: number;
  cp_ce_signal?: boolean; combined_extrinsic_signal?: boolean; llp?: number;
}
type BacktestTrade = {
  strategy: string
  method?: string
  date: string
  strike: number
  symbol: string
  expiry: string
  side: 'CE' | 'PE'
  entryTime: number
  entryPrice: number
  exitTime: number
  exitPrice: number
  pnlPct: number
  pnlAmount: number
  lotSize: number
  exitReason: 'target' | 'opposite' | 'eod'
  maxRunupPct: number
}

type RangeDayResult = {
  date: string
  ce_pe_strike: number
  cp_strike: number
  trades: Record<string, BacktestTrade[]>
  summary: Record<string, { total: number; wins: number; losses: number; winRate: number; totalPnl: number; totalPnlAmount: number } | null>
}

type RangeResponse = {
  status?: string
  from_date: string
  to_date: string
  total_days: number
  days_with_signals: Record<string, number>
  strategies: Record<string, { trades: BacktestTrade[]; summary: { total: number; wins: number; losses: number; winRate: number; totalPnl: number; totalPnlAmount: number } | null }>
  per_day: RangeDayResult[]
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
      if ('volume' in c && typeof c.volume === 'number') (existing as any).volume = ((existing as any).volume || 0) + c.volume
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
      existing.combined_volume = (existing.combined_volume || 0) + (c.combined_volume || 0)
      if (c.cp_ce_signal) existing.cp_ce_signal = true
      if (c.combined_extrinsic_signal) existing.combined_extrinsic_signal = true
    } else {
      buckets.set(bucket, { ...c })
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time)
}

type TotalVolEntry = { time: number; combined: number }

function aggregateTotalVolume(data: TotalVolEntry[], intervalMin: number): TotalVolEntry[] {
  if (intervalMin <= 1 || !data.length) return data
  const bucketSec = intervalMin * 60
  const buckets = new Map<number, TotalVolEntry>()
  for (const d of data) {
    const bucket = Math.floor(d.time / bucketSec) * bucketSec
    const existing = buckets.get(bucket)
    if (existing) {
      existing.combined += d.combined
    } else {
      buckets.set(bucket, { ...d, time: bucket })
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time)
}

type TrustMeEntry = { time: number; upside: number; downside: number }

function aggregateTrustMe(data: TrustMeEntry[], intervalMin: number): TrustMeEntry[] {
  if (intervalMin <= 1 || !data.length) return data
  const bucketSec = intervalMin * 60
  const buckets = new Map<number, TrustMeEntry>()
  for (const d of data) {
    const bucket = Math.floor(d.time / bucketSec) * bucketSec
    const existing = buckets.get(bucket)
    if (existing) {
      existing.upside += d.upside
      existing.downside += d.downside
    } else {
      buckets.set(bucket, { time: bucket, upside: d.upside, downside: d.downside })
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
  const totalVolumeRef = useRef<ISeriesApi<any> | null>(null)
  const totalVolumeDataRef = useRef<Array<{ time: number; combined: number }>>([])
  const trustMeUpRef = useRef<ISeriesApi<any> | null>(null)
  const trustMeDownRef = useRef<ISeriesApi<any> | null>(null)
  const strikeWatermarkRef = useRef<any>(null)
  const signalsResponseRef = useRef<any>(null)
  const signalsDataRef = useRef<SignalRow[]>([])
  const signalsMetaRef = useRef<BackendSignals | null>(null)
  const signalsLastTimeRef = useRef<number>(0)
  const signalsLastFetchedRef = useRef<number>(0)
  const ceMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const peMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const cpCeMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const combinedExtrinsicMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const ceTradeMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const peTradeMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const cePositionRef = useRef<PositionLinePrimitive | null>(null)
  const pePositionRef = useRef<PositionLinePrimitive | null>(null)

  const ceOrderRef = useRef<OrderLinePrimitive | null>(null)
  const peOrderRef = useRef<OrderLinePrimitive | null>(null)
  const handleClosePositionRef = useRef<(symbol: string, exchange: string, product: string) => void>(() => {})
  const handleCancelOrderRef = useRef<(orderId: string) => void>(() => {})
  const handleModifyOrderRef = useRef<(orderId: string, newPrice: number) => void>(() => {})
  const backtestTradesRef = useRef<BacktestTrade[]>([])
  const backtestSummaryRef = useRef<{ total: number; wins: number; losses: number; winRate: number; totalPnl: number; totalPnlAmount: number } | null>(null)
  const firstSignalTimeRef = useRef(0)
  const firstSignalStrikeRef = useRef(0)
  const firstSignalTypeRef = useRef<'CE' | 'PE' | ''>('')
  const pendingAutoSelectRef = useRef(false)
  const updaterRef = useRef<number | null>(null)
  const chartReadyRef = useRef(false)
  const rawDataRef = useRef<OptionDataResponse['data'] | null>(null)

  const chartTypeRef = useRef<'candlestick' | 'line'>('candlestick')
  const intervalRef = useRef('1m')
  const showSignalsRef = useRef(true)
  const showHCRef = useRef(false)

  const loadSetting = (key: string, fallback: any) => {
    try { const v = localStorage.getItem(`ezay_${key}`); return v !== null ? JSON.parse(v) : fallback } catch { return fallback }
  }
  const saveSetting = (key: string, value: any) => {
    try { localStorage.setItem(`ezay_${key}`, JSON.stringify(value)) } catch {}
  }

  const [chartType, setChartType] = useState<'candlestick' | 'line'>(() => loadSetting('chartType', 'candlestick'))
  const [interval, setInterval] = useState(() => loadSetting('interval', '1m'))
  const [strikes, setStrikes] = useState<number[]>([])
  const [selectedStrike, setSelectedStrike] = useState<string>('')
  const [showCE, setShowCE] = useState(() => loadSetting('showCE', true))
  const [showPE, setShowPE] = useState(() => loadSetting('showPE', true))
  const [showIntrinsic, setShowIntrinsic] = useState(() => loadSetting('showIntrinsic', false))
  const [showExtrinsic, setShowExtrinsic] = useState(() => loadSetting('showExtrinsic', false))
  const [showCombinedAll, setShowCombinedAll] = useState(() => loadSetting('showCombinedAll', true))
  const [showSignals, setShowSignals] = useState(() => loadSetting('showSignals', false))
  const [showHC, setShowHC] = useState(() => loadSetting('showHC', false))
  const [chartInfo, setChartInfo] = useState('')
  const [atmStrike, setAtmStrike] = useState<number | null>(null)
  const [strikePanelOpen, setStrikePanelOpen] = useState(() => loadSetting('strikePanelOpen', true))
  const [showRealtime, setShowRealtime] = useState(() => loadSetting('showRealtime', false))
  const [volumeMode, setVolumeMode] = useState<'strike' | 'total'>(() => loadSetting('volumeMode', 'strike'))
  const [showEzaySignals, setShowEzaySignals] = useState(() => loadSetting('showEzaySignals', false))
  const [showTrustMe, setShowTrustMe] = useState(() => loadSetting('showTrustMe', false))
  const showTrustMeRef = useRef(showTrustMe)
  const [signalsForPanel, setSignalsForPanel] = useState<SignalRow[]>([])
  const [signalsMetaForPanel, setSignalsMetaForPanel] = useState<BackendSignals | null>(null)
  const [signalsLastTime, setSignalsLastTime] = useState<number>(0)
  const [irStrikes, setIrStrikes] = useState<number[]>([])
  const [semiTransparent, setSemiTransparent] = useState(() => loadSetting('semiTransparent', true))
  const semiTransparentRef = useRef(true)
  const [ceSymbol, setCeSymbol] = useState('')
  const [peSymbol, setPeSymbol] = useState('')
  const ceSymbolRef = useRef('')
  const peSymbolRef = useRef('')
  const [liveSpot, setLiveSpot] = useState(0)
  const liveSpotRef = useRef(0)
  const [ceLtpDisplay, setCeLtpDisplay] = useState(0)
  const [peLtpDisplay, setPeLtpDisplay] = useState(0)
  const [isBacktest, setIsBacktest] = useState(false)
  const [backtestDate, setBacktestDate] = useState('')
  const [visibleStrategies, setVisibleStrategies] = useState<Set<string>>(new Set())
  const [availableStrategies, setAvailableStrategies] = useState<string[]>([])
  const isBacktestRef = useRef(false)
  const backtestDateRef = useRef('')
  const timeOffsetRef = useRef(0)
  const [backtestSummary, setBacktestSummary] = useState<{ total: number; wins: number; losses: number; winRate: number; totalPnl: number; totalPnlAmount: number } | null>(null)

  const [rangeMode, setRangeMode] = useState(false)
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [rangeResults, setRangeResults] = useState<RangeResponse | null>(null)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [rangeVisibleStrategies, setRangeVisibleStrategies] = useState<Set<string>>(new Set(['CE-PE', 'CP']))

  const currentAtmStrike = liveSpot > 0 ? Math.round(liveSpot / 50) * 50 : null
  const [candleCountdown, setCandleCountdown] = useState('')

  const cePositionDataRef = useRef<PositionDatum | null>(null)
  const pePositionDataRef = useRef<PositionDatum | null>(null)

  const currentOhlcRef = useRef<Map<string, { time: number; open: number; high: number; low: number; close: number }>>(new Map())
  const apiCandleVolRef = useRef<Map<number, number>>(new Map())
  const strikeNumRef = useRef(0)
  const tradePanelClickRef = useRef<(clickY: number) => void>(() => {})

  const { appMode, toggleAppMode, isTogglingMode } = useThemeStore()
  const { mode: madhanMode, toggleMode: toggleMadhanMode, style: madhanStyle } = useMadhanTheme()
  const t = chartTheme[madhanMode]
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const profileMenuItems = useProfileMenuItems()

  const getIntervalMinutes = (val: string) => {
    if (val.endsWith('m')) return Math.max(1, Number(val.slice(0, -1) || '1'))
    return 1
  }

  const todayStr = () => new Date(Date.now() + getTimeOffset()).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  const shiftBacktestDate = (days: number) => {
    const cur = backtestDateRef.current || todayStr()
    const d = new Date(cur + 'T00:00:00')
    d.setDate(d.getDate() + days)
    const next = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    setBacktestDate(next)
    backtestDateRef.current = next
    backtestTradesRef.current = []
    backtestSummaryRef.current = null
    setBacktestSummary(null)
    firstSignalTimeRef.current = 0
    firstSignalStrikeRef.current = 0
    firstSignalTypeRef.current = ''
    setIrStrikes([])
    pendingAutoSelectRef.current = true
    clearAllChartData()
    loadStrikes()
  }

  const handleFirstSignal = useCallback((info: FirstSignalInfo) => {
    firstSignalTimeRef.current = info.time
    firstSignalTypeRef.current = info.type
    firstSignalStrikeRef.current = info.strike
    if (pendingAutoSelectRef.current && info.strike > 0) {
      pendingAutoSelectRef.current = false
      setSelectedStrike(String(info.strike))
    }
  }, [])

  const handleSignals = useCallback((signals: BackendSignals) => {
    setIrStrikes(signals.ir)
  }, [])

  const [fetcherRunning, setFetcherRunning] = useState(false)
  const fetcherRunningRef = useRef(false)
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)
  const isPlacingOrderRef = useRef(false)
  const isClosingRef = useRef(false)
  const isCancellingRef = useRef(false)
  const [orderStatus, setOrderStatus] = useState<'idle' | 'placing' | 'executing'>('idle')

  const wsSymbols = useMemo(() => {
    if (isBacktest) return []
    const syms: Array<{ symbol: string; exchange: string }> = [
      { symbol: 'NIFTY', exchange: 'NSE_INDEX' },
    ]
    if (fetcherRunning) {
      if (ceSymbol) syms.push({ symbol: ceSymbol, exchange: 'NFO' })
      if (peSymbol) syms.push({ symbol: peSymbol, exchange: 'NFO' })
    }
    return syms
  }, [ceSymbol, peSymbol, isBacktest, fetcherRunning])

  const { data: wsData, isConnected } = useMarketData({ symbols: wsSymbols, mode: 'LTP' })

  const getChartColors = useCallback(() => {
    const dark = madhanMode === 'dark'
    return {
      background: dark ? '#131722' : '#ffffff',
      textColor: dark ? '#a6adbb' : '#333',
      gridVert: dark ? 'rgba(166,173,187,0.1)' : 'rgba(0,0,0,0.05)',
      gridHorz: dark ? 'rgba(166,173,187,0.1)' : 'rgba(0,0,0,0.05)',
      borderColor: dark ? 'rgba(166,173,187,0.2)' : 'rgba(0,0,0,0.2)',
    }
  }, [madhanMode])

  const removeAllSeries = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    const refs = [
      ceSeriesRef, peSeriesRef, combinedSeriesRef, llpSeriesRef,
      ceIntrinsicRef, peIntrinsicRef, ceExtrinsicRef, peExtrinsicRef,
      combinedExtrinsicRef, volumeRef, totalVolumeRef,
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
    ceTradeMarkersRef.current = null
    peTradeMarkersRef.current = null
    if (strikeWatermarkRef.current) {
      try { strikeWatermarkRef.current.detach() } catch {}
      strikeWatermarkRef.current = null
    }
    backtestTradesRef.current = []
    backtestSummaryRef.current = null
  }, [])

  const createAllSeries = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    removeAllSeries()

    const semi = semiTransparentRef.current
    const ceUp = semi ? 'rgba(0,200,81,0.5)' : '#00C851'
    const ceDown = semi ? 'rgba(255,68,68,0.5)' : '#FF4444'
    const peUp = semi ? 'rgba(224,64,251,0.5)' : '#E040FB'
    const peDown = semi ? 'rgba(136,14,79,0.5)' : '#880E4F'
    const ct = chartTypeRef.current

    const makeCeSeries = (opts: Record<string, any>): ISeriesApi<any> => {
      if (ct === 'candlestick') {
        return chart.addSeries(CandlestickSeries, {
          upColor: ceUp, downColor: ceDown, borderVisible: false,
          wickUpColor: ceUp, wickDownColor: ceDown, crosshairMarkerVisible: false, ...opts,
        } as any)
      }
      return chart.addSeries(LineSeries, {
        lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, ...opts,
      } as any)
    }

    const makePeSeries = (opts: Record<string, any>): ISeriesApi<any> => {
      if (ct === 'candlestick') {
        return chart.addSeries(CandlestickSeries, {
          upColor: peUp, downColor: peDown, borderVisible: false,
          wickUpColor: peUp, wickDownColor: peDown, crosshairMarkerVisible: false, ...opts,
        } as any)
      }
      return chart.addSeries(LineSeries, {
        lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, ...opts,
      } as any)
    }

    ceSeriesRef.current = makeCeSeries({ title: 'CE', color: '#2962FF' })
    peSeriesRef.current = makePeSeries({ title: 'PE', color: '#E040FB' })

    combinedSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#2196f3', lineWidth: 3, title: 'Combined Premium',
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    })
    llpSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#1976d2', lineWidth: 2, title: 'LLP',
      priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
    })
    ceIntrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#4caf50', lineWidth: 1, lineStyle: 1, title: 'CE Intrinsic',
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    })
    peIntrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#ef5350', lineWidth: 1, lineStyle: 1, title: 'PE Intrinsic',
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    })
    ceExtrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#4caf50', lineWidth: 1, title: 'CE Extrinsic',
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    })
    peExtrinsicRef.current = chart.addSeries(LineSeries, {
      color: '#ef5350', lineWidth: 1, title: 'PE Extrinsic',
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    })
    combinedExtrinsicRef.current = getIntervalMinutes(intervalRef.current) > 1
      ? chart.addSeries(CandlestickSeries, {
          upColor: '#ffeb3b', downColor: '#f57f17', borderVisible: false,
          wickUpColor: '#ffeb3b', wickDownColor: '#f57f17',
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: 'Combined Extrinsic',
        } as any)
      : chart.addSeries(LineSeries, {
          color: '#ffeb3b', lineWidth: 2, title: 'Combined Extrinsic',
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        } as any)

    volumeRef.current = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    } as any)

    totalVolumeRef.current = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      visible: false,
    } as any)

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })

    ceMarkersRef.current = createSeriesMarkers(ceSeriesRef.current, [])
    peMarkersRef.current = createSeriesMarkers(peSeriesRef.current, [])
    cpCeMarkersRef.current = createSeriesMarkers(combinedSeriesRef.current, [])
    combinedExtrinsicMarkersRef.current = createSeriesMarkers(combinedExtrinsicRef.current, [])
    ceTradeMarkersRef.current = createSeriesMarkers(ceSeriesRef.current, [])
    peTradeMarkersRef.current = createSeriesMarkers(peSeriesRef.current, [])

    const cePos = new PositionLinePrimitive(ceSeriesRef.current, chart.timeScale(), (_sym) => {
      const pos = cePositionDataRef.current
      if (pos) handleClosePositionRef.current(pos.symbol, pos.exchange, pos.product)
    })
    cePositionRef.current = cePos
    ceSeriesRef.current.attachPrimitive(cePos as any)

    const pePos = new PositionLinePrimitive(peSeriesRef.current, chart.timeScale(), (_sym) => {
      const pos = pePositionDataRef.current
      if (pos) handleClosePositionRef.current(pos.symbol, pos.exchange, pos.product)
    })
    pePositionRef.current = pePos
    peSeriesRef.current.attachPrimitive(pePos as any)

    const ceOrd = new OrderLinePrimitive(ceSeriesRef.current, (orderId) => {
      handleCancelOrderRef.current(orderId)
    }, (orderId, newPrice) => {
      handleModifyOrderRef.current(orderId, newPrice)
    })
    ceOrderRef.current = ceOrd
    ceSeriesRef.current.attachPrimitive(ceOrd as any)

    const peOrd = new OrderLinePrimitive(peSeriesRef.current, (orderId) => {
      handleCancelOrderRef.current(orderId)
    }, (orderId, newPrice) => {
      handleModifyOrderRef.current(orderId, newPrice)
    })
    peOrderRef.current = peOrd
    peSeriesRef.current.attachPrimitive(peOrd as any)

    // Strike watermark — center of chart
    if (strikeWatermarkRef.current) {
      try { strikeWatermarkRef.current.detach() } catch {}
      strikeWatermarkRef.current = null
    }
    const strikeVal = selectedStrike || (strikeNumRef.current ? String(strikeNumRef.current) : '')
    if (strikeVal) {
      const isDark = madhanMode === 'dark'
      strikeWatermarkRef.current = createTextWatermark(chart.panes()[0], {
        horzAlign: 'center',
        vertAlign: 'center',
        lines: [{
          text: `Strike ${strikeVal}`,
          color: isDark ? 'rgba(166,173,187,0.3)' : 'rgba(0,0,0,0.15)',
          fontSize: 48,
          fontFamily: 'Arial, sans-serif',
          fontStyle: 'bold',
        }],
      })
    }
  }, [removeAllSeries])

  const applyData = useCallback(() => {
    const d = rawDataRef.current
    if (!d) return
    const ct = chartTypeRef.current
    const intervalMin = getIntervalMinutes(intervalRef.current)
    const signals = showSignalsRef.current
    currentOhlcRef.current.clear()

    let ceData = d.ce_data || []
    let peData = d.pe_data || []
    let combinedData = d.combined_data || []

    if (intervalMin > 1) {
      ceData = aggregateCandles(ceData, intervalMin)
      peData = aggregateCandles(peData, intervalMin)
      combinedData = aggregateCombined(combinedData, intervalMin)
      // Recompute running llp after aggregation
      let runningLlp: number | null = null
      for (const item of combinedData) {
        const cp = item.combined_premium
        if (runningLlp === null || cp < runningLlp) runningLlp = cp
        item.llp = runningLlp
      }
    }

    // In live mode, include ALL API data (including current bucket) so aggregated
    // candles load correctly when switching timeframes. Seed currentOhlcRef so
    // WS update() continues from the API's OHLC instead of starting fresh.
    const liveBucket = !isBacktestRef.current ? Math.floor((Date.now() + getTimeOffset()) / 1000 / (intervalMin * 60)) * (intervalMin * 60) : 0

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
      llpSeriesRef.current.setData(combinedData.map((item) => ({ time: item.time, value: item.llp ?? 0 })))
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
      if (intervalMin > 1) {
        const rawCombined = d.combined_data || []
        const bucketSec = intervalMin * 60
        const ohlcBuckets = new Map<number, { time: number; open: number; high: number; low: number; close: number }>()
        for (const item of rawCombined) {
          const bucket = Math.floor(item.time / bucketSec) * bucketSec
          const val = item.combined_extrinsic
          const existing = ohlcBuckets.get(bucket)
          if (existing) {
            if (val > existing.high) existing.high = val
            if (val < existing.low) existing.low = val
            existing.close = val
          } else {
            ohlcBuckets.set(bucket, { time: bucket, open: val, high: val, low: val, close: val })
          }
        }
        const ohlcData = Array.from(ohlcBuckets.values()).sort((a, b) => a.time - b.time)
        combinedExtrinsicRef.current.setData(ohlcData)
      } else {
        combinedExtrinsicRef.current.setData(combinedData.map((item) => ({ time: item.time, value: item.combined_extrinsic })))
      }
    }

    if (volumeRef.current) {
      const dark = madhanMode === 'dark'
      volumeRef.current.setData(combinedData.map((item) => {
        apiCandleVolRef.current.set(item.time, item.combined_volume || 0)
        return {
          time: item.time,
          value: item.combined_volume || 0,
          color: dark ? 'rgba(38,166,154,0.5)' : 'rgba(38,166,154,0.6)',
        }
      }))
    }

    // Seed currentOhlcRef from the last API candle so WS update() continues
    // from real OHLC instead of creating a new candle from scratch
    if (!isBacktestRef.current && liveBucket > 0) {
      const lastCe = ceData.length > 0 ? ceData[ceData.length - 1] : null
      const lastPe = peData.length > 0 ? peData[peData.length - 1] : null
      if (lastCe && lastCe.time === liveBucket) {
        currentOhlcRef.current.set('ce', { time: lastCe.time, open: lastCe.open, high: lastCe.high, low: lastCe.low, close: lastCe.close })
      }
      if (lastPe && lastPe.time === liveBucket) {
        currentOhlcRef.current.set('pe', { time: lastPe.time, open: lastPe.open, high: lastPe.high, low: lastPe.low, close: lastPe.close })
      }
    }

    // Build PE close lookup for HC filter
    const peCloseMap = new Map<number, number>()
    for (const item of peData) peCloseMap.set(item.time, item.close)
    const ceCloseMap = new Map<number, number>()
    for (const item of ceData) ceCloseMap.set(item.time, item.close)
    const hc = showHCRef.current

    const ceMarkers = signals
      ? ceData.filter((item) => {
          if (!item.extrinsic_signal) return false
          if (hc) {
            const peClose = peCloseMap.get(item.time) ?? 0
            if (item.close <= peClose) return false
          }
          return true
        }).map((point) => ({
          time: point.time as Time, position: 'aboveBar' as const,
          color: '#00ff00', shape: 'circle' as const, text: 'CE↑',
        }))
      : []
    ceMarkersRef.current?.setMarkers(ceMarkers)

    const peMarkers = signals
      ? peData.filter((item) => {
          if (!item.extrinsic_signal) return false
          if (hc) {
            const ceClose = ceCloseMap.get(item.time) ?? 0
            if (item.close <= ceClose) return false
          }
          return true
        }).map((point) => ({
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

    // Render backtest trade markers
    const btTrades = backtestTradesRef.current
    if (btTrades.length > 0) {
      const ceTradeMarkers: Array<{ time: Time; position: 'aboveBar' | 'belowBar'; color: string; shape: 'arrowUp' | 'arrowDown' | 'circle'; text: string }> = []
      const peTradeMarkers: Array<{ time: Time; position: 'aboveBar' | 'belowBar'; color: string; shape: 'arrowUp' | 'arrowDown' | 'circle'; text: string }> = []
      for (const trade of btTrades) {
        if (trade.side === 'CE') {
          ceTradeMarkers.push({ time: trade.entryTime as Time, position: 'aboveBar', color: '#00e676', shape: 'arrowUp', text: `E ${trade.entryPrice.toFixed(0)}` })
          ceTradeMarkers.push({ time: trade.exitTime as Time, position: 'belowBar', color: trade.pnlPct >= 0 ? '#00e676' : '#ff1744', shape: 'arrowDown', text: `${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(1)}%` })
        } else {
          peTradeMarkers.push({ time: trade.entryTime as Time, position: 'aboveBar', color: '#e040fb', shape: 'arrowUp', text: `E ${trade.entryPrice.toFixed(0)}` })
          peTradeMarkers.push({ time: trade.exitTime as Time, position: 'belowBar', color: trade.pnlPct >= 0 ? '#00e676' : '#ff1744', shape: 'arrowUp', text: `${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(1)}%` })
        }
      }
      ceTradeMarkersRef.current?.setMarkers(ceTradeMarkers)
      peTradeMarkersRef.current?.setMarkers(peTradeMarkers)
    } else {
      ceTradeMarkersRef.current?.setMarkers([])
      peTradeMarkersRef.current?.setMarkers([])
    }
  }, [])

  const saveBacktest = useCallback(() => {
    const trades = backtestTradesRef.current
    if (trades.length === 0 || !backtestDateRef.current || !strikeNumRef.current) return
    const date = backtestDateRef.current
    const strike = strikeNumRef.current
    const fmt = (ts: number) => {
      const d = new Date(ts * 1000)
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
    const rows = [
      ['Strategy', 'Date', 'Strike', 'Side', 'Symbol', 'Qty', 'Entry Price', 'Entry Time', 'Exit Price', 'Exit Time', 'PnL%', 'PnL', 'Max Runup%', 'Reason'].join(','),
    ]
    for (const t of trades) {
      const reasonMap: Record<string, string> = { target: 'TGT', opposite: 'OPP', eod: 'EOD' }
      rows.push([
        t.strategy, t.date, t.strike, t.side, t.symbol, t.lotSize,
        t.entryPrice.toFixed(0), fmt(t.entryTime),
        t.exitPrice.toFixed(0), fmt(t.exitTime),
        `${t.pnlPct.toFixed(1)}%`, t.pnlAmount.toFixed(0),
        `${t.maxRunupPct.toFixed(1)}%`,
        reasonMap[t.exitReason] || t.exitReason,
      ].join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${date}_strike${strike}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const fetchRangeBacktest = useCallback(async () => {
    if (!rangeFrom || !rangeTo) return
    setRangeLoading(true)
    setRangeResults(null)
    try {
      const res = await fetch(`/madhan/api/nifty/backtest_range?from=${rangeFrom}&to=${rangeTo}&_=${Date.now()}`)
      const json: RangeResponse = await res.json()
      if (json.status === 'error' || !json.strategies) return
      setRangeResults(json)
      const allStrats = Object.keys(json.strategies)
      setRangeVisibleStrategies(new Set(allStrats))
    } catch (err) {
      console.error('Error fetching range backtest:', err)
    } finally {
      setRangeLoading(false)
    }
  }, [rangeFrom, rangeTo])

  const saveRangeBacktest = useCallback(() => {
    if (!rangeResults) return
    const fmt = (ts: number) => {
      const d = new Date(ts * 1000)
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
    const rows = [
      ['Strategy', 'Method', 'Date', 'Strike', 'Side', 'Symbol', 'Qty', 'Entry Price', 'Entry Time', 'Exit Price', 'Exit Time', 'PnL%', 'PnL', 'Max Runup%', 'Reason'].join(','),
    ]
    for (const strat of Object.keys(rangeResults.strategies)) {
      if (!rangeVisibleStrategies.has(strat)) continue
      for (const t of rangeResults.strategies[strat].trades) {
        const reasonMap: Record<string, string> = { target: 'TGT', opposite: 'OPP', eod: 'EOD' }
        rows.push([
          t.strategy, t.method || '', t.date, t.strike, t.side, t.symbol, t.lotSize,
          t.entryPrice.toFixed(0), fmt(t.entryTime),
          t.exitPrice.toFixed(0), fmt(t.exitTime),
          `${t.pnlPct.toFixed(1)}%`, t.pnlAmount.toFixed(0),
          `${t.maxRunupPct.toFixed(1)}%`,
          reasonMap[t.exitReason] || t.exitReason,
        ].join(','))
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `backtest_${rangeResults.from_date}_to_${rangeResults.to_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [rangeResults, rangeVisibleStrategies])

  const clearAllChartData = useCallback(() => {
    rawDataRef.current = null
    currentOhlcRef.current.clear()
    apiCandleVolRef.current.clear()
    if (ceSeriesRef.current) ceSeriesRef.current.setData([])
    if (peSeriesRef.current) peSeriesRef.current.setData([])
    if (combinedSeriesRef.current) combinedSeriesRef.current.setData([])
    if (llpSeriesRef.current) llpSeriesRef.current.setData([])
    if (ceIntrinsicRef.current) ceIntrinsicRef.current.setData([])
    if (peIntrinsicRef.current) peIntrinsicRef.current.setData([])
    if (ceExtrinsicRef.current) ceExtrinsicRef.current.setData([])
    if (peExtrinsicRef.current) peExtrinsicRef.current.setData([])
    if (combinedExtrinsicRef.current) combinedExtrinsicRef.current.setData([])
    if (volumeRef.current) volumeRef.current.setData([])
    if (totalVolumeRef.current) totalVolumeRef.current.setData([])
    if (trustMeUpRef.current) trustMeUpRef.current.setData([])
    if (trustMeDownRef.current) trustMeDownRef.current.setData([])
    if (ceMarkersRef.current) ceMarkersRef.current.setMarkers([])
    if (peMarkersRef.current) peMarkersRef.current.setMarkers([])
    if (cpCeMarkersRef.current) cpCeMarkersRef.current.setMarkers([])
    if (combinedExtrinsicMarkersRef.current) combinedExtrinsicMarkersRef.current.setMarkers([])
    if (ceTradeMarkersRef.current) ceTradeMarkersRef.current.setMarkers([])
    if (peTradeMarkersRef.current) peTradeMarkersRef.current.setMarkers([])
  }, [])

  const loadData = useCallback(async () => {
    if (!selectedStrike) return
    clearAllChartData()
    try {
      // In backtest mode, load from parquet via backtest endpoint
      if (isBacktest && backtestDate) {
        const res = await fetch(`/madhan/api/nifty/backtest_chart_data?date=${backtestDate}&strike=${selectedStrike}&_=${Date.now()}`)
        const json: OptionDataResponse = await res.json()
        if (json.status !== 'success' || !json.data) return
        rawDataRef.current = json.data
        strikeNumRef.current = json.data.strike
        currentOhlcRef.current.clear()
        apiCandleVolRef.current.clear()
        setCeSymbol(json.data.ce_symbol || '')
        setPeSymbol(json.data.pe_symbol || '')
        ceSymbolRef.current = json.data.ce_symbol || ''
        peSymbolRef.current = json.data.pe_symbol || ''
        setAvailableStrategies(json.data.strategies || ['CE-PE'])
        setVisibleStrategies(new Set(json.data.strategies || ['CE-PE']))
        const allTrades: BacktestTrade[] = []
        let totalWins = 0, totalLosses = 0, totalPnl = 0, totalPnlAmount = 0
        for (const strat of (json.data.strategies || [])) {
          const stratTrades = json.data.trades?.[strat] || []
          allTrades.push(...stratTrades)
          const summ = json.data.summary?.[strat]
          if (summ) {
            totalWins += summ.wins
            totalLosses += summ.losses
            totalPnl += summ.totalPnl
            totalPnlAmount += summ.totalPnlAmount
          }
        }
        backtestTradesRef.current = allTrades
        if (allTrades.length > 0) {
          backtestSummaryRef.current = { total: allTrades.length, wins: totalWins, losses: totalLosses, winRate: totalWins / allTrades.length * 100, totalPnl, totalPnlAmount }
          setBacktestSummary(backtestSummaryRef.current)
        } else {
          backtestSummaryRef.current = null
          setBacktestSummary(null)
        }
        setChartInfo(`[Backtest ${backtestDate}] Strike ${json.data.strike} - CE: ${json.data.ce_symbol || 'N/A'} | PE: ${json.data.pe_symbol || 'N/A'}`)
        applyData()
        return
      }
      // Live mode — existing logic
      const res = await fetch(`/madhan/api/ezayChart_data?strike=${selectedStrike}&_=${Date.now()}`)
      const json: OptionDataResponse = await res.json()
      if (json.status !== 'success' || !json.data) return
      rawDataRef.current = json.data
      strikeNumRef.current = json.data.strike
      currentOhlcRef.current.clear()
      apiCandleVolRef.current.clear()
      setCeSymbol(json.data.ce_symbol || '')
      setPeSymbol(json.data.pe_symbol || '')
      ceSymbolRef.current = json.data.ce_symbol || ''
      peSymbolRef.current = json.data.pe_symbol || ''
      setChartInfo(`Strike ${json.data.strike} - CE: ${json.data.ce_symbol || 'N/A'} | PE: ${json.data.pe_symbol || 'N/A'} (${json.data.timezone || 'UTC'})`)
      applyData()
    } catch (err) {
      console.error('Error loading EzayChart data:', err)
    }
  }, [selectedStrike, applyData, isBacktest, backtestDate, clearAllChartData])

  // Lightweight incremental update for live polling — avoids clearing all series data
  // which causes a visual "flash" / "page refresh" feeling every minute
  const updateLiveData = useCallback(async () => {
    if (!selectedStrike) return
    try {
      const res = await fetch(`/madhan/api/ezayChart_data?strike=${selectedStrike}&_=${Date.now()}`)
      const json: OptionDataResponse = await res.json()
      if (json.status !== 'success' || !json.data) return
      rawDataRef.current = json.data
      strikeNumRef.current = json.data.strike
      currentOhlcRef.current.clear()
      apiCandleVolRef.current.clear()
      // Update symbols if changed
      const newCeSymbol = json.data.ce_symbol || ''
      const newPeSymbol = json.data.pe_symbol || ''
      if (newCeSymbol !== ceSymbolRef.current) {
        setCeSymbol(newCeSymbol)
        ceSymbolRef.current = newCeSymbol
      }
      if (newPeSymbol !== peSymbolRef.current) {
        setPeSymbol(newPeSymbol)
        peSymbolRef.current = newPeSymbol
      }
      // Apply data directly without clearing series first
      applyData()
    } catch (err) {
      console.error('Error updating live EzayChart data:', err)
    }
  }, [selectedStrike, applyData])

  const fetchPositions = useCallback(async () => {
    const apiKey = useAuthStore.getState().apiKey
    if (!apiKey || isBacktestRef.current) return
    try {
      const res = await fetch('/api/v1/positionbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey: apiKey }),
      })
      const json = await res.json()
      if (json.status !== 'success' || !json.data) return
      const positions: any[] = json.data
      const curCe = ceSymbolRef.current
      const curPe = peSymbolRef.current
      if (!curCe && !curPe) return
      let foundCe: PositionDatum | null = null
      let foundPe: PositionDatum | null = null
      const matchSym = (a: string, b: string) => a === b || a.endsWith(b) || b.endsWith(a) || a.replace(/^.*:/, '') === b.replace(/^.*:/, '')
      for (const p of positions) {
        if (Number(p.quantity) === 0) continue
        const sym = p.symbol
        const net = Number(p.quantity)
        const avg = Number(p.average_price)
        const pnl = Number(p.pnl) || 0
        const side: 'LONG' | 'SHORT' = net > 0 ? 'LONG' : 'SHORT'
        if (matchSym(sym, curCe)) {
          foundCe = { side, type: 'CE', qty: Math.abs(net), entryPrice: avg, pnl, symbol: curCe, exchange: p.exchange, product: p.product }
        } else if (matchSym(sym, curPe)) {
          foundPe = { side, type: 'PE', qty: Math.abs(net), entryPrice: avg, pnl, symbol: curPe, exchange: p.exchange, product: p.product }
        }
      }
      cePositionDataRef.current = foundCe
      pePositionDataRef.current = foundPe
      cePositionRef.current?.setData(foundCe ? [foundCe] : [])
      pePositionRef.current?.setData(foundPe ? [foundPe] : [])
    } catch {}
  }, [])

  const fetchOrders = useCallback(async () => {
    const apiKey = useAuthStore.getState().apiKey
    if (!apiKey || isBacktestRef.current) return
    try {
      const res = await fetch('/api/v1/orderbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey: apiKey }),
      })
      const json = await res.json()
      if (json.status !== 'success' || !json.data) return
      const rawOrders: any[] = json.data.orders || []
      const curCe = ceSymbolRef.current
      const curPe = peSymbolRef.current
      if (!curCe && !curPe) return
      const ceOrders: OrderLineDatum[] = []
      const peOrders: OrderLineDatum[] = []
      const matchSym = (a: string, b: string) => a === b || a.endsWith(b) || b.endsWith(a) || a.replace(/^.*:/, '') === b.replace(/^.*:/, '')
      const isCE = (sym: string) => curCe && matchSym(sym, curCe)
      const isPE = (sym: string) => curPe && matchSym(sym, curPe)
      for (const o of rawOrders) {
        const status = o.order_status
        if (status !== 'open' && status !== 'pending' && status !== 'trigger pending') continue
        const sym = o.symbol
        if (!isCE(sym) && !isPE(sym)) continue
        const ord: OrderLineDatum = {
          side: o.action,
          type: isCE(sym) ? 'CE' : 'PE',
          orderType: o.pricetype,
          qty: Math.abs(Number(o.quantity)),
          price: (o.pricetype === 'SL' || o.pricetype === 'SL-M')
            ? (Number(o.trigger_price) || 0)
            : (Number(o.price) || 0),
          triggerPrice: Number(o.trigger_price) || 0,
          symbol: isCE(sym) ? curCe : curPe,
          exchange: o.exchange,
          product: o.product,
          orderId: o.orderid,
        }
        if (ord.price <= 0) continue
        if (isCE(sym)) ceOrders.push(ord)
        else peOrders.push(ord)
      }
      ceOrderRef.current?.setData(ceOrders)
      peOrderRef.current?.setData(peOrders)
    } catch {}
  }, [])

  const handleClosePosition = useCallback(async (symbol: string, exchange: string, product: string) => {
    if (isClosingRef.current) return
    isClosingRef.current = true
    try {
      const apiKey = useAuthStore.getState().apiKey
      if (!apiKey) { isClosingRef.current = false; return }
      const res = await tradingApi.closePosition(symbol, exchange, product)
      const orderId = (res as any).orderid || (res as any).data?.orderid
      if (!orderId) { fetchPositions(); isClosingRef.current = false; return }
      let attempts = 0
      const poll = async () => {
        attempts++
        if (attempts > 30) { fetchPositions(); isClosingRef.current = false; return }
        try {
          const oRes = await fetch('/api/v1/orderbook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apikey: apiKey }),
          })
          const oJson = await oRes.json()
          const orders = oJson.data?.orders || []
          const order = orders.find((o: any) => o.orderid === orderId)
          if (order && (order.order_status === 'complete' || order.order_status === 'rejected' || order.order_status === 'cancelled')) {
            fetchPositions()
            setTimeout(fetchPositions, 1500)
            setTimeout(fetchPositions, 3500)
            isClosingRef.current = false
            return
          }
          setTimeout(poll, 1000)
        } catch { setTimeout(poll, 1000) }
      }
      poll()
    } catch { fetchPositions(); isClosingRef.current = false }
  }, [fetchPositions])
  handleClosePositionRef.current = handleClosePosition

  const handleCancelOrder = useCallback(async (orderId: string) => {
    if (isCancellingRef.current) return
    isCancellingRef.current = true
    try {
      const apiKey = useAuthStore.getState().apiKey
      if (!apiKey) { isCancellingRef.current = false; return }
      await (tradingApi.cancelOrder as any)(orderId, 'EzayChart Cancellation')
      let attempts = 0
      const poll = async () => {
        attempts++
        if (attempts > 30) { fetchOrders(); isCancellingRef.current = false; return }
        try {
          const oRes = await fetch('/api/v1/orderbook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apikey: apiKey }),
          })
          const oJson = await oRes.json()
          const orders = oJson.data?.orders || []
          const order = orders.find((o: any) => o.orderid === orderId)
          if (order && (order.order_status === 'cancelled' || order.order_status === 'rejected')) {
            fetchOrders()
            isCancellingRef.current = false
            return
          }
          setTimeout(poll, 1000)
        } catch { setTimeout(poll, 1000) }
      }
      poll()
    } catch { fetchOrders(); isCancellingRef.current = false }
  }, [fetchOrders])
  handleCancelOrderRef.current = handleCancelOrder

  const handleModifyOrder = useCallback(async (orderId: string, newPrice: number) => {
    const ceOrders = ceOrderRef.current?._orders || []
    const peOrders = peOrderRef.current?._orders || []
    const ord = ceOrders.find(o => o.orderId === orderId) || peOrders.find(o => o.orderId === orderId)
    if (!ord) return
    try {
      const isSl = ord.orderType === 'SL' || ord.orderType === 'SL-M'
      const isLimit = ord.orderType === 'LIMIT'
      const round005 = (v: number, up: boolean) => {
        const step = 0.05
        const rounded = up ? Math.ceil(v / step) * step : Math.floor(v / step) * step
        return Math.round(rounded * 100) / 100
      }
      const cleanPrice = Math.round(newPrice * 100) / 100
      const triggerPrice = isSl ? cleanPrice : 0
      const limitPrice = isSl
        ? (ord.side === 'BUY'
            ? round005(cleanPrice + 0.05, true)
            : round005(cleanPrice - 0.05, false))
        : (isLimit ? cleanPrice : 0)
      const res = await (tradingApi.modifyOrder as any)(orderId, {
        symbol: ord.symbol,
        exchange: ord.exchange,
        action: ord.side,
        product: ord.product,
        pricetype: ord.orderType,
        quantity: ord.qty,
        price: limitPrice,
        trigger_price: triggerPrice,
        disclosed_quantity: 0,
        strategy: 'EzayChart Modification',
      })
      if (res.status === 'success') {
        fetchOrders()
      }
    } catch {}
  }, [fetchOrders])
  handleModifyOrderRef.current = handleModifyOrder

  const pollOrderStatus = useCallback(async (orderid: string, pricetype: string) => {
    const apiKey = useAuthStore.getState().apiKey
    if (!apiKey) return
    const isMarket = pricetype === 'MARKET'
    setOrderStatus('executing')
    const poll = async (attempts: number) => {
      if (attempts > 60) { setOrderStatus('idle'); setIsPlacingOrder(false); isPlacingOrderRef.current = false; return }
      try {
        const res = await fetch('/api/v1/orderbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apikey: apiKey }),
        })
        const json = await res.json()
        const orders = json.data?.orders || []
        const order = orders.find((o: any) => o.orderid === orderid)
        if (!order) { setTimeout(() => poll(attempts + 1), 1000); return }
        const st = order.order_status
        if (st === 'rejected' || st === 'cancelled') {
          setOrderStatus('idle')
          setIsPlacingOrder(false)
          isPlacingOrderRef.current = false
          fetchOrders()
          return
        }
        if (isMarket) {
          if (st === 'complete') {
            setOrderStatus('idle')
            setIsPlacingOrder(false)
            isPlacingOrderRef.current = false
            fetchOrders()
            fetchPositions()
            setTimeout(fetchPositions, 1500)
            setTimeout(fetchPositions, 3500)
            setTimeout(fetchOrders, 1500)
            return
          }
          setTimeout(() => poll(attempts + 1), 1000)
        } else {
          if (st === 'open' || st === 'pending' || st === 'trigger pending') {
            setOrderStatus('idle')
            setIsPlacingOrder(false)
            isPlacingOrderRef.current = false
            fetchOrders()
            return
          }
          setTimeout(() => poll(attempts + 1), 1000)
        }
      } catch {
        setTimeout(() => poll(attempts + 1), 1000)
      }
    }
    poll(0)
  }, [fetchOrders, fetchPositions])

  const handlePlaceOrder = useCallback(async (req: any) => {
    if (isPlacingOrderRef.current) return
    setIsPlacingOrder(true)
    isPlacingOrderRef.current = true
    setOrderStatus('placing')
    try {
      const apiKey = useAuthStore.getState().apiKey
      if (!apiKey) { setOrderStatus('idle'); setIsPlacingOrder(false); isPlacingOrderRef.current = false; return }
      const orderReq = { ...req, apikey: apiKey }
      const res = await tradingApi.placeOrder(orderReq)
      const orderId = res.data?.orderid || (res as any).orderid
      if (res.status === 'success' && orderId) {
        pollOrderStatus(orderId, req.pricetype || 'MARKET')
      } else {
        setOrderStatus('idle')
        setIsPlacingOrder(false)
        isPlacingOrderRef.current = false
      }
    } catch {
      setOrderStatus('idle')
      setIsPlacingOrder(false)
      isPlacingOrderRef.current = false
    }
  }, [pollOrderStatus])

  const tradePanelSide = 'CE'
  const tradePanelPrice = 0

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

    chart.subscribeClick((param: any) => {
      if (!param || !param.point) return
      const { x, y } = param.point
      const W = chartContainerRef.current?.clientWidth || 0
      const H = chartContainerRef.current?.clientHeight || 0
      const hitCe = cePositionRef.current?.hitTest(x, y, W, H)
      if (hitCe) {
        const pos = cePositionDataRef.current
        if (pos) handleClosePositionRef.current(pos.symbol, pos.exchange, pos.product)
        return
      }
      const hitPe = pePositionRef.current?.hitTest(x, y, W, H)
      if (hitPe) {
        const pos = pePositionDataRef.current
        if (pos) handleClosePositionRef.current(pos.symbol, pos.exchange, pos.product)
        return
      }
      const hitCeOrd = ceOrderRef.current?.hitTest(x, y, W, H)
      if (hitCeOrd) {
        handleCancelOrderRef.current(hitCeOrd as string)
        return
      }
      const hitPeOrd = peOrderRef.current?.hitTest(x, y, W, H)
      if (hitPeOrd) {
        handleCancelOrderRef.current(hitPeOrd as string)
        return
      }
      tradePanelClickRef.current(y)
    })

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return
      chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight })
    })
    resizeObserver.observe(chartContainerRef.current)

    loadStrikes()

    // Start NiftyFetcher on page open
    fetch('/madhan/api/nifty/start', { method: 'POST' }).catch(() => {})

    return () => {
      if (updaterRef.current) window.clearTimeout(updaterRef.current)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      chartReadyRef.current = false
    trustMeUpRef.current = null
    trustMeDownRef.current = null
    strikeWatermarkRef.current = null
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
  }, [madhanMode, getChartColors])

  useEffect(() => {
    if (chartReadyRef.current && chartRef.current) {
      chartTypeRef.current = chartType
      createAllSeries()
      applyData()
      // Re-apply visibility after series recreation
      if (ceIntrinsicRef.current) ceIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
      if (peIntrinsicRef.current) peIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
      if (ceExtrinsicRef.current) ceExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
      if (peExtrinsicRef.current) peExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
      if (combinedSeriesRef.current) combinedSeriesRef.current.applyOptions({ visible: showCombinedAll })
      if (llpSeriesRef.current) llpSeriesRef.current.applyOptions({ visible: showCombinedAll })
      if (combinedExtrinsicRef.current) combinedExtrinsicRef.current.applyOptions({ visible: showCombinedAll })
      if (ceSeriesRef.current) ceSeriesRef.current.applyOptions({ visible: showCE })
      if (peSeriesRef.current) peSeriesRef.current.applyOptions({ visible: showPE })
    }
  }, [chartType, createAllSeries])

  useEffect(() => {
    semiTransparentRef.current = semiTransparent
    if (chartReadyRef.current && chartRef.current) {
      createAllSeries()
      applyData()
      // Re-apply visibility after series recreation
      if (ceIntrinsicRef.current) ceIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
      if (peIntrinsicRef.current) peIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
      if (ceExtrinsicRef.current) ceExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
      if (peExtrinsicRef.current) peExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
      if (combinedSeriesRef.current) combinedSeriesRef.current.applyOptions({ visible: showCombinedAll })
      if (llpSeriesRef.current) llpSeriesRef.current.applyOptions({ visible: showCombinedAll })
      if (combinedExtrinsicRef.current) combinedExtrinsicRef.current.applyOptions({ visible: showCombinedAll })
      if (ceSeriesRef.current) ceSeriesRef.current.applyOptions({ visible: showCE })
      if (peSeriesRef.current) peSeriesRef.current.applyOptions({ visible: showPE })
    }
  }, [semiTransparent, createAllSeries])

  // Update strike watermark when selected strike changes
  useEffect(() => {
    if (!chartReadyRef.current || !chartRef.current) return
    const strikeVal = selectedStrike || (strikeNumRef.current ? String(strikeNumRef.current) : '')
    if (!strikeVal) return
    // Detach old watermark
    if (strikeWatermarkRef.current) {
      try { strikeWatermarkRef.current.detach() } catch {}
      strikeWatermarkRef.current = null
    }
    const isDark = madhanMode === 'dark'
    strikeWatermarkRef.current = createTextWatermark(chartRef.current.panes()[0], {
      horzAlign: 'center',
      vertAlign: 'center',
      lines: [{
        text: `Strike ${strikeVal}`,
        color: isDark ? 'rgba(166,173,187,0.3)' : 'rgba(0,0,0,0.15)',
        fontSize: 48,
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
      }],
    })
  }, [selectedStrike, madhanMode])

  useEffect(() => {
    if (ceIntrinsicRef.current) ceIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
    if (peIntrinsicRef.current) peIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
    if (ceExtrinsicRef.current) ceExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
    if (peExtrinsicRef.current) peExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
  }, [showIntrinsic, showExtrinsic])

  useEffect(() => {
    if (ceSeriesRef.current) ceSeriesRef.current.applyOptions({ visible: showCE })
    if (peSeriesRef.current) peSeriesRef.current.applyOptions({ visible: showPE })
  }, [showCE, showPE])

  useEffect(() => {
    if (combinedSeriesRef.current) combinedSeriesRef.current.applyOptions({ visible: showCombinedAll })
    if (llpSeriesRef.current) llpSeriesRef.current.applyOptions({ visible: showCombinedAll })
    if (combinedExtrinsicRef.current) combinedExtrinsicRef.current.applyOptions({ visible: showCombinedAll })
  }, [showCombinedAll])

  useEffect(() => {
    showSignalsRef.current = showSignals
    showHCRef.current = showHC
    applyData()
  }, [showSignals, showHC, applyData])

  // Signals + hx_lx_vol data consumed by Total Volume, TrustMe, and EzaySignals
  // Extracted as useCallback so the live polling can re-fetch every minute
  // Note: avoids unnecessary React state updates (like applyData) to prevent chart component re-renders
  const refetchSignals = useCallback(async () => {
    const bt = isBacktestRef.current
    const dt = backtestDateRef.current
    // Only clear refs — React state is updated only when new data arrives below
    signalsResponseRef.current = null
    signalsDataRef.current = []
    signalsMetaRef.current = null
    signalsLastTimeRef.current = 0
    signalsLastFetchedRef.current = Date.now()
    try {
      const url = bt && dt
        ? `/madhan/api/nifty/backtest_signals?date=${dt}&_=${Date.now()}`
        : `/madhan/api/ezayChart_signals?_=${Date.now()}`
      const res = await fetch(url)
      const json = await res.json()
      if (json.status !== 'success' || !json.data) return
      signalsResponseRef.current = json
      // Flatten ezay_signals into SignalRow[]
      const flat: SignalRow[] = []
      for (const entry of json.data) {
        if (entry.ezay_signals) {
          for (const sig of entry.ezay_signals) {
            flat.push({ ...sig, time: entry.time })
          }
        }
      }
      signalsDataRef.current = flat
      signalsMetaRef.current = json.signals || null
      signalsLastTimeRef.current = json.last_time || 0
      // Update state for EzaySignals panel (only when visible to avoid unnecessary re-renders)
      if (showEzaySignals) {
        setSignalsForPanel(flat)
        setSignalsMetaForPanel(json.signals || null)
        setSignalsLastTime(json.last_time || 0)
      }
      const dark = madhanMode === 'dark'
      // Render Total Volume if active
      if (volumeMode === 'total') {
        const raw: TotalVolEntry[] = []
        for (const entry of json.data) {
          if (entry.hx_lx_vol) {
            raw.push({ time: entry.time, combined: (entry.hx_lx_vol.ce_vol || 0) + (entry.hx_lx_vol.pe_vol || 0) })
          }
        }
        if (raw.length) {
          const intervalMin = getIntervalMinutes(intervalRef.current)
          const data = intervalMin > 1 ? aggregateTotalVolume(raw, intervalMin) : raw
          totalVolumeDataRef.current = data
          if (totalVolumeRef.current) {
            totalVolumeRef.current.setData(data.map((d) => ({
              time: d.time as Time,
              value: d.combined,
              color: dark ? 'rgba(38,166,154,0.5)' : 'rgba(38,166,154,0.6)',
            })))
          }
        }
      }
      // Render TrustMe if series exist
      if (showTrustMeRef.current && trustMeUpRef.current && trustMeDownRef.current) {
        const intervalMin = getIntervalMinutes(intervalRef.current)
        const rawEntries: TrustMeEntry[] = []
        for (const entry of json.data) {
          if (!entry.hx_lx_vol) continue
          const { ce_hx = 0, pe_hx = 0, ce_lx = 0, pe_lx = 0 } = entry.hx_lx_vol
          rawEntries.push({ time: entry.time, upside: ce_hx + pe_lx, downside: pe_hx + ce_lx })
        }
        const aggregated = aggregateTrustMe(rawEntries, intervalMin)
        const upData: Array<{ time: Time; value: number; color: string }> = []
        const downData: Array<{ time: Time; value: number; color: string }> = []
        for (const item of aggregated) {
          if (item.upside > 0) upData.push({ time: item.time as Time, value: item.upside, color: dark ? 'rgba(33,150,243,0.7)' : 'rgba(33,150,243,0.8)' })
          if (item.downside > 0) downData.push({ time: item.time as Time, value: item.downside, color: dark ? 'rgba(244,67,54,0.7)' : 'rgba(244,67,54,0.8)' })
        }
        if (upData.length) trustMeUpRef.current.setData(upData)
        if (downData.length) trustMeDownRef.current.setData(downData)
      }
    } catch {}
  }, [madhanMode, volumeMode, showEzaySignals])

  // Single fetch: signals + hx_lx_vol data consumed by Total Volume, TrustMe, and EzaySignals
  useEffect(() => {
    refetchSignals()
  }, [madhanMode, isBacktest, backtestDate, selectedStrike, refetchSignals])

  // Volume mode: toggle series visibility + render total volume from cached data
  useEffect(() => {
    const isTotal = volumeMode === 'total'
    if (volumeRef.current) volumeRef.current.applyOptions({ visible: !isTotal })
    if (totalVolumeRef.current) totalVolumeRef.current.applyOptions({ visible: isTotal })
    if (!isTotal) return
    const json = signalsResponseRef.current
    if (!json || !json.data) return
    const dark = madhanMode === 'dark'
    const raw: TotalVolEntry[] = []
    for (const entry of json.data) {
      if (entry.hx_lx_vol) {
        raw.push({ time: entry.time, combined: (entry.hx_lx_vol.ce_vol || 0) + (entry.hx_lx_vol.pe_vol || 0) })
      }
    }
    if (!raw.length) return
    const intervalMin = getIntervalMinutes(intervalRef.current)
    const data = intervalMin > 1 ? aggregateTotalVolume(raw, intervalMin) : raw
    totalVolumeDataRef.current = data
    if (totalVolumeRef.current) {
      totalVolumeRef.current.setData(data.map((d) => ({
        time: d.time as Time,
        value: d.combined,
        color: dark ? 'rgba(38,166,154,0.5)' : 'rgba(38,166,154,0.6)',
      })))
    }
  }, [volumeMode, madhanMode, isBacktest, backtestDate, interval])

   // TrustMe: lazily create series on pane 1, render from cached data
  useEffect(() => {
    showTrustMeRef.current = showTrustMe
    const chart = chartRef.current
    if (!showTrustMe) {
      if (trustMeUpRef.current) { try { chart?.removeSeries(trustMeUpRef.current) } catch {} trustMeUpRef.current = null }
      if (trustMeDownRef.current) { try { chart?.removeSeries(trustMeDownRef.current) } catch {} trustMeDownRef.current = null }
      return
    }
    if (!chart) return
    // Create series on demand
    if (!trustMeUpRef.current) {
      trustMeUpRef.current = chart.addSeries(HistogramSeries, {
        priceLineVisible: true, lastValueVisible: true, crosshairMarkerVisible: false,
        priceFormat: { type: 'volume' }, visible: true,
      } as any, 1)
    }
    if (!trustMeDownRef.current) {
      trustMeDownRef.current = chart.addSeries(HistogramSeries, {
        priceLineVisible: true, lastValueVisible: true, crosshairMarkerVisible: false,
        priceFormat: { type: 'volume' }, visible: true,
      } as any, 1)
    }
    try {
      const panes = chart.panes()
      if (panes.length > 1) panes[1].setHeight(100)
    } catch {}
    // Render from cached data
    const json = signalsResponseRef.current
    if (!json || !json.data) return
    const dark = madhanMode === 'dark'
    const intervalMin = getIntervalMinutes(intervalRef.current)
    const rawEntries: TrustMeEntry[] = []
    for (const entry of json.data) {
      if (!entry.hx_lx_vol) continue
      const { ce_hx = 0, pe_hx = 0, ce_lx = 0, pe_lx = 0 } = entry.hx_lx_vol
      rawEntries.push({ time: entry.time, upside: ce_hx + pe_lx, downside: pe_hx + ce_lx })
    }
    const aggregated = aggregateTrustMe(rawEntries, intervalMin)
    const upData: Array<{ time: Time; value: number; color: string }> = []
    const downData: Array<{ time: Time; value: number; color: string }> = []
    for (const item of aggregated) {
      if (item.upside > 0) upData.push({ time: item.time as Time, value: item.upside, color: dark ? 'rgba(33,150,243,0.7)' : 'rgba(33,150,243,0.8)' })
      if (item.downside > 0) downData.push({ time: item.time as Time, value: item.downside, color: dark ? 'rgba(244,67,54,0.7)' : 'rgba(244,67,54,0.8)' })
    }
    if (upData.length) trustMeUpRef.current.setData(upData)
    if (downData.length) trustMeDownRef.current.setData(downData)
  }, [showTrustMe, madhanMode, isBacktest, backtestDate, interval])

  useEffect(() => {
    intervalRef.current = interval
    if (chartReadyRef.current && chartRef.current) {
      createAllSeries()
      applyData()
      if (ceIntrinsicRef.current) ceIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
      if (peIntrinsicRef.current) peIntrinsicRef.current.applyOptions({ visible: showIntrinsic })
      if (ceExtrinsicRef.current) ceExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
      if (peExtrinsicRef.current) peExtrinsicRef.current.applyOptions({ visible: showExtrinsic })
      if (combinedSeriesRef.current) combinedSeriesRef.current.applyOptions({ visible: showCombinedAll })
      if (llpSeriesRef.current) llpSeriesRef.current.applyOptions({ visible: showCombinedAll })
      if (combinedExtrinsicRef.current) combinedExtrinsicRef.current.applyOptions({ visible: showCombinedAll })
      if (ceSeriesRef.current) ceSeriesRef.current.applyOptions({ visible: showCE })
      if (peSeriesRef.current) peSeriesRef.current.applyOptions({ visible: showPE })
      // Restore volume mode visibility
      const isTotal = volumeMode === 'total'
      if (volumeRef.current) volumeRef.current.applyOptions({ visible: !isTotal })
      if (totalVolumeRef.current) totalVolumeRef.current.applyOptions({ visible: isTotal })
    }
  }, [interval, applyData])

  // Re-render TrustMe and TotalVolume data when interval changes (using cached signals data)
  useEffect(() => {
    const json = signalsResponseRef.current
    if (!json || !json.data) return
    const dark = madhanMode === 'dark'
    const intervalMin = getIntervalMinutes(interval)
    const isTotal = volumeMode === 'total'
    // Re-render Total Volume with new interval aggregation
    if (isTotal && totalVolumeRef.current) {
      const raw: TotalVolEntry[] = []
      for (const entry of json.data) {
        if (entry.hx_lx_vol) {
          raw.push({ time: entry.time, combined: (entry.hx_lx_vol.ce_vol || 0) + (entry.hx_lx_vol.pe_vol || 0) })
        }
      }
      if (raw.length) {
        const data = intervalMin > 1 ? aggregateTotalVolume(raw, intervalMin) : raw
        totalVolumeDataRef.current = data
        totalVolumeRef.current.setData(data.map((d) => ({
          time: d.time as Time,
          value: d.combined,
          color: dark ? 'rgba(38,166,154,0.5)' : 'rgba(38,166,154,0.6)',
        })))
      }
    }
    // Re-render TrustMe with new interval aggregation
    if (showTrustMeRef.current && json.data) {
      const chart = chartRef.current
      if (!chart) return
      // Destroy and recreate TrustMe series on pane 1 (in case createAllSeries moved them)
      if (trustMeUpRef.current) { try { chart.removeSeries(trustMeUpRef.current) } catch {} trustMeUpRef.current = null }
      if (trustMeDownRef.current) { try { chart.removeSeries(trustMeDownRef.current) } catch {} trustMeDownRef.current = null }
       trustMeUpRef.current = chart.addSeries(HistogramSeries, {
        priceLineVisible: true, lastValueVisible: true, crosshairMarkerVisible: false,
        priceFormat: { type: 'volume' }, visible: true,
      } as any, 1)
      trustMeDownRef.current = chart.addSeries(HistogramSeries, {
        priceLineVisible: true, lastValueVisible: true, crosshairMarkerVisible: false,
        priceFormat: { type: 'volume' }, visible: true,
      } as any, 1)
      try {
        const panes = chart.panes()
        if (panes.length > 1) panes[1].setHeight(100)
      } catch {}
      if (!trustMeUpRef.current || !trustMeDownRef.current) return
      const rawEntries: TrustMeEntry[] = []
      for (const entry of json.data) {
        if (!entry.hx_lx_vol) continue
        const { ce_hx = 0, pe_hx = 0, ce_lx = 0, pe_lx = 0 } = entry.hx_lx_vol
        rawEntries.push({ time: entry.time, upside: ce_hx + pe_lx, downside: pe_hx + ce_lx })
      }
      const aggregated = aggregateTrustMe(rawEntries, intervalMin)
      const upData: Array<{ time: Time; value: number; color: string }> = []
      const downData: Array<{ time: Time; value: number; color: string }> = []
      for (const item of aggregated) {
        if (item.upside > 0) upData.push({ time: item.time as Time, value: item.upside, color: dark ? 'rgba(33,150,243,0.7)' : 'rgba(33,150,243,0.8)' })
        if (item.downside > 0) downData.push({ time: item.time as Time, value: item.downside, color: dark ? 'rgba(244,67,54,0.7)' : 'rgba(244,67,54,0.8)' })
      }
      if (upData.length) trustMeUpRef.current.setData(upData)
      if (downData.length) trustMeDownRef.current.setData(downData)
    }
  }, [interval, volumeMode, madhanMode])

  useEffect(() => {
    const update = () => {
      const intervalMin = getIntervalMinutes(intervalRef.current)
      const bucketSec = intervalMin * 60
      const now = Math.floor((Date.now() + getTimeOffset()) / 1000)
      const nextBucket = Math.floor(now / bucketSec) * bucketSec + bucketSec
      const remaining = nextBucket - now
      if (intervalMin >= 60) {
        const h = Math.floor(remaining / 3600)
        const m = Math.floor((remaining % 3600) / 60)
        setCandleCountdown(h > 0 ? `${h}h ${m}m` : `${m}m`)
      } else if (intervalMin >= 5) {
        const m = Math.floor(remaining / 60)
        const s = remaining % 60
        setCandleCountdown(`${m}:${String(s).padStart(2, '0')}`)
      } else {
        setCandleCountdown(`${remaining}s`)
      }
    }
    update()
    const id = window.setInterval(update, 1000)
    return () => window.clearInterval(id)
  }, [interval])

  const [refreshTrigger] = useState(0)

  useEffect(() => {
    if (selectedStrike) loadData()
  }, [selectedStrike, loadData])

  useEffect(() => {
    if (updaterRef.current) window.clearTimeout(updaterRef.current)
    if (isBacktest) return

    let timer = 0
    let pollInterval = 0
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
          setTimeOffset(timeOffsetRef.current)
        }
        if (!json?.is_running) {
          if (fetcherRunningRef.current) setFetcherRunning(false)
          fetcherRunningRef.current = false
          window.clearInterval(pollInterval)
          return
        }
        if (json?.status === 'success' && json?.is_running && json?.last_update) {
          if (!fetcherRunningRef.current) setFetcherRunning(true)
          fetcherRunningRef.current = true
          const lastUpdate = new Date(json.last_update)
          const serverNow = getServerNow()
            if (lastUpdate.getMinutes() === serverNow.getMinutes()) {
              await updateLiveData()
              await refetchSignals()
              window.clearInterval(pollInterval)
              scheduleNextMinute()
            }
        }
      } catch {} finally {
        isFetching = false
      }
    }

    const scheduleNextMinute = () => {
      window.clearTimeout(timer)
      const now = getServerNow()
      const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
      timer = window.setTimeout(() => {
        pollInterval = window.setInterval(fetchStatusAndCheck, 1000)
      }, Math.max(0, msToNextMinute))
    }

    if (selectedStrike) {
      fetchStatusAndCheck()
      scheduleNextMinute()
    }
    return () => { window.clearTimeout(timer); window.clearInterval(pollInterval) }
  }, [selectedStrike, updateLiveData, isBacktest])

  useEffect(() => {
    if (!strikeListRef.current || !selectedStrike) return
    const el = strikeListRef.current.querySelector(`[data-strike="${selectedStrike}"]`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [selectedStrike, strikes])

  // Clear backtest results and volume baselines on strike change
  useEffect(() => {
    backtestTradesRef.current = []
    backtestSummaryRef.current = null
    setBacktestSummary(null)
    ceTradeMarkersRef.current?.setMarkers([])
    peTradeMarkersRef.current?.setMarkers([])
    apiCandleVolRef.current.clear()
    setCeLtpDisplay(0)
    setPeLtpDisplay(0)
    ceOrderRef.current?.setData([])
    peOrderRef.current?.setData([])
  }, [selectedStrike])

  // Clear volume baselines when symbols change — prevents race where WS seeds
  // baseline with old symbol's dayVol then computes bogus delta against new symbol
  useEffect(() => {
    apiCandleVolRef.current.clear()
  }, [ceSymbol, peSymbol])

  // Fetch positions when CE/PE symbols change
  useEffect(() => {
    if (!ceSymbol && !peSymbol) return
    fetchPositions()
  }, [ceSymbol, peSymbol, fetchPositions])

  // Refresh positions on order/position events instead of 30s polling
  useOrderEventRefresh(fetchPositions, {
    events: ['order_event', 'analyzer_update', 'close_position_event'],
    enabled: !isBacktest,
  })

  // Fetch orders when CE/PE symbols change
  useEffect(() => {
    if (!ceSymbol && !peSymbol) return
    fetchOrders()
  }, [ceSymbol, peSymbol, fetchOrders])

  // Refresh orders on order events instead of 30s polling
  useOrderEventRefresh(fetchOrders, {
    events: ['order_event', 'analyzer_update', 'cancel_order_event', 'modify_order_event'],
    enabled: !isBacktest,
  })

  // Strategy visibility toggle — re-combine trades from cached response
  useEffect(() => {
    if (!isBacktest || !rawDataRef.current) return
    const d = rawDataRef.current as OptionDataResponse['data'] & Record<string, any>
    if (!d.trades) return
    const allTrades: BacktestTrade[] = []
    let totalWins = 0, totalLosses = 0, totalPnl = 0, totalPnlAmount = 0
    for (const strat of visibleStrategies) {
      const stratTrades = d.trades[strat] || []
      allTrades.push(...stratTrades)
      const summ = d.summary?.[strat]
      if (summ) {
        totalWins += summ.wins
        totalLosses += summ.losses
        totalPnl += summ.totalPnl
        totalPnlAmount += summ.totalPnlAmount
      }
    }
    backtestTradesRef.current = allTrades
    if (allTrades.length > 0) {
      const summary = {
        total: allTrades.length,
        wins: totalWins,
        losses: totalLosses,
        winRate: totalWins / allTrades.length * 100,
        totalPnl,
        totalPnlAmount,
      }
      backtestSummaryRef.current = summary
      setBacktestSummary(summary)
    } else {
      backtestSummaryRef.current = null
      setBacktestSummary(null)
    }
    applyData()
  }, [visibleStrategies, isBacktest, applyData])

  useEffect(() => {
    // Skip WS processing in backtest mode — no live data
    if (isBacktest) return
    if (!wsData || wsData.size === 0 || !chartRef.current) return
    const ct = chartTypeRef.current
    const intervalMin = getIntervalMinutes(intervalRef.current)
    const strike = strikeNumRef.current
    if (!strike) return

    const nowSec = Math.floor((Date.now() + timeOffsetRef.current) / 1000)
    const bucketSec = intervalMin * 60
    const time = Math.floor(nowSec / bucketSec) * bucketSec as Time

    const spotEntry = wsData.get('NSE_INDEX:NIFTY')
    const spotLtp = spotEntry?.data?.ltp
    if (spotLtp) {
      liveSpotRef.current = spotLtp
      setLiveSpot(spotLtp)
    }
    const spot = spotLtp || liveSpotRef.current || 0
    if (!spot) return

    const ceEntry = ceSymbol ? wsData.get(`NFO:${ceSymbol}`) : undefined
    const peEntry = peSymbol ? wsData.get(`NFO:${peSymbol}`) : undefined
    const ceLtp = ceEntry?.data?.ltp || 0
    const peLtp = peEntry?.data?.ltp || 0
    const ceDayVol = ceEntry?.data?.volume || 0
    const peDayVol = peEntry?.data?.volume || 0

    if (ceLtp) setCeLtpDisplay(ceLtp)
    if (peLtp) setPeLtpDisplay(peLtp)

    // Update position PnL from live LTP (immutable updates for primitive redraw)
    const cePos = cePositionDataRef.current
    if (cePos && ceLtp) {
      const pnl = cePos.side === 'LONG'
        ? (ceLtp - cePos.entryPrice) * cePos.qty
        : (cePos.entryPrice - ceLtp) * cePos.qty
      const updated = { ...cePos, pnl }
      cePositionDataRef.current = updated
      cePositionRef.current?.setData([updated])
    }
    const pePos = pePositionDataRef.current
    if (pePos && peLtp) {
      const pnl = pePos.side === 'LONG'
        ? (peLtp - pePos.entryPrice) * pePos.qty
        : (pePos.entryPrice - peLtp) * pePos.qty
      const updated = { ...pePos, pnl }
      pePositionDataRef.current = updated
      pePositionRef.current?.setData([updated])
    }

    if (!ceDayVol && !peDayVol) return

    const totalDayVol = ceDayVol + peDayVol
    let historicalVol = 0
    for (const [ts, vol] of apiCandleVolRef.current) {
      if (ts < (time as number)) historicalVol += vol
    }
    const currentCandleVol = Math.max(0, totalDayVol - historicalVol)

    const ceIntrinsic = Math.max(0, spot - strike)
    const peIntrinsic = Math.max(0, strike - spot)
    const ceExtrinsic = Math.max(0, ceLtp - ceIntrinsic)
    const peExtrinsic = Math.max(0, peLtp - peIntrinsic)
    const combinedPremium = ceLtp + peLtp
    const combinedExtrinsic = ceExtrinsic + peExtrinsic

    const updateCandle = (key: string, series: ISeriesApi<any>, ltp: number) => {
      if (!ltp) return
      const existing = currentOhlcRef.current.get(key)
      if (existing && time === existing.time) {
        existing.high = Math.max(existing.high, ltp)
        existing.low = Math.min(existing.low, ltp)
        existing.close = ltp
      } else {
        const newCandle = { time: time as number, open: ltp, high: ltp, low: ltp, close: ltp }
        currentOhlcRef.current.set(key, newCandle)
      }
      const c = currentOhlcRef.current.get(key)!
      if (ct === 'candlestick') {
        series.update({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })
      } else {
        series.update({ time: c.time as Time, value: c.close })
      }
    }

    if (ceSeriesRef.current && ceLtp) updateCandle('ce', ceSeriesRef.current, ceLtp)
    if (peSeriesRef.current && peLtp) updateCandle('pe', peSeriesRef.current, peLtp)

    const updateLine = (key: string, series: ISeriesApi<any>, value: number) => {
      if (!series || !value) return
      const existing = currentOhlcRef.current.get(key)
      if (existing && time === existing.time) {
        existing.close = value
      } else {
        currentOhlcRef.current.set(key, { time: time as number, open: value, high: value, low: value, close: value })
      }
      series.update({ time: time as Time, value })
    }

    if (combinedSeriesRef.current) updateLine('combined', combinedSeriesRef.current, combinedPremium)
    if (llpSeriesRef.current) updateLine('llp', llpSeriesRef.current, rawDataRef.current?.llp || 0)
    if (ceIntrinsicRef.current) updateLine('ceIntrinsic', ceIntrinsicRef.current, ceIntrinsic)
    if (peIntrinsicRef.current) updateLine('peIntrinsic', peIntrinsicRef.current, peIntrinsic)
    if (ceExtrinsicRef.current) updateLine('ceExtrinsic', ceExtrinsicRef.current, ceExtrinsic)
    if (peExtrinsicRef.current) updateLine('peExtrinsic', peExtrinsicRef.current, peExtrinsic)
    if (combinedExtrinsicRef.current) {
      if (intervalMin > 1) {
        const key = 'combinedExtrinsic'
        const existing = currentOhlcRef.current.get(key)
        if (existing && time === existing.time) {
          if (combinedExtrinsic > existing.high) existing.high = combinedExtrinsic
          if (combinedExtrinsic < existing.low) existing.low = combinedExtrinsic
          existing.close = combinedExtrinsic
        } else {
          currentOhlcRef.current.set(key, { time: time as number, open: combinedExtrinsic, high: combinedExtrinsic, low: combinedExtrinsic, close: combinedExtrinsic })
        }
        const c = currentOhlcRef.current.get(key)!
        combinedExtrinsicRef.current.update({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })
      } else {
        updateLine('combinedExtrinsic', combinedExtrinsicRef.current, combinedExtrinsic)
      }
    }

    if (volumeRef.current && totalDayVol > 0 && volumeMode === 'strike') {
      const dark = madhanMode === 'dark'
      volumeRef.current.update({ time: time as Time, value: currentCandleVol, color: dark ? 'rgba(38,166,154,0.5)' : 'rgba(38,166,154,0.6)' })
    }
  }, [wsData, ceSymbol, peSymbol, volumeMode])

  const loadStrikes = async () => {
    try {
      const bt = isBacktestRef.current
      const dt = backtestDateRef.current
      // In backtest mode, load strikes from parquet data for the selected date
      if (bt && dt) {
        const res = await fetch(`/madhan/api/nifty/backtest_strikes?date=${dt}&_=${Date.now()}`)
        const json = await res.json()
        if (json.status === 'success' && json.data) {
          const sorted = json.data.sort((a: number, b: number) => b - a)
          setStrikes(sorted)
          const atm = json.open_atm || sorted[Math.floor(sorted.length / 2)]
          setAtmStrike(atm)
          setSelectedStrike(String(atm))
        }
        return
      }
      // Live mode — existing logic
      const res = await fetch(`/madhan/api/strikes?_=${Date.now()}`)
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
    <div className={cn("h-full w-full p-0 flex flex-col madhan-theme", madhanMode === 'dark' ? 'dark' : 'madhan-light')} style={madhanStyle}>
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
          <Button variant="ghost" size="sm" className="h-7 text-xs hidden sm:flex" asChild>
            <Link to="/madhan/realtime-table"><BarChart3 className="h-3.5 w-3.5 mr-1.5" />EzayOptionsTable</Link>
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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMadhanMode} title={madhanMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {madhanMode === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
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
          <Select value={interval} onValueChange={(v) => { setInterval(v); saveSetting('interval', v) }}>
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
          <Select value={chartType} onValueChange={(v) => { setChartType(v as 'candlestick' | 'line'); saveSetting('chartType', v) }}>
            <SelectTrigger className="h-7 w-20 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="candlestick">Candle</SelectItem>
              <SelectItem value="line">Line</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Checkbox checked={showCE} onCheckedChange={(v) => { setShowCE(!!v); saveSetting('showCE', !!v) }} />
            <Label className="text-[11px] font-semibold" style={{ color: t.textSecondary }}>CE</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={showPE} onCheckedChange={(v) => { setShowPE(!!v); saveSetting('showPE', !!v) }} />
            <Label className="text-[11px] font-semibold" style={{ color: t.textSecondary }}>PE</Label>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Checkbox checked={showIntrinsic} onCheckedChange={(v) => { setShowIntrinsic(!!v); saveSetting('showIntrinsic', !!v) }} />
            <Label className="text-[11px]" style={{ color: t.textSecondary }}>Intrinsic</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={showExtrinsic} onCheckedChange={(v) => { setShowExtrinsic(!!v); saveSetting('showExtrinsic', !!v) }} />
            <Label className="text-[11px]" style={{ color: t.textSecondary }}>Extrinsic</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={showCombinedAll} onCheckedChange={(v) => { setShowCombinedAll(!!v); saveSetting('showCombinedAll', !!v) }} />
            <Label className="text-[11px] font-semibold" style={{ color: t.textSecondary }}>Combined</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={showSignals} onCheckedChange={(v) => { setShowSignals(!!v); saveSetting('showSignals', !!v) }} />
            <Label className="text-[11px]" style={{ color: t.textSecondary }}>Signals</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={showHC} onCheckedChange={(v) => { setShowHC(!!v); saveSetting('showHC', !!v) }} />
            <Label className="text-[11px]" style={{ color: t.textSecondary }}>HC</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={semiTransparent} onCheckedChange={(v) => { setSemiTransparent(!!v); saveSetting('semiTransparent', !!v) }} />
            <Label className="text-[11px]" style={{ color: t.textSecondary }}>50% Candles</Label>
          </div>
          <div className="flex items-center rounded border overflow-hidden" style={{ borderColor: t.border }}>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] rounded-none" style={{ backgroundColor: volumeMode === 'strike' ? (madhanMode === 'dark' ? 'rgba(41,98,255,0.25)' : 'rgba(37,99,235,0.2)') : undefined, color: volumeMode === 'strike' ? (madhanMode === 'dark' ? '#60a5fa' : '#2563eb') : t.textSecondary }} onClick={() => { setVolumeMode('strike'); saveSetting('volumeMode', 'strike') }}>Strike Vol</Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] rounded-none" style={{ backgroundColor: volumeMode === 'total' ? (madhanMode === 'dark' ? 'rgba(41,98,255,0.25)' : 'rgba(37,99,235,0.2)') : undefined, color: volumeMode === 'total' ? (madhanMode === 'dark' ? '#60a5fa' : '#2563eb') : t.textSecondary }} onClick={() => { setVolumeMode('total'); saveSetting('volumeMode', 'total') }}>Total Vol</Button>
          </div>
          <div className="h-4 w-px" style={{ backgroundColor: t.border }} />
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={isBacktest ? 'default' : 'ghost'}
              className={cn('h-6 px-2 text-[10px] font-medium', isBacktest && 'bg-orange-500 hover:bg-orange-600 text-white')}
              onClick={() => {
                const newBacktest = !isBacktest
                setIsBacktest(newBacktest)
                isBacktestRef.current = newBacktest
                if (!newBacktest) {
                  setBacktestDate('')
                  backtestDateRef.current = ''
                  backtestTradesRef.current = []
                  backtestSummaryRef.current = null
                  setBacktestSummary(null)
                  firstSignalTimeRef.current = 0
                  firstSignalStrikeRef.current = 0
                  firstSignalTypeRef.current = ''
                  setRangeMode(false)
                  setRangeFrom('')
                  setRangeTo('')
                  setRangeResults(null)
                } else {
                  const today = todayStr()
                  setBacktestDate(today)
                  backtestDateRef.current = today
                  pendingAutoSelectRef.current = true
                  setShowEzaySignals(true)
                }
                clearAllChartData()
                loadStrikes()
              }}
            >
              {isBacktest ? 'Backtest' : 'Live'}
            </Button>
            {isBacktest && (
              <>
                <div className="flex items-center rounded border overflow-hidden" style={{ borderColor: t.border }}>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] rounded-none" style={{ backgroundColor: !rangeMode ? 'rgba(255,255,255,0.15)' : undefined, color: t.text }} onClick={() => { setRangeMode(false); setRangeResults(null) }}>Single</Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] rounded-none" style={{ backgroundColor: rangeMode ? 'rgba(255,255,255,0.15)' : undefined, color: t.text }} onClick={() => setRangeMode(true)}>Range</Button>
                </div>
                {!rangeMode ? (
                  <>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" style={{ color: t.textSecondary }} onClick={() => shiftBacktestDate(-1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <input type="date" value={backtestDate} onChange={(e) => { setBacktestDate(e.target.value); backtestDateRef.current = e.target.value; backtestTradesRef.current = []; backtestSummaryRef.current = null; setBacktestSummary(null); firstSignalTimeRef.current = 0; firstSignalStrikeRef.current = 0; firstSignalTypeRef.current = ''; pendingAutoSelectRef.current = true; clearAllChartData(); loadStrikes() }} className="h-6 px-1 text-[10px] rounded border" style={{ backgroundColor: t.panelDarker, color: t.text, borderColor: t.border }} />
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" style={{ color: t.textSecondary }} onClick={() => shiftBacktestDate(1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {availableStrategies.map((s) => (
                      <div key={s} className="flex items-center gap-1">
                        <Checkbox checked={visibleStrategies.has(s)} onCheckedChange={(v) => { setVisibleStrategies((prev) => { const next = new Set(prev); if (v) next.add(s); else next.delete(s); return next }) }} />
                        <Label className="text-[10px] font-medium" style={{ color: t.textSecondary }}>{s}</Label>
                      </div>
                    ))}
                    {backtestSummary && (
                      <Button size="sm" variant="default" className="h-6 px-2 text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white" onClick={saveBacktest}>Save</Button>
                    )}
                  </>
                ) : (
                  <>
                    <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className="h-6 px-1 text-[10px] rounded border" style={{ backgroundColor: t.panelDarker, color: t.text, borderColor: t.border }} />
                    <span className="text-[10px]" style={{ color: t.textSecondary }}>to</span>
                    <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className="h-6 px-1 text-[10px] rounded border" style={{ backgroundColor: t.panelDarker, color: t.text, borderColor: t.border }} />
                    <Button size="sm" variant="default" className="h-6 px-2 text-[10px] font-medium bg-green-600 hover:bg-green-700 text-white" onClick={fetchRangeBacktest} disabled={rangeLoading || !rangeFrom || !rangeTo}>
                      {rangeLoading ? 'Running...' : 'Run'}
                    </Button>
                    {Object.keys(rangeResults?.strategies || {}).map((s) => (
                      <div key={s} className="flex items-center gap-1">
                        <Checkbox checked={rangeVisibleStrategies.has(s)} onCheckedChange={(v) => { setRangeVisibleStrategies((prev) => { const next = new Set(prev); if (v) next.add(s); else next.delete(s); return next }) }} />
                        <Label className="text-[10px] font-medium" style={{ color: t.textSecondary }}>{s}</Label>
                      </div>
                    ))}
                    {rangeResults && (
                      <Button size="sm" variant="default" className="h-6 px-2 text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white" onClick={saveRangeBacktest}>Save</Button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          <div className="h-4 w-px" style={{ backgroundColor: t.border }} />
          <Button
            size="sm"
            variant={showEzaySignals ? 'default' : 'ghost'}
            className={cn('h-6 px-2 text-[10px] font-medium', showEzaySignals && 'bg-primary text-primary-foreground')}
            onClick={() => { setShowEzaySignals(!showEzaySignals); saveSetting('showEzaySignals', !showEzaySignals) }}
          >
            EzaySignals
          </Button>
          <Button
            size="sm"
            variant={showTrustMe ? 'default' : 'ghost'}
            className={cn('h-6 px-2 text-[10px] font-medium', showTrustMe && 'bg-emerald-600 hover:bg-emerald-700 text-white')}
            onClick={() => { setShowTrustMe(!showTrustMe); saveSetting('showTrustMe', !showTrustMe) }}
          >
            TrustMe
          </Button>
          <Button
            size="sm"
            variant={showRealtime ? 'default' : 'ghost'}
            className="h-6 px-2 text-[10px]"
            onClick={() => { setShowRealtime(!showRealtime); saveSetting('showRealtime', !showRealtime) }}
          >
            Realtime
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {liveSpot > 0 && (
            <span className="text-[11px] font-mono font-semibold" style={{ color: t.text }}>
              NIFTY {liveSpot.toFixed(2)}
            </span>
          )}
          {ceLtpDisplay > 0 && (
            <span className="text-[11px] font-mono font-semibold" style={{ color: '#00C851' }}>
              CE: {ceLtpDisplay.toFixed(2)}
            </span>
          )}
          {peLtpDisplay > 0 && (
            <span className="text-[11px] font-mono font-semibold" style={{ color: '#E040FB' }}>
              PE: {peLtpDisplay.toFixed(2)}
            </span>
          )}
          <div className="flex items-center gap-1">
            {isConnected ? <Wifi className="h-3 w-3 text-green-500" /> : <WifiOff className="h-3 w-3 text-red-500" />}
            <span className="text-[10px]" style={{ color: isConnected ? '#22c55e' : '#ef4444' }}>
              {isConnected ? 'Live' : 'Offline'}
            </span>
          </div>
          <span className="text-[11px]" style={{ color: chartInfo ? t.text : t.textMuted }}>{chartInfo || 'No Strike Selected'}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div
          className="shrink-0 flex flex-col overflow-hidden border-r transition-[width] duration-150"
          style={{
            width: strikePanelOpen && !rangeMode ? 72 : 24,
            backgroundColor: t.panelDarker,
            borderColor: t.border,
          }}
        >
          <button
            onClick={() => { setStrikePanelOpen(!strikePanelOpen); saveSetting('strikePanelOpen', !strikePanelOpen) }}
            className="h-7 flex items-center justify-center shrink-0 hover:bg-[rgba(128,128,128,0.15)] transition-colors"
            style={{ color: t.textSecondary }}
            title={strikePanelOpen ? 'Collapse strike list' : 'Expand strike list'}
          >
            {strikePanelOpen && !rangeMode ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          {strikePanelOpen && !rangeMode && (
            <>
              <div className="px-1 py-1 text-center shrink-0" style={{ borderBottom: `1px solid ${t.border}` }}>
                <span className="text-[10px] font-semibold" style={{ color: t.textSecondary }}>STRIKES</span>
              </div>
              <div ref={strikeListRef} className="flex-1 overflow-y-auto min-h-0" style={{ scrollbarWidth: 'thin' }}>
                {strikes.map((s) => {
                  const isSelected = String(s) === selectedStrike
                  const isOpen = s === atmStrike
                  const isCurrentAtm = currentAtmStrike !== null && s === currentAtmStrike
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
                          ? (madhanMode === 'dark' ? '#2962ff' : '#2563eb')
                          : isCurrentAtm
                            ? '#854d0e'
                            : isOpen
                              ? (madhanMode === 'dark' ? '#d1d4dc' : '#1f2937')
                              : t.textSecondary,
                        backgroundColor: isSelected
                          ? (madhanMode === 'dark' ? 'rgba(41,98,255,0.2)' : 'rgba(37,99,235,0.15)')
                          : isCurrentAtm
                            ? (madhanMode === 'dark' ? 'rgba(234,179,8,0.15)' : 'rgba(234,179,8,0.12)')
                            : undefined,
                        borderBottom: `1px solid ${t.border}`,
                      }}
                    >
                      {irStrikes.includes(s) && <span className="mr-0.5 text-[8px] font-bold px-0.5 rounded" style={{ color: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.15)' }}>IR</span>}
                      {s}
                      {isCurrentAtm && <span className="ml-1 text-[9px] font-bold" style={{ color: '#eab308' }}>C-ATM</span>}
                      {isOpen && !isCurrentAtm && <span className="ml-1 text-[9px] font-bold" style={{ color: madhanMode === 'dark' ? '#2962ff' : '#2563eb' }}>Open</span>}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
        <div className="flex-1 min-h-0 min-w-0 relative" style={{ backgroundColor: t.panelDarker }}>
          <div ref={chartContainerRef} className="absolute inset-0" />
          {candleCountdown && (
            <div className="absolute top-2 z-10 rounded px-3 py-1.5 text-[15px] font-bold font-mono tracking-wide"
              style={{ backgroundColor: madhanMode === 'dark' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)', color: madhanMode === 'dark' ? '#e5e7eb' : '#1f2937', border: `1px solid ${madhanMode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`, right: 80 }}>
              {candleCountdown}
            </div>
          )}
          {!isBacktest && ceSymbol && peSymbol && (
            <QuickTradePanel
              ceSymbol={ceSymbol}
              peSymbol={peSymbol}
              ceLtp={ceLtpDisplay}
              peLtp={peLtpDisplay}
              onPlaceOrder={handlePlaceOrder}
              isPlacing={isPlacingOrder}
              orderStatus={orderStatus}
              clickSide={tradePanelSide}
              clickPrice={tradePanelPrice}
            />
          )}
          {backtestSummary && (
            <div className="absolute top-2 left-2 z-10 rounded-md px-3 py-2 text-[10px] font-mono max-h-[60%] overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.85)', color: '#d1d4dc', minWidth: 360, scrollbarWidth: 'thin' }}>
              <div className="font-semibold mb-1 text-[12px] text-white">Backtest Results</div>
              <div className="mb-1">Trades: {backtestSummary.total} | Wins: {backtestSummary.wins} | Loss: {backtestSummary.losses}</div>
              <div className="mb-1">Win Rate: {backtestSummary.winRate.toFixed(1)}%</div>
              <div className="mb-2">PnL: <span className={backtestSummary.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}>{backtestSummary.totalPnl >= 0 ? '+' : ''}{backtestSummary.totalPnl.toFixed(1)}%</span> <span className={backtestSummary.totalPnlAmount >= 0 ? 'text-green-400' : 'text-red-400'}>({backtestSummary.totalPnlAmount >= 0 ? '+' : ''}{backtestSummary.totalPnlAmount.toFixed(0)})</span></div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)' }} className="pt-1">
                <table className="w-full">
                  <thead>
                    <tr className="text-[9px] text-gray-400">
                      <th className="text-left px-0.5">#</th>
                      <th className="text-left px-0.5">Strat</th>
                      <th className="text-left px-0.5">Side</th>
                      <th className="text-right px-0.5">Entry</th>
                      <th className="text-center px-0.5">Time</th>
                      <th className="text-right px-0.5">Exit</th>
                      <th className="text-center px-0.5">Time</th>
                      <th className="text-right px-0.5">Runup%</th>
                      <th className="text-right px-0.5">PnL%</th>
                      <th className="text-right px-0.5">PnL</th>
                      <th className="text-left px-1">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backtestTradesRef.current.map((trade, i) => {
                      const entryDate = new Date(trade.entryTime * 1000)
                      const exitDate = new Date(trade.exitTime * 1000)
                      const fmt = (d: Date) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
                      return (
                        <tr key={i} className="text-[9px]">
                          <td className="text-left px-0.5">{i + 1}</td>
                          <td className="text-left px-0.5 text-gray-400">{trade.strategy}</td>
                          <td className={`text-left px-0.5 ${trade.side === 'CE' ? 'text-green-400' : 'text-purple-400'}`}>{trade.side}</td>
                          <td className="text-right px-0.5 font-mono">{trade.entryPrice.toFixed(0)}</td>
                          <td className="text-center px-0.5 text-gray-500 font-mono">{fmt(entryDate)}</td>
                          <td className="text-right px-0.5 font-mono">{trade.exitPrice.toFixed(0)}</td>
                          <td className="text-center px-0.5 text-gray-500 font-mono">{fmt(exitDate)}</td>
                          <td className="text-right px-0.5 text-blue-400">{trade.maxRunupPct.toFixed(1)}%</td>
                          <td className={`text-right px-0.5 ${trade.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(1)}%</td>
                          <td className={`text-right px-0.5 ${trade.pnlAmount >= 0 ? 'text-green-400' : 'text-red-400'}`}>{trade.pnlAmount >= 0 ? '+' : ''}{trade.pnlAmount.toFixed(0)}</td>
                          <td className="text-left px-1 text-gray-500">{trade.exitReason === 'eod' ? 'EOD' : trade.exitReason === 'target' ? 'TGT' : 'OPP'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {rangeResults && (
            <div className="absolute top-2 left-2 z-10 rounded-md px-3 py-2 text-[10px] font-mono max-h-[80%] overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.88)', color: '#d1d4dc', minWidth: 420, scrollbarWidth: 'thin' }}>
              <div className="font-semibold mb-1 text-[12px] text-white">Range Backtest: {rangeResults.from_date} to {rangeResults.to_date}</div>
              <div className="mb-1">Total Days: {rangeResults.total_days}</div>
              {Object.entries(rangeResults.strategies).map(([strat, data]) => (
                rangeVisibleStrategies.has(strat) && data.summary && (
                  <div key={strat} className="mb-2 p-1.5 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div className="font-semibold text-[11px] text-white mb-0.5">{strat} ({rangeResults.days_with_signals[strat] || 0} days with signals)</div>
                    <div>Trades: {data.summary.total} | Wins: {data.summary.wins} | Loss: {data.summary.losses}</div>
                    <div>Win Rate: {data.summary.winRate.toFixed(1)}%</div>
                    <div>PnL: <span className={data.summary.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}>{data.summary.totalPnl >= 0 ? '+' : ''}{data.summary.totalPnl.toFixed(1)}%</span> <span className={data.summary.totalPnlAmount >= 0 ? 'text-green-400' : 'text-red-400'}>({data.summary.totalPnlAmount >= 0 ? '+' : ''}{data.summary.totalPnlAmount.toFixed(0)})</span></div>
                  </div>
                )
              ))}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)' }} className="pt-1 mt-1">
                <div className="font-semibold text-[11px] text-white mb-0.5">Per-Day Breakdown</div>
                <table className="w-full">
                  <thead>
                    <tr className="text-[9px] text-gray-400">
                      <th className="text-left px-0.5">Date</th>
                      <th className="text-right px-0.5">CE-PE</th>
                      <th className="text-right px-0.5">CP</th>
                      <th className="text-right px-0.5">Trades</th>
                      <th className="text-right px-0.5">PnL%</th>
                      <th className="text-right px-0.5">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rangeResults.per_day.map((day) => {
                      const cePeTrades = day.trades['CE-PE'] || []
                      const cpTrades = day.trades['CP'] || []
                      const totalTrades = cePeTrades.length + cpTrades.length
                      const totalPnl = [...cePeTrades, ...cpTrades].reduce((s, t) => s + t.pnlPct, 0)
                      const totalPnlAmt = [...cePeTrades, ...cpTrades].reduce((s, t) => s + t.pnlAmount, 0)
                      return (
                        <tr key={day.date} className="text-[9px]">
                          <td className="text-left px-0.5">{day.date.slice(5)}</td>
                          <td className="text-right px-0.5 font-mono" style={{ color: day.ce_pe_strike ? t.textSecondary : '#555' }}>{day.ce_pe_strike || '-'}</td>
                          <td className="text-right px-0.5 font-mono" style={{ color: day.cp_strike ? t.textSecondary : '#555' }}>{day.cp_strike || '-'}</td>
                          <td className="text-right px-0.5">{totalTrades || '-'}</td>
                          <td className={`text-right px-0.5 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{totalTrades ? `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}%` : '-'}</td>
                          <td className={`text-right px-0.5 ${totalPnlAmt >= 0 ? 'text-green-400' : 'text-red-400'}`}>{totalTrades ? `${totalPnlAmt >= 0 ? '+' : ''}${totalPnlAmt.toFixed(0)}` : '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {showRealtime && <RealtimeTable onClose={() => setShowRealtime(false)} />}
        </div>
        {showEzaySignals && <EzaySignals className="shrink-0" style={{ width: 320 }} backtestDate={isBacktest ? backtestDate : undefined} refreshTrigger={refreshTrigger} onFirstSignal={handleFirstSignal} onSignals={handleSignals} signalsData={signalsForPanel} signalsMeta={signalsMetaForPanel} lastTime={signalsLastTime} />}
      </div>
    </div>
  )
}
