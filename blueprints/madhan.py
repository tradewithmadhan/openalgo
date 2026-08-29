from flask import Blueprint, jsonify, request, session
from utils.session import check_session_validity
from utils.logging import get_logger
from datetime import datetime, timedelta, time
from collections import defaultdict
from services.history_service import get_history
from services.madhan.nifty_fetch_service import nifty_fetcher
from services.madhan.atp_signal import (
    compute_atp_from_candles, compute_atp_signal,
    process_historical_atp_data,
)
from services.madhan.volume_signal import compute_spike_flags
from services.madhan.hx_lx import compute_hx_lx_counts
from database.madhan_db import extract_strike, get_nifty_data, get_banknifty_data, get_option_data, get_consistent_current_option_data, get_nifty_data_count, get_banknifty_data_count, get_previous_day_oi, get_nth_candle_oi_for_all_symbols, get_current_day_historical_data, get_current_day_instrument_data, get_current_day_instrument_data_batch, get_instrument_data_for_date, get_previous_trading_day, get_coi_history, get_valid_trading_day, get_tracked_symbols
from database.auth_db import get_api_key_for_tradingview
from blueprints.react_app import serve_react_app


# Initialize logger
logger = get_logger(__name__)

# Create blueprint
madhan_bp = Blueprint('madhan_bp', __name__, url_prefix='/madhan')


def get_instrument_config(instrument='NIFTY'):
    """Returns (config, strike_step, spot_symbol) for the given instrument."""
    if instrument == 'BANKNIFTY':
        return nifty_fetcher.banknifty, 100, 'BANKNIFTY'
    return nifty_fetcher.nifty, 50, 'NIFTY'

@madhan_bp.route('/madhan01')
@check_session_validity
def madhan01_page():
    return serve_react_app()

@madhan_bp.route('/ATP-LTPStrategy')
@check_session_validity
def atp_ltp_strategy_page():
    return serve_react_app()

@madhan_bp.route('/api/atp-ltp-data')
@check_session_validity
def get_atp_ltp_data():
    """Returns ATP-LTP strategy data with time, spot LTP, ATM call ATP, ATM call LTP, ATM put ATP, ATM put LTP."""
    try:
        instrument = request.args.get('instrument', 'NIFTY')
        config, strike_step, spot_symbol = get_instrument_config(instrument)

        logger.info(f"Fetching ATP-LTP data for {instrument}")
        
        # Get current spot data
        if instrument == 'BANKNIFTY':
            spot_data = get_banknifty_data(limit=1)
        else:
            spot_data = get_nifty_data(limit=1)
        if not spot_data:
            return jsonify({
                'status': 'error', 
                'message': f'No {instrument} data available'
            }), 404
            
        latest_spot = spot_data[0]
        current_spot = latest_spot.get('close', 0)
        
        # Get current ATM strike from fetcher
        current_atm_strike = config.current_atm_strike
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
        tracked_symbols = [s for s in get_tracked_symbols() if s.startswith(instrument)]
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
        itm1_call_strike = current_atm_strike - strike_step   # 1 strike below ATM for calls
        itm2_call_strike = current_atm_strike - 2 * strike_step  # 2 strikes below ATM for calls
        itm1_put_strike = current_atm_strike + strike_step   # 1 strike above ATM for puts
        itm2_put_strike = current_atm_strike + 2 * strike_step  # 2 strikes above ATM for puts
        
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
        option_data = get_consistent_current_option_data(instrument=instrument)
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
        symbols_to_fetch = [s for s in [atm_call_symbol, atm_put_symbol, itm_call_symbol1, itm_call_symbol2, itm_put_symbol1, itm_put_symbol2] if s]
        instrument_data = get_current_day_instrument_data_batch(symbols_to_fetch) if symbols_to_fetch else {}

        if atm_call_symbol:
            call_intraday_data = instrument_data.get(atm_call_symbol, [])
            if call_intraday_data:
                atm_call_atp = compute_atp_from_candles(call_intraday_data, atm_call_ltp)
        
        if atm_put_symbol:
            put_intraday_data = instrument_data.get(atm_put_symbol, [])
            if put_intraday_data:
                atm_put_atp = compute_atp_from_candles(put_intraday_data, atm_put_ltp)
        
        # Calculate ATP for ITM options (both strikes)
        itm1_call_atp = compute_atp_from_candles(
            instrument_data.get(itm_call_symbol1, []) if itm_call_symbol1 else [], itm1_call_ltp
        ) if itm_call_symbol1 else 0
        itm2_call_atp = compute_atp_from_candles(
            instrument_data.get(itm_call_symbol2, []) if itm_call_symbol2 else [], itm2_call_ltp
        ) if itm_call_symbol2 else 0
        itm1_put_atp = compute_atp_from_candles(
            instrument_data.get(itm_put_symbol1, []) if itm_put_symbol1 else [], itm1_put_ltp
        ) if itm_put_symbol1 else 0
        itm2_put_atp = compute_atp_from_candles(
            instrument_data.get(itm_put_symbol2, []) if itm_put_symbol2 else [], itm2_put_ltp
        ) if itm_put_symbol2 else 0
        
        # Calculate ATP signals using shared function
        call_atp_signal = compute_atp_signal(atm_call_atp, atm_call_ltp, itm1_call_atp, itm1_call_ltp, itm2_call_atp, itm2_call_ltp)
        put_atp_signal = compute_atp_signal(atm_put_atp, atm_put_ltp, itm1_put_atp, itm1_put_ltp, itm2_put_atp, itm2_put_ltp)
        
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

        # Process historical data using shared signal computation module
        all_historical_data = get_current_day_historical_data(instrument=instrument)
        historical_data = process_historical_atp_data(all_historical_data, current_atm_strike, instrument, strike_step)
        
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
    """Starts the background Nifty/BankNifty data fetching service."""
    username = session.get('user')
    api_key = get_api_key_for_tradingview(username)
    if not api_key:
        return jsonify({'status': 'error', 'message': 'API key not found'}), 401
    
    if nifty_fetcher.is_running:
        return jsonify({'status': 'info', 'message': 'Fetcher is already running.'})

    if nifty_fetcher.status in ("Stopped (Market Closed)", "Stopped (Weekend)"):
        return jsonify({'status': 'info', 'message': f'{nifty_fetcher.status}. Data already available.'})

    nifty_fetcher.start(api_key)
    return jsonify({'status': 'success', 'message': 'Nifty/BankNifty data fetching process started.'})

