"""
On-demand market data fetch via OpenAlgo WebSocket proxy.

Used by data.py to serve /quotes, /multiquotes, /depth
without hitting the paid Kite Connect API.
"""

import json
import os
import time
import threading

import websocket

from utils.logging import get_logger

logger = get_logger(__name__)

# Max time to wait for ticks after subscribe
TICK_TIMEOUT = 5.0

# Kite personal API only supports streaming NSE equities reliably.
# Indices use NSE on the Kite side (not NSE_INDEX).
# F&O / BFO / CDS / BSE equities may not stream via personal WS.
_KITE_EXCHANGE_MAP = {
    "NSE_INDEX": "NSE",
    "BSE_INDEX": "BSE",
    "MCX_INDEX": "MCX",
    "GLOBAL_INDEX": "GLOBAL",
}


def _get_ws_url():
    """Get WebSocket URL dynamically from env (same as /api/websocket/config)."""
    return os.getenv("WEBSOCKET_URL", "ws://localhost:8765")


def _get_api_key():
    """Get the OpenAlgo API key for WS authentication from DB."""
    try:
        from database.auth_db import get_first_available_api_key
        return get_first_available_api_key()
    except Exception as e:
        logger.debug(f"Could not get API key from DB: {e}")
    return None


def _resolve_kite_exchange(oa_exchange: str, symbol: str) -> tuple[str, str]:
    """Resolve OA exchange/symbol to Kite broker exchange/symbol for WS subscribe.

    Returns (kite_exchange, brsymbol) tuple.
    The adapter's get_token(symbol, exchange) uses the OA exchange, so we keep
    the OA-side symbol/exchange for the WS proxy subscribe message. This
    mapping is only used for logging and fallback.
    """
    try:
        from database.token_db import get_br_symbol, get_symbol_info
        brsymbol = get_br_symbol(symbol, oa_exchange)
        if brsymbol:
            info = get_symbol_info(symbol, oa_exchange)
            if info and info.brexchange:
                return info.brexchange, brsymbol
    except Exception as e:
        logger.debug(f"Token lookup failed for {symbol}@{oa_exchange}: {e}")
    # Fallback: use static exchange map, keep original symbol
    kite_exchange = _KITE_EXCHANGE_MAP.get(oa_exchange, oa_exchange)
    return kite_exchange, symbol


def _ws_fetch_ticks(symbols: list[dict], mode: str = "Quote") -> dict:
    """Connect to WS proxy, subscribe, and collect ticks for symbols.

    Resolves OA exchange/symbol to the correct token before subscribing,
    matching the mapping used by the WS adapter.

    Args:
        symbols: List of {"exchange": "NSE", "symbol": "INFY"}
        mode: "LTP", "Quote", or "Depth"

    Returns:
        Dict keyed by "exchange:symbol" with tick data
    """
    api_key = _get_api_key()
    if not api_key:
        logger.warning("No API key found for WS on-demand fetch")
        return {}

    ws_url = _get_ws_url()

    resolved_symbols = []
    for s in symbols:
        oa_exchange = s["exchange"]
        oa_symbol = s["symbol"]
        kite_exchange, brsymbol = _resolve_kite_exchange(oa_exchange, oa_symbol)
        logger.debug(
            f"WS fetch resolve: {oa_symbol}@{oa_exchange} -> {brsymbol}@{kite_exchange}"
        )
        resolved_symbols.append({
            "exchange": oa_exchange,
            "symbol": oa_symbol,
            "_kite_exchange": kite_exchange,
            "_brsymbol": brsymbol,
        })

    collected = {}
    lock = threading.Lock()
    auth_done = threading.Event()
    sub_done = threading.Event()
    ticks_received = threading.Event()

    def on_message(ws, message):
        data = json.loads(message)
        msg_type = data.get("type")

        if msg_type == "auth" and data.get("status") == "success":
            auth_done.set()
            ws.send(json.dumps({
                "action": "subscribe",
                "mode": mode,
                "symbols": [{"exchange": s["exchange"], "symbol": s["symbol"]} for s in resolved_symbols],
            }))

        elif msg_type == "subscribe":
            sub_done.set()

        elif msg_type == "market_data":
            sym = data.get("symbol", "")
            exch = data.get("exchange", "")
            key = f"{exch}:{sym}"
            with lock:
                collected[key] = data.get("data", {})
            ticks_received.set()

    def on_open(ws):
        ws.send(json.dumps({
            "action": "authenticate",
            "api_key": api_key,
        }))

    def on_error(ws, error):
        logger.debug(f"WS on-demand error: {error}")

    def on_close(ws, code, msg):
        pass

    ws = websocket.WebSocketApp(
        ws_url,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )

    t = threading.Thread(target=ws.run_forever, daemon=True)
    t.start()

    # Wait for auth
    if not auth_done.wait(timeout=2.0):
        logger.warning("WS on-demand: auth timeout")
        try:
            ws.close()
        except Exception:
            pass
        return {}

    # Wait for subscribe ack
    if not sub_done.wait(timeout=2.0):
        logger.warning("WS on-demand: subscribe timeout")
        try:
            ws.close()
        except Exception:
            pass
        return {}

    # Wait for ticks — up to TICK_TIMEOUT, check periodically
    deadline = time.time() + TICK_TIMEOUT
    while time.time() < deadline:
        with lock:
            if len(collected) >= len(symbols):
                break
        time.sleep(0.05)

    try:
        ws.close()
    except Exception:
        pass

    return collected


