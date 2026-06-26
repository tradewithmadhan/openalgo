import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineType,
  type IChartApi,
  type ISeriesApi,
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
import { useMarketData } from '@/hooks/useMarketData'
import { Zap, ZapOff, RefreshCw, Sun, Moon } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
import { chartTheme } from './chartTheme'
import DrawingToolbar, { TEXT_DRAWING_TYPES } from './DrawingToolbar'
import DrawingListPanel from './DrawingListPanel'
import TextEditorModal from './TextEditorModal'
import ChartLayout from './ChartLayout'
import WidgetBar from './WidgetBar'
import IndicatorPanel from './IndicatorPanel'

type Candle = {
  time: number
  open: number
  high: number
  low: number
  close: number
}

type OIProfileResponse = {
  oi: { strikes: Array<{ price: number; ceOI: number; peOI: number }> }
  coi: { strikes: Array<{ price: number; ceOI: number; peOI: number }> }
}

type IndicatorInstance = {
  key: string
  indicatorId: string
  visible: boolean
  plotVisibility: Record<string, boolean>
}

type IndicatorSeriesBucket = {
  plotSeries: Map<string, ISeriesApi<any>>
  extraSeries: ISeriesApi<any>[]
  fillSeries: ISeriesApi<any>[]
  markerSeries: Array<{ plotKey: string; primitive: { setMarkers: (markers: any[]) => void } }>
  mergedSeries?: { series: ISeriesApi<any>; plotKeys: string[] }
  fillPrimitives: Array<{ plot1Key: string; plot2Key: string; color: string; transp: number; primitive: any }>
  allPlotData: Map<string, Array<{ time: number; value?: number }>>
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

class PlotFillPrimitive {
  _series: ISeriesApi<any>
  _timeScale: any
  _plot1Data: Array<{ time: number; value?: number }> = []
  _plot2Data: Array<{ time: number; value?: number }> = []
  _color: string
  _transp: number
  _show = true

  constructor(series: ISeriesApi<any>, timeScale: any, color: string, transp: number) {
    this._series = series
    this._timeScale = timeScale
    this._color = color
    this._transp = transp
  }

  paneViews() {
    const self = this
    return [
      {
        renderer() {
          return {
            draw(target: any) {
              if (!self._show || !self._plot1Data.length || !self._plot2Data.length) return
              target.useBitmapCoordinateSpace((scope: any) => {
                const ctx = scope.context
                const hpr = scope.horizontalPixelRatio
                const vpr = scope.verticalPixelRatio

                const timeToX = (time: number) => self._timeScale.timeToCoordinate(time)
                const priceToY = (price: number) => self._series.priceToCoordinate(price)

                const p1Map = new Map<number, number>()
                for (const pt of self._plot1Data) {
                  if (pt.value == null || !Number.isFinite(pt.value)) continue
                  const x = timeToX(pt.time)
                  const y = priceToY(pt.value)
                  if (x != null && y != null) p1Map.set(pt.time, y)
                }
                const p2Map = new Map<number, number>()
                for (const pt of self._plot2Data) {
                  if (pt.value == null || !Number.isFinite(pt.value)) continue
                  const x = timeToX(pt.time)
                  const y = priceToY(pt.value)
                  if (x != null && y != null) p2Map.set(pt.time, y)
                }

                const commonTimes: number[] = []
                for (const t of p1Map.keys()) {
                  if (p2Map.has(t)) commonTimes.push(t)
                }
                if (commonTimes.length < 2) return
                commonTimes.sort((a, b) => a - b)

                const r = parseInt(self._color.slice(1, 3), 16)
                const g = parseInt(self._color.slice(3, 5), 16)
                const b = parseInt(self._color.slice(5, 7), 16)
                const alpha = 1 - self._transp / 100
                ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`

                ctx.beginPath()
                for (let i = 0; i < commonTimes.length; i++) {
                  const time = commonTimes[i]
                  const x = timeToX(time)
                  if (x == null) continue
                  const y1 = p1Map.get(time)!
                  if (i === 0) ctx.moveTo(x * hpr, y1 * vpr)
                  else ctx.lineTo(x * hpr, y1 * vpr)
                }
                for (let i = commonTimes.length - 1; i >= 0; i--) {
                  const time = commonTimes[i]
                  const x = timeToX(time)
                  if (x == null) continue
                  const y2 = p2Map.get(time)!
                  ctx.lineTo(x * hpr, y2 * vpr)
                }
                ctx.closePath()
                ctx.fill()
              })
            },
          }
        },
      },
    ]
  }

  setPlot1Data(data: Array<{ time: number; value?: number }>) { this._plot1Data = data }
  setPlot2Data(data: Array<{ time: number; value?: number }>) { this._plot2Data = data }
  toggle() { this._show = !this._show; return this._show }
  setVisible(v: boolean) { this._show = v }
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

  const [interval, setIntervalValue] = useState('5m')
  const [oiActive, setOiActive] = useState(true)
  const [coiActive, setCoiActive] = useState(true)
  const [emaActive, setEmaActive] = useState(false)
  const [dayOpenActive, setDayOpenActive] = useState(false)
  const [prevOhlcActive, setPrevOhlcActive] = useState(false)
  const [sqrtActive, setSqrtActive] = useState(false)
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
  const [indicatorPanelDragging, setIndicatorPanelDragging] = useState(false)
  const indicatorPanelDragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  const [showDrawingPanel, setShowDrawingPanel] = useState(false)
  const [drawingToolbarCollapsed, setDrawingToolbarCollapsed] = useState(false)
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null)
  const [drawingColor, setDrawingColor] = useState('#3b82f6')
  const [lineWidth, setLineWidth] = useState(2)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [, setSelectedDrawing] = useState<IDrawing | null>(null)
  const [showDrawingList, setShowDrawingList] = useState(false)
  const [widgetBarCollapsed, setWidgetBarCollapsed] = useState(false)
  const [editingTextDrawing, setEditingTextDrawing] = useState<IDrawing | null>(null)
  const [chartReady, setChartReady] = useState(false)
  const [crosshairOHLCV, setCrosshairOHLCV] = useState<{ time: string; open: number; high: number; low: number; close: number; volume?: number } | null>(null)
  const [indicatorValues, setIndicatorValues] = useState<Record<string, Record<string, number>>>({})
  const wsSymbols = useMemo(() => [{ symbol: 'NIFTY', exchange: 'NSE_INDEX' }], [])
  const { data: wsData, isConnected, isConnecting, error: wsError, connect: wsConnect } = useMarketData({
    symbols: wsSymbols,
    mode: 'LTP',
    enabled: true,
  })
  const { mode: themeMode, toggleMode } = useThemeStore()
  const t = chartTheme[themeMode]

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
    if (!expandedIndicatorKey && activeIndicators.length > 0) {
      setExpandedIndicatorKey(activeIndicators[0].key)
    }
    if (expandedIndicatorKey && !activeIndicators.some((item) => item.key === expandedIndicatorKey)) {
      setExpandedIndicatorKey(activeIndicators[0]?.key || null)
    }
  }, [activeIndicators, expandedIndicatorKey])

  const indicatorColors = useMemo(
    () => ['#8b5cf6', '#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#14b8a6', '#a855f7', '#f97316'],
    []
  )

  const getIndicatorById = useCallback((indicatorId: string) => {
    return indicatorRegistry.find((item) => item.id === indicatorId)
  }, [])

  useEffect(() => {
    if (!chartContainerRef.current) return

    const isDark = document.documentElement.classList.contains('dark')
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
      if (!param?.time) {
        if (priceDataRef.current.length > 0) {
          const last = priceDataRef.current[priceDataRef.current.length - 1]
          setCrosshairOHLCV({
            time: new Date(last.time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close,
          })
        } else {
          setCrosshairOHLCV(null)
        }
        return
      }
      const ts = param.time as number
      const candle = priceDataRef.current.find((c) => c.time === ts)
      if (candle) {
        setCrosshairOHLCV({
          time: new Date(candle.time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })
      }
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
      chart.remove()
      chartRef.current = null
      setChartReady(false)
    }
  }, [])

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

  const toMarkerData = (plot: unknown, bars: Bar[], shape: 'circle' | 'cross', defaultColor: string) => {
    if (!Array.isArray(plot)) return []
    return plot
      .map((item, index) => {
        const bar = bars[index]
        if (item && typeof item === 'object' && 'time' in (item as any) && 'value' in (item as any)) {
          const point = item as any
          if (typeof point.value !== 'number' || !Number.isFinite(point.value)) return null
          return {
            time: point.time,
            position: 'atPriceMiddle',
            price: point.value,
            shape,
            color: typeof point.color === 'string' ? point.color : defaultColor,
          }
        }
        if (typeof item === 'number' && Number.isFinite(item) && bar) {
          return {
            time: bar.time as any,
            position: 'atPriceMiddle',
            price: item,
            shape,
            color: defaultColor,
          }
        }
        return null
      })
      .filter((marker): marker is { time: number; position: 'atPriceMiddle'; price: number; shape: 'circle' | 'cross'; color: string } => marker != null)
  }

  const updateIndicatorSeries = useCallback((data: Candle[]) => {
    if (!indicatorSeriesRef.current.size) return
    const bars: Bar[] = data.map((item) => ({
      time: item.time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: 0,
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

        if (bucket.mergedSeries && bucket.mergedSeries.plotKeys.length > 0) {
          const mergedData = new Map<number, { time: number; value?: number }>()
          for (const mk of bucket.mergedSeries.plotKeys) {
            const mPlot = (plots as any)[mk]
            if (!Array.isArray(mPlot)) continue
            for (let idx = 0; idx < mPlot.length; idx++) {
              const point = mPlot[idx] as any
              if (!point) continue
              const time = point.time ?? bars[idx]?.time
              if (time == null) continue
              if (typeof point === 'object' && typeof point.value === 'number' && Number.isFinite(point.value)) {
                if (!mergedData.has(time)) mergedData.set(time, { time, value: point.value })
              } else if (typeof point === 'number' && Number.isFinite(point)) {
                if (!mergedData.has(time)) mergedData.set(time, { time, value: point })
              } else if (!mergedData.has(time)) {
                mergedData.set(time, { time })
              }
            }
            livePlotKeys.add(mk)
            for (let k = mPlot.length - 1; k >= 0; k--) {
              const pt = mPlot[k] as any
              if (pt && typeof pt === 'object' && typeof pt.value === 'number' && Number.isFinite(pt.value)) {
                instanceValues[mk] = pt.value
                break
              } else if (typeof pt === 'number' && Number.isFinite(pt)) {
                instanceValues[mk] = pt
                break
              }
            }
          }
          const sorted = Array.from(mergedData.values()).sort((a, b) => a.time - b.time)
          if (!processedSeries.has(bucket.mergedSeries.series)) {
            bucket.mergedSeries.series.setData(sorted as any)
            processedSeries.add(bucket.mergedSeries.series)
          }
        }

        for (const [plotKey, plot] of Object.entries(plots)) {
          if (!Array.isArray(plot)) continue
          if (bucket.mergedSeries && bucket.mergedSeries.plotKeys.includes(plotKey)) continue
          const plotConfig = plotConfigList.find((config: any) => config?.id === plotKey) || null
          const style = String(plotConfig?.style || 'line')
          const series = bucket.plotSeries.get(plotKey)
          if (!series) continue
          if (processedSeries.has(series)) continue
          const preserveWhitespace = style === 'linebr' || style === 'steplinebr'
          series.setData(toSeriesData(plot, bars, preserveWhitespace) as any)
          processedSeries.add(series)
          if (style === 'cross' || style === 'circles') {
            const markerEntry = bucket.markerSeries.find((item) => item.plotKey === plotKey)
            markerEntry?.primitive.setMarkers(toMarkerData(plot, bars, style === 'cross' ? 'cross' : 'circle', String(plotConfig?.color || '#2962FF')))
          }
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

        if (bucket.fillPrimitives.length > 0 && bucket.allPlotData) {
          const allRaw = new Map<string, Array<{ time: number; value?: number }>>()
          for (const [pk, plot] of Object.entries(plots)) {
            if (!Array.isArray(plot)) continue
            const mapped = plot.map((item: any, idx: number) => {
              if (item && typeof item === 'object' && 'time' in item && 'value' in item) return item as { time: number; value?: number }
              if (typeof item === 'number' && bars[idx]) return { time: bars[idx].time, value: item }
              return bars[idx] ? { time: bars[idx].time } : null
            }).filter(Boolean) as Array<{ time: number; value?: number }>
            allRaw.set(pk, mapped)
          }
          bucket.allPlotData = allRaw
          for (const fp of bucket.fillPrimitives) {
            const d1 = allRaw.get(fp.plot1Key) || []
            const d2 = allRaw.get(fp.plot2Key) || []
            fp.primitive.setPlot1Data(d1)
            fp.primitive.setPlot2Data(d2)
          }
        }
      } catch {
        for (const series of bucket.plotSeries.values()) {
          if (!processedSeries.has(series)) series.setData([] as any)
        }
        if (bucket.mergedSeries && !processedSeries.has(bucket.mergedSeries.series)) {
          bucket.mergedSeries.series.setData([] as any)
        }
        for (const markerEntry of bucket.markerSeries) {
          markerEntry.primitive.setMarkers([])
        }
      }
      if (Object.keys(instanceValues).length) newValues[instance.key] = instanceValues
    }
    setIndicatorValues(newValues)
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

    // Source is 1-min; aggregate by selected timeframe. For sub-minute intervals, keep 1-min buckets.
    const requestedBucketSec = getIntervalSeconds(interval)
    const bucketSec = Math.max(60, requestedBucketSec)
    const bucketMap = new Map<number, number>()

    for (let i = 0; i < timestamps.length; i++) {
      const rawTs = Number(timestamps[i] || 0)
      if (!rawTs) continue
      const tsSec = rawTs > 1e10 ? Math.floor(rawTs / 1000) : Math.floor(rawTs)
      const bucket = Math.floor(tsSec / bucketSec) * bucketSec
      const combined = Math.abs(Number(ce[i] || 0)) + Math.abs(Number(pe[i] || 0))
      bucketMap.set(bucket, (bucketMap.get(bucket) || 0) + combined)
    }

    const aggregated = Array.from(bucketMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({
        time: time as any,
        value,
        color: 'rgba(59, 130, 246, 1)',
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

    if (!crosshairOHLCV && data.length > 0) {
      const last = data[data.length - 1]
      setCrosshairOHLCV({
        time: new Date(last.time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      })
    }
    await Promise.all([fetchOiProfiles(), fetchOptionCombinedVolume()])
  }

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
    void refreshChartData()
    if (updaterRef.current) window.clearInterval(updaterRef.current)
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    const msToNextMinute = (60 - new Date().getSeconds()) * 1000
    timeoutRef.current = window.setTimeout(() => {
      void refreshChartData()
      updaterRef.current = window.setInterval(() => void refreshChartData(), 60000)
    }, msToNextMinute)
    return () => {
      if (updaterRef.current) window.clearInterval(updaterRef.current)
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [interval])

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
      if (bucket.mergedSeries) {
        try { chart.removeSeries(bucket.mergedSeries.series) } catch {}
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
        volume: 0,
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
      const fillSeriesList: ISeriesApi<any>[] = []
      const markerSeries: Array<{ plotKey: string; primitive: { setMarkers: (markers: any[]) => void } }> = []
      const allPlotData = new Map<string, Array<{ time: number; value?: number }>>()
      let mergedSeries: { series: ISeriesApi<any>; plotKeys: string[] } | undefined

      if (linebrKeys.length > 0) {
        const firstCfg = plotConfigList.find((p: any) => p?.id === linebrKeys[0]) || {}
        const mergeColor = firstCfg.color || indicatorColors[paletteOffset % indicatorColors.length]
        const mergeTitle = `${indicatorTitle} ${linebrKeys.map((k) => {
          const c = plotConfigList.find((p: any) => p?.id === k) || {}
          return c.title || k
        }).join('/')}`
        const addTo = pane && typeof pane.addSeries === 'function' ? pane : chart
        const isStep = linebrKeys.some((k) => {
          const c = plotConfigList.find((p: any) => p?.id === k) || {}
          return String(c.style || '') === 'steplinebr'
        })
        const mergedLineSeries = addTo.addSeries(LineSeries, {
          title: mergeTitle,
          color: mergeColor,
          lineWidth: (firstCfg.lineWidth ?? 1) as any,
          lineType: isStep ? (LineType as any).WithSteps : undefined,
          priceLineVisible: false,
          lastValueVisible: false,
        }) as ISeriesApi<any>
        mergedSeries = { series: mergedLineSeries, plotKeys: linebrKeys }
        for (const plotKey of linebrKeys) {
          seriesByPlot.set(plotKey, mergedLineSeries)
        }
      }

      for (const plotKey of nonLinebrKeys) {
        const cfg = plotConfigList.find((p: any) => p?.id === plotKey) || {}
        const color = cfg.color || indicatorColors[(paletteOffset + visiblePlotKeys.indexOf(plotKey)) % indicatorColors.length]
        const title = `${indicatorTitle} ${cfg.title || plotKey}`
        const style = String(cfg.style || 'line')
        const lineWidth = (cfg.lineWidth ?? 1) as number
        const addTo = pane && typeof pane.addSeries === 'function' ? pane : chart
        let series: ISeriesApi<any>
        if (style === 'columns' || style === 'histogram') {
          series = addTo.addSeries(HistogramSeries, { title, color, lineWidth: lineWidth as any }) as ISeriesApi<any>
        } else if (style === 'area') {
          series = addTo.addSeries(AreaSeries, { title, lineColor: color, topColor: `${color}66`, bottomColor: `${color}11`, lineWidth: lineWidth as any }) as ISeriesApi<any>
        } else if (style === 'cross' || style === 'circles') {
          series = addTo.addSeries(LineSeries, {
            title, color: 'rgba(0,0,0,0)', lineWidth: 0 as const,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
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
        if (style === 'cross' || style === 'circles') {
          markerSeries.push({
            plotKey,
            primitive: createSeriesMarkers(series, [], { zOrder: 'top' }),
          })
        }
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

      const registryFillsList: Array<{ plot1Key: string; plot2Key: string; color: string; transp: number; primitive: any }> = []
      if (registryFills.length && seriesByPlot.size > 0) {
        const fillTargetSeries = seriesByPlot.values().next().value as ISeriesApi<any>
        for (const fill of registryFills) {
          if (!fill || !fill.plot1 || !fill.plot2) continue
          const fillColor = String(fill.options?.color || '#2962FF')
          const fillTransp = Number(fill.options?.transp ?? 90)
          const prim = new PlotFillPrimitive(fillTargetSeries, chartAny.timeScale(), fillColor, fillTransp)
          try { fillTargetSeries.attachPrimitive(prim as any) } catch {}
          registryFillsList.push({ plot1Key: fill.plot1, plot2Key: fill.plot2, color: fillColor, transp: fillTransp, primitive: prim })
        }
      }

      existing.set(instance.key, { plotSeries: seriesByPlot, extraSeries, fillSeries: fillSeriesList, markerSeries, mergedSeries, fillPrimitives: registryFillsList, allPlotData })

      const indicatorVisible = instance.visible !== false
      for (const [plotKey, series] of seriesByPlot.entries()) {
        const plotVisible = instance.plotVisibility[plotKey] !== false
        if (mergedSeries && mergedSeries.plotKeys.includes(plotKey)) {
          series.applyOptions({ visible: indicatorVisible && mergedSeries.plotKeys.some((pk) => instance.plotVisibility[pk] !== false) })
        } else {
          series.applyOptions({ visible: indicatorVisible && plotVisible })
        }
      }
      for (const series of extraSeries) {
        series.applyOptions({ visible: indicatorVisible })
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
        if (bucket.mergedSeries && bucket.mergedSeries.plotKeys.includes(plotKey)) {
          series.applyOptions({ visible: indicatorVisible && bucket.mergedSeries.plotKeys.some((pk) => instance.plotVisibility[pk] !== false) })
        } else {
          series.applyOptions({ visible: indicatorVisible && plotVisible })
        }
      }
      for (const series of bucket.extraSeries) {
        series.applyOptions({ visible: indicatorVisible })
      }
      for (const fp of bucket.fillPrimitives) {
        fp.primitive.setVisible(indicatorVisible)
      }
      if (bucket.mergedSeries) {
        const anyVisible = bucket.mergedSeries.plotKeys.some((pk) => instance.plotVisibility[pk] !== false)
        bucket.mergedSeries.series.applyOptions({ visible: indicatorVisible && anyVisible })
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

  return (
    <div className="h-full w-full p-0">
      <Card className="flex h-full w-full flex-col overflow-hidden rounded-none border-0 py-0 gap-0 bg-card">
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
          <Button variant={showDrawingList ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setShowDrawingList((v) => !v)}>Object Tree</Button>
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
          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 px-0"
              onClick={toggleMode}
              title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {themeMode === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
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
            showDrawingList ? (
              <WidgetBar
                collapsed={widgetBarCollapsed}
                onToggleCollapse={() => setWidgetBarCollapsed((v) => !v)}
              >
                <DrawingListPanel
                  drawingManager={drawingManagerRef.current}
                  selectedDrawingId={selectedDrawingId}
                  onSelect={selectDrawingFromList}
                  onDelete={deleteDrawingFromList}
                />
              </WidgetBar>
            ) : undefined
          }
          bottomBar={
            <>
              {Object.keys(indicatorValues).length > 0 && (
                <div
                  className="flex shrink-0 items-center gap-3 px-3 py-1 text-[10px]"
                  style={{ borderTop: `1px solid ${t.border}`, backgroundColor: t.panelDarker, color: t.textSecondary }}
                >
                  {activeIndicators
                    .filter((inst) => inst.visible !== false && indicatorValues[inst.key])
                    .map((inst) => {
                      const entry = getIndicatorById(inst.indicatorId)
                      if (!entry) return null
                      const vals = indicatorValues[inst.key]
                      const plotConfigList = Array.isArray((entry as any).plotConfig) ? (entry as any).plotConfig : []
                      return (
                        <div key={inst.key} className="flex items-center gap-1.5">
                          <span style={{ color: t.text, fontWeight: 500 }}>{entry.shortName}</span>
                          {Object.entries(vals).map(([plotKey, value]) => {
                            const cfg = plotConfigList.find((p: any) => p?.id === plotKey) || {}
                            const color = cfg.color || t.active
                            const title = cfg.title || plotKey
                            return (
                              <span key={plotKey} style={{ color }}>
                                {title} <span style={{ color: t.text }}>{Number.isFinite(value) ? value.toFixed(2) : '—'}</span>
                              </span>
                            )
                          })}
                        </div>
                      )
                    })}
                </div>
              )}
              {crosshairOHLCV ? (
                <div
                  className="flex shrink-0 items-center gap-3 px-3 py-1 text-[11px]"
                  style={{ borderTop: `1px solid ${t.border}`, backgroundColor: t.panelDarker, color: t.textSecondary }}
                >
                  <span style={{ color: t.textMuted }}>{crosshairOHLCV.time}</span>
                  <span>O <span style={{ color: t.text }}>{crosshairOHLCV.open.toFixed(2)}</span></span>
                  <span>H <span style={{ color: t.text }}>{crosshairOHLCV.high.toFixed(2)}</span></span>
                  <span>L <span style={{ color: t.text }}>{crosshairOHLCV.low.toFixed(2)}</span></span>
                  <span>C <span style={{ color: t.text }}>{crosshairOHLCV.close.toFixed(2)}</span></span>
                  <span className="ml-auto" style={{ color: t.textMuted }}>NIFTY 50</span>
                </div>
              ) : undefined}
            </>
          }
        >
          <div ref={chartContainerRef} className="h-full w-full" />
        </ChartLayout>
        {showIndicatorPanel && (
          <div
            className="absolute z-50 overflow-hidden rounded shadow-lg"
            style={{
              left: indicatorPanelPos.x,
              top: indicatorPanelPos.y,
              width: 280,
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
              onToggleExpand={setExpandedIndicatorKey}
              inputs={indicatorInputs}
              onUpdateInput={updateIndicatorInput}
              onToggleVisibility={toggleIndicatorVisibility}
              onTogglePlotVisibility={togglePlotVisibility}
              onClose={() => setShowIndicatorPanel(false)}
              onDragStart={handleIndicatorPanelDragStart}
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
