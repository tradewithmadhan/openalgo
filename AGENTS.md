# AGENTS.md — Zerodha Personal (enctoken) Branch

This branch (`Broker-Zerodha-Personal-enctoken`) carries the `zerodhaenctoken` broker plugin on top of upstream
OpenAlgo. The plugin lets users log in with Kite's personal/free enctoken instead of a paid API key.

## CRITICAL RULES — OBEY WITHOUT EXCEPTION

1. **NEVER push to git without explicit user confirmation.**
2. **NEVER commit without first running `npx tsc -b` AND `npx vite build`** (both must pass with ZERO errors).
3. **NEVER remove or modify dependencies in `package.json` without user confirmation.**
4. **`broker/zerodha/` must stay byte-identical to upstream.** Never fix bugs there locally; fixes go into `broker/zerodhaenctoken/`.

## Build Notes

- `frontend/dist/` is built by CI/CD. Do not commit it; rebuild locally with `cd frontend && npm ci && npm run build`.
- Backend runs via `py app.py`; restart after any Python change.

## Zerodhaenctoken Broker — Sync with Original Zerodha

### Overview

`broker/zerodhaenctoken/` is a fork of `broker/zerodha/` that uses Kite's personal/free enctoken API instead of the
paid API key. Most files are **byte-identical** or only have import path changes. A few files have intentional
enctoken-specific changes.

### Category 1: Completely Identical (byte-for-byte, no changes)

Exact copies from `broker/zerodha/` — zero modifications:

| File | Notes |
|---|---|
| `api/__init__.py` | Identical |
| `api/auth_api.py` | Identical |
| `api/funds.py` | Identical |
| `mapping/mcx_contract_size.py` | Identical (self-contained, stdlib-only; MCX tables shared) |

> NOTE: `streaming/zerodha_order_adapter.py` was moved to Category 2 — the enctoken copy carries no `broker.*`
> imports, so a byte-copy of upstream would wrongly bind it to `broker.zerodha` modules.

### Category 2: Identical Except Import Paths

Identical to `broker/zerodha/` after replacing `broker.zerodha` → `broker.zerodhaenctoken` in import statements:

| File | Import changes |
|---|---|
| `api/gtt_api.py` | `broker.zerodha.mapping.gtt_data` → `broker.zerodhaenctoken.mapping.gtt_data` |
| `api/margin_api.py` | `broker.zerodha.mapping.margin_data` → `broker.zerodhaenctoken.mapping.margin_data` |
| `api/order_api.py` | `broker.zerodha.mapping.transform_data` → `broker.zerodhaenctoken.mapping.transform_data` |
| `mapping/gtt_data.py` | No import changes (uses `database.token_db` directly) |
| `mapping/order_data.py` | `broker.zerodha.mapping.mcx_contract_size` → `broker.zerodhaenctoken.mapping.mcx_contract_size` |
| `streaming/zerodha_order_adapter.py` | No `broker.*` imports — shared status helpers import from `broker.zerodhaenctoken.mapping.order_data` |
| `mapping/margin_data.py` | `broker.zerodha.mapping.mcx_contract_size` → `broker.zerodhaenctoken.mapping.mcx_contract_size` |
| `mapping/transform_data.py` | `broker.zerodha.mapping.mcx_contract_size` → `broker.zerodhaenctoken.mapping.mcx_contract_size` |
| `streaming/zerodha_mapping.py` | `broker.zerodha.mapping.mcx_contract_size` → `broker.zerodhaenctoken.mapping.mcx_contract_size` |
| `database/master_contract_db.py` | `broker.zerodha.mapping.mcx_contract_size` → `broker.zerodhaenctoken.mapping.mcx_contract_size` |

### Category 3: Enctoken-Specific (intentionally different — do NOT overwrite from upstream)

| File | What differs |
|---|---|
| `api/data.py` | Major rewrite: enctoken auth (`Authorization: enctoken {token}`), base URL `kite.zerodha.com/oms`, on-demand WS quotes via `ws_fetch.py`, retry logic, 5s timeframe |
| `api/ws_fetch.py` | New file: on-demand WS quote fetcher (Depth mode, TICK_TIMEOUT=5s, exchange mapping) |
| `streaming/__init__.py` | Class name: `ZerodhaWebSocketAdapter` → `ZerodhaenctokenWebSocketAdapter` |
| `streaming/zerodha_websocket.py` | Auth model: `get_enctoken(user_id)` from DB only, no env fallback, `openalgo_user_id` for DB lookups, `&user_id={user_id}` in WS URL |
| `streaming/zerodhaenctoken_adapter.py` | Renamed from `zerodha_adapter.py`: enctoken auth, user_id from Kite profile API, API key `"kitefront"` |
| `plugin.json` | Metadata only (name, author) |

### How to Sync Changes from Original Zerodha

When `broker/zerodha/` is updated upstream:

**Step 1: Identify what changed**
```bash
git diff <previous-commit>..<new-commit> --name-only -- broker/zerodha/
```

**Step 2: Category 1 files — just copy**
```bash
cp broker/zerodha/<file> broker/zerodhaenctoken/<file>
```

**Step 3: Category 2 files — copy and replace imports**
```bash
(Get-Content "broker/zerodha/<file>" -Raw) -replace "broker\.zerodha\.", "broker.zerodhaenctoken." | Set-Content "broker/zerodhaenctoken/<file>"
```

