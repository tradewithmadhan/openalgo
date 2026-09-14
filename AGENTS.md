# AGENTS.md

## CRITICAL RULES — OBEY WITHOUT EXCEPTION

1. **NEVER push to git without explicit user confirmation.** Before running `git push`, ALWAYS ask the user "Push now?" or similar. No exceptions. No assumptions. Even if the build passes, even if the user said the fix works — you MUST ask before pushing.
2. **NEVER commit without first running `npx tsc -b` AND `npx vite build`.** A passing tsc alone is not enough. **Both commands must pass with ZERO errors.** Docker builds use `npm run build` which runs `tsc -b && vite build` — any tsc error (including unused variables, implicit `any`, etc.) will fail the Docker build.
3. **NEVER remove or modify dependencies in `package.json` without user confirmation.**

These rules override everything else. If you are unsure whether something counts as "explicit user confirmation to push", it does NOT count. Ask.

## Build Notes

- `frontend/dist/` is built by CI/CD pipeline. Do not commit, modify, or comment on files in this folder.
- Use `cd frontend && npm install && npm run build` to build locally if needed.
- Use `cd frontend && npm ci` to verify lockfile consistency with CI.

## Build Verification Before Push

- **Always run `npx tsc -b` (TypeScript check) AND `npx vite build` locally before committing.** A passing `tsc` alone is not enough — the full `vite build` must also succeed. Docker builds use `npm run build` which runs both.
- **`npx tsc -b` must exit with ZERO errors.** If it shows any errors (unused variables, implicit any, missing types, etc.), fix them before committing. Docker will fail on any tsc error.
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

`broker/zerodhaenctoken/` is a fork of `broker/zerodha/` that uses Kite's personal/free enctoken API instead of the paid API key. Most files are **byte-identical** or only have import path changes. A few files have intentional enctoken-specific changes.

**Branch:** `Broker-Zerodha-Personal-enctoken`

### Category 1: Completely Identical (byte-for-byte, no changes)

These files are exact copies from `broker/zerodha/` — zero modifications:

| File | Notes |
|---|---|
| `api/__init__.py` | Identical |
| `api/auth_api.py` | Identical |
| `api/funds.py` | Identical |
| `database/master_contract_db.py` | Identical |
| `mapping/margin_data.py` | Identical |
| `mapping/transform_data.py` | Identical |
| `streaming/zerodha_mapping.py` | Identical |
| `streaming/zerodha_order_adapter.py` | Identical |

### Category 2: Identical Except Import Paths

These files are identical to `broker/zerodha/` after replacing `broker.zerodha` → `broker.zerodhaenctoken` in import statements:

| File | Import changes |
|---|---|
| `api/gtt_api.py` | `broker.zerodha.mapping.gtt_data` → `broker.zerodhaenctoken.mapping.gtt_data` |
| `api/margin_api.py` | `broker.zerodha.mapping.margin_data` → `broker.zerodhaenctoken.mapping.margin_data` |
| `api/order_api.py` | `broker.zerodha.mapping.transform_data` → `broker.zerodhaenctoken.mapping.transform_data` |
| `mapping/gtt_data.py` | No import changes (uses `database.token_db` directly) |
| `mapping/order_data.py` | No import changes (uses `database.token_db` directly) |

### Category 3: Enctoken-Specific (intentionally different)

These files differ from `broker/zerodha/` on purpose — do NOT overwrite from upstream:

| File | What differs |
|---|---|
| `api/data.py` | **Major rewrite**: enctoken auth (`Authorization: enctoken {token}`), base URL `kite.zerodha.com/oms` instead of `api.kite.trade`, on-demand WebSocket quotes via `ws_fetch.py`, retry logic for HTTP/2 errors, 5s timeframe support |
| `api/ws_fetch.py` | **New file**: On-demand WebSocket quote fetcher (Depth mode, TICK_TIMEOUT=5s, exchange mapping) |
| `streaming/__init__.py` | Class name: `ZerodhaWebSocketAdapter` → `ZerodhaenctokenWebSocketAdapter` |
| `streaming/zerodha_websocket.py` | **Auth model**: Uses `get_enctoken(user_id)` from DB + env var `ZERODHA_ENCTOKEN` fallback instead of `get_auth_token(user_id)` with api_key:access_token parsing. WS URL includes `&user_id={user_id}` |
| `streaming/zerodhaenctoken_adapter.py` | **Renamed from `zerodha_adapter.py`**: Uses enctoken auth, fetches user_id from Kite profile API, API key hardcoded to `"kitefront"` |
| `plugin.json` | Metadata only (name, author) |

### How to Sync Changes from Original Zerodha

When `broker/zerodha/` is updated upstream, follow these steps:

**Step 1: Identify what changed**
```bash
# Check which files changed in upstream zerodha
git diff <previous-commit>..<new-commit> --name-only -- broker/zerodha/
```

**Step 2: For Category 1 files (completely identical) — just copy**
```bash
# Copy file as-is (no import changes needed)
cp broker/zerodha/<file> broker/zerodhaenctoken/<file>
```

**Step 3: For Category 2 files (import path changes) — copy and replace imports**
```bash
# Copy and replace import paths
(Get-Content "broker/zerodha/<file>" -Raw) -replace "broker\.zerodha\.", "broker.zerodhaenctoken." | Set-Content "broker/zerodhaenctoken/<file>"
```

**Step 4: For Category 3 files (enctoken-specific) — AI can handle with reasoning**

