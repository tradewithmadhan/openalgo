"""
Shared ATP-LTP signal computation used by both the API endpoint and notification service.

Single source of truth for:
- compute_atp_from_candles()
- compute_atp_signal()
- compute_final_signal()
- detect_trade_signals()
- process_historical_atp_data()
"""

from datetime import datetime, time
from collections import defaultdict
from bisect import bisect_right
from utils.logging import get_logger
from database.madhan_db import get_valid_trading_day, extract_strike

logger = get_logger(__name__)


def compute_atp_from_accumulated(total_turnover, total_volume, fallback_ltp=0):
    """Compute ATP from accumulated turnover/volume. NSE formula: ATP = Total Turnover / Total Volume."""
    try:
        total_volume_f = float(total_volume)
        total_turnover_f = float(total_turnover)
    except (TypeError, ValueError):
        return fallback_ltp
    if total_volume_f > 0:
        return total_turnover_f / total_volume_f
    return fallback_ltp


def compute_atp_from_candles(candles, fallback_ltp=0):
    """Compute ATP from a list of candle dicts with 'volume' and 'close' keys."""
    total_volume = 0
    total_turnover = 0
    for candle in candles:
        volume = candle.get('volume', 0)
        close_price = candle.get('close', 0)
        if volume > 0 and close_price > 0:
            total_volume += volume
            total_turnover += close_price * volume
    return compute_atp_from_accumulated(total_turnover, total_volume, fallback_ltp)


def compute_atp_signal(atm_atp, atm_ltp, itm1_atp, itm1_ltp, itm2_atp, itm2_ltp):
    """
    Check if ITM ATP-LTP differences are both < ATM ATP-LTP difference.
    Returns bool.
    """
    if not all([atm_atp, atm_ltp, itm1_atp, itm1_ltp, itm2_atp, itm2_ltp]):
        return False
    atm_diff = atm_atp - atm_ltp
    itm1_diff = itm1_atp - itm1_ltp
    itm2_diff = itm2_atp - itm2_ltp
    return (itm1_diff < atm_diff) and (itm2_diff < atm_diff)


def compute_final_signal(call_signal, put_signal, call_sma=False, put_sma=False):
    """Classify candle direction from ATP signals and SMA signals."""
    if call_signal and put_signal:
        return "Sideways"
    if call_signal and not put_signal and not put_sma:
        return "Bullish"
    if put_signal and not call_signal and not call_sma:
        return "Bearish"
    return "Neutral"


def compute_sma_from_series(series, new_value):
    """Append value to series and compute SMA(5) > SMA(8) signal. Returns bool."""
    if new_value is None:
        return False
    try:
        val = float(new_value)
    except (TypeError, ValueError):
        return False
    if val <= 0:
        return False
    series.append(val)
    if len(series) < 8:
        return False
    sma5 = sum(series[-5:]) / 5.0
    sma8 = sum(series[-8:]) / 8.0
    return sma5 > sma8


def compute_sma_signal(price_by_symbol, ts_by_symbol, symbol, timestamp):
    """
    Compute SMA(5) > SMA(8) for a specific symbol at a timestamp
    using 8 consecutive 1-minute candles.
    """
    if not symbol:
        return False
    prices = price_by_symbol.get(symbol)
    tss = ts_by_symbol.get(symbol)
    if not prices or not tss:
        return False
    idx = bisect_right(tss, int(timestamp))
    if idx < 8:
        return False
    last_ts = tss[idx - 8:idx]
    for i in range(1, len(last_ts)):
        if last_ts[i] - last_ts[i - 1] != 60:
            return False
    last_prices = prices[idx - 8:idx]
    sma5 = sum(last_prices[-5:]) / 5.0
    sma8 = sum(last_prices[-8:]) / 8.0
    return sma5 > sma8


def detect_trade_signals(historical_data):
    """
    Detect trade signals from processed historical_data list.
    Mutates each entry in-place, adding 'trade_signal' = True or None.
    Rule: after 2+ consecutive Sideways, 2nd consecutive same-direction = True.
    """
    sideways_count = 0
    consecutive_count = 0
    last_direction = ''

    for entry in historical_data:
        sig = entry.get('final_signal', '')
        entry['trade_signal'] = None

        if sig == 'Sideways':
            sideways_count += 1
            consecutive_count = 0
            last_direction = ''
        elif sig in ('Bullish', 'Bearish'):
            if sideways_count >= 2:
                if sig != last_direction:
                    last_direction = sig
                    consecutive_count = 1
                else:
                    consecutive_count += 1
                if consecutive_count == 2:
                    entry['trade_signal'] = True
                    sideways_count = 0
            else:
                sideways_count = 0
                consecutive_count = 0
                last_direction = sig
        else:
            sideways_count = 0


