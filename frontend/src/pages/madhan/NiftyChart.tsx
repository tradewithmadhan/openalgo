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
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts'
import { indicatorRegistry } from 'lightweight-charts-indicators'
import { DrawingManager, HorizontalRay, TrendLine } from 'lightweight-charts-drawing'
import type { Bar } from 'oakscriptjs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useMarketData } from '@/hooks/useMarketData'

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
}

type IndicatorSeriesBucket = {
  plotSeries: Map<string, ISeriesApi<any>>
  extraSeries: ISeriesApi<any>[]
  markerSeries: Array<{ plotKey: string; primitive: { setMarkers: (markers: any[]) => void } }>
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
  const trendStartAnchorRef = useRef<{ time: Time; price: number } | null>(null)
  const trendPreviewIdRef = useRef<string | null>(null)
  const activeDrawingToolRef = useRef<'trend-line' | 'horizontal-ray' | null>(null)
  const drawingColorRef = useRef('#3b82f6')
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
  const [indicatorSearch, setIndicatorSearch] = useState('')
  const [activeIndicators, setActiveIndicators] = useState<IndicatorInstance[]>([
    { key: 'sma-0', indicatorId: 'sma' },
    //{ key: 'rsi-0', indicatorId: 'rsi' },
  ])
  const [indicatorInputs, setIndicatorInputs] = useState<Record<string, Record<string, unknown>>>({})
  const [expandedIndicatorKey, setExpandedIndicatorKey] = useState<string | null>(null)
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false)
  const [showDrawingPanel, setShowDrawingPanel] = useState(false)
  const [activeDrawingTool, setActiveDrawingTool] = useState<'trend-line' | 'horizontal-ray' | null>(null)
  const [drawingColor, setDrawingColor] = useState('#3b82f6')
  const [chartReady, setChartReady] = useState(false)
  const wsSymbols = useMemo(() => [{ symbol: 'NIFTY', exchange: 'NSE_INDEX' }], [])
  const { data: wsData } = useMarketData({
    symbols: wsSymbols,
    mode: 'LTP',
    enabled: true,
  })

  useEffect(() => {
    activeDrawingToolRef.current = activeDrawingTool
    if (!activeDrawingTool) trendStartAnchorRef.current = null
  }, [activeDrawingTool])

  useEffect(() => {
    drawingColorRef.current = drawingColor
  }, [drawingColor])

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

  const availableIndicators = useMemo(
    () =>
      indicatorRegistry.filter((item) => {
        const query = indicatorSearch.trim().toLowerCase()
        if (!query) return true
        return (
          item.id.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query) ||
          item.shortName.toLowerCase().includes(query)
        )
      }),
    [indicatorSearch]
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
    const chartAny = chart as any
    let optionVolumeSeries: ISeriesApi<'Histogram'> | null = null
    if (typeof chartAny.addPane === 'function') {
      const volumePane = chartAny.addPane()
      if (volumePane && typeof volumePane.setHeight === 'function') {
        volumePane.setHeight(140)
      }
      if (volumePane && typeof volumePane.addSeries === 'function') {
        optionVolumeSeries = volumePane.addSeries(HistogramSeries, {
          title: 'CE+PE Volume',
          color: 'rgba(59, 130, 246, 1)',
          priceFormat: { type: 'volume' },
        }) as ISeriesApi<'Histogram'>
      }
    }
    if (!optionVolumeSeries) {
      optionVolumeSeries = chart.addSeries(HistogramSeries, {
        title: 'CE+PE Volume',
        color: 'rgba(59, 130, 246, 1)',
        priceFormat: { type: 'volume' },
      })
    }
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
    const handleChartClick = (param: any) => {
      const tool = activeDrawingToolRef.current
    if (!drawingManagerRef.current || !param?.point) return
    if (!tool) {
        const hit = drawingManagerRef.current.hitTest({ x: param.point.x, y: param.point.y })
      if (hit) {
        drawingManagerRef.current.selectDrawing(hit.id)
        chart.applyOptions({ handleScroll: { pressedMouseMove: false } })
      } else {
        drawingManagerRef.current.deselectAll()
        chart.applyOptions({ handleScroll: { pressedMouseMove: true } })
      }
      return
    }
      if (param?.time == null) return
      const price = candle.coordinateToPrice(param.point.y)
      if (price == null) return
      const anchor = { time: param.time as Time, price }
      if (tool === 'horizontal-ray') {
      drawingManagerRef.current.addDrawing(new HorizontalRay(`hr-${Date.now()}`, [anchor], { lineColor: drawingColorRef.current, lineWidth: 2 }))
        drawingManagerRef.current.setActiveTool(null)
        setActiveDrawingTool(null)
        chart.applyOptions({ handleScroll: { pressedMouseMove: true } })
        return
      }
      if (!trendStartAnchorRef.current) {
        trendStartAnchorRef.current = anchor
        const previewId = `tl-preview-${Date.now()}`
        trendPreviewIdRef.current = previewId
        drawingManagerRef.current.addDrawing(new TrendLine(previewId, [anchor, anchor], { lineColor: drawingColorRef.current, lineWidth: 2 }))
        return
      }
      if (trendPreviewIdRef.current) {
        drawingManagerRef.current.removeDrawing(trendPreviewIdRef.current)
        trendPreviewIdRef.current = null
      }
      drawingManagerRef.current.addDrawing(new TrendLine(`tl-${Date.now()}`, [trendStartAnchorRef.current, anchor], { lineColor: drawingColorRef.current, lineWidth: 2 }))
      trendStartAnchorRef.current = null
      drawingManagerRef.current.setActiveTool(null)
      setActiveDrawingTool(null)
      chart.applyOptions({ handleScroll: { pressedMouseMove: true } })
    }
    const handleChartCrosshairMove = (param: any) => {
      if (activeDrawingToolRef.current !== 'trend-line') return
      if (!drawingManagerRef.current || !trendStartAnchorRef.current || !trendPreviewIdRef.current || !param?.point || param?.time == null) return
      const price = candle.coordinateToPrice(param.point.y)
      if (price == null) return
      drawingManagerRef.current.removeDrawing(trendPreviewIdRef.current)
      drawingManagerRef.current.addDrawing(
        new TrendLine(trendPreviewIdRef.current, [trendStartAnchorRef.current, { time: param.time as Time, price }], { lineColor: drawingColorRef.current, lineWidth: 2 })
      )
    }
    chart.subscribeClick(handleChartClick)
    chart.subscribeCrosshairMove(handleChartCrosshairMove)

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
    for (const instance of activeIndicators) {
      const entry = getIndicatorById(instance.indicatorId)
      const bucket = indicatorSeriesRef.current.get(instance.key)
      if (!entry || !bucket) continue
      try {
        const inputs = indicatorInputs[instance.key] || entry.defaultInputs || {}
        const result = entry.calculate(bars, inputs) as any
        const plots = result?.plots || {}
        const livePlotKeys = new Set<string>()
        for (const [plotKey, plot] of Object.entries(plots)) {
          if (!Array.isArray(plot)) continue
          const plotConfig = Array.isArray((entry as any).plotConfig)
            ? (entry as any).plotConfig.find((config: any) => config?.id === plotKey)
            : null
          const style = String(plotConfig?.style || 'line')
          const series = bucket.plotSeries.get(plotKey)
          if (!series) continue
          const preserveWhitespace = style === 'linebr'
          series.setData(toSeriesData(plot, bars, preserveWhitespace) as any)
          if (style === 'cross' || style === 'circles') {
            const markerEntry = bucket.markerSeries.find((item) => item.plotKey === plotKey)
            markerEntry?.primitive.setMarkers(toMarkerData(plot, bars, style === 'cross' ? 'cross' : 'circle', String(plotConfig?.color || '#2962FF')))
          }
          livePlotKeys.add(plotKey)
        }
        for (const [plotKey, series] of bucket.plotSeries.entries()) {
          if (!livePlotKeys.has(plotKey)) series.setData([] as any)
        }
        for (const markerEntry of bucket.markerSeries) {
          if (!livePlotKeys.has(markerEntry.plotKey)) markerEntry.primitive.setMarkers([])
        }
      } catch {
        for (const series of bucket.plotSeries.values()) {
          series.setData([] as any)
        }
        for (const markerEntry of bucket.markerSeries) {
          markerEntry.primitive.setMarkers([])
        }
      }
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
                          ctx.fillText(String(Math.abs(ceVal)), ceLabelX, y - 4)
                          ctx.fillText(String(Math.abs(peVal)), peLabelX, y + 8)
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
    const res = await fetch(`/madhan/nifty_live_data?interval=${interval}&_=${Date.now()}`)
    const json = await res.json()
    const data: Candle[] = json?.data || []
    priceDataRef.current = data
    candleRef.current.setData(data as any)
    ema34Ref.current.setData(calculateEMA(data, 34) as any)
    ema55Ref.current.setData(calculateEMA(data, 55) as any)
    updateIndicatorSeries(data)
    addHorizontalLines(data)
    applySqrtLevels(data)
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
    const existing = indicatorSeriesRef.current
    for (const bucket of existing.values()) {
      for (const series of bucket.plotSeries.values()) chart.removeSeries(series)
      for (const series of bucket.extraSeries) chart.removeSeries(series)
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
      let plots: Record<string, unknown> = {}
      try {
        plots = (entry.calculate(bars, inputs) as any)?.plots || {}
      } catch {
        plots = { plot0: [] }
      }
      const plotConfigList = Array.isArray((entry as any).plotConfig) ? (entry as any).plotConfig : []
      const plotKeys = Object.keys(plots).filter((key) => Array.isArray((plots as any)[key]))
      if (!plotKeys.length) plotKeys.push('plot0')
      const paletteOffset = i * 3
      const chartAny = chart as any
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
      plotKeys.forEach((plotKey, plotIndex) => {
        const cfg = plotConfigList.find((p: any) => p?.id === plotKey) || {}
        const color = cfg.color || indicatorColors[(paletteOffset + plotIndex) % indicatorColors.length]
        const title = `${indicatorTitle} ${cfg.title || plotKey}`
        const style = String(cfg.style || 'line')
        const lineWidth = (cfg.lineWidth ?? 1) as number
        const addTo = pane && typeof pane.addSeries === 'function' ? pane : chart
        const series = style === 'columns' || style === 'histogram'
          ? (addTo.addSeries(HistogramSeries, { title, color, lineWidth: lineWidth as any }) as ISeriesApi<any>)
          : style === 'area'
            ? (addTo.addSeries(AreaSeries, { title, lineColor: color, topColor: `${color}66`, bottomColor: `${color}11`, lineWidth: lineWidth as any }) as ISeriesApi<any>)
            : style === 'cross' || style === 'circles'
              ? (addTo.addSeries(LineSeries, {
                  title,
                  color: 'rgba(0,0,0,0)',
                  lineWidth: 0 as const,
                  priceLineVisible: false,
                  lastValueVisible: false,
                  crosshairMarkerVisible: false,
                }) as ISeriesApi<any>)
              : (addTo.addSeries(LineSeries, { title, color, lineWidth: lineWidth as any }) as ISeriesApi<any>)
        seriesByPlot.set(plotKey, series)
        if (style === 'cross' || style === 'circles') {
          markerSeries.push({
            plotKey,
            primitive: createSeriesMarkers(series, [], { zOrder: 'top' }),
          })
        }
      })

      const hlines = Array.isArray((entry as any).hlineConfig) ? (entry as any).hlineConfig : []
      if (hlines.length && seriesByPlot.size > 0) {
        const firstSeries = seriesByPlot.values().next().value as ISeriesApi<any>
        hlines.forEach((hl: any) => {
          const style = String(hl.linestyle || 'solid')
          firstSeries.createPriceLine({
            price: Number(hl.price ?? 0),
            color: String(hl.color || '#787B86'),
            lineWidth: 1,
            lineStyle: style === 'dashed' ? 2 : style === 'dotted' ? 1 : 0,
            axisLabelVisible: false,
            title: hl.title || '',
          } as any)
        })
      }

      const fills = Array.isArray((entry as any).fillConfig) ? (entry as any).fillConfig : []
      fills.forEach((fill: any, fillIndex: number) => {
        const h1 = hlines.find((h: any) => h.id === fill.plot1)
        const h2 = hlines.find((h: any) => h.id === fill.plot2)
        if (!h1 || !h2) return
        const upper = Math.max(Number(h1.price || 0), Number(h2.price || 0))
        const lower = Math.min(Number(h1.price || 0), Number(h2.price || 0))
        const addTo = pane && typeof pane.addSeries === 'function' ? pane : chart
        const area = addTo.addSeries(AreaSeries, {
          title: `${indicatorTitle} Fill ${fillIndex + 1}`,
          lineColor: 'transparent',
          topColor: String(fill.color || '#2962FF1A'),
          bottomColor: String(fill.color || '#2962FF1A'),
          lineWidth: 0 as const,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          baseValue: { type: 'price', price: lower },
        } as any) as ISeriesApi<any>
        const areaData = priceDataRef.current.map((bar) => ({ time: bar.time as any, value: upper }))
        area.setData(areaData as any)
        extraSeries.push(area)
      })

      existing.set(instance.key, { plotSeries: seriesByPlot, extraSeries, markerSeries })
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

  const setDrawingTool = (tool: 'trend-line' | 'horizontal-ray') => {
    if (!drawingManagerRef.current) return
    const nextTool = activeDrawingTool === tool ? null : tool
    if (trendPreviewIdRef.current) {
      drawingManagerRef.current.removeDrawing(trendPreviewIdRef.current)
      trendPreviewIdRef.current = null
    }
    trendStartAnchorRef.current = null
    drawingManagerRef.current.setActiveTool(nextTool)
    setActiveDrawingTool(nextTool)
    if (chartRef.current) {
      chartRef.current.applyOptions({ handleScroll: { pressedMouseMove: nextTool == null } })
    }
  }

  const clearDrawings = () => {
    if (!drawingManagerRef.current) return
    drawingManagerRef.current.clearAll()
    drawingManagerRef.current.setActiveTool(null)
    trendStartAnchorRef.current = null
    trendPreviewIdRef.current = null
    setActiveDrawingTool(null)
    if (chartRef.current) {
      chartRef.current.applyOptions({ handleScroll: { pressedMouseMove: true } })
    }
  }

  const addIndicator = (indicatorId: string) => {
    const nextIndex = activeIndicators.filter((item) => item.indicatorId === indicatorId).length
    const key = `${indicatorId}-${Date.now()}-${nextIndex}`
    setActiveIndicators((prev) => [...prev, { key, indicatorId }])
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

  return (
    <div className="h-full w-full p-0">
      <Card className="flex h-full w-full flex-col overflow-hidden rounded-none border-0 bg-card">
        <div className="shrink-0 flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
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
          <Button variant={oiActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={toggleOi}>OI</Button>
          <Button variant={coiActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={toggleCoi}>COI</Button>
          <Button variant={emaActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setEmaActive((v) => !v)}>EMA</Button>
          <Button variant={dayOpenActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setDayOpenActive((v) => !v)}>Day Open</Button>
          <Button variant={prevOhlcActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setPrevOhlcActive((v) => !v)}>Prev OHLC</Button>
          <Button variant={sqrtActive ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setSqrtActive((v) => !v)}>SQRT</Button>
          <Button variant={showIndicatorPanel ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setShowIndicatorPanel((v) => !v)}>Indicators</Button>
          <Button variant={showDrawingPanel ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setShowDrawingPanel((v) => !v)}>Drawings</Button>
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">OI X %</Label>
            <Input type="number" min={0} max={100} className="h-7 w-14 px-1 text-[11px]" value={oiX} onChange={(e) => setOiX(Number(e.target.value || 0))} />
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={oiShowStrike} onCheckedChange={(v) => setOiShowStrike(!!v)} />
            <Label className="text-[11px]">OI Labels</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={oiShowValues} onCheckedChange={(v) => setOiShowValues(!!v)} />
            <Label className="text-[11px]">OI Values</Label>
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">COI X %</Label>
            <Input type="number" min={0} max={100} className="h-7 w-14 px-1 text-[11px]" value={coiX} onChange={(e) => setCoiX(Number(e.target.value || 0))} />
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={coiShowStrike} onCheckedChange={(v) => setCoiShowStrike(!!v)} />
            <Label className="text-[11px]">COI Labels</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox checked={coiShowValues} onCheckedChange={(v) => setCoiShowValues(!!v)} />
            <Label className="text-[11px]">COI Values</Label>
          </div>
        </div>
        <div className="min-h-0 flex flex-1 overflow-hidden">
          {(showDrawingPanel || showIndicatorPanel) && (
            <div className="h-full w-[320px] shrink-0 overflow-auto border-r bg-card/40 p-2">
              {showDrawingPanel && (
                <div className="mb-2 space-y-2 rounded border p-2">
                  <Label className="text-xs font-semibold">Drawings</Label>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Color</Label>
                    <Input type="color" className="h-7 w-full p-1" value={drawingColor} onChange={(e) => setDrawingColor(e.target.value)} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button variant={activeDrawingTool === 'trend-line' ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setDrawingTool('trend-line')}>Trendline</Button>
                    <Button variant={activeDrawingTool === 'horizontal-ray' ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-[11px]" onClick={() => setDrawingTool('horizontal-ray')}>Horizontal Ray</Button>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={clearDrawings}>Clear</Button>
                  </div>
                  <Label className="text-[11px] text-muted-foreground">Draw once, tool exits automatically.</Label>
                </div>
              )}
              {showIndicatorPanel && (
                <div className="space-y-2 rounded border p-2">
                  <Label className="text-xs font-semibold">Indicators</Label>
                  <Input className="h-7 text-[11px]" value={indicatorSearch} placeholder="Search indicators" onChange={(e) => setIndicatorSearch(e.target.value)} />
                  <div className="max-h-36 space-y-1 overflow-auto rounded border p-1">
                    {availableIndicators.slice(0, 200).map((item) => {
                      const active = activeIndicators.some((x) => x.indicatorId === item.id)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`w-full rounded px-2 py-1 text-left text-[11px] ${active ? 'bg-primary/20' : 'hover:bg-accent'}`}
                          onClick={() => {
                            addIndicator(item.id)
                          }}
                        >
                          {item.shortName} ({item.id}) {active ? '• Added' : ''}
                        </button>
                      )
                    })}
                  </div>
                  <div className="space-y-2">
                    {activeIndicators.map((indicator, index) => {
                      const entry = getIndicatorById(indicator.indicatorId)
                      if (!entry) return null
                      const expanded = expandedIndicatorKey === indicator.key
                      const config = Array.isArray(entry.inputConfig) ? entry.inputConfig : []
                      const values = indicatorInputs[indicator.key] || {}
                      return (
                        <div key={indicator.key} className="rounded border p-2">
                          <div className="flex items-center justify-between gap-2">
                            <button type="button" className="text-left text-[11px] font-semibold" onClick={() => setExpandedIndicatorKey(expanded ? null : indicator.key)}>{entry.name} #{index + 1}</button>
                            <Button variant="secondary" size="sm" className="h-6 px-2 text-[10px]" onClick={() => removeIndicator(indicator.key)}>Remove</Button>
                          </div>
                          {expanded && (
                            <div className="mt-2 space-y-2">
                              {config.map((input: any) => {
                                const value = values[input.id] ?? input.defval
                                const inputType = String(input.type || '')
                                if (inputType === 'bool') {
                                  return (
                                    <div key={input.id} className="flex items-center justify-between gap-2">
                                      <Label className="text-[11px]">{input.title || input.id}</Label>
                                      <Checkbox checked={Boolean(value)} onCheckedChange={(v) => updateIndicatorInput(indicator.key, input.id, !!v)} />
                                    </div>
                                  )
                                }
                                if (inputType === 'source' || Array.isArray(input.options)) {
                                  const options = input.options || ['open', 'high', 'low', 'close']
                                  return (
                                    <div key={input.id} className="space-y-1">
                                      <Label className="text-[11px]">{input.title || input.id}</Label>
                                      <Select value={String(value)} onValueChange={(val) => updateIndicatorInput(indicator.key, input.id, val)}>
                                        <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          {options.map((option: string) => (
                                            <SelectItem key={option} value={String(option)}>{String(option)}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  )
                                }
                                return (
                                  <div key={input.id} className="space-y-1">
                                    <Label className="text-[11px]">{input.title || input.id}</Label>
                                    <Input
                                      type="number"
                                      className="h-7 text-[11px]"
                                      value={String(value ?? '')}
                                      onChange={(e) => {
                                        const raw = e.target.value
                                        const num = inputType === 'int' ? Number.parseInt(raw || '0', 10) : Number.parseFloat(raw || '0')
                                        if (!Number.isNaN(num)) updateIndicatorInput(indicator.key, input.id, num)
                                      }}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <div ref={chartContainerRef} className="min-h-0 w-full flex-1" />
        </div>
      </Card>
    </div>
  )
}
