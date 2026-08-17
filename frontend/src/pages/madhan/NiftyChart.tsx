import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  AreaSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from 'lightweight-charts'
import { indicatorRegistry } from 'lightweight-charts-indicators'
import { DrawingManager, getToolRegistry, type IDrawing } from 'lightweight-charts-drawing'
import type { Bar } from 'oakscriptjs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMarketData } from '@/hooks/useMarketData'
import { Zap, ZapOff, RefreshCw, Sun, Moon, Menu, BarChart3, Home } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { useMadhanTheme } from './useMadhanTheme'
import { cn } from '@/lib/utils'
import { setTimeOffset, getTimeOffset } from '@/utils/timeSync'
import { chartTheme } from './chartTheme'
import DrawingToolbar, { TEXT_DRAWING_TYPES } from './DrawingToolbar'
import DrawingListPanel from './DrawingListPanel'
import TextEditorModal from './TextEditorModal'
import ChartLayout from './ChartLayout'
import WidgetBar from './WidgetBar'
import EzaySignals from './components/EzaySignals'
import IndicatorPanel, { INDICATOR_CATEGORIES } from './IndicatorPanel'
import { PlotFillPrimitive, LineBrPrimitive, ExtendedMarkerPrimitive, BgColorPrimitive, LabelPrimitive, BoxPrimitive, LineDrawingPrimitive, TablePrimitive, CrossPlotPrimitive, VolumeProfilePrimitive, applyTransparency } from './chartPrimitives'

type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

type OIProfileResponse = {
  oi: { strikes: Array<{ price: number; ceOI: number; peOI: number }> }
  coi: { strikes: Array<{ price: number; ceOI: number; peOI: number }> }
}

type CoiHistoryDay = {
  date: string
  strikes: Array<{ price: number; ceOI: number; peOI: number }>
}

type CoiHistoryResponse = {
  status: string
  data: CoiHistoryDay[]
}

type IndicatorInstance = {
  key: string
  indicatorId: string
  visible: boolean
  plotVisibility: Record<string, boolean>
}

type SignalRow = {
  time: number
  strike: number
  ce_signal: boolean
  pe_signal: boolean
  cp_signal: 'CE' | 'PE' | false
  cp_ce_signal: boolean
  th_signal: 'CE' | 'PE' | 'dot' | false
  th_dir: 'CE' | 'PE' | false
  ce_close: number
  pe_close: number
}

type IndicatorSeriesBucket = {
  plotSeries: Map<string, ISeriesApi<any>>
  extraSeries: ISeriesApi<any>[]
  markerSeries: Array<{ plotKey: string; primitive: { setMarkers: (markers: any[]) => void } }>
  lineBrPrimitives: Array<{ plotKey: string; primitive: LineBrPrimitive; anchorSeries: ISeriesApi<any> }>
  crossPrimitives: Array<{ plotKey: string; primitive: CrossPlotPrimitive; anchorSeries: ISeriesApi<any> }>
  plotFillPrimitives: Array<{ prim: PlotFillPrimitive; anchorSeries: ISeriesApi<any>; fillConfig: any }>
  allPlotData: Map<string, Array<{ time: number; value?: number }>>
  extendedMarkerPrimitive?: ExtendedMarkerPrimitive
  extendedMarkerAnchorSeries?: ISeriesApi<any>
  bgColorPrimitive?: BgColorPrimitive
  bgColorAnchorSeries?: ISeriesApi<any>
  labelPrimitive?: LabelPrimitive
  labelAnchorSeries?: ISeriesApi<any>
  boxPrimitive?: BoxPrimitive
  boxAnchorSeries?: ISeriesApi<any>
  lineDrawingPrimitive?: LineDrawingPrimitive
  lineDrawingAnchorSeries?: ISeriesApi<any>
  tablePrimitive?: TablePrimitive
}

// Compact number formatter: 2500 -> "2.5k", 15000 -> "15k", 1.2M -> "1.2M"
function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000
    return `${sign}${v >= 10 ? Math.round(v) : v.toFixed(1)}M`
  }
  if (abs >= 1_000) {
    const v = abs / 1_000
    return `${sign}${v >= 10 ? Math.round(v) : v.toFixed(1)}k`
  }
  return `${sign}${Math.round(abs)}`
}

