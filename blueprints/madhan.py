import re
from flask import Blueprint, jsonify, request, session
from utils.session import check_session_validity
from utils.logging import get_logger
from datetime import datetime, timedelta, time
from collections import defaultdict
from bisect import bisect_right
from services.history_service import get_history
from services.madhan.nifty_fetch_service import nifty_fetcher
from database.madhan_db import get_nifty_data, get_option_data, get_consistent_current_option_data, get_nifty_data_count, get_previous_day_oi, get_nth_candle_oi_for_all_symbols, get_current_day_historical_data, get_current_day_instrument_data, get_coi_history, get_valid_trading_day, SessionLocal, NiftyData, get_tracked_symbols
from database.auth_db import get_api_key_for_tradingview
from blueprints.react_app import serve_react_app


# Initialize logger
logger = get_logger(__name__)

# Create blueprint
madhan_bp = Blueprint('madhan_bp', __name__, url_prefix='/madhan')

@madhan_bp.route('/madhan01')
@check_session_validity
def madhan01_page():
    return serve_react_app()

@madhan_bp.route('/ATP-LTPStrategy')
@check_session_validity
def atp_ltp_strategy_page():
    return serve_react_app()

@madhan_bp.route('/madhan02')
@check_session_validity
def madhan02_page():
    """Render the MadhaN02 page with only Nifty 1-Min Data Fetcher"""
    # Get the API key from the fetcher if available
    api_key = getattr(nifty_fetcher, 'api_key', '')
    return render_template('madhan/index.html', api_key=api_key)

@madhan_bp.route('/madhan03')
@check_session_validity
def madhan03_page():
    """Render the new MadhaN03 page"""
    return render_template('madhan/sk_ezaychart.html')

@madhan_bp.route('/api/test-data')
@check_session_validity
def get_test_data():
    """Returns some sample JSON data for testing."""
    logger.info("Fetching test data for MadhaN's page.")
    data = {
        "status": "success",
        "message": "Hello from the MadhaN blueprint API!",
        "timestamp": datetime.utcnow().isoformat(),
        "data": [
            {"id": 1, "item": "Test Item 1"},
            {"id": 2, "item": "Test Item 2"},
            {"id": 3, "item": "Test Item 3"}
        ]
    }
    return jsonify(data)

@madhan_bp.route('/api/atp-ltp-data')
@check_session_validity
def get_atp_ltp_data():
    """Returns ATP-LTP strategy data with time, spot LTP, ATM call ATP, ATM call LTP, ATM put ATP, ATM put LTP."""
    try:
        logger.info("Fetching ATP-LTP data")
        
        # Get current NIFTY data
        nifty_data = get_nifty_data(limit=1)
        if not nifty_data:
            return jsonify({
                'status': 'error', 
                'message': 'No NIFTY data available'
            }), 404
            
        latest_nifty = nifty_data[0]
        current_spot = latest_nifty.get('close', 0)
        
        # Get current ATM strike from fetcher
        current_atm_strike = nifty_fetcher.current_atm_strike
        if not current_atm_strike:
            return jsonify({
                'status': 'error', 
                'message': 'ATM strike not calculated yet'
            }), 404
        
        # Get historical intraday data for ATP calculation
        # Get current day's instrument data for volume-weighted ATP calculation
        atm_call_symbol = None
        atm_put_symbol = None
        
        # Find the exact ATM call and put symbols
        tracked_symbols = get_tracked_symbols()
        for symbol in tracked_symbols:
            strike = extract_strike(symbol)
            if strike == current_atm_strike:
                if symbol.endswith('CE'):
                    atm_call_symbol = symbol
                elif symbol.endswith('PE'):
                    atm_put_symbol = symbol
        
        if not atm_call_symbol and not atm_put_symbol:
            return jsonify({
                'status': 'error', 
                'message': f'No ATM options found for strike {current_atm_strike}'
            }), 404
        
        # Calculate ATP using volume-weighted average from intraday data
        atm_call_atp = 0
        atm_put_atp = 0
        atm_call_ltp = 0
        atm_put_ltp = 0
        itm1_call_ltp = 0
        itm2_call_ltp = 0
        itm1_put_ltp = 0
        itm2_put_ltp = 0
        
        # Find ITM options (2 strikes away from ATM)
        itm_call_symbol1 = None
        itm_call_symbol2 = None
        itm_put_symbol1 = None
        itm_put_symbol2 = None
        
        # For calls: ITM means strike price < spot price (lower strikes)
        # For puts: ITM means strike price > spot price (higher strikes)
        itm1_call_strike = current_atm_strike - 50   # 1 strike below ATM for calls
        itm2_call_strike = current_atm_strike - 100  # 2 strikes below ATM for calls
        itm1_put_strike = current_atm_strike + 50   # 1 strike above ATM for puts
        itm2_put_strike = current_atm_strike + 100  # 2 strikes above ATM for puts
        
        for symbol in tracked_symbols:
            strike = extract_strike(symbol)
            if strike == itm1_call_strike and symbol.endswith('CE'):
                itm_call_symbol1 = symbol
            elif strike == itm2_call_strike and symbol.endswith('CE'):
                itm_call_symbol2 = symbol
            elif strike == itm1_put_strike and symbol.endswith('PE'):
                itm_put_symbol1 = symbol
            elif strike == itm2_put_strike and symbol.endswith('PE'):
                itm_put_symbol2 = symbol
        
        # Get current option data for LTP
        option_data = get_consistent_current_option_data()
        for option in option_data:
            symbol = option.get('symbol', '')
            ltp = option.get('close', 0)
            
            if symbol == atm_call_symbol:
                atm_call_ltp = ltp
            elif symbol == atm_put_symbol:
                atm_put_ltp = ltp
            elif symbol == itm_call_symbol1:
                itm1_call_ltp = ltp
            elif symbol == itm_call_symbol2:
                itm2_call_ltp = ltp
            elif symbol == itm_put_symbol1:
                itm1_put_ltp = ltp
            elif symbol == itm_put_symbol2:
                itm2_put_ltp = ltp
        
        # Calculate ATP for ATM options using proper NSE ATP formula
        # ATP = Total Turnover / Total Volume
        if atm_call_symbol:
            call_intraday_data = get_current_day_instrument_data(atm_call_symbol)
            if call_intraday_data:
                total_volume = 0
                total_turnover = 0
                for candle in call_intraday_data:
                    volume = candle.get('volume', 0)
                    close_price = candle.get('close', 0)
                    
                    # NSE ATP: Total Turnover = Σ(Price × Volume)
                    if volume > 0 and close_price > 0:
                        total_volume += volume
                        total_turnover += close_price * volume
                
                # ATP = Total Turnover / Total Volume (NSE formula)
                atm_call_atp = total_turnover / total_volume if total_volume > 0 else atm_call_ltp
        
        if atm_put_symbol:
            put_intraday_data = get_current_day_instrument_data(atm_put_symbol)
            if put_intraday_data:
                total_volume = 0
                total_turnover = 0
                for candle in put_intraday_data:
                    volume = candle.get('volume', 0)
                    close_price = candle.get('close', 0)
                    
                    # NSE ATP: Total Turnover = Σ(Price × Volume)
                    if volume > 0 and close_price > 0:
                        total_volume += volume
                        total_turnover += close_price * volume
                
                # ATP = Total Turnover / Total Volume (NSE formula)
                atm_put_atp = total_turnover / total_volume if total_volume > 0 else atm_put_ltp
        
        # Calculate ATP for ITM options (both strikes)
        # Initialize all ITM variables
        itm1_call_atp = 0
        itm2_call_atp = 0
        itm1_put_atp = 0
        itm2_put_atp = 0
        
        # ITM Call 1
        if itm_call_symbol1:
            itm1_call_intraday_data = get_current_day_instrument_data(itm_call_symbol1)
            if itm1_call_intraday_data:
                total_volume = 0
                total_turnover = 0
                for candle in itm1_call_intraday_data:
                    volume = candle.get('volume', 0)
                    close_price = candle.get('close', 0)
                    
                    # NSE ATP: Total Turnover = Σ(Price × Volume)
                    if volume > 0 and close_price > 0:
                        total_volume += volume
                        total_turnover += close_price * volume
                
                itm1_call_atp = total_turnover / total_volume if total_volume > 0 else itm1_call_ltp
        
        # ITM Call 2
        if itm_call_symbol2:
            itm2_call_intraday_data = get_current_day_instrument_data(itm_call_symbol2)
            if itm2_call_intraday_data:
                total_volume = 0
                total_turnover = 0
                for candle in itm2_call_intraday_data:
                    volume = candle.get('volume', 0)
                    close_price = candle.get('close', 0)
                    
                    # NSE ATP: Total Turnover = Σ(Price × Volume)
                    if volume > 0 and close_price > 0:
                        total_volume += volume
                        total_turnover += close_price * volume
                
                itm2_call_atp = total_turnover / total_volume if total_volume > 0 else itm2_call_ltp
        
        # ITM Put 1
        if itm_put_symbol1:
            itm1_put_intraday_data = get_current_day_instrument_data(itm_put_symbol1)
            if itm1_put_intraday_data:
                total_volume = 0
                total_turnover = 0
                for candle in itm1_put_intraday_data:
                    volume = candle.get('volume', 0)
                    close_price = candle.get('close', 0)
                    
                    # NSE ATP: Total Turnover = Σ(Price × Volume)
                    if volume > 0 and close_price > 0:
                        total_volume += volume
                        total_turnover += close_price * volume
                
                itm1_put_atp = total_turnover / total_volume if total_volume > 0 else itm1_put_ltp
        
        # ITM Put 2
        if itm_put_symbol2:
            itm2_put_intraday_data = get_current_day_instrument_data(itm_put_symbol2)
            if itm2_put_intraday_data:
                total_volume = 0
                total_turnover = 0
                for candle in itm2_put_intraday_data:
                    volume = candle.get('volume', 0)
                    close_price = candle.get('close', 0)
                    
                    # NSE ATP: Total Turnover = Σ(Price × Volume)
                    if volume > 0 and close_price > 0:
                        total_volume += volume
                        total_turnover += close_price * volume
                
                itm2_put_atp = total_turnover / total_volume if total_volume > 0 else itm2_put_ltp
        
        # Calculate ATP signals
        # Call signal: Check both ITM strikes against ATM
        # Put signal: Check both ITM strikes against ATM
        call_atp_signal = False
        put_atp_signal = False
        
        # Signal condition (as requested):
        # (ITM1 ATP-LTP < ATM ATP-LTP) AND (ITM2 ATP-LTP < ATM ATP-LTP)
        if itm1_call_atp and itm1_call_ltp and itm2_call_atp and itm2_call_ltp and atm_call_atp and atm_call_ltp:
            itm1_call_atp_ltp_diff = itm1_call_atp - itm1_call_ltp
            itm2_call_atp_ltp_diff = itm2_call_atp - itm2_call_ltp
            atm_call_atp_ltp_diff = atm_call_atp - atm_call_ltp
            call_atp_signal = (itm1_call_atp_ltp_diff < atm_call_atp_ltp_diff) and (itm2_call_atp_ltp_diff < atm_call_atp_ltp_diff)

        if itm1_put_atp and itm1_put_ltp and itm2_put_atp and itm2_put_ltp and atm_put_atp and atm_put_ltp:
            itm1_put_atp_ltp_diff = itm1_put_atp - itm1_put_ltp
            itm2_put_atp_ltp_diff = itm2_put_atp - itm2_put_ltp
            atm_put_atp_ltp_diff = atm_put_atp - atm_put_ltp
            put_atp_signal = (itm1_put_atp_ltp_diff < atm_put_atp_ltp_diff) and (itm2_put_atp_ltp_diff < atm_put_atp_ltp_diff)
        
        # Create data entry
        current_time = datetime.now().isoformat()
        
        # Calculate ATP-LTP differences
        call_atp_ltp_diff = round(atm_call_atp - atm_call_ltp, 2) if atm_call_atp and atm_call_ltp else 0
        put_atp_ltp_diff = round(atm_put_atp - atm_put_ltp, 2) if atm_put_atp and atm_put_ltp else 0
        
        data_entry = {
            'time': current_time,
            'spot_ltp': current_spot,
            'atm_strike': current_atm_strike,
            'atm_call_atp': round(atm_call_atp, 2) if atm_call_atp else None,
            'atm_call_ltp': atm_call_ltp,
            'atm_call_atp_ltp_diff': call_atp_ltp_diff,
            'atm_put_atp': round(atm_put_atp, 2) if atm_put_atp else None,
            'atm_put_ltp': atm_put_ltp,
            'atm_put_atp_ltp_diff': put_atp_ltp_diff,
            'call_atp_signal': call_atp_signal,
            'put_atp_signal': put_atp_signal
        }

        def _final_signal(call_signal: bool, put_signal: bool, call_sma: bool = False, put_sma: bool = False) -> str:
            if call_signal and put_signal:
                return "Sideways"
            if call_signal and not put_signal and not put_sma:
                return "Bullish"
            if put_signal and not call_signal and not call_sma:
                return "Bearish"
            return "Neutral"
        
        # For demo purposes, return historical data points from real database
        # Using the same approach as dash-time-analysis
        historical_data = []
        spot_ltp_series = []
        ltp_series_by_symbol = {}
        ts_series_by_symbol = {}

        def _append_and_signal_sma(series: list[float], new_value: float | None) -> bool:
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
        
        # Define current time for market hours logic
        now = datetime.now()

        def _append_symbol_series(
            price_by_symbol: dict[str, list[float]],
            ts_by_symbol: dict[str, list[int]],
            symbol: str | None,
            ltp_value: float | None,
            timestamp: int | None,
        ) -> None:
            if not symbol or timestamp is None:
                return
            if ltp_value is None:
                return
            try:
                val = float(ltp_value)
            except (TypeError, ValueError):
                return
            if val <= 0:
                return
            prices = price_by_symbol.get(symbol)
            tss = ts_by_symbol.get(symbol)
            if prices is None:
                prices = []
                price_by_symbol[symbol] = prices
            if tss is None:
                tss = []
                ts_by_symbol[symbol] = tss
            prices.append(val)
            tss.append(int(timestamp))

        def _sma_signal_from_series(
            price_by_symbol: dict[str, list[float]],
            ts_by_symbol: dict[str, list[int]],
            symbol: str | None,
            timestamp: int,
        ) -> bool:
            if not symbol:
                return False
            prices = price_by_symbol.get(symbol)
            tss = ts_by_symbol.get(symbol)
            if not prices or not tss:
                return False

            idx = bisect_right(tss, int(timestamp))
            if idx < 8:
                return False

            last_ts = tss[idx - 8 : idx]
            # Require 8 consecutive 1-minute candles for SMA
            for i in range(1, len(last_ts)):
                if last_ts[i] - last_ts[i - 1] != 60:
                    return False

            last_prices = prices[idx - 8 : idx]
            sma5 = sum(last_prices[-5:]) / 5.0
            sma8 = sum(last_prices[-8:]) / 8.0
            return sma5 > sma8
        
        # Get 1-min historical data for all symbols (includes NIFTY spot)
        # This is the same approach used in dash-time-analysis
        all_historical_data = get_current_day_historical_data()
        if not all_historical_data:
            return jsonify({
                'status': 'error', 
                'message': 'No historical data available'
            }), 404
        
        # Group by timestamp and also accumulate volume-weighted data by symbol
        data_by_ts = defaultdict(list)
        nifty_by_ts = {}
        
        # Sort all data by timestamp first
        all_historical_data.sort(key=lambda x: x['timestamp'])
        
        # Process data in chronological order to accumulate volume up to each timestamp
        symbol_volume_data = {}

        for row in all_historical_data:
            if row['symbol'] == 'NIFTY':
                nifty_by_ts[row['timestamp']] = row['close']
            else:
                data_by_ts[row['timestamp']].append(row)
                
                # Accumulate volume-weighted data progressively up to this timestamp
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

                # Guard against NaNs and negatives
                if close != close or close < 0:
                    close = 0.0
                if volume != volume or volume < 0:
                    volume = 0.0

                if symbol not in symbol_volume_data:
                    symbol_volume_data[symbol] = {}

                # Get previous cumulative data
                prev_timestamps = [t for t in symbol_volume_data[symbol].keys() if t < timestamp]
                if prev_timestamps:
                    latest_prev_timestamp = max(prev_timestamps)
                    prev_data = symbol_volume_data[symbol][latest_prev_timestamp]
                else:
                    prev_data = {'total_volume': 0.0, 'total_turnover': 0.0}

                # Calculate new cumulative totals (NSE ATP components)
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
        
        # Process each timestamp within market hours
        for ts in sorted_ts:
            if ts < market_open_ts or ts > market_close_ts:
                continue
                
            # Get spot LTP for this timestamp
            historical_spot_ltp = nifty_by_ts.get(ts, 0)
            if historical_spot_ltp == 0:
                continue
                
            # Rolling ATM strike (but call and put use the same strike for this minute)
            historical_atm_strike = round(historical_spot_ltp / 50) * 50
            
            # Find ATM call and put symbols for this timestamp
            historical_call_atp = None
            historical_call_ltp = None
            historical_put_atp = None
            historical_put_ltp = None
            historical_itm1_call_atp = None
            historical_itm1_call_ltp = None
            historical_itm2_call_atp = None
            historical_itm2_call_ltp = None
            historical_itm1_put_atp = None
            historical_itm1_put_ltp = None
            historical_itm2_put_atp = None
            historical_itm2_put_ltp = None
            
            # Process option data for this timestamp
            option_data_at_ts = data_by_ts.get(ts, [])

            def _find_symbol_and_ltp(strike_val: int, suffix: str) -> tuple[str | None, float | None]:
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

            # Update per-symbol LTP series using all option candles at this timestamp
            for option in option_data_at_ts:
                symbol = option.get('symbol', '')
                if not symbol:
                    continue
                ltp_val = option.get('close', None)
                _append_symbol_series(ltp_series_by_symbol, ts_series_by_symbol, symbol, ltp_val, ts)

            def _calc_atp(symbol: str | None, ltp_val: float | None) -> float | None:
                if not symbol:
                    return None
                symbol_data = symbol_volume_data.get(symbol, {}).get(ts)
                if not symbol_data:
                    return ltp_val
                total_volume = symbol_data.get('total_volume', 0) or 0
                total_turnover = symbol_data.get('total_turnover', 0) or 0
                try:
                    total_volume_f = float(total_volume)
                    total_turnover_f = float(total_turnover)
                except (TypeError, ValueError):
                    return ltp_val
                if total_volume_f > 0:
                    return total_turnover_f / total_volume_f
                return ltp_val

            # Symbols for ATM/ITM strikes at this timestamp (no fallback; use only real data at ts)
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
            
            # Calculate ATP-LTP differences
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

            # Real signals (same rule as "current" entry): both ITM diffs must be < ATM diff
            call_atp_signal_historical = False
            put_atp_signal_historical = False
            if (
                historical_call_atp is not None
                and historical_call_ltp is not None
                and historical_itm1_call_atp is not None
                and historical_itm1_call_ltp is not None
                and historical_itm2_call_atp is not None
                and historical_itm2_call_ltp is not None
            ):
                call_atp_signal_historical = (itm1_call_atp_ltp_diff_historical < call_atp_ltp_diff_historical) and (
                    itm2_call_atp_ltp_diff_historical < call_atp_ltp_diff_historical
                )

            if (
                historical_put_atp is not None
                and historical_put_ltp is not None
                and historical_itm1_put_atp is not None
                and historical_itm1_put_ltp is not None
                and historical_itm2_put_atp is not None
                and historical_itm2_put_ltp is not None
            ):
                put_atp_signal_historical = (itm1_put_atp_ltp_diff_historical < put_atp_ltp_diff_historical) and (
                    itm2_put_atp_ltp_diff_historical < put_atp_ltp_diff_historical
                )
            
            historical_data.append({
                'time': datetime.fromtimestamp(ts).isoformat(),
                'spot_ltp': historical_spot_ltp,
                'spot_sma_signal': _append_and_signal_sma(spot_ltp_series, historical_spot_ltp),
                'atm_strike': historical_atm_strike,
                'atm_call_atp': round(historical_call_atp, 2) if historical_call_atp is not None else None,
                'atm_call_ltp': historical_call_ltp,
                'atm_call_atp_ltp_diff': call_atp_ltp_diff_historical,
                'atm_put_atp': round(historical_put_atp, 2) if historical_put_atp is not None else None,
                'atm_put_ltp': historical_put_ltp,
                'atm_put_atp_ltp_diff': put_atp_ltp_diff_historical,
                'call_atp_signal': call_atp_signal_historical,
                'put_atp_signal': put_atp_signal_historical,
                'final_signal': _final_signal(
                    call_atp_signal_historical,
                    put_atp_signal_historical,
                    call_sma=_sma_signal_from_series(ltp_series_by_symbol, ts_series_by_symbol, atm_call_symbol_ts, ts),
                    put_sma=_sma_signal_from_series(ltp_series_by_symbol, ts_series_by_symbol, atm_put_symbol_ts, ts),
                ),
                'call_sma_signal': _sma_signal_from_series(ltp_series_by_symbol, ts_series_by_symbol, atm_call_symbol_ts, ts),
                'put_sma_signal': _sma_signal_from_series(ltp_series_by_symbol, ts_series_by_symbol, atm_put_symbol_ts, ts),
                # Extra real diagnostics for validation (frontend can ignore)
                'itm1_call_atp_ltp_diff': itm1_call_atp_ltp_diff_historical,
                'itm2_call_atp_ltp_diff': itm2_call_atp_ltp_diff_historical,
                'itm1_put_atp_ltp_diff': itm1_put_atp_ltp_diff_historical,
                'itm2_put_atp_ltp_diff': itm2_put_atp_ltp_diff_historical,
            })

        # Trade signal arrows: after 2+ consecutive Sideways, 2nd consecutive Bullish/Bearish
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
        
        # Do not append a "current" row; use only 1-minute DB candles to avoid duplicates like 09:31:32.
        # If outside market hours, use the last historical data point as the final state at 15:30.
        if len(historical_data) > 0:
            last_ts = datetime.fromtimestamp(sorted_ts[-1]).time() if sorted_ts else None
            if last_ts is None or last_ts > time(15, 30):
                last_entry = historical_data[-1].copy()
                last_entry['time'] = datetime.combine(today_trading, time(15, 30)).isoformat()
                historical_data.append(last_entry)
        
        return jsonify({
            'status': 'success',
            'data': historical_data
        })
        
    except Exception as e:
        logger.error(f"Error fetching ATP-LTP data: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f'Internal server error: {str(e)}'
        }), 500

