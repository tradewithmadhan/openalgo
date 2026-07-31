# Position & Order Lines on EzayChart

## Overview
Display open positions and pending orders (LIMIT / SL / SL-M) as horizontal lines with pill labels directly on the EzayChart lightweight-charts v5 canvas. Lines are drawn using custom primitives attached to the CE/PE series. Includes a Quick Trade Panel for placing orders directly from the chart.

---

## Phase 2: Interactive Position & Order Lines (COMPLETED)

### What Was Built

#### Position Lines — Close from Chart
- **Close button (×)**: Clicking × on a position line closes the position immediately
  - Calls `tradingApi.closePosition(symbol, exchange, product)` → `POST /close_position`
  - Optimistic UI: hides line immediately, refreshes positions on success or failure
  - `mousedown` handler on the × fires `_onClose` directly (no coordinate mismatch)
- **Cursor feedback**: `pointer` cursor + tooltip "Close SYMBOL position" on hover
- **Data**: `PositionDatum` includes `exchange` and `product` fields for the close API call

#### Order Lines — Cancel & Drag-to-Modify
- **Cancel button (×)**: Clicking × on an order line cancels the order immediately
  - Calls `tradingApi.cancelOrder(orderId)` → `POST /cancel_order`
  - Optimistic UI: hides line immediately, refreshes orders on success or failure
  - `mousedown` handler on the × fires `_onClose` directly
- **Drag to modify price**: Dragging a pill horizontally changes the order price
  - `mousedown` on pill body → `mousemove` tracks vertical position via `coordinateToPrice()` → `mouseup` calls `handleModifyOrder(orderId, newPrice)` via `tradingApi.modifyOrder()`
  - Chart scroll disabled during drag (`handleScroll: false`)
  - Visual feedback: ghost dashed line at original price, bold line at dragged position, yellow `@ newPrice` text
  - Cursor: `grab` on hover, `grabbing` during drag
- **SL order price rounding**: Trigger and limit price differ by min 0.05, rounded to nearest 0.05 step
  - BUY SL: `ceil((trigger + 0.05) / 0.05) * 0.05` (limit above trigger)
  - SELL SL: `floor((trigger - 0.05) / 0.05) * 0.05` (limit below trigger)
- **Cursor feedback**: `grab` cursor + tooltip "Drag to modify price" on pill hover; `pointer` + "Cancel order..." on × hover
- **Data**: `OrderLineDatum` includes `exchange`, `product`, and `action` fields for the modify API call

#### Symbol Matching — Robust Cross-Broker Support
- **Problem**: Fyers broker returns symbols with exchange prefix (e.g. `NSE:NIFTY25JUL25000CE`) while `ceSymbolRef` stores just `NIFTY25JUL25000CE`
- **Solution**: `matchSym()` helper in both `fetchPositions` and `fetchOrders`:
  ```
  matchSym(a, b) → a === b || a.endsWith(b) || b.endsWith(a) || a.replace(/^.*:/, '') === b.replace(/^.*:/, '')
  ```
- **Applied to**: Position matching, order matching, order CE/PE type detection

#### Order Status Polling — Type-Aware
- **MARKET orders**: Poll until `complete`, then fetch positions with retries (1.5s, 3.5s delays)
- **LIMIT / SL / SL-M orders**: Only check that order is `open` or `pending` (placed successfully), then stop polling. These orders wait for price to reach trigger, so no execution polling.
- **Rejected/cancelled**: Stop polling immediately, refresh orders

#### Position Refresh After Trade
- After any order completes/rejects/cancels, positions are fetched with retries:
  - Immediate fetch
  - `setTimeout(fetchPositions, 1500)`
  - `setTimeout(fetchPositions, 3500)`
  - `setTimeout(fetchOrders, 1500)`
- Handles broker API delay between order fill and position book update