export default function NiftyChart() {
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const ema34Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema55Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const indicatorSeriesRef = useRef<Map<string, IndicatorSeriesBucket>>(new Map())
  const indicatorPaneRef = useRef<Map<string, any>>(new Map())
  const optionVolumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const dayOpenRef = useRef<ISeriesApi<'Line'> | null>(null)
  const prevOpenRef = useRef<ISeriesApi<'Line'> | null>(null)
  const prevHighRef = useRef<ISeriesApi<'Line'> | null>(null)
  const prevLowRef = useRef<ISeriesApi<'Line'> | null>(null)
  const prevCloseRef = useRef<ISeriesApi<'Line'> | null>(null)
  const oiPrimitiveRef = useRef<any>(null)
  const coiPrimitiveRef = useRef<any>(null)
  const drawingManagerRef = useRef<DrawingManager | null>(null)
  const drawingAnchorsRef = useRef<{ time: Time; price: number }[]>([])
  const drawingPreviewIdRef = useRef<string | null>(null)
  const activeDrawingToolRef = useRef<string | null>(null)
  const drawingColorRef = useRef('#3b82f6')
  const lineWidthRef = useRef(2)
  const priceDataRef = useRef<Candle[]>([])
  const updaterRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const oiXRef = useRef(100)
  const coiXRef = useRef(80)
  const oiShowStrikeRef = useRef(true)
  const oiShowValuesRef = useRef(true)
  const coiShowStrikeRef = useRef(true)
  const coiShowValuesRef = useRef(true)
  const sqrtPrimitiveRef = useRef<any>(null)
  const sqrtActiveRef = useRef(false)
  const coiHistoryPrimitiveRef = useRef<any>(null)
  const volumeProfileRef = useRef<VolumeProfilePrimitive | null>(null)

  const [interval, setIntervalValue] = useState('5m')
  const [oiActive, setOiActive] = useState(true)
  const [coiActive, setCoiActive] = useState(true)
  const [emaActive, setEmaActive] = useState(false)
  const [dayOpenActive, setDayOpenActive] = useState(false)
  const [prevOhlcActive, setPrevOhlcActive] = useState(false)
  const [sqrtActive, setSqrtActive] = useState(false)
  const [coiHistoryActive, setCoiHistoryActive] = useState(false)
  const [volumeProfileActive, setVolumeProfileActive] = useState(false)
  const [writersViewActive, setWritersViewActive] = useState(true)
  const coiTrendPaneRef = useRef<any>(null)
  const coiCandleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const oiCandleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const coiLineSeriesRef = useRef<ISeriesApi<'Baseline'> | null>(null)
  const oiLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const coiTrendDataRef = useRef<{ timestamps: number[]; coi_percent: number[]; oi_trend_percent: number[] } | null>(null)
  const writersViewActiveRef = useRef(true)
  const niftyRunningRef = useRef(false)
  const timeOffsetRef = useRef(0)
  const [cePeSignalsActive, setCePeSignalsActive] = useState(false)
  const [cpSignalsActive, setCpSignalsActive] = useState(false)
  const [thSignalsActive, setThSignalsActive] = useState(false)
  const [candleCountdown, setCandleCountdown] = useState('')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const cePeSignalsActiveRef = useRef(false)
  const cpSignalsActiveRef = useRef(false)
  const thSignalsActiveRef = useRef(false)
  const cePeMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const cpMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const thExtMarkerRef = useRef<ExtendedMarkerPrimitive | null>(null)
  const thAnchorSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rawSignalDataRef = useRef<SignalRow[]>([])
  const [oiX, setOiX] = useState(100)
  const [coiX, setCoiX] = useState(80)
  const [oiShowStrike, setOiShowStrike] = useState(false)
  const [oiShowValues, setOiShowValues] = useState(false)
  const [coiShowStrike, setCoiShowStrike] = useState(false)
  const [coiShowValues, setCoiShowValues] = useState(false)
  const [activeIndicators, setActiveIndicators] = useState<IndicatorInstance[]>([
    { key: 'sma-0', indicatorId: 'sma', visible: true, plotVisibility: {} },
  ])
  const [indicatorInputs, setIndicatorInputs] = useState<Record<string, Record<string, unknown>>>({})
  const [expandedIndicatorKey, setExpandedIndicatorKey] = useState<string | null>(null)
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false)
  const [indicatorPanelPos, setIndicatorPanelPos] = useState({ x: 80, y: 40 })
  const [indicatorPanelWidth, setIndicatorPanelWidth] = useState(320)
  const [indicatorPanelDragging, setIndicatorPanelDragging] = useState(false)
  const [indicatorPanelResizing, setIndicatorPanelResizing] = useState(false)
  const indicatorPanelDragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  const indicatorPanelResizeStart = useRef<{ mx: number; w: number } | null>(null)
  const [showDrawingPanel, setShowDrawingPanel] = useState(false)
  const [drawingToolbarCollapsed, setDrawingToolbarCollapsed] = useState(false)
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null)
  const [drawingColor, setDrawingColor] = useState('#3b82f6')
  const [lineWidth, setLineWidth] = useState(2)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [, setSelectedDrawing] = useState<IDrawing | null>(null)
  const [editingTextDrawing, setEditingTextDrawing] = useState<IDrawing | null>(null)
  const [chartReady, setChartReady] = useState(false)
  const [crosshairOHLCV, setCrosshairOHLCV] = useState<{ time: string; open: number; high: number; low: number; close: number; volume?: number; change?: number; changePct?: number } | null>(null)
  const [niftyStatus, setNiftyStatus] = useState<string>('')
  const [niftyRunning, setNiftyRunning] = useState<boolean>(false)
  const wsSymbols = useMemo(() => niftyRunning ? [{ symbol: 'NIFTY', exchange: 'NSE_INDEX' }] : [], [niftyRunning])
  const { data: wsData, isConnected, isConnecting, error: wsError, connect: wsConnect } = useMarketData({
    symbols: wsSymbols,
    mode: 'LTP',
    enabled: true,
  })
  const { appMode, toggleAppMode, isTogglingMode } = useThemeStore()
  const { mode: madhanMode, toggleMode: toggleMadhanMode, style: madhanStyle } = useMadhanTheme()
  const t = chartTheme[madhanMode]
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const profileMenuItems = useProfileMenuItems()

  useEffect(() => {
    activeDrawingToolRef.current = activeDrawingTool
    if (!activeDrawingTool) drawingAnchorsRef.current = []
  }, [activeDrawingTool])

  useEffect(() => {
    drawingColorRef.current = drawingColor
  }, [drawingColor])

  useEffect(() => {
    lineWidthRef.current = lineWidth
  }, [lineWidth])

  useEffect(() => {
    setIndicatorInputs((prev) => {
      const next = { ...prev }
      for (const instance of activeIndicators) {
        if (!next[instance.key]) {
          const entry = indicatorRegistry.find((item) => item.id === instance.indicatorId)
          next[instance.key] = { ...(entry?.defaultInputs || {}) }
        }
      }
      return next
    })
  }, [activeIndicators])

  useEffect(() => {
    setExpandedIndicatorKey((prev) => {
      if (prev && activeIndicators.some((item) => item.key === prev)) return prev
      return activeIndicators.length > 0 ? activeIndicators[0].key : null
    })
  }, [activeIndicators])

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})
  const collapseAllCategories = useCallback(() => {
    setCollapsedCategories((prev) => {
      const allCollapsed = Object.values(prev).every(Boolean)
      if (allCollapsed) return {}
      const next: Record<string, boolean> = {}
      for (const cat of INDICATOR_CATEGORIES) next[cat] = true
      return next
    })
  }, [])

  const toggleIndicatorExpand = useCallback((key: string) => {
    setExpandedIndicatorKey((prev) => (prev === key ? null : key))
  }, [])

  const indicatorColors = useMemo(
    () => ['#8b5cf6', '#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#14b8a6', '#a855f7', '#f97316'],
    []
  )

  const getIndicatorById = useCallback((indicatorId: string) => {
    return indicatorRegistry.find((item) => item.id === indicatorId)
  }, [])

  useEffect(() => {
    if (!chartContainerRef.current) return

    const isDark = madhanMode === 'dark'
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: Math.max(320, chartContainerRef.current.clientHeight),
      handleScroll: {
        pressedMouseMove: true,
        mouseWheel: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: isDark ? '#a6adbb' : '#333',
      },
      grid: {
        vertLines: { color: 'transparent' },
        horzLines: { color: 'transparent' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => {
          return new Date(time * 1000).toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        },
      },
      localization: {
        timeFormatter: (time: number) =>
          new Date(time * 1000).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          }),
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(166,173,187,0.2)' : 'rgba(0,0,0,0.2)',
      },
    })

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    const ema34 = chart.addSeries(LineSeries, {
      color: 'blue',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    const ema55 = chart.addSeries(LineSeries, {
      color: 'red',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    let optionVolumeSeries: ISeriesApi<'Histogram'> | null = null
    optionVolumeSeries = chart.addSeries(HistogramSeries, {
      title: 'CE+PE Volume',
      color: 'rgba(59, 130, 246, 1)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    const dayOpen = chart.addSeries(LineSeries, { color: '#00FF00', lineWidth: 1, title: 'Day Open' })
    const prevOpen = chart.addSeries(LineSeries, { color: '#FFA500', lineWidth: 1, title: 'Prev Open' })
    const prevHigh = chart.addSeries(LineSeries, { color: '#0000FF', lineWidth: 1, title: 'Prev High' })
    const prevLow = chart.addSeries(LineSeries, { color: '#FF69B4', lineWidth: 1, title: 'Prev Low' })
    const prevClose = chart.addSeries(LineSeries, { color: '#FF0000', lineWidth: 1, title: 'Prev Close' })

    chartRef.current = chart
    candleRef.current = candle
    ema34Ref.current = ema34
    ema55Ref.current = ema55
    optionVolumeRef.current = optionVolumeSeries
    dayOpenRef.current = dayOpen
    prevOpenRef.current = prevOpen
    prevHighRef.current = prevHigh
    prevLowRef.current = prevLow
    prevCloseRef.current = prevClose
    cePeMarkersRef.current = createSeriesMarkers(candle, [])
    cpMarkersRef.current = createSeriesMarkers(candle, [])
    const thAnchor = chart.addSeries(LineSeries, {
      color: 'transparent', lineVisible: false, lastValueVisible: false,
      priceLineVisible: false, crosshairMarkerVisible: false,
    })
    thAnchor.setData([])
    const thExtMarker = new ExtendedMarkerPrimitive(thAnchor, chart.timeScale())
    try { thAnchor.attachPrimitive(thExtMarker as any) } catch {}
    thAnchorSeriesRef.current = thAnchor
    thExtMarkerRef.current = thExtMarker
    const volumeProfile = new VolumeProfilePrimitive(candle, chart.timeScale())
    try { candle.attachPrimitive(volumeProfile as any) } catch {}
    volumeProfileRef.current = volumeProfile
    setChartReady(true)
    const drawingManager = new DrawingManager()
    drawingManager.attach(chart, candle, chartContainerRef.current)
    drawingManagerRef.current = drawingManager

    drawingManager.on('drawing:selected', (event) => {
      if (event.drawingId) {
        const d = drawingManager.getDrawing(event.drawingId)
        setSelectedDrawingId(event.drawingId)
        setSelectedDrawing(d ?? null)
        chart.applyOptions({ handleScroll: { pressedMouseMove: false } })
      }
    })
    drawingManager.on('drawing:deselected', () => {
      setSelectedDrawingId(null)
      setSelectedDrawing(null)
      chart.applyOptions({ handleScroll: { pressedMouseMove: true } })
    })

    const padAnchors = (anchors: { time: Time; price: number }[], required: number) => {
      if (anchors.length >= required) return anchors
      const padded = [...anchors]
      const last = anchors[anchors.length - 1]
      while (padded.length < required) padded.push({ ...last })
      return padded
    }

    const createDrawingPreview = (toolType: string, id: string, anchors: { time: Time; price: number }[]) => {
      const registry = getToolRegistry()
      const toolDef = registry.get(toolType)
      const required = toolDef?.requiredAnchors ?? anchors.length
      const padded = padAnchors(anchors, required)
      const drawing = registry.createDrawing(toolType, id, padded, { lineColor: drawingColorRef.current, lineWidth: lineWidthRef.current })
      if (drawing) drawing.setState('editing' as any)
      return drawing
    }

    const finalizeDrawing = (toolType: string, id: string, anchors: { time: Time; price: number }[]) => {
      if (!drawingManagerRef.current) return
      const registry = getToolRegistry()
      const drawing = registry.createDrawing(toolType, id, anchors, { lineColor: drawingColorRef.current, lineWidth: lineWidthRef.current })
      if (drawing) {
        drawing.setState('normal' as any)
        drawingManagerRef.current.addDrawing(drawing)
      }
    }

    const handleChartClick = (param: any) => {
      const tool = activeDrawingToolRef.current
      if (!drawingManagerRef.current || !param?.point) return
      if (!tool) {
        const hit = drawingManagerRef.current.hitTest({ x: param.point.x, y: param.point.y })
        if (hit) {
          drawingManagerRef.current.selectDrawing(hit.id)
        } else {
          drawingManagerRef.current.deselectAll()
        }
        return
      }
      if (param?.time == null) return
      const price = candle.coordinateToPrice(param.point.y)
      if (price == null) return
      const anchor = { time: param.time as Time, price }

      const registry = getToolRegistry()
      const toolDef = registry.get(tool)
      if (!toolDef) return
      const required = toolDef.requiredAnchors

      if (required === 1) {
        const registry = getToolRegistry()
        const drawing = registry.createDrawing(tool, `${tool}-${Date.now()}`, [anchor], { lineColor: drawingColorRef.current, lineWidth: lineWidthRef.current })
        if (drawing) {
          drawing.setState('normal' as any)
          drawingManagerRef.current.addDrawing(drawing)
        }
        drawingManagerRef.current.setActiveTool(null)
        setActiveDrawingTool(null)
        chart.applyOptions({ handleScroll: { pressedMouseMove: true } })
        return
      }

      drawingAnchorsRef.current.push(anchor)

      if (drawingAnchorsRef.current.length === 1 && required >= 2) {
        const previewId = `draw-preview-${Date.now()}`
        drawingPreviewIdRef.current = previewId
        const drawing = createDrawingPreview(tool, previewId, [anchor, anchor])
        if (drawing) drawingManagerRef.current.addDrawing(drawing)
        return
      }

      if (drawingAnchorsRef.current.length < required) {
        if (drawingPreviewIdRef.current) {
          drawingManagerRef.current.removeDrawing(drawingPreviewIdRef.current)
          drawingPreviewIdRef.current = null
        }
        const previewId = `draw-preview-${Date.now()}`
        drawingPreviewIdRef.current = previewId
        const drawing = createDrawingPreview(tool, previewId, [...drawingAnchorsRef.current, anchor])
        if (drawing) drawingManagerRef.current.addDrawing(drawing)
        return
      }

      if (drawingPreviewIdRef.current) {
        drawingManagerRef.current.removeDrawing(drawingPreviewIdRef.current)
        drawingPreviewIdRef.current = null
      }
      finalizeDrawing(tool, `${tool}-${Date.now()}`, [...drawingAnchorsRef.current])
      drawingAnchorsRef.current = []
      drawingManagerRef.current.setActiveTool(null)
      setActiveDrawingTool(null)
      chart.applyOptions({ handleScroll: { pressedMouseMove: true } })
    }

    const handleChartCrosshairMove = (param: any) => {
      const tool = activeDrawingToolRef.current
      if (!tool || !drawingManagerRef.current || !drawingPreviewIdRef.current || drawingAnchorsRef.current.length === 0 || !param?.point || param?.time == null) return
      const registry = getToolRegistry()
      const toolDef = registry.get(tool)
      if (!toolDef || toolDef.requiredAnchors < 2) return
      const price = candle.coordinateToPrice(param.point.y)
      if (price == null) return
      drawingManagerRef.current.removeDrawing(drawingPreviewIdRef.current)
      const previewAnchors = [...drawingAnchorsRef.current, { time: param.time as Time, price }]
      const drawing = createDrawingPreview(tool, drawingPreviewIdRef.current, previewAnchors)
      if (drawing) drawingManagerRef.current.addDrawing(drawing)
    }

    chart.subscribeClick(handleChartClick)
    chart.subscribeCrosshairMove(handleChartCrosshairMove)

    const handleCrosshairOHLCV = (param: any) => {
      const pick = (c: Candle) => {
        const change = c.close - c.open
        const changePct = c.open !== 0 ? (change / c.open) * 100 : 0
        return {
          time: new Date(c.time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          change,
          changePct,
        }
      }
      if (!param?.time) {
        if (priceDataRef.current.length > 0) {
          setCrosshairOHLCV(pick(priceDataRef.current[priceDataRef.current.length - 1]))
        } else {
          setCrosshairOHLCV(null)
        }
        return
      }
      const ts = param.time as number
      const candle = priceDataRef.current.find((c) => c.time === ts)
      if (candle) setCrosshairOHLCV(pick(candle))
    }
    chart.subscribeCrosshairMove(handleCrosshairOHLCV)

    const handleChartDblClick = (e: MouseEvent) => {
      const tool = activeDrawingToolRef.current
      if (tool) return
      if (!drawingManagerRef.current || !chartContainerRef.current) return
      const rect = chartContainerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const hit = drawingManagerRef.current.hitTest({ x, y })
      if (hit && TEXT_DRAWING_TYPES.includes(hit.type)) {
        e.preventDefault()
        e.stopPropagation()
        drawingManagerRef.current.selectDrawing(hit.id)
        setEditingTextDrawing(hit)
      }
    }
    chartContainerRef.current.addEventListener('dblclick', handleChartDblClick)

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      })
    })
    resizeObserver.observe(chartContainerRef.current)

    // Start NiftyFetcher on page open
    fetch('/madhan/api/nifty/start', { method: 'POST' }).catch(() => {})

    return () => {
      if (updaterRef.current) window.clearInterval(updaterRef.current)
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      resizeObserver.disconnect()
      chart.unsubscribeClick(handleChartClick)
      chart.unsubscribeCrosshairMove(handleChartCrosshairMove)
      chart.unsubscribeCrosshairMove(handleCrosshairOHLCV)
      if (chartContainerRef.current) {
        chartContainerRef.current.removeEventListener('dblclick', handleChartDblClick)
      }
      if (drawingManagerRef.current) {
        drawingManagerRef.current.detach()
        drawingManagerRef.current = null
      }
      indicatorSeriesRef.current.clear()
      sqrtPrimitiveRef.current = null
      coiLineSeriesRef.current = null
      oiLineSeriesRef.current = null
      coiCandleSeriesRef.current = null
      oiCandleSeriesRef.current = null
      coiTrendPaneRef.current = null
      coiTrendDataRef.current = null
      cePeMarkersRef.current = null
      cpMarkersRef.current = null
      if (thExtMarkerRef.current && thAnchorSeriesRef.current) {
        try { thAnchorSeriesRef.current.detachPrimitive(thExtMarkerRef.current as any) } catch {}
        try { chart.removeSeries(thAnchorSeriesRef.current) } catch {}
      }
      thExtMarkerRef.current = null
      thAnchorSeriesRef.current = null
      if (volumeProfileRef.current && candleRef.current) {
        try { candleRef.current.detachPrimitive(volumeProfileRef.current as any) } catch {}
      }
      volumeProfileRef.current = null
      rawSignalDataRef.current = []
      chart.remove()
      chartRef.current = null
      setChartReady(false)
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current) return
    const isDark = madhanMode === 'dark'
    chartRef.current.applyOptions({
      layout: {
        textColor: isDark ? '#a6adbb' : '#333',
      },
      rightPriceScale: {
        borderColor: isDark ? 'rgba(166,173,187,0.2)' : 'rgba(0,0,0,0.2)',
      },
    })
  }, [madhanMode])

  const calculateEMA = (data: Candle[], period: number) => {
    if (data.length < period) return []
    const result: Array<{ time: number; value: number }> = []
    let sum = 0
    for (let i = 0; i < period; i++) sum += data[i].close
    let prev = sum / period
    for (let i = 0; i < period - 1; i++) result.push({ time: data[i].time, value: Number.NaN })
    result.push({ time: data[period - 1].time, value: prev })
    const k = 2 / (period + 1)
    for (let i = period; i < data.length; i++) {
      prev = (data[i].close - prev) * k + prev
      result.push({ time: data[i].time, value: prev })
    }
    return result.filter((x) => !Number.isNaN(x.value))
  }

  const getIntervalSeconds = (val: string) => {
    if (val.endsWith('m')) return Math.max(1, Number(val.slice(0, -1) || '1')) * 60
    if (val.endsWith('s')) return Math.max(1, Number(val.slice(0, -1) || '1'))
    return 60
  }

  // Aggregate 1-minute candles into the user-selected interval, bucketing on
  // 00:00 IST of each trading day. This prevents the 09:08 pre-open candle
  // from being merged with the previous day's last candle by naive
  // Unix-time bucketing.
  const aggregateCandlesByDay = (candles: Candle[], selectedInterval: string): Candle[] => {
    if (!candles.length) return candles
    const intervalSec = getIntervalSeconds(selectedInterval)
    if (intervalSec <= 60) {
      return [...candles].sort((a, b) => a.time - b.time)
    }

    // IST is UTC+5:30.
    const IST_OFFSET_SEC = 5 * 3600 + 30 * 60
    const istDateKey = (ts: number) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(ts * 1000))
      return parts // YYYY-MM-DD
    }
    const istMidnightTs = (ts: number) => {
      const [y, m, d] = istDateKey(ts).split('-').map(Number)
      // Midnight IST = (UTC date at y/m/d 00:00) minus 5h30m to align IST.
      return Math.floor(Date.UTC(y, m - 1, d) / 1000) - IST_OFFSET_SEC
    }

    // Group by IST calendar date.
    const groups = new Map<string, Candle[]>()
    for (const c of candles) {
      const key = istDateKey(c.time)
      const arr = groups.get(key)
      if (arr) arr.push(c)
      else groups.set(key, [c])
    }

    const aggregated: Candle[] = []
    for (const key of Array.from(groups.keys()).sort()) {
      const dayCandles = [...(groups.get(key) || [])].sort((a, b) => a.time - b.time)
      if (!dayCandles.length) continue

      const dayStartTs = istMidnightTs(dayCandles[0].time)
      const buckets = new Map<number, Candle>()
      for (const c of dayCandles) {
        const offset = c.time - dayStartTs
        const bucketOffset = Math.floor(offset / intervalSec) * intervalSec
        const bucketTs = dayStartTs + bucketOffset
        const existing = buckets.get(bucketTs)
        if (existing) {
          if (c.high > existing.high) existing.high = c.high
          if (c.low < existing.low) existing.low = c.low
          existing.close = c.close
        } else {
          buckets.set(bucketTs, {
            time: bucketTs,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })
        }
      }
      for (const bk of Array.from(buckets.keys()).sort((a, b) => a - b)) {
        aggregated.push(buckets.get(bk)!)
      }
    }
    return aggregated
  }

  type CoiTrendCandle = { time: number; open: number; high: number; low: number; close: number }

  const aggregateCoiTrendCandles = (
    data: { timestamps: number[]; coi_percent: number[]; oi_trend_percent: number[] },
    selectedInterval: string
  ): { coiCandles: CoiTrendCandle[]; oiCandles: CoiTrendCandle[] } => {
    const coiCandles: CoiTrendCandle[] = []
    const oiCandles: CoiTrendCandle[] = []
    if (!data.timestamps.length) return { coiCandles, oiCandles }

    const intervalSec = getIntervalSeconds(selectedInterval)
    const IST_OFFSET_SEC = 5 * 3600 + 30 * 60
    const istDateKey = (ts: number) => {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts))
    }
    const istMidnightTs = (ts: number) => {
      const [y, m, d] = istDateKey(ts).split('-').map(Number)
      return Math.floor(Date.UTC(y, m - 1, d) / 1000) - IST_OFFSET_SEC
    }

    const groups = new Map<string, Array<{ time: number; coi: number; oi: number }>>()
    for (let i = 0; i < data.timestamps.length; i++) {
      const tsSec = data.timestamps[i] > 1e10 ? Math.floor(data.timestamps[i] / 1000) : data.timestamps[i]
      const key = istDateKey(tsSec * 1000)
      const arr = groups.get(key)
      const entry = { time: tsSec, coi: data.coi_percent[i] || 0, oi: data.oi_trend_percent[i] || 0 }
      if (arr) arr.push(entry)
      else groups.set(key, [entry])
    }

    for (const key of Array.from(groups.keys()).sort()) {
      const dayData = groups.get(key) || []
      if (!dayData.length) continue
      const dayStartTs = istMidnightTs(dayData[0].time * 1000)
      const coiBuckets = new Map<number, CoiTrendCandle>()
      const oiBuckets = new Map<number, CoiTrendCandle>()

      for (const pt of dayData) {
        const offset = pt.time - dayStartTs
        const bucketOffset = Math.floor(offset / intervalSec) * intervalSec
        const bucketTs = dayStartTs + bucketOffset

        const coiExisting = coiBuckets.get(bucketTs)
        if (coiExisting) {
          coiExisting.close = pt.coi
          if (pt.coi > coiExisting.high) coiExisting.high = pt.coi
          if (pt.coi < coiExisting.low) coiExisting.low = pt.coi
        } else {
          coiBuckets.set(bucketTs, { time: bucketTs, open: pt.coi, high: pt.coi, low: pt.coi, close: pt.coi })
        }

        const oiExisting = oiBuckets.get(bucketTs)
        if (oiExisting) {
          oiExisting.close = pt.oi
          if (pt.oi > oiExisting.high) oiExisting.high = pt.oi
          if (pt.oi < oiExisting.low) oiExisting.low = pt.oi
        } else {
          oiBuckets.set(bucketTs, { time: bucketTs, open: pt.oi, high: pt.oi, low: pt.oi, close: pt.oi })
        }
      }

      for (const bk of Array.from(coiBuckets.keys()).sort((a, b) => a - b)) {
        const coiCandle = coiBuckets.get(bk)!
        const oiCandle = oiBuckets.get(bk)!
        if (Number.isFinite(coiCandle.time) && Number.isFinite(coiCandle.open) && Number.isFinite(coiCandle.close)) {
          coiCandles.push(coiCandle)
          oiCandles.push(oiCandle)
        }
      }
    }

    return { coiCandles, oiCandles }
  }

  const toSeriesData = (plot: unknown, bars: Bar[], preserveWhitespace = false) => {
    if (!Array.isArray(plot)) return []
    return plot
      .map((item, index) => {
        const bar = bars[index]
        if (item && typeof item === 'object' && 'time' in (item as any) && 'value' in (item as any)) {
          const p = item as any
          if (typeof p.value === 'number' && Number.isFinite(p.value)) return p
          return preserveWhitespace ? { time: p.time } : null
        }
        if (typeof item === 'number' && Number.isFinite(item)) {
          if (!bar) return null
          return { time: bar.time as any, value: item }
        }
        if (preserveWhitespace && bar) return { time: bar.time as any }
        return null
      })
      .filter((point): point is { time: number; value?: number } => point != null)
  }

  const updateIndicatorSeries = useCallback((data: Candle[]) => {
    if (!indicatorSeriesRef.current.size) return
    const bars: Bar[] = data.map((item) => ({
      time: item.time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume ?? 0,
    }))
    const newValues: Record<string, Record<string, number>> = {}
    for (const instance of activeIndicators) {
      if (instance.visible === false) continue
      const entry = getIndicatorById(instance.indicatorId)
      const bucket = indicatorSeriesRef.current.get(instance.key)
      if (!entry || !bucket) continue
      const instanceValues: Record<string, number> = {}
      const processedSeries = new Set<ISeriesApi<any>>()
      try {
        const inputs = indicatorInputs[instance.key] || entry.defaultInputs || {}
        const result = entry.calculate(bars, inputs) as any
        const plots = result?.plots || {}
        const livePlotKeys = new Set<string>()
        const plotConfigList = Array.isArray((entry as any).plotConfig) ? (entry as any).plotConfig : []

        for (const [plotKey, plot] of Object.entries(plots)) {
          if (!Array.isArray(plot)) continue
          const plotConfig = plotConfigList.find((config: any) => config?.id === plotKey) || null
          const style = String(plotConfig?.style || 'line')
          const color = String(plotConfig?.color || '#2962FF')

          if (style === 'linebr' || style === 'steplinebr') {
            const lbEntry = bucket.lineBrPrimitives.find((e) => e.plotKey === plotKey)
            if (lbEntry) {
              const rawPlotData: Array<{ time: number; value?: number }> = plot
                .map((item: any, idx: number) => {
                  if (item && typeof item === 'object' && 'time' in item && 'value' in item) {
                    return { time: item.time, value: item.value }
                  }
                  if (typeof item === 'number') {
                    if (bars[idx]) return { time: bars[idx].time, value: item }
                    return null
                  }
                  if (bars[idx]) return { time: bars[idx].time }
                  return null
                })
                .filter((p: any): p is { time: number; value?: number } => p != null)
              lbEntry.primitive.setData(rawPlotData, color)
              processedSeries.add(lbEntry.anchorSeries)
              livePlotKeys.add(plotKey)
              for (let k = plot.length - 1; k >= 0; k--) {
                const point = plot[k] as any
                if (point && typeof point === 'object' && typeof point.value === 'number' && Number.isFinite(point.value)) {
                  instanceValues[plotKey] = point.value
                  break
                } else if (typeof point === 'number' && Number.isFinite(point)) {
                  instanceValues[plotKey] = point
                  break
                }
              }
              continue
            }
          }

          if (style === 'cross') {
            const crossEntry = bucket.crossPrimitives.find((e) => e.plotKey === plotKey)
            if (crossEntry) {
              const rawPlotData = plot
                .map((item: any, idx: number) => {
                  if (item && typeof item === 'object' && 'time' in item && typeof item.value === 'number') return { time: item.time, value: item.value }
                  if (typeof item === 'number' && bars[idx]) return { time: bars[idx].time, value: item }
                  return null
                })
                .filter((p: any): p is { time: number; value: number } => p != null)
              crossEntry.primitive.setData(rawPlotData, color, (plotConfig?.lineWidth ?? 1) * 3 || 6)
              processedSeries.add(crossEntry.anchorSeries)
              livePlotKeys.add(plotKey)
              for (let k = plot.length - 1; k >= 0; k--) {
                const point = plot[k] as any
                if (point && typeof point === 'object' && typeof point.value === 'number' && Number.isFinite(point.value)) {
                  instanceValues[plotKey] = point.value
                  break
                } else if (typeof point === 'number' && Number.isFinite(point)) {
                  instanceValues[plotKey] = point
                  break
                }
              }
              continue
            }
          }

          if (style === 'circles') {
            const series = bucket.plotSeries.get(plotKey)
            if (series) {
              series.setData(toSeriesData(plot, bars, false) as any)
              processedSeries.add(series)
              livePlotKeys.add(plotKey)
              for (let k = plot.length - 1; k >= 0; k--) {
                const point = plot[k] as any
                if (point && typeof point === 'object' && typeof point.value === 'number' && Number.isFinite(point.value)) {
                  instanceValues[plotKey] = point.value
                  break
                } else if (typeof point === 'number' && Number.isFinite(point)) {
                  instanceValues[plotKey] = point
                  break
                }
              }
              continue
            }
          }

          const series = bucket.plotSeries.get(plotKey)
          if (!series) continue
          if (processedSeries.has(series)) continue
          series.setData(toSeriesData(plot, bars, false) as any)
          processedSeries.add(series)
          for (let k = plot.length - 1; k >= 0; k--) {
            const point = plot[k] as any
            if (point && typeof point === 'object' && typeof point.value === 'number' && Number.isFinite(point.value)) {
              instanceValues[plotKey] = point.value
              break
            }
          }
          livePlotKeys.add(plotKey)
        }
        for (const [plotKey, series] of bucket.plotSeries.entries()) {
          if (!livePlotKeys.has(plotKey) && !processedSeries.has(series)) series.setData([] as any)
        }
        for (const markerEntry of bucket.markerSeries) {
          if (!livePlotKeys.has(markerEntry.plotKey)) markerEntry.primitive.setMarkers([])
        }

        if (Array.isArray(result?.markers) && result.markers.length > 0 && bucket.extendedMarkerPrimitive) {
          const nativeShapes = new Set(['circle', 'square', 'arrowUp', 'arrowDown'])
          const extended = result.markers
            .filter((m: any) => m && m.time && !nativeShapes.has(m.shape))
            .map((m: any) => ({
              time: m.time, position: m.position || 'aboveBar', price: m.price ?? 0,
              shape: m.shape || 'circle', color: m.color || '#2962FF', text: m.text,
            }))
          bucket.extendedMarkerPrimitive.setMarkers(extended)
        }

        if (bucket.plotFillPrimitives.length > 0) {
          const allRaw = new Map<string, Array<{ time: number; value?: number }>>()
          for (const [pk, plot] of Object.entries(plots)) {
            if (!Array.isArray(plot)) continue
            const mapped = plot
              .map((item: any, idx: number) => {
                if (item && typeof item === 'object' && 'time' in item && 'value' in item) return item as { time: number; value?: number }
                if (typeof item === 'number' && bars[idx]) return { time: bars[idx].time, value: item }
                return bars[idx] ? { time: bars[idx].time } : null
              })
              .filter(Boolean) as Array<{ time: number; value?: number }>
            allRaw.set(pk, mapped)
          }
          bucket.allPlotData = allRaw
          for (const fp of bucket.plotFillPrimitives) {
            const p1 = allRaw.get(fp.fillConfig.plot1) || []
            const p2 = allRaw.get(fp.fillConfig.plot2) || []
            const fillColor = applyTransparency(String(fp.fillConfig.options?.color || '#2962FF'), Number(fp.fillConfig.options?.transp ?? 0))
            const fillData: Array<{ time: number; upper: number; lower: number }> = []
            for (let fi = 0; fi < Math.min(p1.length, p2.length); fi++) {
              const v1 = typeof p1[fi] === 'number' ? p1[fi] : (p1[fi] as any)?.value
              const v2 = typeof p2[fi] === 'number' ? p2[fi] : (p2[fi] as any)?.value
              if (!Number.isFinite(v1) || !Number.isFinite(v2)) continue
              const time = (p1[fi] as any)?.time ?? bars[fi]?.time
              if (time == null) continue
              fillData.push({ time, upper: Math.max(v1!, v2!), lower: Math.min(v1!, v2!) })
            }
            fp.prim.setData(fillData, fillColor)
          }
        }

        // Handle barColors
        if (Array.isArray(result?.barColors) && result.barColors.length > 0) {
          const colorMap = new Map(result.barColors.map((bc: any) => [bc.time, bc.color]))
          const recolored = data.map((d) => {
            const color = colorMap.get(d.time)
            if (color) return { ...d, color, borderColor: color, wickColor: color }
            return d
          })
          candleRef.current?.setData(recolored as any)
        }

        // Handle bgColors
        if (Array.isArray(result?.bgColors) && bucket.bgColorPrimitive) {
          bucket.bgColorPrimitive.setData(result.bgColors.map((bg: any) => ({ time: bg.time, color: bg.color })))
        }

        // Handle labels
        if (Array.isArray(result?.labels) && bucket.labelPrimitive) {
          bucket.labelPrimitive.setLabels(result.labels)
        }

        // Handle boxes
        if (Array.isArray(result?.boxes) && bucket.boxPrimitive) {
          bucket.boxPrimitive.setBoxes(result.boxes)
        }

        // Handle lines
        if (Array.isArray(result?.lines) && bucket.lineDrawingPrimitive) {
          bucket.lineDrawingPrimitive.setLines(result.lines)
        }
      } catch {
        for (const series of bucket.plotSeries.values()) {
          if (!processedSeries.has(series)) series.setData([] as any)
        }
        for (const markerEntry of bucket.markerSeries) {
          markerEntry.primitive.setMarkers([])
        }
      }
      if (Object.keys(instanceValues).length) newValues[instance.key] = instanceValues
    }
  }, [activeIndicators, getIndicatorById, indicatorInputs])

  const addHorizontalLines = (data: Candle[]) => {
    if (!data.length || !dayOpenRef.current || !prevOpenRef.current || !prevHighRef.current || !prevLowRef.current || !prevCloseRef.current) return
    const dayGroups: Record<string, Candle[]> = {}
    data.forEach((c) => {
      const key = new Date(c.time * 1000).toDateString()
      if (!dayGroups[key]) dayGroups[key] = []
      dayGroups[key].push(c)
    })
    const days = Object.keys(dayGroups).sort((a, b) => +new Date(a) - +new Date(b))
    if (!days.length) return
    Object.values(dayGroups).forEach((arr) => arr.sort((a, b) => a.time - b.time))
    const currentDay = dayGroups[days[days.length - 1]]
    const dayOpen = currentDay[0].open
    let prevOpen = dayOpen
    let prevHigh = dayOpen
    let prevLow = dayOpen
    let prevClose = dayOpen
    if (days.length > 1) {
      const prev = dayGroups[days[days.length - 2]]
      prevOpen = prev[0].open
      prevHigh = Math.max(...prev.map((x) => x.high))
      prevLow = Math.min(...prev.map((x) => x.low))
      prevClose = prev[prev.length - 1].close
    }
    dayOpenRef.current.setData(data.map((d) => ({ time: d.time as any, value: dayOpen })))
    prevOpenRef.current.setData(data.map((d) => ({ time: d.time as any, value: prevOpen })))
    prevHighRef.current.setData(data.map((d) => ({ time: d.time as any, value: prevHigh })))
    prevLowRef.current.setData(data.map((d) => ({ time: d.time as any, value: prevLow })))
    prevCloseRef.current.setData(data.map((d) => ({ time: d.time as any, value: prevClose })))
  }

  const fetchOiProfiles = async () => {
    if (!candleRef.current) return
    const res = await fetch(`/madhan/api/nifty/oi_profile_data?_=${Date.now()}`)
    const json: OIProfileResponse = await res.json()
    if (!json?.oi?.strikes || !json?.coi?.strikes) return
    const seriesAny = candleRef.current as any
    if (!oiPrimitiveRef.current) {
      const oiPrimitive = new (class {
        _profile: any
        _series: any
        _mode: 'oi' | 'coi'
        _show: boolean
        _anchor: number
        _showStrike: boolean
        _showValues: boolean
        constructor(series: any, data: any, mode: 'oi' | 'coi') {
          this._profile = data
          this._series = series
          this._mode = mode
          this._show = true
          this._anchor = oiXRef.current / 100
          this._showStrike = oiShowStrikeRef.current
          this._showValues = oiShowValuesRef.current
        }
        paneViews() {
          const self = this
          return [
            {
              zOrder() { return 'top' as const },
              renderer() {
                return {
                  draw(target: any) {
                    if (!self._show || !self._profile?.strikes?.length) return
                    target.useBitmapCoordinateSpace((scope: any) => {
                      const ctx = scope.context
                      const chartWidth = scope.bitmapSize.width / scope.horizontalPixelRatio
                      const anchor = chartWidth * self._anchor
                      const maxAbs = Math.max(1, ...self._profile.strikes.map((s: any) => Math.max(Math.abs(s.ceOI || 0), Math.abs(s.peOI || 0))))
                      self._profile.strikes.forEach((s: any) => {
                        const y = self._series.priceToCoordinate(s.price)
                        if (y == null) return
                        const ceVal = Number(s.ceOI || 0)
                        const peVal = Number(s.peOI || 0)
                        const ceW = Math.max(2, (Math.abs(ceVal) / maxAbs) * 150)
                        const peW = Math.max(2, (Math.abs(peVal) / maxAbs) * 150)
                        const ceLeft = self._mode === 'oi' ? true : ceVal >= 0
                        const peLeft = self._mode === 'oi' ? true : peVal >= 0
                        const ceX = ceLeft ? anchor - ceW : anchor
                        const peX = peLeft ? anchor - peW : anchor
                        // CE color changes based on value
                        ctx.fillStyle = ceVal >= 0 ? '#f44336' : '#4caf50'
                        ctx.fillRect(ceX, y - 10, ceW, 8)
                        // PE color changes based on value
                        ctx.fillStyle = peVal >= 0 ? '#4caf50' : '#f44336'
                        ctx.fillRect(peX, y + 2, peW, 8)
                        if (self._showStrike) {
                          ctx.fillStyle = '#9ca3af'
                          ctx.font = '11px Arial'
                          ctx.fillText(String(s.price), anchor - 60, y + 3)
                        }
                        if (self._showValues) {
                          ctx.fillStyle = '#e5e7eb'
                          ctx.font = '8px Arial'
                          const ceLabelX = ceLeft ? ceX - 28 : ceX + ceW + 4
                          const peLabelX = peLeft ? peX - 28 : peX + peW + 4
                          ctx.fillText(formatCompact(ceVal), ceLabelX, y - 4)
                          ctx.fillText(formatCompact(peVal), peLabelX, y + 8)
                        }
                      })
                    })
                  },
                }
              },
            },
          ]
        }
        setData(v: any) { this._profile = v }
        toggle() { this._show = !this._show; return this._show }
        setAnchor(v: number) { this._anchor = v }
        setStrike(v: boolean) { this._showStrike = v }
        setValues(v: boolean) { this._showValues = v }
      })(seriesAny, json.oi, 'oi')
      seriesAny.attachPrimitive(oiPrimitive)
      oiPrimitiveRef.current = oiPrimitive
    } else {
      oiPrimitiveRef.current.setData(json.oi)
    }

    if (!coiPrimitiveRef.current) {
      const coiPrimitive = new (oiPrimitiveRef.current.constructor)(seriesAny, json.coi, 'coi')
      coiPrimitiveRef.current = coiPrimitive
      seriesAny.attachPrimitive(coiPrimitive)
    } else {
      coiPrimitiveRef.current.setData(json.coi)
    }
    oiPrimitiveRef.current.setAnchor(oiXRef.current / 100)
    oiPrimitiveRef.current.setStrike(oiShowStrikeRef.current)
    oiPrimitiveRef.current.setValues(oiShowValuesRef.current)
    coiPrimitiveRef.current.setAnchor(coiXRef.current / 100)
    coiPrimitiveRef.current.setStrike(coiShowStrikeRef.current)
    coiPrimitiveRef.current.setValues(coiShowValuesRef.current)
  }

  const fetchCoiHistory = async () => {
    if (!candleRef.current) return
    try {
      const res = await fetch(`/madhan/api/nifty/coi_history?days=30&_=${Date.now()}`)
      const json: CoiHistoryResponse = await res.json()
      if (json?.status !== 'success' || !json?.data?.length) return

      const candles = priceDataRef.current
      const seriesAny = candleRef.current as any
      if (!coiHistoryPrimitiveRef.current) {
        const prim = new (class {
          _series: any
          _chart: any
          _data: CoiHistoryDay[]
          _candles: Candle[]
          _show: boolean
          _interval: string
          _lastCandleMap: Map<string, number>
          constructor(series: any, chart: any, data: CoiHistoryDay[], candles: Candle[], interval: string) {
            this._series = series
            this._chart = chart
            this._data = data
            this._candles = candles
            this._show = false
            this._interval = interval
            this._lastCandleMap = new Map()
            this._buildMap()
          }
          _buildMap() {
            this._lastCandleMap.clear()
            const dayLastTs = new Map<string, number>()
            for (const c of this._candles) {
              const d = new Date(c.time * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
              dayLastTs.set(d, c.time)
            }
            for (const day of this._data) {
              const ts = dayLastTs.get(day.date)
              if (ts != null) this._lastCandleMap.set(day.date, ts)
            }
          }
          paneViews() {
            const self = this
            return [{
              zOrder() { return 'top' as const },
              renderer() {
                return {
                  draw(target: any) {
                    if (!self._show || !self._data.length) return
                    if (!self._chart) return
                    const timeScale = self._chart.timeScale()
                    target.useBitmapCoordinateSpace((scope: any) => {
                      const ctx = scope.context
                      const hpr = scope.horizontalPixelRatio
                      const vpr = scope.verticalPixelRatio
                      for (const day of self._data) {
                        const lastTs = self._lastCandleMap.get(day.date)
                        if (lastTs == null) continue
                        const x = timeScale.timeToCoordinate(lastTs as Time)
                        if (x == null) continue
                        const bx = x * hpr
                        const maxAbs = Math.max(1, ...day.strikes.map((s) => Math.max(Math.abs(s.ceOI || 0), Math.abs(s.peOI || 0))))
                        for (const s of day.strikes) {
                          const y = self._series.priceToCoordinate(s.price)
                          if (y == null) continue
                          const by = y * vpr
                          const ceVal = s.ceOI || 0
                          const peVal = s.peOI || 0
                          const ceW = Math.max(2, (Math.abs(ceVal) / maxAbs) * 120) * hpr
                          const peW = Math.max(2, (Math.abs(peVal) / maxAbs) * 120) * hpr
                          const barH = 5 * vpr
                          // CE: positive left (red), negative right (green)
                          const ceX = ceVal >= 0 ? bx - ceW : bx
                          ctx.fillStyle = ceVal >= 0 ? 'rgba(244,67,54,0.6)' : 'rgba(76,175,80,0.6)'
                          ctx.fillRect(ceX, by - barH - 1, ceW, barH)
                          // PE: positive left (green), negative right (red)
                          const peX = peVal >= 0 ? bx - peW : bx
                          ctx.fillStyle = peVal >= 0 ? 'rgba(76,175,80,0.6)' : 'rgba(244,67,54,0.6)'
                          ctx.fillRect(peX, by + 1, peW, barH)
                        }
                      }
                    })
                  },
                }
              },
            }]
          }
          setData(data: CoiHistoryDay[], candles: Candle[], interval: string) {
            this._data = data
            this._candles = candles
            this._interval = interval
            this._buildMap()
          }
          toggle() { this._show = !this._show; return this._show }
        })(seriesAny, chartRef.current, json.data, candles, interval)
        seriesAny.attachPrimitive(prim)
        coiHistoryPrimitiveRef.current = prim
      } else {
        coiHistoryPrimitiveRef.current.setData(json.data, candles, interval)
      }
      repaintOverlay()
    } catch (e) {
      console.error('[COI-HIST] error:', e)
    }
  }

  const toggleCoiHistory = async () => {
    if (!coiHistoryPrimitiveRef.current) {
      await fetchCoiHistory()
      setCoiHistoryActive(true)
      return
    }
    const v = coiHistoryPrimitiveRef.current.toggle()
    setCoiHistoryActive(v)
    repaintOverlay()
  }

  const buildVolumeProfile = async () => {
    if (!volumeProfileRef.current || !candleRef.current) return
    try {
      const [volRes, candlesRes] = await Promise.all([
        fetch(`/madhan/api/nifty/ce-pe-volume-changes?strike_selection_mode=option1&upside_strikes=10&downside_strikes=10&_=${Date.now()}`),
        fetch(`/madhan/nifty_live_data?interval=1m&_=${Date.now()}`),
      ])
      const volJson = await volRes.json()
      const candlesJson = await candlesRes.json()
      if (volJson?.status !== 'success' || !volJson?.data?.timestamps?.length) return

      const timestamps: number[] = volJson.data.timestamps || []
      const ce: number[] = volJson.data.ce_changes || []
      const pe: number[] = volJson.data.pe_changes || []

      // Build volume-by-timestamp map (1-min buckets, in seconds)
      const volMap = new Map<number, number>()
      for (let i = 0; i < timestamps.length; i++) {
        const rawTs = Number(timestamps[i] || 0)
        if (!rawTs) continue
        const tsSec = rawTs > 1e10 ? Math.floor(rawTs / 1000) : Math.floor(rawTs)
        const bucket = Math.floor(tsSec / 60) * 60
        const combined = Math.abs(Number(ce[i] || 0)) + Math.abs(Number(pe[i] || 0))
        volMap.set(bucket, (volMap.get(bucket) || 0) + combined)
      }

      // Always use raw 1-min candles for consistent profile granularity
      const allCandles: Candle[] = candlesJson?.data || []
      if (!allCandles.length) return
      const lastCandle = allCandles[allCandles.length - 1]
      const istDateKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(lastCandle.time * 1000))
      const dayCandles = allCandles.filter((c) => {
        const key = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(c.time * 1000))
        return key === istDateKey
      })
      if (!dayCandles.length) return

      // Build volume profile: distribute each candle's volume across its price range
      // 24-row adaptive sizing (TradingView standard)
      let minLow = Infinity, maxHigh = -Infinity
      for (const c of dayCandles) {
        if (c.low < minLow) minLow = c.low
        if (c.high > maxHigh) maxHigh = c.high
      }
      const rowSize = (maxHigh - minLow) > 0 ? Math.max(1, Math.ceil((maxHigh - minLow) / 24)) : 10
      const profile = new Map<number, number>()
      const developingPoc: Array<{ time: number; price: number }> = []
      let runningMaxVol = 0
      let runningPoc = 0

      for (const c of dayCandles) {
        const vol = volMap.get(c.time) || 0
        if (vol > 0) {
          const lowBucket = Math.floor(c.low / rowSize) * rowSize
          const highBucket = Math.ceil(c.high / rowSize) * rowSize
          const numBuckets = Math.max(1, Math.round((highBucket - lowBucket) / rowSize))
          const volPerBucket = vol / numBuckets
          for (let p = lowBucket; p < highBucket; p += rowSize) {
            profile.set(p, (profile.get(p) || 0) + volPerBucket)
          }
        }
        // Track developing POC at each candle
        let maxVol = 0
        let poc = 0
        for (const [price, v] of profile) {
          if (v > maxVol) { maxVol = v; poc = price }
        }
        const pocCenter = maxVol > 0 ? poc + rowSize / 2 : 0
        if (maxVol > runningMaxVol) { runningMaxVol = maxVol; runningPoc = pocCenter }
        developingPoc.push({ time: c.time, price: runningPoc })
      }

      volumeProfileRef.current.setData(runningPoc, developingPoc)
      if (volumeProfileActive) {
        chartRef.current?.timeScale().applyOptions({})
      }
    } catch (e) {
      console.error('[VP] build error:', e)
    }
  }

  const toggleVolumeProfile = () => {
    const next = !volumeProfileActive
    setVolumeProfileActive(next)
    if (next && volumeProfileRef.current) {
      buildVolumeProfile()
    }
    volumeProfileRef.current?.setVisible(next)
    chartRef.current?.timeScale().applyOptions({})
  }

  const toggleWritersView = () => {
    const next = !writersViewActive
    setWritersViewActive(next)
    writersViewActiveRef.current = next
    const mode = next ? 'option2' : 'option1'
    fetch(`/madhan/api/nifty/coi-trend?strike_selection_mode=${mode}&_=${Date.now()}`)
      .then((r) => r.json())
      .then((json) => {
        if (json?.status === 'success' && json?.data) {
          coiTrendDataRef.current = json.data
          plotCoiTrend()
        }
      })
      .catch((e) => console.error('[COI-TREND] fetch error:', e))
  }

  const createCoiTrendPane = () => {
    if (!chartRef.current) return
    const chartAny = chartRef.current as any
    if (coiTrendPaneRef.current) return

    const pane = chartAny.addPane()
    if (pane && typeof pane.setHeight === 'function') pane.setHeight(120)
    coiTrendPaneRef.current = pane

    const coiLine = pane.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#22c55e',
      bottomLineColor: '#ef4444',
      topFillColor1: 'transparent',
      topFillColor2: 'transparent',
      bottomFillColor1: 'transparent',
      bottomFillColor2: 'transparent',
      lineWidth: 2,
      title: 'COI %',
      priceScaleId: 'right',
      priceLineVisible: true,
      lastValueVisible: true,
    })
    coiLine.createPriceLine({
      price: 0,
      color: 'rgba(255, 255, 255, 0.3)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: '',
    })

    const oiLine = pane.addSeries(LineSeries, {
      color: '#FF6D00',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      title: 'OI Trend %',
      priceScaleId: 'right',
      priceLineVisible: true,
      lastValueVisible: true,
    })
    oiLine.createPriceLine({
      price: 0,
      color: 'rgba(255, 255, 255, 0.3)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: '',
    })

    const coiCandle = pane.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      title: 'COI %',
      priceScaleId: 'right',
      priceLineVisible: true,
      lastValueVisible: true,
      visible: false,
    })
    coiCandle.createPriceLine({
      price: 0,
      color: 'rgba(255, 255, 255, 0.3)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: '',
    })

    const oiCandle = pane.addSeries(CandlestickSeries, {
      upColor: '#FF6D00',
      downColor: '#FF8C00',
      borderVisible: false,
      wickUpColor: '#FF6D00',
      wickDownColor: '#FF8C00',
      title: 'OI Trend %',
      priceScaleId: 'right',
      priceLineVisible: true,
      lastValueVisible: true,
      visible: false,
    })
    oiCandle.createPriceLine({
      price: 0,
      color: 'rgba(255, 255, 255, 0.3)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: '',
    })

    coiLineSeriesRef.current = coiLine
    oiLineSeriesRef.current = oiLine
    coiCandleSeriesRef.current = coiCandle
    oiCandleSeriesRef.current = oiCandle
  }

  const plotCoiTrend = () => {
    const data = coiTrendDataRef.current
    if (!data || !data.timestamps.length) return

    const isLineMode = getIntervalSeconds(interval) <= 60

    if (isLineMode) {
      if (coiLineSeriesRef.current) {
        const coiData = data.timestamps
          .map((ts, i) => {
            const timeNum = ts > 1e10 ? ts / 1000 : ts
            const val = data.coi_percent[i]
            if (!Number.isFinite(timeNum) || !Number.isFinite(val)) return null
            return { time: timeNum as Time, value: val }
          })
          .filter((p): p is { time: Time; value: number } => p !== null)
          .sort((a, b) => (a.time as number) - (b.time as number))
        try { coiLineSeriesRef.current.setData(coiData as any) } catch {}
        coiLineSeriesRef.current.applyOptions({ visible: true })
      }
      if (oiLineSeriesRef.current) {
        const oiData = data.timestamps
          .map((ts, i) => {
            const timeNum = ts > 1e10 ? ts / 1000 : ts
            const val = data.oi_trend_percent[i]
            if (!Number.isFinite(timeNum) || !Number.isFinite(val)) return null
            return { time: timeNum as Time, value: val }
          })
          .filter((p): p is { time: Time; value: number } => p !== null)
          .sort((a, b) => (a.time as number) - (b.time as number))
        try { oiLineSeriesRef.current.setData(oiData as any) } catch {}
        oiLineSeriesRef.current.applyOptions({ visible: true })
      }
      if (coiCandleSeriesRef.current) {
        coiCandleSeriesRef.current.applyOptions({ visible: false })
        try { coiCandleSeriesRef.current.setData([]) } catch {}
      }
      if (oiCandleSeriesRef.current) {
        oiCandleSeriesRef.current.applyOptions({ visible: false })
        try { oiCandleSeriesRef.current.setData([]) } catch {}
      }
    } else {
      const { coiCandles, oiCandles } = aggregateCoiTrendCandles(data, interval)
      if (coiLineSeriesRef.current) {
        coiLineSeriesRef.current.applyOptions({ visible: false })
        try { coiLineSeriesRef.current.setData([]) } catch {}
      }
      if (oiLineSeriesRef.current) {
        oiLineSeriesRef.current.applyOptions({ visible: false })
        try { oiLineSeriesRef.current.setData([]) } catch {}
      }
      if (coiCandleSeriesRef.current && coiCandles.length) {
        try { coiCandleSeriesRef.current.setData(coiCandles as any) } catch {}
        coiCandleSeriesRef.current.applyOptions({ visible: true })
      }
      if (oiCandleSeriesRef.current && oiCandles.length) {
        try { oiCandleSeriesRef.current.setData(oiCandles as any) } catch {}
        oiCandleSeriesRef.current.applyOptions({ visible: true })
      }
    }
  }

  const fetchCoiTrend = async () => {
    try {
      const mode = writersViewActiveRef.current ? 'option2' : 'option1'
      const res = await fetch(`/madhan/api/nifty/coi-trend?strike_selection_mode=${mode}&_=${Date.now()}`)
      const json = await res.json()
      if (json?.status === 'success' && json?.data) {
        coiTrendDataRef.current = json.data
        plotCoiTrend()
      }
    } catch (e) {
      console.error('[COI-TREND] fetch error:', e)
    }
  }

  const fetchOptionCombinedVolume = async () => {
    if (!optionVolumeRef.current) return
    const res = await fetch(
      `/madhan/api/nifty/ce-pe-volume-changes?strike_selection_mode=option1&upside_strikes=10&downside_strikes=10&_=${Date.now()}`
    )
    const json = await res.json()
    if (json?.status !== 'success' || !json?.data?.timestamps?.length) {
      optionVolumeRef.current.setData([])
      return
    }
    const timestamps: number[] = json.data.timestamps || []
    const ce: number[] = json.data.ce_changes || []
    const pe: number[] = json.data.pe_changes || []
    const volSpike: boolean[] = json.data.vol_spike || []

    // Source is 1-min; aggregate by selected timeframe. For sub-minute intervals, keep 1-min buckets.
    const requestedBucketSec = getIntervalSeconds(interval)
    const bucketSec = Math.max(60, requestedBucketSec)
    const bucketMap = new Map<number, { value: number; spike: boolean }>()

    for (let i = 0; i < timestamps.length; i++) {
      const rawTs = Number(timestamps[i] || 0)
      if (!rawTs) continue
      const tsSec = rawTs > 1e10 ? Math.floor(rawTs / 1000) : Math.floor(rawTs)
      const bucket = Math.floor(tsSec / bucketSec) * bucketSec
      const combined = Math.abs(Number(ce[i] || 0)) + Math.abs(Number(pe[i] || 0))
      const existing = bucketMap.get(bucket)
      if (existing) {
        existing.value += combined
        existing.spike = existing.spike || !!volSpike[i]
      } else {
        bucketMap.set(bucket, { value: combined, spike: !!volSpike[i] })
      }
    }

    const aggregated = Array.from(bucketMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, { value, spike }]) => ({
        time: time as any,
        value,
        color: spike ? 'rgba(249, 115, 22, 1)' : 'rgba(59, 130, 246, 1)',
      }))

    optionVolumeRef.current.setData(aggregated as any)
  }

  const clearSqrtPriceLines = () => {
    if (sqrtPrimitiveRef.current) {
      sqrtPrimitiveRef.current.setData([])
    }
  }

  const applySqrtLevels = (data: Candle[]) => {
    const seriesAny = candleRef.current as any
    const chartAny = chartRef.current as any
    if (!seriesAny || !chartAny) return

    // Lazily create the primitive that draws day-bounded horizontal segments.
    if (!sqrtPrimitiveRef.current) {
      const primitive = new (class {
        _data: any[]
        _series: any
        _timeScale: any
        _show: boolean
        constructor(series: any, timeScale: any) {
          this._data = []
          this._series = series
          this._timeScale = timeScale
          this._show = true
        }
        paneViews() {
          const self = this
          return [
            {
              zOrder() { return 'normal' as const },
              renderer() {
                return {
                  draw(target: any) {
                    if (!self._show || !self._data?.length) return
                    target.useBitmapCoordinateSpace((scope: any) => {
                      const ctx = scope.context
                      const ts = scope.horizontalPixelRatio
                      const vs = scope.verticalPixelRatio
                      const chartWidth = scope.bitmapSize.width
                      self._data.forEach((seg: any) => {
                        const x1 = self._timeScale.timeToCoordinate(seg.from)
                        if (x1 == null) return
                        const x2 = seg.to != null ? self._timeScale.timeToCoordinate(seg.to) : null
                        const rightX = x2 != null ? x2 * ts : chartWidth
                        seg.levels.forEach((lvl: any) => {
                          const y = self._series.priceToCoordinate(lvl.price)
                          if (y == null) return
                          ctx.strokeStyle = lvl.color
                          // Force every line to render at exactly 1 CSS pixel wide.
                          ctx.lineWidth = 1 * vs
                          if (lvl.dashed) ctx.setLineDash([4 * vs, 4 * vs])
                          else ctx.setLineDash([])
                          ctx.beginPath()
                          ctx.moveTo(x1 * ts, y * vs)
                          ctx.lineTo(rightX, y * vs)
                          ctx.stroke()
                        })
                      })
                      ctx.setLineDash([])
                    })
                  },
                }
              },
            },
          ]
        }
        setData(v: any[]) {
          this._data = v || []
        }
        toggle() {
          this._show = !this._show
          return this._show
        }
      })(seriesAny, chartAny.timeScale())
      seriesAny.attachPrimitive(primitive)
      sqrtPrimitiveRef.current = primitive
    }

    if (!sqrtActiveRef.current || !data.length) {
      sqrtPrimitiveRef.current.setData([])
      return
    }

    // Group candles by trading day (local date).
    const dayGroups: Record<string, Candle[]> = {}
    data.forEach((c) => {
      const key = new Date(c.time * 1000).toDateString()
      if (!dayGroups[key]) dayGroups[key] = []
      dayGroups[key].push(c)
    })
    const days = Object.keys(dayGroups).sort((a, b) => +new Date(a) - +new Date(b))
    if (!days.length) {
      sqrtPrimitiveRef.current.setData([])
      return
    }
    Object.values(dayGroups).forEach((arr) => arr.sort((a, b) => a.time - b.time))

    const LEVEL_FACTORS = [0.398, 0.5, 0.786, 0.888]
    const LEVEL_COLORS = ['#fa031c', '#0df214', '#fa031c', '#0df214']
    const MID_COLOR = '#071ff7'

    const segments: any[] = []
    for (let d = 0; d < days.length; d++) {
      const dayArr = dayGroups[days[d]]
      const dayOpen = dayArr[0]?.open
      if (!Number.isFinite(dayOpen) || dayOpen <= 0) continue

      const basePrice = Math.floor(Math.sqrt(dayOpen))
      const bases = [basePrice - 1, basePrice, basePrice + 1]
      const fromTime = dayArr[0].time
      // For all days except the last, end at the next day's first bar.
      // For the most recent day, end at the last candle of that day.
      const toTime = d < days.length - 1 ? dayGroups[days[d + 1]][0].time : dayArr[dayArr.length - 1].time

      const levels: any[] = []
      bases.forEach((b) => {
        LEVEL_FACTORS.forEach((factor, idx) => {
          levels.push({
            price: (b + factor) * (b + factor),
            color: LEVEL_COLORS[idx],
            dashed: false,
          })
        })
      })
      levels.push({
        price: basePrice * basePrice,
        color: '#AAAAAA',
        dashed: false,
      })
      const MID_FACTORS = [0.199, 0.643]
      bases.forEach((b) => {
        MID_FACTORS.forEach((factor) => {
          levels.push({
            price: (b + factor) * (b + factor),
            color: MID_COLOR,
            dashed: true,
          })
        })
      })
      segments.push({ from: fromTime, to: toTime, levels })
    }

    sqrtPrimitiveRef.current.setData(segments)
  }

  const aggregateSignals = (signals: SignalRow[], selectedInterval: string): SignalRow[] => {
    const intervalSec = getIntervalSeconds(selectedInterval)
    if (intervalSec <= 60) return signals
    const IST_OFFSET_SEC = 5 * 3600 + 30 * 60
    const istDateKey = (ts: number) => {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts * 1000))
      return parts
    }
    const istMidnightTs = (ts: number) => {
      const [y, m, d] = istDateKey(ts).split('-').map(Number)
      return Math.floor(Date.UTC(y, m - 1, d) / 1000) - IST_OFFSET_SEC
    }
    const bucketMap = new Map<number, { ce: boolean; pe: boolean; cp: 'CE' | 'PE' | false; cpCe: boolean; th: 'CE' | 'PE' | 'dot' | false; thDir: 'CE' | 'PE' | false; ts: number }>()
    for (const sig of signals) {
      const midnight = istMidnightTs(sig.time)
      const offset = sig.time - midnight
      const bucketOffset = Math.floor(offset / intervalSec) * intervalSec
      const bucket = midnight + bucketOffset
      const existing = bucketMap.get(bucket)
      if (!existing) {
        bucketMap.set(bucket, { ce: sig.ce_signal, pe: sig.pe_signal, cp: sig.cp_signal, cpCe: sig.cp_ce_signal, th: sig.th_signal || false, thDir: sig.th_dir || false, ts: sig.time })
      } else {
        existing.ts = sig.time
        if (sig.ce_signal) { existing.ce = true; existing.pe = false }
        if (sig.pe_signal) { existing.pe = true; existing.ce = false }
        if (sig.cp_signal) existing.cp = sig.cp_signal
        if (sig.cp_ce_signal) existing.cpCe = true
        if (sig.th_signal) { existing.th = sig.th_signal; existing.thDir = sig.th_dir }
      }
    }
    return Array.from(bucketMap.entries()).map(([, v]) => ({
      time: v.ts, strike: 0, ce_signal: v.ce, pe_signal: v.pe,
      cp_signal: v.cp, cp_ce_signal: v.cpCe, th_signal: v.th, th_dir: v.thDir, ce_close: 0, pe_close: 0,
    })).sort((a, b) => a.time - b.time)
  }

  const updateSignalMarkers = () => {
    const candleSeries = candleRef.current
    if (!candleSeries) return
    const agg = aggregateSignals(rawSignalDataRef.current, interval)
    const candles = priceDataRef.current
    if (!candles.length) { cePeMarkersRef.current?.setMarkers([]); cpMarkersRef.current?.setMarkers([]); if (thExtMarkerRef.current) thExtMarkerRef.current.setMarkers([]); return }

    const candleTimes = new Set(candles.map((c) => c.time))
    const snapToCandle = (sigTime: number): number | null => {
      if (candleTimes.has(sigTime)) return sigTime
      const intervalSec = getIntervalSeconds(interval)
      const bucket = Math.floor(sigTime / intervalSec) * intervalSec
      if (candleTimes.has(bucket)) return bucket
      for (let offset = -intervalSec; offset <= intervalSec; offset += 60) {
        if (candleTimes.has(bucket + offset)) return bucket + offset
      }
      return null
    }

    const cePeMarkers = cePeSignalsActiveRef.current
      ? agg.filter((s) => s.ce_signal || s.pe_signal).flatMap((s) => {
          const snapped = snapToCandle(s.time)
          if (snapped === null) return []
          return [{
            time: snapped as Time,
            position: (s.ce_signal ? 'belowBar' : 'aboveBar') as 'aboveBar' | 'belowBar',
            color: s.ce_signal ? '#22c55e' : '#ef4444',
            shape: (s.ce_signal ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
          }]
        })
      : []
    cePeMarkersRef.current?.setMarkers(cePeMarkers)

    const cpMarkers = cpSignalsActiveRef.current
      ? agg.filter((s) => s.cp_signal).flatMap((s) => {
          const snapped = snapToCandle(s.time)
          if (snapped === null) return []
          return [{
            time: snapped as Time,
            position: (s.cp_signal === 'CE' ? 'belowBar' : 'aboveBar') as 'aboveBar' | 'belowBar',
            color: '#eab308',
            shape: 'circle' as 'circle',
          }]
        })
      : []
    cpMarkersRef.current?.setMarkers(cpMarkers)

    const thMarkers = thSignalsActiveRef.current
      ? (() => {
          let lastWasDot = false
          const filteredTh = agg.filter((s) => {
            if (!s.th_signal) return false
            if (s.th_signal === 'dot') {
              if (lastWasDot) return false
              lastWasDot = true
              return true
            }
            lastWasDot = false
            return true
          })
          return filteredTh.flatMap((s) => {
            const snapped = snapToCandle(s.time)
            if (snapped === null) return []
            const candle = candles.find((c) => c.time === snapped)
            if (s.th_signal === 'dot') {
              const isPositive = candle && candle.close >= candle.open
              const price = isPositive ? (candle?.high ?? 0) : (candle?.low ?? 0)
              return [{
                time: snapped,
                position: (isPositive ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
                price,
                shape: 'xcross',
                color: '#9C27B0',
                size: 0.5,
              }]
            }
            const isPe = s.th_signal === 'PE'
            const price = isPe ? (candle?.high ?? 0) : (candle?.low ?? 0)
            return [{
              time: snapped,
              position: (isPe ? 'aboveBar' : 'belowBar') as 'aboveBar' | 'belowBar',
              price,
              shape: 'circle',
              color: s.th_signal === 'CE' ? '#00C851' : '#FF4444',
              text: s.th_signal as string,
              size: 1,
            }]
          })
        })()
      : []
    if (thExtMarkerRef.current && thAnchorSeriesRef.current) {
      thAnchorSeriesRef.current.setData(candles.map((c) => ({ time: c.time as any, value: c.close })))
      thExtMarkerRef.current.setMarkers(thMarkers as any)
    }
  }

  const fetchSignalData = async () => {
    try {
      const today = new Date(Date.now() + getTimeOffset()).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      let res = await fetch(`/madhan/api/ezayChart_signals?_=${Date.now()}`)
      let json = await res.json()
      if (json?.status !== 'success' || !Array.isArray(json.data)) {
        res = await fetch(`/madhan/api/nifty/backtest_signals?date=${today}&_=${Date.now()}`)
        json = await res.json()
      }
      if (json?.status === 'success' && Array.isArray(json.data)) {
        const flat: SignalRow[] = []
        for (const entry of json.data) {
          if (entry.ezay_signals) {
            for (const sig of entry.ezay_signals) {
              flat.push({ ...sig, time: entry.time })
            }
          } else if (entry.time !== undefined && entry.strike !== undefined) {
            flat.push(entry)
          }
        }
        rawSignalDataRef.current = flat
      } else {
        rawSignalDataRef.current = []
      }
    } catch {
      rawSignalDataRef.current = []
    }
    updateSignalMarkers()
  }

  const refreshChartData = async () => {
    if (!candleRef.current || !ema34Ref.current || !ema55Ref.current) return
    // Always pull 1-minute data and aggregate locally so the 09:08 pre-open
    // candle of today is never merged with the previous day's last candle.
    const res = await fetch(`/madhan/nifty_live_data?interval=1m&_=${Date.now()}`)
    const json = await res.json()
    const rawData: Candle[] = json?.data || []
    const data = aggregateCandlesByDay(rawData, interval)
    priceDataRef.current = data
    candleRef.current.setData(data as any)
    ema34Ref.current.setData(calculateEMA(data, 34) as any)
    ema55Ref.current.setData(calculateEMA(data, 55) as any)
    updateIndicatorSeries(data)
    addHorizontalLines(data)
    applySqrtLevels(data)

    // Re-apply live WS tick so the current running candle isn't lost when
    // the API response only contains completed candles (e.g. at candle boundaries).
    const live = wsData.get('NSE_INDEX:NIFTY')
    const ltp = live?.data?.ltp
    if (typeof ltp === 'number') {
      applyRealtimeLtp(ltp, live?.lastUpdate ?? Date.now())
    }

    if (!crosshairOHLCV && data.length > 0) {
      const last = data[data.length - 1]
      const change = last.close - last.open
      setCrosshairOHLCV({
        time: new Date(last.time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        change,
        changePct: last.open !== 0 ? (change / last.open) * 100 : 0,
      })
    }
    await Promise.all([fetchOiProfiles(), fetchOptionCombinedVolume()])
    if (volumeProfileActive) buildVolumeProfile()
    fetchCoiHistory()
    fetchCoiTrend()
    fetchSignalData()
  }

  const refreshChartDataRef = useRef(refreshChartData)
  refreshChartDataRef.current = refreshChartData

  const repaintOverlay = () => {
    if (!candleRef.current || !priceDataRef.current.length) return
    const last = priceDataRef.current[priceDataRef.current.length - 1]
    // Force lightweight-charts to redraw attached primitives immediately.
    candleRef.current.update(last as any)
  }

  const applyRealtimeLtp = useCallback((ltp: number, timestampMs: number) => {
    if (!candleRef.current || !ema34Ref.current || !ema55Ref.current || !Number.isFinite(ltp)) return
    const data = [...priceDataRef.current]
    const intervalSeconds = getIntervalSeconds(interval)
    const tickSeconds = Math.floor(timestampMs / 1000)
    const candleTime = Math.floor(tickSeconds / intervalSeconds) * intervalSeconds

    if (!data.length) {
      const firstCandle: Candle = { time: candleTime, open: ltp, high: ltp, low: ltp, close: ltp }
      data.push(firstCandle)
      priceDataRef.current = data
      candleRef.current.update(firstCandle as any)
      ema34Ref.current.setData(calculateEMA(data, 34) as any)
      ema55Ref.current.setData(calculateEMA(data, 55) as any)
      updateIndicatorSeries(data)
      addHorizontalLines(data)
      return
    }

    const last = data[data.length - 1]
    if (candleTime < last.time) return

    let updated: Candle
    if (candleTime === last.time) {
      updated = {
        ...last,
        high: Math.max(last.high, ltp),
        low: Math.min(last.low, ltp),
        close: ltp,
      }
      data[data.length - 1] = updated
    } else {
      updated = { time: candleTime, open: ltp, high: ltp, low: ltp, close: ltp }
      data.push(updated)
    }

    priceDataRef.current = data
    candleRef.current.update(updated as any)
    ema34Ref.current.setData(calculateEMA(data, 34) as any)
    ema55Ref.current.setData(calculateEMA(data, 55) as any)
    updateIndicatorSeries(data)
    addHorizontalLines(data)
  }, [interval, updateIndicatorSeries])

  useEffect(() => {
    void refreshChartData().then(() => {
      if (chartRef.current) chartRef.current.timeScale().scrollToRealTime()
    })
  }, [interval])

  useEffect(() => {
    const intervalMs = getIntervalSeconds(interval) * 1000
    const tick = () => {
      const now = Date.now() + timeOffsetRef.current
      const secondsRemaining = Math.ceil((intervalMs - (now % intervalMs)) / 1000)
      if (secondsRemaining <= 0) { setCandleCountdown(''); return }
      const minutes = Math.floor(secondsRemaining / 60)
      const secs = secondsRemaining % 60
      const text = minutes > 0 ? `${minutes}m ${String(secs).padStart(2, '0')}s` : `${secs}s`
      setCandleCountdown(text)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [interval])

  useEffect(() => {
    if (!chartReady || coiTrendPaneRef.current) return
    createCoiTrendPane()
    fetchCoiTrend()
  }, [chartReady])

  useEffect(() => {
    cePeSignalsActiveRef.current = cePeSignalsActive
    cpSignalsActiveRef.current = cpSignalsActive
    thSignalsActiveRef.current = thSignalsActive
    updateSignalMarkers()
  }, [cePeSignalsActive, cpSignalsActive, thSignalsActive])

  const fetchNiftyStatus = useCallback(async () => {
    try {
      const res = await fetch(`/madhan/api/nifty/status?_=${Date.now()}`)
      const json = await res.json()
      if (json?.status === 'success' && json?.message) {
        setNiftyStatus(json.message)
        setNiftyRunning(!!json.is_running)
        niftyRunningRef.current = !!json.is_running
        // Re-sync time offset from server
        if (json.server_time) {
          const serverMs = new Date(json.server_time).getTime()
          timeOffsetRef.current = serverMs - Date.now()
          setTimeOffset(timeOffsetRef.current)
        }
        return json
      }
    } catch {}
    return null
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let pollInterval: ReturnType<typeof setInterval>
    let isFetching = false
    const getServerNow = () => new Date(Date.now() + timeOffsetRef.current)

    const checkAndRefresh = async () => {
      if (isFetching) return
      isFetching = true
      try {
        const statusData = await fetchNiftyStatus()
        if (!statusData?.is_running) {
          clearInterval(pollInterval)
          return
        }
        if (statusData.last_update) {
          const lastUpdate = new Date(statusData.last_update)
          const serverNow = getServerNow()
          if (lastUpdate.getMinutes() === serverNow.getMinutes()) {
            await refreshChartDataRef.current()
            setRefreshTrigger((t) => t + 1)
            clearInterval(pollInterval)
            scheduleNextMinute()
          }
        }
      } finally {
        isFetching = false
      }
    }

    const scheduleNextMinute = () => {
      clearTimeout(timer)
      const now = getServerNow()
      const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
      timer = setTimeout(() => {
        pollInterval = setInterval(checkAndRefresh, 1000)
      }, Math.max(0, msToNextMinute))
    }

    checkAndRefresh()
    scheduleNextMinute()
    return () => { clearTimeout(timer); clearInterval(pollInterval) }
  }, [fetchNiftyStatus])

  useEffect(() => {
    const live = wsData.get('NSE_INDEX:NIFTY')
    const ltp = live?.data?.ltp
    if (typeof ltp !== 'number') return
    const timestamp = live?.lastUpdate ?? Date.now()
    applyRealtimeLtp(ltp, timestamp)
  }, [wsData, applyRealtimeLtp])

  useEffect(() => {
    if (!chartReady || !chartRef.current) return
    const chart = chartRef.current
    const chartAny = chart as any
    const existing = indicatorSeriesRef.current
    for (const bucket of existing.values()) {
      for (const series of bucket.plotSeries.values()) {
        try { chart.removeSeries(series) } catch {}
      }
      for (const series of bucket.extraSeries) {
        try { chart.removeSeries(series) } catch {}
      }
      for (const lb of bucket.lineBrPrimitives) {
        try { lb.anchorSeries.detachPrimitive(lb.primitive) } catch {}
        try { chart.removeSeries(lb.anchorSeries) } catch {}
      }
      for (const fp of bucket.plotFillPrimitives) {
        try { fp.anchorSeries.detachPrimitive(fp.prim) } catch {}
      }
      if (bucket.extendedMarkerPrimitive && bucket.extendedMarkerAnchorSeries) {
        try { bucket.extendedMarkerAnchorSeries.detachPrimitive(bucket.extendedMarkerPrimitive as any) } catch {}
        try { chart.removeSeries(bucket.extendedMarkerAnchorSeries) } catch {}
      }
      if (bucket.bgColorPrimitive && bucket.bgColorAnchorSeries) {
        try { bucket.bgColorAnchorSeries.detachPrimitive(bucket.bgColorPrimitive as any) } catch {}
        try { chart.removeSeries(bucket.bgColorAnchorSeries) } catch {}
      }
      if (bucket.labelPrimitive && bucket.labelAnchorSeries) {
        try { bucket.labelAnchorSeries.detachPrimitive(bucket.labelPrimitive as any) } catch {}
        try { chart.removeSeries(bucket.labelAnchorSeries) } catch {}
      }
      if (bucket.boxPrimitive && bucket.boxAnchorSeries) {
        try { bucket.boxAnchorSeries.detachPrimitive(bucket.boxPrimitive as any) } catch {}
        try { chart.removeSeries(bucket.boxAnchorSeries) } catch {}
      }
      if (bucket.lineDrawingPrimitive && bucket.lineDrawingAnchorSeries) {
        try { bucket.lineDrawingAnchorSeries.detachPrimitive(bucket.lineDrawingPrimitive as any) } catch {}
        try { chart.removeSeries(bucket.lineDrawingAnchorSeries) } catch {}
      }
      if (bucket.tablePrimitive) {
        try { bucket.tablePrimitive.clearTable() } catch {}
      }
    }
    existing.clear()
    indicatorPaneRef.current.clear()
    for (let i = 0; i < activeIndicators.length; i++) {
      const instance = activeIndicators[i]
      const entry = getIndicatorById(instance.indicatorId)
      if (!entry) continue
      const inputs = indicatorInputs[instance.key] || entry.defaultInputs || {}
      const bars: Bar[] = priceDataRef.current.map((item) => ({
        time: item.time,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume ?? 0,
      }))
      let calculateResult: any = null
      try {
        calculateResult = entry.calculate(bars, inputs)
      } catch {
        calculateResult = { plots: { plot0: [] } }
      }
      const plots = calculateResult?.plots || {}
      const registryFills = Array.isArray(calculateResult?.fills) ? calculateResult.fills : []
      const plotConfigList = Array.isArray((entry as any).plotConfig) ? (entry as any).plotConfig : []
      const allPlotKeys = Object.keys(plots).filter((key) => Array.isArray((plots as any)[key]))
      const visiblePlotKeys = allPlotKeys.filter((key) => {
        const cfg = plotConfigList.find((p: any) => p?.id === key) || {}
        if (cfg.display === 'none') return false
        if (typeof cfg.lineWidth === 'number' && cfg.lineWidth <= 0) return false
        const plotVisible = instance.plotVisibility[key]
        if (plotVisible === false) return false
        return true
      })
      if (!visiblePlotKeys.length && allPlotKeys.length) visiblePlotKeys.push(allPlotKeys[0])
      if (!visiblePlotKeys.length) visiblePlotKeys.push('plot0')

      const linebrKeys = visiblePlotKeys.filter((key) => {
        const cfg = plotConfigList.find((p: any) => p?.id === key) || {}
        const style = String(cfg.style || 'line')
        return style === 'linebr' || style === 'steplinebr'
      })
      const nonLinebrKeys = visiblePlotKeys.filter((key) => !linebrKeys.includes(key))

      const paletteOffset = i * 3
      const indicatorTitle = `${entry.shortName || instance.indicatorId.toUpperCase()} ${i + 1}`
      let pane: any = null
      if ((entry.overlay ?? true) === false && typeof chartAny.addPane === 'function') {
        pane = chartAny.addPane()
        if (pane && typeof pane.setHeight === 'function') pane.setHeight(120)
        indicatorPaneRef.current.set(instance.key, pane)
      }
      const seriesByPlot = new Map<string, ISeriesApi<any>>()
      const extraSeries: ISeriesApi<any>[] = []
      const markerSeries: Array<{ plotKey: string; primitive: { setMarkers: (markers: any[]) => void } }> = []
      const lineBrEntries: Array<{ plotKey: string; primitive: LineBrPrimitive; anchorSeries: ISeriesApi<any> }> = []
      const crossEntries: Array<{ plotKey: string; primitive: CrossPlotPrimitive; anchorSeries: ISeriesApi<any> }> = []
      const allPlotData = new Map<string, Array<{ time: number; value?: number }>>()
      const addTo = pane && typeof pane.addSeries === 'function' ? pane : chart

      for (const plotKey of linebrKeys) {
        const cfg = plotConfigList.find((p: any) => p?.id === plotKey) || {}
        const color = cfg.color || indicatorColors[(paletteOffset + visiblePlotKeys.indexOf(plotKey)) % indicatorColors.length]
        const lineWidth = (cfg.lineWidth ?? 1) as number
        const withSteps = String(cfg.style || '') === 'steplinebr'
        const lineStyleCfg = Number(cfg.lineStyle ?? 0)
        const addTo = pane && typeof pane.addSeries === 'function' ? pane : chart

        const anchor = addTo.addSeries(LineSeries, {
          color: 'transparent',
          lineVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        }) as ISeriesApi<any>

        anchor.setData(toSeriesData((plots as any)[plotKey], bars, false) as any)

        const primitive = new LineBrPrimitive(anchor, chart.timeScale(), color, lineWidth, withSteps, lineStyleCfg)
        try { anchor.attachPrimitive(primitive as any) } catch {}

        const rawPlotData: Array<{ time: number; value?: number }> = ((plots as any)[plotKey] || [])
          .map((item: any, idx: number) => {
            if (item && typeof item === 'object' && 'time' in item && 'value' in item) {
              return { time: item.time, value: item.value }
            }
            if (typeof item === 'number') {
              if (bars[idx]) return { time: bars[idx].time, value: item }
              return null
            }
            if (bars[idx]) return { time: bars[idx].time }
            return null
          })
          .filter((p: any): p is { time: number; value?: number } => p != null)
        primitive.setData(rawPlotData, color, lineStyleCfg)

        seriesByPlot.set(plotKey, anchor)
        lineBrEntries.push({ plotKey, primitive, anchorSeries: anchor })
      }

      for (const plotKey of nonLinebrKeys) {
        const cfg = plotConfigList.find((p: any) => p?.id === plotKey) || {}
        const color = cfg.color || indicatorColors[(paletteOffset + visiblePlotKeys.indexOf(plotKey)) % indicatorColors.length]
        const title = `${indicatorTitle} ${cfg.title || plotKey}`
        const style = String(cfg.style || 'line')
        const lineWidth = (cfg.lineWidth ?? 1) as number
        let series: ISeriesApi<any>
        if (style === 'columns' || style === 'histogram') {
          series = addTo.addSeries(HistogramSeries, { title, color, lineWidth: lineWidth as any }) as ISeriesApi<any>
        } else if (style === 'area') {
          series = addTo.addSeries(AreaSeries, { title, lineColor: color, topColor: `${color}66`, bottomColor: `${color}11`, lineWidth: lineWidth as any }) as ISeriesApi<any>
        } else if (style === 'cross') {
          const anchor = addTo.addSeries(LineSeries, {
            title, color: 'transparent', lineWidth: 0 as const,
            lineVisible: false, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
          }) as ISeriesApi<any>
          anchor.setData(toSeriesData((plots as any)[plotKey], bars, false) as any)
          const crossPrim = new CrossPlotPrimitive(anchor, chart.timeScale())
          const crossColor = color
          const crossSize = (lineWidth * 3) || 6
          crossPrim.setData(
            ((plots as any)[plotKey] || []).map((item: any, idx: number) => {
              if (item && typeof item === 'object' && 'time' in item && typeof item.value === 'number') return { time: item.time, value: item.value }
              if (typeof item === 'number' && bars[idx]) return { time: bars[idx].time, value: item }
              return null
            }).filter((p: any): p is { time: number; value: number } => p != null),
            crossColor, crossSize
          )
          try { anchor.attachPrimitive(crossPrim as any) } catch {}
          series = anchor
          crossEntries.push({ plotKey, primitive: crossPrim, anchorSeries: anchor })
        } else if (style === 'circles') {
          series = addTo.addSeries(LineSeries, {
            title, color: 'transparent', lineWidth: 0 as const,
            lineVisible: false, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
            pointMarkersVisible: true, pointMarkerRadius: (lineWidth * 2) || 4,
          }) as ISeriesApi<any>
        } else {
          const isStep = style === 'stepline' || style === 'steplinebr'
          series = addTo.addSeries(LineSeries, {
            title, color, lineWidth: lineWidth as any,
            lineType: isStep ? (LineType as any).WithSteps : undefined,
            priceLineVisible: false, lastValueVisible: false,
          }) as ISeriesApi<any>
        }
        seriesByPlot.set(plotKey, series)
      }

      let extMarkerPrim: ExtendedMarkerPrimitive | undefined
      let extMarkerAnchor: ISeriesApi<any> | undefined
      let bgColorPrimitiveLocal: BgColorPrimitive | undefined
      let bgColorAnchorLocal: ISeriesApi<any> | undefined
      let labelPrimitiveLocal: LabelPrimitive | undefined
      let labelAnchorLocal: ISeriesApi<any> | undefined
      let boxPrimitiveLocal: BoxPrimitive | undefined
      let boxAnchorLocal: ISeriesApi<any> | undefined
      let lineDrawingPrimitiveLocal: LineDrawingPrimitive | undefined
      let lineDrawingAnchorLocal: ISeriesApi<any> | undefined
      let tablePrimitiveLocal: TablePrimitive | undefined

      if (Array.isArray(calculateResult?.plotCandle) && calculateResult.plotCandle.length > 0) {
        const candleData = calculateResult.plotCandle.map((c: any) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          ...(c.color && { color: c.color, borderColor: c.borderColor ?? c.color, wickColor: c.wickColor ?? c.color }),
        }))
        const candleSeries = addTo.addSeries(CandlestickSeries, {
          title: `${indicatorTitle} Candles`,
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderVisible: true,
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
          lastValueVisible: false,
          priceLineVisible: false,
        }) as ISeriesApi<any>
        candleSeries.setData(candleData)
        extraSeries.push(candleSeries)
      }

      // Handle barColors (recolor main candles)
      if (Array.isArray(calculateResult?.barColors) && calculateResult.barColors.length > 0) {
        const colorMap = new Map(calculateResult.barColors.map((bc: any) => [bc.time, bc.color]))
        const recolored = priceDataRef.current.map((d) => {
          const color = colorMap.get(d.time)
          if (color) return { ...d, color, borderColor: color, wickColor: color }
          return d
        })
        candleRef.current?.setData(recolored as any)
      }

      // Handle bgColors (background fills)
      if (Array.isArray(calculateResult?.bgColors) && calculateResult.bgColors.length > 0) {
        const anchor = addTo.addSeries(LineSeries, {
          color: 'transparent', lineVisible: false, lastValueVisible: false,
          priceLineVisible: false, crosshairMarkerVisible: false,
        }) as ISeriesApi<any>
        anchor.setData(bars.map(b => ({ time: b.time as any, value: 0 })))
        const bgPrim = new BgColorPrimitive(anchor, chart.timeScale())
        bgPrim.setData(calculateResult.bgColors.map((bg: any) => ({ time: bg.time, color: bg.color })))
        try { anchor.attachPrimitive(bgPrim as any) } catch {}
        bgColorPrimitiveLocal = bgPrim
        bgColorAnchorLocal = anchor
      }

      // Handle labels
      if (Array.isArray(calculateResult?.labels) && calculateResult.labels.length > 0) {
        const anchor = addTo.addSeries(LineSeries, {
          color: 'transparent', lineVisible: false, lastValueVisible: false,
          priceLineVisible: false, crosshairMarkerVisible: false,
        }) as ISeriesApi<any>
        anchor.setData(calculateResult.labels.map((l: any) => ({ time: l.time as any, value: l.price })))
        const lblPrim = new LabelPrimitive(anchor, chart.timeScale())
        lblPrim.setLabels(calculateResult.labels)
        try { anchor.attachPrimitive(lblPrim as any) } catch {}
        labelPrimitiveLocal = lblPrim
        labelAnchorLocal = anchor
      }

      // Handle boxes
      if (Array.isArray(calculateResult?.boxes) && calculateResult.boxes.length > 0) {
        const anchor = addTo.addSeries(LineSeries, {
          color: 'transparent', lineVisible: false, lastValueVisible: false,
          priceLineVisible: false, crosshairMarkerVisible: false,
        }) as ISeriesApi<any>
        const boxTimes = new Set<number>()
        const boxPrices: Record<number, number> = {}
        for (const b of calculateResult.boxes) {
          boxTimes.add(b.time1); boxTimes.add(b.time2)
          boxPrices[b.time1] = b.price1; boxPrices[b.time2] = b.price2
        }
        anchor.setData(Array.from(boxTimes).sort((a, b) => a - b).map(t => ({ time: t as any, value: boxPrices[t] })))
        const boxPrim = new BoxPrimitive(anchor, chart.timeScale())
        boxPrim.setBoxes(calculateResult.boxes)
        try { anchor.attachPrimitive(boxPrim as any) } catch {}
        boxPrimitiveLocal = boxPrim
        boxAnchorLocal = anchor
      }

      // Handle line drawings
      if (Array.isArray(calculateResult?.lines) && calculateResult.lines.length > 0) {
        const anchor = addTo.addSeries(LineSeries, {
          color: 'transparent', lineVisible: false, lastValueVisible: false,
          priceLineVisible: false, crosshairMarkerVisible: false,
        }) as ISeriesApi<any>
        const lineTimes = new Set<number>()
        const linePrices: Record<number, number> = {}
        for (const l of calculateResult.lines) {
          lineTimes.add(l.time1); lineTimes.add(l.time2)
          linePrices[l.time1] = l.price1; linePrices[l.time2] = l.price2
        }
        anchor.setData(Array.from(lineTimes).sort((a, b) => a - b).map(t => ({ time: t as any, value: linePrices[t] })))
        const linePrim = new LineDrawingPrimitive(anchor, chart.timeScale())
        linePrim.setLines(calculateResult.lines)
        try { anchor.attachPrimitive(linePrim as any) } catch {}
        lineDrawingPrimitiveLocal = linePrim
        lineDrawingAnchorLocal = anchor
      }

      // Handle table (DOM overlay)
      if (calculateResult?.table) {
        const tblPrim = new TablePrimitive(chartContainerRef.current!)
        tblPrim.setTable(calculateResult.table)
        tablePrimitiveLocal = tblPrim
      }

      const hlines = Array.isArray((entry as any).hlineConfig) ? (entry as any).hlineConfig : []
      if (hlines.length && seriesByPlot.size > 0) {
        const firstSeries = seriesByPlot.values().next().value as ISeriesApi<any>
        hlines.forEach((hl: any) => {
          const ls = String(hl.linestyle || 'solid')
          firstSeries.createPriceLine({
            price: Number(hl.price ?? 0),
            color: String(hl.color || '#787B86'),
            lineWidth: 1,
            lineStyle: ls === 'dashed' ? 2 : ls === 'dotted' ? 1 : 0,
            axisLabelVisible: false,
            title: hl.title || '',
          } as any)
        })
      }

      const plotFillEntries: Array<{ prim: PlotFillPrimitive; anchorSeries: ISeriesApi<any>; fillConfig: any }> = []
      if (registryFills.length > 0) {
        const anchorSeries = seriesByPlot.values().next().value as ISeriesApi<any>
        for (const fill of registryFills) {
          if (!fill || !fill.plot1 || !fill.plot2) continue
          const fillColor = applyTransparency(String(fill.options?.color || '#2962FF'), Number(fill.options?.transp ?? 0))
          const prim = new PlotFillPrimitive(anchorSeries, chart.timeScale(), fillColor)
          try { anchorSeries.attachPrimitive(prim as any) } catch {}

          const fillData: Array<{ time: number; upper: number; lower: number }> = []
          const p1Data = (plots as any)[fill.plot1] || []
          const p2Data = (plots as any)[fill.plot2] || []
          for (let fi = 0; fi < Math.min(p1Data.length, p2Data.length); fi++) {
            const v1 = typeof p1Data[fi] === 'number' ? p1Data[fi] : (p1Data[fi] as any)?.value
            const v2 = typeof p2Data[fi] === 'number' ? p2Data[fi] : (p2Data[fi] as any)?.value
            if (!Number.isFinite(v1) || !Number.isFinite(v2)) continue
            const time = (p1Data[fi] as any)?.time ?? bars[fi]?.time
            if (time == null) continue
            fillData.push({ time, upper: Math.max(v1!, v2!), lower: Math.min(v1!, v2!) })
          }
          prim.setData(fillData)

          plotFillEntries.push({ prim, anchorSeries, fillConfig: fill })
        }
      }

      if (Array.isArray(calculateResult?.markers) && calculateResult.markers.length > 0) {
        const nativeShapes = new Set(['circle', 'square', 'arrowUp', 'arrowDown'])
        const hasExtended = calculateResult.markers.some((m: any) => m && !nativeShapes.has(m.shape))
        if (hasExtended) {
          extMarkerAnchor = (pane && typeof pane.addSeries === 'function' ? pane : chart).addSeries(LineSeries, {
            color: 'transparent', lineVisible: false, lastValueVisible: false,
            priceLineVisible: false, crosshairMarkerVisible: false,
          }) as ISeriesApi<any>
          extMarkerAnchor.setData(bars.map(b => ({ time: b.time as any, value: 0 })))
          extMarkerPrim = new ExtendedMarkerPrimitive(extMarkerAnchor, chart.timeScale())
          try { extMarkerAnchor.attachPrimitive(extMarkerPrim as any) } catch {}
        }
      }

      if (extMarkerPrim && Array.isArray(calculateResult?.markers)) {
        extMarkerPrim.setMarkers(calculateResult.markers.map((m: any) => ({
          time: m.time, position: m.position || 'aboveBar', price: m.price ?? 0,
          shape: m.shape || 'circle', color: m.color || '#2962FF', text: m.text,
        })))
      }

      existing.set(instance.key, {
        plotSeries: seriesByPlot, extraSeries, markerSeries,
        lineBrPrimitives: lineBrEntries, crossPrimitives: crossEntries, plotFillPrimitives: plotFillEntries,
        allPlotData,
        extendedMarkerPrimitive: extMarkerPrim,
        extendedMarkerAnchorSeries: extMarkerAnchor,
        bgColorPrimitive: bgColorPrimitiveLocal, bgColorAnchorSeries: bgColorAnchorLocal,
        labelPrimitive: labelPrimitiveLocal, labelAnchorSeries: labelAnchorLocal,
        boxPrimitive: boxPrimitiveLocal, boxAnchorSeries: boxAnchorLocal,
        lineDrawingPrimitive: lineDrawingPrimitiveLocal, lineDrawingAnchorSeries: lineDrawingAnchorLocal,
        tablePrimitive: tablePrimitiveLocal,
      })

      const indicatorVisible = instance.visible !== false
      for (const [plotKey, series] of seriesByPlot.entries()) {
        const plotVisible = instance.plotVisibility[plotKey] !== false
        series.applyOptions({ visible: indicatorVisible && plotVisible })
      }
      for (const series of extraSeries) {
        series.applyOptions({ visible: indicatorVisible })
      }
      for (const lb of lineBrEntries) {
        const plotVisible = instance.plotVisibility[lb.plotKey] !== false
        lb.primitive.setVisible(indicatorVisible && plotVisible)
      }
      for (const fp of plotFillEntries) {
        fp.prim.setVisible(indicatorVisible)
      }
      for (const cp of crossEntries) {
        const plotVisible = instance.plotVisibility[cp.plotKey] !== false
        cp.primitive.setVisible(indicatorVisible && plotVisible)
      }
    }
    updateIndicatorSeries(priceDataRef.current)
  }, [activeIndicators, indicatorColors, updateIndicatorSeries, chartReady, getIndicatorById, indicatorInputs])

  useEffect(() => {
    if (ema34Ref.current) ema34Ref.current.applyOptions({ visible: emaActive })
    if (ema55Ref.current) ema55Ref.current.applyOptions({ visible: emaActive })
  }, [emaActive])

  useEffect(() => {
    if (dayOpenRef.current) dayOpenRef.current.applyOptions({ visible: dayOpenActive })
  }, [dayOpenActive])

  useEffect(() => {
    if (prevOpenRef.current) prevOpenRef.current.applyOptions({ visible: prevOhlcActive })
    if (prevHighRef.current) prevHighRef.current.applyOptions({ visible: prevOhlcActive })
    if (prevLowRef.current) prevLowRef.current.applyOptions({ visible: prevOhlcActive })
    if (prevCloseRef.current) prevCloseRef.current.applyOptions({ visible: prevOhlcActive })
  }, [prevOhlcActive])

  useEffect(() => {
    sqrtActiveRef.current = sqrtActive
    if (!candleRef.current) return
    if (sqrtActive) {
      applySqrtLevels(priceDataRef.current)
    } else {
      clearSqrtPriceLines()
    }
  }, [sqrtActive])

  useEffect(() => {
    oiXRef.current = oiX
    oiShowStrikeRef.current = oiShowStrike
    oiShowValuesRef.current = oiShowValues
    if (oiPrimitiveRef.current) {
      oiPrimitiveRef.current.setAnchor(oiX / 100)
      oiPrimitiveRef.current.setStrike(oiShowStrike)
      oiPrimitiveRef.current.setValues(oiShowValues)
      repaintOverlay()
    }
  }, [oiX, oiShowStrike, oiShowValues])

  useEffect(() => {
    coiXRef.current = coiX
    coiShowStrikeRef.current = coiShowStrike
    coiShowValuesRef.current = coiShowValues
    if (coiPrimitiveRef.current) {
      coiPrimitiveRef.current.setAnchor(coiX / 100)
      coiPrimitiveRef.current.setStrike(coiShowStrike)
      coiPrimitiveRef.current.setValues(coiShowValues)
      repaintOverlay()
    }
  }, [coiX, coiShowStrike, coiShowValues])

  // Handle indicator visibility toggling at runtime
  useEffect(() => {
    for (const instance of activeIndicators) {
      const bucket = indicatorSeriesRef.current.get(instance.key)
      if (!bucket) continue
      const indicatorVisible = instance.visible !== false
      for (const [plotKey, series] of bucket.plotSeries.entries()) {
        const plotVisible = instance.plotVisibility[plotKey] !== false
        series.applyOptions({ visible: indicatorVisible && plotVisible })
      }
      for (const series of bucket.extraSeries) {
        series.applyOptions({ visible: indicatorVisible })
      }
      for (const lb of bucket.lineBrPrimitives) {
        const plotVisible = instance.plotVisibility[lb.plotKey] !== false
        lb.primitive.setVisible(indicatorVisible && plotVisible)
      }
      for (const fp of bucket.plotFillPrimitives) {
        fp.prim.setVisible(indicatorVisible)
      }
    }
  }, [activeIndicators])

  const toggleOi = () => {
    if (!oiPrimitiveRef.current) return
    setOiActive(oiPrimitiveRef.current.toggle())
    repaintOverlay()
  }

  const toggleCoi = () => {
    if (!coiPrimitiveRef.current) return
    setCoiActive(coiPrimitiveRef.current.toggle())
    repaintOverlay()
  }

  const handleToolSelect = (toolType: string | null) => {
    if (!drawingManagerRef.current) return
    if (drawingPreviewIdRef.current) {
      drawingManagerRef.current.removeDrawing(drawingPreviewIdRef.current)
      drawingPreviewIdRef.current = null
    }
    drawingAnchorsRef.current = []
    drawingManagerRef.current.setActiveTool(toolType)
    setActiveDrawingTool(toolType)
    if (chartRef.current) {
      chartRef.current.applyOptions({ handleScroll: { pressedMouseMove: toolType == null } })
    }
  }

  const clearDrawings = () => {
    if (!drawingManagerRef.current) return
    drawingManagerRef.current.clearAll()
    drawingManagerRef.current.setActiveTool(null)
    drawingAnchorsRef.current = []
    drawingPreviewIdRef.current = null
    setActiveDrawingTool(null)
    setSelectedDrawingId(null)
    setSelectedDrawing(null)
    if (chartRef.current) {
      chartRef.current.applyOptions({ handleScroll: { pressedMouseMove: true } })
    }
  }

  const selectDrawingFromList = (id: string) => {
    if (!drawingManagerRef.current) return
    drawingManagerRef.current.selectDrawing(id)
  }

  const deleteDrawingFromList = (id: string) => {
    if (!drawingManagerRef.current) return
    drawingManagerRef.current.removeDrawing(id)
    if (selectedDrawingId === id) {
      setSelectedDrawingId(null)
      setSelectedDrawing(null)
    }
  }

  const handleTextEditorSave = () => {
    setEditingTextDrawing(null)
    drawingManagerRef.current?.deselectAll()
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId && drawingManagerRef.current) {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
        drawingManagerRef.current.removeDrawing(selectedDrawingId)
        setSelectedDrawingId(null)
        setSelectedDrawing(null)
      }
      if (e.key === 'Escape' && activeDrawingTool) {
        handleToolSelect(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedDrawingId, activeDrawingTool])

  const addIndicator = (indicatorId: string) => {
    const nextIndex = activeIndicators.filter((item) => item.indicatorId === indicatorId).length
    const key = `${indicatorId}-${Date.now()}-${nextIndex}`
    setActiveIndicators((prev) => [...prev, { key, indicatorId, visible: true, plotVisibility: {} }])
    setExpandedIndicatorKey(key)
  }

  const removeIndicator = (instanceKey: string) => {
    setActiveIndicators((prev) => prev.filter((item) => item.key !== instanceKey))
    setIndicatorInputs((prev) => {
      const next = { ...prev }
      delete next[instanceKey]
      return next
    })
  }

  const updateIndicatorInput = (instanceKey: string, inputId: string, value: unknown) => {
    setIndicatorInputs((prev) => ({
      ...prev,
      [instanceKey]: {
        ...(prev[instanceKey] || {}),
        [inputId]: value,
      },
    }))
  }

  const toggleIndicatorVisibility = (instanceKey: string) => {
    setActiveIndicators((prev) =>
      prev.map((item) =>
        item.key === instanceKey ? { ...item, visible: !item.visible } : item
      )
    )
  }

  const togglePlotVisibility = (instanceKey: string, plotKey: string) => {
    setActiveIndicators((prev) =>
      prev.map((item) => {
        if (item.key !== instanceKey) return item
        const next = { ...item.plotVisibility }
        next[plotKey] = !(plotKey in next ? next[plotKey] : true)
        return { ...item, plotVisibility: next }
      })
    )
  }

  const handleIndicatorPanelDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    indicatorPanelDragStart.current = { mx: e.clientX, my: e.clientY, px: indicatorPanelPos.x, py: indicatorPanelPos.y }
    setIndicatorPanelDragging(true)
  }

  useEffect(() => {
    if (!indicatorPanelDragging) return
    const onMove = (e: MouseEvent) => {
      if (!indicatorPanelDragStart.current) return
      const dx = e.clientX - indicatorPanelDragStart.current.mx
      const dy = e.clientY - indicatorPanelDragStart.current.my
      setIndicatorPanelPos({
        x: Math.max(0, indicatorPanelDragStart.current.px + dx),
        y: Math.max(0, indicatorPanelDragStart.current.py + dy),
      })
    }
    const onUp = () => {
      indicatorPanelDragStart.current = null
      setIndicatorPanelDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [indicatorPanelDragging])

  const handleIndicatorPanelResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    indicatorPanelResizeStart.current = { mx: e.clientX, w: indicatorPanelWidth }
    setIndicatorPanelResizing(true)
  }

  useEffect(() => {
    if (!indicatorPanelResizing) return
    const onMove = (e: MouseEvent) => {
      if (!indicatorPanelResizeStart.current) return
      const dx = e.clientX - indicatorPanelResizeStart.current.mx
      setIndicatorPanelWidth(Math.max(220, Math.min(600, indicatorPanelResizeStart.current.w + dx)))
    }
    const onUp = () => {
      indicatorPanelResizeStart.current = null
      setIndicatorPanelResizing(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [indicatorPanelResizing])

  return (
    <div className={cn("h-full w-full p-0 flex flex-col madhan-theme", madhanMode === 'dark' ? 'dark' : 'madhan-light')} style={madhanStyle}>
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
                        const { appMode: newMode } = useThemeStore.getState()
                        const { toast } = await import('sonner')
                        toast.success(result.message || `Switched to ${newMode === "live" ? "Analyze" : "Live"} mode`)
                    } else {
                        const { toast } = await import('sonner')
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
                onClick={toggleMadhanMode}
                title={madhanMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
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

      <Card className="flex flex-1 w-full flex-col overflow-hidden rounded-none border-0 py-0 gap-0 bg-card">
        <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-2 py-1.5">
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">Interval</Label>
            <Select value={interval} onValueChange={setIntervalValue}>
              <SelectTrigger className="h-7 w-20 text-[11px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1m">1m</SelectItem>
                <SelectItem value="3m">3m</SelectItem>
                <SelectItem value="5m">5m</SelectItem>
                <SelectItem value="15m">15m</SelectItem>
                <SelectItem value="30m">30m</SelectItem>
                <SelectItem value="5s">5s</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant={emaActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setEmaActive((v) => !v)}>EMA</Button>
          <Button variant={dayOpenActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setDayOpenActive((v) => !v)}>Day Open</Button>
          <Button variant={prevOhlcActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setPrevOhlcActive((v) => !v)}>Prev OHLC</Button>
          <Button variant={sqrtActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setSqrtActive((v) => !v)}>SQRT</Button>
          <Button variant={showIndicatorPanel ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setShowIndicatorPanel((v) => !v)}>Indicators</Button>
          <Button variant={showDrawingPanel ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => {
            if (showDrawingPanel) {
              setDrawingToolbarCollapsed((v) => !v)
            } else {
              setShowDrawingPanel(true)
              setDrawingToolbarCollapsed(false)
            }
          }}>Drawings</Button>
          <div className="flex items-center gap-1.5 rounded border px-1.5 py-0.5">
            <Button variant={oiActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={toggleOi}>OI</Button>
            <Label className="text-[11px]">X%</Label>
            <Input type="number" min={0} max={100} className="h-7 w-14 px-1 text-[11px]" value={oiX} onChange={(e) => setOiX(Number(e.target.value || 0))} />
            <div className="flex items-center gap-1">
              <Checkbox checked={oiShowStrike} onCheckedChange={(v) => setOiShowStrike(!!v)} />
              <Label className="text-[11px]">Labels</Label>
            </div>
            <div className="flex items-center gap-1">
              <Checkbox checked={oiShowValues} onCheckedChange={(v) => setOiShowValues(!!v)} />
              <Label className="text-[11px]">Values</Label>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded border px-1.5 py-0.5">
            <Button variant={coiActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={toggleCoi}>COI</Button>
            <Label className="text-[11px]">X%</Label>
            <Input type="number" min={0} max={100} className="h-7 w-14 px-1 text-[11px]" value={coiX} onChange={(e) => setCoiX(Number(e.target.value || 0))} />
            <div className="flex items-center gap-1">
              <Checkbox checked={coiShowStrike} onCheckedChange={(v) => setCoiShowStrike(!!v)} />
              <Label className="text-[11px]">Labels</Label>
            </div>
            <div className="flex items-center gap-1">
              <Checkbox checked={coiShowValues} onCheckedChange={(v) => setCoiShowValues(!!v)} />
              <Label className="text-[11px]">Values</Label>
            </div>
          </div>
          <Button variant={coiHistoryActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={toggleCoiHistory}>COI Hist</Button>
          <Button variant={writersViewActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={toggleWritersView}>Writers View</Button>
          <Button variant={cePeSignalsActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setCePeSignalsActive((p) => !p)}>CE/PE</Button>
          <Button variant={cpSignalsActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setCpSignalsActive((p) => !p)}>CP</Button>
          <Button variant={thSignalsActive ? 'default' : 'outline'} size="sm" className={cn('h-7 px-2 text-[11px]', thSignalsActive && 'bg-purple-600 text-white hover:bg-purple-700')} onClick={() => setThSignalsActive((p) => !p)}>TH</Button>
          <Button variant={volumeProfileActive ? 'default' : 'outline'} size="sm" className={cn('h-7 px-2 text-[11px]', volumeProfileActive && 'bg-amber-600 text-white hover:bg-amber-700')} onClick={toggleVolumeProfile}>VP</Button>
          <div className="flex items-center gap-1.5 ml-auto">
            {niftyStatus && (
              <div className="flex items-center gap-1" title={niftyStatus}>
                <div className={cn('h-1.5 w-1.5 rounded-full', niftyRunning ? 'bg-green-500' : 'bg-red-500')} />
                <span className="text-[10px] text-muted-foreground">{niftyStatus}</span>
              </div>
            )}
            <div className="flex items-center gap-1" title={wsError || (isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected')}>
              {isConnected ? (
                <Zap className="h-3 w-3 text-yellow-500 fill-yellow-500" />
              ) : isConnecting ? (
                <RefreshCw className="h-3 w-3 animate-spin text-blue-500" />
              ) : (
                <ZapOff className="h-3 w-3 text-red-500" />
              )}
              <span className="text-[10px] text-muted-foreground">
                {isConnected ? 'Live' : isConnecting ? 'Connecting' : 'Offline'}
              </span>
            </div>
            {!isConnected && !isConnecting && (
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => wsConnect()}>
                <RefreshCw className="mr-1 h-3 w-3" /> Reconnect
              </Button>
            )}
          </div>
        </div>
        <ChartLayout
          leftToolbar={
            <>
              {showDrawingPanel && (
                <DrawingToolbar
                  activeTool={activeDrawingTool}
                  onToolSelect={handleToolSelect}
                  drawingColor={drawingColor}
                  onColorChange={setDrawingColor}
                  lineWidth={lineWidth}
                  onLineWidthChange={setLineWidth}
                  onClearAll={clearDrawings}
                  collapsed={drawingToolbarCollapsed}
                  onToggleCollapse={() => setDrawingToolbarCollapsed((v) => !v)}
                />
              )}
            </>
          }
          rightPanel={
            <WidgetBar ezaySignals={<EzaySignals className="h-full" refreshTrigger={refreshTrigger} />}>
              <DrawingListPanel
                drawingManager={drawingManagerRef.current}
                selectedDrawingId={selectedDrawingId}
                onSelect={selectDrawingFromList}
                onDelete={deleteDrawingFromList}
              />
            </WidgetBar>
          }
        >
          <div ref={chartContainerRef} className="h-full w-full" />
          {candleCountdown && (
            <div
              className="absolute z-30 pointer-events-none select-none"
              style={{
                right: 80,
                top: 10,
                padding: '3px 8px',
                borderRadius: 4,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.03em',
                ...(madhanMode === 'dark'
                  ? { backgroundColor: 'rgba(15,15,15,0.88)', color: '#e5e5e5', border: '1px solid rgba(255,255,255,0.12)' }
                  : { backgroundColor: 'rgba(255,255,255,0.88)', color: '#1a1a1a', border: '1px solid rgba(0,0,0,0.12)' }),
              }}
            >
              {candleCountdown}
            </div>
          )}
          {crosshairOHLCV && (
            <div
              className="absolute top-2 left-3 z-30 pointer-events-none select-none"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: '18px' }}
            >
              <div className="flex items-center gap-3" style={{ color: t.text }}>
                <span className="font-semibold" style={{ color: t.text }}>NIFTY 50</span>
                <span style={{ color: t.textMuted }}>·</span>
                <span style={{ color: t.textMuted }}>{interval.toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-3" style={{ color: t.textSecondary }}>
                <span>O <span style={{ color: t.text }}>{crosshairOHLCV.open.toFixed(2)}</span></span>
                <span>H <span style={{ color: t.text }}>{crosshairOHLCV.high.toFixed(2)}</span></span>
                <span>L <span style={{ color: t.text }}>{crosshairOHLCV.low.toFixed(2)}</span></span>
                <span>C <span style={{ color: t.text }}>{crosshairOHLCV.close.toFixed(2)}</span></span>
                {crosshairOHLCV.change != null && (
                  <span style={{ color: crosshairOHLCV.change >= 0 ? '#26a69a' : '#ef5350' }}>
                    {crosshairOHLCV.change >= 0 ? '+' : ''}{crosshairOHLCV.change.toFixed(2)}
                    {' '}({crosshairOHLCV.changePct != null ? `${crosshairOHLCV.changePct >= 0 ? '+' : ''}${crosshairOHLCV.changePct.toFixed(2)}%` : '—'})
                  </span>
                )}
                {crosshairOHLCV.volume != null && (
                  <span>Vol <span style={{ color: t.text }}>{formatCompact(crosshairOHLCV.volume)}</span></span>
                )}
              </div>
            </div>
          )}
        </ChartLayout>
        {showIndicatorPanel && (
          <div
            className="absolute z-50 overflow-hidden rounded shadow-lg"
            style={{
              left: indicatorPanelPos.x,
              top: indicatorPanelPos.y,
              width: indicatorPanelWidth,
              height: 480,
              backgroundColor: t.panel,
              border: `1px solid ${t.border}`,
              cursor: indicatorPanelDragging ? 'grabbing' : undefined,
            }}
          >
            <IndicatorPanel
              activeIndicators={activeIndicators}
              onAdd={addIndicator}
              onRemove={removeIndicator}
              expandedKey={expandedIndicatorKey}
              onToggleExpand={toggleIndicatorExpand}
              collapsedCategories={collapsedCategories}
              onToggleCategory={(cat) => setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))}
              onCollapseAll={collapseAllCategories}
              inputs={indicatorInputs}
              onUpdateInput={updateIndicatorInput}
              onToggleVisibility={toggleIndicatorVisibility}
              onTogglePlotVisibility={togglePlotVisibility}
              onClose={() => setShowIndicatorPanel(false)}
              onDragStart={handleIndicatorPanelDragStart}
            />
            <div
              className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-blue-500/30"
              style={{ borderRadius: '0 4px 4px 0' }}
              onMouseDown={handleIndicatorPanelResizeStart}
            />
          </div>
        )}
      </Card>
      <TextEditorModal
        drawing={editingTextDrawing}
        onSave={handleTextEditorSave}
        onClose={() => setEditingTextDrawing(null)}
      />
    </div>
  )
}
