import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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

export default function NiftyChart() {
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const ema34Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema55Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const optionVolumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const dayOpenRef = useRef<ISeriesApi<'Line'> | null>(null)
  const prevOpenRef = useRef<ISeriesApi<'Line'> | null>(null)
  const prevHighRef = useRef<ISeriesApi<'Line'> | null>(null)
  const prevLowRef = useRef<ISeriesApi<'Line'> | null>(null)
  const prevCloseRef = useRef<ISeriesApi<'Line'> | null>(null)
  const oiPrimitiveRef = useRef<any>(null)
  const coiPrimitiveRef = useRef<any>(null)
  const priceDataRef = useRef<Candle[]>([])
  const updaterRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const oiXRef = useRef(100)
  const coiXRef = useRef(80)
  const oiShowStrikeRef = useRef(true)
  const oiShowValuesRef = useRef(true)
  const coiShowStrikeRef = useRef(true)
  const coiShowValuesRef = useRef(true)

  const [interval, setIntervalValue] = useState('5m')
  const [oiActive, setOiActive] = useState(true)
  const [coiActive, setCoiActive] = useState(true)
  const [emaActive, setEmaActive] = useState(true)
  const [dayOpenActive, setDayOpenActive] = useState(true)
  const [prevOhlcActive, setPrevOhlcActive] = useState(true)
  const [oiX, setOiX] = useState(100)
  const [coiX, setCoiX] = useState(80)
  const [oiShowStrike, setOiShowStrike] = useState(true)
  const [oiShowValues, setOiShowValues] = useState(true)
  const [coiShowStrike, setCoiShowStrike] = useState(true)
  const [coiShowValues, setCoiShowValues] = useState(true)

  useEffect(() => {
    if (!chartContainerRef.current) return

    const isDark = document.documentElement.classList.contains('dark')
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: Math.max(320, chartContainerRef.current.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: isDark ? '#a6adbb' : '#333',
      },
      grid: {
        vertLines: { color: isDark ? 'rgba(166,173,187,0.1)' : 'rgba(0,0,0,0.1)' },
        horzLines: { color: isDark ? 'rgba(166,173,187,0.1)' : 'rgba(0,0,0,0.1)' },
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
      chart.remove()
      chartRef.current = null
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
        _show: boolean
        _anchor: number
        _showStrike: boolean
        _showValues: boolean
        constructor(series: any, data: any) {
          this._profile = data
          this._series = series
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
                        const ceW = Math.max(2, (Math.abs(s.ceOI || 0) / maxAbs) * 150)
                        const peW = Math.max(2, (Math.abs(s.peOI || 0) / maxAbs) * 150)
                        ctx.fillStyle = '#f44336'
                        ctx.fillRect(anchor, y - 10, ceW, 8)
                        ctx.fillStyle = '#4caf50'
                        ctx.fillRect(anchor, y + 2, peW, 8)
                        if (self._showStrike) {
                          ctx.fillStyle = '#9ca3af'
                          ctx.font = '11px Arial'
                          ctx.fillText(String(s.price), anchor - 60, y + 3)
                        }
                        if (self._showValues) {
                          ctx.fillStyle = '#e5e7eb'
                          ctx.font = '8px Arial'
                          ctx.fillText(String(Math.abs(s.ceOI || 0)), anchor + ceW + 4, y - 4)
                          ctx.fillText(String(Math.abs(s.peOI || 0)), anchor + peW + 4, y + 8)
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
      })(seriesAny, json.oi)
      seriesAny.attachPrimitive(oiPrimitive)
      oiPrimitiveRef.current = oiPrimitive
    } else {
      oiPrimitiveRef.current.setData(json.oi)
    }

    if (!coiPrimitiveRef.current) {
      const coiPrimitive = new (oiPrimitiveRef.current.constructor)(seriesAny, json.coi)
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

  const refreshChartData = async () => {
    if (!candleRef.current || !ema34Ref.current || !ema55Ref.current) return
    const res = await fetch(`/madhan/nifty_live_data?interval=${interval}&_=${Date.now()}`)
    const json = await res.json()
    const data: Candle[] = json?.data || []
    priceDataRef.current = data
    candleRef.current.setData(data as any)
    ema34Ref.current.setData(calculateEMA(data, 34) as any)
    ema55Ref.current.setData(calculateEMA(data, 55) as any)
    addHorizontalLines(data)
    await Promise.all([fetchOiProfiles(), fetchOptionCombinedVolume()])
  }

  const repaintOverlay = () => {
    if (!candleRef.current || !priceDataRef.current.length) return
    const last = priceDataRef.current[priceDataRef.current.length - 1]
    // Force lightweight-charts to redraw attached primitives immediately.
    candleRef.current.update(last as any)
  }

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

  return (
    <div className="h-[calc(100vh-56px)] w-full p-0">
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
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">OI X %</Label>
            <Input type="number" min={0} max={100} className="h-7 w-14 px-1 text-[11px]" value={oiX} onChange={(e) => setOiX(Number(e.target.value || 0))} />
            <div className="flex items-center gap-1"><Checkbox checked={oiShowStrike} onCheckedChange={(v) => setOiShowStrike(!!v)} /><Label className="text-[11px]">Labels</Label></div>
            <div className="flex items-center gap-1"><Checkbox checked={oiShowValues} onCheckedChange={(v) => setOiShowValues(!!v)} /><Label className="text-[11px]">Values</Label></div>
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">COI X %</Label>
            <Input type="number" min={0} max={100} className="h-7 w-14 px-1 text-[11px]" value={coiX} onChange={(e) => setCoiX(Number(e.target.value || 0))} />
            <div className="flex items-center gap-1"><Checkbox checked={coiShowStrike} onCheckedChange={(v) => setCoiShowStrike(!!v)} /><Label className="text-[11px]">Labels</Label></div>
            <div className="flex items-center gap-1"><Checkbox checked={coiShowValues} onCheckedChange={(v) => setCoiShowValues(!!v)} /><Label className="text-[11px]">Values</Label></div>
          </div>
        </div>
        <div ref={chartContainerRef} className="min-h-0 flex-1 w-full" />
      </Card>
    </div>
  )
}