def process_historical_atp_data(all_historical_data, current_atm_strike):
    """
    Process raw DB data into historical_data list with all signal fields and trade_signal.

    Same logic as the /api/atp-ltp-data endpoint historical processing.
    Returns list of dicts with all signal fields.

    Parameters:
        all_historical_data: list of dicts from get_current_day_historical_data()
            Each dict has: symbol, timestamp, oi, close, volume
        current_atm_strike: int, current ATM strike price
    """
    if not all_historical_data:
        return []

    # Group by timestamp and accumulate volume-weighted data by symbol
    data_by_ts = defaultdict(list)
    nifty_by_ts = {}
    symbol_volume_data = {}

    all_historical_data.sort(key=lambda x: x['timestamp'])

    for row in all_historical_data:
        if row['symbol'] == 'NIFTY':
            nifty_by_ts[row['timestamp']] = row['close']
        else:
            data_by_ts[row['timestamp']].append(row)

            symbol = row['symbol']
            timestamp = row['timestamp']
            raw_close = row.get('close', 0)
            raw_volume = row.get('volume', 0)

            try:
                close = float(raw_close) if raw_close is not None else 0.0
            except (TypeError, ValueError):
                close = 0.0
            try:
                volume = float(raw_volume) if raw_volume is not None else 0.0
            except (TypeError, ValueError):
                volume = 0.0

            if close != close or close < 0:
                close = 0.0
            if volume != volume or volume < 0:
                volume = 0.0

            if symbol not in symbol_volume_data:
                symbol_volume_data[symbol] = {}

            prev_timestamps = [t for t in symbol_volume_data[symbol].keys() if t < timestamp]
            if prev_timestamps:
                latest_prev_timestamp = max(prev_timestamps)
                prev_data = symbol_volume_data[symbol][latest_prev_timestamp]
            else:
                prev_data = {'total_volume': 0.0, 'total_turnover': 0.0}

            new_total_volume = prev_data['total_volume'] + (volume if volume > 0 else 0.0)
            new_total_turnover = prev_data['total_turnover'] + (close * volume if volume > 0 and close > 0 else 0.0)

            symbol_volume_data[symbol][timestamp] = {
                'total_volume': new_total_volume,
                'total_turnover': new_total_turnover
            }

    # Sort timestamps and filter market hours
    sorted_ts = sorted(nifty_by_ts.keys())
    today_trading = get_valid_trading_day(exchange="NSE")
    market_open = datetime.combine(today_trading, time(9, 15))
    market_close = datetime.combine(today_trading, time(15, 30))
    market_open_ts = int(market_open.timestamp())
    market_close_ts = int(market_close.timestamp())

    # Stateful series for SMA computation
    historical_data = []
    spot_ltp_series = []
    ltp_series_by_symbol = {}
    ts_series_by_symbol = {}

    for ts in sorted_ts:
        if ts < market_open_ts or ts > market_close_ts:
            continue

        historical_spot_ltp = nifty_by_ts.get(ts, 0)
        if historical_spot_ltp == 0:
            continue

        historical_atm_strike = round(historical_spot_ltp / 50) * 50

        # Find symbol and LTP for a given strike/suffix at this timestamp
        option_data_at_ts = data_by_ts.get(ts, [])

        def _find_symbol_and_ltp(strike_val, suffix):
            for option in option_data_at_ts:
                symbol = option.get('symbol', '')
                if not symbol or not symbol.endswith(suffix):
                    continue
                strike = extract_strike(symbol)
                if strike != strike_val:
                    continue
                ltp_val = option.get('close', None)
                try:
                    return symbol, (float(ltp_val) if ltp_val is not None else None)
                except (TypeError, ValueError):
                    return symbol, None
            return None, None

        # Update per-symbol LTP series
        for option in option_data_at_ts:
            symbol = option.get('symbol', '')
            if not symbol:
                continue
            ltp_val = option.get('close', None)
            if symbol not in ltp_series_by_symbol:
                ltp_series_by_symbol[symbol] = []
            if symbol not in ts_series_by_symbol:
                ts_series_by_symbol[symbol] = []
            if ltp_val is not None:
                try:
                    ltp_series_by_symbol[symbol].append(float(ltp_val))
                    ts_series_by_symbol[symbol].append(int(ts))
                except (TypeError, ValueError):
                    pass

        def _calc_atp(symbol, ltp_val):
            if not symbol:
                return None
            symbol_data = symbol_volume_data.get(symbol, {}).get(ts)
            if not symbol_data:
                return ltp_val
            total_volume = symbol_data.get('total_volume', 0) or 0
            total_turnover = symbol_data.get('total_turnover', 0) or 0
            return compute_atp_from_accumulated(total_turnover, total_volume, ltp_val)

        atm_call_symbol_ts, historical_call_ltp = _find_symbol_and_ltp(historical_atm_strike, 'CE')
        atm_put_symbol_ts, historical_put_ltp = _find_symbol_and_ltp(historical_atm_strike, 'PE')

        itm1_call_symbol_ts, historical_itm1_call_ltp = _find_symbol_and_ltp(historical_atm_strike - 50, 'CE')
        itm2_call_symbol_ts, historical_itm2_call_ltp = _find_symbol_and_ltp(historical_atm_strike - 100, 'CE')
        itm1_put_symbol_ts, historical_itm1_put_ltp = _find_symbol_and_ltp(historical_atm_strike + 50, 'PE')
        itm2_put_symbol_ts, historical_itm2_put_ltp = _find_symbol_and_ltp(historical_atm_strike + 100, 'PE')

        historical_call_atp = _calc_atp(atm_call_symbol_ts, historical_call_ltp)
        historical_put_atp = _calc_atp(atm_put_symbol_ts, historical_put_ltp)
        historical_itm1_call_atp = _calc_atp(itm1_call_symbol_ts, historical_itm1_call_ltp)
        historical_itm2_call_atp = _calc_atp(itm2_call_symbol_ts, historical_itm2_call_ltp)
        historical_itm1_put_atp = _calc_atp(itm1_put_symbol_ts, historical_itm1_put_ltp)
        historical_itm2_put_atp = _calc_atp(itm2_put_symbol_ts, historical_itm2_put_ltp)

        call_atp_ltp_diff_historical = round(
            (historical_call_atp - historical_call_ltp)
            if historical_call_atp is not None and historical_call_ltp is not None
            else 0, 2
        )
        put_atp_ltp_diff_historical = round(
            (historical_put_atp - historical_put_ltp)
            if historical_put_atp is not None and historical_put_ltp is not None
            else 0, 2
        )
        itm1_call_atp_ltp_diff_historical = round(
            (historical_itm1_call_atp - historical_itm1_call_ltp)
            if historical_itm1_call_atp is not None and historical_itm1_call_ltp is not None
            else 0, 2
        )
        itm2_call_atp_ltp_diff_historical = round(
            (historical_itm2_call_atp - historical_itm2_call_ltp)
            if historical_itm2_call_atp is not None and historical_itm2_call_ltp is not None
            else 0, 2
        )
        itm1_put_atp_ltp_diff_historical = round(
            (historical_itm1_put_atp - historical_itm1_put_ltp)
            if historical_itm1_put_atp is not None and historical_itm1_put_ltp is not None
            else 0, 2
        )
        itm2_put_atp_ltp_diff_historical = round(
            (historical_itm2_put_atp - historical_itm2_put_ltp)
            if historical_itm2_put_atp is not None and historical_itm2_put_ltp is not None
            else 0, 2
        )

        call_atp_signal_historical = compute_atp_signal(
            historical_call_atp, historical_call_ltp,
            historical_itm1_call_atp, historical_itm1_call_ltp,
            historical_itm2_call_atp, historical_itm2_call_ltp,
        )
        put_atp_signal_historical = compute_atp_signal(
            historical_put_atp, historical_put_ltp,
            historical_itm1_put_atp, historical_itm1_put_ltp,
            historical_itm2_put_atp, historical_itm2_put_ltp,
        )

        call_sma = compute_sma_signal(ltp_series_by_symbol, ts_series_by_symbol, atm_call_symbol_ts, ts)
        put_sma = compute_sma_signal(ltp_series_by_symbol, ts_series_by_symbol, atm_put_symbol_ts, ts)

        historical_data.append({
            'time': datetime.fromtimestamp(ts).isoformat(),
            'spot_ltp': historical_spot_ltp,
            'spot_sma_signal': compute_sma_from_series(spot_ltp_series, historical_spot_ltp),
            'atm_strike': historical_atm_strike,
            'atm_call_atp': round(historical_call_atp, 2) if historical_call_atp is not None else None,
            'atm_call_ltp': historical_call_ltp,
            'atm_call_atp_ltp_diff': call_atp_ltp_diff_historical,
            'atm_put_atp': round(historical_put_atp, 2) if historical_put_atp is not None else None,
            'atm_put_ltp': historical_put_ltp,
            'atm_put_atp_ltp_diff': put_atp_ltp_diff_historical,
            'call_atp_signal': call_atp_signal_historical,
            'put_atp_signal': put_atp_signal_historical,
            'final_signal': compute_final_signal(
                call_atp_signal_historical,
                put_atp_signal_historical,
                call_sma=call_sma,
                put_sma=put_sma,
            ),
            'call_sma_signal': call_sma,
            'put_sma_signal': put_sma,
            'itm1_call_atp_ltp_diff': itm1_call_atp_ltp_diff_historical,
            'itm2_call_atp_ltp_diff': itm2_call_atp_ltp_diff_historical,
            'itm1_put_atp_ltp_diff': itm1_put_atp_ltp_diff_historical,
            'itm2_put_atp_ltp_diff': itm2_put_atp_ltp_diff_historical,
        })

    # Trade signal detection
    detect_trade_signals(historical_data)

    # Append final 15:30 entry
    if len(historical_data) > 0:
        last_ts = datetime.fromtimestamp(sorted_ts[-1]).time() if sorted_ts else None
        if last_ts is None or last_ts > time(15, 30):
            last_entry = historical_data[-1].copy()
            last_entry['time'] = datetime.combine(today_trading, time(15, 30)).isoformat()
            historical_data.append(last_entry)

    return historical_data
