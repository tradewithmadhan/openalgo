"""
HighCross / LowCross change-count computation.

Single source of truth for counting how many strikes had a
running-high (HighCross) or running-low (LowCross) change at each
timestamp.

Used by:
  - blueprints/madhan.py  -> /api/nifty/hx_lx_vol  endpoint
"""
from collections import defaultdict
from utils.logging import get_logger

logger = get_logger(__name__)


def _aggregate_high_low(all_historical_data, all_symbols):
    """
    Group raw rows from get_current_day_historical_data() by timestamp.

    Returns:
        sorted_ts      : list[int]  – ascending timestamps
        ts_symbol_data : dict[int, dict[symbol, dict]] – {ts: {sym: {'high':, 'low':, 'volume':}}}
    """
    ts_symbol_data = defaultdict(lambda: defaultdict(dict))
    for row in all_historical_data:
        symbol = row['symbol']
        if symbol in all_symbols:
            ts_symbol_data[row['timestamp']][symbol] = {
                'high': row.get('high'),
                'low': row.get('low'),
                'volume': row.get('volume', 0),
            }
    return sorted(ts_symbol_data.keys()), ts_symbol_data


def compute_hx_lx_counts(all_historical_data, strikes, get_symbol):
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

    Returns
    -------
    list[dict]  – one element per timestamp, sorted ascending:
        {
            'timestamp': int,    # unix ms timestamp (consistent with other endpoints)
            'ce_hx': int,
            'pe_hx': int,
            'ce_lx': int,
            'pe_lx': int,
            'ce_changes': int,   # total CE volume across all strikes at this timestamp
            'pe_changes': int,   # total PE volume across all strikes at this timestamp
        }
    """
    if not all_historical_data or not strikes:
        return []

    # ------------------------------------------------------------------
    # Build symbol → lists for CE and PE
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

    all_symbols = set(ce_symbols + pe_symbols)

    sorted_ts, ts_symbol_data = _aggregate_high_low(all_historical_data, all_symbols)
    if not sorted_ts:
        return []

    # ------------------------------------------------------------------
    # For each symbol, build aligned high/low/volume arrays
    # ------------------------------------------------------------------
    symbol_highs = {s: [] for s in all_symbols}
    symbol_lows = {s: [] for s in all_symbols}
    symbol_volumes = {s: [] for s in all_symbols}
    for ts in sorted_ts:
        for s in all_symbols:
            candle = ts_symbol_data[ts].get(s, {})
            symbol_highs[s].append(candle.get('high'))
            symbol_lows[s].append(candle.get('low'))
            symbol_volumes[s].append(candle.get('volume', 0))

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
    # For each timestamp, count CE/PE changes and sum volumes
    # ------------------------------------------------------------------
    results = []
    prev_ce_highs = {}
    prev_pe_highs = {}
    prev_ce_lows = {}
    prev_pe_lows = {}

    for idx, ts in enumerate(sorted_ts):
        ce_hx_count = 0
        pe_hx_count = 0
        ce_lx_count = 0
        pe_lx_count = 0
        ce_total_volume = 0
        pe_total_volume = 0

        for s in ce_symbols:
            vol = symbol_volumes[s][idx]
            if vol > 0:
                ce_total_volume += vol

            current_hx = symbol_running_highs[s][idx]
            if current_hx is not None:
                prev_hx = prev_ce_highs.get(s)
                if prev_hx is not None and current_hx != prev_hx:
                    ce_hx_count += 1
                prev_ce_highs[s] = current_hx

            current_lx = symbol_running_lows[s][idx]
            if current_lx is not None:
                prev_lx = prev_ce_lows.get(s)
                if prev_lx is not None and current_lx != prev_lx:
                    ce_lx_count += 1
                prev_ce_lows[s] = current_lx

        for s in pe_symbols:
            vol = symbol_volumes[s][idx]
            if vol > 0:
                pe_total_volume += vol

            current_hx = symbol_running_highs[s][idx]
            if current_hx is not None:
                prev_hx = prev_pe_highs.get(s)
                if prev_hx is not None and current_hx != prev_hx:
                    pe_hx_count += 1
                prev_pe_highs[s] = current_hx

            current_lx = symbol_running_lows[s][idx]
            if current_lx is not None:
                prev_lx = prev_pe_lows.get(s)
                if prev_lx is not None and current_lx != prev_lx:
                    pe_lx_count += 1
                prev_pe_lows[s] = current_lx

        results.append({
            'timestamp': ts,
            'ce_hx': ce_hx_count,
            'pe_hx': pe_hx_count,
            'ce_lx': ce_lx_count,
            'pe_lx': pe_lx_count,
            'ce_changes': ce_total_volume,
            'pe_changes': pe_total_volume,
        })

    return results