@madhan_bp.route('/api/nifty/stop', methods=['POST'])
@check_session_validity
def stop_nifty_fetch():
    """Stops the background Nifty/BankNifty data fetching service."""
    nifty_fetcher.stop()
    return jsonify({'status': 'success', 'message': 'Nifty/BankNifty data fetching process stopped.'})

@madhan_bp.route('/api/nifty/status')
@check_session_validity
def nifty_status():
    """Gets the current status of the fetcher."""
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    # Calculate CE and PE counts
    ce_count = sum(1 for s in config.option_symbols if s.endswith('CE'))
    pe_count = sum(1 for s in config.option_symbols if s.endswith('PE'))

    nifty_data_count = get_nifty_data_count()
    banknifty_data_count = get_banknifty_data_count()

    # Use per-instrument config.status for running states (more specific)
    # Fall back to global fetcher status for stop reasons (Weekend/Market Closed)
    if nifty_fetcher.status.startswith("Stopped"):
        status_message = nifty_fetcher.status
    else:
        status_message = config.status if config.status and config.status != "Idle" else nifty_fetcher.status

    return jsonify({
        'status': 'success',
        'is_running': nifty_fetcher.is_running,
        'message': status_message,
        'last_update': config.last_update.isoformat() if config.last_update else None,
        'server_time': datetime.now().isoformat(),
        'nifty_record_count': nifty_data_count,
        'banknifty_record_count': banknifty_data_count,
        'open_atm_strike': config.open_atm_strike,
        'current_atm_strike': config.current_atm_strike,
        'expiry_date': config.expiry_date,
        'ce_count': ce_count,
        'pe_count': pe_count,
        'trading_date': config.trading_date,
    })

@madhan_bp.route('/api/nifty/data')
@check_session_validity
def nifty_data():
    """Gets the latest stored Nifty/BankNifty data."""
    instrument = request.args.get('instrument', 'NIFTY')
    if instrument == 'BANKNIFTY':
        data = get_banknifty_data()
    else:
        data = get_nifty_data()
    return jsonify({'status': 'success', 'data': data})

@madhan_bp.route('/api/nifty/option-data')
@check_session_validity
def nifty_option_data():
    """Gets the latest stored Nifty/BankNifty options data."""
    instrument = request.args.get('instrument', 'NIFTY')
    data = get_option_data(instrument=instrument)
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

@madhan_bp.route('/api/nifty/option-ohlc-batch')
@check_session_validity
def nifty_option_ohlc_batch():
    """Gets OHLC data for multiple option symbols in one DB call."""
    symbols_raw = request.args.get('symbols', '')
    if not symbols_raw:
        return jsonify({'status': 'error', 'message': 'symbols parameter is required (comma-separated)'}), 400

    symbols = [s.strip() for s in symbols_raw.split(',') if s.strip()]
    if not symbols:
        return jsonify({'status': 'error', 'message': 'No valid symbols provided'}), 400

    try:
        batch_data = get_current_day_instrument_data_batch(symbols)

        result = {}
        for symbol in symbols:
            data = batch_data.get(symbol, [])
            if data:
                result[symbol] = {
                    'timestamps': [row['timestamp'] for row in data],
                    'open': [row['open'] for row in data],
                    'high': [row['high'] for row in data],
                    'low': [row['low'] for row in data],
                    'close': [row['close'] for row in data],
                    'volume': [row['volume'] for row in data],
                    'oi': [row['oi'] for row in data]
                }
            else:
                result[symbol] = {
                    'timestamps': [], 'open': [], 'high': [], 'low': [],
                    'close': [], 'volume': [], 'oi': []
                }

        return jsonify({'status': 'success', 'data': result})
    except Exception as e:
        logger.error(f"Error fetching batch option OHLC: {str(e)}")
        return jsonify({'status': 'error', 'message': f'Error fetching batch option OHLC: {str(e)}'}), 500