@madhan_bp.route('/api/history', methods=['POST'])
@check_session_validity
def get_historical_data():
    """API endpoint to fetch historical data."""
    username = session.get('user')
    if not username:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    api_key = get_api_key_for_tradingview(username)
    if not api_key:
        return jsonify({'status': 'error', 'message': 'API key not found for user'}), 401

    data = request.json
    symbol = data.get('symbol')
    exchange = data.get('exchange')
    interval = data.get('interval')
    start_date = data.get('start_date')
    end_date = data.get('end_date')

    if not all([symbol, exchange, interval, start_date, end_date]):
        return jsonify({'status': 'error', 'message': 'Missing required parameters'}), 400

    logger.info(f"Fetching history for {symbol} on {exchange} from {start_date} to {end_date}")

    success, result, status_code = get_history(
        symbol=symbol, exchange=exchange, interval=interval,
        start_date=start_date, end_date=end_date, api_key=api_key
    )

    return jsonify(result), status_code

@madhan_bp.route('/api/nifty/start', methods=['POST'])
@check_session_validity
def start_nifty_fetch():
    """Starts the background Nifty data fetching service."""
    username = session.get('user')
    api_key = get_api_key_for_tradingview(username)
    if not api_key:
        return jsonify({'status': 'error', 'message': 'API key not found'}), 401
    
    if nifty_fetcher.is_running:
        return jsonify({'status': 'info', 'message': 'Fetcher is already running.'})

    if nifty_fetcher.status in ("Stopped (Market Closed)", "Stopped (Weekend)"):
        return jsonify({'status': 'info', 'message': f'{nifty_fetcher.status}. Data already available.'})

    nifty_fetcher.start(api_key)
    return jsonify({'status': 'success', 'message': 'Nifty data fetching process started.'})

@madhan_bp.route('/api/nifty/stop', methods=['POST'])
@check_session_validity
def stop_nifty_fetch():
    """Stops the background Nifty data fetching service."""
    nifty_fetcher.stop()
    return jsonify({'status': 'success', 'message': 'Nifty data fetching process stopped.'})

@madhan_bp.route('/api/nifty/status')
@check_session_validity
def nifty_status():
    """Gets the current status of the fetcher."""
    # Calculate CE and PE counts
    ce_count = sum(1 for s in nifty_fetcher.option_symbols if s.endswith('CE'))
    pe_count = sum(1 for s in nifty_fetcher.option_symbols if s.endswith('PE'))

    return jsonify({
        'status': 'success',
        'is_running': nifty_fetcher.is_running,
        'message': nifty_fetcher.status,
        'last_update': nifty_fetcher.last_update.isoformat() if nifty_fetcher.last_update else None,
        'server_time': datetime.now().isoformat(),
        'nifty_record_count': get_nifty_data_count(),
        'open_atm_strike': nifty_fetcher.open_atm_strike,
        'current_atm_strike': nifty_fetcher.current_atm_strike,
        'expiry_date': nifty_fetcher.expiry_date,
        'ce_count': ce_count,
        'pe_count': pe_count,
        'Trading date': nifty_fetcher.trading_date,
    })

@madhan_bp.route('/api/nifty/data')
@check_session_validity
def nifty_data():
    """Gets the latest stored Nifty data."""
    data = get_nifty_data()
    return jsonify({'status': 'success', 'data': data})

@madhan_bp.route('/api/nifty/option-data')
@check_session_validity
def nifty_option_data():
    """Gets the latest stored Nifty options data."""
    data = get_option_data()
    return jsonify({'status': 'success', 'data': data})

