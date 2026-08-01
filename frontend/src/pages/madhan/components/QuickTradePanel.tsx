import { useState, useEffect, useCallback, useRef } from 'react'
import { Minus, Square, X, GripVertical } from 'lucide-react'
import { useMadhanTheme } from '../useMadhanTheme'
import { chartTheme } from '../chartTheme'
import type { PlaceOrderRequest } from '@/types/trading'

const LOT_SIZE = 65
const PRICE_TYPES = ['MARKET', 'LIMIT', 'SL', 'SL-M'] as const
const PRODUCTS = ['MIS', 'NRML'] as const

interface QuickTradePanelProps {
  ceSymbol: string
  peSymbol: string
  ceLtp: number
  peLtp: number
  onPlaceOrder: (req: PlaceOrderRequest) => void
  isPlacing: boolean
  orderStatus?: 'idle' | 'placing' | 'executing'
  clickSide?: 'CE' | 'PE'
  clickPrice?: number
}

function loadPos() {
  try {
    const v = localStorage.getItem('ezay_tradePanelPos')
    if (v) {
      const p = JSON.parse(v) as { x: number; y: number }
      if (p.x > -100 && p.y > 0) return p
    }
  } catch {}
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200
  return { x: Math.max(10, w - 380), y: 80 }
}