def ws_get_quotes(symbol: str, exchange: str) -> dict:
    """On-demand single quote via WS proxy.

    Returns OpenAlgo quote format or empty dict.
    """
    ticks = _ws_fetch_ticks([{"exchange": exchange, "symbol": symbol}], mode="Depth")
    key = f"{exchange}:{symbol}"
    data = ticks.get(key, {})
    if not data:
        return {}

    return {
        "ask": data.get("depth", {}).get("sell", [{}])[0].get("price", 0) if "depth" in data else 0,
        "bid": data.get("depth", {}).get("buy", [{}])[0].get("price", 0) if "depth" in data else 0,
        "high": data.get("high", 0),
        "low": data.get("low", 0),
        "ltp": data.get("ltp", 0),
        "open": data.get("open", 0),
        "prev_close": data.get("close", 0),
        "volume": data.get("volume", 0),
        "oi": data.get("oi", 0),
    }


def ws_get_ltp(symbol: str, exchange: str) -> float:
    """On-demand single LTP via WS proxy."""
    ticks = _ws_fetch_ticks([{"exchange": exchange, "symbol": symbol}], mode="LTP")
    key = f"{exchange}:{symbol}"
    data = ticks.get(key, {})
    return data.get("ltp", 0)


def ws_get_multiquotes(symbols: list[dict]) -> list:
    """On-demand multi-quotes via WS proxy.

    Args:
        symbols: List of {"symbol": "INFY", "exchange": "NSE"}

    Returns:
        List of {"symbol", "exchange", "data": {...}}
    """
    ws_symbols = [{"exchange": s["exchange"], "symbol": s["symbol"]} for s in symbols]
    ticks = _ws_fetch_ticks(ws_symbols, mode="Depth")

    results = []
    for s in symbols:
        key = f"{s['exchange']}:{s['symbol']}"
        data = ticks.get(key, {})
        results.append({
            "symbol": s["symbol"],
            "exchange": s["exchange"],
            "data": {
                "ask": data.get("depth", {}).get("sell", [{}])[0].get("price", 0) if "depth" in data else 0,
                "bid": data.get("depth", {}).get("buy", [{}])[0].get("price", 0) if "depth" in data else 0,
                "high": data.get("high", 0),
                "low": data.get("low", 0),
                "ltp": data.get("ltp", 0),
                "open": data.get("open", 0),
                "prev_close": data.get("close", 0),
                "volume": data.get("volume", 0),
                "oi": data.get("oi", 0),
            } if data else {},
        })
    return results


def ws_get_depth(symbol: str, exchange: str) -> dict:
    """On-demand depth via WS proxy. Matches original zerodha get_market_depth format."""
    ticks = _ws_fetch_ticks([{"exchange": exchange, "symbol": symbol}], mode="Depth")
    key = f"{exchange}:{symbol}"
    data = ticks.get(key, {})
    if not data:
        return {}

    depth = data.get("depth", {})
    buy_orders = depth.get("buy", [])
    sell_orders = depth.get("sell", [])

    asks = []
    bids = []

    for i in range(5):
        if i < len(sell_orders):
            asks.append({
                "price": sell_orders[i].get("price", 0),
                "quantity": sell_orders[i].get("quantity", 0),
            })
        else:
            asks.append({"price": 0, "quantity": 0})

    for i in range(5):
        if i < len(buy_orders):
            bids.append({
                "price": buy_orders[i].get("price", 0),
                "quantity": buy_orders[i].get("quantity", 0),
            })
        else:
            bids.append({"price": 0, "quantity": 0})

    return {
        "asks": asks,
        "bids": bids,
        "high": data.get("high", 0),
        "low": data.get("low", 0),
        "ltp": data.get("ltp", 0),
        "ltq": data.get("last_quantity", 0),
        "oi": data.get("oi", 0),
        "open": data.get("open", 0),
        "prev_close": data.get("close", 0),
        "totalbuyqty": sum(order.get("quantity", 0) for order in buy_orders),
        "totalsellqty": sum(order.get("quantity", 0) for order in sell_orders),
        "volume": data.get("volume", 0),
    }