### Hit Detection — Cached Hit Areas
- **Root cause of × misalignment**: `_getOrderPillRect` / `_getPillRect` recalculated pill geometry via `ctx.measureText()` outside the render callback. The canvas context state inside `useMediaCoordinateSpace` differs from event handlers, causing the recalculated × position to shift from the rendered ×.
- **Fix**: Both primitives cache the actual rendered pixel positions (`closeX`, `pillLeft`, `pillRight`, `pillY`, `pillH`, `y`) during `draw()` into a `_hitAreas` Map. Hit tests (`_hitTestCloseBtn`, `_hitTestPill`) use these cached values directly — zero recalculation, zero mismatch.
- **Removed**: `_getOrderPillRect()` and `_getPillRect()` methods (no longer needed)

#### Stale Closure Fix
- `subscribeClick` handler and primitive constructors delegate to refs (`handleClosePositionRef`, `handleCancelOrderRef`, `handleModifyOrderRef`) to avoid stale closure issues
- Refs updated after each `useCallback` definition

#### Order Line Price Display
- **SL/SL-M orders**: `ord.price` set to trigger price (line positioned at trigger level)
- **LIMIT orders**: `ord.price` set to limit price

---

## Quick Trade Panel (COMPLETED)

### Overview
A compact, draggable floating panel on the EzayChart for placing orders directly from the chart. Integrates with the chart click handler to auto-select CE/PE and fill price.

### Layout
```
┌─────────────────────────────────────────────────┐
│ ≡ Quick Trade  NIFTY25JUL25000CE       ─  □    │  ← Header (CE=green tint, PE=purple tint)
├─────────────────────────────────────────────────┤
│ [CE] [PE]  [BUY] [SELL]  [MIS] [NRML]  MARKET  │  ← Row 1: toggles, product, order type
│              ↓                                   │
│ (Price input if LIMIT/SL)                       │
├─────────────────────────────────────────────────┤
│ [1] lots  Qty 65  LTP 97.75  ₹6,354  [BUY CE] │  ← Row 2: qty, LTP, amount, place
└─────────────────────────────────────────────────┘
```

### Row Contents
| Row 1 | Row 2 |
|-------|-------|
| CE/PE toggle | Lots input |
| BUY/SELL toggle | Qty (= lots × 65) |
| MIS/NRML toggle | LTP (real-time) |
| Order Type dropdown (MARKET/LIMIT/SL/SL-M) | Amount (qty × LTP) |
| Price input (if LIMIT/SL) | Order Error (if any) |
| Trigger Price input (if SL/SL-M) | Place button |

### Chart Click Integration
- Clicking on the chart determines if click is closer to CE or PE line
- Sets `tradePanelSide` to CE or PE accordingly
- Sets `tradePanelPrice` to the price level clicked (rounded to 0.05)
- QuickTradePanel auto-updates side and price from these props

### Position Persistence
- Panel position stored in `localStorage` key `ezay_tradePanelPos`
- Default position: right side of screen (`window.innerWidth - 380`, 80px from top)
- Validated on load: ignores positions with `x < -100` (old right-anchored positions)

### Free 2D Drag
- Uses `transform: translate(x, y)` instead of `top`/`left`/`right` positioning
- Handles both X and Y mouse movement simultaneously
- Saves position to localStorage on every move

### Theme Support
- Header tint: light green for CE, light purple for PE (adapts to dark/light mode)
- All text uses `t.text` (theme-aware) for Qty, LTP, Amount, lots label
- Background, borders, inputs all follow `chartTheme[mode]`

### State Reset After Trade
- After every trade completes/rejects/cancels:
  - **Reset**: action → BUY, orderType → MARKET, product → MIS
  - **Remember**: CE/PE side and lots (not reset)
- Uses `orderStatus` transition detection (non-idle → idle)

### Price Auto-Fill
- Price auto-fills with LTP **once** when CE/PE side is switched (resets price to 0)
- Does NOT continuously overwrite with live LTP (removed tick-by-tick update)
- User can type any price without it being overwritten

---

## Order Validation Rules

### LIMIT Orders

| Action | Rule | Error Message |
|--------|------|---------------|
| BUY LIMIT | price ≤ LTP | "Buy limit must be <= LTP" |
| SELL LIMIT | price ≥ LTP | "Sell limit must be >= LTP" |

