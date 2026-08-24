# BANKNIFTY Support — End-to-End Implementation Plan

**Branch:** `feature/banknifty-support`
**Status:** COMPLETE
**Created:** 2026-08-21

---

## Architecture Decisions

| Decision | Choice |
|----------|--------|
| Fetcher | `IndexDataFetcher` config class + single `NiftyDataFetcher` thread (sequential: NIFTY first, then BANKNIFTY, synchronized to xx:00.100) |
| Database | Separate `banknifty_data` table + shared `option_data` table |
| API | `?instrument=NIFTY\|BANKNIFTY` on existing endpoints |
| Frontend | Instrument selector toggle in Madhan01 + context |
| Branch | Feature branch, merge to main after full testing |

## Key Differences: NIFTY vs BANKNIFTY

| Property | NIFTY | BANKNIFTY |
|----------|-------|-----------|
| Spot symbol | `NIFTY` | `BANKNIFTY` |
| Exchange | `NSE_INDEX` | `NSE_INDEX` |
| Option exchange | `NFO` | `NFO` |
| Strike step | 50 | 100 |
| Symbol format | `NIFTY29AUG2524000CE` | `BANKNIFTY29AUG2551000CE` |
| Lot size (current) | 65 | 30 |
| ATM rounding | `round(price/50)*50` | `round(price/100)*100` |

---

## Phase 1: Database Layer

**File:** `database/madhan_db.py`

### 1.1 Add `BankNiftyData` model
- [ ] Add `BankNiftyData` class mirroring `NiftyData` (table: `banknifty_data`)
- [ ] Columns: `timestamp` (PK), `open`, `high`, `low`, `close`, `volume`, `oi`
- [ ] Add to `init_db()` create_all

### 1.2 Add `store_banknifty_data()`
- [ ] Copy `store_nifty_data()` logic, target `BankNiftyData`
- [ ] Upsert on `timestamp` conflict

### 1.3 Add `get_banknifty_data()`
- [ ] Copy `get_nifty_data()` logic, query `BankNiftyData`

### 1.4 Add `get_banknifty_data_count()`
- [ ] Copy `get_nifty_data_count()` logic, query `BankNiftyData`

### 1.5 Fix `extract_strike()` regex
- [ ] Change: `r'^NIFTY\d{2}[A-Z]{3}\d{2}(\d+)(CE|PE)$'`
- [ ] To: `r'^(?:NIFTY|BANKNIFTY)\d{2}[A-Z]{3}\d{2}(\d+)(CE|PE)$'`

### 1.6 Fix `get_current_day_instrument_data()`
- [ ] Add `elif symbol == 'BANKNIFTY':` branch querying `BankNiftyData`

### 1.7 Fix `get_instrument_data_for_date()`
- [ ] Add `elif symbol == 'BANKNIFTY':` branch querying `BankNiftyData`

### 1.8 Fix `get_current_day_historical_data()`
- [ ] Add third query block for `BankNIFTY` using `BankNiftyData`
- [ ] Label as `literal_column("'BANKNIFTY'").label("symbol")`

### 1.9 Fix `get_nth_candle_oi_for_all_symbols()`
- [ ] Add `BankNIFTY` subquery block using `BankNiftyData`

### 1.10 Fix `validate_backfill_consistency()`
- [ ] Add `banknifty` key in result dict (parallel to `nifty` key)
- [ ] Query `BankNiftyData` for last timestamp/count

### 1.11 Add `get_banknifty_lot_size()`
- [ ] BANKNIFTY lot sizes: 30 (current), historical values TBD

### 1.12 Fix `clear_madhan_db()`
- [ ] Add `BankNiftyData` table clear

### 1.13 Add `get_last_banknifty_option_candle_timestamp()`
- [ ] Same as `get_last_option_candle_timestamp()` but filtering BANKNIFTY symbols

### Phase 1 Verification
- [x] Run `python -c "from database.madhan_db import *; init_db()"` to verify table creation
- [x] Verify `extract_strike('BANKNIFTY29AUG2551000CE')` returns `51000`
- [x] Verify `extract_strike('NIFTY29AUG2524000CE')` still returns `24000`

