"""
Blueprint for MadhaN's custom pages.
"""

import re
from flask import Blueprint, render_template, jsonify, request, session
from utils.session import check_session_validity
from utils.logging import get_logger
from datetime import datetime, timedelta, time
from collections import defaultdict
from services.history_service import get_history
from services.madhan.nifty_fetch_service import nifty_fetcher
from database.madhan_db import get_nifty_data, get_option_data, get_nifty_data_count, get_previous_day_oi, get_nth_candle_oi_for_all_symbols, get_current_day_historical_data, get_current_day_instrument_data, SessionLocal, NiftyData, get_tracked_symbols
from database.auth_db import get_api_key_for_tradingview


# Initialize logger
logger = get_logger(__name__)

# Create blueprint
madhan_bp = Blueprint('madhan_bp', __name__, url_prefix='/madhan')

@madhan_bp.route('/madhan01')
@check_session_validity
def madhan01_page():
    """Render the new MadhaN01 page"""
    return render_template('madhan/madhan01.html')

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

@madhan_bp.route('/api/nifty/previous-day-oi')
@check_session_validity
def nifty_previous_day_oi():
    """
    Gets the previous day's closing OI data and calculates the change in OI
    by comparing with the current day's latest OI.
    """
    prev_day_data = get_previous_day_oi()
    
    # 1. Get current OI for session change calculation
    current_option_data = get_option_data() # Fetches latest OI for options
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
        coi_percent_res.append(coi_percent)
        oi_trend_percent_res.append(oi_trend_percent)

    return jsonify({'status': 'success', 'data': {'timestamps': timestamps_res, 'coi_percent': coi_percent_res, 'oi_trend_percent': oi_trend_percent_res}})

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




    strike_price = request.args.get("strike_price", type=int)

    # -------------------- Validation --------------------
    if not strike_price or strike_price <= 0:
        return jsonify({
            "timestamps": [],
            "ce_changes": [],
            "pe_changes": [],
            "error": "strike_price query parameter is required"
        }), 400

    # -------------------- Previous day OI (baseline) --------------------
    prev_day_data = nifty_fetcher.get_previous_day_oi()
    prev_oi_map = {row["symbol"]: row["oi"] for row in prev_day_data}

    # -------------------- Current day historical OI --------------------
    historical_data = nifty_fetcher.get_current_day_historical_data()

    # -------------------- Group by timestamp --------------------
    data_by_ts = defaultdict(list)
    for row in historical_data:
        data_by_ts[row["timestamp"]].append(row)

    # -------------------- Results --------------------
    timestamps_res = []
    ce_changes_res = []
    pe_changes_res = []

    # -------------------- Candle-to-candle baseline --------------------
    prev_candle_oi_map = prev_oi_map.copy()

    # -------------------- Iterate candles --------------------
    for ts in sorted(data_by_ts.keys()):

        rows = data_by_ts[ts]

        total_ce_change = 0
        total_pe_change = 0
        current_candle_oi_map = {}

        found_ce = False
        found_pe = False

        for row in rows:
            symbol = row["symbol"]
            current_oi = row["oi"]

            # Save snapshot for next candle
            current_candle_oi_map[symbol] = current_oi

            if symbol == "NIFTY":
                continue

            strike = extract_strike(symbol)
            if strike != strike_price:
                continue

            prev_oi = prev_candle_oi_map.get(symbol, 0)
            change_in_oi = current_oi - prev_oi

            if symbol.endswith("CE"):
                total_ce_change += change_in_oi
                found_ce = True
            elif symbol.endswith("PE"):
                total_pe_change += change_in_oi
                found_pe = True

        # Skip incomplete strike candles
        if not (found_ce and found_pe):
            continue

        timestamps_res.append(ts * 1000)  # JS expects ms
        ce_changes_res.append(total_ce_change)
        pe_changes_res.append(total_pe_change)

        # Update baseline
        prev_candle_oi_map = current_candle_oi_map.copy()

    return jsonify({
        "timestamps": timestamps_res,
        "ce_changes": ce_changes_res,
        "pe_changes": pe_changes_res
    })



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

        if not (found_ce and found_pe):
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
    current_data = get_option_data()  # Returns list of {symbol, oi}

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
                    'spot_close': round(spot_close, 2),
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
            
            combined_premium_values = []
            sorted_timestamps = sorted(common_timestamps)
            
            for i, timestamp in enumerate(sorted_timestamps):
                ce_item = ce_dict[timestamp]
                pe_item = pe_dict[timestamp]
                
                # Calculate combined metrics
                open_combined_premium = ce_item['open'] + pe_item['open']
                combined_premium = ce_item['close'] + pe_item['close']
                combined_extrinsic = ce_item['extrinsic'] + pe_item['extrinsic']
                
                combined_premium_values.append(combined_premium)
                
                # Signal detection for Combined_Extrinsic pattern
                # Combined Extrinsic Signal: 
                # CE: (previous ce low < previous Combined_Extrinsic AND current ce close > current Combined_Extrinsic) 
                #     OR (current ce low < current Combined_Extrinsic AND current ce close > current Combined_Extrinsic)
                # PE: (previous pe low < previous Combined_Extrinsic AND current pe close > current Combined_Extrinsic) 
                #     OR (current pe low < current Combined_Extrinsic AND current pe close > current Combined_Extrinsic)
                combined_extrinsic_signal = False
                if i > 0:  # Need previous candle
                    prev_timestamp = sorted_timestamps[i-1]
                    prev_ce_item = ce_dict[prev_timestamp]
                    prev_pe_item = pe_dict[prev_timestamp]
                    
                    # Calculate previous combined extrinsic
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
                
                # CP_CE Signal detection: Combined Premium ≈ Combined Extrinsic (within 5%)
                cp_ce_signal = False
                if combined_extrinsic > 0:  # Avoid division by zero
                    tolerance = combined_extrinsic * 0.015  # 1.5% tolerance
                    if abs(combined_premium - combined_extrinsic) <= tolerance:
                        cp_ce_signal = True
                
                combined_item = {
                    'time': timestamp,
                    'open_combined_premium': round(open_combined_premium, 2),
                    'combined_premium': round(combined_premium, 2),
                    'combined_extrinsic': round(combined_extrinsic, 2),
                    'ce_intrinsic': round(ce_item['intrinsic'], 2),
                    'pe_intrinsic': round(pe_item['intrinsic'], 2),
                    'ce_extrinsic': round(ce_item['extrinsic'], 2),
                    'pe_extrinsic': round(pe_item['extrinsic'], 2),
                    'spot_close': round(ce_item['spot_close'], 2),
                    'combined_extrinsic_signal': combined_extrinsic_signal,
                    'ce_extrinsic_signal': ce_item.get('extrinsic_signal', False),
                    'pe_extrinsic_signal': pe_item.get('extrinsic_signal', False),
                    'cp_ce_signal': cp_ce_signal
                }
                
                combined_data.append(combined_item)
        
        # Calculate LLP (Lowest Low of combined_premium)
        llp = round(min(combined_premium_values), 2) if combined_premium_values else 0
        
        # Add LLP to each combined data point
        for item in combined_data:
            item['llp'] = llp
        
        return jsonify({
            'status': 'success',
            'data': {
                'strike': strike_price,
                'ce_symbol': ce_symbol,
                'pe_symbol': pe_symbol,
                'ce_data': formatted_ce_data,
                'pe_data': formatted_pe_data,
                'combined_data': combined_data,
                'llp': llp,
                'timezone': 'Asia/Kolkata'
            }
        })
        
    except Exception as e:
        logger.error(f"Error fetching ezayChart data: {str(e)}")
        return jsonify({'status': 'error', 'message': f'Error fetching chart data: {str(e)}'}), 500

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

@madhan_bp.route('/api/nifty/spot-data')
@check_session_validity
def nifty_spot_data():
    """Gets current day's Nifty spot data for line chart overlay."""
    try:
        # Get current day's historical data for NIFTY spot
        historical_data = get_current_day_historical_data()
        if not historical_data:
            return jsonify({'status': 'success', 'data': {'timestamps': [], 'prices': []}, 'message': 'No spot data for today.'})

        # Filter only NIFTY spot data and sort by timestamp
        nifty_data = [row for row in historical_data if row['symbol'] == 'NIFTY']
        nifty_data.sort(key=lambda x: x['timestamp'])

        timestamps = []
        prices = []
        
        for item in nifty_data:
            # Convert timestamp to milliseconds for Chart.js
            timestamps.append(item['timestamp'] * 1000)
            prices.append(item['close'])  # Use close price for the line chart

        return jsonify({
            'status': 'success', 
            'data': {
                'timestamps': timestamps,
                'prices': prices
            }
        })
    except Exception as e:
        logger.error(f"Error fetching spot data: {str(e)}")
        return jsonify({'status': 'error', 'message': f'Error fetching spot data: {str(e)}'})


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