import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { X, Wifi, WifiOff, RefreshCw, BarChart3, Home, Menu, Sun, Moon, Zap } from 'lucide-react'
import { chartTheme } from './chartTheme'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { cn } from '@/lib/utils'

type StrikeSymbol = { symbol: string; exchange: string; strike: number; type: string }

type ProcessedData = {
  ltp: number; volume: number; change: number; open: number; high: number;
  low: number; close: number; average_price: number; percent_change: number;
  [key: string]: any
}

type TableRow = {
  strike: number; cePercentChange: string; pePercentChange: string;
  ceLtp: string; peLtp: string; ceVwap: string; peVwap: string;
  ceO: string; peO: string; ceIntrinsic: string; peIntrinsic: string;
  ceExtrinsic: string; peExtrinsic: string; combinedExtrinsic: string;
  combinedPremium: string; openCombined: string; llp: string;
  ceOpen: string; peOpen: string; ceHigh: string; peHigh: string;
}

type Props = { onClose?: () => void; standalone?: boolean }

export default function RealtimeTable({ onClose, standalone = false }: Props) {
  const socketRef = useRef<WebSocket | null>(null)
  const strikeSymbolsRef = useRef<Map<string, StrikeSymbol>>(new Map())
  const realtimeDataRef = useRef<Map<string, ProcessedData>>(new Map())
  const spotPriceRef = useRef(25500)
  const showAllRef = useRef(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const theadRef = useRef<HTMLTableSectionElement | null>(null)
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [tableData, setTableData] = useState<TableRow[]>([])
  const [showAllStrikes, setShowAllStrikes] = useState(false)
  const [availHeight, setAvailHeight] = useState(0)

  useEffect(() => {
    const calc = () => {
      const wrapper = containerRef.current?.parentElement
      if (wrapper) {
        setAvailHeight(wrapper.clientHeight)
      }
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  const rowHeight = useMemo(() => {
    if (tableData.length === 0 || availHeight === 0) return 36
    const headerH = theadRef.current?.getBoundingClientRect().height ?? 36
    const avail = Math.max(0, availHeight - headerH)
    return Math.max(28, avail / tableData.length)
  }, [availHeight, tableData.length])

  const { mode: themeMode, toggleMode, appMode, toggleAppMode, isTogglingMode } = useThemeStore()
  const t = chartTheme[themeMode]

  const handleToggleAll = useCallback((val: boolean) => {
    showAllRef.current = val
    setShowAllStrikes(val)
    recalculate()
  }, [])

  const connect = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return
    try {
      setWsStatus('connecting')
      const configRes = await fetch('/api/websocket/config')
      const config = await configRes.json()
      if (config.status !== 'success') throw new Error('Failed to get WS config')

      const ws = new WebSocket(config.websocket_url)
      socketRef.current = ws

      ws.onopen = async () => {
        const keyRes = await fetch('/api/websocket/apikey')
        const keyData = await keyRes.json()
        if (keyData.status === 'success' && keyData.api_key) {
          ws.send(JSON.stringify({ action: 'authenticate', api_key: keyData.api_key }))
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'auth' && msg.status === 'success') {
            setWsStatus('connected')
            loadStrikeSymbols()
          } else if (msg.type === 'market_data') {
            handleMarketData(msg)
          }
        } catch {}
      }

      ws.onclose = () => { setWsStatus('disconnected'); socketRef.current = null }
      ws.onerror = () => { setWsStatus('disconnected') }
    } catch {
      setWsStatus('disconnected')
    }
  }, [])

  const disconnect = useCallback(() => {
    socketRef.current?.close()
    socketRef.current = null
    strikeSymbolsRef.current.clear()
    realtimeDataRef.current.clear()
    setWsStatus('disconnected')
    setTableData([])
  }, [])

  const loadStrikeSymbols = useCallback(async () => {
    try {
      const res = await fetch('/madhan/api/strikes')
      const data = await res.json()
      if (data.status !== 'success') return

      const symbols = new Map<string, StrikeSymbol>()
      if (data.symbols_map) {
        Object.entries(data.symbols_map).forEach(([key, val]: [string, any]) => {
          const [strike, type] = key.split('_')
          symbols.set(key, { symbol: val.symbol, exchange: 'NFO', strike: parseInt(strike), type })
        })
      } else {
        const strikes: number[] = data.data || []
        strikes.forEach((s) => {
          symbols.set(`${s}_CE`, { symbol: `NIFTY${s}CE`, exchange: 'NFO', strike: s, type: 'CE' })
          symbols.set(`${s}_PE`, { symbol: `NIFTY${s}PE`, exchange: 'NFO', strike: s, type: 'PE' })
        })
      }
      strikeSymbolsRef.current = symbols

      const ws = socketRef.current
      if (ws?.readyState !== WebSocket.OPEN) return
      const subs = Array.from(symbols.values()).map((s) => ({ symbol: s.symbol, exchange: s.exchange }))
      subs.push({ symbol: 'NIFTY', exchange: 'NSE_INDEX' })
      ws.send(JSON.stringify({ action: 'subscribe', symbols: subs, mode: 2 }))
    } catch (err) {
      console.error('Error loading strike symbols:', err)
    }
  }, [])

  const handleMarketData = useCallback((data: any) => {
    const key = `${data.exchange}:${data.symbol}`
    const md = data.data || data
    const processed: ProcessedData = {
      ltp: md.ltp, volume: md.volume, change: md.change, open: md.open,
      high: md.high, low: md.low, close: md.close,
      average_price: md.average_price, percent_change: md.percent_change,
    }
    realtimeDataRef.current.set(key, processed)

    if (data.exchange === 'NSE_INDEX' && data.symbol === 'NIFTY') {
      spotPriceRef.current = parseFloat(md.ltp || spotPriceRef.current)
    }
    recalculate()
  }, [])

  const recalculate = useCallback(() => {
    const symbols = strikeSymbolsRef.current
    const data = realtimeDataRef.current
    const spot = spotPriceRef.current
    const strikes = Array.from(new Set(Array.from(symbols.values()).map((s) => s.strike)))
      .sort((a, b) => b - a)

    if (strikes.length === 0) { setTableData([]); return }

    let limited: number[]
    if (showAllRef.current) {
      limited = strikes
    } else {
      const atmStrike = strikes.reduce((p, c) => Math.abs(c - spot) < Math.abs(p - spot) ? c : p, strikes[0])
      const atmIdx = strikes.indexOf(atmStrike)
      limited = strikes.slice(Math.max(0, atmIdx - 5), atmIdx + 6)
    }

    const rows: TableRow[] = []
    for (const strike of limited) {
      const ceSym = symbols.get(`${strike}_CE`)
      const peSym = symbols.get(`${strike}_PE`)
      if (!ceSym || !peSym) continue

      const ce = data.get(`${ceSym.exchange}:${ceSym.symbol}`)
      const pe = data.get(`${peSym.exchange}:${peSym.symbol}`)
      if (!ce || !pe) continue

      const ceLtp = ce.ltp || 0, peLtp = pe.ltp || 0
      const ceOpen = ce.open || 0, peOpen = pe.open || 0
      const ceIntrinsic = Math.max(0, spot - strike)
      const peIntrinsic = Math.max(0, strike - spot)
      const ceExtrinsic = Math.max(0, ceLtp - ceIntrinsic)
      const peExtrinsic = Math.max(0, peLtp - peIntrinsic)

      rows.push({
        strike,
        cePercentChange: (ce.percent_change || 0).toFixed(2),
        pePercentChange: (pe.percent_change || 0).toFixed(2),
        ceLtp: ceLtp.toFixed(2), peLtp: peLtp.toFixed(2),
        ceVwap: (ce.average_price || 0).toFixed(2), peVwap: (pe.average_price || 0).toFixed(2),
        ceO: ceOpen.toFixed(2), peO: peOpen.toFixed(2),
        ceIntrinsic: ceIntrinsic.toFixed(2), peIntrinsic: peIntrinsic.toFixed(2),
        ceExtrinsic: ceExtrinsic.toFixed(2), peExtrinsic: peExtrinsic.toFixed(2),
        combinedExtrinsic: (ceExtrinsic + peExtrinsic).toFixed(2),
        combinedPremium: (ceLtp + peLtp).toFixed(2),
        openCombined: (ceOpen + peOpen).toFixed(2),
        llp: 'N/A',
        ceOpen: ceOpen.toFixed(2), peOpen: peOpen.toFixed(2),
        ceHigh: (ce.high || 0).toFixed(2), peHigh: (pe.high || 0).toFixed(2),
      })
    }
    setTableData(rows)
  }, [])

  useEffect(() => {
    return () => { socketRef.current?.close() }
  }, [])

  const cellBg = (cond: boolean, color: 'green' | 'red') => {
    if (!cond) return undefined
    return color === 'green' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'
  }

  const navigate = useNavigate()
  const { user } = useAuthStore()
  const profileMenuItems = useProfileMenuItems()

  const wsBar = (
    <div className="flex items-center gap-2">
      {wsStatus === 'connected' ? <Wifi className="h-3.5 w-3.5 text-green-500" /> : <WifiOff className="h-3.5 w-3.5 text-red-500" />}
      <span className="text-[11px] font-medium" style={{ color: wsStatus === 'connected' ? '#22c55e' : '#ef4444' }}>
        {wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
      </span>
      {wsStatus !== 'connected' ? (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={connect}>Connect</Button>
      ) : (
        <>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={disconnect}>Disconnect</Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={loadStrikeSymbols}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </>
      )}
      <div className="flex items-center gap-1 ml-2">
        <Checkbox checked={showAllStrikes} onCheckedChange={(v) => handleToggleAll(!!v)} />
        <Label className="text-[10px]" style={{ color: t.textSecondary }}>All Strikes</Label>
      </div>
    </div>
  )

  const headers = ['Strike', 'CE%', 'PE%', 'CE-LTP', 'PE-LTP', 'CE-VWAP', 'PE-VWAP', 'CE-O', 'PE-O', 'CE-Intr', 'PE-Intr', 'CE-Ext', 'PE-Ext', 'Comb-Ext', 'Comb-Prem', 'Open-Comb', 'LLP']

  const tableContent = (
    <div ref={containerRef} className="flex-1 overflow-hidden min-h-0 flex flex-col">
      {tableData.length === 0 ? (
        <div className="flex items-center justify-center h-full" style={{ color: t.textMuted }}>
          {wsStatus === 'connected' ? 'Waiting for market data...' : 'Click Connect to start'}
        </div>
      ) : (
        <table className="w-full h-full border-collapse text-[12px]" style={{ color: t.text, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '6%' }} />
            {headers.slice(1).map((_, i) => <col key={i} style={{ width: `${94 / headers.length}%` }} />)}
          </colgroup>
          <thead ref={theadRef} className="sticky top-0 z-10">
            <tr style={{ backgroundColor: t.panel }}>
              {headers.map((h) => (
                <th key={h} className="px-1 py-2 text-center border whitespace-nowrap text-[11px] font-semibold" style={{ borderColor: t.border }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="flex-1">
            {tableData.map((row, idx) => {
              const ceLtp = parseFloat(row.ceLtp), peLtp = parseFloat(row.peLtp)
              const ceOpen = parseFloat(row.ceOpen), peOpen = parseFloat(row.peOpen)
              const ceVwap = parseFloat(row.ceVwap), peVwap = parseFloat(row.peVwap)
              const ceIntrinsic = parseFloat(row.ceIntrinsic), peIntrinsic = parseFloat(row.peIntrinsic)
              const ceExtrinsic = parseFloat(row.ceExtrinsic), peExtrinsic = parseFloat(row.peExtrinsic)
              const combinedExtrinsic = parseFloat(row.combinedExtrinsic)
              const ceHigh = parseFloat(row.ceHigh), peHigh = parseFloat(row.peHigh)
              const isSelectedStrike = row.strike === parseInt(spotPriceRef.current.toFixed(0))

              return (
                <tr
                  key={row.strike}
                  style={{
                    height: rowHeight,
                    backgroundColor: isSelectedStrike
                      ? (themeMode === 'dark' ? 'rgba(41,98,255,0.15)' : 'rgba(37,99,235,0.1)')
                      : idx % 2 === 0
                        ? (themeMode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)')
                        : undefined,
                  }}
                >
                  <td className="px-1 py-1.5 text-center font-bold border whitespace-nowrap" style={{ borderColor: t.border }}>{row.strike}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, color: parseFloat(row.cePercentChange) > 0 ? '#22c55e' : parseFloat(row.cePercentChange) < 0 ? '#ef4444' : undefined }}>{row.cePercentChange}%</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, color: parseFloat(row.pePercentChange) > 0 ? '#22c55e' : parseFloat(row.pePercentChange) < 0 ? '#ef4444' : undefined }}>{row.pePercentChange}%</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(ceLtp > 0 && ceOpen > 0 && ceLtp > ceOpen, 'green') }}>{row.ceLtp}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(peLtp > 0 && peOpen > 0 && peLtp > peOpen, 'red') }}>{row.peLtp}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(ceLtp > 0 && ceVwap > 0 && ceLtp > ceVwap, 'green') }}>{row.ceVwap}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(peLtp > 0 && peVwap > 0 && peLtp > peVwap, 'red') }}>{row.peVwap}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(ceLtp > 0 && ceOpen > 0 && ceLtp > ceOpen, 'green') }}>{row.ceO}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(peLtp > 0 && peOpen > 0 && peLtp > peOpen, 'red') }}>{row.peO}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(ceLtp > 0 && ceIntrinsic > 0 && ceLtp > ceIntrinsic, 'green') }}>{row.ceIntrinsic}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(peLtp > 0 && peIntrinsic > 0 && peLtp > peIntrinsic, 'red') }}>{row.peIntrinsic}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(ceLtp > 0 && ceExtrinsic > 0 && ceLtp > ceExtrinsic && ceLtp > peLtp, 'green') }}>{row.ceExtrinsic}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, backgroundColor: cellBg(peLtp > 0 && peExtrinsic > 0 && peLtp > peExtrinsic && peLtp > ceLtp, 'red') }}>{row.peExtrinsic}</td>
                  <td
                    className="px-1 py-1.5 text-center border whitespace-nowrap font-semibold"
                    style={{
                      borderColor: t.border,
                      color: combinedExtrinsic > 0 && ((ceHigh > 0 && ceHigh > combinedExtrinsic) || (peHigh > 0 && peHigh > combinedExtrinsic)) ? '#2196f3' : undefined,
                      backgroundColor: combinedExtrinsic > 0
                        ? (ceLtp > 0 && ceLtp > combinedExtrinsic ? 'rgba(34,197,94,0.2)' : peLtp > 0 && peLtp > combinedExtrinsic ? 'rgba(239,68,68,0.2)' : undefined)
                        : undefined,
                    }}
                  >
                    {row.combinedExtrinsic}
                  </td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border }}>{row.combinedPremium}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border }}>{row.openCombined}</td>
                  <td className="px-1 py-1.5 text-center border whitespace-nowrap" style={{ borderColor: t.border, color: t.textMuted }}>{row.llp}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )

  if (!standalone) {
    return (
      <div
        className="absolute inset-0 z-20 flex flex-col overflow-hidden"
        style={{ backgroundColor: `${t.panelDarker}ee` }}
      >
        <div
          className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b"
          style={{ borderColor: t.border, backgroundColor: t.panel }}
        >
          {wsBar}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {tableContent}
      </div>
    )
  }

  return (
    <div className="h-screen w-full p-0 flex flex-col">
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

      <div
        className="shrink-0 flex items-center gap-3 px-3 py-2 border-b"
        style={{ backgroundColor: t.panelDarker, borderColor: t.border }}
      >
        {wsBar}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col" style={{ backgroundColor: t.panelDarker }}>
        {tableContent}
      </div>
    </div>
  )
}