---

## Phase 2: Fetcher Service

**File:** `services/madhan/nifty_fetch_service.py`

**Architecture:** Single background thread runs both NIFTY and BANKNIFTY sequentially in each cycle.

### Cycle flow:
```
[Fetch NIFTY spot → store] → [Fetch NIFTY 42 options (parallel ThreadPoolExecutor) → store]
→ [Fetch BANKNIFTY spot → store] → [Fetch BANKNIFTY 42 options (parallel ThreadPoolExecutor) → store]
→ [Wait until next xx:00.100] → repeat
```

**Parallel processing preserved:** Within each instrument, option symbols are fetched in parallel using `ThreadPoolExecutor` (90% of rate limit = ~4 workers). This stays the same — NIFTY options fetch in parallel, then BANKNIFTY options fetch in parallel.

**Timing:** After both instruments complete, wait until 100ms past the next minute boundary (xx:00.100). This ensures candles are fetched right after they close, with minimal delay.

### 2.1 Create `IndexDataFetcher` config class (no thread)
- [ ] Create `IndexDataFetcher` as a **config holder + per-instrument methods** (not a thread manager)
- [ ] Constructor params: `instrument_name`, `spot_symbol`, `exchange`, `strike_step`, `table_class`, `store_fn`, `get_data_fn`, `get_data_count_fn`
- [ ] State: `open_atm_strike`, `current_atm_strike`, `expiry_date`, `option_symbols`, `last_update`
- [ ] Methods: `_get_atm_strike_and_symbols()`, `_generate_option_symbols()`, `_fetch_and_save_expiry()`, `_fetch_and_store_options_data()`, `_calculate_and_store_previous_day_oi()`
- [ ] All methods use `self.strike_step`, `self.instrument_name`, etc.

### 2.2 Create two config instances (not thread managers)
```python
nifty_config = IndexDataFetcher(
    instrument_name="NIFTY", spot_symbol="NIFTY",
    exchange="NSE_INDEX", strike_step=50,
    table_class=NiftyData, store_fn=store_nifty_data, ...
)
banknifty_config = IndexDataFetcher(
    instrument_name="BANKNIFTY", spot_symbol="BANKNIFTY",
    exchange="NSE_INDEX", strike_step=100,
    table_class=BankNiftyData, store_fn=store_banknifty_data, ...
)
```

### 2.3 Refactor `NiftyDataFetcher` to unified thread manager
- [ ] Keep existing `NiftyDataFetcher` singleton pattern
- [ ] Add `self.banknifty` alongside `self.nifty` (both `IndexDataFetcher` instances)
- [ ] `_run()` loop runs both sequentially with synchronized timing:
  ```python
  def _run(self):
      # Preliminary fetch for both
      self._run_preliminary(self.nifty)
      self._run_preliminary(self.banknifty)
      # Initial backfill for both
      self._run_backfill(self.nifty)
      self._run_backfill(self.banknifty)
      # Continuous loop (synchronized to xx:01)
      while not self.stop_event.is_set():
          self._run_incremental(self.nifty)       # NIFTY first
          self._run_incremental(self.banknifty)    # BANKNIFTY second
          # Wait until 100ms past next minute boundary (xx:00.100)
          now = datetime.now()
          next_minute = (now.second + 1) % 60
          wait_secs = next_minute - now.second
          if wait_secs <= 0:
              wait_secs += 60
          wait_ms = wait_secs * 1000 - now.microsecond // 1000 + 100
          if wait_ms <= 0:
              wait_ms += 60000
          if self.stop_event.wait(wait_ms / 1000):
              break
  ```
- [ ] `_run_incremental(config)` extracts current `_run()` body into per-instrument function

### 2.4 Parameterize `_run_incremental(config)`
- [ ] Use `config.spot_symbol`, `config.exchange` for API calls
- [ ] Use `config.strike_step` for ATM calculations
- [ ] Use `config.store_fn` for storing spot data
- [ ] Use `config.option_symbols` for option fetching
- [ ] Use `config.get_data_fn` for validation
- [ ] **Preserve ThreadPoolExecutor parallel fetching** within each instrument's option fetch (same `_fetch_and_store_options_data()` with `max_workers = int(rate * 0.9)`)