export default function QuickTradePanel({
  ceSymbol,
  peSymbol,
  ceLtp,
  peLtp,
  onPlaceOrder,
  isPlacing,
  orderStatus = 'idle',
  clickSide,
  clickPrice,
}: QuickTradePanelProps) {
  const { mode } = useMadhanTheme()
  const t = chartTheme[mode]

  const [side, setSide] = useState<'CE' | 'PE'>('CE')
  const [action, setAction] = useState<'BUY' | 'SELL'>('BUY')
  const [lots, setLots] = useState(1)
  const [price, setPrice] = useState(0)
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'SL' | 'SL-M'>('MARKET')
  const [triggerPrice, setTriggerPrice] = useState(0)
  const [product, setProduct] = useState<'MIS' | 'NRML'>('MIS')
  const [minimized, setMinimized] = useState(false)
  const [visible, setVisible] = useState(true)
  const [orderError, setOrderError] = useState('')

  const [pos, setPos] = useState(loadPos)

  const ltp = side === 'CE' ? ceLtp : peLtp
  const symbol = side === 'CE' ? ceSymbol : peSymbol
  const qty = lots * LOT_SIZE
  const amount = qty * ltp

  useEffect(() => {
    if (ltp > 0 && price === 0) setPrice(Math.round(ltp * 20) / 20)
  }, [ltp])

  useEffect(() => {
    setPrice(0)
  }, [side])

  const prevStatusRef = useRef(orderStatus)
  useEffect(() => {
    if (prevStatusRef.current !== 'idle' && orderStatus === 'idle') {
      setAction('BUY')
      setOrderType('MARKET')
      setProduct('MIS')
      setOrderError('')
    }
    prevStatusRef.current = orderStatus
  }, [orderStatus])

  useEffect(() => {
    try { localStorage.setItem('ezay_tradePanelPos', JSON.stringify(pos)) } catch {}
  }, [pos])

  useEffect(() => {
    if (clickSide) setSide(clickSide)
  }, [clickSide])

  useEffect(() => {
    if (clickPrice && clickPrice > 0) setPrice(clickPrice)
  }, [clickPrice])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX - pos.x
    const startY = e.clientY - pos.y
    const onMove = (me: MouseEvent) => {
      setPos({ x: me.clientX - startX, y: me.clientY - startY })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pos.x, pos.y])

  const round005 = (v: number, up: boolean) => {
    const step = 0.05
    const rounded = up ? Math.ceil(v / step) * step : Math.floor(v / step) * step
    return Math.round(rounded * 100) / 100
  }

  const handleTriggerChange = (val: number) => {
    setTriggerPrice(val)
    if (orderType === 'SL' && val > 0) {
      setPrice(action === 'BUY'
        ? round005(val + 0.05, true)
        : round005(val - 0.05, false))
    }
  }

  const handlePriceChange = (val: number) => {
    setPrice(val)
    if (orderType === 'SL' && val > 0) {
      setTriggerPrice(action === 'BUY'
        ? round005(val - 0.05, false)
        : round005(val + 0.05, true))
    }
  }

  const handlePlace = () => {
    if (!symbol || qty <= 0) return
    setOrderError('')
    const needsPrice = orderType === 'LIMIT' || orderType === 'SL'
    const needsTrigger = orderType === 'SL-M' || orderType === 'SL'
    if (ltp <= 0) { setOrderError('LTP not available'); return }
    if (needsPrice && price <= 0) { setOrderError('Enter price'); return }
    if (needsTrigger && triggerPrice <= 0) { setOrderError('Enter trigger price'); return }
    if (orderType === 'LIMIT') {
      if (action === 'BUY' && price > ltp) { setOrderError('Buy limit must be <= LTP'); return }
      if (action === 'SELL' && price < ltp) { setOrderError('Sell limit must be >= LTP'); return }
    }
    if (orderType === 'SL') {
      if (action === 'BUY' && triggerPrice < ltp) { setOrderError('Buy SL trigger must be >= LTP'); return }
      if (action === 'SELL' && triggerPrice > ltp) { setOrderError('Sell SL trigger must be <= LTP'); return }
      const diff = Math.abs(price - triggerPrice)
      if (diff < 0.04) { setOrderError('Price & trigger must differ by >= 0.05'); return }
    }
    if (orderType === 'SL-M') {
      if (action === 'BUY' && triggerPrice < ltp) { setOrderError('Buy SL-M trigger must be >= LTP'); return }
      if (action === 'SELL' && triggerPrice > ltp) { setOrderError('Sell SL-M trigger must be <= LTP'); return }
    }
    onPlaceOrder({
      apikey: '',
      strategy: 'QuickTrade',
      exchange: 'NFO',
      symbol,
      action,
      quantity: qty,
      pricetype: orderType,
      product,
      ...(needsPrice && { price }),
      ...(needsTrigger && { trigger_price: triggerPrice }),
    })
  }

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="absolute z-50 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold cursor-pointer select-none"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          backgroundColor: mode === 'dark' ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
          border: `1px solid ${t.border}`,
          color: t.text,
        }}
      >
        <GripVertical className="h-3 w-3" style={{ color: t.textSecondary }} />
        Trade
      </button>
    )
  }

  if (minimized) {
    return (
      <div
        className="absolute z-50 flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-semibold select-none"
        style={{
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          backgroundColor: mode === 'dark' ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
          border: `1px solid ${t.border}`,
          color: t.text,
        }}
      >
        <span
          onMouseDown={handleDragStart}
          className="cursor-grab active:cursor-grabbing flex items-center"
          style={{ color: t.textSecondary }}
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <span style={{ color: side === 'CE' ? '#00C851' : '#E040FB' }}>{side}</span>
        <span style={{ color: action === 'BUY' ? '#22c55e' : '#ef4444' }}>{action}</span>
        <span style={{ color: t.textSecondary }}>{lots}L</span>
        <button onClick={() => setMinimized(false)} className="hover:opacity-70" title="Expand">
          <Square className="h-4 w-4" style={{ color: t.textSecondary }} />
        </button>
        <button onClick={() => setVisible(false)} className="hover:opacity-70" title="Hide">
          <X className="h-4 w-4" style={{ color: t.textSecondary }} />
        </button>
      </div>
    )
  }

  const showTrigger = orderType === 'SL' || orderType === 'SL-M'
  const showPrice = orderType === 'LIMIT' || orderType === 'SL'

  return (
    <div
      className="absolute z-50 rounded-md text-[12px] select-none"
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        backgroundColor: mode === 'dark' ? 'rgba(20,20,20,0.97)' : 'rgba(255,255,255,0.97)',
        border: `1px solid ${t.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {/* Header / drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 px-3 py-1.5 cursor-grab active:cursor-grabbing rounded-t"
        style={{
          borderBottom: `1px solid ${t.border}`,
          backgroundColor: mode === 'dark'
            ? (side === 'CE' ? 'rgba(0,200,81,0.15)' : 'rgba(224,64,251,0.15)')
            : (side === 'CE' ? 'rgba(0,200,81,0.1)' : 'rgba(224,64,251,0.1)'),
        }}
      >
        <GripVertical className="h-4 w-4" style={{ color: t.textSecondary }} />
        <span className="font-semibold text-[11px]" style={{ color: t.text }}>Quick Trade</span>
        <span className="text-[10px] ml-1" style={{ color: t.textSecondary }}>{symbol}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setMinimized(true)} className="hover:opacity-70" title="Minimize">
            <Minus className="h-4 w-4" style={{ color: t.textSecondary }} />
          </button>
          <button onClick={() => setVisible(false)} className="hover:opacity-70" title="Hide">
            <X className="h-4 w-4" style={{ color: t.textSecondary }} />
          </button>
        </div>
      </div>

      {/* Row 1: CE/PE, BUY/SELL, Product, Order Type, Price/Trigger */}
      <div className="px-2.5 py-2 flex flex-wrap items-center gap-2">
        <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${t.border}` }}>
          <button
            onClick={() => setSide('CE')}
            className="px-2.5 py-1 text-[11px] font-semibold transition-colors"
            style={{
              backgroundColor: side === 'CE' ? '#00C851' : 'transparent',
              color: side === 'CE' ? '#fff' : '#00C851',
            }}
          >CE</button>
          <button
            onClick={() => setSide('PE')}
            className="px-2.5 py-1 text-[11px] font-semibold transition-colors"
            style={{
              backgroundColor: side === 'PE' ? '#E040FB' : 'transparent',
              color: side === 'PE' ? '#fff' : '#E040FB',
            }}
          >PE</button>
        </div>

        <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${t.border}` }}>
          <button
            onClick={() => setAction('BUY')}
            className="px-2.5 py-1 text-[11px] font-semibold transition-colors"
            style={{
              backgroundColor: action === 'BUY' ? '#22c55e' : 'transparent',
              color: action === 'BUY' ? '#fff' : '#22c55e',
            }}
          >BUY</button>
          <button
            onClick={() => setAction('SELL')}
            className="px-2.5 py-1 text-[11px] font-semibold transition-colors"
            style={{
              backgroundColor: action === 'SELL' ? '#ef4444' : 'transparent',
              color: action === 'SELL' ? '#fff' : '#ef4444',
            }}
          >SELL</button>
        </div>

        <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${t.border}` }}>
          {PRODUCTS.map((p) => (
            <button
              key={p}
              onClick={() => setProduct(p)}
              className="px-2 py-1 text-[10px] font-semibold transition-colors"
              style={{
                backgroundColor: product === p ? (mode === 'dark' ? '#555' : '#ddd') : 'transparent',
                color: t.text,
              }}
            >{p}</button>
          ))}
        </div>

        <select
          value={orderType}
          onChange={(e) => setOrderType(e.target.value as typeof orderType)}
          className="px-1.5 py-1 text-[11px] rounded outline-none cursor-pointer"
          style={{
            backgroundColor: mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
            border: `1px solid ${t.border}`,
            color: t.text,
          }}
        >
          {PRICE_TYPES.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
        </select>

        {showPrice && (
          <input
            type="number"
            value={price}
            step={0.05}
            onChange={(e) => handlePriceChange(parseFloat(e.target.value) || 0)}
            className="w-20 px-1.5 py-1 text-center text-[12px] font-mono rounded outline-none"
            style={{
              backgroundColor: mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
              border: `1px solid ${t.border}`,
              color: t.text,
            }}
            title="Limit Price"
          />
        )}

        {showTrigger && (
          <input
            type="number"
            value={triggerPrice}
            step={0.05}
            onChange={(e) => handleTriggerChange(parseFloat(e.target.value) || 0)}
            className="w-20 px-1.5 py-1 text-center text-[12px] font-mono rounded outline-none"
            style={{
              backgroundColor: mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
              border: `1px solid ${t.border}`,
              color: t.text,
            }}
            title="Trigger Price"
          />
        )}
      </div>

      {/* Row 2: Lots, Qty, LTP, Amount, Place */}
      <div className="px-2.5 pb-2 flex items-center gap-2" style={{ borderTop: `1px solid ${t.border}` }}>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={lots}
            min={1}
            onChange={(e) => setLots(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-12 px-1.5 py-1 text-center text-[12px] font-mono rounded outline-none"
            style={{
              backgroundColor: mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
              border: `1px solid ${t.border}`,
              color: t.text,
            }}
          />
          <span className="text-[10px] whitespace-nowrap" style={{ color: t.text }}>lots</span>
        </div>

        <span className="text-[11px] font-mono font-semibold" style={{ color: t.text }}>
          Qty {qty}
        </span>
        {ltp > 0 && (
          <span className="text-[11px] font-mono font-semibold" style={{ color: t.text }}>
            LTP {ltp.toFixed(2)}
          </span>
        )}
        <span className="text-[11px] font-mono font-semibold" style={{ color: t.text }}>
          ₹{amount > 0 ? amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '0'}
        </span>

        {orderError && (
          <span className="text-[10px] font-semibold" style={{ color: '#ef4444' }}>
            {orderError}
          </span>
        )}

        <button
          onClick={handlePlace}
          disabled={isPlacing || !symbol || qty <= 0}
          className="ml-auto px-4 py-1.5 text-[12px] font-bold rounded transition-colors disabled:opacity-40"
          style={{
            backgroundColor: orderStatus === 'executing' ? '#f59e0b' : action === 'BUY' ? '#22c55e' : '#ef4444',
            color: '#fff',
          }}
        >
          {orderStatus === 'placing' ? 'Placing...' : orderStatus === 'executing' ? 'Executing...' : `${action} ${side}`}
        </button>
      </div>
    </div>
  )
}
