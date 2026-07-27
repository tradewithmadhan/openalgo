"""
Shared volume spike detection used by both the API endpoint and notification service.

Single source of truth for:
- detect_volume_spike() — full pipeline: volume aggregation + spike detection
- compute_spike_flags() — spike detection only on pre-computed combined values
"""

from collections import defaultdict
from utils.logging import get_logger

logger = get_logger(__name__)

WARMUP = 5
WINDOW = 20
THRESHOLD = 2.0


def detect_volume_spike(all_historical_data):
    """
    Compute CE/PE volume per candle across ALL strikes and detect spikes.

    Returns list of dicts (one per candle), sorted by timestamp:
      {timestamp_ms, ce_volume, pe_volume, combined, is_spike}

    Spike detection (same as existing endpoint):
      - Skip first WARMUP candles
      - For each candle, compute rolling WINDOW average of combined volume
      - If combined > avg * THRESHOLD → spike
      - Consecutive spike cleanup: drop spikes where volume decreased

    Parameters:
        all_historical_data: list of dicts from get_current_day_historical_data()
            Each dict has: symbol, timestamp, oi, close, volume
    """
    if not all_historical_data:
        return []

    data_by_ts = defaultdict(list)
    for row in all_historical_data:
        data_by_ts[row['timestamp']].append(row)

    sorted_timestamps = sorted(data_by_ts.keys())
    result = []

    for ts in sorted_timestamps:
        total_ce_volume = 0
        total_pe_volume = 0

        for item in data_by_ts[ts]:
            symbol = item['symbol']
            if symbol == 'NIFTY':
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

    # Detect spikes
    combined_values = [r['combined'] for r in result]
    for i in range(WARMUP, len(combined_values)):
        start = max(0, i - WINDOW)
        window = combined_values[start:i]
        if not window:
            continue
        avg = sum(window) / len(window)
        if avg > 0 and combined_values[i] > avg * THRESHOLD:
            result[i]['is_spike'] = True

    # Consecutive spike cleanup: drop spikes where volume decreased from previous
    i = 0
    while i < len(result):
        if not result[i]['is_spike']:
            i += 1
            continue
        run_start = i
        while i < len(result) and result[i]['is_spike']:
            i += 1
        run_end = i
        prev_vol = combined_values[run_start]
        for k in range(run_start + 1, run_end):
            if combined_values[k] < prev_vol:
                result[k]['is_spike'] = False
            else:
                prev_vol = combined_values[k]

    return result


def compute_spike_flags(combined_values):
    """
    Detect spikes from a list of pre-computed combined volume values.

    Returns list of booleans (same length as combined_values).
    Used by the API endpoint when volumes are pre-aggregated with filtering.

    Same logic as detect_volume_spike():
      - Skip first WARMUP candles
      - Rolling WINDOW average, THRESHOLD = 2.0x
      - Consecutive spike cleanup
    """
    vol_spike = [False] * len(combined_values)
    for i in range(WARMUP, len(combined_values)):
        start = max(0, i - WINDOW)
        window = combined_values[start:i]
        if not window:
            continue
        avg = sum(window) / len(window)
        if avg > 0 and combined_values[i] > avg * THRESHOLD:
            vol_spike[i] = True

    # Consecutive spike cleanup: drop spikes where volume decreased from previous
    i = 0
    while i < len(vol_spike):
        if not vol_spike[i]:
            i += 1
            continue
        run_start = i
        while i < len(vol_spike) and vol_spike[i]:
            i += 1
        run_end = i
        prev_vol = combined_values[run_start]
        for k in range(run_start + 1, run_end):
            if combined_values[k] < prev_vol:
                vol_spike[k] = False
            else:
                prev_vol = combined_values[k]

    return vol_spike
