"""
Shared volume spike detection used by both the API endpoint and notification service.

Single source of truth for:
- detect_volume_spike() — full pipeline: volume aggregation + spike detection
- compute_spike_flags() — spike detection on pre-computed values

Spike detection has THREE triggers (OR logic):
  1. Upside peak:  NIFTY high > max of last 3 highs + volume at 3-candle high + volume > rolling avg
  2. Downside valley: NIFTY low < min of last 3 lows + volume at 3-candle high + volume > rolling avg
  3. Volume surge (existing): combined > rolling_avg * THRESHOLD
"""

from collections import defaultdict
from utils.logging import get_logger

logger = get_logger(__name__)

WARMUP = 5
WINDOW = 20
THRESHOLD = 2.0
LOOKBACK = 4


def detect_volume_spike(all_historical_data):
    """
    Compute CE/PE volume per candle across ALL strikes and detect spikes.

    Returns list of dicts (one per candle), sorted by timestamp:
      {timestamp_ms, ce_volume, pe_volume, combined, is_spike}

    Parameters:
        all_historical_data: list of dicts from get_current_day_historical_data()
            Each dict has: symbol, timestamp, oi, high (NIFTY only), low (NIFTY only), close, volume
    """
    if not all_historical_data:
        return []

    data_by_ts = defaultdict(list)
    for row in all_historical_data:
        data_by_ts[row['timestamp']].append(row)

    sorted_timestamps = sorted(data_by_ts.keys())
    result = []
    nifty_highs = []
    nifty_lows = []

    for ts in sorted_timestamps:
        total_ce_volume = 0
        total_pe_volume = 0
        spot_high = None
        spot_low = None

        for item in data_by_ts[ts]:
            symbol = item['symbol']
            if symbol == 'NIFTY':
                spot_high = item.get('high')
                spot_low = item.get('low')
                continue

            volume = item.get('volume', 0)
            if volume > 0:
                if symbol.endswith('CE'):
                    total_ce_volume += volume
                elif symbol.endswith('PE'):
                    total_pe_volume += volume

        combined = abs(total_ce_volume) + abs(total_pe_volume)
        result.append({
            'timestamp_ms': ts * 1000,
            'ce_volume': total_ce_volume,
            'pe_volume': total_pe_volume,
            'combined': combined,
            'is_spike': False,
        })
        nifty_highs.append(spot_high)
        nifty_lows.append(spot_low)

    combined_values = [r['combined'] for r in result]
    spike_flags = _compute_spike_flags(combined_values, nifty_highs, nifty_lows)
    for i, is_spike in enumerate(spike_flags):
        result[i]['is_spike'] = is_spike

    return result


def compute_spike_flags(combined_values, nifty_highs=None, nifty_lows=None):
    """
    Detect spikes from pre-computed combined volume values.

    Parameters:
        combined_values: list of combined CE+PE volume per candle
        nifty_highs: list of NIFTY high per candle (same length as combined_values)
        nifty_lows: list of NIFTY low per candle (same length as combined_values)

    Returns list of booleans (same length as combined_values).
    """
    return _compute_spike_flags(combined_values, nifty_highs, nifty_lows)


def _compute_spike_flags(combined_values, nifty_highs=None, nifty_lows=None):
    n = len(combined_values)
    vol_spike = [False] * n

    has_nifty_data = nifty_highs is not None and nifty_lows is not None
    last_signal_vol = None  # Track previous signal volume for deduplication

    for i in range(WARMUP, n):
        start = max(0, i - WINDOW)
        window = combined_values[start:i]
        if not window:
            continue
        avg = sum(window) / len(window)

        existing_spike = avg > 0 and combined_values[i] > avg * THRESHOLD

        new_pattern = False
        if has_nifty_data and i >= LOOKBACK:
            highs_window = nifty_highs[i - LOOKBACK:i]
            lows_window = nifty_lows[i - LOOKBACK:i]
            vols_window = combined_values[i - LOOKBACK:i]

            highs_valid = all(h is not None for h in highs_window) and nifty_highs[i] is not None
            lows_valid = all(l is not None for l in lows_window) and nifty_lows[i] is not None
            vols_valid = all(v > 0 for v in vols_window) and combined_values[i] > 0

            if highs_valid and vols_valid:
                price_peak = nifty_highs[i] > max(highs_window)
                vol_peak = combined_values[i] > max(vols_window)
                if price_peak and vol_peak and combined_values[i] > avg * 1.8:
                    new_pattern = True

            if not new_pattern and lows_valid and vols_valid:
                price_valley = nifty_lows[i] < min(lows_window)
                vol_peak = combined_values[i] > max(vols_window)
                if price_valley and vol_peak and combined_values[i] > avg * 1.8:
                    new_pattern = True

        is_spike_now = existing_spike or new_pattern

        # Deduplication: after a signal fires, suppress next signals
        # where volume is less than the previous signal's volume.
        # This prevents back-to-back duplicate spikes.
        if is_spike_now:
            if last_signal_vol is not None and combined_values[i] < last_signal_vol:
                is_spike_now = False
            else:
                last_signal_vol = combined_values[i]
        else:
            # Reset when volume drops below rolling average (signal chain broken)
            if last_signal_vol is not None and combined_values[i] < avg:
                last_signal_vol = None

        vol_spike[i] = is_spike_now

    return vol_spike
