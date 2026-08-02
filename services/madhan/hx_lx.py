"""
HighCross / LowCross change-count computation.

Single source of truth for counting how many strikes had a
running-high (HighCross) or running-low (LowCross) change at each
timestamp.

Used by:
  - blueprints/madhan.py  -> /api/nifty/hx_lx_vol  endpoint
"""
from collections import defaultdict
import numpy as np
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


def _vectorized_hx_lx(symbols, sorted_ts, ts_symbol_data):
    """Vectorized running-max/min change detection using numpy.

    Returns (hx_counts, lx_counts, total_volumes) as numpy arrays.
    """
    n_ts = len(sorted_ts)
    if not symbols or n_ts == 0:
        return np.zeros(n_ts, dtype=int), np.zeros(n_ts, dtype=int), np.zeros(n_ts, dtype=int)

    n_sym = len(symbols)

    # Build 2D arrays: shape (n_ts, n_sym) with NaN for missing
    highs = np.full((n_ts, n_sym), np.nan, dtype=np.float64)
    lows = np.full((n_ts, n_sym), np.nan, dtype=np.float64)
    vols = np.zeros((n_ts, n_sym), dtype=np.int64)

    for j, s in enumerate(symbols):
        for i, ts in enumerate(sorted_ts):
            candle = ts_symbol_data[ts].get(s, {})
            h = candle.get('high')
            l = candle.get('low')
            if h is not None:
                highs[i, j] = h
            if l is not None:
                lows[i, j] = l
            vols[i, j] = candle.get('volume', 0)

    def _running_and_changes(arr):
        """Forward-fill NaN, compute running max/min, detect changes."""
        # Forward fill NaN along axis 0
        mask = ~np.isnan(arr)
        idx = np.where(mask, np.arange(n_ts)[:, None], 0)
        np.maximum.accumulate(idx, axis=0, out=idx)
        filled = arr[idx, np.arange(n_sym)[None, :]]

        # Running max (or min for lows — caller passes the right arr)
        return filled

    # Running max for highs
    highs_filled = _running_and_changes(highs)
    run_high = np.maximum.accumulate(highs_filled, axis=0)

    # Running min for lows
    lows_filled = _running_and_changes(lows)
    run_low = np.minimum.accumulate(lows_filled, axis=0)

    # Change detection: both current and previous non-NaN and different
    hx_changes = np.zeros((n_ts, n_sym), dtype=bool)
    lx_changes = np.zeros((n_ts, n_sym), dtype=bool)

    if n_ts > 1:
        hx_changes[1:] = (run_high[1:] != run_high[:-1]) & ~np.isnan(run_high[1:]) & ~np.isnan(run_high[:-1])
        lx_changes[1:] = (run_low[1:] != run_low[:-1]) & ~np.isnan(run_low[1:]) & ~np.isnan(run_low[:-1])

    hx_counts = np.sum(hx_changes, axis=1)
    lx_counts = np.sum(lx_changes, axis=1)
    total_volumes = np.sum(vols, axis=1)

    return hx_counts, lx_counts, total_volumes


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
            'timestamp': int,
            'ce_hx': int,
            'pe_hx': int,
            'ce_lx': int,
            'pe_lx': int,
            'ce_changes': int,
            'pe_changes': int,
        }
    """
    if not all_historical_data or not strikes:
        return []

    # Build symbol → lists for CE and PE
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

    # Vectorized computation for CE and PE
    ce_hx, ce_lx, ce_vol = _vectorized_hx_lx(ce_symbols, sorted_ts, ts_symbol_data)
    pe_hx, pe_lx, pe_vol = _vectorized_hx_lx(pe_symbols, sorted_ts, ts_symbol_data)

    # Build results list
    results = []
    for idx, ts in enumerate(sorted_ts):
        results.append({
            'timestamp': ts,
            'ce_hx': int(ce_hx[idx]),
            'pe_hx': int(pe_hx[idx]),
            'ce_lx': int(ce_lx[idx]),
            'pe_lx': int(pe_lx[idx]),
            'ce_changes': int(ce_vol[idx]),
            'pe_changes': int(pe_vol[idx]),
        })

    return results