@madhan_bp.route('/api/nifty/previous-day-oi')
@check_session_validity
def nifty_previous_day_oi():
    """
    Gets the previous day's closing OI data and calculates the change in OI
    by comparing with the current day's latest OI.
    """
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    prev_day_data = get_previous_day_oi(instrument=instrument)
    
    # 1. Get current OI for session change calculation
    current_option_data = get_consistent_current_option_data(instrument=instrument) # Fetches latest OI for all symbols at consistent timestamp
    latest_spot_data = get_banknifty_data(limit=1) if instrument == 'BANKNIFTY' else get_nifty_data(limit=1)
    current_oi_map = {item['symbol']: item.get('oi', 0) for item in current_option_data}
    if latest_spot_data:
        current_oi_map[spot_symbol] = latest_spot_data[0].get('oi', 0)

    # 2. Get OI at 3rd and 6th candle marks
    oi_at_3min_map = get_nth_candle_oi_for_all_symbols(1, instrument=instrument) # 3rd candle (e.g., 9:17 AM)
    oi_at_6min_map = get_nth_candle_oi_for_all_symbols(4, instrument=instrument) # 6th candle (e.g., 9:20 AM)
    
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
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    open_atm = config.open_atm_strike
    if not open_atm or open_atm == 0:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'coi_percent': [], 'oi_trend_percent': []}, 'message': 'ATM strike not calculated yet.'})

    # Get strike selection parameters
    strike_selection_mode = request.args.get('strike_selection_mode', 'option2')
    upside_strikes = int(request.args.get('upside_strikes', '10'))
    downside_strikes = int(request.args.get('downside_strikes', '10'))
    
    # Get the total number of symbols we expect data for on each candle to ensure data integrity
    if strike_selection_mode == 'option2':
        pe_strikes_count = downside_strikes + 1 + 2
        ce_strikes_count = upside_strikes + 1 + 2
        expected_symbol_count = pe_strikes_count + ce_strikes_count + 1  # +1 for spot index

    prev_day_data = get_previous_day_oi(instrument=instrument)
    prev_oi_map = {item['symbol']: item.get('oi', 0) for item in prev_day_data}

    historical_data = get_current_day_historical_data(instrument=instrument)
    if not historical_data:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'coi_percent': [], 'oi_trend_percent': []}, 'message': 'No historical data for today.'})

    # Group data by timestamp
    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row['timestamp']].append(row)

    if strike_selection_mode == 'option1':
        expected_symbol_count = max((len(rows) for rows in data_by_ts.values()), default=0)

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
            
            # Skip spot index symbol
            if symbol == spot_symbol:
                continue
                
            # Apply strike filtering for option2
            if strike_selection_mode == 'option2':
                strike_price = extract_strike(symbol)
                if strike_price is None:
                    continue
                    
                # PE writers view: strikes below ATM + ATM + 2 above ATM
                if symbol.endswith('PE'):
                    if strike_price > open_atm + (2 * strike_step):
                        continue
                        
                # CE writers view: strikes above ATM + ATM + 2 below ATM  
                elif symbol.endswith('CE'):
                    if strike_price < open_atm - (2 * strike_step):
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
    """Gets historical spot data for Nifty/BankNifty."""
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    data = get_current_day_instrument_data(spot_symbol)
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
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    open_atm = config.open_atm_strike
    if not open_atm or open_atm == 0:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'ce_changes': [], 'pe_changes': []}, 'message': 'ATM strike not calculated yet.'})

    # Get strike selection parameters
    strike_selection_mode = request.args.get('strike_selection_mode', 'option1')
    upside_strikes = int(request.args.get('upside_strikes', '10'))
    downside_strikes = int(request.args.get('downside_strikes', '10'))
    
    # Get the total number of symbols we expect data for on each candle to ensure data integrity
    if strike_selection_mode == 'option2':
        # option2: filtering is done per-symbol in the loop (unbounded range), so no strict completeness check
        expected_symbol_count = 0  # disabled — will never skip candles
    else:
        pe_strikes_count = downside_strikes + 1 + 2
        ce_strikes_count = upside_strikes + 1 + 2
        expected_symbol_count = pe_strikes_count + ce_strikes_count + 1  # +1 for spot index

    prev_day_data = get_previous_day_oi(instrument=instrument)
    prev_oi_map = {item['symbol']: item.get('oi', 0) for item in prev_day_data}

    historical_data = get_current_day_historical_data(instrument=instrument)
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
            
            # Skip spot index symbol
            if symbol == spot_symbol:
                continue
                
            # Apply strike filtering for option2
            if strike_selection_mode == 'option2':
                strike_price = extract_strike(symbol)
                if strike_price is None:
                    continue
                    
                # PE writers view: strikes below ATM + ATM + 2 above ATM
                if symbol.endswith('PE'):
                    if strike_price > open_atm + (2 * strike_step):
                        continue
                        
                # CE writers view: strikes above ATM + ATM + 2 below ATM  
                elif symbol.endswith('CE'):
                    if strike_price < open_atm - (2 * strike_step):
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
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    strike_price = request.args.get("strike_price", type=int)

    if not strike_price or strike_price <= 0:
        return jsonify({
            "timestamps": [],
            "ce_changes": [],
            "pe_changes": [],
            "error": "strike_price query parameter is required"
        }), 400

    # ✅ SAME AS nifty_ce_pe_changes
    prev_day_data = get_previous_day_oi(instrument=instrument)
    prev_oi_map = {item["symbol"]: item.get("oi", 0) for item in prev_day_data}

    # ✅ SAME AS nifty_ce_pe_changes (IMPORTANT FIX)
    historical_data = get_current_day_historical_data(instrument=instrument)

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

            if symbol == spot_symbol:
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
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    open_atm = config.open_atm_strike
    if not open_atm or open_atm == 0:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'ce_changes': [], 'pe_changes': []}, 'message': 'ATM strike not calculated yet.'})

    strike_selection_mode = request.args.get('strike_selection_mode', 'option1')  # option1: all strikes, option2: selective
    upside_strikes = int(request.args.get('upside_strikes', '10'))
    downside_strikes = int(request.args.get('downside_strikes', '10'))

    if strike_selection_mode == 'option2':
        expected_symbol_count = 0  # disabled — filtering is per-symbol in loop
    else:
        pe_strikes_count = downside_strikes + 1 + 2
        ce_strikes_count = upside_strikes + 1 + 2
        expected_symbol_count = pe_strikes_count + ce_strikes_count + 1

    historical_data = get_current_day_historical_data(instrument=instrument)
    if not historical_data:
        return jsonify({'status': 'success', 'data': {'timestamps': [], 'ce_changes': [], 'pe_changes': []}, 'message': 'No historical data for today.'})

    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row['timestamp']].append(row)

    sorted_timestamps = sorted(data_by_ts.keys())
    timestamps_res = []
    ce_changes_res = []
    pe_changes_res = []
    spot_highs_res = []
    spot_lows_res = []

    for ts in sorted_timestamps:
        if len(data_by_ts[ts]) < expected_symbol_count:
            logger.debug(f"Skipping incomplete candle at timestamp {ts}: got {len(data_by_ts[ts])} symbols, expected {expected_symbol_count}")
            continue

        total_ce_volume = 0
        total_pe_volume = 0
        spot_high = None
        spot_low = None

        for item in data_by_ts[ts]:
            symbol = item['symbol']
            volume = item.get('volume', 0)

            if symbol == spot_symbol:
                spot_high = item.get('high')
                spot_low = item.get('low')
                continue

            if strike_selection_mode == 'option2':
                strike_price = extract_strike(symbol)
                if strike_price is None:
                    continue

                if symbol.endswith('PE'):
                    if strike_price > open_atm + (2 * strike_step):
                        continue
                elif symbol.endswith('CE'):
                    if strike_price < open_atm - (2 * strike_step):
                        continue

            if volume > 0:
                if symbol.endswith('CE'):
                    total_ce_volume += volume
                elif symbol.endswith('PE'):
                    total_pe_volume += volume

        timestamps_res.append(ts * 1000)
        ce_changes_res.append(total_ce_volume)
        pe_changes_res.append(total_pe_volume)
        spot_highs_res.append(spot_high)
        spot_lows_res.append(spot_low)

    combined = [abs(ce_changes_res[i]) + abs(pe_changes_res[i]) for i in range(len(ce_changes_res))]
    vol_spike = compute_spike_flags(combined, spot_highs=spot_highs_res, spot_lows=spot_lows_res)

    return jsonify({'status': 'success', 'data': {'timestamps': timestamps_res, 'ce_changes': ce_changes_res, 'pe_changes': pe_changes_res, 'vol_spike': vol_spike}})