### 2.5 Parameterize preliminary fetch + backfill
- [ ] `_run_preliminary(config)`: fetch 2-day history for one instrument
- [ ] `_run_backfill(config)`: 5-day backfill for one instrument's options
- [ ] Both run sequentially: NIFTY first, then BANKNIFTY

### 2.6 Parameterize previous day OI
- [ ] `_calculate_and_store_previous_day_oi(config)`: use `config.table_class` for spot query

### 2.7 Expose both configs for API endpoints
- [ ] `nifty_fetcher.nifty` → NIFTY config (for `/api/nifty/status?instrument=NIFTY`)
- [ ] `nifty_fetcher.banknifty` → BANKNIFTY config (for `/api/nifty/status?instrument=BANKNIFTY`)
- [ ] Endpoint helper: `def get_instrument_config(instrument)` returns correct config

### 2.8 Auto-start scheduler (unchanged)
- [ ] Single scheduler starts the unified fetcher (both instruments run in same thread)

### Phase 2 Verification
- [ ] `nifty_config.strike_step == 50` and `banknifty_config.strike_step == 100`
- [ ] Symbol generation: `BANKNIFTY{DDMMMYY}{strike}CE/PE`
- [ ] NIFTY data stored in `nifty_data`, BANKNIFTY in `banknifty_data`
- [ ] Options for both stored in shared `option_data` table
- [ ] Sequential: NIFTY fetch completes before BANKNIFTY starts

---

## Phase 3: Backend API Endpoints

**File:** `blueprints/madhan.py`

### 3.1 Add instrument resolver helper
```python
def get_instrument_config(instrument='NIFTY'):
    """Returns (config, strike_step, spot_symbol) for the given instrument."""
    if instrument == 'BANKNIFTY':
        return nifty_fetcher.banknifty, 100, 'BANKNIFTY'
    return nifty_fetcher.nifty, 50, 'NIFTY'
```

### 3.2 Add symbol generation helper (parameterized)
```python
def make_option_symbol(instrument, expiry_str, strike, type_):
    day = expiry_str.strftime('%d')
    month = expiry_str.strftime('%b').upper()
    year = expiry_str.strftime('%y')
    return f"{instrument}{day}{month}{year}{strike}{type_}"
```

### 3.3 Parameterize these endpoints (add `?instrument=NIFTY|BANKNIFTY`):

#### Fetcher Control
- [ ] `POST /api/nifty/start` → start the unified fetcher (both instruments)
- [ ] `POST /api/nifty/stop` → stop the unified fetcher
- [ ] `GET /api/nifty/status` → return correct instrument's config status

#### Data Retrieval
- [ ] `GET /api/nifty/data` → call `get_banknifty_data()` or `get_nifty_data()`
- [ ] `GET /api/nifty/spot-data` → use correct spot symbol
- [ ] `GET /api/nifty/option-data` → filter by instrument's tracked symbols
- [ ] `GET /api/nifty/option-ohlc` → already works (symbol-based)
- [ ] `GET /api/nifty/previous-day-oi` → use correct config/spot
- [ ] `GET /nifty_chart_data` → use correct data function
- [ ] `GET /nifty_live_data` → use correct config
- [ ] `GET /api/nifty/coi_history` → works via extract_strike (fixed in Phase 1)
- [ ] `GET /api/strikes` → works via get_tracked_symbols

#### Analysis Endpoints (parameterize spot filter + strike step)
- [ ] `GET /api/nifty/coi-trend` → skip correct spot symbol, use correct strike_step
- [ ] `GET /api/nifty/ce-pe-changes` → same
- [ ] `GET /api/nifty/ce-pe-strike-changes` → same
- [ ] `GET /api/nifty/ce-pe-volume-changes` → same
- [ ] `GET /api/nifty/ce-pe-strike-volume-changes` → same
- [ ] `GET /api/nifty/oi_profile_data` → use correct spot/fetcher
- [ ] `GET /api/nifty/oi-strike-history` → filter correct spot symbol
- [ ] `GET /api/nifty/support-resistance` → use correct ATM/spot
- [ ] `GET /api/nifty/hx_lx_vol` → use correct symbol generation + strike step
- [ ] `GET /api/nifty/dash-data` → use correct strike step (250→500 for BN)
- [ ] `GET /api/nifty/dash-time-analysis` → same