**Rationale**: BUY at a lower price (value), SELL at a higher price (profit).

### SL Orders (Stop Loss)

| Action | Trigger Rule | Error Message |
|--------|-------------|---------------|
| BUY SL | trigger ≥ LTP | "Buy SL trigger must be >= LTP" |
| SELL SL | trigger ≤ LTP | "Sell SL trigger must be <= LTP" |

**Rationale**:
- **BUY SL** (stop loss for short position): triggers when price rises above trigger → trigger must be ≥ LTP
- **SELL SL** (stop loss for long position): triggers when price drops below trigger → trigger must be ≤ LTP

#### SL Price/Trigger Auto-Adjustment (0.05 Gap)
For SL orders, price and trigger automatically maintain a 0.05 minimum gap:
- **When trigger changes**: price auto-adjusts
- **When price changes**: trigger auto-adjusts

| Action | Limit Price | Formula |
|--------|------------|---------|
| BUY SL | limit = trigger + 0.05 | `ceil((trigger + 0.05) / 0.05) * 0.05` |
| SELL SL | limit = trigger - 0.05 | `floor((trigger - 0.05) / 0.05) * 0.05` |

**Validation**: Blocks if `|price - triggerPrice| < 0.04` with error "Price & trigger must differ by >= 0.05"

### SL-M Orders (Stop Loss Market)

| Action | Trigger Rule | Error Message |
|--------|-------------|---------------|
| BUY SL-M | trigger ≥ LTP | "Buy SL-M trigger must be >= LTP" |
| SELL SL-M | trigger ≤ LTP | "Sell SL-M trigger must be <= LTP" |

**Rationale**: Same as SL, but executes at market when trigger is hit.

### Additional Validations
| Condition | Error |
|-----------|-------|
| LTP not available (≤ 0) | "LTP not available" |
| LIMIT/SL price ≤ 0 | "Enter price" |
| SL/SL-M trigger ≤ 0 | "Enter trigger price" |

---

## API Calls Used

### Place Order
```js
tradingApi.placeOrder({
  apikey, strategy: 'QuickTrade', exchange: 'NFO', symbol,
  action, quantity, pricetype, product, price?, trigger_price?
})
// → POST /api/v1/placeorder
// Response: { status: 'success', orderid: '...' }
```
Then polls orderbook based on order type:
- **MARKET**: polls until `complete` → fetchPositions with retries (1.5s, 3.5s)
- **LIMIT/SL/SL-M**: polls until `open`/`pending` → fetchOrders (no execution wait)

### Modify Order
```js
tradingApi.modifyOrder(orderid, {
  symbol, exchange, action, product, pricetype, quantity,
  price, trigger_price, disclosed_quantity: 0, strategy: 'EzayChart Modification'
})
// → POST /modify_order (webClient, session + CSRF)
// Response: { status: 'success', orderid: '...' }
```

### Cancel Order
```js
tradingApi.cancelOrder(orderid)
// → POST /cancel_order (webClient, session + CSRF)
// Response: { status: 'success', orderid: '...' }
```
Then polls orderbook until `cancelled`/`rejected` → fetchOrders

### Close Position
```js
tradingApi.closePosition(symbol, exchange, product)
// → POST /close_position (webClient, session + CSRF)
// Response: { status: 'success', orderid: '...' }
```
Backend uses smart order logic: gets current position → places opposite order (LONG→SELL, SHORT→BUY) with quantity = position size.
Then polls orderbook until `complete`/`rejected`/`cancelled` → fetchPositions with retries (1.5s, 3.5s)

### Poll Order Status (after place)
```js
fetch('/api/v1/orderbook', { method: 'POST', body: JSON.stringify({ apikey }) })
// → polls until terminal status
```

### Fetch Positions
```js
fetch('/api/v1/positionbook', { method: 'POST', body: JSON.stringify({ apikey }) })
// → POST /api/v1/positionbook
// Returns positions matched to CE/PE via robust symbol matching
```

