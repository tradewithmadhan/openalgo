import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  LineStyle,
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
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null)
  const coiPctRef = useRef<ISeriesApi<'Line'> | null>(null)
  const oiTrendPctRef = useRef<ISeriesApi<'Line'> | null>(null)
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

  const [interval, setIntervalValue] = useState('5m')
  const [oiActive, setOiActive] = useState(true)
  const [coiActive, setCoiActive] = useState(true)
  const [coiTrendActive, setCoiTrendActive] = useState(true)
  const [rsiActive, setRsiActive] = useState(true)
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
      height: 920,
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
    const rsi = chart.addSeries(LineSeries, {
      color: 'purple',
      lineWidth: 1,
      priceScaleId: 'left',
      visible: true,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    const coiPct = chart.addSeries(LineSeries, {
      color: '#2196F3',
      lineWidth: 2,
      priceScaleId: 'left',
      visible: true,
    })
    const oiTrendPct = chart.addSeries(LineSeries, {
      color: '#FF5722',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceScaleId: 'left',
      visible: true,
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
    rsiRef.current = rsi
    coiPctRef.current = coiPct
    oiTrendPctRef.current = oiTrendPct
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

  const calculateRSI = (data: Candle[], period = 14) => {
    if (data.length <= period) return []
    const out: Array<{ time: number; value: number }> = []
    const changes = data.map((d, i) => (i > 0 ? d.close - data[i - 1].close : 0))
    let gain = 0
    let loss = 0
    for (let i = 1; i <= period; i++) {
      if (changes[i] > 0) gain += changes[i]
      else loss -= changes[i]
    }
    let avgGain = gain / period
    let avgLoss = loss / period
    for (let i = period; i < data.length; i++) {
      const chg = changes[i]
      const g = chg > 0 ? chg : 0
      const l = chg < 0 ? -chg : 0
      avgGain = (avgGain * (period - 1) + g) / period
      avgLoss = (avgLoss * (period - 1) + l) / period
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
      out.push({ time: data[i].time, value: 100 - 100 / (1 + rs) })
    }
    return out
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

  const fetchCoiTrend = async () => {
    if (!coiPctRef.current || !oiTrendPctRef.current) return
    const res = await fetch(`/madhan/api/nifty/coi-trend?_=${Date.now()}`)
    const json = await res.json()
    if (json?.status !== 'success' || !json?.data?.timestamps) return
    const coiData = json.data.timestamps.map((t: number, i: number) => ({ time: Math.floor(t / 1000) as any, value: json.data.coi_percent[i] }))
    const oiTrendData = json.data.timestamps.map((t: number, i: number) => ({ time: Math.floor(t / 1000) as any, value: json.data.oi_trend_percent[i] }))
    coiPctRef.current.setData(coiData)
    oiTrendPctRef.current.setData(oiTrendData)
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
          this._anchor = oiX / 100
          this._showStrike = oiShowStrike
          this._showValues = oiShowValues
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
    oiPrimitiveRef.current.setAnchor(oiX / 100)
    oiPrimitiveRef.current.setStrike(oiShowStrike)
    oiPrimitiveRef.current.setValues(oiShowValues)
    coiPrimitiveRef.current.setAnchor(coiX / 100)
    coiPrimitiveRef.current.setStrike(coiShowStrike)
    coiPrimitiveRef.current.setValues(coiShowValues)
  }

  const refreshChartData = async () => {
    if (!candleRef.current || !ema34Ref.current || !ema55Ref.current || !rsiRef.current) return
    const res = await fetch(`/madhan/nifty_live_data?interval=${interval}&_=${Date.now()}`)
    const json = await res.json()
    const data: Candle[] = json?.data || []
    priceDataRef.current = data
    candleRef.current.setData(data as any)
    ema34Ref.current.setData(calculateEMA(data, 34) as any)
    ema55Ref.current.setData(calculateEMA(data, 55) as any)
    rsiRef.current.setData(calculateRSI(data, 14) as any)
    addHorizontalLines(data)
    await Promise.all([fetchOiProfiles(), fetchCoiTrend()])
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
    if (rsiRef.current) rsiRef.current.applyOptions({ visible: rsiActive })
  }, [rsiActive])

  useEffect(() => {
    if (coiPctRef.current) coiPctRef.current.applyOptions({ visible: coiTrendActive })
    if (oiTrendPctRef.current) oiTrendPctRef.current.applyOptions({ visible: coiTrendActive })
  }, [coiTrendActive])

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
    if (oiPrimitiveRef.current) {
      oiPrimitiveRef.current.setAnchor(oiX / 100)
      oiPrimitiveRef.current.setStrike(oiShowStrike)
      oiPrimitiveRef.current.setValues(oiShowValues)
    }
  }, [oiX, oiShowStrike, oiShowValues])

  useEffect(() => {
    if (coiPrimitiveRef.current) {
      coiPrimitiveRef.current.setAnchor(coiX / 100)
      coiPrimitiveRef.current.setStrike(coiShowStrike)
      coiPrimitiveRef.current.setValues(coiShowValues)
    }
  }, [coiX, coiShowStrike, coiShowValues])

  const toggleOi = () => {
    if (!oiPrimitiveRef.current) return
    setOiActive(oiPrimitiveRef.current.toggle())
  }

  const toggleCoi = () => {
    if (!coiPrimitiveRef.current) return
    setCoiActive(coiPrimitiveRef.current.toggle())
  }

  return (
    <div className="p-2">
      <Card className="overflow-hidden border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="flex items-center gap-2">
            <Label>Interval</Label>
            <Select value={interval} onValueChange={setIntervalValue}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
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
          <Button variant={oiActive ? 'default' : 'outline'} size="sm" onClick={toggleOi}>OI</Button>
          <Button variant={coiActive ? 'default' : 'outline'} size="sm" onClick={toggleCoi}>COI</Button>
          <Button variant={coiTrendActive ? 'default' : 'outline'} size="sm" onClick={() => setCoiTrendActive((v) => !v)}>COI Trend</Button>
          <Button variant={rsiActive ? 'default' : 'outline'} size="sm" onClick={() => setRsiActive((v) => !v)}>RSI</Button>
          <Button variant={emaActive ? 'default' : 'outline'} size="sm" onClick={() => setEmaActive((v) => !v)}>EMA</Button>
          <Button variant={dayOpenActive ? 'default' : 'outline'} size="sm" onClick={() => setDayOpenActive((v) => !v)}>Day Open</Button>
          <Button variant={prevOhlcActive ? 'default' : 'outline'} size="sm" onClick={() => setPrevOhlcActive((v) => !v)}>Prev OHLC</Button>
          <div className="flex items-center gap-2">
            <Label>OI X %</Label>
            <Input type="number" min={0} max={100} className="h-8 w-16" value={oiX} onChange={(e) => setOiX(Number(e.target.value || 0))} />
            <div className="flex items-center gap-1"><Checkbox checked={oiShowStrike} onCheckedChange={(v) => setOiShowStrike(!!v)} /><Label>Labels</Label></div>
            <div className="flex items-center gap-1"><Checkbox checked={oiShowValues} onCheckedChange={(v) => setOiShowValues(!!v)} /><Label>Values</Label></div>
          </div>
          <div className="flex items-center gap-2">
            <Label>COI X %</Label>
            <Input type="number" min={0} max={100} className="h-8 w-16" value={coiX} onChange={(e) => setCoiX(Number(e.target.value || 0))} />
            <div className="flex items-center gap-1"><Checkbox checked={coiShowStrike} onCheckedChange={(v) => setCoiShowStrike(!!v)} /><Label>Labels</Label></div>
            <div className="flex items-center gap-1"><Checkbox checked={coiShowValues} onCheckedChange={(v) => setCoiShowValues(!!v)} /><Label>Values</Label></div>
          </div>
        </div>
        <div ref={chartContainerRef} className="h-[calc(100vh-220px)] w-full" />
      </Card>
    </div>
  )
}