**Step 4: Category 3 files — apply only relevant parts, preserve enctoken-specific logic**

| File | What to preserve |
|---|---|
| `api/data.py` | Enctoken auth, base URL `kite.zerodha.com/oms`, WS quotes via `ws_fetch.py`, retry, 5s timeframe |
| `api/ws_fetch.py` | On-demand WS fetcher (Depth mode, TICK_TIMEOUT=5s) |
| `streaming/__init__.py` | Class name `ZerodhaenctokenWebSocketAdapter` |
| `streaming/zerodha_websocket.py` | `get_enctoken(user_id)` from DB only, `&user_id={user_id}` in WS URL, `openalgo_user_id` |
| `streaming/zerodhaenctoken_adapter.py` | `get_enctoken(user_id)`, user_id from Kite profile API, API key `"kitefront"` |
| `plugin.json` | Plugin name `zerodhaenctoken`, author metadata |

- If the upstream change is about paid API key logic (`get_auth_token()`, `api_key:access_token`, `api.kite.trade`) → **skip it**.
- If it's a bugfix → apply the fix while keeping enctoken-specific logic intact.

**Step 5: Verify after sync**
```powershell
# Category 1 (byte-identical)
$cat1 = @("api/__init__.py","api/auth_api.py","api/funds.py","mapping/mcx_contract_size.py")
foreach ($f in $cat1) {
    $z = Get-Content "broker/zerodha/$f" -Raw
    $e = Get-Content "broker/zerodhaenctoken/$f" -Raw
    if ($z -ne $e) { Write-Output "DIFFERS: $f" }
}

# Category 2 (import paths only)
$norm = { param($p) ((Get-Content $p -Raw) -replace "broker\.zerodha\.", "broker.zerodhaenctoken." -replace "`r`n","`n") -split "`n" | Where-Object { $_ -match '\S' } }
$cat2 = @("api/gtt_api.py","api/margin_api.py","api/order_api.py","mapping/gtt_data.py","mapping/order_data.py","streaming/zerodha_order_adapter.py","database/master_contract_db.py","mapping/margin_data.py","mapping/transform_data.py","streaming/zerodha_mapping.py")
foreach ($f in $cat2) {
    $d = Compare-Object (& $norm "broker/zerodha/$f") (& $norm "broker/zerodhaenctoken/$f") | Measure-Object | Select-Object -ExpandProperty Count
    if ($d -gt 0) { Write-Output "DIFFERS($d): $f" }
}
# All should show no output
```

## Zerodhaenctoken — Linked (registration / config) files

Files outside `broker/zerodhaenctoken/` that reference or register it:

| File (on `main`) | What references zerodhaenctoken | Notes |
|---|---|---|
| `.sample.env` | `VALID_BROKERS = '...,zerodha,zerodhaenctoken'` | Broker list template — must include the plugin name |
| `utils/broker_keys.py` | `"zerodhaenctoken": "Zerodha Personal (enctoken)"` | Broker registration dict (drives the login dropdown + Broker Keys UI) |
| `utils/broker_login.py` | `{"zerodha", "zerodhaenctoken", ...}` set and `broker in ("zerodha", "zerodhaenctoken")` branch | Login routing — enctoken shares Zerodha's login flow |
| `blueprints/brlogin.py` | `if broker == "zerodhaenctoken":` + enctoken save/validate block | Older-arch login blueprint (used on this branch) |
| `app.py` | (on `main` registration is via `utils/broker_keys`; on this branch via `brlogin.py`) | Check both when porting |
| `database/auth_db.py` | `get_enctoken`, `save_enctoken`, `has_enctoken`, `get_enctoken_by_auth_token`, `upsert_auth` (feed_token conditional) | Enctoken storage in feed_token column |
| `test/test_zerodha_index_packet.py` | imports `broker.zerodhaenctoken.streaming...` | Divergence-pinning test (index packets) |
| `test/test_zerodhaenctoken_order_status_mapping.py` | imports enctoken modules | Divergence-pinning test (order status) |
| `broker/zerodha/` | Mirror base (Categories 1–2) | Must stay byte-identical to upstream; enctoken depends on it |
| `frontend/src/pages/BrokerSelect.tsx` | enctoken paste modal (calls `/zerodhaenctoken/enctoken`) | Frontend UI for saving enctoken |

**When syncing to this branch, copy only:**
- `broker/zerodha/` (full folder)
- `broker/zerodhaenctoken/` (full folder)
- `.sample.env`
- `database/auth_db.py` (enctoken functions + upsert_auth fix)
- `blueprints/brlogin.py` (enctoken save/validate routes)
- `frontend/src/pages/BrokerSelect.tsx` (enctoken paste modal)
- `test/test_zerodha_index_packet.py`, `test/test_zerodhaenctoken_order_status_mapping.py`

Do NOT copy `utils/broker_keys.py`, `utils/broker_login.py`, or `app.py` from `main` — they are shared infrastructure whose `main` versions assume the newer architecture.

## Key Rules

- **`broker/zerodha/` must stay byte-identical to upstream.** Never fix bugs there; fixes go into `broker/zerodhaenctoken/`.
- **Category 3 files are enctoken-specific** — never overwrite from upstream.
- **Pin divergence with tests** — when upstream fixes something we diverged on, update the pinning test.
- **Run `py -m pytest`** for zerodha/enctoken suites after any broker change.
- **Run `npx tsc -b && npx vite build`** before any commit.
- **Never push without explicit user confirmation.**