@madhan_bp.route('/api/nifty/option-ohlc')
@check_session_validity
def nifty_option_ohlc():
    """Gets OHLC data for a specific option symbol for the current day."""
    symbol = request.args.get('symbol')
    if not symbol:
        return jsonify({'status': 'error', 'message': 'Symbol is required'}), 400

    try:
        # Use get_current_day_instrument_data to match spot data (current day only)
        data = get_current_day_instrument_data(symbol)
        
        if not data:
            return jsonify({'status': 'success', 'data': {
                'timestamps': [], 'open': [], 'high': [], 'low': [], 'close': [], 'volume': [], 'oi': []
            }})

        # Transform list of dicts to dict of lists (Columnar format)
        optimized_data = {
            'timestamps': [row['timestamp'] for row in data],
            'open': [row['open'] for row in data],
            'high': [row['high'] for row in data],
            'low': [row['low'] for row in data],
            'close': [row['close'] for row in data],
            'volume': [row['volume'] for row in data],
            'oi': [row['oi'] for row in data]
        }
        
        return jsonify({'status': 'success', 'data': optimized_data})
    except Exception as e:
        logger.error(f"Error fetching option OHLC for {symbol}: {str(e)}")
        return jsonify({'status': 'error', 'message': f'Error fetching option OHLC: {str(e)}'}), 500

@madhan_bp.route('/api/nifty/previous-day-oi')
@check_session_validity
def nifty_previous_day_oi():
    """
    Gets the previous day's closing OI data and calculates the change in OI
    by comparing with the current day's latest OI.
    """
    prev_day_data = get_previous_day_oi()
    
    # 1. Get current OI for session change calculation
    current_option_data = get_consistent_current_option_data() # Fetches latest OI for all symbols at consistent timestamp
    latest_nifty_data = get_nifty_data(limit=1) # Fetches latest OI for Nifty
    current_oi_map = {item['symbol']: item.get('oi', 0) for item in current_option_data}
    if latest_nifty_data:
        current_oi_map['NIFTY'] = latest_nifty_data[0].get('oi', 0)

    # 2. Get OI at 3rd and 6th candle marks
    oi_at_3min_map = get_nth_candle_oi_for_all_symbols(1) # 3rd candle (e.g., 9:17 AM)
    oi_at_6min_map = get_nth_candle_oi_for_all_symbols(4) # 6th candle (e.g., 9:20 AM)
    
    combined_data = []
    for prev_item in prev_day_data:
        symbol = prev_item['symbol']
        prev_oi = prev_item.get('oi', 0)

        # Session Change
        current_oi = current_oi_map.get(symbol, 0)
        change_in_oi = current_oi - prev_oi

        # 3-Min Change
        oi_3min = oi_at_3min_map.get(symbol, 0)
        # The original logic was flawed. This new logic correctly calculates the change
        # only if a candle for the symbol exists for the current day.
        change_in_oi_3min = (oi_3min - prev_oi) if symbol in oi_at_3min_map else 0

        # 6-Min Change
        oi_6min = oi_at_6min_map.get(symbol, 0)
        # This correctly handles cases where OI drops to 0.
        change_in_oi_6min = (oi_6min - prev_oi) if symbol in oi_at_6min_map else 0

        combined_item = {
            **prev_item,
            'current_oi': current_oi,
            'change_in_oi': change_in_oi,
            'change_in_oi_3min': change_in_oi_3min,
            'change_in_oi_6min': change_in_oi_6min,
        }
        combined_data.append(combined_item)

    return jsonify({'status': 'success', 'data': combined_data})

@madhan_bp.route('/api/nifty/coi-trend')
@check_session_validity
def nifty_coi_trend():
    """Calculates the Change in OI (COI) trend for the current day."""
    open_atm = nifty_fetcher.open_atm_strike
    if not open_atm or open_atm == 0:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'coi_percent': [], 'oi_trend_percent': []}, 'message': 'ATM strike not calculated yet.'})

    # Get strike selection parameters
    strike_selection_mode = request.args.get('strike_selection_mode', 'option2')  # option1: all strikes, option2: selective
    upside_strikes = int(request.args.get('upside_strikes', '10'))  # default 10 strikes above ATM
    downside_strikes = int(request.args.get('downside_strikes', '10'))  # default 10 strikes below ATM
    
    # Get the total number of symbols we expect data for on each candle to ensure data integrity
    if strike_selection_mode == 'option1':
        expected_symbol_count = len(nifty_fetcher.option_symbols) + 1 # +1 for NIFTY index
    else:
        # For option2, calculate expected symbols based on selective strikes
        # PE: all strikes below ATM + ATM + 2 above ATM
        # CE: all strikes above ATM + ATM + 2 below ATM
        pe_strikes_count = downside_strikes + 1 + 2  # below + ATM + 2 above
        ce_strikes_count = upside_strikes + 1 + 2   # above + ATM + 2 below
        expected_symbol_count = pe_strikes_count + ce_strikes_count + 1  # +1 for NIFTY index

    prev_day_data = get_previous_day_oi()
    prev_oi_map = {item['symbol']: item.get('oi', 0) for item in prev_day_data}

    historical_data = get_current_day_historical_data()
    if not historical_data:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'coi_percent': [], 'oi_trend_percent': []}, 'message': 'No historical data for today.'})

    # Group data by timestamp
    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row['timestamp']].append(row)

    sorted_timestamps = sorted(data_by_ts.keys())

    timestamps_res = []
    coi_percent_res = []
    oi_trend_percent_res = []

    for ts in sorted_timestamps:
        # To prevent spikes from partial data, ensure the candle for this timestamp is complete
        if len(data_by_ts[ts]) < expected_symbol_count:
            logger.debug(f"Skipping incomplete candle at timestamp {ts}: got {len(data_by_ts[ts])} symbols, expected {expected_symbol_count}")
            continue

        total_ce_coi = 0
        total_pe_coi = 0
        total_ce_oi = 0
        total_pe_oi = 0

        for item in data_by_ts[ts]:
            symbol = item['symbol']
            current_oi = item.get('oi', 0)
            prev_oi = prev_oi_map.get(symbol, 0)
            
            # Skip NIFTY index symbol
            if symbol == 'NIFTY':
                continue
                
            # Apply strike filtering for option2
            if strike_selection_mode == 'option2':
                strike_price = extract_strike(symbol)
                if strike_price is None:
                    continue
                    
                # PE writers view: strikes below ATM + ATM + 2 above ATM
                if symbol.endswith('PE'):
                    if strike_price > open_atm + (2 * 50):  # Skip PE strikes more than 2 above ATM
                        continue
                        
                # CE writers view: strikes above ATM + ATM + 2 below ATM  
                elif symbol.endswith('CE'):
                    if strike_price < open_atm - (2 * 50):  # Skip CE strikes more than 2 below ATM
                        continue
            
            if prev_oi > 0 and current_oi > 0:
                change_in_oi = current_oi - prev_oi
                if symbol.endswith('CE'):
                    total_ce_coi += change_in_oi
                elif symbol.endswith('PE'):
                    total_pe_coi += change_in_oi
            
            # OI Trend calculation
            if current_oi > 0:
                if symbol.endswith('CE'):
                    total_ce_oi += current_oi
                elif symbol.endswith('PE'):
                    total_pe_oi += current_oi
        
        # Calculate COI %
        coi_ce_abs = abs(total_ce_coi)
        coi_pe_abs = abs(total_pe_coi)
        coi_percent = 0
        if coi_ce_abs > 0 and coi_pe_abs > 0:
            high_coi, low_coi = (coi_ce_abs, coi_pe_abs) if coi_ce_abs > coi_pe_abs else (coi_pe_abs, coi_ce_abs)
            coi_percent = ((high_coi - low_coi) / low_coi) * 100
            if coi_ce_abs > coi_pe_abs:
                coi_percent *= -1
        elif coi_ce_abs > 0:
            coi_percent = -100
        elif coi_pe_abs > 0:
            coi_percent = 100
        
        # Calculate OI Trend %
        oi_trend_percent = 0
        if total_ce_oi > 0 and total_pe_oi > 0:
            high_oi, low_oi = (total_ce_oi, total_pe_oi) if total_ce_oi > total_pe_oi else (total_pe_oi, total_ce_oi)
            oi_trend_percent = ((high_oi - low_oi) / low_oi) * 100
            if total_ce_oi > total_pe_oi:
                oi_trend_percent *= -1
        elif total_ce_oi > 0:
            oi_trend_percent = -100
        elif total_pe_oi > 0:
            oi_trend_percent = 100
        
        timestamps_res.append(ts * 1000) # JS expects milliseconds
        coi_percent_res.append(round(coi_percent, 2))
        oi_trend_percent_res.append(round(oi_trend_percent, 2))

    return jsonify({'status': 'success', 'data': {'timestamps': timestamps_res, 'coi_percent': coi_percent_res, 'oi_trend_percent': oi_trend_percent_res}})

@madhan_bp.route('/api/nifty/spot-data')
@check_session_validity
def nifty_spot_data():
    """Gets historical spot data for Nifty."""
    data = get_current_day_instrument_data('NIFTY')
    if not data:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'prices': []}})
    
    timestamps = [d['timestamp'] * 1000 for d in data]
    prices = [d['close'] for d in data]
    
    return jsonify({'status': 'success', 'data': {'timestamps': timestamps, 'prices': prices}})

@madhan_bp.route('/api/nifty/instrument-data')
@check_session_validity
def nifty_instrument_data():
    """Gets historical data for a specific instrument for the current day."""
    symbol = request.args.get('symbol')
    if not symbol:
        return jsonify({'status': 'error', 'message': 'Symbol parameter is required'}), 400

    logger.info(f"Fetching current day historical data for symbol: {symbol}")
    instrument_data = get_current_day_instrument_data(symbol)
    if not instrument_data:
        logger.warning(f"No data found for symbol {symbol} for today.")
        return jsonify({'status': 'success', 'data': [], 'message': f'No data found for symbol {symbol} for today.'})

    return jsonify({'status': 'success', 'data': instrument_data})

@madhan_bp.route('/api/nifty/ce-pe-changes')
@check_session_validity
def nifty_ce_pe_changes():
    """Gets individual CE and PE change data for each candle for bar chart visualization."""
    open_atm = nifty_fetcher.open_atm_strike
    if not open_atm or open_atm == 0:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'ce_changes': [], 'pe_changes': []}, 'message': 'ATM strike not calculated yet.'})

    # Get strike selection parameters
    strike_selection_mode = request.args.get('strike_selection_mode', 'option1')  # option1: all strikes, option2: selective
    upside_strikes = int(request.args.get('upside_strikes', '10'))  # default 10 strikes above ATM
    downside_strikes = int(request.args.get('downside_strikes', '10'))  # default 10 strikes below ATM
    
    # Get the total number of symbols we expect data for on each candle to ensure data integrity
    if strike_selection_mode == 'option2':
        expected_symbol_count = len(nifty_fetcher.option_symbols) + 1 # +1 for NIFTY index
    else:
        # For option2, calculate expected symbols based on selective strikes
        # PE: all strikes below ATM + ATM + 2 above ATM
        # CE: all strikes above ATM + ATM + 2 below ATM
        pe_strikes_count = downside_strikes + 1 + 2  # below + ATM + 2 above
        ce_strikes_count = upside_strikes + 1 + 2   # above + ATM + 2 below
        expected_symbol_count = pe_strikes_count + ce_strikes_count + 1  # +1 for NIFTY index

    prev_day_data = get_previous_day_oi()
    prev_oi_map = {item['symbol']: item.get('oi', 0) for item in prev_day_data}

    historical_data = get_current_day_historical_data()
    if not historical_data:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'ce_changes': [], 'pe_changes': []}, 'message': 'No historical data for today.'})

    # Group data by timestamp
    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row['timestamp']].append(row)

    sorted_timestamps = sorted(data_by_ts.keys())

    timestamps_res = []
    ce_changes_res = []
    pe_changes_res = []
    
    # Keep track of previous candle's OI data for comparison
    prev_candle_oi_map = prev_oi_map.copy()  # Start with previous day data for first candle

    for i, ts in enumerate(sorted_timestamps):
        # To prevent spikes from partial data, ensure the candle for this timestamp is complete
        if len(data_by_ts[ts]) < expected_symbol_count:
            logger.debug(f"Skipping incomplete candle at timestamp {ts}: got {len(data_by_ts[ts])} symbols, expected {expected_symbol_count}")
            continue

        total_ce_change = 0
        total_pe_change = 0
        current_candle_oi_map = {}

        for item in data_by_ts[ts]:
            symbol = item['symbol']
            current_oi = item.get('oi', 0)
            current_candle_oi_map[symbol] = current_oi
            
            # Skip NIFTY index symbol
            if symbol == 'NIFTY':
                continue
                
            # Apply strike filtering for option2
            if strike_selection_mode == 'option2':
                strike_price = extract_strike(symbol)
                if strike_price is None:
                    continue
                    
                # PE writers view: strikes below ATM + ATM + 2 above ATM
                if symbol.endswith('PE'):
                    if strike_price > open_atm + (2 * 50):  # Skip PE strikes more than 2 above ATM
                        continue
                        
                # CE writers view: strikes above ATM + ATM + 2 below ATM  
                elif symbol.endswith('CE'):
                    if strike_price < open_atm - (2 * 50):  # Skip CE strikes more than 2 below ATM
                        continue
            
            # Get previous OI (from previous candle or previous day for first candle)
            prev_oi = prev_candle_oi_map.get(symbol, 0)
            
            if prev_oi > 0 and current_oi > 0:
                change_in_oi = current_oi - prev_oi
                if symbol.endswith('CE'):
                    total_ce_change += change_in_oi
                elif symbol.endswith('PE'):
                    total_pe_change += change_in_oi
        
        timestamps_res.append(ts * 1000) # JS expects milliseconds
        ce_changes_res.append(total_ce_change)
        pe_changes_res.append(total_pe_change)
        
        # Update prev_candle_oi_map for next iteration
        prev_candle_oi_map = current_candle_oi_map.copy()

    return jsonify({'status': 'success', 'data': {'timestamps': timestamps_res, 'ce_changes': ce_changes_res, 'pe_changes': pe_changes_res}})