#### EzayChart Endpoints
- [ ] `GET /api/ezayChart_data` → use correct spot symbol, config ATM
- [ ] `GET /api/ezayChart_signals` → use correct spot/config/symbol generation

#### ATP-LTP
- [ ] `GET /api/atp-ltp-data` → use correct config, strike_step

### Phase 3 Verification
- [x] `curl /api/nifty/status` returns NIFTY status (backward compat)
- [x] `curl /api/nifty/status?instrument=BANKNIFTY` returns BANKNIFTY status
- [x] `curl /api/nifty/spot-data?instrument=BANKNIFTY` returns BANKNIFTY spot
- [x] All existing `/api/nifty/*` calls without `?instrument` still work as NIFTY

---

## Phase 4: Signal Services

### 4.1 Fix `services/madhan/atp_signal.py`
- [ ] Add `spot_symbol='NIFTY'` and `strike_step=50` params to `process_historical_atp_data()`
- [ ] Change `if row['symbol'] == 'NIFTY':` to `if row['symbol'] == spot_symbol:`
- [ ] Change `round(historical_spot_ltp / 50) * 50` to use `strike_step`
- [ ] Change ITM offsets (`-50`, `-100`, `+50`, `+100`) to use `strike_step`

### 4.2 Fix `services/madhan/volume_signal.py`
- [ ] Add `spot_symbol='NIFTY'` param to `detect_volume_spike()`
- [ ] Change `if symbol == 'NIFTY':` to `if symbol == spot_symbol:`

### 4.3 Fix `services/madhan/hx_lx.py`
- [ ] Already parameterized — verify it works with BANKNIFTY symbols

### Phase 4 Verification
- [ ] `process_historical_atp_data(data, atm, spot_symbol='BANKNIFTY', strike_step=100)` works
- [ ] `detect_volume_spike(data, spot_symbol='BANKNIFTY')` works

---

## Phase 5: Frontend — Instrument Context

### 5.1 Create `InstrumentContext.tsx`
- [ ] Create `frontend/src/pages/madhan/InstrumentContext.tsx`
- [ ] Define `InstrumentContextType`: `{ instrument: string, strikeStep: number, spotSymbol: string }`
- [ ] Default value: `{ instrument: 'NIFTY', strikeStep: 50, spotSymbol: 'NIFTY' }`
- [ ] Export `InstrumentProvider` and `useInstrument()` hook

### 5.2 Create API helper
- [ ] Create `frontend/src/pages/madhan/api.ts` with helper:
```typescript
export function madhanApi(endpoint: string, instrument?: string): string {
    const base = `/madhan/api/nifty/${endpoint}`;
    if (instrument && instrument !== 'NIFTY') {
        return `${base}?instrument=${instrument}`;
    }
    return base;
}
```

### 5.3 Create symbol generation helper
- [ ] Add to `api.ts` or shared utils:
```typescript
export function getOptionSymbol(instrument: string, expiryDate: string, strike: number, type: 'CE' | 'PE'): string
export function getSpotWsKey(instrument: string): string // e.g. 'NSE_INDEX:NIFTY' or 'NSE_INDEX:BANKNIFTY'
export function getOptionWsKey(instrument: string, symbol: string): string // e.g. 'NFO:BANKNIFTY29AUG2551000CE'
export function calculateATM(spotPrice: number, strikeStep: number): number
```

### Phase 5 Verification
- [ ] `useInstrument()` returns `{ instrument: 'NIFTY', strikeStep: 50 }` by default
- [ ] `madhanApi('spot-data', 'BANKNIFTY')` returns `/madhan/api/nifty/spot-data?instrument=BANKNIFTY`

---

