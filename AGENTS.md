# AGENTS.md

## CRITICAL RULES — OBEY WITHOUT EXCEPTION

1. **NEVER push to git without explicit user confirmation.** Before running `git push`, ALWAYS ask the user "Push now?" or similar. No exceptions. No assumptions. Even if the build passes, even if the user said the fix works — you MUST ask before pushing.
2. **NEVER commit without first running `npx tsc -b` AND `npx vite build`.** A passing tsc alone is not enough.
3. **NEVER remove or modify dependencies in `package.json` without user confirmation.**

These rules override everything else. If you are unsure whether something counts as "explicit user confirmation to push", it does NOT count. Ask.

## Build Notes

- `frontend/dist/` is built by CI/CD pipeline. Do not commit, modify, or comment on files in this folder.
- Use `cd frontend && npm install && npm run build` to build locally if needed.
- Use `cd frontend && npm ci` to verify lockfile consistency with CI.

## Build Verification Before Push

- **Always run `npx tsc -b` (TypeScript check) AND `npx vite build` locally before committing.** A passing `tsc` alone is not enough — the full `vite build` must also succeed. Docker builds use `npm run build` which runs both.
- **Never commit or push without first verifying the build passes locally.** If the user confirms a fix works at runtime, still run the full build before committing.

## Commit & Push Discipline

- **Never push to git without explicit user confirmation.** Always ask the user to confirm before running `git push`.
- Commits may be created after user confirms changes are working, but `git push` requires separate explicit approval.
- If the user says "push" or "ok push", that counts as confirmation.

## Dependency Management

- **Never remove or modify dependencies in `package.json` without user confirmation.** The madhan pages import many third-party libraries (`react-router-dom`, `lightweight-charts-drawing`, `lightweight-charts-indicators`, `chart.js`, `react-chartjs-2`, `oakscriptjs`, `date-fns`, `chartjs-adapter-date-fns`, `@types/chart.js`) that may not be explicitly listed in `package.json` but are required for builds.
- If the Docker build fails with "Cannot find module" errors, check git history for the original dependency list before adding/removing packages.
- Always run `npm ci` (not `npm install`) to verify CI-compatible dependency resolution.
- If adding a new dependency, ensure its version is compatible with existing peer dependency constraints.

## Zerodhaenctoken Broker — Sync with Original Zerodha

### Overview

`broker/zerodhaenctoken/` is a fork of `broker/zerodha/` that uses Kite's personal/free enctoken API instead of the paid API key. Most files should be **byte-identical** to the original zerodha (only import paths differ). A few files have intentional enctoken-specific changes.

**Branch:** `Broker-Zerodha-Personal-enctoken`

### Files That MUST Be Identical to Original Zerodha

These files must match `broker/zerodha/` exactly, with only import path changes (`broker.zerodha` → `broker.zerodhaenctoken`):

| File | What changed (imports only) |
|---|---|
| `api/__init__.py` | Identical |
| `api/auth_api.py` | Identical |
| `api/funds.py` | Identical |
| `api/gtt_api.py` | Import path only |
| `api/margin_api.py` | Import path only |
| `api/order_api.py` | Import path only |
| `database/master_contract_db.py` | Identical |
| `mapping/gtt_data.py` | Import path only |
| `mapping/margin_data.py` | Identical |
| `mapping/order_data.py` | Import path only |
| `mapping/transform_data.py` | Identical |
| `streaming/zerodha_mapping.py` | Identical |
| `streaming/zerodha_order_adapter.py` | Identical |

### Files With Intentional Enctoken-Specific Changes

These files differ from the original zerodha on purpose:

| File | What differs |
|---|---|
| `api/data.py` | **Major rewrite**: enctoken auth (`Authorization: enctoken {token}`), base URL `kite.zerodha.com/oms` instead of `api.kite.trade`, on-demand WebSocket quotes via `ws_fetch.py`, retry logic for HTTP/2 errors, 5s timeframe support |
| `streaming/zerodha_websocket.py` | **Auth model**: Uses `get_enctoken(user_id)` from DB + env var `ZERODHA_ENCTOKEN` fallback instead of `get_auth_token(user_id)` with api_key:access_token parsing. WS URL includes `&user_id={user_id}`. `_refresh_access_token()` reads enctoken from DB on reconnect |
| `streaming/__init__.py` | Class name: `ZerodhaWebSocketAdapter` → `ZerodhaenctokenWebSocketAdapter` |
| `streaming/zerodhaenctoken_adapter.py` | **New file** (replaces `zerodha_adapter.py`): Uses enctoken auth, fetches user_id from Kite profile API, API key hardcoded to `"kitefront"` |
| `api/ws_fetch.py` | **New file**: On-demand WebSocket quote fetcher (Depth mode, TICK_TIMEOUT=5s, exchange mapping) |
| `plugin.json` | Metadata only (name, author) |

