import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RefreshCw, TrendingUp, Wifi, WifiOff, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FutRow {
  underlying: string
  symbol: string
  brsymbol: string
  expiry: string
  lotsize: number
  tick_size: number
  strike_interval: number
  ltp: number
  futValue: number
}

type SortKey = keyof FutRow
type SortDir = 'asc' | 'desc' | null
type SortState = { key: SortKey; dir: SortDir }

export function FutStocks({ refreshTrigger }: { refreshTrigger?: number }) {
  const [futData, setFutData] = useState<FutRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [sort, setSort] = useState<SortState>({ key: 'underlying', dir: 'asc' })

  const wsRef = useRef<WebSocket | null>(null)
  const futDataRef = useRef<FutRow[]>([])
  const chartActiveRef = useRef(true)

  useEffect(() => {
    futDataRef.current = futData
  }, [futData])

  const handleSort = useCallback((key: SortKey) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key ? (prev.dir === 'asc' ? 'desc' : prev.dir === 'desc' ? null : 'asc') : 'asc',
    }))
  }, [])

  const sortedData = useMemo(() => {
    if (!sort.dir) return futData
    return [...futData].sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      const an = Number(av)
      const bn = Number(bv)
      if (!isNaN(an) && !isNaN(bn)) return sort.dir === 'asc' ? an - bn : bn - an
      const as = String(av).toLowerCase()
      const bs = String(bv).toLowerCase()
      return sort.dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
  }, [futData, sort])

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sort.key !== col) return <ChevronsUpDown className="h-3 w-3 opacity-30" />
    return sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/madhan/api/fut-stocks?_=${Date.now()}`, {
        credentials: 'include',
      })
      const json = await res.json()
      if (json.status !== 'success') {
        setError('Failed to fetch futures data')
        setLoading(false)
        return
      }
      const rows: FutRow[] = (json.data || []).map((r: any) => ({
        underlying: r.underlying,
        symbol: r.symbol,
        brsymbol: r.brsymbol,
        expiry: r.expiry,
        lotsize: r.lotsize ?? 0,
        tick_size: r.tick_size ?? 0,
        strike_interval: r.strike_interval ?? 0,
        ltp: 0,
        futValue: 0,
      }))
      setFutData(rows)
    } catch {
      setError('Failed to fetch futures data')
    } finally {
      setLoading(false)
    }
  }, [])

  const disconnectWs = useCallback(() => {
    chartActiveRef.current = false
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setWsStatus('disconnected')
  }, [])

  const connectWs = useCallback(async () => {
    disconnectWs()
    chartActiveRef.current = true

    const symbols = futDataRef.current
      .filter((r) => r.symbol)
      .map((r) => ({ symbol: r.symbol, exchange: 'NFO' }))

    if (symbols.length === 0) return

    try {
      const csrfRes = await fetch('/auth/csrf-token', { credentials: 'include' })
      const csrfData = await csrfRes.json()
      const csrfToken = csrfData.csrf_token

      const configRes = await fetch('/api/websocket/config', {
        headers: { 'X-CSRFToken': csrfToken },
        credentials: 'include',
      })
      const configData = await configRes.json()
      if (configData.status !== 'success') return

      setWsStatus('connecting')
      const socket = new WebSocket(configData.websocket_url)
      wsRef.current = socket

      socket.onopen = async () => {
        try {
          const authCsrfRes = await fetch('/auth/csrf-token', { credentials: 'include' })
          const authCsrfData = await authCsrfRes.json()
          const apiKeyRes = await fetch('/api/websocket/apikey', {
            headers: { 'X-CSRFToken': authCsrfData.csrf_token },
            credentials: 'include',
          })
          const apiKeyJson = await apiKeyRes.json()
          if (apiKeyJson.status === 'success' && apiKeyJson.api_key) {
            socket.send(JSON.stringify({ action: 'authenticate', api_key: apiKeyJson.api_key }))
          }
        } catch {
          setWsStatus('disconnected')
        }
      }

      socket.onmessage = (event) => {
        if (!chartActiveRef.current) return
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'auth' && msg.status === 'success') {
            setWsStatus('connected')
            socket.send(JSON.stringify({ action: 'subscribe', symbols, mode: 1 }))
          } else if (msg.type === 'market_data' && msg.data) {
            const key = `${msg.exchange}:${msg.symbol}`
            const ltp = parseFloat(msg.data.ltp) || 0
            if (ltp <= 0) return

            setFutData((prev) =>
              prev.map((row) => {
                if (`NFO:${row.symbol}` === key) {
                  const newLtp = ltp
                  const newValue = newLtp * row.lotsize
                  if (row.ltp === newLtp) return row
                  return { ...row, ltp: newLtp, futValue: newValue }
                }
                return row
              })
            )
          }
        } catch {}
      }

      socket.onclose = () => setWsStatus('disconnected')
      socket.onerror = () => setWsStatus('disconnected')
    } catch {
      setWsStatus('disconnected')
    }
  }, [disconnectWs])

  const toggleSubscribe = useCallback(() => {
    if (wsStatus === 'disconnected') {
      connectWs()
    } else {
      disconnectWs()
    }
  }, [wsStatus, connectWs, disconnectWs])

  useEffect(() => {
    fetchData()
  }, [fetchData, refreshTrigger])

  useEffect(() => {
    return () => {
      chartActiveRef.current = false
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  const thClass = 'h-8 px-3 text-[11px] font-medium cursor-pointer select-none hover:bg-muted/80 transition-colors whitespace-nowrap'
  const isLive = wsStatus === 'connected'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          <CardTitle className="text-base font-semibold">FUT Stocks</CardTitle>
          <div className="flex items-center gap-1 ml-2">
            {wsStatus === 'connected' ? (
              <Wifi className="h-3 w-3 text-green-500" />
            ) : (
              <WifiOff className="h-3 w-3 text-red-500" />
            )}
            <span className="text-[10px] font-medium" style={{ color: isLive ? '#22c55e' : '#ef4444' }}>
              {isLive ? 'Live' : wsStatus === 'connecting' ? 'Connecting...' : ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={isLive ? 'destructive' : 'default'}
            size="sm"
            className="h-6 text-[11px] px-2"
            onClick={toggleSubscribe}
            disabled={wsStatus === 'connecting'}
          >
            {isLive ? 'Unsubscribe LTP' : wsStatus === 'connecting' ? 'Connecting...' : 'Subscribe LTP'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => fetchData()}
            title="Refresh"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="text-xs text-destructive mb-2">{error}</div>
        )}
        {futData.length === 0 && !loading && !error && (
          <div className="text-xs text-muted-foreground">
            No futures data available.
          </div>
        )}
        {futData.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  <th className={`${thClass} text-left`} onClick={() => handleSort('underlying')}>
                    <span className="inline-flex items-center gap-1">Underlying Symbol <SortIcon col="underlying" /></span>
                  </th>
                  <th className={`${thClass} text-left`} onClick={() => handleSort('symbol')}>
                    <span className="inline-flex items-center gap-1">Symbol <SortIcon col="symbol" /></span>
                  </th>
                  <th className={`${thClass} text-left`} onClick={() => handleSort('expiry')}>
                    <span className="inline-flex items-center gap-1">Expiry <SortIcon col="expiry" /></span>
                  </th>
                  <th className={`${thClass} text-right`} onClick={() => handleSort('lotsize')}>
                    <span className="inline-flex items-center gap-1">Lot Size <SortIcon col="lotsize" /></span>
                  </th>
                  <th className={`${thClass} text-right`} onClick={() => handleSort('tick_size')}>
                    <span className="inline-flex items-center gap-1">Tick Size <SortIcon col="tick_size" /></span>
                  </th>
                  <th className={`${thClass} text-right`} onClick={() => handleSort('strike_interval')}>
                    <span className="inline-flex items-center gap-1">Strike Interval <SortIcon col="strike_interval" /></span>
                  </th>
                  <th className={`${thClass} text-right`} onClick={() => handleSort('ltp')}>
                    <span className="inline-flex items-center gap-1">LTP <SortIcon col="ltp" /></span>
                  </th>
                  <th className={`${thClass} text-right`} onClick={() => handleSort('futValue')}>
                    <span className="inline-flex items-center gap-1">Fut Value <SortIcon col="futValue" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row) => (
                  <tr
                    key={row.underlying}
                    className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                  >
                    <td className="p-2 px-3 font-mono font-semibold">{row.underlying}</td>
                    <td className="p-2 px-3 font-mono">{row.symbol || '—'}</td>
                    <td className="p-2 px-3 font-mono">{row.expiry}</td>
                    <td className="p-2 px-3 text-right">{row.lotsize || '—'}</td>
                    <td className="p-2 px-3 text-right font-mono">{row.tick_size || '—'}</td>
                    <td className="p-2 px-3 text-right font-mono">{row.strike_interval || '—'}</td>
                    <td className="p-2 px-3 text-right font-mono">
                      {row.ltp > 0 ? row.ltp.toFixed(2) : '—'}
                    </td>
                    <td className="p-2 px-3 text-right font-mono font-medium">
                      {row.futValue > 0 ? row.futValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