## Phase 6: Frontend — Madhan01.tsx Instrument Selector

### 6.1 Add instrument state
- [ ] Add `useState<string>('NIFTY')` for instrument selection
- [ ] Add toggle/dropdown in header: `NIFTY | BANKNIFTY`

### 6.2 Wrap tabs with InstrumentProvider
- [ ] Wrap `<Tabs>` with `<InstrumentProvider value={instrumentConfig}>`
- [ ] `instrumentConfig` derives from selected instrument

### 6.3 Update status fetching
- [ ] Change `/madhan/api/nifty/status` to include `?instrument=${instrument}`
- [ ] Update `NiftyStatus` interface to work with both instruments
- [ ] Update title/header to show selected instrument name

### 6.4 Pass instrument to child components
- [ ] All child components get instrument from context (no prop drilling needed)

### 6.5 Update inline symbol generation
- [ ] The inline `getSymbol()` in Madhan01 (line 1100) needs instrument param

### Phase 6 Verification
- [ ] Toggle switches between NIFTY and BANKNIFTY
- [ ] Status updates to show correct ATM strike and expiry
- [ ] All tabs show data for selected instrument

---

## Phase 7: Frontend — Child Component Updates

Each component needs:
1. Read `instrument` from `useInstrument()` hook
2. Replace hardcoded `'NIFTY'` in WebSocket subscriptions
3. Replace hardcoded `50` in ATM calculations with `strikeStep`
4. Replace hardcoded symbol generation with `getOptionSymbol(instrument, ...)`
5. Append `?instrument=${instrument}` to API fetch calls

### 7.1 Dash.tsx
- [ ] Use `useInstrument()` for API calls
- [ ] Update strike step in ATM calculations (250→500 for BN)

### 7.2 CePeChangesChart.tsx
- [ ] Use `useInstrument()` for API calls
- [ ] Update spot-data fetch URL

### 7.3 CePeStrikeChangesChart.tsx
- [ ] Use `useInstrument()` for API calls + strike generation

### 7.4 CePeVolumeChangesChart.tsx
- [ ] Use `useInstrument()` for API calls

### 7.5 CePeStrikeVolumeChangesChart.tsx
- [ ] Use `useInstrument()` for API calls + strike generation

### 7.6 CoiTrendChart.tsx
- [ ] Use `useInstrument()` for WebSocket + API calls

### 7.7 MultiOptionsChart.tsx
- [ ] Use `useInstrument()` for WebSocket, API calls, symbol generation
- [ ] Update `getSymbol()` to use instrument prefix
- [ ] Update strike generation (step)

### 7.8 OiActionChartPlotly.tsx
- [ ] Use `useInstrument()` for API calls

### 7.9 SupportResistanceChart.tsx
- [ ] Use `useInstrument()` for WebSocket + API calls

### 7.10 FutStocks.tsx
- [ ] No changes needed (futures are instrument-agnostic)

### Phase 7 Verification
- [ ] Each component renders correctly with NIFTY (backward compat)
- [ ] Each component renders correctly with BANKNIFTY
- [ ] WebSocket subscriptions switch correctly
- [ ] ATM calculations are correct for each instrument

---

## Phase 8: Frontend — Standalone Pages

### 8.1 NiftyChart.tsx
- [ ] Add instrument selector or read from URL param
- [ ] Update WebSocket subscription
- [ ] Update all API calls
- [ ] Update chart title

### 8.2 EzayChart.tsx
- [ ] Add instrument selector or read from URL param
- [ ] Update WebSocket subscription
- [ ] Update all API calls
- [ ] Update ATM calculation (step 50→100)
- [ ] Update chart title

### 8.3 ATPLTPStrategy.tsx
- [ ] Add instrument selector or read from URL param
- [ ] Update WebSocket subscription
- [ ] Update API calls

### 8.4 RealtimeTable.tsx
- [ ] Add instrument selector or read from URL param
- [ ] Update symbol generation
- [ ] Update WebSocket subscription

### Phase 8 Verification
- [ ] Each standalone page works with NIFTY
- [ ] Each standalone page works with BANKNIFTY

