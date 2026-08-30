import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInstrument } from '../InstrumentContext'
import { useMadhanTheme } from '../useMadhanTheme'

interface StrikeSymbol {
  symbol: string; exchange: string; strike: number; type: string
}

interface ProcessedData {
  ltp: number; volume: number; open: number; high: number; low: number;
  close: number; average_price: number; percent_change: number;
}

interface CellHist {
  lastPosTs: number | null
  posStreakStart: number | null
  negStreakStart: number | null
  lastNegTs: number | null
  maxDiff: number
  lastDiff: number
}

interface PriceDiffProps {
  refreshTrigger?: number
}

function padZ(n: number) { return String(n).padStart(2, '0') }
function fmtStrike(s: number) { return String(Math.round(s)) }
function fmtLtp(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) return v.toFixed(0)
  if (a >= 100) return v.toFixed(1)
  return v.toFixed(2)
}
function fmtDiff(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '—'
  const a = Math.abs(v)
  const s = v > 0 ? '+' : (v < 0 ? '−' : '')
  const mag = a >= 1000 ? a.toFixed(0) : (a >= 100 ? a.toFixed(0) : a.toFixed(1))
  return s + mag
}
function fmtMins(sec: number | null | undefined) {
  if (sec == null) return '—'
  sec = Math.floor(sec)
  if (sec < 60) return sec + 's'
  const m = Math.floor(sec / 60)
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60), mm = m % 60
  return h + 'h' + (mm ? padZ(mm) + 'm' : '')
}