@madhan_bp.route('/api/nifty/ce-pe-strike-volume-changes')
@check_session_validity
def nifty_ce_pe_strike_volume_changes():
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    strike_price = request.args.get("strike_price", type=int)

    if not strike_price or strike_price <= 0:
        return jsonify({
            "timestamps": [],
            "ce_changes": [],
            "pe_changes": [],
            "error": "strike_price query parameter is required"
        }), 400

    historical_data = get_current_day_historical_data(instrument=instrument)
    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row["timestamp"]].append(row)

    timestamps_res = []
    ce_changes_res = []
    pe_changes_res = []
    spot_highs_res = []
    spot_lows_res = []

    for ts in sorted(data_by_ts.keys()):
        rows = data_by_ts[ts]

        total_ce_volume = 0
        total_pe_volume = 0
        found_ce = False
        found_pe = False
        spot_high = None
        spot_low = None

        for row in rows:
            symbol = row["symbol"]
            current_volume = row.get("volume", 0)

            if symbol == spot_symbol:
                spot_high = row.get("high")
                spot_low = row.get("low")
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
        spot_highs_res.append(spot_high)
        spot_lows_res.append(spot_low)

    combined = [abs(ce_changes_res[i]) + abs(pe_changes_res[i]) for i in range(len(ce_changes_res))]
    vol_spike = compute_spike_flags(combined, spot_highs=spot_highs_res, spot_lows=spot_lows_res)

    return jsonify({
        "timestamps": timestamps_res,
        "ce_changes": ce_changes_res,
        "pe_changes": pe_changes_res,
        "vol_spike": vol_spike
    })