---

## Phase 9: Build Verification & Testing

### 9.1 TypeScript check
- [ ] `cd frontend && npx tsc -b` — zero errors

### 9.2 Vite build
- [ ] `cd frontend && npx vite build` — succeeds

### 9.3 Backend smoke tests
- [ ] Start NIFTY fetcher — verify it fetches NIFTY data
- [ ] Start BANKNIFTY fetcher — verify it fetches BANKNIFTY data
- [ ] Verify `/api/nifty/status` returns NIFTY status
- [ ] Verify `/api/nifty/status?instrument=BANKNIFTY` returns BANKNIFTY status
- [ ] Verify `/api/nifty/spot-data` returns NIFTY spot
- [ ] Verify `/api/nifty/spot-data?instrument=BANKNIFTY` returns BANKNIFTY spot

### 9.4 Frontend smoke tests
- [ ] Madhan01: Toggle to BANKNIFTY — status updates, charts load
- [ ] Madhan01: Toggle back to NIFTY — everything works
- [ ] MultiOptionsChart: Meet lines work for both instruments
- [ ] NiftyChart: Works with BANKNIFTY selected
- [ ] EzayChart: Works with BANKNIFTY selected

### 9.5 Data integrity
- [ ] BANKNIFTY option data stored in `option_data` table with correct symbols
- [ ] BANKNIFTY spot data stored in `banknifty_data` table
- [ ] Previous day OI works for both instruments
- [ ] COI trend works for both instruments

---

## File Change Summary

| File | Change Type | Est. Lines Changed |
|------|------------|-------------------|
| `database/madhan_db.py` | Add model + modify 10 functions | ~150 |
| `services/madhan/nifty_fetch_service.py` | Add IndexDataFetcher config + refactor _run() | ~200 |
| `services/madhan/atp_signal.py` | Add params to 1 function | ~20 |
| `services/madhan/volume_signal.py` | Add param to 1 function | ~10 |
| `blueprints/madhan.py` | Add instrument param to ~25 endpoints | ~200 |
| `frontend/src/pages/madhan/InstrumentContext.tsx` | NEW FILE | ~30 |
| `frontend/src/pages/madhan/api.ts` | NEW FILE (helpers) | ~40 |
| `frontend/src/pages/madhan/Madhan01.tsx` | Add selector + context | ~50 |
| `frontend/src/pages/madhan/components/Dash.tsx` | Use context | ~10 |
| `frontend/src/pages/madhan/components/CePeChangesChart.tsx` | Use context | ~10 |
| `frontend/src/pages/madhan/components/CePeStrikeChangesChart.tsx` | Use context | ~15 |
| `frontend/src/pages/madhan/components/CePeVolumeChangesChart.tsx` | Use context | ~10 |
| `frontend/src/pages/madhan/components/CePeStrikeVolumeChangesChart.tsx` | Use context | ~15 |
| `frontend/src/pages/madhan/components/CoiTrendChart.tsx` | Use context | ~10 |
| `frontend/src/pages/madhan/components/MultiOptionsChart.tsx` | Use context + fix getSymbol | ~30 |
| `frontend/src/pages/madhan/components/OiActionChartPlotly.tsx` | Use context | ~10 |
| `frontend/src/pages/madhan/components/SupportResistanceChart.tsx` | Use context | ~10 |
| `frontend/src/pages/madhan/NiftyChart.tsx` | Add instrument selector | ~30 |
| `frontend/src/pages/madhan/EzayChart.tsx` | Add instrument selector | ~40 |
| `frontend/src/pages/madhan/ATPLTPStrategy.tsx` | Add instrument selector | ~20 |
| `frontend/src/pages/madhan/RealtimeTable.tsx` | Add instrument selector | ~20 |
| **Total** | | **~940 lines** |

---

## Phase 10: Post-Implementation Audit — Pending Issues

**Audit Date:** 2026-08-23
**Status:** Identified during BANKNIFTY integration testing

### P1 — Functional Bugs (Must Fix)

#### Issue 1: `/nifty_chart_data` endpoint ignores BANKNIFTY