export function PriceDiffMatrix({ refreshTrigger }: PriceDiffProps) {
  const { strikeStep } = useInstrument()

  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const socketRef = useRef<WebSocket | null>(null)
  const strikeSymbolsRef = useRef<Map<string, StrikeSymbol>>(new Map())
  const realtimeDataRef = useRef<Map<string, ProcessedData>>(new Map())
  const spotPriceRef = useRef(0)

  const [idx, setIdx] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY')
  const idxRef = useRef(idx)
  useEffect(() => { idxRef.current = idx }, [idx])

  const [ceCount, setCeCount] = useState(10)
  const [peCount, setPeCount] = useState(10)
  const [timerMode, setTimerMode] = useState<'on' | 'off'>('on')
  const [paused, setPaused] = useState(false)
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  const [alertSoundEnabled, setAlertSoundEnabled] = useState(true)
  const [holdSec, setHoldSec] = useState(60)
  const pausedRef = useRef(paused)
  const alertsEnabledRef = useRef(alertsEnabled)
  const alertSoundEnabledRef = useRef(alertSoundEnabled)
  const holdSecRef = useRef(holdSec)
  const timerModeRef = useRef(timerMode)
  const ceCountRef = useRef(ceCount)
  const peCountRef = useRef(peCount)
  useEffect(() => { pausedRef.current = paused }, [paused])
  useEffect(() => { alertsEnabledRef.current = alertsEnabled }, [alertsEnabled])
  useEffect(() => { alertSoundEnabledRef.current = alertSoundEnabled }, [alertSoundEnabled])
  useEffect(() => { holdSecRef.current = holdSec }, [holdSec])
  useEffect(() => { timerModeRef.current = timerMode }, [timerMode])
  useEffect(() => { ceCountRef.current = ceCount }, [ceCount])
  useEffect(() => { peCountRef.current = peCount }, [peCount])

  const cellHistRef = useRef<Map<string, CellHist>>(new Map())
  const maxDiffRef = useRef<{ val: number | null; key: string | null }>({ val: null, key: null })
  const openAtmRef = useRef<number | null>(null)
  const openSpotRef = useRef<number | null>(null)
  const posCERef = useRef<{ strike: number; entryTime: number; entrySpot: number | null } | null>(null)
  const posPERef = useRef<{ strike: number; entryTime: number; entrySpot: number | null } | null>(null)
  const lastFireTsRef = useRef<Map<string, number>>(new Map())
  const audioCtxRef = useRef<AudioContext | null>(null)

  const [stats, setStats] = useState({ maxPos: '—', maxNeg: '—', pCount: 0, nCount: 0, ceRange: '—', peRange: '—', lastUpd: 'waiting…' })
  const [chips, setChips] = useState({ atm: 'ATM —', openAtm: 'OPEN ATM —', spot: 'SPOT —' })

  const { mode: themeMode } = useMadhanTheme()
  const isDark = themeMode === 'dark'
  const th = useMemo(() => isDark ? {
    bg: '#080c16', bgPanel: '#0c1838', bgHeader: 'linear-gradient(135deg,#050a18,#0c1838 50%,#170a2c)',
    bgControls: 'rgba(10,18,36,.85)', bgCell: '#0b1020', bgCellAlt: '#0e1426', bgInput: '#0d1830',
    border: '#1e2a48', borderCell: '#192238', borderControl: '#2a3858',
    text: '#e6edfa', textSec: '#8a9bbf', textMuted: '#5a6a8c',
    textBtnActive: '#7fd5ff', bgBtnActive: 'rgba(56,196,255,.18)',
    textWhite: '#ffffff', scrollBar: '#1e2a48', scrollTrack: '#0a1020',
    timerColor: 'rgba(180,255,210,.65)', inputBorder: '1px solid #2a3858',
  } : {
    bg: '#f5f6fa', bgPanel: '#ffffff', bgHeader: 'linear-gradient(135deg,#eef0f5,#ffffff 50%,#f0eef5)',
    bgControls: 'rgba(245,246,250,.95)', bgCell: '#ffffff', bgCellAlt: '#f0f2f5', bgInput: '#f0f1f4',
    border: '#e2e5ea', borderCell: '#d1d5db', borderControl: '#d1d5db',
    text: '#1f2937', textSec: '#6b7280', textMuted: '#9ca3af',
    textBtnActive: '#2563eb', bgBtnActive: 'rgba(37,99,235,.1)',
    textWhite: '#ffffff', scrollBar: '#c1c8d4', scrollTrack: '#f0f2f5',
    timerColor: 'rgba(16,128,80,.7)', inputBorder: '1px solid #d1d5db',
  }, [isDark])

  const [expiryList, setExpiryList] = useState<string[]>([])
  const [selectedExpiry, setSelectedExpiry] = useState('')
  const [matrixData, setMatrixData] = useState<{
    ceRows: { strike: number; ceLtp: number }[]
    peRowsDisp: { strike: number; peLtp: number }[]
    cellMatrix: { ceStrike: number; peStrike: number; ceLtp: number; peLtp: number; diff: number; key: string; hist: CellHist }[][]
    q75: number
    maxDiffKey: string | null
  } | null>(null)
  const [empty, setEmpty] = useState(true)

  // Fetch expiry list — re-fetch when idx toggles
  useEffect(() => {
    setSelectedExpiry('')
    const fetchExpiry = async () => {
      try {
        const r = await fetch(`/scalping/api/expiry?underlying=${idxRef.current}&exchange=NFO&instrumenttype=options`)
        const j = await r.json()
        if (j.status === 'success' && j.data?.length) {
          setExpiryList(j.data)
          setSelectedExpiry(j.data[0])
        }
      } catch { /* ignore */ }
    }
    fetchExpiry()
  }, [idx])

  // Fetch day open (9:15 first candle close)
  const fetchDayOpen = useCallback(async () => {
    try {
      const r = await fetch(`/madhan/api/nifty/spot-data?instrument=${idxRef.current}&_=${Date.now()}`)
      const j = await r.json()
      if (j.status === 'success' && j.data?.prices?.length > 0) {
        const firstClose = j.data.prices[0]
        openSpotRef.current = firstClose
        openAtmRef.current = Math.round(firstClose / strikeStep) * strikeStep
      }
    } catch { /* ignore */ }
  }, [strikeStep])

  useEffect(() => { fetchDayOpen() }, [fetchDayOpen])

  // ── Broker WebSocket connection ──
  const handleMarketData = useCallback((msg: any) => {
    const key = `${msg.exchange}:${msg.symbol}`
    const md = msg.data || msg
    const processed: ProcessedData = {
      ltp: md.ltp, volume: md.volume, open: md.open, high: md.high,
      low: md.low, close: md.close, average_price: md.average_price,
      percent_change: md.percent_change,
    }
    realtimeDataRef.current.set(key, processed)

    if (msg.exchange === 'NSE_INDEX' && msg.symbol === idxRef.current) {
      spotPriceRef.current = parseFloat(md.ltp || spotPriceRef.current)
    }
  }, [])

  const loadStrikeSymbols = useCallback(async () => {
    try {
      const currentIdx = idxRef.current
      const res = await fetch(`/madhan/api/strikes?instrument=${currentIdx}&_=${Date.now()}`)
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
          symbols.set(`${s}_CE`, { symbol: `${currentIdx}${s}CE`, exchange: 'NFO', strike: s, type: 'CE' })
          symbols.set(`${s}_PE`, { symbol: `${currentIdx}${s}PE`, exchange: 'NFO', strike: s, type: 'PE' })
        })
      }
      const ws = socketRef.current
      const oldSymbols = Array.from(strikeSymbolsRef.current.values()).map((s) => ({ symbol: s.symbol, exchange: s.exchange }))
      oldSymbols.push({ symbol: currentIdx === 'NIFTY' ? 'BANKNIFTY' : 'NIFTY', exchange: 'NSE_INDEX' })
      strikeSymbolsRef.current = symbols
      realtimeDataRef.current.clear()
      spotPriceRef.current = 0
      cellHistRef.current.clear()
      openAtmRef.current = null
      openSpotRef.current = null
      if (ws?.readyState !== WebSocket.OPEN) return
      if (oldSymbols.length > 0) {
        ws.send(JSON.stringify({ action: 'unsubscribe', symbols: oldSymbols }))
      }
      const subs = Array.from(symbols.values()).map((s) => ({ symbol: s.symbol, exchange: s.exchange }))
      subs.push({ symbol: currentIdx, exchange: 'NSE_INDEX' })
      ws.send(JSON.stringify({ action: 'subscribe', symbols: subs, mode: 2 }))
    } catch (err) {
      console.error('Error loading strike symbols:', err)
    }
  }, [])

  const loadStrikeSymbolsRef = useRef(loadStrikeSymbols)
  useEffect(() => { loadStrikeSymbolsRef.current = loadStrikeSymbols }, [loadStrikeSymbols])

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
            loadStrikeSymbolsRef.current()
          } else if (msg.type === 'market_data') {
            handleMarketData(msg)
          }
        } catch { /* ignore */ }
      }

      ws.onclose = () => { setWsStatus('disconnected'); socketRef.current = null }
      ws.onerror = () => { setWsStatus('disconnected') }
    } catch {
      setWsStatus('disconnected')
    }
  }, [handleMarketData])

  useEffect(() => {
    connect()
    return () => { socketRef.current?.close() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-subscribe when idx changes
  useEffect(() => {
    if (wsStatus === 'connected') {
      loadStrikeSymbols()
      fetchDayOpen()
    }
  }, [idx, wsStatus, loadStrikeSymbols, fetchDayOpen])

  // ── Beep ──
  const beep = useCallback((kind: string) => {
    if (!alertSoundEnabledRef.current) return
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      const ctx = audioCtxRef.current
      const patterns: Record<string, { f: number; d: number }[]> = {
        'buy-ce': [{ f: 880, d: .14 }, { f: 1320, d: .18 }],
        'buy-pe': [{ f: 660, d: .14 }, { f: 494, d: .18 }],
        'exit-ce': [{ f: 440, d: .10 }, { f: 392, d: .10 }, { f: 349, d: .18 }],
        'exit-pe': [{ f: 440, d: .10 }, { f: 392, d: .10 }, { f: 349, d: .18 }],
      }
      const pat = patterns[kind] || [{ f: 800, d: .2 }]
      let t = ctx.currentTime
      for (const n of pat) {
        const o = ctx.createOscillator(), g = ctx.createGain()
        o.type = 'sine'; o.frequency.value = n.f
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + n.d)
        o.connect(g).connect(ctx.destination)
        o.start(t); o.stop(t + n.d + 0.02)
        t += n.d
      }
    } catch { /* ignore */ }
  }, [])

  const canFire = useCallback((key: string, minGapSec: number) => {
    const now = Date.now() / 1000
    const last = lastFireTsRef.current.get(key) || 0
    if (now - last < minGapSec) return false
    lastFireTsRef.current.set(key, now)
    return true
  }, [])

  // ── Compute matrix from live WS data ──
  const computeMatrix = useCallback(() => {
    const symbols = strikeSymbolsRef.current
    const data = realtimeDataRef.current
    const spot = spotPriceRef.current

    if (symbols.size === 0 || spot === 0) {
      setEmpty(true)
      setMatrixData(null)
      return
    }

    const strikes = Array.from(new Set(Array.from(symbols.values()).map(s => s.strike))).sort((a, b) => a - b)
    if (strikes.length === 0) { setEmpty(true); setMatrixData(null); return }

    // ATM
    const atm = strikes.reduce((p, c) => Math.abs(c - spot) < Math.abs(p - spot) ? c : p, strikes[0])
    const gap = strikeStep

    // Open ATM from day open
    const oATM = openAtmRef.current

    // Build CE/PE rows with LTP from WS
    const nCE = ceCountRef.current
    const nPE = peCountRef.current
    const atmIdx = strikes.indexOf(atm)

    let ceStrikes = strikes.slice(Math.max(0, atmIdx - nCE), atmIdx + nCE + 1)
    let peStrikes = strikes.slice(Math.max(0, atmIdx - nPE), atmIdx + nPE + 1)

    // Auto-extend for open ATM
    if (oATM && !ceStrikes.includes(oATM)) ceStrikes.push(oATM)
    if (oATM && !peStrikes.includes(oATM)) peStrikes.push(oATM)
    ceStrikes.sort((a, b) => a - b)
    peStrikes.sort((a, b) => a - b)

    // Build CE rows — include all strikes even if WS data not yet received
    const ceRows: { strike: number; ceLtp: number }[] = []
    for (const s of ceStrikes) {
      const sym = symbols.get(`${s}_CE`)
      if (!sym) continue
      const d = data.get(`${sym.exchange}:${sym.symbol}`)
      const ltp = d?.ltp || 0
      ceRows.push({ strike: s, ceLtp: ltp })
    }

    // Build PE rows — reversed for display
    const peRowsAll: { strike: number; peLtp: number }[] = []
    for (const s of peStrikes) {
      const sym = symbols.get(`${s}_PE`)
      if (!sym) continue
      const d = data.get(`${sym.exchange}:${sym.symbol}`)
      const ltp = d?.ltp || 0
      peRowsAll.push({ strike: s, peLtp: ltp })
    }
    const peRowsDisp = [...peRowsAll].reverse()

    if (ceRows.length === 0 || peRowsAll.length === 0) {
      setEmpty(true)
      setMatrixData(null)
      return
    }

    setEmpty(false)

    const nowSec = Math.floor(Date.now() / 1000)
    let pCount = 0, nCount = 0
    let maxPos: { val: number | null; key: string | null } = { val: null, key: null }
    let maxNeg: { val: number | null; key: string | null } = { val: null, key: null }
    const cellMatrix: { ceStrike: number; peStrike: number; ceLtp: number; peLtp: number; diff: number; key: string; hist: CellHist }[][] = []

    for (const pr of peRowsDisp) {
      const rowArr: { ceStrike: number; peStrike: number; ceLtp: number; peLtp: number; diff: number; key: string; hist: CellHist }[] = []
      for (const cr of ceRows) {
        const diff = cr.ceLtp - pr.peLtp
        const key = cr.strike + '|' + pr.strike

        let h = cellHistRef.current.get(key)
        if (!h) {
          h = { lastPosTs: null, posStreakStart: null, negStreakStart: null, lastNegTs: null, maxDiff: diff, lastDiff: diff }
          cellHistRef.current.set(key, h)
        }
        if (diff > 0) {
          h.lastPosTs = nowSec
          if (h.posStreakStart == null) h.posStreakStart = nowSec
          h.negStreakStart = null
        } else if (diff < 0) {
          h.lastNegTs = nowSec
          if (h.negStreakStart == null) h.negStreakStart = nowSec
          h.posStreakStart = null
        } else {
          h.posStreakStart = null
          h.negStreakStart = null
        }
        if (diff > h.maxDiff) h.maxDiff = diff
        h.lastDiff = diff

        if (diff > 0) pCount++
        else if (diff < 0) nCount++
        if (maxPos.val == null || diff > maxPos.val) maxPos = { val: diff, key }
        if (maxNeg.val == null || diff < maxNeg.val) maxNeg = { val: diff, key }

        rowArr.push({ ceStrike: cr.strike, peStrike: pr.strike, ceLtp: cr.ceLtp, peLtp: pr.peLtp, diff, key, hist: h })
      }
      cellMatrix.push(rowArr)
    }

    // Evaluate alerts
    if (alertsEnabledRef.current && atm && gap) {
      const nowSec2 = Date.now() / 1000
      const hold = holdSecRef.current
      const plus1CE = atm + gap
      const minus1CE = atm - gap
      const keyP = `${plus1CE}|${atm}`
      const keyM = `${minus1CE}|${atm}`
      const hP = cellHistRef.current.get(keyP)
      const hM = cellHistRef.current.get(keyM)

      if (hP) {
        const diffP = hP.lastDiff
        if (diffP < 0 && posCERef.current && posCERef.current.strike === atm) {
          if (canFire('exitCE-' + atm, 15)) { posCERef.current = null; beep('exit-ce') }
        } else if (diffP > 0 && hP.posStreakStart && (nowSec2 - hP.posStreakStart) >= hold) {
          if (!posCERef.current && canFire('buyCE-' + atm, 30)) {
            posCERef.current = { strike: atm, entryTime: nowSec2, entrySpot: spot }
            beep('buy-ce')
          }
        }
      }
      if (hM) {
        const diffM = hM.lastDiff
        if (diffM > 0 && posPERef.current && posPERef.current.strike === atm) {
          if (canFire('exitPE-' + atm, 15)) { posPERef.current = null; beep('exit-pe') }
        } else if (diffM < 0 && hM.negStreakStart && (nowSec2 - hM.negStreakStart) >= hold) {
          if (!posPERef.current && canFire('buyPE-' + atm, 30)) {
            posPERef.current = { strike: atm, entryTime: nowSec2, entrySpot: spot }
            beep('buy-pe')
          }
        }
      }
    }

    // q75
    const allAbs = cellMatrix.flat().map(c => Math.abs(c.diff)).sort((a, b) => a - b)
    const q75 = allAbs[Math.floor(allAbs.length * 0.75)] || 0

    maxDiffRef.current = maxPos

    setMatrixData({ ceRows, peRowsDisp, cellMatrix, q75, maxDiffKey: maxPos.key })
    setStats({
      maxPos: maxPos.val != null ? fmtDiff(maxPos.val) : '—',
      maxNeg: maxNeg.val != null ? fmtDiff(maxNeg.val) : '—',
      pCount, nCount,
      ceRange: ceRows.length ? (fmtStrike(ceRows[0].strike) + '→' + fmtStrike(ceRows[ceRows.length - 1].strike)) : '—',
      peRange: peRowsAll.length ? (fmtStrike(peRowsAll[0].strike) + '→' + fmtStrike(peRowsAll[peRowsAll.length - 1].strike)) : '—',
      lastUpd: new Date().toLocaleTimeString()
    })
    setChips({
      atm: 'ATM ' + (atm ? fmtStrike(atm) : '—'),
      openAtm: 'OPEN ATM ' + (oATM ? fmtStrike(oATM) : '—'),
      spot: spot ? 'SPOT ' + spot.toFixed(2) + ' ' + fmtStrike(Math.round(spot / gap) * gap) : 'SPOT —',
    })
  }, [canFire, beep, selectedExpiry, strikeStep])

  // Re-render on data changes
  useEffect(() => {
    const iv = setInterval(() => {
      if (!pausedRef.current) computeMatrix()
    }, 250)
    return () => clearInterval(iv)
  }, [computeMatrix])

  useEffect(() => {
    if (refreshTrigger) computeMatrix()
  }, [refreshTrigger, computeMatrix])

  const resetTimers = useCallback(() => {
    cellHistRef.current.clear()
    computeMatrix()
  }, [computeMatrix])

  // Audio resume
  useEffect(() => {
    const handler = () => {
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    }
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [])

  // ── Build table ──
  const renderTable = () => {
    if (!matrixData || empty) {
      return (
        <div className="flex-1 min-h-0 overflow-auto p-1 relative" style={{ background: th.bg }}>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="rounded-lg p-7 text-center shadow-xl" style={{ background: isDark ? 'rgba(15,22,40,.95)' : 'rgba(255,255,255,.95)', border: `1px solid ${th.borderControl}` }}>
              <div className="text-3xl mb-2">◈</div>
              <div className="text-sm font-black tracking-widest mb-1" style={{ fontFamily: 'Rajdhani,sans-serif', color: th.textSec }}>
                {wsStatus !== 'connected' ? 'CONNECTING TO WEBSOCKET…' : 'WAITING FOR CHAIN DATA'}
              </div>
              <div className="text-xs" style={{ fontFamily: 'JetBrains Mono,monospace', color: th.textMuted }}>
                {wsStatus !== 'connected' ? 'Establishing broker connection…' : 'No option data available yet'}
              </div>
            </div>
          </div>
        </div>
      )
    }

    const { ceRows, peRowsDisp, cellMatrix, q75, maxDiffKey } = matrixData
    const nowSec = Math.floor(Date.now() / 1000)
    const oATM = openAtmRef.current
    const spot = spotPriceRef.current
    const gap = strikeStep
    const spotStrike = spot ? Math.round(spot / gap) * gap : null

    return (
      <div className="flex-1 min-h-0 overflow-auto p-1" style={{ background: th.bg, scrollbarWidth: 'thin', scrollbarColor: `${th.scrollBar} ${th.scrollTrack}` }}>
        <table className="border-separate border-spacing-0 mx-auto" style={{ fontFamily: 'JetBrains Mono,monospace', fontSize: '11px', fontWeight: 700, tableLayout: 'auto', width: '100%' }}>
          <thead>
            <tr>
              <th className="text-[9.5px] font-black tracking-wider uppercase sticky top-0 left-0 z-10" style={{ padding: '4px 6px', minWidth: 110, border: `1px solid ${th.borderCell}`, background: th.bgCell, color: th.textMuted }}>PE ╲ CE</th>
              {ceRows.map(cr => {
                const isAtm = atm && Math.abs(cr.strike - atm) < 0.5
                const isOpenAtm = oATM && Math.abs(cr.strike - oATM) < 0.5
                const isSpot = spotStrike != null && Math.abs(cr.strike - spotStrike) < 0.5
                let bg = isDark ? 'linear-gradient(180deg,#2a1608 0%,#1a0e04 100%)' : 'linear-gradient(180deg,#fff5ee 0%,#ffeedd 100%)'
                let color = isDark ? '#ff8a55' : '#c2410c'
                if (isAtm && isOpenAtm) { bg = 'linear-gradient(180deg,#1a3a1a 0%,#0a200a 100%)'; color = '#b6f0b6' }
                else if (isAtm) { bg = 'linear-gradient(180deg,#3a2a08 0%,#261a04 100%)'; color = '#ffdd44' }
                else if (isOpenAtm) { bg = 'linear-gradient(180deg,#082a2e 0%,#041a1d 100%)'; color = '#38d7e0' }
                else if (isSpot) { bg = 'linear-gradient(180deg,#2a1a04 0%,#170e02 100%)'; color = '#ffcc88' }
                const marks: string[] = []
                if (isAtm) marks.push('★')
                if (isOpenAtm) marks.push('◆')
                if (isSpot) marks.push('●')
                return (
                  <th key={cr.strike} title={`CE ${fmtStrike(cr.strike)} LTP ${fmtLtp(cr.ceLtp)}`} style={{ background: bg, color, fontWeight: 900, fontSize: 11, letterSpacing: '.5px', position: 'sticky', top: 0, zIndex: 3, borderBottom: isAtm ? '2px solid #806020' : isOpenAtm ? '2px solid #0a6d78' : `2px solid ${isDark ? '#4a2010' : '#e5d5cc'}`, height: 32, border: `1px solid ${th.borderCell}`, textAlign: 'center', verticalAlign: 'middle' }}>
                    {fmtStrike(cr.strike)}{marks.length ? ' ' + marks.join('') : ''}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {cellMatrix.map((row, ri) => {
              const pe = peRowsDisp[ri]
              const isAtmRow = atm && Math.abs(pe.strike - atm) < 0.5
              const isOpenAtmRow = oATM && Math.abs(pe.strike - oATM) < 0.5
              const isSpotRow = spotStrike != null && Math.abs(pe.strike - spotStrike) < 0.5
              let rowBg = isDark ? 'linear-gradient(90deg,#14082a 0%,#0a0418 100%)' : 'linear-gradient(90deg,#f5f0ff 0%,#ede8ff 100%)'
              let rowColor = isDark ? '#aa88ff' : '#7c3aed'
              if (isAtmRow && isOpenAtmRow) { rowBg = 'linear-gradient(90deg,#1a3a1a 0%,#0a200a 100%)'; rowColor = '#b6f0b6' }
              else if (isAtmRow) { rowBg = 'linear-gradient(90deg,#2a1c08 0%,#160f04 100%)'; rowColor = '#ffdd44' }
              else if (isOpenAtmRow) { rowBg = 'linear-gradient(90deg,#082a2e 0%,#041a1d 100%)'; rowColor = '#38d7e0' }
              else if (isSpotRow) { rowBg = 'linear-gradient(90deg,#2a1a04 0%,#170e02 100%)'; rowColor = '#ffcc88' }
              const rowMarks: string[] = []
              if (isAtmRow) rowMarks.push('★')
              if (isOpenAtmRow) rowMarks.push('◆')
              if (isSpotRow) rowMarks.push('●')

              return (
                <tr key={pe.strike}>
                  <th title={`PE ${fmtStrike(pe.strike)} LTP ${fmtLtp(pe.peLtp)}`} style={{ background: rowBg, color: rowColor, fontWeight: 900, fontSize: 11, letterSpacing: '.5px', position: 'sticky', left: 0, zIndex: 2, borderRight: isAtmRow ? '2px solid #806020' : isOpenAtmRow ? '2px solid #0a6d78' : `2px solid ${isDark ? '#2a1855' : '#ddd5ee'}`, width: 'auto', minWidth: 110, maxWidth: 130, padding: '3px 8px', textAlign: 'right', border: `1px solid ${th.borderCell}`, verticalAlign: 'middle' }}>
                    {rowMarks.length ? rowMarks.join('') + ' ' : ''}{fmtStrike(pe.strike)} PE
                  </th>
                  {row.map(cell => {
                    let cellBg = isDark ? '#0b1020' : '#f8f9fc'
                    let cellColor = 'inherit'
                    if (cell.diff > 0) { cellBg = 'rgba(0,190,80,.22)'; cellColor = '#00dd6a' }
                    else if (cell.diff < 0) { cellBg = 'rgba(220,40,60,.22)'; cellColor = '#ff4a5d' }
                    else { cellBg = 'rgba(40,170,240,.28)'; cellColor = '#38c4ff' }
                    if (q75 > 0 && Math.abs(cell.diff) >= q75 * 1.25) {
                      if (cell.diff > 0) { cellBg = 'rgba(0,220,100,.42)'; cellColor = '#b8ffd6' }
                      else if (cell.diff < 0) { cellBg = 'rgba(255,74,93,.42)'; cellColor = '#ffd0d6' }
                    }
                    const isMax = maxDiffKey && cell.key === maxDiffKey && cell.diff > 0

                    const boxShadows: string[] = []
                    if (atm && Math.abs(cell.ceStrike - atm) < 0.5) boxShadows.push('inset 1px 0 0 rgba(255,221,68,.9)', 'inset -1px 0 0 rgba(255,221,68,.9)')
                    if (atm && Math.abs(cell.peStrike - atm) < 0.5) boxShadows.push('inset 0 1px 0 rgba(255,221,68,.9)', 'inset 0 -1px 0 rgba(255,221,68,.9)')
                    if (oATM && Math.abs(cell.ceStrike - oATM) < 0.5) boxShadows.push('inset 2px 0 0 rgba(56,215,224,.75)', 'inset -2px 0 0 rgba(56,215,224,.75)')
                    if (oATM && Math.abs(cell.peStrike - oATM) < 0.5) boxShadows.push('inset 0 2px 0 rgba(56,215,224,.75)', 'inset 0 -2px 0 rgba(56,215,224,.75)')
                    if (spotStrike != null && Math.abs(cell.ceStrike - spotStrike) < 0.5) boxShadows.push('inset 3px 0 0 rgba(255,170,68,.65)', 'inset -3px 0 0 rgba(255,170,68,.65)')
                    if (spotStrike != null && Math.abs(cell.peStrike - spotStrike) < 0.5) boxShadows.push('inset 0 3px 0 rgba(255,170,68,.65)', 'inset 0 -3px 0 rgba(255,170,68,.65)')

                    let timerTxt = ''
                    if (timerModeRef.current !== 'off' && cell.diff > 0 && cell.hist.posStreakStart) {
                      timerTxt = fmtMins(nowSec - cell.hist.posStreakStart)
                    }

                    return (
                      <td key={cell.key} title={`CE ${fmtStrike(cell.ceStrike)} LTP ${fmtLtp(cell.ceLtp)}\nPE ${fmtStrike(cell.peStrike)} LTP ${fmtLtp(cell.peLtp)}\nDiff: ${fmtDiff(cell.diff)}\nMax: ${fmtDiff(cell.hist.maxDiff)}`}
                        style={{
                          background: cellBg, color: cellColor, height: 32,
                          border: `1px solid ${th.borderCell}`, textAlign: 'center', verticalAlign: 'middle',
                          fontWeight: 800, transition: 'filter .12s',
                          boxShadow: boxShadows.length ? boxShadows.join(', ') : undefined,
                          outline: isMax ? '2px solid #ffdd44' : undefined,
                          outlineOffset: isMax ? '-2px' : undefined,
                        }}>
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', lineHeight: 1.1, padding: '2px 0' }}>
                          <span style={{ fontSize: '11.5px', fontWeight: 800, letterSpacing: '.2px' }}>{fmtDiff(cell.diff)}</span>
                          {timerModeRef.current !== 'off' && timerTxt && (
                            <span style={{ fontSize: '8.5px', fontWeight: 700, color: th.timerColor, marginTop: 1, letterSpacing: '.3px', fontFamily: 'JetBrains Mono,monospace' }}>{timerTxt}</span>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {/* Reference rows */}
            <tr>
              <th className="text-[9.5px] font-black tracking-wider uppercase sticky left-0 z-10" style={{ padding: '3px 8px', textAlign: 'right', border: `1px solid ${th.borderCell}`, borderBottom: `2px solid ${isDark ? '#4a2010' : '#e5d5cc'}`, position: 'sticky', bottom: 64, background: th.bgCell, color: isDark ? '#ff8a55' : '#c2410c' }}>CE LTP</th>
              {ceRows.map(cr => (
                <td key={cr.strike} style={{ color: isDark ? '#ff8a55' : '#c2410c', fontWeight: 800, fontSize: 11, background: th.bgCellAlt, position: 'sticky', bottom: 64, borderTop: `2px solid ${isDark ? '#4a2010' : '#e5d5cc'}`, height: 32, border: `1px solid ${th.borderCell}`, textAlign: 'center', verticalAlign: 'middle' }}>
                  {fmtLtp(cr.ceLtp)}
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-[9.5px] font-black tracking-wider uppercase sticky left-0 z-10" style={{ padding: '3px 8px', textAlign: 'right', border: `1px solid ${th.borderCell}`, position: 'sticky', bottom: 32, background: th.bgCell, color: isDark ? '#aa88ff' : '#7c3aed' }}>PE LTP</th>
              {ceRows.map(cr => {
                const peSym = strikeSymbolsRef.current.get(`${cr.strike}_PE`)
                const peData = peSym ? realtimeDataRef.current.get(`${peSym.exchange}:${peSym.symbol}`) : null
                const peLtp = peData?.ltp || 0
                return (
                  <td key={cr.strike} style={{ color: isDark ? '#aa88ff' : '#7c3aed', fontWeight: 800, fontSize: 11, background: th.bgCellAlt, position: 'sticky', bottom: 32, height: 32, border: `1px solid ${th.borderCell}`, textAlign: 'center', verticalAlign: 'middle' }}>
                    {fmtLtp(peLtp)}
                  </td>
                )
              })}
            </tr>
            <tr>
              <th className="text-[9.5px] font-black tracking-wider uppercase sticky left-0 z-10" style={{ padding: '3px 8px', textAlign: 'right', border: `1px solid ${th.borderCell}`, borderBottom: `1px solid ${isDark ? '#4a3818' : '#e5d5b0'}`, position: 'sticky', bottom: 0, background: th.bgCell, color: isDark ? '#ffcc66' : '#92400e' }}>Strike</th>
              {ceRows.map(cr => {
                const isAtm = atm && Math.abs(cr.strike - atm) < 0.5
                const isOpenAtm = oATM && Math.abs(cr.strike - oATM) < 0.5
                const isSpot = spotStrike != null && Math.abs(cr.strike - spotStrike) < 0.5
                let sColor = isDark ? '#ffcc66' : '#92400e'
                let sBg = th.bgCellAlt
                if (isAtm && isOpenAtm) { sColor = '#b6f0b6'; sBg = isDark ? 'linear-gradient(180deg,#1a3a1a,#0a200a)' : 'linear-gradient(180deg,#e8f5e8,#d0f0d0)' }
                else if (isAtm) { sColor = '#ffdd44'; sBg = isDark ? 'linear-gradient(180deg,#3a2a08,#1a1204)' : 'linear-gradient(180deg,#fef3c7,#fde68a)' }
                else if (isOpenAtm) { sColor = '#38d7e0'; sBg = isDark ? 'linear-gradient(180deg,#082a2e,#041a1d)' : 'linear-gradient(180deg,#cffafe,#a5f3fc)' }
                else if (isSpot) { sColor = '#ffcc88'; sBg = isDark ? 'linear-gradient(180deg,#2a1a04,#170e02)' : 'linear-gradient(180deg,#fff3e0,#ffe0b2)' }
                const marks: string[] = []
                if (isAtm) marks.push('⭐')
                if (isOpenAtm) marks.push('◆')
                if (isSpot) marks.push('●')
                return (
                  <td key={cr.strike} style={{ color: sColor, fontWeight: 800, fontSize: 11, background: sBg, position: 'sticky', bottom: 0, height: 32, border: `1px solid ${th.borderCell}`, textAlign: 'center', verticalAlign: 'middle', boxShadow: isSpot && !isAtm && !isOpenAtm ? `inset 3px 0 0 ${isDark ? '#ffaa44' : '#f59e0b'}, inset -3px 0 0 ${isDark ? '#ffaa44' : '#f59e0b'}` : undefined }}>
                    {fmtStrike(cr.strike)}{marks.length ? ' ' + marks.join('') : ''}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  const atm = matrixData?.ceRows?.length ? (() => {
    const spot = spotPriceRef.current
    const strikes = Array.from(new Set(matrixData.ceRows.map(r => r.strike).concat(matrixData.peRowsDisp.map(r => r.strike)))).sort((a, b) => a - b)
    return strikes.reduce((p, c) => Math.abs(c - spot) < Math.abs(p - spot) ? c : p, strikes[0])
  })() : 0

  return (
    <div className={`flex flex-col h-full madhan-theme ${isDark ? 'dark' : ''}`} style={{ fontFamily: 'Rajdhani,sans-serif', background: th.bg, color: th.text }}>
      {/* Header Row 1: Title + Index toggle + Expiry + Legend */}
      <div className="h-10 flex items-center px-3 gap-2 flex-shrink-0" style={{ background: th.bgHeader, borderBottom: `1px solid ${th.border}` }}>
        <span className="text-sm font-black tracking-widest text-white whitespace-nowrap" style={{ textShadow: '0 0 12px rgba(100,160,255,.4)' }}>
          ◈ CE<em className="text-[#ffdd44] not-italic mx-0.5">−</em>PE <span className="text-[#00dd6a]">+</span><span className="text-[#ff4a5d]">−</span> MATRIX
        </span>

        <div className="inline-flex rounded overflow-hidden h-6 ml-1" style={{ border: `1px solid ${th.borderControl}` }}>
          <button className={`px-2.5 text-[10px] font-black tracking-wider border-none cursor-pointer transition-all ${idx === 'NIFTY' ? '' : ''}`} style={{ fontFamily: 'Rajdhani,sans-serif', background: idx === 'NIFTY' ? th.bgBtnActive : th.bgInput, color: idx === 'NIFTY' ? th.textBtnActive : th.textSec }} onClick={() => setIdx('NIFTY')}>NIFTY</button>
          <button className={`px-2.5 text-[10px] font-black tracking-wider border-none cursor-pointer transition-all ${idx === 'BANKNIFTY' ? '' : ''}`} style={{ fontFamily: 'Rajdhani,sans-serif', background: idx === 'BANKNIFTY' ? th.bgBtnActive : th.bgInput, color: idx === 'BANKNIFTY' ? th.textBtnActive : th.textSec }} onClick={() => setIdx('BANKNIFTY')}>BANKNIFTY</button>
        </div>

        <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[rgba(255,221,68,.5)] bg-[rgba(255,221,68,.08)] text-[#ffdd44]" style={{ fontFamily: 'JetBrains Mono,monospace' }}>{chips.atm}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[rgba(56,215,224,.5)] bg-[rgba(56,215,224,.08)] text-[#38d7e0]" style={{ fontFamily: 'JetBrains Mono,monospace' }}>◆ {chips.openAtm}</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[rgba(255,170,68,.4)] bg-[rgba(255,170,68,.07)] text-[#ffaa44]" style={{ fontFamily: 'JetBrains Mono,monospace' }}>● {chips.spot}</span>

        <span className="text-[10px] font-extrabold tracking-wider uppercase ml-1" style={{ fontFamily: 'Rajdhani,sans-serif', color: th.textSec }}>Expiry</span>
        <select value={selectedExpiry} onChange={e => setSelectedExpiry(e.target.value)} className="rounded font-bold text-[10px] px-2 outline-none cursor-pointer h-6" style={{ fontFamily: 'JetBrains Mono,monospace', background: th.bgInput, border: th.inputBorder, color: th.text }}>
          {expiryList.map(exp => <option key={exp} value={exp}>{exp}</option>)}
        </select>

        <div className="flex-1" />

        <div className="flex gap-1.5 items-center">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#806020] bg-[rgba(255,221,68,.07)] text-[#ffdd44]" style={{ fontFamily: 'JetBrains Mono,monospace' }}>★ ATM</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#0a6d78] bg-[rgba(56,215,224,.07)] text-[#38d7e0]" style={{ fontFamily: 'JetBrains Mono,monospace' }}>◆ Open ATM</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#805020] bg-[rgba(255,170,68,.07)] text-[#ffaa44]" style={{ fontFamily: 'JetBrains Mono,monospace' }}>● Spot</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#008f42] bg-[rgba(0,190,80,.08)] text-[#00dd6a]" style={{ fontFamily: 'JetBrains Mono,monospace' }}>▲ CE &gt; PE</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#0a7fc0] bg-[rgba(40,170,240,.08)] text-[#38c4ff]" style={{ fontFamily: 'JetBrains Mono,monospace' }}>= EQUAL</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#a01828] bg-[rgba(220,40,60,.08)] text-[#ff4a5d]" style={{ fontFamily: 'JetBrains Mono,monospace' }}>▼ CE &lt; PE</span>
        </div>

        <div className={`w-2 h-2 rounded-full ml-1 ${wsStatus === 'connected' ? 'bg-[#00dd6a] shadow-[0_0_8px_#00dd6a]' : 'bg-[#ff4a5d] shadow-[0_0_8px_#ff4a5d]'}`} title={`WS: ${wsStatus}`} />
      </div>

      {/* Header Row 2: Controls */}
      <div className="h-8 flex items-center gap-2 px-3 flex-shrink-0 flex-wrap" style={{ background: th.bgControls, borderBottom: `1px solid ${th.border}` }}>
        <span className="text-[10px] font-extrabold tracking-wider uppercase" style={{ fontFamily: 'Rajdhani,sans-serif', color: th.textSec }}>CE cols</span>
        <input type="number" value={ceCount} min={3} max={25} onChange={e => setCeCount(Math.max(3, Math.min(25, parseInt(e.target.value) || 10)))} className="rounded font-bold text-[11px] px-2 py-0.5 w-12 text-center outline-none" style={{ fontFamily: 'JetBrains Mono,monospace', height: 24, background: th.bgInput, border: th.inputBorder, color: th.text }} />

        <span className="text-[10px] font-extrabold tracking-wider uppercase" style={{ fontFamily: 'Rajdhani,sans-serif', color: th.textSec }}>PE rows</span>
        <input type="number" value={peCount} min={3} max={25} onChange={e => setPeCount(Math.max(3, Math.min(25, parseInt(e.target.value) || 10)))} className="rounded font-bold text-[11px] px-2 py-0.5 w-12 text-center outline-none" style={{ fontFamily: 'JetBrains Mono,monospace', height: 24, background: th.bgInput, border: th.inputBorder, color: th.text }} />

        <span className="text-[10px] font-extrabold tracking-wider uppercase ml-1" style={{ fontFamily: 'Rajdhani,sans-serif', color: th.textSec }}>Timer</span>
        <div className="inline-flex rounded overflow-hidden h-6" style={{ border: `1px solid ${th.borderControl}` }}>
          <button className="px-2.5 text-[10px] font-black tracking-wider border-none cursor-pointer transition-all" style={{ fontFamily: 'Rajdhani,sans-serif', background: timerMode === 'on' ? th.bgBtnActive : th.bgInput, color: timerMode === 'on' ? th.textBtnActive : th.textSec }} onClick={() => setTimerMode('on')}>On</button>
          <button className="px-2.5 text-[10px] font-black tracking-wider border-none cursor-pointer transition-all" style={{ fontFamily: 'Rajdhani,sans-serif', background: timerMode === 'off' ? th.bgBtnActive : th.bgInput, color: timerMode === 'off' ? th.textBtnActive : th.textSec }} onClick={() => setTimerMode('off')}>Off</button>
        </div>

        <button className="px-2.5 h-6 text-[10px] font-black tracking-wider rounded cursor-pointer transition-all whitespace-nowrap inline-flex items-center gap-1" style={{ fontFamily: 'Rajdhani,sans-serif', background: paused ? 'rgba(255,74,93,.15)' : 'rgba(255,221,68,.1)', border: paused ? '1px solid #a01828' : '1px solid #a58000', color: paused ? '#ff4a5d' : '#ffdd44' }} onClick={() => setPaused(!paused)}>
          {paused ? '▶ RESUME' : '⏸ PAUSE'}
        </button>
        <button className="px-2.5 h-6 text-[10px] font-black tracking-wider rounded cursor-pointer transition-all whitespace-nowrap inline-flex items-center gap-1" style={{ fontFamily: 'Rajdhani,sans-serif', background: 'rgba(100,120,200,.08)', border: '1px solid #4466aa', color: '#88aadd' }} onClick={resetTimers}>↻ RESET</button>

        <div className="inline-flex rounded overflow-hidden h-6" style={{ border: `1px solid ${th.borderControl}` }} title="Alerts">
          <button className="px-2.5 text-[10px] font-black tracking-wider border-none cursor-pointer transition-all" style={{ fontFamily: 'Rajdhani,sans-serif', background: alertsEnabled ? th.bgBtnActive : th.bgInput, color: alertsEnabled ? th.textBtnActive : th.textSec }} onClick={() => setAlertsEnabled(true)}>🔔</button>
          <button className="px-2.5 text-[10px] font-black tracking-wider border-none cursor-pointer transition-all" style={{ fontFamily: 'Rajdhani,sans-serif', background: !alertsEnabled ? th.bgBtnActive : th.bgInput, color: !alertsEnabled ? th.textBtnActive : th.textSec }} onClick={() => setAlertsEnabled(false)}>Off</button>
        </div>

        <div className="inline-flex rounded overflow-hidden h-6" style={{ border: `1px solid ${th.borderControl}` }} title="Sound">
          <button className="px-2.5 text-[10px] font-black tracking-wider border-none cursor-pointer transition-all" style={{ fontFamily: 'Rajdhani,sans-serif', background: alertSoundEnabled ? th.bgBtnActive : th.bgInput, color: alertSoundEnabled ? th.textBtnActive : th.textSec }} onClick={() => setAlertSoundEnabled(true)}>🔊</button>
          <button className="px-2.5 text-[10px] font-black tracking-wider border-none cursor-pointer transition-all" style={{ fontFamily: 'Rajdhani,sans-serif', background: !alertSoundEnabled ? th.bgBtnActive : th.bgInput, color: !alertSoundEnabled ? th.textBtnActive : th.textSec }} onClick={() => setAlertSoundEnabled(false)}>🔇</button>
        </div>

        <span className="text-[10px] font-extrabold tracking-wider uppercase" style={{ fontFamily: 'Rajdhani,sans-serif', color: th.textSec }}>Hold ≥</span>
        <input type="number" value={holdSec} min={5} max={600} step={5} onChange={e => setHoldSec(Math.max(5, parseInt(e.target.value) || 60))} className="rounded font-bold text-[11px] px-2 py-0.5 w-12 text-center outline-none" style={{ fontFamily: 'JetBrains Mono,monospace', height: 24, background: th.bgInput, border: th.inputBorder, color: th.text }} />
        <span className="text-[9px]" style={{ fontFamily: 'JetBrains Mono,monospace', color: th.textMuted }}>s</span>

        {wsStatus !== 'connected' && (
          <button className="px-2.5 h-6 text-[10px] font-black tracking-wider rounded cursor-pointer transition-all whitespace-nowrap inline-flex items-center gap-1 ml-auto" style={{ fontFamily: 'Rajdhani,sans-serif', background: 'rgba(0,220,100,.1)', border: '1px solid #008f42', color: '#00dd6a' }} onClick={connect}>↻ RECONNECT</button>
        )}

        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded ml-auto" style={{ fontFamily: 'JetBrains Mono,monospace', border: '1px solid #008f42', background: 'rgba(0,190,80,.08)', color: '#00dd6a' }}>MAX +<b className="font-extrabold ml-0.5" style={{ color: th.textWhite }}>{stats.maxPos}</b></span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono,monospace', border: '1px solid #a01828', background: 'rgba(220,40,60,.08)', color: '#ff4a5d' }}>MAX −<b className="font-extrabold ml-0.5" style={{ color: th.textWhite }}>{stats.maxNeg}</b></span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono,monospace', border: `1px solid ${th.borderControl}`, background: isDark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.03)', color: th.textSec }}>+<b className="font-extrabold ml-0.5" style={{ color: th.textWhite }}>{stats.pCount}</b></span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono,monospace', border: `1px solid ${th.borderControl}`, background: isDark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.03)', color: th.textSec }}>−<b className="font-extrabold ml-0.5" style={{ color: th.textWhite }}>{stats.nCount}</b></span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono,monospace', border: `1px solid ${th.borderControl}`, background: isDark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.03)', color: th.textSec }}>CE<b className="font-extrabold ml-0.5" style={{ color: th.textWhite }}>{stats.ceRange}</b></span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ fontFamily: 'JetBrains Mono,monospace', border: `1px solid ${th.borderControl}`, background: isDark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.03)', color: th.textSec }}>PE<b className="font-extrabold ml-0.5" style={{ color: th.textWhite }}>{stats.peRange}</b></span>
      </div>

      {renderTable()}
    </div>
  )
}
