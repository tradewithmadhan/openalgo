import { useEffect, useRef, useState, useCallback } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { chartTheme } from '../chartTheme'
import { cn } from '@/lib/utils'

export type SignalRow = {
  time: number
  strike: number
  ce_signal: boolean
  pe_signal: boolean
  cp_signal: 'CE' | 'PE' | false
  cp_ce_signal: boolean
  ce_close: number
  pe_close: number
}

type EzaySignalsProps = {
  className?: string
  style?: React.CSSProperties
  backtestDate?: string
}

const formatTime = (ts: number) => {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
}

export default function EzaySignals({ className, style, backtestDate }: EzaySignalsProps) {
  const { mode: themeMode } = useThemeStore()
  const t = chartTheme[themeMode]
  const [data, setData] = useState<SignalRow[]>([])
  const [lastTime, setLastTime] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ceFilter, setCeFilter] = useState(false)
  const [peFilter, setPeFilter] = useState(false)
  const [cpFilter, setCpFilter] = useState(false)
  const [hcFilter, setHcFilter] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevDataLenRef = useRef(0)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      setData([])
      setLastTime(0)
      // Use backtest endpoint when backtestDate is provided
      const url = backtestDate
        ? `/madhan/api/nifty/backtest_signals?date=${backtestDate}&_=${Date.now()}`
        : `/madhan/api/ezayChart_signals?_=${Date.now()}`
      const res = await fetch(url)
      const json = await res.json()
      if (json.status === 'success' && json.data) {
        setData(json.data)
        setLastTime(json.last_time || 0)
      } else {
        setError(json.message || 'Failed to load signals')
      }
    } catch (e: any) {
      setError(e.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [backtestDate])

  useEffect(() => {
    fetchData()
    // Disable auto-refresh in backtest mode (historical data doesn't change)
    if (backtestDate) return
    const iv = setInterval(fetchData, 60_000)
    return () => clearInterval(iv)
  }, [fetchData, backtestDate])

  useEffect(() => {
    if (scrollRef.current && data.length > prevDataLenRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevDataLenRef.current = data.length
  }, [data])

  const hasAnyFilter = ceFilter || peFilter || cpFilter || hcFilter

  const filtered = data.filter((row) => {
    // Signal type filters (OR logic) — HC alone doesn't select signal types
    const typeActive = ceFilter || peFilter || cpFilter
    const signalMatch = !hasAnyFilter ||
      (ceFilter && row.ce_signal) ||
      (peFilter && row.pe_signal) ||
      (cpFilter && row.cp_signal)
    if (!signalMatch) return false
    // HC filter: only applies when signal type filters are also active
    if (hcFilter && typeActive) {
      if (row.ce_signal && !(row.ce_close > row.pe_close)) return false
      if (row.pe_signal && !(row.pe_close > row.ce_close)) return false
      // CP passes through (no close filter needed)
    }
    return true
  })

  const grouped = new Map<number, SignalRow[]>()
  for (const row of filtered) {
    const arr = grouped.get(row.time) || []
    arr.push(row)
    grouped.set(row.time, arr)
  }

  const sortedTimes = Array.from(grouped.keys()).sort((a, b) => b - a)

  const signalDot = (active: boolean, color: string) => (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ backgroundColor: active ? color : 'transparent', border: `1px solid ${active ? color : t.border}` }}
    />
  )

  return (
    <div
      className={cn('flex flex-col min-h-0 w-full', className)}
      style={{ borderLeft: `1px solid ${t.border}`, backgroundColor: t.panelDarker, ...style }}
    >
      <div className="shrink-0 px-2 py-1.5 flex items-center gap-2" style={{ borderBottom: `1px solid ${t.border}` }}>
        <span className="text-[11px] font-semibold" style={{ color: t.text }}>EzaySignals</span>
        <div className="ml-auto flex items-center gap-1.5 text-[10px]" style={{ color: t.textSecondary }}>
          <button
            onClick={() => setCeFilter(!ceFilter)}
            className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors', ceFilter ? 'bg-green-600 text-white' : 'hover:bg-gray-600')}
            style={ceFilter ? {} : { color: t.textSecondary }}
          >CE</button>
          <button
            onClick={() => setPeFilter(!peFilter)}
            className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors', peFilter ? 'bg-red-600 text-white' : 'hover:bg-gray-600')}
            style={peFilter ? {} : { color: t.textSecondary }}
          >PE</button>
          <button
            onClick={() => setCpFilter(!cpFilter)}
            className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors', cpFilter ? 'bg-yellow-500 text-black' : 'hover:bg-gray-600')}
            style={cpFilter ? {} : { color: t.textSecondary }}
          >CP</button>
          <button
            onClick={() => setHcFilter(!hcFilter)}
            className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors', hcFilter ? 'bg-cyan-700 text-white' : 'hover:bg-gray-600')}
            style={hcFilter ? {} : { color: t.textSecondary }}
            title="Higher Close: CE signal only if CE>PE, PE signal only if PE>CE"
          >HC</button>
          {hasAnyFilter && (
            <button
              onClick={() => { setCeFilter(false); setPeFilter(false); setCpFilter(false); setHcFilter(false) }}
              className="px-1 py-0.5 rounded text-[10px] hover:bg-gray-600"
              style={{ color: t.textMuted }}
            >Clear</button>
          )}
        </div>
      </div>

      <div className="shrink-0 grid grid-cols-[50px_50px_1fr_1fr_1fr_1fr] gap-0 text-[9px] font-semibold uppercase px-2 py-1" style={{ color: t.textMuted, borderBottom: `1px solid ${t.border}` }}>
        <span>Time</span>
        <span className="text-right">Strike</span>
        <span className="text-center">CE</span>
        <span className="text-center">PE</span>
        <span className="text-center">CP</span>
        <span className="text-center">CP_CE</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0" style={{ scrollbarWidth: 'thin' }}>
        {loading && data.length === 0 && (
          <div className="flex items-center justify-center py-4 text-[11px]" style={{ color: t.textMuted }}>Loading signals...</div>
        )}
        {error && (
          <div className="flex items-center justify-center py-4 text-[11px] text-red-500">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex items-center justify-center py-4 text-[11px]" style={{ color: t.textMuted }}>
            {hasAnyFilter ? 'No signals match filter' : 'No signals yet'}
          </div>
        )}
        {sortedTimes.map((ts) => {
          const rows = grouped.get(ts)!
          return (
            <div key={ts}>
              {rows.map((row, idx) => {
                const strikeBg = row.ce_signal ? 'rgba(0,200,81,0.2)'
                  : row.pe_signal ? 'rgba(255,68,68,0.2)'
                  : row.cp_signal === 'CE' ? 'rgba(0,200,81,0.4)'
                  : row.cp_signal === 'PE' ? 'rgba(255,68,68,0.4)'
                  : undefined
                return (
                  <div key={row.strike} className="grid grid-cols-[50px_50px_1fr_1fr_1fr_1fr] gap-0 px-2 py-0.5 items-center" style={{ borderTop: idx === 0 ? `1px solid ${t.border}` : undefined }}>
                    {idx === 0 ? <span className="text-[11px] font-mono font-bold" style={{ color: t.text }}>{formatTime(ts)}</span> : <span />}
                    <span className="text-[11px] font-mono font-bold text-right px-1 py-0 rounded" style={{ color: t.text, backgroundColor: strikeBg }}>{row.strike}</span>
                    <div className="flex justify-center">{signalDot(row.ce_signal, '#00C851')}</div>
                    <div className="flex justify-center">{signalDot(row.pe_signal, '#E040FB')}</div>
                    <div className="flex justify-center">
                      {row.cp_signal ? (
                        <span className="text-[9px] font-bold" style={{ color: row.cp_signal === 'CE' ? '#00C851' : '#FF4444' }}>{row.cp_signal}</span>
                      ) : signalDot(false, '#FFD600')}
                    </div>
                    <div className="flex justify-center">{signalDot(row.cp_ce_signal, '#2196f3')}</div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div className="shrink-0 px-2 py-1 text-[9px] flex items-center justify-between" style={{ borderTop: `1px solid ${t.border}`, color: t.textMuted }}>
        <span>{filtered.length} signals</span>
        {lastTime > 0 && (
          <span title="Last candle time used for calculation">
            Last: {formatTime(lastTime)}
          </span>
        )}
        <button onClick={fetchData} className="hover:underline" style={{ color: t.textSecondary }}>Refresh</button>
      </div>
    </div>
  )
}