@madhan_bp.route('/api/nifty/ce-pe-strike-changes')


@madhan_bp.route('/api/nifty/ce-pe-strike-changes')
@check_session_validity
def nifty_ce_pe_strike_changes():
    strike_price = request.args.get("strike_price", type=int)

    if not strike_price or strike_price <= 0:
        return jsonify({
            "timestamps": [],
            "ce_changes": [],
            "pe_changes": [],
            "error": "strike_price query parameter is required"
        }), 400

    # ✅ SAME AS nifty_ce_pe_changes
    prev_day_data = get_previous_day_oi()
    prev_oi_map = {item["symbol"]: item.get("oi", 0) for item in prev_day_data}

    # ✅ SAME AS nifty_ce_pe_changes (IMPORTANT FIX)
    historical_data = get_current_day_historical_data()

    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row["timestamp"]].append(row)

    timestamps_res = []
    ce_changes_res = []
    pe_changes_res = []

    prev_candle_oi_map = prev_oi_map.copy()

    for ts in sorted(data_by_ts.keys()):
        rows = data_by_ts[ts]

        total_ce_change = 0
        total_pe_change = 0
        current_candle_oi_map = {}

        found_ce = False
        found_pe = False

        for row in rows:
            symbol = row["symbol"]
            current_oi = row.get("oi", 0)

            current_candle_oi_map[symbol] = current_oi

            if symbol == "NIFTY":
                continue

            if extract_strike(symbol) != strike_price:
                continue

            prev_oi = prev_candle_oi_map.get(symbol, 0)
            delta = current_oi - prev_oi

            if symbol.endswith("CE"):
                total_ce_change += delta
                found_ce = True
            elif symbol.endswith("PE"):
                total_pe_change += delta
                found_pe = True

        if not (found_ce or found_pe):
            continue

        timestamps_res.append(ts * 1000)
        ce_changes_res.append(total_ce_change)
        pe_changes_res.append(total_pe_change)

        prev_candle_oi_map = current_candle_oi_map.copy()

    return jsonify({
        "timestamps": timestamps_res,
        "ce_changes": ce_changes_res,
        "pe_changes": pe_changes_res
    })


@madhan_bp.route('/api/nifty/ce-pe-volume-changes')
@check_session_validity
def nifty_ce_pe_volume_changes():
    """Gets individual CE and PE volume data for each candle for bar chart visualization."""
    open_atm = nifty_fetcher.open_atm_strike
    if not open_atm or open_atm == 0:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'ce_changes': [], 'pe_changes': []}, 'message': 'ATM strike not calculated yet.'})

    strike_selection_mode = request.args.get('strike_selection_mode', 'option1')  # option1: all strikes, option2: selective
    upside_strikes = int(request.args.get('upside_strikes', '10'))
    downside_strikes = int(request.args.get('downside_strikes', '10'))

    if strike_selection_mode == 'option2':
        expected_symbol_count = len(nifty_fetcher.option_symbols) + 1
    else:
        pe_strikes_count = downside_strikes + 1 + 2
        ce_strikes_count = upside_strikes + 1 + 2
        expected_symbol_count = pe_strikes_count + ce_strikes_count + 1

    historical_data = get_current_day_historical_data()
    if not historical_data:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'ce_changes': [], 'pe_changes': []}, 'message': 'No historical data for today.'})

    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row['timestamp']].append(row)

    sorted_timestamps = sorted(data_by_ts.keys())
    timestamps_res = []
    ce_changes_res = []
    pe_changes_res = []

    for ts in sorted_timestamps:
        if len(data_by_ts[ts]) < expected_symbol_count:
            logger.debug(f"Skipping incomplete candle at timestamp {ts}: got {len(data_by_ts[ts])} symbols, expected {expected_symbol_count}")
            continue

        total_ce_volume = 0
        total_pe_volume = 0

        for item in data_by_ts[ts]:
            symbol = item['symbol']
            volume = item.get('volume', 0)

            if symbol == 'NIFTY':
                continue

            if strike_selection_mode == 'option2':
                strike_price = extract_strike(symbol)
                if strike_price is None:
                    continue

                if symbol.endswith('PE'):
                    if strike_price > open_atm + (2 * 50):
                        continue
                elif symbol.endswith('CE'):
                    if strike_price < open_atm - (2 * 50):
                        continue

            if volume > 0:
                if symbol.endswith('CE'):
                    total_ce_volume += volume
                elif symbol.endswith('PE'):
                    total_pe_volume += volume

        timestamps_res.append(ts * 1000)
        ce_changes_res.append(total_ce_volume)
        pe_changes_res.append(total_pe_volume)

    combined = [abs(ce_changes_res[i]) + abs(pe_changes_res[i]) for i in range(len(ce_changes_res))]
    vol_spike = [False] * len(combined)
    WARMUP = 5
    WINDOW = 20
    THRESHOLD = 2.0
    for i in range(WARMUP, len(combined)):
        start = max(0, i - WINDOW)
        window = combined[start:i]
        if not window:
            continue
        avg = sum(window) / len(window)
        if avg > 0 and combined[i] > avg * THRESHOLD:
            vol_spike[i] = True

    # In consecutive spike runs, drop spikes where volume decreased from previous
    i = 0
    while i < len(vol_spike):
        if not vol_spike[i]:
            i += 1
            continue
        run_start = i
        while i < len(vol_spike) and vol_spike[i]:
            i += 1
        run_end = i
        prev_vol = combined[run_start]
        for k in range(run_start + 1, run_end):
            if combined[k] < prev_vol:
                vol_spike[k] = False
            else:
                prev_vol = combined[k]

    return jsonify({'status': 'success', 'data': {'timestamps': timestamps_res, 'ce_changes': ce_changes_res, 'pe_changes': pe_changes_res, 'vol_spike': vol_spike}})


@madhan_bp.route('/api/nifty/ce-pe-strike-volume-changes')
@check_session_validity
def nifty_ce_pe_strike_volume_changes():
    strike_price = request.args.get("strike_price", type=int)

    if not strike_price or strike_price <= 0:
        return jsonify({
            "timestamps": [],
            "ce_changes": [],
            "pe_changes": [],
            "error": "strike_price query parameter is required"
        }), 400

    historical_data = get_current_day_historical_data()
    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row["timestamp"]].append(row)

    timestamps_res = []
    ce_changes_res = []
    pe_changes_res = []

    for ts in sorted(data_by_ts.keys()):
        rows = data_by_ts[ts]

        total_ce_volume = 0
        total_pe_volume = 0
        found_ce = False
        found_pe = False

        for row in rows:
            symbol = row["symbol"]
            current_volume = row.get("volume", 0)

            if symbol == "NIFTY":
                continue

            if extract_strike(symbol) != strike_price:
                continue

            if symbol.endswith("CE"):
                total_ce_volume += current_volume
                found_ce = True
            elif symbol.endswith("PE"):
                total_pe_volume += current_volume
                found_pe = True

        if not (found_ce or found_pe):
            continue

        timestamps_res.append(ts * 1000)
        ce_changes_res.append(total_ce_volume)
        pe_changes_res.append(total_pe_volume)

    combined = [abs(ce_changes_res[i]) + abs(pe_changes_res[i]) for i in range(len(ce_changes_res))]
    vol_spike = [False] * len(combined)
    WARMUP = 5
    WINDOW = 20
    THRESHOLD = 2.0
    for i in range(WARMUP, len(combined)):
        start = max(0, i - WINDOW)
        window = combined[start:i]
        if not window:
            continue
        avg = sum(window) / len(window)
        if avg > 0 and combined[i] > avg * THRESHOLD:
            vol_spike[i] = True

    # In consecutive spike runs, drop spikes where volume decreased from previous
    i = 0
    while i < len(vol_spike):
        if not vol_spike[i]:
            i += 1
            continue
        run_start = i
        while i < len(vol_spike) and vol_spike[i]:
            i += 1
        run_end = i
        prev_vol = combined[run_start]
        for k in range(run_start + 1, run_end):
            if combined[k] < prev_vol:
                vol_spike[k] = False
            else:
                prev_vol = combined[k]

    return jsonify({
        "timestamps": timestamps_res,
        "ce_changes": ce_changes_res,
        "pe_changes": pe_changes_res,
        "vol_spike": vol_spike
    })


