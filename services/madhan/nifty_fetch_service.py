"""
A background service to fetch and store Nifty 1-minute data.
"""
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from sqlalchemy import func, select
import pandas as pd
from datetime import datetime, timedelta
import pytz
from utils.logging import get_logger
from services.history_service import get_history
from services.expiry_service import get_expiry_dates
from database.madhan_db import store_nifty_data, store_option_data, store_previous_day_oi, NiftyData, OptionData, SessionLocal, get_tracked_symbols, save_tracked_symbols, save_fetcher_state, get_fetcher_state,get_valid_trading_day,clear_madhan_db
from database.market_calendar_db import is_market_holiday

logger = get_logger(__name__)




def get_trading_days():
    try:
        today = get_valid_trading_day(exchange="NSE")
        prev_day = today - timedelta(days=1)
        
        # Use centralized holiday logic
        while prev_day.weekday() >= 5 or is_market_holiday(prev_day, exchange="NSE"):
            prev_day -= timedelta(days=1)
            
        return today, prev_day
    except Exception as e:
        logger.exception(f"Error calculating trading days: {e}")
        return None, None


class NiftyDataFetcher:
    """
    A singleton class to manage the background fetching of Nifty data.
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        with cls._lock:
            if not cls._instance:
                cls._instance = super().__new__(cls)
        return cls._instance


    def _get_request_delay(self):
        """Calculates the delay between API calls based on the .env setting."""
        rate_limit_str = os.getenv('API_RATE_LIMIT', '5 per second')
        try:
            rate = int(rate_limit_str.split(' ')[0])
            delay = 1.0 / rate
            logger.info(f"Using API request delay of {delay:.2f}s ({rate} requests/sec).")
            return delay
        except (ValueError, IndexError, ZeroDivisionError):
            logger.warning(f"Invalid API_RATE_LIMIT format: '{rate_limit_str}'. Falling back to 0.2s delay.")
            return 0.2

    def __init__(self):
        # Prevent re-initialization on subsequent calls
        if hasattr(self, '_initialized'):
            return
        self._initialized = True
        
        self.thread = None
        self.is_running = False
        self.stop_event = threading.Event()
        self.status = "Idle"
        self.api_key = None
        self.option_symbols = [] # Initialize empty, load later
        self.last_update = None
        
        # Initialize state variables with defaults
        self.open_atm_strike = 0
        self.current_atm_strike = 0
        self.expiry_date = None
        self.trading_date = None
        
        self.request_delay = self._get_request_delay()

    def _load_state(self):
        """Loads persisted state from database. Safe to call only after DB init."""
        try:
            self.option_symbols = get_tracked_symbols()
            self.open_atm_strike = int(get_fetcher_state('open_atm_strike') or 0)
            self.current_atm_strike = int(get_fetcher_state('current_atm_strike') or 0)
            self.expiry_date = get_fetcher_state('expiry_date')
            self.trading_date = get_valid_trading_day(exchange="NSE")
            
            if self.open_atm_strike > 0:
                logger.info(f"Loaded persisted Open ATM strike: {self.open_atm_strike}")
            if self.current_atm_strike > 0:
                logger.info(f"Loaded persisted Current ATM strike: {self.current_atm_strike}")
            if self.expiry_date:
                logger.info(f"Loaded persisted Expiry Date: {self.expiry_date}")
        except Exception as e:
            logger.error(f"Could not load persisted fetcher state: {e}")
            # Keep defaults

    def start(self, api_key: str):
        """Starts the data fetching thread."""
        if self.is_running:
            logger.warning("Nifty fetcher is already running.")
            return False
            
        # Ensure state is loaded before starting
        self._load_state()
            
        clear_madhan_db()
        self.api_key = api_key
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        self.is_running = True
        logger.info("Nifty data fetcher started.")
        return True

    def stop(self):
        """Stops the data fetching thread."""
        if not self.is_running:
            logger.warning("Nifty fetcher is not running.")
            return
        
        self.stop_event.set()
        self.thread.join(timeout=5) # Wait for the thread to finish
        self.is_running = False
        self.status = "Stopped"
        logger.info("Nifty data fetcher stopped.")
        
    def get_nifty_live_data(self, interval: str = '1m', days_back: int = 1):
        """
        Get NIFTY OHLC data for the lightweight chart.
        
        Args:
            api_key: The API key for authentication
            interval: The time interval for the data (default: '1m')
            days_back: Number of days of historical data to fetch (default: 1)
            
        Returns:
            tuple: (success, result, status_code)
        """
        try:
            #logger.info(f"API Key: {self.api_key}")
            logger.info(f"starting nifty live fetch: {self}")
            # Calculate date range
            end_date = datetime.now()
            start_date = end_date - timedelta(days=7) # Fetch 7 days to be safe
            start_date_str = start_date.strftime('%Y-%m-%d')
            end_date_str = end_date.strftime('%Y-%m-%d')
            
            # Fetch data using get_history
            success, result, status_code = get_history(
                symbol="NIFTY",
                exchange="NSE_INDEX",
                interval=interval,
                start_date=start_date.strftime('%Y-%m-%d'),
                end_date=end_date.strftime('%Y-%m-%d'),
                api_key=self.api_key
            )
            
            if not success or result.get('status') != 'success':
                return False, {
                    'status': 'error',
                    'message': result.get('message', 'Failed to fetch NIFTY data')
                }, status_code or 500
                
            # Process the data for the chart
            chart_data = []
            for data in result.get('data', []):
                try:
                    chart_data.append({
                        "time": int(pd.to_datetime(data['timestamp'], unit='s').timestamp()),
                        "open": float(data['open']),
                        "high": float(data['high']),
                        "low": float(data['low']),
                        "close": float(data['close'])
                    })
                except (KeyError, ValueError, TypeError) as e:
                    logger.error(f"Error processing data point: {e}")
                    continue

            return True, {
                "status": "success",
                "data": chart_data,
                "last_updated": datetime.utcnow().isoformat()
            }, 200

        except Exception as e:
            logger.error(f"Error in get_nifty_live_data: {e}", exc_info=True)
            return False, {
                'status': 'error', 
                'message': 'Internal server error'
            }, 500

    def _get_atm_strike_and_symbols(self, df: pd.DataFrame):
        """Calculates Open ATM strike and generates a list of option symbols to track."""
        try:
            # 1. Find the open price for the current day
            today_str = get_valid_trading_day(exchange="NSE").strftime('%Y-%m-%d') 
            today_df = df[pd.to_datetime(df['timestamp'], unit='s').dt.strftime('%Y-%m-%d') == today_str]
            
            last_candle_timestamp = 0
            if today_df.empty:
                logger.warning("No data for today found in initial fetch to determine Open ATM strike.")
                if not df.empty:
                    open_price = df['close'].iloc[-1]
                    last_candle_timestamp = df['timestamp'].iloc[-1]
                    logger.info(f"Falling back to last close price for Open ATM calculation: {open_price}")
                else:
                    logger.error("Cannot determine Open ATM strike, dataframe is empty.")
                    return
            else:
                open_price = today_df['open'].iloc[0]
                last_candle_timestamp = today_df['timestamp'].iloc[0]
                logger.info(f"Today's open price for NIFTY is: {open_price}")

            # 2. Calculate Open ATM strike (rounded to nearest 50)
            self.open_atm_strike = round(open_price / 50) * 50
            logger.info(f"Calculated Open ATM strike: {self.open_atm_strike}")
            save_fetcher_state('open_atm_strike', self.open_atm_strike)

            # 3. Get the first expiry date for NIFTY options
            success, expiry_data, _ = get_expiry_dates(symbol="NIFTY", exchange="NFO", instrumenttype="options", api_key=self.api_key)
            if not success or not expiry_data.get('data'):
                logger.error(f"Could not fetch expiry dates: {expiry_data.get('message')}")
                return
            
            current_date_dt = get_valid_trading_day(exchange="NSE")
            self.expiry_date = expiry_data['data'][0]
            expiry_date_dt = datetime.strptime(self.expiry_date, "%d-%b-%y").date()
            
            # If current date matches expiry date, use next expiry if available
            if current_date_dt == expiry_date_dt and len(expiry_data['data']) > 1:
                self.expiry_date = expiry_data['data'][1]
                logger.info(f"Current date matches expiry, using next expiry: {self.expiry_date}")
            
            save_fetcher_state('expiry_date', self.expiry_date)
            expiry_for_symbol = datetime.strptime(self.expiry_date, "%d-%b-%y").strftime("%d%b%y").upper()
            logger.info(f"Selected expiry date: {self.expiry_date} ({expiry_for_symbol})")

            # 4. Generate list of option symbols
            symbols_to_track = []
            # 21 strikes: ATM, 10 above (OTM calls/ITM puts), 10 below (ITM calls/OTM puts)
            # This creates a "ring" of 42 symbols (21 CEs and 21 PEs) around the ATM.
            for i in range(-10, 11):  # from -10 to +10, total 21 steps
                strike = self.open_atm_strike + (i * 50)
                symbols_to_track.append(f"NIFTY{expiry_for_symbol}{strike}CE")
                symbols_to_track.append(f"NIFTY{expiry_for_symbol}{strike}PE")

            # Sort and ensure uniqueness, though the loop logic should prevent duplicates.
            self.option_symbols = sorted(list(set(symbols_to_track)))
            save_tracked_symbols(self.option_symbols)
            logger.info(f"Generated {len(self.option_symbols)} option symbols to track around Open ATM.")

            # 5. Set last_update from the candle timestamp
            if last_candle_timestamp > 0:
                # Create a timezone-aware datetime object in IST
                self.last_update = datetime.fromtimestamp(last_candle_timestamp, pytz.timezone('Asia/Kolkata'))
                logger.info(f"Set last_update from Nifty open candle timestamp: {self.last_update}")

        except Exception as e:
            logger.exception(f"Error in _get_atm_strike_and_symbols: {e}")

    def _fetch_single_option_data(self, symbol, start_date_str, end_date_str):
        """Fetches data for a single option symbol."""
        try:
            success, result, _ = get_history(symbol=symbol, exchange="NFO", interval="1m", start_date=start_date_str, end_date=end_date_str, api_key=self.api_key)
            if success and result.get('status') == 'success':
                df_option = pd.DataFrame(result['data'])
                if not df_option.empty:
                    # Ensure 'oi' column exists and is of integer type, fill NaNs with 0
                    if 'oi' not in df_option.columns:
                        df_option['oi'] = 0
                    df_option['oi'] = pd.to_numeric(df_option['oi'], errors='coerce').fillna(0).astype(int)
                    df_option['symbol'] = symbol
                    store_option_data(df_option)
                    return True, symbol
            return False, symbol
        except Exception as e:
            logger.error(f"Exception fetching data for option {symbol}: {e}")
            return False, symbol

    def _fetch_and_store_options_data(self, start_date_str, end_date_str):
        """Fetches and stores historical data for the tracked option symbols in parallel."""
        if not self.option_symbols:
            return
        
        # Calculate parallel workers based on rate limit / 2
        rate_limit_str = os.getenv('API_RATE_LIMIT', '5 per second')
        try:
            rate = int(rate_limit_str.split(' ')[0])
            max_workers = max(1, rate // 2)  # Use half the rate limit for parallel requests
        except (ValueError, IndexError, ZeroDivisionError):
            max_workers = 2  # Default fallback
        
        logger.info(f"Fetching option data with {max_workers} parallel workers")
        
        successful_fetches = 0
        failed_fetches = 0
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_symbol = {
                executor.submit(self._fetch_single_option_data, symbol, start_date_str, end_date_str): symbol 
                for symbol in self.option_symbols
            }
            
            # Process completed tasks
            for future in as_completed(future_to_symbol):
                success, symbol = future.result()
                if success:
                    successful_fetches += 1
                else:
                    failed_fetches += 1
                
                # Add delay to respect rate limiting
                time.sleep(self.request_delay * 2)  # Double the delay since we're using parallel requests
        
        logger.info(f"Option data fetch completed: {successful_fetches} successful, {failed_fetches} failed")

    def _calculate_and_store_previous_day_oi(self, today, prev_day):
        """
        Calculates and stores the last candle's OI and close for the previous trading day
        for Nifty and all tracked option symbols.
        """
        logger.info("Calculating and storing previous day's OI and close data...")
        session = SessionLocal()
        try:


            logger.info(f"Identifying previous trading day as: {prev_day.strftime('%Y-%m-%d')}")

            start_of_prev_day_ts = int(datetime.combine(prev_day, datetime.min.time()).timestamp())
            end_of_prev_day_ts = int(datetime.combine(prev_day, datetime.max.time()).timestamp())

            data_to_store = []

            # 1. Get previous day's data for NIFTY
            last_nifty_candle = session.query(NiftyData).filter(
                NiftyData.timestamp >= start_of_prev_day_ts,
                NiftyData.timestamp <= end_of_prev_day_ts
            ).order_by(NiftyData.timestamp.desc()).first()

            if last_nifty_candle:
                data_to_store.append({
                    'symbol': 'NIFTY',
                    'oi': last_nifty_candle.oi or 0,
                    'close': last_nifty_candle.close,
                    'timestamp': last_nifty_candle.timestamp
                })
            else:
                logger.warning("Could not find previous day's data for NIFTY")

            # 2. Get previous day's data for all options in one query
            if self.option_symbols:
                subq = (
                    select(
                        OptionData,
                        func.row_number().over(
                            partition_by=OptionData.symbol,
                            order_by=OptionData.timestamp.desc()
                        ).label('rn')
                    ).filter(
                        OptionData.symbol.in_(self.option_symbols),
                        OptionData.timestamp >= start_of_prev_day_ts,
                        OptionData.timestamp <= end_of_prev_day_ts
                    ).subquery()
                )
                last_option_candles = session.query(subq).filter(subq.c.rn == 1).all()

                for candle in last_option_candles:
                    data_to_store.append({
                        'symbol': candle.symbol,
                        'oi': candle.oi or 0,
                        'close': candle.close,
                        'timestamp': candle.timestamp
                    })
            
            if data_to_store:
                store_previous_day_oi(data_to_store)
                logger.info(f"Stored previous day OI for {len(data_to_store)} symbols.")
            else:
                logger.warning("No previous day OI data was found to store.")

        except Exception as e:
            logger.exception(f"Error in _calculate_and_store_previous_day_oi: {e}")
        finally:
            session.close()

    def _run(self):
        """The main loop for the background thread."""
        # --- Preliminary Fetch to set initial parameters ---
        self.status = "Initializing parameters..."
        logger.info(self.status)
        try:
            # Fetch last 2 days of data just to get a recent price for preliminary ATM.
            prelim_end_date = datetime.now()
            prelim_start_date = prelim_end_date - timedelta(days=2)
            prelim_start_str = prelim_start_date.strftime('%Y-%m-%d')
            prelim_end_str = prelim_end_date.strftime('%Y-%m-%d')

            success, result, _ = get_history(
                symbol="NIFTY", exchange="NSE_INDEX", interval="1m",
                start_date=prelim_start_str,
                end_date=prelim_end_str,
                api_key=self.api_key
            )
            if success and result.get('status') == 'success':
                df_prelim = pd.DataFrame(result['data'])
                if not df_prelim.empty:
                    # This will set a preliminary Open ATM and the correct expiry date.
                    self._get_atm_strike_and_symbols(df_prelim)
                    logger.info("Preliminary Open ATM and Expiry Date have been set.")
            else:
                logger.warning(f"Could not perform preliminary fetch to set initial parameters: {result.get('message')}")
        except Exception as e:
            logger.error(f"Exception during preliminary parameter fetch: {e}")

        # 1. Initial 5-day fetch
        self.status = "Performing initial 5-day backfill for NIFTY..."
        logger.info(self.status)
        try:
            end_date = datetime.now()
            start_date = end_date - timedelta(days=7) # Fetch 7 days to be safe
            start_date_str = start_date.strftime('%Y-%m-%d')
            end_date_str = end_date.strftime('%Y-%m-%d')
            
            success, result, _ = get_history(
                symbol="NIFTY", exchange="NSE_INDEX", interval="1m",
                start_date=start_date_str,
                end_date=end_date_str,
                api_key=self.api_key
            )
            
            if success and result.get('status') == 'success':
                df_nifty = pd.DataFrame(result['data'])
                if not df_nifty.empty:
                    store_nifty_data(df_nifty)
                    logger.info(f"Initial NIFTY fetch successful. Stored {len(df_nifty)} records.")
                    
                    # This call will now refine the Open ATM with the actual day's open price.
                    self._get_atm_strike_and_symbols(df_nifty)

                    # Also calculate and store the current ATM from the last available candle
                    last_close = df_nifty['close'].iloc[-1]
                    self.current_atm_strike = round(last_close / 50) * 50
                    save_fetcher_state('current_atm_strike', self.current_atm_strike)
                    logger.info(f"Calculated initial Current ATM strike: {self.current_atm_strike}")
                    
                    self.status = "Performing initial backfill for Options..."
                    logger.info(self.status)
                    self._fetch_and_store_options_data(start_date_str, end_date_str)

                    # Calculate previous day's OI
                    today, prev_day = get_trading_days()
                    prev_day_oi = self._calculate_and_store_previous_day_oi(today, prev_day)
            else:
                self.status = f"Error during initial fetch: {result.get('message', 'Unknown error')}"
                logger.error(self.status)
                self.is_running = False
                return
        except Exception as e:
            self.status = f"Exception during initial fetch: {e}"
            logger.exception(self.status)
            self.is_running = False
            return

        # 2. Continuous 1-minute fetch loop
        while not self.stop_event.is_set():
            self.status = f"Running. Last update: {self.last_update.strftime('%H:%M:%S') if self.last_update else 'N/A'}"
            
            # --- SYNCHRONIZED WAIT LOGIC ---
            # This logic ensures the fetch happens a few seconds after each minute turnover,
            # increasing the chance of getting a complete, closed candle.
            now = datetime.now()
            
            # Wait until 5 seconds past the next minute.
            # e.g., if it's 9:30:25, wait for (60 - 25) + 5 = 40 seconds. Next run at 9:31:05.
            seconds_to_wait = (60 - now.second) + 5
            logger.info(f"Synchronizing fetch. Waiting for {seconds_to_wait} seconds to align with candle close.")
            
            # The wait method returns True if the event is set, False on timeout.
            if self.stop_event.wait(seconds_to_wait):
                break

            # Fetch data for the current day to get the latest candle and update the DB
            try:
                now = datetime.now()
                # Check for weekend condition to stop the fetcher
                if now.weekday() >= 5: # Saturday is 5, Sunday is 6
                    logger.info("Market is closed for the weekend. Stopping fetcher.")
                    self.is_running = False
                    self.status = "Stopped (Weekend)"
                    self.stop_event.set()
                    break

                logger.info("Performing 1-minute incremental fetch for NIFTY and Options...")
                today_str = now.strftime('%Y-%m-%d')
                
                # Fetch NIFTY
                success_nifty, result_nifty, _ = get_history(
                    symbol="NIFTY", exchange="NSE_INDEX", interval="1m",
                    start_date=today_str, end_date=today_str, api_key=self.api_key
                )
                if success_nifty and result_nifty.get('status') == 'success':
                    df_nifty = pd.DataFrame(result_nifty['data'])
                    if not df_nifty.empty:
                        store_nifty_data(df_nifty)
                        self.last_update = datetime.now(pytz.timezone('Asia/Kolkata'))
                        logger.info(f"Incremental NIFTY fetch successful. Upserted {len(df_nifty)} records.")

                        # Calculate current ATM from the last candle
                        last_close = df_nifty['close'].iloc[-1]
                        self.current_atm_strike = round(last_close / 50) * 50
                        save_fetcher_state('current_atm_strike', self.current_atm_strike)

                        # Check for market close condition to stop the fetcher for the day
                        market_close_time = now.replace(hour=15, minute=30, second=0, microsecond=0)

                        if now > market_close_time:
                            last_candle_timestamp = df_nifty['timestamp'].iloc[-1]
                            # The timestamp is in seconds (unix time), convert to datetime
                            last_candle_dt = datetime.fromtimestamp(last_candle_timestamp)
                            logger.info(f"Market is closed. Last candle time: {last_candle_dt.strftime('%H:%M:%S')}")

                            # If the last candle is at 15:29, it's the end of the trading day
                            if last_candle_dt.hour == 15 and last_candle_dt.minute == 29:
                                logger.info("Last candle for the day (15:29) has been fetched. Stopping fetcher.")
                                self.is_running = False
                                self.status = "Stopped (Market Closed)"
                                self.stop_event.set() # Signal the loop to terminate
                                break # Exit the loop
                else:
                    logger.warning(f"Incremental NIFTY fetch failed: {result_nifty.get('message', 'Unknown error')}")

                # Fetch Options
                self._fetch_and_store_options_data(today_str, today_str)

            except Exception as e:
                logger.error(f"Exception during incremental fetch: {e}")

# Create a single, global instance of the fetcher
nifty_fetcher = NiftyDataFetcher()