@madhan_bp.route('/spot_chart_data')
@check_session_validity
def spot_chart_data():
    """Provides Nifty/BankNifty price data for the lightweight chart."""
    try:
        instrument = request.args.get('instrument', 'NIFTY')
        if instrument == 'BANKNIFTY':
            data = get_banknifty_data()
        else:
            data = get_nifty_data()
        return jsonify(data), 200
    except Exception as e:
        logger.error(f"Error fetching spot chart data: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': 'Internal server error fetching chart data'}), 500



@madhan_bp.route('/nifty_live_data')
@check_session_validity
def nifty_live_data_api():
    """Provides NIFTY/BANKNIFTY OHLC data for the lightweight chart."""
    username = session.get('user')
    logger.info(f"starting live fetch for user: {username}")
    if not username:
        return jsonify({'status': 'error', 'message': 'User not logged in'}), 401

    api_key = get_api_key_for_tradingview(username)
    logger.info(f"starting live fetch for user apikey: {api_key}")
    if not api_key:
        return jsonify({'status': 'error', 'message': 'API key not found for user'}), 401
    try:
        instrument = request.args.get('instrument', 'NIFTY')
        interval = request.args.get('interval', '1m')
        days_back = int(request.args.get('days_back', 1))

        nifty_fetcher.api_key = api_key

        success, result, status_code = nifty_fetcher.get_instrument_live_data(
            instrument=instrument,
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
    instrument = request.args.get('instrument', 'NIFTY')
    # Previous day's OI
    prev_day_data = get_previous_day_oi(instrument=instrument)  # Returns list of {symbol, oi}

    # Current day's latest OI
    current_data = get_consistent_current_option_data(instrument=instrument)  # Returns list of {symbol, oi} at consistent timestamp

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


@madhan_bp.route('/api/nifty/oi-strike-history')
@check_session_validity
def oi_strike_history():
    """Returns per-strike CE/PE OI time series for all tracked option symbols (1-min candles)."""
    try:
        instrument = request.args.get('instrument', 'NIFTY')
        config, strike_step, spot_symbol = get_instrument_config(instrument)

        all_data = get_current_day_historical_data(instrument=instrument)
        if not all_data:
            return jsonify({"status": "success", "timestamps": [], "strikes": {}})

        # Filter to option symbols only (exclude spot index)
        option_rows = [r for r in all_data if r.get('symbol') and r['symbol'] != spot_symbol]

        if not option_rows:
            return jsonify({"status": "success", "timestamps": [], "strikes": {}})

        # Group OI by timestamp → strike → ce/pe
        ts_set = set()
        strike_data = defaultdict(lambda: {"ce_oi": {}, "pe_oi": {}})

        for row in option_rows:
            symbol = row['symbol']
            ts = row['timestamp']
            oi = row.get('oi', 0) or 0
            strike = extract_strike(symbol)
            if strike is None:
                continue
            ts_set.add(ts)
            if symbol.endswith('CE'):
                strike_data[strike]["ce_oi"][ts] = oi
            elif symbol.endswith('PE'):
                strike_data[strike]["pe_oi"][ts] = oi

        sorted_ts = sorted(ts_set)

        # Build aligned arrays per strike
        strikes_result = {}
        for strike in sorted(strike_data.keys()):
            sd = strike_data[strike]
            ce_arr = [sd["ce_oi"].get(ts) for ts in sorted_ts]
            pe_arr = [sd["pe_oi"].get(ts) for ts in sorted_ts]
            strikes_result[str(strike)] = {"ce_oi": ce_arr, "pe_oi": pe_arr}

        return jsonify({
            "status": "success",
            "timestamps": sorted_ts,
            "strikes": strikes_result,
        })
    except Exception as e:
        logger.error(f"Error fetching OI strike history: {e}", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@madhan_bp.route('/api/nifty/coi_history')
@check_session_validity
def coi_history():
    """Returns daily COI (Change in OI) history for all tracked option symbols."""
    instrument = request.args.get('instrument', 'NIFTY')
    days = request.args.get('days', 30, type=int)
    days = min(max(days, 1), 90)  # clamp 1-90

    data = get_coi_history(days, instrument=instrument)

    # Convert to list format for easier frontend consumption
    result = []
    for date_str in sorted(data.keys()):
        result.append({
            'date': date_str,
            'strikes': data[date_str],
        })

    return jsonify({"status": "success", "data": result})


import re

def build_oi_and_coi_data(prev_day_data, current_oi_map, change_oi_map):
    strikes_map = {}

    # Seed from current data so strikes appear even when prev_day_data is empty
    for symbol, current_oi in current_oi_map.items():
        strike_price = extract_strike(symbol)
        if strike_price is None:
            continue
        if strike_price not in strikes_map:
            strikes_map[strike_price] = {"ceOI": 0, "peOI": 0, "ceCOI": 0, "peCOI": 0}
        if symbol.endswith("CE"):
            strikes_map[strike_price]["ceOI"] = current_oi
        elif symbol.endswith("PE"):
            strikes_map[strike_price]["peOI"] = current_oi

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

        instrument = request.args.get('instrument', 'NIFTY')
        config, strike_step, spot_symbol = get_instrument_config(instrument)
        
        strike_price = request.args.get('strike')
        if not strike_price:
            return jsonify({'status': 'error', 'message': 'Strike price is required'}), 400
        
        try:
            strike_price = int(strike_price)
        except ValueError:
            return jsonify({'status': 'error', 'message': 'Invalid strike price format'}), 400
        
        include_previous = request.args.get('include_previous_day', 'false').lower() == 'true'
        
        # Get tracked symbols to find CE and PE for the given strike
        tracked_symbols = [s for s in get_tracked_symbols() if s.startswith(instrument)]
        
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
        symbols_to_fetch = [s for s in [ce_symbol, pe_symbol, spot_symbol] if s]
        batch_data = get_current_day_instrument_data_batch(symbols_to_fetch) if symbols_to_fetch else {}
        
        ce_data = batch_data.get(ce_symbol, []) if ce_symbol else []
        pe_data = batch_data.get(pe_symbol, []) if pe_symbol else []
        spot_data = batch_data.get(spot_symbol, []) if spot_symbol else []
        
        # Get previous day's data if requested
        prev_ce_data = []
        prev_pe_data = []
        prev_spot_data = []
        prev_spot_lookup = {}
        
        if include_previous:
            try:
                prev_date = get_previous_trading_day()
                if ce_symbol:
                    prev_ce_data = get_instrument_data_for_date(ce_symbol, prev_date)
                if pe_symbol:
                    prev_pe_data = get_instrument_data_for_date(pe_symbol, prev_date)
                prev_spot_data = get_instrument_data_for_date(spot_symbol, prev_date)
                prev_spot_lookup = {item['timestamp']: item['close'] for item in prev_spot_data}
            except Exception as e:
                logger.warning(f"Could not fetch previous day data: {e}")
                include_previous = False
        
        # Create a spot price lookup by timestamp (merge current + previous)
        spot_lookup = {item['timestamp']: item['close'] for item in spot_data}
        spot_lookup.update(prev_spot_lookup)
        
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
        
        # Process CE and PE data for current day
        formatted_ce_data = format_chart_data_enhanced(ce_data, 'CE') if ce_data else []
        formatted_pe_data = format_chart_data_enhanced(pe_data, 'PE') if pe_data else []
        
        # Process previous day data if requested
        if include_previous and (prev_ce_data or prev_pe_data):
            formatted_prev_ce = format_chart_data_enhanced(prev_ce_data, 'CE') if prev_ce_data else []
            formatted_prev_pe = format_chart_data_enhanced(prev_pe_data, 'PE') if prev_pe_data else []
            
            # Prepend previous day data to current day data
            formatted_ce_data = formatted_prev_ce + formatted_ce_data
            formatted_pe_data = formatted_prev_pe + formatted_pe_data
        
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

        instrument = request.args.get('instrument', 'NIFTY')
        config, strike_step, spot_symbol = get_instrument_config(instrument)

        tracked_symbols = [s for s in get_tracked_symbols() if s.startswith(instrument)]
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

        all_option_symbols = [s for symbols in strikes_map.values() for s in [symbols['ce'], symbols['pe']] if s]
        batch_data = get_current_day_instrument_data_batch([spot_symbol] + all_option_symbols)

        spot_data = batch_data.get(spot_symbol, [])
        spot_lookup = {item['timestamp']: item['close'] for item in spot_data}

        all_signals = []
        last_data_time = 0
        first_candle_per_strike = {}

        for strike_price, symbols in sorted(strikes_map.items()):
            ce_symbol = symbols['ce']
            pe_symbol = symbols['pe']
            if not ce_symbol or not pe_symbol:
                continue

            ce_data = batch_data.get(ce_symbol, [])
            pe_data = batch_data.get(pe_symbol, [])
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

        # ── Compute hx_lx_vol for the response ──────────────────────────
        hx_lx_vol_map = {}
        try:
            atm_strike = config.open_atm_strike or config.current_atm_strike
            expiry_date = config.expiry_date
            if atm_strike and expiry_date:
                hx_lx_strikes = [atm_strike + (i * strike_step) for i in range(-10, 11)]

                def _get_symbol(strike, type_):
                    try:
                        date_obj = datetime.strptime(expiry_date, "%d-%b-%y")
                        day = date_obj.strftime("%d")
                        month = date_obj.strftime("%b").upper()
                        year = date_obj.strftime("%y")
                        return f"{instrument}{day}{month}{year}{strike}{type_}"
                    except Exception:
                        return None

                historical_data = get_current_day_historical_data(instrument=instrument)
                if historical_data:
                    hx_results = compute_hx_lx_counts(
                        all_historical_data=historical_data,
                        strikes=hx_lx_strikes,
                        get_symbol=_get_symbol,
                    )
                    for row in hx_results:
                        ts = row['timestamp']
                        hx_lx_vol_map[ts] = {
                            'ce_vol': row.get('ce_changes', 0),
                            'pe_vol': row.get('pe_changes', 0),
                            'ce_hx': row.get('ce_hx', 0),
                            'pe_hx': row.get('pe_hx', 0),
                            'ce_lx': row.get('ce_lx', 0),
                            'pe_lx': row.get('pe_lx', 0),
                        }
        except Exception as e:
            logger.warning(f'Error computing hx_lx_vol for ezayChart: {e}')

        # ── Merge signals + hx_lx_vol into time-keyed array ─────────────
        signals_by_time = defaultdict(list)
        for row in all_signals:
            signals_by_time[row['time']].append({
                'strike': row['strike'],
                'ce_signal': row['ce_signal'],
                'pe_signal': row['pe_signal'],
                'cp_signal': row['cp_signal'],
                'cp_ce_signal': row['cp_ce_signal'],
                'th_signal': row['th_signal'],
                'th_dir': row['th_dir'],
                'ce_close': row['ce_close'],
                'pe_close': row['pe_close'],
            })

        all_times = sorted(set(list(signals_by_time.keys()) + list(hx_lx_vol_map.keys())))
        merged_data = []
        for ts in all_times:
            entry = {'time': ts, 'ezay_signals': signals_by_time.get(ts, [])}
            if ts in hx_lx_vol_map:
                entry['hx_lx_vol'] = hx_lx_vol_map[ts]
            merged_data.append(entry)

        return jsonify({'status': 'success', 'last_time': last_data_time, 'data': merged_data, 'signals': signals})

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
        instrument = request.args.get('instrument', 'NIFTY')
        date_str = request.args.get('date')
        if not date_str:
            return jsonify({'status': 'error', 'message': 'date parameter required (YYYY-MM-DD)'}), 400
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return jsonify({'status': 'error', 'message': 'Invalid date format. Use YYYY-MM-DD'}), 400

        result = get_backtest_strikes(date_str, instrument=instrument)
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
        instrument = request.args.get('instrument', 'NIFTY')
        date_str = request.args.get('date')
        strike_str = request.args.get('strike')
        if not date_str or not strike_str:
            return jsonify({'status': 'error', 'message': 'date and strike parameters required'}), 400
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
            strike_price = int(strike_str)
        except (ValueError, TypeError):
            return jsonify({'status': 'error', 'message': 'Invalid date or strike format'}), 400

        result = get_backtest_chart_data(date_str, strike_price, instrument=instrument)
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
        instrument = request.args.get('instrument', 'NIFTY')
        date_str = request.args.get('date')
        if not date_str:
            return jsonify({'status': 'error', 'message': 'date parameter required (YYYY-MM-DD)'}), 400
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return jsonify({'status': 'error', 'message': 'Invalid date format. Use YYYY-MM-DD'}), 400

        result = get_backtest_signals(date_str, instrument=instrument)
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
        instrument = request.args.get('instrument', 'NIFTY')
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

        result = get_backtest_range(from_date, to_date, instrument=instrument)
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
        instrument = request.args.get('instrument', 'NIFTY')
        tracked_symbols = get_tracked_symbols()
        strikes_data = {}
        symbols_map = {}
        
        for symbol in tracked_symbols:
            if not symbol.startswith(instrument):
                continue
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
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    mode = request.args.get('mode', 'writer_open') # Default to writer_open
    end_ts = request.args.get('end_ts')
    if end_ts:
        try:
            end_ts = int(end_ts)
        except ValueError:
            end_ts = None
    
    # 1. Get option data (latest or at specific time) and previous day OI
    current_option_data = get_consistent_current_option_data(end_ts=end_ts, instrument=instrument)
    prev_day_data = get_previous_day_oi(instrument=instrument)
    prev_oi_map = {item['symbol']: item.get('oi', 0) for item in prev_day_data}
    
    open_atm = config.open_atm_strike
    
    # In replay mode, current_atm should be based on the data at end_ts
    if end_ts:
        latest_spot_data = get_banknifty_data(limit=1, end_ts=end_ts) if instrument == 'BANKNIFTY' else get_nifty_data(limit=1, end_ts=end_ts)
        if latest_spot_data:
            spot_price = latest_spot_data[0]['close']
            current_atm = round(spot_price / strike_step) * strike_step
        else:
            current_atm = config.current_atm_strike or open_atm
    else:
        current_atm = config.current_atm_strike or open_atm
    
    def is_included(sym, strike):
        if mode == 'total': return True
        base_atm = open_atm if mode == 'writer_open' else current_atm
        if not base_atm: return True
        
        # Symmetric ATM +/- 5 strikes (total 11 strikes) for Writer Views
        # Strike interval varies by instrument, so 5 strikes = 5 * strike_step points
        if strike > base_atm + 5 * strike_step or strike < base_atm - 5 * strike_step:
            return False
            
        # One-sided filtering to focus on "Writing Zone" (OTM + ATM + 2 ITM)
        if sym.endswith('PE') and strike > base_atm + 2 * strike_step: return False
        if sym.endswith('CE') and strike < base_atm - 2 * strike_step: return False
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
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    mode = request.args.get('mode', 'writer_open')
    end_ts = request.args.get('end_ts')
    interval_mins = int(request.args.get('interval', 3)) # Default to 3 minutes
    
    if end_ts:
        try:
            end_ts = int(end_ts)
        except ValueError:
            end_ts = None
    
    # 1. Get all tracked symbols
    tracked_symbols = config.option_symbols
    if not tracked_symbols:
        return jsonify({'status': 'success', 'data': []})

    # 2. Get 1-min data for all symbols (includes spot index)
    historical_data = get_current_day_historical_data(instrument=instrument, end_ts=end_ts)
    if not historical_data:
        return jsonify({'status': 'success', 'data': []})

    # Group by timestamp
    data_by_ts = defaultdict(list)
    spot_by_ts = {}
    for row in historical_data:
        if row['symbol'] == spot_symbol:
            spot_by_ts[row['timestamp']] = row['close']
        else:
            data_by_ts[row['timestamp']].append(row)

    sorted_ts = sorted(spot_by_ts.keys())
    if not sorted_ts:
        # Fallback if spot not found in historical, use option timestamps
        sorted_ts = sorted(data_by_ts.keys())
        if not sorted_ts:
            return jsonify({'status': 'success', 'data': []})

    open_atm = config.open_atm_strike
    
    # Calculate current ATM based on latest spot in the window
    latest_spot = spot_by_ts.get(sorted_ts[-1], 0)
    if end_ts and latest_spot == 0:
        latest_spot_data = get_banknifty_data(limit=1, end_ts=end_ts) if instrument == 'BANKNIFTY' else get_nifty_data(limit=1, end_ts=end_ts)
        latest_spot = latest_spot_data[0]['close'] if latest_spot_data else 0
    
    current_atm = round(latest_spot / strike_step) * strike_step if latest_spot > 0 else (config.current_atm_strike or open_atm)
    
    def is_included(sym, strike, bucket_atm):
        if mode == 'total': return True
        base_atm = open_atm if mode == 'writer_open' else bucket_atm
        if not base_atm: return True
        # Symmetric ATM +/- 5 strikes (total 11 strikes)
        if strike > base_atm + 5 * strike_step or strike < base_atm - 5 * strike_step: return False
        # One-sided writing zone filtering
        if sym.endswith('PE') and strike > base_atm + 2 * strike_step: return False
        if sym.endswith('CE') and strike < base_atm - 2 * strike_step: return False
        return True

    # 4. Aggregate into custom-minute buckets
    bucket_data = []
    period_secs = interval_mins * 60
    
    # Debug: log symbol count distribution
    ts_counts = {ts: len(rows) for ts, rows in data_by_ts.items()}
    all_counts = list(ts_counts.values())
    expected_option_count = max(all_counts) if all_counts else 0
    if all_counts:
        max_sym = max(all_counts)
        min_sym = min(all_counts)
        full_candles = sum(1 for c in all_counts if c >= expected_option_count)
        logger.info(f"[dash-time-analysis] tracked={len(tracked_symbols)} actual_max={expected_option_count} timestamps={len(all_counts)} min_syms={min_sym} max_syms={max_sym} full_candles={full_candles}")
    else:
        logger.warning(f"[dash-time-analysis] No option data found. historical_data rows={len(historical_data)}")

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
        
        # Skip incomplete candles (require all symbols that actually have data)
        if ts in data_by_ts and len(data_by_ts[ts]) < expected_option_count:
            continue
        
        spot = spot_by_ts.get(ts, 0)
        if spot > 0:
            day_high_spot = max(day_high_spot, spot)
            day_low_spot = min(day_low_spot, spot)
        
        bucket_idx = (ts - market_start_ts) // period_secs
        bucket_start = market_start_ts + (bucket_idx * period_secs)
        
        if current_bucket and bucket_start != bucket_start_time:
            # Finalize the previous bucket's OI based on its OWN ATM
            bucket_atm = round(current_bucket['ltp'] / strike_step) * strike_step if current_bucket['ltp'] > 0 else current_atm
            
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
        bucket_atm = round(current_bucket['ltp'] / strike_step) * strike_step if current_bucket['ltp'] > 0 else current_atm
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


@madhan_bp.route('/api/nifty/hx_lx_vol')
@check_session_validity
def nifty_hx_lx_vol():
    """Compute HighCross/LowCross change counts and volumes per timestamp.

    Returns a list of dicts with timestamp, ce_hx, pe_hx, ce_lx, pe_lx,
    ce_changes (total CE volume), pe_changes (total PE volume)
    showing how many strikes had a running-high or running-low change
    and total volumes at each timestamp.
    """

    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    # 1. Get ATM and Expiry from fetcher
    atm_strike = config.open_atm_strike or config.current_atm_strike
    expiry_date = config.expiry_date

    if not atm_strike or not expiry_date:
        return jsonify({'status': 'success', 'data': [], 'message': 'ATM or Expiry not available.'})

    # 2. Generate 21 strikes around ATM (±10)
    strikes = [atm_strike + (i * strike_step) for i in range(-10, 11)]

    # 3. Symbol helper (same pattern as signals-cross)
    def get_symbol_python(strike, type_):
        try:
            date_obj = datetime.strptime(expiry_date, "%d-%b-%y")
            day = date_obj.strftime("%d")
            month = date_obj.strftime("%b").upper()
            year = date_obj.strftime("%y")
            return f"{instrument}{day}{month}{year}{strike}{type_}"
        except Exception:
            return None

    # 4. Fetch historical data (1-minute candles)
    historical_data = get_current_day_historical_data(instrument=instrument)
    if not historical_data:
        return jsonify({'status': 'success', 'data': []})

    # 5. Compute
    try:
        results = compute_hx_lx_counts(
            all_historical_data=historical_data,
            strikes=strikes,
            get_symbol=get_symbol_python,
        )
        return jsonify({'status': 'success', 'data': results})
    except Exception as e:
        logger.error(f"Error computing hx_lx_vol: {e}", exc_info=True)
        return jsonify({'status': 'error', 'message': str(e)}) 


@madhan_bp.route('/api/nifty/support-resistance')
@check_session_validity
def nifty_support_resistance():
    """Calculates support and resistance strikes based on OI and COI for each timestamp."""
    instrument = request.args.get('instrument', 'NIFTY')
    config, strike_step, spot_symbol = get_instrument_config(instrument)

    open_atm = config.open_atm_strike
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

    # Get previous day OI data for COI calculation
    prev_day_data = get_previous_day_oi(instrument=instrument)
    prev_oi_map = {item['symbol']: item.get('oi', 0) for item in prev_day_data}

    # Get current day historical data
    historical_data = get_current_day_historical_data(instrument=instrument)
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

    max_syms_per_ts = max(len(rows) for rows in data_by_ts.values()) if data_by_ts else 0
    expected_symbol_count = max_syms_per_ts
    logger.info(f"[support-resistance] expected={expected_symbol_count} timestamps={len(data_by_ts)}")

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
            
            # Skip spot index symbol
            if symbol == spot_symbol:
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


@madhan_bp.route('/api/fut-stocks')
@check_session_validity
def api_fut_stocks():
    """Return FUT stocks with strike interval, computed from the in-memory symbol cache.

    Uses just 3 bulk cache queries instead of 200+ per-underlying queries:
    1. All NFO FUT symbols
    2. All NFO CE symbols (for strike interval)
    3. All NFO PE symbols (for strike interval)
    """
    import pytz
    from collections import Counter, defaultdict
    from datetime import date as date_type
    from database.token_db_enhanced import fno_search_symbols, extract_underlying_from_symbol

    def _parse_expiry(exp_str):
        if not exp_str:
            return None
        for fmt in ('%d-%b-%y', '%d-%b-%Y'):
            try:
                return datetime.strptime(exp_str, fmt).date()
            except ValueError:
                continue
        return None

    # 1. Bulk fetch: ALL FUT + ALL CE + ALL PE on NFO
    #    High limit needed — NFO has ~20k+ CE and ~20k+ PE symbols
    fut_symbols = fno_search_symbols(exchange='NFO', instrumenttype='FUT', limit=50000)
    ce_symbols = fno_search_symbols(exchange='NFO', instrumenttype='CE', limit=50000)
    pe_symbols = fno_search_symbols(exchange='NFO', instrumenttype='PE', limit=50000)

    # 2. Group FUTs by underlying — extract from symbol name if not in dict
    by_underlying = defaultdict(list)
    for s in fut_symbols:
        u = s.get('underlying') or extract_underlying_from_symbol(s.get('symbol', ''), 'NFO')
        if u:
            by_underlying[u].append(s)

    # 3. Pre-group option strikes by (underlying, expiry) — CE + PE combined
    #    Extract underlying from symbol if not in dict
    opt_by_und_exp: dict[tuple[str, str], list[float]] = defaultdict(list)
    for s in ce_symbols + pe_symbols:
        u = s.get('underlying') or extract_underlying_from_symbol(s.get('symbol', ''), 'NFO')
        exp = s.get('expiry')
        strike = s.get('strike', 0)
        if u and exp and strike and strike > 0:
            opt_by_und_exp[(u, exp)].append(strike)

    # Sort strike lists once; pre-compute per-expiry mode intervals
    opt_strikes_sorted: dict[tuple[str, str], list[float]] = {}
    per_expiry_interval: dict[tuple[str, str], tuple[float, int]] = {}  # (u, exp) -> (mode, count)
    for key, strikes in opt_by_und_exp.items():
        sorted_strikes = sorted(set(strikes))
        opt_strikes_sorted[key] = sorted_strikes
        if len(sorted_strikes) >= 2:
            diffs = [round(sorted_strikes[i + 1] - sorted_strikes[i], 2) for i in range(len(sorted_strikes) - 1)]
            diff_counts = Counter(diffs)
            mode_val, mode_cnt = diff_counts.most_common(1)[0]
            per_expiry_interval[key] = (mode_val, mode_cnt)

    # 4. Per underlying: nearest expiry FUT + strike interval from options
    #    Strike interval is the mode across ALL expiries (weighted by diff count)
    #    to avoid weekly expiries with non-standard strikes (e.g. 103.8, 111.8)
    results = []
    for underlying, futs in sorted(by_underlying.items()):
        # Aggregate weighted intervals across all expiries for this underlying
        weighted_intervals: dict[float, float] = defaultdict(float)
        for (u, exp), (mode_val, mode_cnt) in per_expiry_interval.items():
            if u == underlying:
                weighted_intervals[mode_val] += mode_cnt

        strike_interval = max(weighted_intervals, key=weighted_intervals.get) if weighted_intervals else 0

        # Sort by expiry date ascending, pick nearest
        futs_dated = [(_f, _parse_expiry(_f.get('expiry'))) for _f in futs]
        futs_dated.sort(key=lambda x: (x[1] is None, x[1] or date_type.max))
        nearest_fut = futs_dated[0][0]
        nearest_expiry = nearest_fut.get('expiry')

        results.append({
            'underlying': underlying,
            'symbol': nearest_fut.get('symbol', ''),
            'brsymbol': nearest_fut.get('brsymbol', ''),
            'expiry': nearest_expiry,
            'lotsize': nearest_fut.get('lotsize', 0),
            'tick_size': nearest_fut.get('tick_size', 0),
            'strike_interval': round(strike_interval, 2),
        })

    logger.info(f"api_fut_stocks: returning {len(results)} FUT underlyings")
    return jsonify({'status': 'success', 'data': results})
