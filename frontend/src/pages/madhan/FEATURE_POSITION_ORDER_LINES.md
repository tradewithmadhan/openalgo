# Position & Order Lines on EzayChart

## Overview
Display open positions and pending orders (LIMIT / SL / SL-M) as horizontal lines with pill labels directly on the EzayChart lightweight-charts v5 canvas. Lines are drawn using custom primitives attached to the CE/PE series.

---

## Current Implementation (View-Only)

### Position Lines
- **Data source**: `POST /api/v1/positionbook` with `{apikey}` body
- **Matching**: Filters positions by current `ceSymbol` / `peSymbol` (exact symbol match)
- **Refresh**: On symbol change + every 30s periodic refresh
- **Primitive**: `PositionLinePrimitive` in `chartPrimitives.ts`
- **Visual**:
  - Dashed horizontal line at entry price (green for LONG, purple for SHORT)
  - Pill group (right-aligned before 56px price tag):
    - `CE-LONG` / `PE-SHORT` badge (light green / light purple)
    - Quantity badge
    - `@ entryPrice ₹+pnl` text (blue for positive, red for negative, bold)
    - Close button (×)
  - Price tag on right axis (matches badge color)
- **Hide**: Click × button hides the line (does NOT close the position)

### Order Lines
- **Data source**: `POST /api/v1/orderbook` with `{apikey}` body
- **Matching**: Filters open/pending/trigger-pending orders by `ceSymbol` / `peSymbol`; excludes MARKET orders
- **Refresh**: On symbol change + every 30s periodic refresh
- **Primitive**: `OrderLinePrimitive` in `chartPrimitives.ts`
- **Visual**:
  - Dashed horizontal line at order price (green for BUY, red for SELL)
  - Pill group (right-aligned before 56px price tag):
    - `CE SELL` / `PE BUY` badge (light red / light green)
    - Quantity badge
    - `LIMIT @ price` / `SL @ triggerPrice` / `SL-M @ triggerPrice` badge (amber for SL types, neutral for LIMIT)
    - Close button (×)
  - Price tag on right axis
- **Hide**: Click × button hides the line (does NOT cancel the order)

### Theme Support
Both primitives detect `document.documentElement.classList.contains('dark')` on every draw call:
- **Dark mode**: Semi-transparent dark pill backgrounds, white text
- **Light mode**: White pill backgrounds with subtle borders, dark text
- Line opacity adjusted for readability in each mode

### Data Flow
```
fetchPositions() / fetchOrders()
  → filters by ceSymbol / peSymbol
  → sets primitive data via refs (no React state, no re-renders)
  → WS useEffect updates position PnL live from CE/PE LTP
  → primitive.setData() triggers chart redraw via requestUpdate()
```

### Key Files
| File | Purpose |
|------|---------|
| `chartPrimitives.ts` | `PositionLinePrimitive`, `OrderLinePrimitive`, `PositionDatum`, `OrderLineDatum` |
| `EzayChart.tsx` | `fetchPositions()`, `fetchOrders()`, primitive refs, WS PnL update, click handlers |

### Architecture Notes
- **Refs only**: Position/order data stored in refs (`cePositionDataRef`, `pePositionDataRef`, `ceOrderRef`, `peOrderRef`), not React state — avoids re-renders on every WS tick
- **Immutable updates**: Position PnL updates create new objects (`{ ...cePos, pnl }`) so lightweight-charts detects changes
- **requestUpdate()**: Called in `setData()` to signal chart redraw
- **Strike change**: Clears all position and order primitives

---

## Phase 2: Editable Orders (Planned)

### Goal
Make order lines interactive — user can close, modify price, or move SL trigger directly from the chart.

### Planned Features
1. **Cancel Order**: × button sends `POST /api/v1/cancelorder` with `{apikey, orderid}`
2. **Modify Limit Price**: Drag pill to new price level → `POST /api/v1/modifyorder` with new price
3. **Modify SL Trigger**: Drag SL pill to new trigger price → `POST /api/v1/modifyorder` with new trigger_price
4. **Visual feedback**: While dragging, show updated price in pill and price tag in real-time
5. **Undo/Confirm**: Optional confirmation dialog before executing modify/cancel

### Technical Approach
- Add `chart.subscribeDrag()` or pointer event handlers on the primitive
- Detect drag start on pill area → track mouse movement → update price on drag end
- On drag end: call modify API, refresh order list
- Add loading state / success toast after modification
- Handle error cases (insufficient margin, order already executed, etc.)

### API Endpoints Needed
- `POST /api/v1/cancelorder` — body: `{ apikey, orderid }`
- `POST /api/v1/modifyorder` — body: `{ apikey, orderid, quantity, price, trigger_price, pricetype }`

### UI Considerations
- Cursor changes to `grab` / `grabbing` on hover over draggable pills
- Price tag updates in real-time during drag
- Prevent drag outside chart bounds
- Show modification confirmation toast