### How to Sync Changes from Original Zerodha

When `broker/zerodha/` is updated upstream:

1. **Identical files** — Copy the file from `broker/zerodha/` and replace import paths:
   ```bash
   # For each changed file in broker/zerodha/:
   sed 's/broker\.zerodha\./broker.zerodhaenctoken/g' broker/zerodha/<file> > broker/zerodhaenctoken/<file>
   ```

2. **gtt_api.py / gtt_data.py / order_data.py** — These are the 3 files that MUST stay in sync with zerodha. They contain business logic fixes (trade timestamps, GTT history toggle). Always check if upstream changed these:
   - `mapping/order_data.py` — tradebook `fill_timestamp` + `tradeid` field
   - `mapping/gtt_data.py` — `include_history` parameter in `map_gtt_book()`
   - `api/gtt_api.py` — `include_history` parameter in `get_gtt_book()`

3. **Enctoken-specific files** — Do NOT overwrite these from zerodha. They have intentional changes:
   - `api/data.py` — enctoken auth, WS quotes, retry logic
   - `streaming/zerodha_websocket.py` — enctoken auth model
   - `streaming/zerodhaenctoken_adapter.py` — enctoken adapter
   - `api/ws_fetch.py` — on-demand WS fetcher

4. **Verify after sync**:
   ```bash
   # Compare all shared files (imports should be the only diff)
   $files = @("api/__init__.py","api/auth_api.py","api/funds.py","api/gtt_api.py","api/margin_api.py","api/order_api.py","database/master_contract_db.py","mapping/gtt_data.py","mapping/margin_data.py","mapping/order_data.py","mapping/transform_data.py","streaming/zerodha_mapping.py","streaming/zerodha_order_adapter.py")
   foreach ($f in $files) {
       $z = "broker/zerodha/$f"
       $e = "broker/zerodhaenctoken/$f"
       $zContent = (Get-Content $z -Raw) -replace "broker\.zerodha\.", "broker.zerodhaenctoken."
       $eContent = Get-Content $e -Raw
       if ($zContent -ne $eContent) { Write-Output "DIFFERS: $f" }
   }
   # All should show IDENTICAL
   ```

### Quick Reference — File Status

```
broker/zerodhaenctoken/
├── api/
│   ├── __init__.py          ✅ IDENTICAL
│   ├── auth_api.py          ✅ IDENTICAL
│   ├── data.py              🔧 ENCTOKEN-SPECIFIC (auth, WS quotes, retry)
│   ├── funds.py             ✅ IDENTICAL
│   ├── gtt_api.py           ✅ IDENTICAL (import path only)
│   ├── margin_api.py        ✅ IDENTICAL (import path only)
│   ├── order_api.py         ✅ IDENTICAL (import path only)
│   └── ws_fetch.py          🆕 NEW FILE (on-demand WS fetcher)
├── database/
│   └── master_contract_db.py ✅ IDENTICAL
├── mapping/
│   ├── gtt_data.py          ✅ IDENTICAL (import path only)
│   ├── margin_data.py       ✅ IDENTICAL
│   ├── order_data.py        ✅ IDENTICAL (import path only)
│   └── transform_data.py    ✅ IDENTICAL
├── streaming/
│   ├── __init__.py          🔧 CLASS NAME CHANGE
│   ├── zerodha_mapping.py   ✅ IDENTICAL
│   ├── zerodha_order_adapter.py ✅ IDENTICAL
│   ├── zerodha_websocket.py 🔧 ENCTOKEN-SPECIFIC (enctoken auth)
│   └── zerodhaenctoken_adapter.py 🆕 NEW FILE (enctoken adapter)
└── plugin.json              🔧 METADATA ONLY
```
