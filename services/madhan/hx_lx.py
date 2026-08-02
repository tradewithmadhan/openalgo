"""
HighCross / LowCross change-count computation.

Single source of truth for counting how many strikes had a
running-high (HighCross) or running-low (LowCross) change at each
timestamp.

Used by:
  - blueprints/madhan.py  -> /api/nifty/hx-lx  endpoint
"""
from collections import defaultdict
from utils.logging import get_logger

logger = get_logger(__name__)


def _aggregate_high_low(all_historical_data):
    """
    Group raw rows from get_current_day_historical_data() by timestamp.

    Returns:
        sorted_ts     : list[int]  – ascending timestamps
        ce_data       : dict[int, dict[symbol, dict]] – {ts: {sym: {'high':, 'low':, 'close':, 'volume':}}}
        pe_data       : dict[int, dict[symbol, dict]] – same structure for PE symbols
        nifty_highs   : dict[int, float|None]   – NIFTY high per timestamp
        nifty_lows    : dict[int, float|None]   – NIFTY low per timestamp
    """
    data_by_ts = defaultdict(lambda: defaultdict(dict))
    nifty_highs = {}
    nifty_lows = {}

    for row in all_historical_data:
        symbol = row['symbol']
        ts = row['timestamp']
        if symbol == 'NIFTY':
            nifty_highs[ts] = row.get('high')
            nifty_lows[ts] = row.get('low')
            continue
        data_by_ts[ts][symbol] = {
            'high': row.get('high'),
            'low': row.get('low'),
            'close': row.get('close'),
            'volume': row.get('volume', 0),
        }

    return sorted(data_by_ts.keys()), nifty_highs, nifty_lows


def compute_hx_lx_counts(all_historical_data, strikes, get_symbol, timeframe=1):
    """
    Compute HighCross and LowCross change-counts per timestamp.

    Parameters
    ----------
    all_historical_data : list[dict]
        Rows from get_current_day_historical_data().  Each row has:
        symbol, timestamp, open, high, low, close, volume, oi

    strikes : list[int]
        Strike prices to include (e.g. [24000, 24050, ...]).

    get_symbol : callable
        ``get_symbol(strike: int, type: 'CE'|'PE') -> str|None``

    timeframe : int
        Aggregation period in minutes (1, 3, 5, 15).

    Returns
    -------
    list[dict]  – one element per timestamp, sorted ascending:
        {
            'timestamp_ms': int,
            'ce_hx': int,   # how many CE strikes had running-max(high) change
            'pe_hx': int,
            'ce_lx': int,   # how many CE strikes had running-min(low) change
            'pe_lx': int,
        }
    """
    if not all_historical_data or not strikes:
        return []

    sorted_ts, nifty_highs, nifty_lows = _aggregate_high_low(all_historical_data)
    if not sorted_ts:
        return []

    # ------------------------------------------------------------------
    # Build symbol → strike lists for CE and PE
    # ------------------------------------------------------------------
    ce_symbols = []
    pe_symbols = []
    for strike in strikes:
        ce = get_symbol(strike, 'CE')
        pe = get_symbol(strike, 'PE')
        if ce:
            ce_symbols.append(ce)
        if pe:
            pe_symbols.append(pe)

    # ------------------------------------------------------------------
    # Collect per-symbol candle lists (aligned to sorted timestamps)
    # ------------------------------------------------------------------
    # symbol -> list of {ts, high, low}
    all_symbols = ce_symbols + pe_symbols
    symbol_candles = {s: [] for s in all_symbols}

    for ts in sorted_ts:
        bucket = {}
        # We iterate the raw data once instead of re-reading
        # Actually we need to iterate all_historical_data per ts — optimize:
        pass

    # Optimised: build ts → symbol → candle in one pass
    ts_symbol_candle = defaultdict(dict)   # {ts: {sym: {'high':, 'low':}}}
    for row in all_historical_data:
        symbol = row['symbol']
        if symbol not in symbol_candles:
            continue
        ts_symbol_candle[row['timestamp']][symbol] = {
            'high': row.get('high'),
            'low': row.get('low'),
        }

    # Sort timestamps
    sorted_timestamps = sorted(ts_symbol_candle.keys())
    if not sorted_timestamps:
        return []

    # ------------------------------------------------------------------
    # For each symbol, build aligned high/low arrays
    # ------------------------------------------------------------------
    symbol_highs = {s: [] for s in all_symbols}
    symbol_lows = {s: [] for s in all_symbols}
    for ts in sorted_timestamps:
        for s in all_symbols:
            candle = ts_symbol_candle[ts].get(s)
            if candle:
                symbol_highs[s].append(candle['high'])
                symbol_lows[s].append(candle['low'])
            else:
                symbol_highs[s].append(None)
                symbol_lows[s].append(None)

    # ------------------------------------------------------------------
    # Compute running max(high) and running min(low) per symbol
    # ------------------------------------------------------------------
    def _running_max(values):
        """Returns list where each element is the running max up to that point."""
        result = []
        current_max = None
        for v in values:
            if v is not None:
                current_max = v if current_max is None else max(current_max, v)
            result.append(current_max)
        return result

    def _running_min(values):
        """Returns list where each element is the running min up to that point."""
        result = []
        current_min = None
        for v in values:
            if v is not None:
                current_min = v if current_min is None else min(current_min, v)
            result.append(current_min)
        return result

    # Pre-compute running max/min for each symbol
    symbol_running_highs = {s: _running_max(symbol_highs[s]) for s in all_symbols}
    symbol_running_lows = {s: _running_min(symbol_lows[s]) for s in all_symbols}

    # ------------------------------------------------------------------
    # For each timestamp, count how many symbols had a change
    # ------------------------------------------------------------------
    results = []
    prev_ce_highs = {}
    prev_pe_highs = {}
    prev_ce_lows = {}
    prev_pe_lows = {}

    for idx, ts in enumerate(sorted_timestamps):
        ce_hx_count = 0
        pe_hx_count = 0
        ce_lx_count = 0
        pe_lx_count = 0

        for s in ce_symbols:
            current_hx = symbol_running_highs[s][idx]
            current_lx = symbol_running_lows[s][idx]

            if current_hx is not None:
                prev_hx = prev_ce_highs.get(s)
                if prev_hx is not None and current_hx != prev_hx:
                    ce_hx_count += 1
                prev_ce_highs[s] = current_hx

            if current_lx is not None:
                prev_lx = prev_ce_lows.get(s)
                if prev_lx is not None and current_lx != prev_lx:
                    ce_lx_count += 1
                prev_ce_lows[s] = current_lx

        for s in pe_symbols:
            current_hx = symbol_running_highs[s][idx]
            current_lx = symbol_running_lows[s][idx]

            if current_hx is not None:
                prev_hx = prev_pe_highs.get(s)
                if prev_hx is not None and current_hx != prev_hx:
                    pe_hx_count += 1
                prev_pe_highs[s] = current_hx

            if current_lx is not None:
                prev_lx = prev_pe_lows.get(s)
                if prev_lx is not None and current_lx != prev_lx:
                    pe_lx_count += 1
                prev_pe_lows[s] = current_lx

        results.append({
            'timestamp_ms': ts * 1000,
            'ce_hx': ce_hx_count,
            'pe_hx': pe_hx_count,
            'ce_lx': ce_lx_count,
            'pe_lx': pe_lx_count,
        })

    return results
