import { useEffect, useRef, useState, useCallback } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { chartTheme } from '../chartTheme'
import { cn } from '@/lib/utils'

export type SignalRow = {
  time: number
  strike: number
  ce_signal: boolean
  pe_signal: boolean
  cp_signal: boolean
  cp_ce_signal: boolean
}

type EzaySignalsProps = {
  className?: string
}

const formatTime = (ts: number) => {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
}

export default function EzaySignals({ className }: EzaySignalsProps) {
  const { mode: themeMode } = useThemeStore()
  const t = chartTheme[themeMode]
  const [data, setData] = useState<SignalRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ceFilter, setCeFilter] = useState(false)
  const [peFilter, setPeFilter] = useState(false)
  const [cpFilter, setCpFilter] = useState(false)
  const [cpCeFilter, setCpCeFilter] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevDataLenRef = useRef(0)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const res = await fetch(`/madhan/api/ezayChart_signals?_=${Date.now()}`)
      const json = await res.json()
      if (json.status === 'success' && json.data) {
        setData(json.data)
      } else {
        setError(json.message || 'Failed to load signals')
      }
    } catch (e: any) {
      setError(e.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 60_000)
    return () => clearInterval(iv)
  }, [fetchData])

  useEffect(() => {
    if (scrollRef.current && data.length > prevDataLenRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevDataLenRef.current = data.length
  }, [data])

  const filtered = data.filter((row) => {
    if (!hasAnyFilter) return true
    if (ceFilter && row.ce_signal) return true
    if (peFilter && row.pe_signal) return true
    if (cpFilter && row.cp_signal) return true
    if (cpCeFilter && row.cp_ce_signal) return true
    return false
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

  const hasAnyFilter = ceFilter || peFilter || cpFilter || cpCeFilter

  return (
    <div
      className={cn('flex flex-col min-h-0', className)}
      style={{ width: 320, borderLeft: `1px solid ${t.border}`, backgroundColor: t.panelDarker }}
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
            onClick={() => setCpCeFilter(!cpCeFilter)}
            className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors', cpCeFilter ? 'bg-blue-600 text-white' : 'hover:bg-gray-600')}
            style={cpCeFilter ? {} : { color: t.textSecondary }}
          >CP_CE</button>
          {hasAnyFilter && (
            <button
              onClick={() => { setCeFilter(false); setPeFilter(false); setCpFilter(false); setCpCeFilter(false) }}
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
            <div key={ts} style={{ borderBottom: `1px solid ${t.border}` }}>
              <div className="grid grid-cols-[50px_50px_1fr_1fr_1fr_1fr] gap-0 px-2 py-1 items-center">
                <span className="text-[10px] font-mono" style={{ color: t.textSecondary }}>{formatTime(ts)}</span>
                <span />
                <div />
                <div />
                <div />
                <div />
              </div>
              {rows.map((row) => (
                <div key={row.strike} className="grid grid-cols-[50px_50px_1fr_1fr_1fr_1fr] gap-0 px-2 py-0.5 items-center hover:bg-[rgba(128,128,128,0.1)]">
                  <span />
                  <span className="text-[10px] font-mono text-right" style={{ color: t.text }}>{row.strike}</span>
                  <div className="flex justify-center">{signalDot(row.ce_signal, '#00C851')}</div>
                  <div className="flex justify-center">{signalDot(row.pe_signal, '#E040FB')}</div>
                  <div className="flex justify-center">{signalDot(row.cp_signal, '#FFD600')}</div>
                  <div className="flex justify-center">{signalDot(row.cp_ce_signal, '#2196f3')}</div>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <div className="shrink-0 px-2 py-1 text-[9px] flex items-center justify-between" style={{ borderTop: `1px solid ${t.border}`, color: t.textMuted }}>
        <span>{filtered.length} signals</span>
        <button onClick={fetchData} className="hover:underline" style={{ color: t.textSecondary }}>Refresh</button>
      </div>
    </div>
  )
}