- **File:** `blueprints/madhan.py`, line 957
- **Code:** `data = get_nifty_data()` — always returns NIFTY data regardless of instrument.
- **Fix:** Add `instrument = request.args.get('instrument', 'NIFTY')` and branch to `get_banknifty_data()` when `instrument == 'BANKNIFTY'`.
- **Impact of fix:** NiftyChart and other pages using this endpoint will correctly show BANKNIFTY OHLC data when BANKNIFTY is selected. No impact on NIFTY (default unchanged).

#### Issue 2: `/api/atp-ltp-data` symbol lookup mixes NIFTY + BANKNIFTY symbols

- **File:** `blueprints/madhan.py`, lines 114-161
- **Code:** `tracked_symbols = get_tracked_symbols()` returns ALL symbols (NIFTY + BANKNIFTY). ATM/ITM lookup loops iterate all symbols without filtering by instrument prefix. If both instruments share a strike number (e.g., NIFTY 24000 vs BANKNIFTY 24000), wrong symbols could be resolved.
- **Fix:** Filter `tracked_symbols` by instrument before iterating:
  ```python
  instrument = request.args.get('instrument', 'NIFTY')
  tracked_symbols = [s for s in get_tracked_symbols() if s.startswith(instrument)]
  ```
- **Impact of fix:** ATP-LTP signals resolve correct ATM/ITM symbols per instrument. No functional change for NIFTY-only usage.

#### Issue 3: Backtest endpoints hardcoded to NIFTY

- **File:** `blueprints/madhan.py`, lines 1713-1822 (5 endpoints)
- **Endpoints:** `/api/nifty/backtest_dates`, `/api/nifty/backtest_strikes`, `/api/nifty/backtest_chart_data`, `/api/nifty/backtest_signals`, `/api/nifty/backtest_range`
- **Code:** All 5 endpoints accept no `instrument` parameter. Underlying DB functions in `database/madhan_db.py` hardcode `'NIFTY'`, `'NIFTY 50'`, and strike step `50`.
- **Fix:** Add `instrument` query param to all 5 endpoints. Update DB functions (`get_backtest_day_data`, `get_backtest_strikes`, `get_backtest_signals`, `get_backtest_chart_data`, `get_backtest_range`) to accept `instrument` param and use it for:
  - Spot symbol filter: `df['name'] == instrument` (was `'NIFTY 50'`)
  - Option symbol filter: `df['name'] == instrument` (was `'NIFTY'`)
  - Strike generation step: dynamic per instrument (was hardcoded `50`)
- **Impact of fix:** Backtest features work for BANKNIFTY. NIFTY backtest unchanged (default param). Backward compatible if `instrument` defaults to `'NIFTY'`.

#### Issue 4: `init_db()` migration missing `banknifty_data` table check

- **File:** `database/madhan_db.py`, lines 130-150
- **Code:** `init_db()` only checks and adds `oi` column to `nifty_data` table. `banknifty_data` is not checked. `Base.metadata.create_all()` does not alter existing tables — only creates missing ones.
- **Fix:** Add parallel migration check for `banknifty_data`:
  ```python
  if inspector.has_table('banknifty_data'):
      bn_columns = [c['name'] for c in inspector.get_columns('banknifty_data')]
      if 'oi' not in bn_columns:
          with engine.connect() as connection:
              with connection.begin():
                  connection.execute(text('ALTER TABLE banknifty_data ADD COLUMN oi INTEGER'))
  ```
- **Impact of fix:** Existing databases get `oi` column added to `banknifty_data` automatically. No impact on fresh installs (create_all handles it).

### P2 — Minor Bugs (Should Fix)

#### Issue 5: Market close check not instrument-scoped — ✅ DONE

- **File:** `services/madhan/nifty_fetch_service.py`, line 989
- **Code:** `get_last_option_candle_timestamp()` queries max timestamp across ALL option symbols (NIFTY + BANKNIFTY combined). Could cause premature/delayed fetcher shutdown.
- **Fix:** Use `get_last_option_candle_timestamp_for_instrument(instrument)` per instrument, or check both instruments are done before stopping.
- **Impact of fix:** Fetcher stops at correct time when both instruments' data is complete. Minor edge case — primarily affects market close behavior.