These files have intentional differences. When upstream changes them, AI should:

1. **Read the upstream diff** — understand what changed in `broker/zerodha/`
2. **Check if the change is relevant to enctoken** — ask: "Does this affect auth, quotes, or streaming?"
3. **Apply only relevant parts** — preserve enctoken-specific logic:

| File | What to preserve during merge |
|---|---|
| `api/data.py` | Enctoken auth (`Authorization: enctoken {token}`), base URL `kite.zerodha.com/oms`, WS-based quotes via `ws_fetch.py`, retry logic, 5s timeframe |
| `api/ws_fetch.py` | On-demand WS fetcher (Depth mode, TICK_TIMEOUT=5s, exchange mapping) — this file is unique to enctoken |
| `streaming/__init__.py` | Class name `ZerodhaenctokenWebSocketAdapter` |
| `streaming/zerodha_websocket.py` | `get_enctoken(user_id)` from DB, env var `ZERODHA_ENCTOKEN` fallback, `&user_id={user_id}` in WS URL |
| `streaming/zerodhaenctoken_adapter.py` | `get_enctoken(user_id)`, user_id from Kite profile API, API key `"kitefront"` |
| `plugin.json` | Plugin name `zerodhaenctoken`, author metadata |

4. **If the upstream change is about paid API key logic** (e.g., `get_auth_token()`, `api_key:access_token` parsing, `api.kite.trade` URLs) → **skip it** (not relevant to enctoken)
5. **If the upstream change is a bugfix** → apply the fix while keeping enctoken-specific logic intact

**Step 5: Verify after sync**
```bash
# Compare Category 1 files (should be byte-identical)
$cat1 = @("api/__init__.py","api/auth_api.py","api/funds.py","database/master_contract_db.py","mapping/margin_data.py","mapping/transform_data.py","streaming/zerodha_mapping.py","streaming/zerodha_order_adapter.py")
foreach ($f in $cat1) {
    $z = Get-Content "broker/zerodha/$f" -Raw
    $e = Get-Content "broker/zerodhaenctoken/$f" -Raw
    if ($z -ne $e) { Write-Output "DIFFERS: $f" }
}

# Compare Category 2 files (imports should be the only diff)
$cat2 = @("api/gtt_api.py","api/margin_api.py","api/order_api.py","mapping/gtt_data.py","mapping/order_data.py")
foreach ($f in $cat2) {
    $z = (Get-Content "broker/zerodha/$f" -Raw) -replace "broker\.zerodha\.", "broker.zerodhaenctoken."
    $e = Get-Content "broker/zerodhaenctoken/$f" -Raw
    if ($z -ne $e) { Write-Output "DIFFERS: $f" }
}
# All should show no output (all identical)
```

### Quick Reference — File Status

```
broker/zerodhaenctoken/
├── api/
│   ├── __init__.py          ✅ IDENTICAL (byte-for-byte)
│   ├── auth_api.py          ✅ IDENTICAL (byte-for-byte)
│   ├── data.py              🔧 ENCTOKEN-SPECIFIC (auth, WS quotes, retry)
│   ├── funds.py             ✅ IDENTICAL (byte-for-byte)
│   ├── gtt_api.py           ✅ IDENTICAL (import path only)
│   ├── margin_api.py        ✅ IDENTICAL (import path only)
│   ├── order_api.py         ✅ IDENTICAL (import path only)
│   └── ws_fetch.py          🔧 ENCTOKEN-SPECIFIC (new file, on-demand WS fetcher)
├── database/
│   └── master_contract_db.py ✅ IDENTICAL (byte-for-byte)
├── mapping/
│   ├── gtt_data.py          ✅ IDENTICAL (import path only)
│   ├── margin_data.py       ✅ IDENTICAL (byte-for-byte)
│   ├── order_data.py        ✅ IDENTICAL (import path only)
│   └── transform_data.py    ✅ IDENTICAL (byte-for-byte)
├── streaming/
│   ├── __init__.py          🔧 ENCTOKEN-SPECIFIC (class name change)
│   ├── zerodha_mapping.py   ✅ IDENTICAL (byte-for-byte)
│   ├── zerodha_order_adapter.py ✅ IDENTICAL (byte-for-byte)
│   ├── zerodha_websocket.py 🔧 ENCTOKEN-SPECIFIC (enctoken auth model)
│   └── zerodhaenctoken_adapter.py 🔧 ENCTOKEN-SPECIFIC (renamed from zerodha_adapter.py)
└── plugin.json              🔧 ENCTOKEN-SPECIFIC (metadata only)
```

## Upstream Sync Workflow

When merging upstream changes, follow this exact sequence:
1. `git fetch upstream` — fetch latest upstream commits
2. `git merge upstream/main` — merge into local main
3. Resolve conflicts if any (check with `git status`)
4. Run local build verification:
   - `npx tsc -b` — TypeScript check (must pass with ZERO errors)
   - `npx vite build` — Vite production build (must pass)
   - If both pass, the code is ready
5. Commit the merge
6. Ask user "Push now?" before pushing
7. `git push origin main`

## Docker Build Verification

Before any push, verify the Docker-equivalent build passes:
- `npx tsc -b` — TypeScript check. Must exit with ZERO errors.
- `npx vite build` — Vite production build. Must succeed.
- These two commands together replicate what Docker's `npm run build` does (`tsc -b && vite build`).
- If either fails, fix the errors before committing or pushing.
