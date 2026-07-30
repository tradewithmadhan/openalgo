# Position & Order Lines on EzayChart

## Overview
Display open positions and pending orders (LIMIT / SL / SL-M) as horizontal lines with pill labels directly on the EzayChart lightweight-charts v5 canvas. Lines are drawn using custom primitives attached to the CE/PE series.

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

#### Hit Detection — Cached Hit Areas
- **Root cause of × misalignment**: `_getOrderPillRect` / `_getPillRect` recalculated pill geometry via `ctx.measureText()` outside the render callback. The canvas context state inside `useMediaCoordinateSpace` differs from event handlers, causing the recalculated × position to shift from the rendered ×.
- **Fix**: Both primitives cache the actual rendered pixel positions (`closeX`, `pillLeft`, `pillRight`, `pillY`, `pillH`, `y`) during `draw()` into a `_hitAreas` Map. Hit tests (`_hitTestCloseBtn`, `_hitTestPill`) use these cached values directly — zero recalculation, zero mismatch.
- **Removed**: `_getOrderPillRect()` and `_getPillRect()` methods (no longer needed)

#### Stale Closure Fix
- `subscribeClick` handler and primitive constructors delegate to refs (`handleClosePositionRef`, `handleCancelOrderRef`, `handleModifyOrderRef`) to avoid stale closure issues
- Refs updated after each `useCallback` definition

#### Order Line Price Display
- **SL/SL-M orders**: `ord.price` set to trigger price (line positioned at trigger level)
- **LIMIT orders**: `ord.price` set to limit price

### API Endpoints Used
| Endpoint | Method | Body | Purpose |
|----------|--------|------|---------|
| `/close_position` | POST | `{apikey, symbol, exchange, product}` | Close position from chart |
| `/cancel_order` | POST | `{apikey, orderid}` | Cancel order from chart |
| `/modify_order` | POST | `{apikey, strategy, exchange, symbol, product, orderid, order_type, trigger_price, quantity, price, validity, disclosed_quantity}` | Modify order price via drag |

### Visual Design
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

### Key Files
| File | Purpose |
|------|---------|
| `chartPrimitives.ts` | `PositionLinePrimitive` (cached hit areas, mousedown close), `OrderLinePrimitive` (cached hit areas, mousedown cancel, drag-to-modify, SL rounding) |
| `EzayChart.tsx` | `fetchPositions()`, `fetchOrders()`, primitive refs, WS PnL update, `handleClosePosition()`, `handleCancelOrder()`, `handleModifyOrder()`, stale closure refs |
| `trading.ts` | `closePosition()`, `cancelOrder()`, `modifyOrder()` API calls |
| `trading.ts` | `Position` and `Order` type interfaces |

### Architecture Notes
- **Refs only**: Position/order data stored in refs (no React state, no re-renders on WS tick)
- **Immutable updates**: `setData()` creates new arrays; PnL updates create new objects
- **requestUpdate()**: Signals lightweight-charts to redraw
- **DOM event lifecycle**: `attached()` stores chart reference, attaches mousedown/mousemove/mouseup; `detached()` removes listeners
- **Strike change**: Clears all position and order primitives + `_hitAreas` cache
- **Optimistic UI**: Close/cancel hide the line immediately; refresh confirms or reverts

---

## Pending / Future Work

### High Priority
1. **Commit & push Phase 2** — All changes are local, not yet committed
2. **Remove debug red outlines** — Red `strokeRect` around × is for debugging, should be removed before production
3. **Confirmation dialog** — Optional: confirm before close/cancel/modify (currently immediate action)
4. **Error handling toasts** — Show success/failure toasts after close/cancel/modify operations
5. **Order modify validation** — Check order status before modify (don't modify filled/cancelled orders)

### Medium Priority
6. **SL trigger price drag** — Currently dragging modifies the limit/trigger price. SL trigger and limit are different; dragging should update trigger_price for SL orders (currently both are set to the same dragged value)
7. **Position close confirmation** — Currently closes immediately; consider adding a confirm dialog for large positions
8. **Multi-order handling** — If multiple orders exist at similar prices, ensure pills don't overlap

### Low Priority
9. **Undo/redo** — Undo last close/cancel/modify action
10. **Order modify history** — Show modification history on the chart
11. **Partial close** — Allow closing partial position quantity from chart
12. **Batch operations** — Close all positions / cancel all orders from chart
13. **Sound alerts** — Audio feedback on successful close/cancel/modify

### Cleanup
14. **Remove debug elements**: Red outlines, debug console logs
15. **Performance audit**: Verify no memory leaks from DOM event listeners on repeated primitive attach/detach