#### Issue 6: Spot row styling hardcodes `symbol === 'NIFTY'` — ✅ DONE

- **File:** `frontend/src/pages/madhan/Madhan01.tsx`, line 1132
- **Code:** `const isNifty = symbol === 'NIFTY'` — used for blue tint highlight on spot row. BANKNIFTY spot row gets wrong styling (falls through to PE red).
- **Fix:** Change to `const isSpotIndex = symbol === instrument` (or `symbol === 'NIFTY' || symbol === 'BANKNIFTY'`).
- **Impact of fix:** BANKNIFTY spot row gets correct blue highlight. Purely cosmetic.

#### Issue 7: `dtick: 50` hardcoded in ATPLTPStrategy Plotly chart — ✅ DONE

- **File:** `frontend/src/pages/madhan/ATPLTPStrategy.tsx`, line 432
- **Code:** `dtick: 50` — Y-axis tick interval. Too dense for BANKNIFTY (~50,000 spot).
- **Fix:** Change to `dtick: instrument === 'BANKNIFTY' ? 200 : 50` (or derive dynamically).
- **Impact of fix:** BANKNIFTY chart Y-axis shows readable tick marks. NIFTY unchanged.

#### Issue 8: `spotPriceRef = useRef(25500)` in RealtimeTable — ✅ DONE

- **File:** `frontend/src/pages/madhan/RealtimeTable.tsx`, line 46
- **Code:** Default 25500 is NIFTY-appropriate. Briefly shows wrong ATM before live data arrives.
- **Fix:** Change to `useRef(0)` — ref is reset to 0 on instrument change anyway.
- **Impact of fix:** No brief wrong ATM display on initial load. Minor cosmetic.

### P3 — Naming/Maintenance (Nice to Fix)

#### Issue 9: `volume_signal.py` variables named "nifty"

- **File:** `services/madhan/volume_signal.py`, lines 46-135
- **Variables:** `nifty_highs`, `nifty_lows`, `has_nifty_data` — all generic instrument-agnostic code.
- **Fix:** Rename to `spot_highs`, `spot_lows`, `has_spot_data`.
- **Impact:** No functional change. Maintenance/readability improvement.

#### Issue 10: `atp_signal.py` variable named "nifty"

- **File:** `services/madhan/atp_signal.py`, lines 167-233
- **Variable:** `nifty_by_ts` — stores spot close for any instrument.
- **Fix:** Rename to `spot_by_ts`.
- **Impact:** No functional change. Maintenance/readability improvement.

#### Issue 11: `blueprints/madhan.py` local variables use "nifty" prefix

- **File:** `blueprints/madhan.py`, lines 821-936, 2045-2117
- **Variables:** `nifty_highs_res`, `nifty_lows_res`, `nifty_by_ts` — generic instrument-agnostic code.
- **Fix:** Rename to `spot_highs_res`, `spot_lows_res`, `spot_by_ts`.
- **Impact:** No functional change. Maintenance/readability improvement.

### Recommended Fix Order

1. ~~**Issue 2** (ATP-LTP symbol filtering) — Highest risk, could produce wrong signals~~
2. ~~**Issue 1** (`/nifty_chart_data`) — Blocks NiftyChart from showing BANKNIFTY data~~
3. ~~**Issue 3** (Backtest endpoints) — Blocks backtest from working with BANKNIFTY~~
4. ~~**Issue 4** (DB migration) — Prevents OI data for existing BANKNIFTY databases~~
5. ~~**Issue 6** (Spot row styling) — Quick cosmetic fix~~ ✅ DONE
6. ~~**Issue 7** (dtick) — Quick cosmetic fix~~ ✅ DONE
7. ~~**Issue 5** (Market close) — Edge case, lower priority~~ ✅ DONE
8. ~~**Issue 8** (spotPriceRef) — Trivial fix~~ ✅ DONE
9. **Issues 9-11** (Naming) — No functional impact, can batch together — IN PROGRESS
