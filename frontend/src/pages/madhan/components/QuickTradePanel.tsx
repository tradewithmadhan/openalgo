import { useState, useEffect, useCallback, useRef } from 'react'
import { Minus, Square, X, GripVertical } from 'lucide-react'
import { useThemeStore } from '@/stores/themeStore'
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
  clickSide?: 'CE' | 'PE'
  clickPrice?: number
}

function loadPos() {
  try {
    const v = localStorage.getItem('ezay_tradePanelPos')
    if (v) return JSON.parse(v) as { x: number; y: number }
  } catch {}
  return { x: -1, y: 80 }
}

export default function QuickTradePanel({
  ceSymbol,
  peSymbol,
  ceLtp,
  peLtp,
  onPlaceOrder,
  isPlacing,
  clickSide,
  clickPrice,
}: QuickTradePanelProps) {
  const { mode } = useThemeStore()
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

  const [pos, setPos] = useState(loadPos)
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)

  const ltp = side === 'CE' ? ceLtp : peLtp
  const symbol = side === 'CE' ? ceSymbol : peSymbol
  const qty = lots * LOT_SIZE
  const amount = qty * ltp

  useEffect(() => {
    if (ltp > 0 && price === 0) setPrice(Math.round(ltp * 20) / 20)
  }, [ltp])

  useEffect(() => {
    if (ceLtp > 0 && side === 'CE') setPrice(Math.round(ceLtp * 20) / 20)
    else if (peLtp > 0 && side === 'PE') setPrice(Math.round(peLtp * 20) / 20)
  }, [ceLtp, peLtp, side])

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
    dragRef.current = { startX: e.clientX - pos.x, startY: e.clientY - pos.y }
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      setPos({ x: me.clientX - dragRef.current.startX, y: me.clientY - dragRef.current.startY })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [pos])

  const handlePlace = () => {
    if (!symbol || qty <= 0) return
    const needsPrice = orderType === 'LIMIT' || orderType === 'SL'
    const needsTrigger = orderType === 'SL-M' || orderType === 'SL'
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
          top: pos.y,
          left: pos.x < 0 ? undefined : pos.x,
          right: pos.x < 0 ? 10 : undefined,
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
        className="absolute z-50 flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold select-none"
        style={{
          top: pos.y,
          left: pos.x < 0 ? undefined : pos.x,
          right: pos.x < 0 ? 10 : undefined,
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
          <GripVertical className="h-3 w-3" />
        </span>
        <span style={{ color: side === 'CE' ? '#00C851' : '#E040FB' }}>{side}</span>
        <span style={{ color: action === 'BUY' ? '#22c55e' : '#ef4444' }}>{action}</span>
        <span style={{ color: t.textSecondary }}>{lots}L</span>
        <button onClick={() => setMinimized(false)} className="hover:opacity-70" title="Expand">
          <Square className="h-3 w-3" style={{ color: t.textSecondary }} />
        </button>
        <button onClick={() => setVisible(false)} className="hover:opacity-70" title="Hide">
          <X className="h-3 w-3" style={{ color: t.textSecondary }} />
        </button>
      </div>
    )
  }

  const showTrigger = orderType === 'SL' || orderType === 'SL-M'
  const showPrice = orderType === 'LIMIT' || orderType === 'SL'

  return (
    <div
      className="absolute z-50 rounded-md text-[11px] select-none"
      style={{
        top: pos.y,
        left: pos.x < 0 ? undefined : pos.x,
        right: pos.x < 0 ? 10 : undefined,
        backgroundColor: mode === 'dark' ? 'rgba(20,20,20,0.97)' : 'rgba(255,255,255,0.97)',
        border: `1px solid ${t.border}`,
        minWidth: 340,
      }}
    >
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-1.5 px-2 py-1 cursor-grab active:cursor-grabbing rounded-t"
        style={{ borderBottom: `1px solid ${t.border}`, backgroundColor: mode === 'dark' ? 'rgba(40,40,40,0.9)' : 'rgba(240,240,240,0.9)' }}
      >
        <GripVertical className="h-3 w-3" style={{ color: t.textSecondary }} />
        <span className="font-semibold text-[10px]" style={{ color: t.text }}>Quick Trade</span>
        <span className="text-[9px] ml-1" style={{ color: t.textSecondary }}>{symbol}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setMinimized(true)} className="hover:opacity-70" title="Minimize">
            <Minus className="h-3 w-3" style={{ color: t.textSecondary }} />
          </button>
          <button onClick={() => setVisible(false)} className="hover:opacity-70" title="Hide">
            <X className="h-3 w-3" style={{ color: t.textSecondary }} />
          </button>
        </div>
      </div>

      <div className="px-2 py-1.5 flex flex-wrap items-center gap-1.5">
        <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${t.border}` }}>
          <button
            onClick={() => setSide('CE')}
            className="px-2 py-0.5 text-[10px] font-semibold transition-colors"
            style={{
              backgroundColor: side === 'CE' ? '#00C851' : 'transparent',
              color: side === 'CE' ? '#fff' : '#00C851',
            }}
          >CE</button>
          <button
            onClick={() => setSide('PE')}
            className="px-2 py-0.5 text-[10px] font-semibold transition-colors"
            style={{
              backgroundColor: side === 'PE' ? '#E040FB' : 'transparent',
              color: side === 'PE' ? '#fff' : '#E040FB',
            }}
          >PE</button>
        </div>

        <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${t.border}` }}>
          <button
            onClick={() => setAction('BUY')}
            className="px-2 py-0.5 text-[10px] font-semibold transition-colors"
            style={{
              backgroundColor: action === 'BUY' ? '#22c55e' : 'transparent',
              color: action === 'BUY' ? '#fff' : '#22c55e',
            }}
          >BUY</button>
          <button
            onClick={() => setAction('SELL')}
            className="px-2 py-0.5 text-[10px] font-semibold transition-colors"
            style={{
              backgroundColor: action === 'SELL' ? '#ef4444' : 'transparent',
              color: action === 'SELL' ? '#fff' : '#ef4444',
            }}
          >SELL</button>
        </div>

        <div className="flex items-center gap-1">
          <input
            type="number"
            value={lots}
            min={1}
            onChange={(e) => setLots(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-10 px-1 py-0.5 text-center text-[11px] font-mono rounded outline-none"
            style={{
              backgroundColor: mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
              border: `1px solid ${t.border}`,
              color: t.text,
            }}
          />
          <span className="text-[9px] whitespace-nowrap" style={{ color: t.textSecondary }}>
            lots = {qty} qty
          </span>
        </div>

        {ltp > 0 && (
          <span className="text-[10px] font-mono" style={{ color: t.textSecondary }}>
            LTP {ltp.toFixed(2)}
          </span>
        )}

        <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${t.border}` }}>
          {PRODUCTS.map((p) => (
            <button
              key={p}
              onClick={() => setProduct(p)}
              className="px-1.5 py-0.5 text-[9px] font-semibold transition-colors"
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
          className="px-1 py-0.5 text-[10px] rounded outline-none cursor-pointer"
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
            onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
            className="w-16 px-1 py-0.5 text-center text-[11px] font-mono rounded outline-none"
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
            onChange={(e) => setTriggerPrice(parseFloat(e.target.value) || 0)}
            className="w-16 px-1 py-0.5 text-center text-[11px] font-mono rounded outline-none"
            style={{
              backgroundColor: mode === 'dark' ? '#1a1a1a' : '#f5f5f5',
              border: `1px solid ${t.border}`,
              color: t.text,
            }}
            title="Trigger Price"
          />
        )}
      </div>

      <div className="px-2 pb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-mono" style={{ color: t.textSecondary }}>
          Amt: ₹{amount > 0 ? amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '0'}
        </span>
        <button
          onClick={handlePlace}
          disabled={isPlacing || !symbol || qty <= 0}
          className="ml-auto px-3 py-1 text-[11px] font-bold rounded transition-colors disabled:opacity-40"
          style={{
            backgroundColor: action === 'BUY' ? '#22c55e' : '#ef4444',
            color: '#fff',
          }}
        >
          {isPlacing ? 'Placing...' : `${action} ${side}`}
        </button>
      </div>
    </div>
  )
}