### Fetch Orders
```js
fetch('/api/v1/orderbook', { method: 'POST', body: JSON.stringify({ apikey }) })
// → POST /api/v1/orderbook
// Returns open/pending/trigger pending orders matched to CE/PE
```

### Symbol Matching (positions & orders)
```js
matchSym(a, b) → a === b || a.endsWith(b) || b.endsWith(a) || a.replace(/^.*:/, '') === b.replace(/^.*:/, '')
```
Handles broker prefix differences (e.g. `NSE:NIFTY25JUL25000CE` vs `NIFTY25JUL25000CE`)

### Guards (prevent duplicate API calls)
- `isPlacingOrderRef` — place order
- `isClosingRef` — close position
- `isCancellingRef` — cancel order

---

## Visual Design

### Position & Order Lines on Chart
| Element | Position Line | Order Line |
|---------|--------------|------------|
| Dashed line | Green (LONG) / Purple (SHORT) | Green (BUY) / Red (SELL) |
| Badge | `CE-LONG` / `PE-SHORT` | `CE SELL` / `PE BUY` |
| Info text | `@ entryPrice ₹+pnl` (blue/red bold) | `LIMIT @ price` / `SL @ trigger` (amber for SL) |
| × button | Close position | Cancel order |
| Price tag | Entry price | Order/trigger price |
| Drag behavior | None | Horizontal drag to modify price |
| Cursor (pill) | `pointer` | `grab` / `grabbing` during drag |
| Cursor (×) | `pointer` | `pointer` |

### Quick Trade Panel
| Element | Style |
|---------|-------|
| Header CE | Light green tint `rgba(0,200,81,0.15)` dark / `rgba(0,200,81,0.1)` light |
| Header PE | Light purple tint `rgba(224,64,251,0.15)` dark / `rgba(224,64,251,0.1)` light |
| CE button | `#00C851` green |
| PE button | `#E040FB` purple |
| BUY button | `#22c55e` green |
| SELL button | `#ef4444` red |
| Place button (BUY) | `#22c55e` green |
| Place button (SELL) | `#ef4444` red |
| Executing state | `#f59e0b` amber |
| Error text | `#ef4444` red |

---

## Key Files
| File | Purpose |
|------|---------|
| `chartPrimitives.ts` | `PositionLinePrimitive` (cached hit areas, mousedown close), `OrderLinePrimitive` (cached hit areas, mousedown cancel, drag-to-modify, SL rounding) |
| `EzayChart.tsx` | `fetchPositions()`, `fetchOrders()` (robust symbol matching), primitive refs, WS PnL update, `handleClosePosition()`, `handleCancelOrder()`, `handleModifyOrder()`, `pollOrderStatus()` (type-aware), `handlePlaceOrder()`, stale closure refs, Quick Trade Panel integration |
| `QuickTradePanel.tsx` | Draggable order entry panel, CE/PE + BUY/SELL toggles, order type/product selection, 0.05 SL price auto-adjustment, validation, theme colors, localStorage persistence, state reset after trade |
| `trading.ts` | `closePosition()`, `cancelOrder()`, `modifyOrder()` API calls |
| `trading.ts` | `Position` and `Order` type interfaces |

---

## Architecture Notes
- **Refs only**: Position/order data stored in refs (no React state, no re-renders on WS tick)
- **Immutable updates**: `setData()` creates new arrays; PnL updates create new objects
- **requestUpdate()**: Signals lightweight-charts to redraw
- **DOM event lifecycle**: `attached()` stores chart reference, attaches mousedown/mousemove/mouseup; `detached()` removes listeners
- **Strike change**: Clears all position and order primitives + `_hitAreas` cache
- **Optimistic UI**: Close/cancel hide the line immediately; refresh confirms or reverts
- **Symbol matching**: Cross-broker compatible via `endsWith` / prefix stripping
- **Order polling**: MARKET polls to completion; LIMIT/SL only confirms placement
- **Quick Trade Panel**: `transform: translate()` positioning for free 2D drag