@madhan_bp.route('/nifty_chart_data')
@check_session_validity
def nifty_chart_data():
    """Provides Nifty price data for the lightweight chart."""
    try:
        # Use the existing service function to get Nifty data
        # This function is assumed to return a list of dictionaries
        # with 'timestamp' and 'close' keys, ordered by time.
        data = get_nifty_data()
        return jsonify(data), 200
    except Exception as e:
        logger.error(f"Error fetching nifty chart data: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': 'Internal server error fetching chart data'}), 500



@madhan_bp.route('/nifty_live_data')
@check_session_validity
def nifty_live_data_api():
    """
    Provides Nifty OHLC data for the lightweight chart.
    This endpoint uses the background fetcher to get the latest data.
    """
    """API endpoint to fetch historical data."""
    username = session.get('user')
    logger.info(f"starting nifty live fetch for user u: {username}")
    if not username:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    api_key = get_api_key_for_tradingview(username)
    logger.info(f"starting nifty live fetch for user apikey: {api_key}")
    if not api_key:
        return jsonify({'status': 'error', 'message': 'API key not found for user'}), 401
    try:        
        # Get interval from query parameters (default to '1m' if not provided)
        interval = request.args.get('interval', '1m')
        
        # Get days_back from query parameters (default to 1 if not provided)
        days_back = int(request.args.get('days_back', 1))
        
        # Set the API key on the fetcher instance
        nifty_fetcher.api_key = api_key
        
        # Use the NiftyDataFetcher to get the data
        success, result, status_code = nifty_fetcher.get_nifty_live_data(
            interval=interval,
            days_back=days_back
        )
        
        return jsonify(result), status_code
        
    except Exception as e:
        logger.error(f"Error in nifty_live_data_api: {e}", exc_info=True)
        return jsonify({
            'status': 'error', 
            'message': 'Internal server error'
        }), 500


@madhan_bp.route('/api/nifty/oi_profile_data')
@check_session_validity
def oi_profile_data():
    # Previous day's OI
    prev_day_data = get_previous_day_oi()  # Returns list of {symbol, oi}

    # Current day's latest OI
    current_data = get_consistent_current_option_data()  # Returns list of {symbol, oi} at consistent timestamp

    # 1. Build current OI map
    current_oi_map = {item['symbol']: item.get('oi', 0) for item in current_data}

    # 2. Build change OI map (current - previous)
    change_oi_map = {}
    for prev_item in prev_day_data:
        symbol = prev_item['symbol']
        prev_oi = prev_item.get('oi', 0)
        current_oi = current_oi_map.get(symbol, 0)
        change_oi_map[symbol] = current_oi - prev_oi

    # 3. Build final OI & COI data by strike
    oi_data, coi_data = build_oi_and_coi_data(prev_day_data, current_oi_map, change_oi_map)

    return jsonify({"oi": oi_data, "coi": coi_data})


@madhan_bp.route('/api/nifty/coi_history')
@check_session_validity
def coi_history():
    """Returns daily COI (Change in OI) history for all tracked option symbols."""
    days = request.args.get('days', 30, type=int)
    days = min(max(days, 1), 90)  # clamp 1-90

    data = get_coi_history(days)

    # Convert to list format for easier frontend consumption
    result = []
    for date_str in sorted(data.keys()):
        result.append({
            'date': date_str,
            'strikes': data[date_str],
        })

    return jsonify({"status": "success", "data": result})


import re
def extract_strike(symbol: str) -> int | None:
    """
    Robustly extract NIFTY strike from symbols like:
    NIFTY28MAR2420800CE, NIFTY29AUG2524000CE (where '25' can stick to strike).

    Logic:
    - Take the numeric chunk right before CE/PE.
    - From its end, try 5 and 6-digit windows and pick the one that:
        * is a multiple of 50 (NIFTY step)
        * is within a realistic range (10,000–100,000)
    - Fallback: last 5 digits.
    """
    m = re.search(r'(\d+)(CE|PE)$', symbol)
    if not m:
        return None

    tail = m.group(1)  # numeric tail before CE/PE, can be like "2524000"
    # Try 6 then 5 digits (some vendors may encode 6-digit strikes in rare cases)
    candidates = []
    if len(tail) >= 6:
        candidates.append(int(tail[-6:]))
    if len(tail) >= 5:
        candidates.append(int(tail[-5:]))

    for cand in candidates:
        if 10000 <= cand <= 100000 and cand % 50 == 0:
            return cand

    # Fallback: last 5 digits (still better than full tail)
    return int(tail[-5:]) if len(tail) >= 5 else None


def build_oi_and_coi_data(prev_day_data, current_oi_map, change_oi_map):
    strikes_map = {}

    for item in prev_day_data:
        symbol = item['symbol']
        strike_price = extract_strike(symbol)
        if strike_price is None:
            continue

        is_ce = symbol.endswith("CE")
        is_pe = symbol.endswith("PE")

        if strike_price not in strikes_map:
            strikes_map[strike_price] = {"ceOI": 0, "peOI": 0, "ceCOI": 0, "peCOI": 0}

        current_oi = current_oi_map.get(symbol, 0)
        change_oi = change_oi_map.get(symbol, 0)

        if is_ce:
            strikes_map[strike_price]["ceOI"] = current_oi
            strikes_map[strike_price]["ceCOI"] = change_oi
        elif is_pe:
            strikes_map[strike_price]["peOI"] = current_oi
            strikes_map[strike_price]["peCOI"] = change_oi

    # Convert map to list format
    oi_data = {"strikes": []}
    coi_data = {"strikes": []}

    for strike in sorted(strikes_map.keys()):
        vals = strikes_map[strike]
        oi_data["strikes"].append({"price": strike, "ceOI": vals["ceOI"], "peOI": vals["peOI"]})
        coi_data["strikes"].append({"price": strike, "ceOI": vals["ceCOI"], "peOI": vals["peCOI"]})

    return oi_data, coi_data

@madhan_bp.route('/api/ezayChart_data')
@check_session_validity
def ezay_chart_data():
    """Gets option data for a specific strike price for charting with enhanced calculations."""
    try:
        import pytz
        import math
        
        strike_price = request.args.get('strike')
        if not strike_price:
            return jsonify({'status': 'error', 'message': 'Strike price is required'}), 400
        
        try:
            strike_price = int(strike_price)
        except ValueError:
            return jsonify({'status': 'error', 'message': 'Invalid strike price format'}), 400
        
        # Get tracked symbols to find CE and PE for the given strike
        tracked_symbols = get_tracked_symbols()
        
        ce_symbol = None
        pe_symbol = None
        
        # Find CE and PE symbols for the given strike
        for symbol in tracked_symbols:
            extracted_strike = extract_strike(symbol)
            if extracted_strike == strike_price:
                if symbol.endswith('CE'):
                    ce_symbol = symbol
                elif symbol.endswith('PE'):
                    pe_symbol = symbol
        
        if not ce_symbol and not pe_symbol:
            return jsonify({'status': 'error', 'message': f'No option data found for strike {strike_price}'}), 404
        
        # Get current day's historical data for both CE and PE
        ce_data = []
        pe_data = []
        spot_data = []
        
        if ce_symbol:
            ce_data = get_current_day_instrument_data(ce_symbol)
        
        if pe_symbol:
            pe_data = get_current_day_instrument_data(pe_symbol)
            
        # Get NIFTY spot data for intrinsic value calculations
        spot_data = get_current_day_instrument_data('NIFTY')
        
        # Create a spot price lookup by timestamp
        spot_lookup = {item['timestamp']: item['close'] for item in spot_data}
        
        # IST timezone
        ist_tz = pytz.timezone('Asia/Kolkata')
        
        # Format data for TradingView Lightweight Charts with enhanced calculations
        def format_chart_data_enhanced(data, option_type):
            enhanced_data = []
            combined_premium_values = []  # For LLP calculation
            
            for i, item in enumerate(data):
                if item['open'] is None or item['close'] is None:
                    continue
                    
                # Convert UTC timestamp to IST
                utc_dt = datetime.fromtimestamp(item['timestamp'], tz=pytz.UTC)
                ist_dt = utc_dt.astimezone(ist_tz)
                ist_timestamp = int(ist_dt.timestamp())
                
                # Get corresponding spot price
                spot_close = spot_lookup.get(item['timestamp'], 0)
                
                # Calculate intrinsic and extrinsic values
                if option_type == 'CE':
                    intrinsic = max(spot_close - strike_price, 0)
                    extrinsic = item['close'] - intrinsic
                elif option_type == 'PE':
                    intrinsic = max(strike_price - spot_close, 0)
                    extrinsic = item['close'] - intrinsic
                else:
                    intrinsic = 0
                    extrinsic = 0
                
                # Signal detection for individual Extrinsic pattern
                # CE/PE Extrinsic Signal: (previous candle low < previous Extrinsic and current candle close > current Extrinsic) 
                #                     OR (current candle low < current Extrinsic and current candle close > current Extrinsic)
                extrinsic_signal = False
                if i > 0:  # Need previous candle for first condition
                    prev_item = data[i-1]
                    # Calculate previous extrinsic value
                    prev_spot_close = spot_lookup.get(prev_item['timestamp'], 0)
                    if option_type == 'CE':
                        prev_intrinsic = max(prev_spot_close - strike_price, 0)
                        prev_extrinsic = prev_item['close'] - prev_intrinsic
                    elif option_type == 'PE':
                        prev_intrinsic = max(strike_price - prev_spot_close, 0)
                        prev_extrinsic = prev_item['close'] - prev_intrinsic
                    else:
                        prev_extrinsic = 0
                    
                    # Condition 1: previous candle low < previous Extrinsic and current candle close > current Extrinsic
                    condition1 = (prev_item['low'] is not None and prev_item['low'] < prev_extrinsic and item['close'] > extrinsic)
                    
                    # Condition 2: current candle low < current Extrinsic and current candle close > current Extrinsic
                    condition2 = (item['low'] is not None and item['low'] < extrinsic and item['close'] > extrinsic)
                    
                    if condition1 or condition2:
                        # Check if previous candle already had the same signal to prevent duplicates
                        prev_had_signal = enhanced_data[-1].get('extrinsic_signal', False) if len(enhanced_data) > 0 else False
                        if not prev_had_signal:
                            extrinsic_signal = True
                
                enhanced_item = {
                    'time': ist_timestamp,
                    'open': round(item['open'], 2),
                    'high': round(item['high'], 2),
                    'low': round(item['low'], 2),
                    'close': round(item['close'], 2),
                    'volume': item['volume'],
                    'intrinsic': round(intrinsic, 2),
                    'extrinsic': round(extrinsic, 2),
                    'extrinsic_signal': extrinsic_signal
                }
                
                enhanced_data.append(enhanced_item)
            
            return enhanced_data
        
        # Process CE and PE data
        formatted_ce_data = format_chart_data_enhanced(ce_data, 'CE') if ce_data else []
        formatted_pe_data = format_chart_data_enhanced(pe_data, 'PE') if pe_data else []
        
        # Calculate combined premium data and additional metrics
        combined_data = []
        if formatted_ce_data and formatted_pe_data:
            # Align data by timestamp
            ce_dict = {item['time']: item for item in formatted_ce_data}
            pe_dict = {item['time']: item for item in formatted_pe_data}
            
            common_timestamps = set(ce_dict.keys()) & set(pe_dict.keys())
            
            sorted_timestamps = sorted(common_timestamps)
            
            for i, timestamp in enumerate(sorted_timestamps):
                ce_item = ce_dict[timestamp]
                pe_item = pe_dict[timestamp]
                
                # Calculate combined metrics
                open_combined_premium = ce_item['open'] + pe_item['open']
                combined_premium = ce_item['close'] + pe_item['close']
                combined_extrinsic = ce_item['extrinsic'] + pe_item['extrinsic']
                
                # Signal detection for Combined_Extrinsic pattern
                # Combined Extrinsic Signal: 
                # CE: (previous ce low < previous Combined_Extrinsic AND current ce close > current Combined_Extrinsic) 
                #     OR (current ce low < current Combined_Extrinsic AND current ce close > current Combined_Extrinsic)
                # PE: (previous pe low < previous Combined_Extrinsic AND current pe close > current Combined_Extrinsic) 
                #     OR (current pe low < current Combined_Extrinsic AND current pe close > current Combined_Extrinsic)
                combined_extrinsic_signal = False
                if i > 0:
                    prev_timestamp = sorted_timestamps[i-1]
                    prev_ce_item = ce_dict[prev_timestamp]
                    prev_pe_item = pe_dict[prev_timestamp]
                    prev_combined_extrinsic = prev_ce_item['extrinsic'] + prev_pe_item['extrinsic']
                    
                    # CE Conditions (CE close must be greater than PE close)
                    ce_condition1 = (prev_ce_item['low'] < prev_combined_extrinsic and ce_item['close'] > combined_extrinsic and ce_item['close'] > pe_item['close'])
                    ce_condition2 = (ce_item['low'] < combined_extrinsic and ce_item['close'] > combined_extrinsic and ce_item['close'] > pe_item['close'])
                    
                    # PE Conditions (PE close must be greater than CE close)
                    pe_condition1 = (prev_pe_item['low'] < prev_combined_extrinsic and pe_item['close'] > combined_extrinsic and pe_item['close'] > ce_item['close'])
                    pe_condition2 = (pe_item['low'] < combined_extrinsic and pe_item['close'] > combined_extrinsic and pe_item['close'] > ce_item['close'])
                    
                    if ce_condition1 or ce_condition2 or pe_condition1 or pe_condition2:
                        # Check if previous candle already had the same signal to prevent duplicates
                        prev_had_signal = combined_data[-1].get('combined_extrinsic_signal', False) if len(combined_data) > 0 else False
                        if not prev_had_signal:
                            combined_extrinsic_signal = True
                
                # CP_CE Signal detection: Combined Premium ≈ Combined Extrinsic (within 1%)
                cp_ce_signal = False
                if (ce_item.get('extrinsic_signal', False) or pe_item.get('extrinsic_signal', False)) and combined_extrinsic > 0:
                    tolerance = combined_extrinsic * 0.01
                    if abs(combined_premium - combined_extrinsic) <= tolerance:
                        cp_ce_signal = True
                
                combined_volume = (ce_item.get('volume') or 0) + (pe_item.get('volume') or 0)
                
                combined_item = {
                    'time': timestamp,
                    'open_combined_premium': round(open_combined_premium, 2),
                    'combined_premium': round(combined_premium, 2),
                    'combined_extrinsic': round(combined_extrinsic, 2),
                    'ce_intrinsic': round(ce_item['intrinsic'], 2),
                    'pe_intrinsic': round(pe_item['intrinsic'], 2),
                    'ce_extrinsic': round(ce_item['extrinsic'], 2),
                    'pe_extrinsic': round(pe_item['extrinsic'], 2),
                    'spot_close': round(spot_lookup.get(timestamp, 0), 2),
                    'combined_volume': combined_volume,
                    'combined_extrinsic_signal': combined_extrinsic_signal,
                    'ce_extrinsic_signal': ce_item.get('extrinsic_signal', False),
                    'pe_extrinsic_signal': pe_item.get('extrinsic_signal', False),
                    'cp_ce_signal': cp_ce_signal
                }
                
                combined_data.append(combined_item)
        
        # Add running LLP (lowest low of combined_premium) to each data point
        running_llp = None
        for item in combined_data:
            cp = item['combined_premium']
            if running_llp is None or cp < running_llp:
                running_llp = cp
            item['llp'] = round(running_llp, 2)
        
        return jsonify({
            'status': 'success',
            'data': {
                'strike': strike_price,
                'ce_symbol': ce_symbol,
                'pe_symbol': pe_symbol,
                'ce_data': formatted_ce_data,
                'pe_data': formatted_pe_data,
                'combined_data': combined_data,
                'llp': running_llp if running_llp is not None else 0,
                'timezone': 'Asia/Kolkata'
            }
        })
        
    except Exception as e:
        logger.error(f"Error fetching ezayChart data: {str(e)}")
        return jsonify({'status': 'error', 'message': f'Error fetching chart data: {str(e)}'}), 500

@madhan_bp.route('/api/ezayChart_signals')
@check_session_validity
def ezay_chart_signals():
    """Gets signal data for all strikes - lightweight endpoint for EzaySignals panel."""
    try:
        import pytz

        tracked_symbols = get_tracked_symbols()
        ist_tz = pytz.timezone('Asia/Kolkata')

        # Group symbols by strike
        strikes_map = {}
        for symbol in tracked_symbols:
            strike = extract_strike(symbol)
            if strike is None:
                continue
            if strike not in strikes_map:
                strikes_map[strike] = {'ce': None, 'pe': None}
            if symbol.endswith('CE'):
                strikes_map[strike]['ce'] = symbol
            elif symbol.endswith('PE'):
                strikes_map[strike]['pe'] = symbol

        spot_data = get_current_day_instrument_data('NIFTY')
        spot_lookup = {item['timestamp']: item['close'] for item in spot_data}

        all_signals = []
        last_data_time = 0
        first_candle_per_strike = {}

        for strike_price, symbols in sorted(strikes_map.items()):
            ce_symbol = symbols['ce']
            pe_symbol = symbols['pe']
            if not ce_symbol or not pe_symbol:
                continue

            ce_data = get_current_day_instrument_data(ce_symbol)
            pe_data = get_current_day_instrument_data(pe_symbol)
            if not ce_data or not pe_data:
                continue

            # Track the latest candle timestamp across all symbols
            if ce_data and ce_data[-1].get('timestamp', 0) > last_data_time:
                last_data_time = ce_data[-1]['timestamp']
            if pe_data and pe_data[-1].get('timestamp', 0) > last_data_time:
                last_data_time = pe_data[-1]['timestamp']

            def compute_extrinsic(data, option_type):
                result = []
                for i, item in enumerate(data):
                    if item['open'] is None or item['close'] is None:
                        continue
                    utc_dt = datetime.fromtimestamp(item['timestamp'], tz=pytz.UTC)
                    ist_dt = utc_dt.astimezone(ist_tz)
                    ist_ts = int(ist_dt.timestamp())
                    spot_close = spot_lookup.get(item['timestamp'], 0)
                    if option_type == 'CE':
                        intrinsic = max(spot_close - strike_price, 0)
                    else:
                        intrinsic = max(strike_price - spot_close, 0)
                    extrinsic = item['close'] - intrinsic

                    extrinsic_signal = False
                    if i > 0:
                        prev_item = data[i - 1]
                        prev_spot = spot_lookup.get(prev_item['timestamp'], 0)
                        if option_type == 'CE':
                            prev_ext = prev_item['close'] - max(prev_spot - strike_price, 0)
                        else:
                            prev_ext = prev_item['close'] - max(strike_price - prev_spot, 0)
                        c1 = (prev_item['low'] is not None and prev_item['low'] < prev_ext and item['close'] > extrinsic)
                        c2 = (item['low'] is not None and item['low'] < extrinsic and item['close'] > extrinsic)
                        if c1 or c2:
                            prev_had = result[-1].get('signal', False) if result else False
                            if not prev_had:
                                extrinsic_signal = True

                    result.append({'time': ist_ts, 'open': item['open'], 'close': item['close'], 'low': item['low'], 'high': item['high'],
                                   'extrinsic': round(extrinsic, 2), 'signal': extrinsic_signal})
                return result

            ce_enhanced = compute_extrinsic(ce_data, 'CE')
            pe_enhanced = compute_extrinsic(pe_data, 'PE')

            ce_dict = {item['time']: item for item in ce_enhanced}
            pe_dict = {item['time']: item for item in pe_enhanced}
            common_ts = sorted(set(ce_dict.keys()) & set(pe_dict.keys()))

            prev_cp_signal = False
            prev_cp_ce_sig = False
            th_prev_touch = False

            for i, ts in enumerate(common_ts):
                ce_item = ce_dict[ts]
                pe_item = pe_dict[ts]
                combined_premium = ce_item['close'] + pe_item['close']
                combined_extrinsic = ce_item['extrinsic'] + pe_item['extrinsic']

                # Track first candle data for IR and cp_open
                if i == 0:
                    first_candle_per_strike[strike_price] = {
                        'ce_open': ce_item['open'],
                        'ce_close': ce_item['close'],
                        'pe_open': pe_item['open'],
                        'pe_close': pe_item['close'],
                        'combined_ext': combined_extrinsic,
                    }

                # CP (Combined Extrinsic) signal
                cp_signal = False
                if i > 0:
                    prev_ts = common_ts[i - 1]
                    prev_ce = ce_dict[prev_ts]
                    prev_pe = pe_dict[prev_ts]
                    prev_combined_ext = prev_ce['extrinsic'] + prev_pe['extrinsic']
                    ce_c1 = (prev_ce['low'] < prev_combined_ext and ce_item['close'] > combined_extrinsic and ce_item['close'] > pe_item['close'])
                    ce_c2 = (ce_item['low'] < combined_extrinsic and ce_item['close'] > combined_extrinsic and ce_item['close'] > pe_item['close'])
                    pe_c1 = (prev_pe['low'] < prev_combined_ext and pe_item['close'] > combined_extrinsic and pe_item['close'] > ce_item['close'])
                    pe_c2 = (pe_item['low'] < combined_extrinsic and pe_item['close'] > combined_extrinsic and pe_item['close'] > ce_item['close'])
                    if not prev_cp_signal:
                        if ce_c1 or ce_c2:
                            cp_signal = 'CE'
                        elif pe_c1 or pe_c2:
                            cp_signal = 'PE'
                prev_cp_signal = bool(cp_signal)

                # CP_CE signal - only valid when CE or PE signal is also present
                cp_ce_signal = False
                if (ce_item['signal'] or pe_item['signal']) and combined_extrinsic > 0:
                    tolerance = combined_extrinsic * 0.01
                    if abs(combined_premium - combined_extrinsic) <= tolerance:
                        cp_ce_signal = True
                prev_cp_ce_sig = cp_ce_signal

                # TH (Touch) signal — CE and PE candle OHLC ranges overlap
                th_signal = False
                th_dir = False
                ce_high = ce_item.get('high', ce_item['close'])
                pe_high = pe_item.get('high', pe_item['close'])
                is_touch = (ce_high is not None and pe_high is not None and
                            ce_high >= pe_item['low'] and pe_high >= ce_item['low'])
                if is_touch:
                    if ce_item['close'] > pe_item['close']:
                        th_dir = 'CE'
                    else:
                        th_dir = 'PE'
                    if not th_prev_touch:
                        th_signal = 'dot'
                elif th_prev_touch:
                    if ce_item['close'] > pe_item['close']:
                        th_signal = 'CE'
                        th_dir = 'CE'
                    else:
                        th_signal = 'PE'
                        th_dir = 'PE'
                th_prev_touch = is_touch

                if ce_item['signal'] or pe_item['signal'] or cp_signal or cp_ce_signal or th_signal:
                    all_signals.append({
                        'time': ts,
                        'strike': strike_price,
                        'ce_signal': ce_item['signal'],
                        'pe_signal': pe_item['signal'],
                        'cp_signal': cp_signal,
                        'cp_ce_signal': cp_ce_signal,
                        'th_signal': th_signal,
                        'th_dir': th_dir,
                        'ce_close': ce_item['close'],
                        'pe_close': pe_item['close'],
                    })

        all_signals.sort(key=lambda x: (x['time'], x['strike']))

        # Compute first-signal summaries
        signals = {
            'ce_pe': {'time': 0, 'type': '', 'strike': 0},
            'ce_pe_hc': {'time': 0, 'type': '', 'strike': 0},
            'cp': {'time': 0, 'strike': 0},
            'cp_open': {'time': 0, 'strike': 0},
            'th': {'time': 0, 'type': '', 'strike': 0},
            'ir': [],
        }

        # IR: all strikes where day's 1st candle open+close < combined_ext for both CE and PE
        for strike, fc in first_candle_per_strike.items():
            if (fc['ce_open'] < fc['combined_ext'] and fc['ce_close'] < fc['combined_ext'] and
                    fc['pe_open'] < fc['combined_ext'] and fc['pe_close'] < fc['combined_ext']):
                signals['ir'].append(strike)
        signals['ir'].sort()

        for row in all_signals:
            # ce_pe: first CE or PE signal (no HC)
            if signals['ce_pe']['time'] == 0 and (row['ce_signal'] or row['pe_signal']):
                signals['ce_pe'] = {
                    'time': row['time'],
                    'type': 'CE' if row['ce_signal'] else 'PE',
                    'strike': row['strike'],
                }
            # ce_pe_hc: first CE/PE signal with HC filter
            if signals['ce_pe_hc']['time'] == 0:
                if row['ce_signal'] and row['ce_close'] > row['pe_close']:
                    signals['ce_pe_hc'] = {'time': row['time'], 'type': 'CE', 'strike': row['strike']}
                elif row['pe_signal'] and row['pe_close'] > row['ce_close']:
                    signals['ce_pe_hc'] = {'time': row['time'], 'type': 'PE', 'strike': row['strike']}
            # cp: first CP signal
            if signals['cp']['time'] == 0 and row['cp_signal']:
                signals['cp'] = {'time': row['time'], 'strike': row['strike']}
            # cp_open: first CP signal where 1st candle open+close < combined_ext for both CE and PE
            if signals['cp_open']['time'] == 0 and row['cp_signal']:
                fc = first_candle_per_strike.get(row['strike'])
                if fc and (fc['ce_open'] < fc['combined_ext'] and fc['ce_close'] < fc['combined_ext'] and
                           fc['pe_open'] < fc['combined_ext'] and fc['pe_close'] < fc['combined_ext']):
                    signals['cp_open'] = {'time': row['time'], 'strike': row['strike']}
            # th: first TH non-touch (CE/PE text, not dot)
            if signals['th']['time'] == 0 and row.get('th_signal') and row['th_signal'] != 'dot':
                signals['th'] = {'time': row['time'], 'type': row.get('th_dir', ''), 'strike': row['strike']}

        return jsonify({'status': 'success', 'last_time': last_data_time, 'data': all_signals, 'signals': signals})

    except Exception as e:
        logger.error(f'Error fetching ezayChart signals: {str(e)}')
        return jsonify({'status': 'error', 'message': f'Error fetching signals: {str(e)}'}), 500


# ---------------------------------------------------------------------------
# Backtest endpoints — read parquet data from db/options_data/
# ---------------------------------------------------------------------------

@madhan_bp.route('/api/nifty/backtest_dates')
def backtest_dates():
    """Returns list of available backtest dates from parquet files."""
    try:
        from database.madhan_db import get_backtest_available_dates
        dates = get_backtest_available_dates()
        return jsonify({'status': 'success', 'data': dates})
    except Exception as e:
        logger.error(f'Error fetching backtest dates: {str(e)}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


@madhan_bp.route('/api/nifty/backtest_strikes')
def backtest_strikes():
    """Returns strike list for a backtest date — 10 above/below Open ATM.
    Query param: date=YYYY-MM-DD
    Response format matches /api/strikes."""
    try:
        from database.madhan_db import get_backtest_strikes
        date_str = request.args.get('date')
        if not date_str:
            return jsonify({'status': 'error', 'message': 'date parameter required (YYYY-MM-DD)'}), 400
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return jsonify({'status': 'error', 'message': 'Invalid date format. Use YYYY-MM-DD'}), 400

        result = get_backtest_strikes(date_str)
        if result is None:
            return jsonify({'status': 'error', 'message': f'No data available for {date_str}'}), 404
        return jsonify(result)
    except Exception as e:
        logger.error(f'Error fetching backtest strikes: {str(e)}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


@madhan_bp.route('/api/nifty/backtest_chart_data')
def backtest_chart_data():
    """Returns chart data for a specific strike from parquet — same format as /api/ezayChart_data.
    Query params: date=YYYY-MM-DD, strike=XXXX"""
    try:
        from database.madhan_db import get_backtest_chart_data
        date_str = request.args.get('date')
        strike_str = request.args.get('strike')
        if not date_str or not strike_str:
            return jsonify({'status': 'error', 'message': 'date and strike parameters required'}), 400
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
            strike_price = int(strike_str)
        except (ValueError, TypeError):
            return jsonify({'status': 'error', 'message': 'Invalid date or strike format'}), 400

        result = get_backtest_chart_data(date_str, strike_price)
        if result is None:
            return jsonify({'status': 'error', 'message': f'No data available for strike {strike_price} on {date_str}'}), 404
        return jsonify({'status': 'success', 'data': result})
    except Exception as e:
        logger.error(f'Error fetching backtest chart data: {str(e)}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


@madhan_bp.route('/api/nifty/backtest_signals')
def backtest_signals():
    """Returns all-strike signals for a backtest date — same format as /api/ezayChart_signals.
    Query param: date=YYYY-MM-DD"""
    try:
        from database.madhan_db import get_backtest_signals
        date_str = request.args.get('date')
        if not date_str:
            return jsonify({'status': 'error', 'message': 'date parameter required (YYYY-MM-DD)'}), 400
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return jsonify({'status': 'error', 'message': 'Invalid date format. Use YYYY-MM-DD'}), 400

        result = get_backtest_signals(date_str)
        if result is None:
            return jsonify({'status': 'error', 'message': f'No data available for {date_str}'}), 404
        return jsonify(result)
    except Exception as e:
        logger.error(f'Error fetching backtest signals: {str(e)}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


@madhan_bp.route('/api/nifty/backtest_range')
def backtest_range():
    """Run multi-day backtest across a date range.
    Query params: from=YYYY-MM-DD, to=YYYY-MM-DD
    Runs all strategies in STRATEGY_REGISTRY with dynamic strikes from signals."""
    try:
        from database.madhan_db import get_backtest_range
        from_date = request.args.get('from')
        to_date = request.args.get('to')
        if not from_date or not to_date:
            return jsonify({'status': 'error', 'message': 'from and to parameters required (YYYY-MM-DD)'}), 400
        try:
            datetime.strptime(from_date, '%Y-%m-%d')
            datetime.strptime(to_date, '%Y-%m-%d')
        except ValueError:
            return jsonify({'status': 'error', 'message': 'Invalid date format. Use YYYY-MM-DD'}), 400
        if from_date > to_date:
            return jsonify({'status': 'error', 'message': 'from date must be before to date'}), 400

        result = get_backtest_range(from_date, to_date)
        if result is None:
            return jsonify({'status': 'error', 'message': f'No data available for range {from_date} to {to_date}'}), 404
        return jsonify(result)
    except Exception as e:
        logger.error(f'Error running backtest range: {str(e)}')
        return jsonify({'status': 'error', 'message': str(e)}), 500


@madhan_bp.route('/api/strikes')
@check_session_validity
def get_strikes():
    """Gets available strike prices and symbols from tracked symbols."""
    try:
        tracked_symbols = get_tracked_symbols()
        strikes_data = {}
        symbols_map = {}
        
        for symbol in tracked_symbols:
            strike = extract_strike(symbol)
            if strike is not None:
                if strike not in strikes_data:
                    strikes_data[strike] = {'ce_symbol': None, 'pe_symbol': None}
                    
                if symbol.endswith('CE'):
                    strikes_data[strike]['ce_symbol'] = symbol
                    symbols_map[f"{strike}_CE"] = {
                        'symbol': symbol,
                        'exchange': 'NFO',
                        'strike': strike,
                        'type': 'CE'
                    }
                elif symbol.endswith('PE'):
                    strikes_data[strike]['pe_symbol'] = symbol
                    symbols_map[f"{strike}_PE"] = {
                        'symbol': symbol,
                        'exchange': 'NFO',
                        'strike': strike,
                        'type': 'PE'
                    }
        
        sorted_strikes = sorted(list(strikes_data.keys()))
        
        return jsonify({
            'status': 'success',
            'data': sorted_strikes,
            'strikes_data': strikes_data,
            'symbols_map': symbols_map
        })
        
    except Exception as e:
        logger.error(f"Error fetching strikes: {str(e)}")
        return jsonify({'status': 'error', 'message': f'Error fetching strikes: {str(e)}'}), 500


@madhan_bp.route('/api/nifty/dash-data')
@check_session_validity
def nifty_dash_data():
    """Calculates Unified OI and COI data for the Dash tab."""
    mode = request.args.get('mode', 'writer_open') # Default to writer_open
    end_ts = request.args.get('end_ts')
    if end_ts:
        try:
            end_ts = int(end_ts)
        except ValueError:
            end_ts = None
    
    # 1. Get option data (latest or at specific time) and previous day OI
    current_option_data = get_consistent_current_option_data(end_ts=end_ts)
    prev_day_data = get_previous_day_oi()
    prev_oi_map = {item['symbol']: item.get('oi', 0) for item in prev_day_data}
    
    open_atm = nifty_fetcher.open_atm_strike
    
    # In replay mode, current_atm should be based on the data at end_ts
    if end_ts:
        latest_nifty = get_nifty_data(limit=1, end_ts=end_ts)
        if latest_nifty:
            spot_price = latest_nifty[0]['close']
            current_atm = round(spot_price / 50) * 50
        else:
            current_atm = nifty_fetcher.current_atm_strike or open_atm
    else:
        current_atm = nifty_fetcher.current_atm_strike or open_atm
    
    def is_included(sym, strike):
        if mode == 'total': return True
        base_atm = open_atm if mode == 'writer_open' else current_atm
        if not base_atm: return True
        
        # Symmetric ATM +/- 5 strikes (total 11 strikes) for Writer Views
        # NIFTY strike interval is 50, so 5 strikes = 250 points
        if strike > base_atm + 250 or strike < base_atm - 250:
            return False
            
        # One-sided filtering to focus on "Writing Zone" (OTM + ATM + 2 ITM)
        if sym.endswith('PE') and strike > base_atm + 100: return False
        if sym.endswith('CE') and strike < base_atm - 100: return False
        return True

    total_call_oi = 0
    total_put_oi = 0
    total_call_coi = 0
    total_put_coi = 0
    total_call_vol = 0
    total_put_vol = 0
    
    highest_call_oi = {'strike': 0, 'oi': 0, 'coi': 0}
    highest_put_oi = {'strike': 0, 'oi': 0, 'coi': 0}
    
    chain_data = []
    
    # Group by strike
    strikes_map = defaultdict(lambda: {'strike': 0, 'ce_oi': 0, 'ce_coi': 0, 'ce_vol': 0, 'pe_oi': 0, 'pe_coi': 0, 'pe_vol': 0})
    
    for item in current_option_data:
        symbol = item['symbol']
        strike = extract_strike(symbol)
        if strike is None: continue
        
        current_oi = item.get('oi', 0)
        current_vol = item.get('day_volume', 0) # Use day_volume for Dash summary
        prev_oi = prev_oi_map.get(symbol, 0)
        coi = current_oi - prev_oi
        
        strikes_map[strike]['strike'] = strike
        
        # Determine if strike should be included in totals
        include_in_totals = is_included(symbol, strike)

        if symbol.endswith('CE'):
            if include_in_totals:
                total_call_oi += current_oi
                total_call_coi += coi
                total_call_vol += current_vol
            
            strikes_map[strike]['ce_oi'] = current_oi
            strikes_map[strike]['ce_coi'] = coi
            strikes_map[strike]['ce_vol'] = current_vol # Store day_volume per strike
            if current_oi > highest_call_oi['oi']:
                highest_call_oi = {'strike': strike, 'oi': current_oi, 'coi': coi}
        elif symbol.endswith('PE'):
            if include_in_totals:
                total_put_oi += current_oi
                total_put_coi += coi
                total_put_vol += current_vol
                
            strikes_map[strike]['pe_oi'] = current_oi
            strikes_map[strike]['pe_coi'] = coi
            strikes_map[strike]['pe_vol'] = current_vol # Store day_volume per strike
            if current_oi > highest_put_oi['oi']:
                highest_put_oi = {'strike': strike, 'oi': current_oi, 'coi': coi}
                
    # Convert map to sorted list
    chain_data = sorted(strikes_map.values(), key=lambda x: x['strike'], reverse=True)
    
    # Calculate Max Pain
    max_pain_strike = 0
    min_pain = float('inf')
    
    all_strikes = [s['strike'] for s in chain_data]
    for x in all_strikes:
        total_pain = 0
        for row in chain_data:
            s = row['strike']
            if x > s:
                total_pain += (x - s) * row['ce_oi']
            elif x < s:
                total_pain += (s - x) * row['pe_oi']
        
        if total_pain < min_pain:
            min_pain = total_pain
            max_pain_strike = x

    return jsonify({
        'status': 'success',
        'summary': {
            'total_call_oi': total_call_oi,
            'total_put_oi': total_put_oi,
            'total_call_coi': total_call_coi,
            'total_put_coi': total_put_coi,
            'total_call_vol': total_call_vol,
            'total_put_vol': total_put_vol,
            'highest_call_oi': highest_call_oi,
            'highest_put_oi': highest_put_oi,
            'max_pain': max_pain_strike,
            'current_atm': current_atm,
            'pcr_oi': round(total_put_oi / total_call_oi, 2) if total_call_oi > 0 else 0,
            'pcr_vol': round(total_put_vol / total_call_vol, 2) if total_call_vol > 0 else 0
        },
        'chain_data': chain_data
    })


@madhan_bp.route('/api/nifty/dash-time-analysis')
@check_session_validity
def nifty_dash_time_analysis():
    """Provides interval analysis for all tracked strikes with custom timeframe."""
    mode = request.args.get('mode', 'writer_open')
    end_ts = request.args.get('end_ts')
    interval_mins = int(request.args.get('interval', 3)) # Default to 3 minutes
    
    if end_ts:
        try:
            end_ts = int(end_ts)
        except ValueError:
            end_ts = None
    
    # 1. Get all tracked symbols
    tracked_symbols = nifty_fetcher.option_symbols
    if not tracked_symbols:
        return jsonify({'status': 'success', 'data': []})

    # 2. Get 1-min data for all symbols (includes NIFTY spot)
    historical_data = get_current_day_historical_data(end_ts=end_ts)
    if not historical_data:
        return jsonify({'status': 'success', 'data': []})

    # Group by timestamp
    data_by_ts = defaultdict(list)
    nifty_by_ts = {}
    for row in historical_data:
        if row['symbol'] == 'NIFTY':
            nifty_by_ts[row['timestamp']] = row['close']
        else:
            data_by_ts[row['timestamp']].append(row)

    sorted_ts = sorted(nifty_by_ts.keys())
    if not sorted_ts:
        # Fallback if NIFTY spot not found in historical, use option timestamps
        sorted_ts = sorted(data_by_ts.keys())
        if not sorted_ts:
            return jsonify({'status': 'success', 'data': []})

    open_atm = nifty_fetcher.open_atm_strike
    
    # Calculate current ATM based on latest spot in the window
    latest_spot = nifty_by_ts.get(sorted_ts[-1], 0)
    if end_ts and latest_spot == 0:
        latest_nifty = get_nifty_data(limit=1, end_ts=end_ts)
        latest_spot = latest_nifty[0]['close'] if latest_nifty else 0
    
    current_atm = round(latest_spot / 50) * 50 if latest_spot > 0 else (nifty_fetcher.current_atm_strike or open_atm)
    
    def is_included(sym, strike, bucket_atm):
        if mode == 'total': return True
        base_atm = open_atm if mode == 'writer_open' else bucket_atm
        if not base_atm: return True
        # Symmetric ATM +/- 5 strikes (total 11 strikes)
        if strike > base_atm + 250 or strike < base_atm - 250: return False
        # One-sided writing zone filtering
        if sym.endswith('PE') and strike > base_atm + 100: return False
        if sym.endswith('CE') and strike < base_atm - 100: return False
        return True

    # 4. Aggregate into custom-minute buckets
    bucket_data = []
    period_secs = interval_mins * 60
    
    # Define start of market (09:15 IST)
    if sorted_ts:
        market_start_ts = sorted_ts[0]
    else:
        today_date = get_valid_trading_day(exchange="NSE")
        market_start_ts = int(datetime.combine(today_date, time(3, 45)).timestamp())
    
    current_bucket = None
    bucket_start_time = 0
    
    # Track Day High/Low for Spot and Diff
    day_high_spot = -1.0
    day_low_spot = float('inf')
    
    for ts in sorted_ts:
        if ts < market_start_ts: continue
        
        # Skip incomplete candles (not all option symbols present)
        if ts in data_by_ts and len(data_by_ts[ts]) < len(tracked_symbols):
            continue
        
        spot = nifty_by_ts.get(ts, 0)
        if spot > 0:
            day_high_spot = max(day_high_spot, spot)
            day_low_spot = min(day_low_spot, spot)
        
        bucket_idx = (ts - market_start_ts) // period_secs
        bucket_start = market_start_ts + (bucket_idx * period_secs)
        
        if current_bucket and bucket_start != bucket_start_time:
            # Finalize the previous bucket's OI based on its OWN ATM
            bucket_atm = round(current_bucket['ltp'] / 50) * 50 if current_bucket['ltp'] > 0 else current_atm
            
            # Recalculate OI for the bucket based on its specific ATM
            bucket_ce_oi = 0
            bucket_pe_oi = 0
            
            # We need the data at the LAST timestamp of this bucket
            last_ts_in_bucket = current_bucket['last_ts']
            for item in data_by_ts[last_ts_in_bucket]:
                sym = item['symbol']
                strike = extract_strike(sym)
                if not strike or not is_included(sym, strike, bucket_atm): continue
                if sym.endswith('CE'): bucket_ce_oi += item.get('oi', 0)
                elif sym.endswith('PE'): bucket_pe_oi += item.get('oi', 0)
            
            current_bucket['ce_oi'] = bucket_ce_oi
            current_bucket['pe_oi'] = bucket_pe_oi
            current_bucket['atm'] = bucket_atm
            
            bucket_data.append(current_bucket)
            current_bucket = None
            
        if not current_bucket:
            bucket_start_time = bucket_start
            current_bucket = {
                'start_ts': bucket_start,
                'end_ts': bucket_start + period_secs - 60,
                'ce_oi': 0, 'pe_oi': 0,
                'ltp': spot,
                'last_ts': ts,
                'is_high_break': False,
                'is_low_break': False
            }
        
        current_bucket['ltp'] = spot if spot > 0 else current_bucket['ltp']
        current_bucket['last_ts'] = ts
        if spot > 0:
            if spot >= day_high_spot: current_bucket['is_high_break'] = True
            if spot <= day_low_spot: current_bucket['is_low_break'] = True

    if current_bucket:
        # Finalize the last bucket (after loop)
        bucket_atm = round(current_bucket['ltp'] / 50) * 50 if current_bucket['ltp'] > 0 else current_atm
        bucket_ce_oi = 0
        bucket_pe_oi = 0
        last_ts_in_bucket = current_bucket['last_ts']
        for item in data_by_ts[last_ts_in_bucket]:
            sym = item['symbol']
            strike = extract_strike(sym)
            if not strike or not is_included(sym, strike, bucket_atm):
                continue
            if sym.endswith('CE'):
                bucket_ce_oi += item.get('oi', 0)
            elif sym.endswith('PE'):
                bucket_pe_oi += item.get('oi', 0)
        
        current_bucket['ce_oi'] = bucket_ce_oi
        current_bucket['pe_oi'] = bucket_pe_oi
        current_bucket['atm'] = bucket_atm
        bucket_data.append(current_bucket)

    results = []
    prev_diff = 0
    day_max_diff = -float('inf')
    day_min_diff = float('inf')
    
    for i, b in enumerate(bucket_data):
        ce_oi = b['ce_oi']
        pe_oi = b['pe_oi']
        diff = pe_oi - ce_oi
        
        day_max_diff = max(day_max_diff, diff)
        day_min_diff = min(day_min_diff, diff)
        day_hl_diff = day_max_diff - day_min_diff
        
        chg_in_direction = diff - prev_diff if i > 0 else 0
        direction_chg_pct = (chg_in_direction / abs(prev_diff) * 100) if i > 0 and prev_diff != 0 else 0
        
        sentiment = "Neutral"
        if diff > 0 and chg_in_direction > 0: sentiment = "Bullish"
        elif diff < 0 and chg_in_direction < 0: sentiment = "Bearish"
        elif diff > 0 and chg_in_direction < 0: sentiment = "Weak Bullish"
        elif diff < 0 and chg_in_direction > 0: sentiment = "Weak Bearish"

        results.append({
            'index': i + 1,
            'date': datetime.fromtimestamp(b['last_ts']).strftime('%d-%m-%Y'),
            'time': datetime.fromtimestamp(b['last_ts']).strftime('%H:%M:%S'),
            'atm': b.get('atm', current_atm),
            'ltp': round(b['ltp'], 2),
            'hl_break': 'H Break' if b['is_high_break'] else 'L Break' if b['is_low_break'] else '-',
            'ce_oi': ce_oi,
            'pe_oi': pe_oi,
            'diff_oi': diff,
            'direction': '▲' if chg_in_direction > 0 else '▼' if chg_in_direction < 0 else '-',
            'chg_direction': chg_in_direction,
            'chg_direction_pct': round(direction_chg_pct, 2),
            'net_pcr': round(pe_oi / ce_oi, 2) if ce_oi > 0 else 0,
            'day_hl_diff': day_hl_diff,
            'sentiment': sentiment
        })
        prev_diff = diff

    return jsonify({'status': 'success', 'data': list(reversed(results))})


@madhan_bp.route('/api/nifty/signals-cross')
@check_session_validity
def nifty_signals_cross():
    """Calculates CALL and PUT crossover signals for the current day."""
    timeframe = int(request.args.get('timeframe', '1'))
    
    # 1. Get ATM and Expiry from fetcher
    atm_strike = nifty_fetcher.open_atm_strike or nifty_fetcher.current_atm_strike
    expiry_date = nifty_fetcher.expiry_date
    
    if not atm_strike or not expiry_date:
        return jsonify({'status': 'success', 'data': [], 'message': 'ATM or Expiry not available.'})

    # 2. Generate the 11 strikes around ATM
    strikes = [atm_strike + (i * 50) for i in range(-5, 6)]
    
    # 3. Helper to get symbol names (same logic as frontend)
    def get_symbol_py(strike, type_):
        try:
            # expiry_date is usually "DD-MMM-YY"
            date_obj = datetime.strptime(expiry_date, "%d-%b-%y")
            day = date_obj.strftime("%d")
            month = date_obj.strftime("%b").upper()
            year = date_obj.strftime("%y")
            return f"NIFTY{day}{month}{year}{strike}{type_}"
        except:
            return None

    tracked_ce = {}
    tracked_pe = {}
    for s in strikes:
        ce = get_symbol_py(s, 'CE')
        pe = get_symbol_py(s, 'PE')
        if ce: tracked_ce[ce] = s
        if pe: tracked_pe[pe] = s
        
    all_tracked = set(tracked_ce.keys()) | set(tracked_pe.keys())

    # 4. Fetch historical data for today
    historical_data = get_current_day_historical_data()
    if not historical_data:
        return jsonify({'status': 'success', 'data': []})

    # 5. Group by timestamp and strike
    data_by_ts = defaultdict(dict)
    for row in historical_data:
        symbol = row['symbol']
        if symbol in all_tracked:
            ts = row['timestamp']
            data_by_ts[ts][symbol] = row['close']

    sorted_ts = sorted(data_by_ts.keys())
    if not sorted_ts:
        return jsonify({'status': 'success', 'data': []})

    # 6. Aggregate to requested timeframe (buckets)
    bucket_data = []
    period_secs = timeframe * 60
    
    current_bucket = None
    bucket_start_time = 0
    
    for ts in sorted_ts:
        bucket_start = (ts // period_secs) * period_secs
        
        if current_bucket and bucket_start != bucket_start_time:
            bucket_data.append(current_bucket)
            current_bucket = None
            
        if not current_bucket:
            bucket_start_time = bucket_start
            current_bucket = {
                'timestamp': bucket_start,
                'ce_closes': {},
                'pe_closes': {}
            }
            
        # Update closes in the current bucket (last one wins for the bucket close)
        for sym, close in data_by_ts[ts].items():
            if sym in tracked_ce:
                current_bucket['ce_closes'][sym] = close
            elif sym in tracked_pe:
                current_bucket['pe_closes'][sym] = close
                
    if current_bucket:
        bucket_data.append(current_bucket)

    # 7. Detect Crossovers
    signals = []
    for i in range(1, len(bucket_data)):
        curr = bucket_data[i]
        prev = bucket_data[i-1]
        
        call_cross_count = 0
        put_cross_count = 0
        
        # Check every CE strike vs every PE strike
        for ce_sym, ce_close in curr['ce_closes'].items():
            prev_ce_close = prev['ce_closes'].get(ce_sym)
            if prev_ce_close is None: continue
            
            for pe_sym, pe_close in curr['pe_closes'].items():
                prev_pe_close = prev['pe_closes'].get(pe_sym)
                if prev_pe_close is None: continue
                
                # CALL: CE crosses above PE
                if ce_close > pe_close and prev_ce_close <= prev_pe_close:
                    call_cross_count += 1
                # PUT: PE crosses above CE
                if pe_close > ce_close and prev_pe_close <= prev_ce_close:
                    put_cross_count += 1
                    
        if call_cross_count > 0:
            signals.append({
                'time': curr['timestamp'] * 1000,
                'type': 'CALLx',
                'count': call_cross_count
            })
        elif put_cross_count > 0:
            signals.append({
                'time': curr['timestamp'] * 1000,
                'type': 'PUTx',
                'count': put_cross_count
            })
            
    return jsonify({'status': 'success', 'data': signals})



@madhan_bp.route('/api/nifty/support-resistance')
@check_session_validity
def nifty_support_resistance():
    """Calculates support and resistance strikes based on OI and COI for each timestamp."""
    open_atm = nifty_fetcher.open_atm_strike
    if not open_atm or open_atm == 0:
        return jsonify({
            'status': 'success', 
            'data': {
                'timestamps': [], 
                'oi_support': [], 
                'oi_resistance': [],
                'coi_support': [],
                'coi_resistance': [],
                'oi_sr': None,
                'coi_sr': None
            }, 
            'message': 'ATM strike not calculated yet.'
        })

    # Always use all strikes (option1)
    expected_symbol_count = len(nifty_fetcher.option_symbols) + 1  # +1 for NIFTY index

    # Get previous day OI data for COI calculation
    prev_day_data = get_previous_day_oi()
    prev_oi_map = {item['symbol']: item.get('oi', 0) for item in prev_day_data}

    # Get current day historical data
    historical_data = get_current_day_historical_data()
    if not historical_data:
        return jsonify({
            'status': 'success', 
            'data': {
                'timestamps': [], 
                'oi_support': [], 
                'oi_resistance': [],
                'coi_support': [],
                'coi_resistance': [],
                'oi_sr': None,
                'coi_sr': None
            }, 
            'message': 'No historical data for today.'
        })

    # Group data by timestamp
    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row['timestamp']].append(row)

    sorted_timestamps = sorted(data_by_ts.keys())

    timestamps_res = []
    oi_support_res = []
    oi_resistance_res = []
    coi_support_res = []
    coi_resistance_res = []

    for ts in sorted_timestamps:
        # Skip incomplete candles
        if len(data_by_ts[ts]) < expected_symbol_count:
            logger.debug(f"Skipping incomplete candle at timestamp {ts}: got {len(data_by_ts[ts])} symbols, expected {expected_symbol_count}")
            continue

        # Dictionary to store OI and COI by strike price
        strike_data = {}  # {strike_price: {'ce_oi': x, 'pe_oi': y, 'ce_coi': z, 'pe_coi': w}}

        for item in data_by_ts[ts]:
            symbol = item['symbol']
            current_oi = item.get('oi', 0)
            
            # Skip NIFTY index symbol
            if symbol == 'NIFTY':
                continue
            
            # Extract strike price
            strike_price = extract_strike(symbol)
            if strike_price is None:
                continue
            
            # Initialize strike data if not exists
            if strike_price not in strike_data:
                strike_data[strike_price] = {
                    'ce_oi': 0, 
                    'pe_oi': 0, 
                    'ce_coi': 0, 
                    'pe_coi': 0
                }
            
            # Store OI
            if symbol.endswith('CE'):
                strike_data[strike_price]['ce_oi'] = current_oi
            elif symbol.endswith('PE'):
                strike_data[strike_price]['pe_oi'] = current_oi
            
            # Calculate and store COI
            prev_oi = prev_oi_map.get(symbol, 0)
            if prev_oi > 0 and current_oi > 0:
                change_in_oi = current_oi - prev_oi
                if symbol.endswith('CE'):
                    strike_data[strike_price]['ce_coi'] = change_in_oi
                elif symbol.endswith('PE'):
                    strike_data[strike_price]['pe_coi'] = change_in_oi
        
        # Find OI Support: Highest strike where PE OI > CE OI
        oi_support = None
        for strike in sorted(strike_data.keys(), reverse=True):
            if strike_data[strike]['pe_oi'] > strike_data[strike]['ce_oi']:
                oi_support = strike
                break
        
        # Find OI Resistance: Lowest strike where CE OI > PE OI
        oi_resistance = None
        for strike in sorted(strike_data.keys()):
            if strike_data[strike]['ce_oi'] > strike_data[strike]['pe_oi']:
                oi_resistance = strike
                break
        
        # Find COI Support: Highest strike where PE COI > CE COI
        coi_support = None
        for strike in sorted(strike_data.keys(), reverse=True):
            if strike_data[strike]['pe_coi'] > strike_data[strike]['ce_coi']:
                coi_support = strike
                break
        
        # Find COI Resistance: Lowest strike where CE COI > PE COI
        coi_resistance = None
        for strike in sorted(strike_data.keys()):
            if strike_data[strike]['ce_coi'] > strike_data[strike]['pe_coi']:
                coi_resistance = strike
                break
        
        # Append results
        timestamps_res.append(ts * 1000)  # JS expects milliseconds
        oi_support_res.append(oi_support)
        oi_resistance_res.append(oi_resistance)
        coi_support_res.append(coi_support)
        coi_resistance_res.append(coi_resistance)

    # Calculate trends by comparing last two values of both support and resistance
    oi_trend = None
    coi_trend = None
    
    # OI Trend: Check both support and resistance
    if len(oi_support_res) >= 2 and len(oi_resistance_res) >= 2:
        support_valid = oi_support_res[-1] is not None and oi_support_res[-2] is not None
        resistance_valid = oi_resistance_res[-1] is not None and oi_resistance_res[-2] is not None
        
        if support_valid and resistance_valid:
            support_increasing = oi_support_res[-1] > oi_support_res[-2]
            resistance_increasing = oi_resistance_res[-1] > oi_resistance_res[-2]
            
            # Both moving up = Incremental, Both moving down = Decremental
            if support_increasing and resistance_increasing:
                oi_trend = "Incremental"
            elif not support_increasing and not resistance_increasing:
                oi_trend = "Decremental"
            else:
                # Mixed signals - you can decide: use support priority or mark as "Neutral"
                oi_trend = "Incremental" if support_increasing else "Decremental"
    
    # COI Trend: Check both support and resistance
    if len(coi_support_res) >= 2 and len(coi_resistance_res) >= 2:
        support_valid = coi_support_res[-1] is not None and coi_support_res[-2] is not None
        resistance_valid = coi_resistance_res[-1] is not None and coi_resistance_res[-2] is not None
        
        if support_valid and resistance_valid:
            support_increasing = coi_support_res[-1] > coi_support_res[-2]
            resistance_increasing = coi_resistance_res[-1] > coi_resistance_res[-2]
            
            # Both moving up = Incremental, Both moving down = Decremental
            if support_increasing and resistance_increasing:
                coi_trend = "Incremental"
            elif not support_increasing and not resistance_increasing:
                coi_trend = "Decremental"
            else:
                # Mixed signals - you can decide: use support priority or mark as "Neutral"
                coi_trend = "Incremental" if support_increasing else "Decremental"

    return jsonify({
        'status': 'success', 
        'data': {
            'timestamps': timestamps_res,
            'oi_support': oi_support_res,
            'oi_resistance': oi_resistance_res,
            'coi_support': coi_support_res,
            'coi_resistance': coi_resistance_res,
            'oi_sr': oi_trend,
            'coi_sr': coi_trend
        }
    })
