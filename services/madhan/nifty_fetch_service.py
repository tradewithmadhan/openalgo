"""
A background service to fetch and store NIFTY and BANKNIFTY 1-minute data.
Uses a single thread running both instruments sequentially (NIFTY first, then BANKNIFTY)
with synchronized timing to fire at xx:00.100 each minute.
"""
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from sqlalchemy import func, select
import pandas as pd
from datetime import datetime, timedelta, date as date_type
import pytz
from utils.logging import get_logger
from services.history_service import get_history
from services.expiry_service import get_expiry_dates
from database.madhan_db import (
    store_nifty_data, store_banknifty_data, store_option_data, store_previous_day_oi,
    NiftyData, BankNiftyData, OptionData, SessionLocal,
    get_tracked_symbols, save_tracked_symbols, save_fetcher_state, get_fetcher_state,
    get_valid_trading_day, clear_madhan_db, validate_backfill_consistency,
    get_current_day_historical_data, get_last_option_candle_timestamp,
    get_last_option_candle_timestamp_for_instrument,
    get_lot_size
)
from database.market_calendar_db import is_market_holiday, get_market_timings_for_date
from database.auth_db import get_first_available_api_key_with_user
from utils.session import has_login_this_trading_session
from utils.notifier import emit_notification
from services.madhan.atp_signal import process_historical_atp_data
from services.madhan.volume_signal import detect_volume_spike

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


class IndexDataFetcher:
    """Config + per-instrument state and methods for fetching one index (NIFTY or BANKNIFTY)."""

    def __init__(self, instrument_name, spot_symbol, exchange, strike_step, store_fn, lot_size_fn):
        self.instrument_name = instrument_name
        self.spot_symbol = spot_symbol
        self.exchange = exchange
        self.strike_step = strike_step
        self.store_fn = store_fn
        self.lot_size_fn = lot_size_fn

        # Per-instrument state
        self.open_atm_strike = 0
        self.current_atm_strike = 0
        self.expiry_date = None
        self.trading_date = None
        self.option_symbols = []
        self.last_update = None
        self.status = "Idle"

    def _load_state(self):
        """Loads persisted state from database for this instrument."""
        try:
            prefix = self.instrument_name.lower()
            all_symbols = get_tracked_symbols()
            self.option_symbols = [s for s in all_symbols if s.startswith(self.instrument_name)]
            self.open_atm_strike = int(get_fetcher_state(f'{prefix}_open_atm_strike') or 0)
            self.current_atm_strike = int(get_fetcher_state(f'{prefix}_current_atm_strike') or 0)
            self.expiry_date = get_fetcher_state(f'{prefix}_expiry_date')
            self.trading_date = get_valid_trading_day(exchange="NSE")

            if self.open_atm_strike > 0:
                logger.info(f"[{self.instrument_name}] Loaded persisted Open ATM strike: {self.open_atm_strike}")
            if self.current_atm_strike > 0:
                logger.info(f"[{self.instrument_name}] Loaded persisted Current ATM strike: {self.current_atm_strike}")
            if self.expiry_date:
                logger.info(f"[{self.instrument_name}] Loaded persisted Expiry Date: {self.expiry_date}")
        except Exception as e:
            logger.error(f"[{self.instrument_name}] Could not load persisted state: {e}")

    def _save_state(self):
        """Persists current state to database for this instrument."""
        prefix = self.instrument_name.lower()
        save_fetcher_state(f'{prefix}_open_atm_strike', self.open_atm_strike)
        save_fetcher_state(f'{prefix}_current_atm_strike', self.current_atm_strike)
        save_fetcher_state(f'{prefix}_expiry_date', self.expiry_date)

    def _get_atm_strike_and_symbols(self, df, api_key):
        """Calculates Open ATM strike and generates option symbols for this instrument."""
        try:
            today_str = get_valid_trading_day(exchange="NSE").strftime('%Y-%m-%d')
            today_df = df[pd.to_datetime(df['timestamp'], unit='s').dt.strftime('%Y-%m-%d') == today_str]

            last_candle_timestamp = 0
            if today_df.empty:
                logger.warning(f"[{self.instrument_name}] No data for today. Deferring ATM calculation.")
                self.open_atm_strike = 0
                save_fetcher_state(f'{self.instrument_name.lower()}_open_atm_strike', 0)
                self.option_symbols = []
                self._fetch_and_save_expiry(api_key)
                return

            open_price = today_df['open'].iloc[0]
            last_candle_timestamp = today_df['timestamp'].iloc[-1]
            logger.info(f"[{self.instrument_name}] Today's open price: {open_price}")

            self.open_atm_strike = round(open_price / self.strike_step) * self.strike_step
            logger.info(f"[{self.instrument_name}] Calculated Open ATM strike: {self.open_atm_strike}")
            save_fetcher_state(f'{self.instrument_name.lower()}_open_atm_strike', self.open_atm_strike)

            self._fetch_and_save_expiry(api_key)
            if not self.expiry_date:
                return

            self._generate_option_symbols()

            if last_candle_timestamp > 0:
                self.last_update = datetime.fromtimestamp(last_candle_timestamp, pytz.timezone('Asia/Kolkata'))
                logger.info(f"[{self.instrument_name}] Set last_update from candle timestamp: {self.last_update}")

        except Exception as e:
            logger.exception(f"[{self.instrument_name}] Error in _get_atm_strike_and_symbols: {e}")

    def _fetch_and_save_expiry(self, api_key):
        """Fetches and saves the expiry date for this instrument's options."""
        try:
            success, expiry_data, _ = get_expiry_dates(
                symbol=self.instrument_name, exchange="NFO",
                instrumenttype="options", api_key=api_key
            )
            if not success or not expiry_data.get('data'):
                logger.error(f"[{self.instrument_name}] Could not fetch expiry dates: {expiry_data.get('message')}")
                self.expiry_date = None
                return

            current_date_dt = get_valid_trading_day(exchange="NSE")
            self.expiry_date = expiry_data['data'][0]
            expiry_date_dt = datetime.strptime(self.expiry_date, "%d-%b-%y").date()

            if current_date_dt == expiry_date_dt and len(expiry_data['data']) > 1:
                self.expiry_date = expiry_data['data'][1]
                logger.info(f"[{self.instrument_name}] Current date matches expiry, using next: {self.expiry_date}")

            save_fetcher_state(f'{self.instrument_name.lower()}_expiry_date', self.expiry_date)
            logger.info(f"[{self.instrument_name}] Selected expiry date: {self.expiry_date}")
        except Exception as e:
            logger.exception(f"[{self.instrument_name}] Error fetching expiry date: {e}")
            self.expiry_date = None

    def _generate_option_symbols(self):
        """Generates option symbols based on open_atm_strike and expiry_date."""
        if not self.open_atm_strike or not self.expiry_date:
            logger.warning(f"[{self.instrument_name}] Cannot generate option symbols: ATM or expiry not set.")
            return

        expiry_for_symbol = datetime.strptime(self.expiry_date, "%d-%b-%y").strftime("%d%b%y").upper()

        symbols_to_track = []
        for i in range(-10, 11):
            strike = self.open_atm_strike + (i * self.strike_step)
            symbols_to_track.append(f"{self.instrument_name}{expiry_for_symbol}{strike}CE")
            symbols_to_track.append(f"{self.instrument_name}{expiry_for_symbol}{strike}PE")

        existing = get_tracked_symbols()
        other_instruments = [s for s in existing if not s.startswith(self.instrument_name)]
        all_symbols = sorted(list(set(other_instruments + symbols_to_track)))
        save_tracked_symbols(all_symbols)
        self.option_symbols = sorted(symbols_to_track)
        logger.info(f"[{self.instrument_name}] Generated {len(symbols_to_track)} option symbols around ATM {self.open_atm_strike}.")

    def get_live_data(self, api_key, interval='1m', days_back=1):
        """Get OHLC data for this instrument for the lightweight chart."""
        try:
            logger.info(f"[{self.instrument_name}] Fetching live data: {self}")
            end_date = datetime.now()
            start_date = end_date - timedelta(days=7)

            success, result, status_code = get_history(
                symbol=self.spot_symbol, exchange=self.exchange, interval=interval,
                start_date=start_date.strftime('%Y-%m-%d'),
                end_date=end_date.strftime('%Y-%m-%d'),
                api_key=api_key
            )

            if not success or result.get('status') != 'success':
                return False, {
                    'status': 'error',
                    'message': result.get('message', f'Failed to fetch {self.instrument_name} data')
                }, status_code or 500

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
            logger.error(f"Error in {self.instrument_name} get_live_data: {e}", exc_info=True)
            return False, {'status': 'error', 'message': 'Internal server error'}, 500


class NiftyDataFetcher:
    """
    A singleton class to manage the background fetching of NIFTY and BANKNIFTY data.
    Runs both instruments sequentially in a single thread.
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
        
        self.request_delay = self._get_request_delay()

        # Create per-instrument configs
        self.nifty = IndexDataFetcher(
            instrument_name="NIFTY",
            spot_symbol="NIFTY",
            exchange="NSE_INDEX",
            strike_step=50,
            store_fn=store_nifty_data,
            lot_size_fn=lambda ts: get_lot_size('NIFTY', ts),
        )
        self.banknifty = IndexDataFetcher(
            instrument_name="BANKNIFTY",
            spot_symbol="BANKNIFTY",
            exchange="NSE_INDEX",
            strike_step=100,
            store_fn=store_banknifty_data,
            lot_size_fn=lambda ts: get_lot_size('BANKNIFTY', ts),
        )

        # Start auto-start scheduler (daemon thread sleeps until 9:15 AM IST)
        scheduler_thread = threading.Thread(target=self._auto_start_scheduler, daemon=True)
        scheduler_thread.start()
        logger.info("Auto-start scheduler thread started.")

    def _normalize_history_df(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Normalizes candle history data to ensure required numeric columns exist.
        This prevents downstream computations (like ATP) from silently falling back
        due to missing/invalid volume.
        """
        if df is None or df.empty:
            return df

        if "oi" not in df.columns:
            df["oi"] = 0
        if "volume" not in df.columns:
            df["volume"] = 0

        df["oi"] = pd.to_numeric(df["oi"], errors="coerce").fillna(0).astype(int)
        df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0).astype(int)
        return df

    def _load_state(self):
        """Loads persisted state from database for both instruments."""
        self.nifty._load_state()
        self.banknifty._load_state()

    def start(self, api_key: str):
        """Starts the data fetching thread."""
        if self.is_running:
            logger.warning("Data fetcher is already running.")
            return False
        
        # Wait for any lingering old thread to finish before clearing DB
        if self.thread and self.thread.is_alive():
            logger.info("Waiting for old fetcher thread to exit...")
            self.thread.join(timeout=5)

        # Clear DB first, then load state — ensures stale TrackedSymbol/FetcherState
        # from a previous run doesn't pollute config.option_symbols
        clear_madhan_db()
        self._load_state()
        self.api_key = api_key
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        self.is_running = True
        logger.info("Data fetcher started.")
        return True

    def stop(self):
        """Stops the data fetching thread."""
        if not self.is_running:
            logger.warning("Data fetcher is not running.")
            return
        
        self.stop_event.set()
        self.thread.join(timeout=5) # Wait for the thread to finish
        self.is_running = False
        self.status = "Stopped"
        logger.info("Data fetcher stopped.")

    def _auto_start_scheduler(self):
        """Background thread that auto-starts the fetcher at NFO start time on trading days."""
        IST = pytz.timezone('Asia/Kolkata')

        while True:
            now_ist = datetime.now(IST)
            today = date_type.today()

            # Skip weekends/holidays — sleep until tomorrow morning and re-check
            if today.weekday() >= 5:
                logger.info("Auto-start scheduler: weekend, sleeping until tomorrow.")
                tomorrow = now_ist + timedelta(days=1)
                target = tomorrow.replace(hour=9, minute=0, second=0, microsecond=0)
                sleep_seconds = (target - now_ist).total_seconds()
                while sleep_seconds > 0:
                    chunk = min(sleep_seconds, 60)
                    time.sleep(chunk)
                    sleep_seconds -= chunk
                continue

            if is_market_holiday(today, exchange="NSE"):
                logger.info("Auto-start scheduler: market holiday, sleeping until tomorrow.")
                tomorrow = now_ist + timedelta(days=1)
                target = tomorrow.replace(hour=9, minute=0, second=0, microsecond=0)
                sleep_seconds = (target - now_ist).total_seconds()
                while sleep_seconds > 0:
                    chunk = min(sleep_seconds, 60)
                    time.sleep(chunk)
                    sleep_seconds -= chunk
                continue

            # Get NFO start time from DB timings
            nfo_start_hour, nfo_start_min = 9, 15  # fallback
            try:
                timings = get_market_timings_for_date(today)
                for t in timings:
                    if t.get('exchange') == 'NFO':
                        start_dt = datetime.fromtimestamp(t['start_time'] / 1000, tz=IST)
                        nfo_start_hour = start_dt.hour
                        nfo_start_min = start_dt.minute
                        logger.info(f"Auto-start scheduler: NFO start time from DB: {nfo_start_hour:02d}:{nfo_start_min:02d}")
                        break
            except Exception as e:
                logger.warning(f"Auto-start scheduler: could not fetch NFO timings, using default 09:15: {e}")

            target = now_ist.replace(hour=nfo_start_hour, minute=nfo_start_min, second=0, microsecond=0)

            if now_ist >= target:
                # Already past NFO start — check if fetcher needs to be started
                if self.is_running:
                    logger.info("Auto-start scheduler: fetcher already running, sleeping until tomorrow.")
                    tomorrow = now_ist + timedelta(days=1)
                    next_target = tomorrow.replace(hour=nfo_start_hour, minute=nfo_start_min, second=0, microsecond=0)
                    sleep_seconds = (next_target - now_ist).total_seconds()
                    while sleep_seconds > 0:
                        chunk = min(sleep_seconds, 60)
                        time.sleep(chunk)
                        sleep_seconds -= chunk
                    continue

                api_key, user_id = get_first_available_api_key_with_user()
                if not api_key:
                    logger.info("Auto-start scheduler: no active session/API key found, sleeping until tomorrow.")
                    tomorrow = now_ist + timedelta(days=1)
                    next_target = tomorrow.replace(hour=nfo_start_hour, minute=nfo_start_min, second=0, microsecond=0)
                    sleep_seconds = (next_target - now_ist).total_seconds()
                    while sleep_seconds > 0:
                        chunk = min(sleep_seconds, 60)
                        time.sleep(chunk)
                        sleep_seconds -= chunk
                    continue

                if not has_login_this_trading_session(user_id):
                    logger.info(
                        f"Auto-start scheduler: no login since today's session rollover "
                        f"for {user_id}, broker token is stale. Sleeping until tomorrow."
                    )
                    tomorrow = now_ist + timedelta(days=1)
                    next_target = tomorrow.replace(hour=nfo_start_hour, minute=nfo_start_min, second=0, microsecond=0)
                    sleep_seconds = (next_target - now_ist).total_seconds()
                    while sleep_seconds > 0:
                        chunk = min(sleep_seconds, 60)
                        time.sleep(chunk)
                        sleep_seconds -= chunk
                    continue

                logger.info("Auto-start scheduler: starting fetcher (past NFO start).")
                self.start(api_key)
                # Sleep until tomorrow
                tomorrow = now_ist + timedelta(days=1)
                next_target = tomorrow.replace(hour=nfo_start_hour, minute=nfo_start_min, second=0, microsecond=0)
                sleep_seconds = (next_target - now_ist).total_seconds()
                while sleep_seconds > 0:
                    chunk = min(sleep_seconds, 60)
                    time.sleep(chunk)
                    sleep_seconds -= chunk
                continue

            # Sleep until NFO start time
            sleep_seconds = (target - now_ist).total_seconds()
            logger.info(f"Auto-start scheduler: sleeping {sleep_seconds/3600:.1f}h until {target.strftime('%Y-%m-%d %H:%M %Z')} (NFO start)")

            while sleep_seconds > 0:
                chunk = min(sleep_seconds, 60)
                time.sleep(chunk)
                sleep_seconds -= chunk

            # Re-check after sleep
            if self.is_running:
                logger.info("Auto-start scheduler: fetcher already running, skipping.")
                continue

            api_key, user_id = get_first_available_api_key_with_user()
            if not api_key:
                logger.info("Auto-start scheduler: no active session/API key found, skipping.")
                continue

            if not has_login_this_trading_session(user_id):
                logger.info(
                    f"Auto-start scheduler: no login since today's session rollover "
                    f"for {user_id}, broker token is stale. Skipping."
                )
                continue

            logger.info("Auto-start scheduler: starting fetcher.")
            self.start(api_key)
        
    def get_nifty_live_data(self, interval: str = '1m', days_back: int = 1):
        """Get NIFTY OHLC data for the lightweight chart."""
        return self.nifty.get_live_data(self.api_key, interval, days_back)

    def get_instrument_live_data(self, instrument: str, interval: str = '1m', days_back: int = 1):
        """Get OHLC data for any instrument for the lightweight chart."""
        config = self.nifty if instrument == 'NIFTY' else self.banknifty
        return config.get_live_data(self.api_key, interval, days_back)

    def _fetch_single_option_data(self, config, symbol, start_date_str, end_date_str, max_retries=2):
        """Fetches data for a single option symbol. Returns DataFrame or None."""
        for attempt in range(max_retries + 1):
            try:
                success, result, _ = get_history(symbol=symbol, exchange="NFO", interval="1m", start_date=start_date_str, end_date=end_date_str, api_key=self.api_key)
                if success and result.get('status') == 'success':
                    df_option = pd.DataFrame(result['data'])
                    if not df_option.empty:
                        df_option = self._normalize_history_df(df_option)
                        df_option['symbol'] = symbol
                        return df_option
                if attempt < max_retries:
                    time.sleep(1)
            except Exception as e:
                if attempt < max_retries:
                    time.sleep(1)
                else:
                    logger.error(f"Failed after {max_retries + 1} attempts for {symbol}: {e}")
        return None

    def _fetch_and_store_options_data(self, config, start_date_str, end_date_str, symbols=None):
        """Fetches and stores historical data for option symbols in parallel for a given instrument config.
        
        Args:
            config: IndexDataFetcher config (self.nifty or self.banknifty)
            start_date_str: Start date string
            end_date_str: End date string
            symbols: Optional list of specific symbols to fetch. If None, fetches config's tracked symbols.
        
        Returns:
            list: Failed symbols that need retry.
        """
        symbols_to_fetch = symbols if symbols else config.option_symbols
        if not symbols_to_fetch:
            return []
        
        # Calculate parallel workers based on 90% of rate limit
        rate_limit_str = os.getenv('API_RATE_LIMIT', '5 per second')
        try:
            rate = int(rate_limit_str.split(' ')[0])
            max_workers = max(1, int(rate * 0.9))  # 90% of rate limit
        except (ValueError, IndexError, ZeroDivisionError):
            max_workers = 4  # Default fallback
        
        logger.info(f"[{config.instrument_name}] Fetching {len(symbols_to_fetch)} option symbols with {max_workers} parallel workers")
        
        fetch_start = time.time()
        successful_fetches = 0
        failed_symbols = []
        all_dfs = []
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_symbol = {
                executor.submit(self._fetch_single_option_data, config, symbol, start_date_str, end_date_str): symbol 
                for symbol in symbols_to_fetch
            }
            
            for future in as_completed(future_to_symbol):
                symbol = future_to_symbol[future]
                df = future.result()
                if df is not None:
                    all_dfs.append(df)
                    successful_fetches += 1
                else:
                    failed_symbols.append(symbol)
        
        fetch_elapsed = time.time() - fetch_start
        
        # Single batch DB write
        if all_dfs:
            db_start = time.time()
            store_option_data(pd.concat(all_dfs, ignore_index=True))
            db_elapsed = time.time() - db_start
            logger.info(f"[{config.instrument_name}] Option data fetch completed: {successful_fetches} successful, {len(failed_symbols)} failed "
                        f"(API: {fetch_elapsed:.2f}s, DB write: {db_elapsed:.2f}s)")
        else:
            logger.info(f"[{config.instrument_name}] Option data fetch completed: {successful_fetches} successful, {len(failed_symbols)} failed "
                        f"(API: {fetch_elapsed:.2f}s)")
        return failed_symbols

    def _fetch_and_process_spot(self, config, today_str, now):
        """Fetch spot data for a single instrument. Called from parallel ThreadPoolExecutor."""
        spot_start = time.time()
        success_spot, result_spot, _ = get_history(
            symbol=config.spot_symbol, exchange=config.exchange, interval="1m",
            start_date=today_str, end_date=today_str, api_key=self.api_key
        )
        if not (success_spot and result_spot.get('status') == 'success'):
            logger.warning(f"[{config.instrument_name}] Spot fetch failed: {result_spot.get('message', 'Unknown error')}")
            return False

        df_spot = pd.DataFrame(result_spot['data'])
        if df_spot.empty:
            logger.warning(f"[{config.instrument_name}] Spot data empty")
            return False

        df_spot = self._normalize_history_df(df_spot)
        config.store_fn(df_spot)
        spot_elapsed = time.time() - spot_start
        logger.debug(f"[{config.instrument_name}] Spot fetch: {len(df_spot)} records in {spot_elapsed:.2f}s")

        last_close = df_spot['close'].iloc[-1]
        config.current_atm_strike = round(last_close / config.strike_step) * config.strike_step
        config._save_state()

        if config.open_atm_strike == 0:
            open_price = df_spot['open'].iloc[0]
            config.open_atm_strike = round(open_price / config.strike_step) * config.strike_step
            config._save_state()
            logger.info(f"[{config.instrument_name}] Open ATM: {config.open_atm_strike}")
            config._generate_option_symbols()
            backfill_start = (now - timedelta(days=7)).strftime('%Y-%m-%d')
            logger.info(f"[{config.instrument_name}] Backfilling from {backfill_start} to {today_str}")
            failed_symbols = self._fetch_and_store_options_data(config, backfill_start, today_str)
            retry_attempt = 0
            while failed_symbols and retry_attempt < 10:
                retry_attempt += 1
                time.sleep(2)
                failed_symbols = self._fetch_and_store_options_data(config, backfill_start, today_str, symbols=failed_symbols)
            validation = validate_backfill_consistency(config.option_symbols, config.instrument_name)
            if validation["consistent"]:
                s = validation["summary"]
                logger.info(f"[{config.instrument_name}] Backfill validation PASSED: {s['filled']}/{s['total_tracked']}")
            else:
                logger.warning(f"[{config.instrument_name}] Backfill validation FAILED")

        return True

    def _check_and_emit_trade_signal(self, config, today_str):
        """Check for trade signals using shared ATP-LTP signal computation."""
        if not config.option_symbols or not config.current_atm_strike:
            return

        try:
            all_historical_data = get_current_day_historical_data(instrument=config.instrument_name)
            if not all_historical_data:
                return

            historical_data = process_historical_atp_data(all_historical_data, config.current_atm_strike, config.instrument_name, config.strike_step)
            if not historical_data:
                return

            # Check last entry for trade_signal (previous candle)
            entry = historical_data[-1]
            if not entry.get('trade_signal'):
                return

            sig = entry.get('final_signal', '')
            spot = entry.get('spot_ltp', 0)
            atm = entry.get('atm_strike', 0)

            # Determine CE/PE and LTP from the entry
            if sig == 'Bullish':
                ce_pe = 'CE'
                ltp = entry.get('atm_call_ltp', 0)
            elif sig == 'Bearish':
                ce_pe = 'PE'
                ltp = entry.get('atm_put_ltp', 0)
            else:
                return

            try:
                ltp_f = float(ltp) if ltp else 0
                spot_f = float(spot) if spot else 0
            except (TypeError, ValueError):
                return

            emit_notification(
                'app_notification',
                f'{sig} Signal',
                f'{config.instrument_name} {atm} {ce_pe} @ {ltp_f:.2f} | Spot: {spot_f:.2f}',
                category='madhan',
                level='success' if sig == 'Bullish' else 'error',
                data={'strike': atm, 'ltp': ltp_f, 'spot': spot_f, 'type': sig}
            )
            logger.info(f"Trade signal emitted: {sig} {config.instrument_name} {atm} {ce_pe} @ {ltp_f}")

        except Exception as sig_err:
            logger.debug(f"Signal check skipped for {config.instrument_name}: {sig_err}")

    def _check_and_emit_volume_spike(self, config, today_str):
        """Check for volume spike using shared volume_signal module."""
        try:
            all_historical_data = get_current_day_historical_data(instrument=config.instrument_name)
            if not all_historical_data:
                return

            result = detect_volume_spike(all_historical_data, config.instrument_name)
            if not result:
                return

            last = result[-1]
            if not last.get('is_spike'):
                return

            ce_vol = last.get('ce_volume', 0)
            pe_vol = last.get('pe_volume', 0)
            combined = last.get('combined', 0)

            emit_notification(
                'app_notification',
                f'{config.instrument_name} Volume Spike',
                f'CE: {ce_vol:,.0f} | PE: {pe_vol:,.0f} | Combined: {combined:,.0f}',
                category='madhan',
                level='warning',
                data={
                    'signal_type': 'volume_spike',
                    'ce_volume': ce_vol,
                    'pe_volume': pe_vol,
                    'combined': combined,
                }
            )
            logger.info(f"Volume spike emitted for {config.instrument_name}: CE: {ce_vol} PE: {pe_vol} Combined: {combined}")

        except Exception as spike_err:
            logger.debug(f"Volume spike check skipped for {config.instrument_name}: {spike_err}")

    def _calculate_and_store_previous_day_oi(self, config, today, prev_day):
        """
        Calculates and stores the last candle's OI and close for the previous trading day
        for the instrument's spot and all tracked option symbols.
        """
        logger.info(f"[{config.instrument_name}] Calculating and storing previous day's OI and close data...")
        session = SessionLocal()
        try:

            logger.info(f"[{config.instrument_name}] Identifying previous trading day as: {prev_day.strftime('%Y-%m-%d')}")

            start_of_prev_day_ts = int(datetime.combine(prev_day, datetime.min.time()).timestamp())
            end_of_prev_day_ts = int(datetime.combine(prev_day, datetime.max.time()).timestamp())

            data_to_store = []

            # 1. Get previous day's data for spot (NIFTY or BANKNIFTY)
            spot_class = BankNiftyData if config.instrument_name == 'BANKNIFTY' else NiftyData
            last_spot_candle = session.query(spot_class).filter(
                spot_class.timestamp >= start_of_prev_day_ts,
                spot_class.timestamp <= end_of_prev_day_ts
            ).order_by(spot_class.timestamp.desc()).first()

            if last_spot_candle:
                data_to_store.append({
                    'symbol': config.instrument_name,
                    'oi': last_spot_candle.oi or 0,
                    'close': last_spot_candle.close,
                    'timestamp': last_spot_candle.timestamp
                })
            else:
                logger.warning(f"[{config.instrument_name}] Could not find previous day's data for spot")

            # 2. Get previous day's data for all options in one query
            if config.option_symbols:
                subq = (
                    select(
                        OptionData,
                        func.row_number().over(
                            partition_by=OptionData.symbol,
                            order_by=OptionData.timestamp.desc()
                        ).label('rn')
                    ).filter(
                        OptionData.symbol.in_(config.option_symbols),
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
                logger.info(f"[{config.instrument_name}] Stored previous day OI for {len(data_to_store)} symbols.")
            else:
                logger.warning(f"[{config.instrument_name}] No previous day OI data was found to store.")

        except Exception as e:
            logger.exception(f"[{config.instrument_name}] Error in _calculate_and_store_previous_day_oi: {e}")
        finally:
            session.close()

    def _run(self):
        """The main loop for the background thread. Runs NIFTY first, then BANKNIFTY sequentially."""
        # --- Preliminary Fetch to set initial parameters for both instruments ---
        self.status = "Initializing parameters..."
        logger.info(self.status)
        
        for config in [self.nifty, self.banknifty]:
            try:
                prelim_end_date = datetime.now()
                prelim_start_date = prelim_end_date - timedelta(days=2)
                prelim_start_str = prelim_start_date.strftime('%Y-%m-%d')
                prelim_end_str = prelim_end_date.strftime('%Y-%m-%d')

                success, result, _ = get_history(
                    symbol=config.spot_symbol, exchange=config.exchange, interval="1m",
                    start_date=prelim_start_str, end_date=prelim_end_str,
                    api_key=self.api_key
                )
                if success and result.get('status') == 'success':
                    df_prelim = pd.DataFrame(result['data'])
                    if not df_prelim.empty:
                        config._get_atm_strike_and_symbols(df_prelim, self.api_key)
                        logger.info(f"[{config.instrument_name}] Preliminary Open ATM and Expiry Date have been set.")
                else:
                    logger.warning(f"[{config.instrument_name}] Could not perform preliminary fetch: {result.get('message')}")
            except Exception as e:
                logger.error(f"[{config.instrument_name}] Exception during preliminary fetch: {e}")

        # --- Initial 7-day backfill for both instruments sequentially ---
        init_start = time.time()
        
        for config in [self.nifty, self.banknifty]:
            self.status = f"Backfilling {config.instrument_name}..."
            config.status = f"Performing initial 7-day backfill..."
            logger.info(f"[{config.instrument_name}] {config.status}")
            max_retries = 3
            retry_delays = [5, 10, 20]
            success = False
            
            for attempt in range(max_retries):
                try:
                    end_date = datetime.now()
                    start_date = end_date - timedelta(days=7)
                    start_date_str = start_date.strftime('%Y-%m-%d')
                    end_date_str = end_date.strftime('%Y-%m-%d')
                    
                    spot_start = time.time()
                    success, result, _ = get_history(
                        symbol=config.spot_symbol, exchange=config.exchange, interval="1m",
                        start_date=start_date_str, end_date=end_date_str,
                        api_key=self.api_key
                    )
                    
                    if success and result.get('status') == 'success':
                        df_spot = pd.DataFrame(result['data'])
                        if not df_spot.empty:
                            df_spot = self._normalize_history_df(df_spot)
                            config.store_fn(df_spot)
                            spot_elapsed = time.time() - spot_start
                            logger.info(f"[{config.instrument_name}] Initial spot fetch successful. Stored {len(df_spot)} records in {spot_elapsed:.2f}s.")
                            
                            config._get_atm_strike_and_symbols(df_spot, self.api_key)

                            last_close = df_spot['close'].iloc[-1]
                            config.current_atm_strike = round(last_close / config.strike_step) * config.strike_step
                            config._save_state()
                            logger.info(f"[{config.instrument_name}] Calculated initial Current ATM strike: {config.current_atm_strike}")
                            success = True
                            break
                        else:
                            logger.warning(f"[{config.instrument_name}] Initial spot fetch returned empty data.")
                    else:
                        logger.warning(f"[{config.instrument_name}] Initial spot fetch failed: {result.get('message', 'Unknown error')}")
                    
                    if attempt < max_retries - 1:
                        delay = retry_delays[attempt]
                        logger.info(f"[{config.instrument_name}] Retrying in {delay}s (attempt {attempt + 2}/{max_retries})...")
                        time.sleep(delay)
                except Exception as e:
                    logger.error(f"[{config.instrument_name}] Exception during initial fetch attempt {attempt + 1}: {e}")
                    if attempt < max_retries - 1:
                        time.sleep(retry_delays[attempt])
            
            if not success:
                logger.error(f"[{config.instrument_name}] Initial fetch failed after all retries. Continuing to next instrument.")
                continue
            
            # Options backfill for this instrument
            if config.option_symbols:
                config.status = "Performing initial options backfill..."
                logger.info(f"[{config.instrument_name}] {config.status}")
                
                end_date_str = datetime.now().strftime('%Y-%m-%d')
                start_date_str = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
                
                failed_symbols = self._fetch_and_store_options_data(config, start_date_str, end_date_str)
                
                retry_attempt = 0
                max_retries = 10
                while failed_symbols and retry_attempt < max_retries:
                    retry_attempt += 1
                    logger.warning(f"[{config.instrument_name}] Retrying {len(failed_symbols)} failed symbols (attempt {retry_attempt}/{max_retries}): {failed_symbols[:5]}...")
                    time.sleep(2)
                    failed_symbols = self._fetch_and_store_options_data(config, start_date_str, end_date_str, symbols=failed_symbols)
                
                if failed_symbols:
                    logger.error(f"[{config.instrument_name}] Options backfill incomplete after {max_retries} retries. Still missing: {len(failed_symbols)} symbols")
                else:
                    logger.info(f"[{config.instrument_name}] Options backfill complete: all symbols have data.")

                # Validate backfill consistency
                validation = validate_backfill_consistency(config.option_symbols, config.instrument_name)
                if validation["consistent"]:
                    s = validation["summary"]
                    logger.info(f"[{config.instrument_name}] Backfill validation PASSED: {s['filled']}/{s['total_tracked']} symbols filled")
                else:
                    logger.warning(f"[{config.instrument_name}] Backfill validation FAILED: {validation['issues']}")
            else:
                logger.info(f"[{config.instrument_name}] Skipping options backfill: no symbols available yet (pre-market, ATM not calculated).")

            config.status = "Idle"

        init_elapsed = time.time() - init_start
        logger.info(f"Initial backfill completed in {init_elapsed:.2f}s total for both instruments")

        # --- Calculate previous day's OI for both instruments ---
        self.status = "Calculating previous day OI..."
        today, prev_day = get_trading_days()
        for config in [self.nifty, self.banknifty]:
            self._calculate_and_store_previous_day_oi(config, today, prev_day)

        # --- Continuous 1-minute fetch loop (sequential: NIFTY first, then BANKNIFTY) ---
        self.status = "Running - Fetching live data"
        first_iteration = True
        while not self.stop_event.is_set():
            now = datetime.now()
            
            if not first_iteration:
                # Wait until 100ms past next minute boundary (xx:00.100)
                wait_secs = 60 - now.second
                if wait_secs <= 0:
                    wait_secs = 60
                wait_ms = wait_secs * 1000 - now.microsecond // 1000 + 100
                if wait_ms <= 0:
                    wait_ms += 60000
                logger.debug(f"Synchronizing fetch. Waiting {wait_ms/1000:.1f}s to align with candle close.")

                if self.stop_event.wait(wait_ms / 1000):
                    break
            else:
                first_iteration = False
                logger.info("Immediate post-backfill fetch (skipping minute boundary wait).")

            try:
                now = datetime.now()
                if now.weekday() >= 5:
                    logger.info("Market is closed for the weekend. Stopping fetcher.")
                    self.is_running = False
                    self.status = "Stopped (Weekend)"
                    self.stop_event.set()
                    break

                today_str = now.strftime('%Y-%m-%d')
                cycle_start = time.time()

                # --- Phase 1: Fetch both spots in parallel ---
                self.status = "Fetching NIFTY + BANKNIFTY spots..."
                spot_results = {}
                with ThreadPoolExecutor(max_workers=2) as executor:
                    futures = {
                        executor.submit(self._fetch_and_process_spot, config, today_str, now): config
                        for config in [self.nifty, self.banknifty]
                    }
                    for future in as_completed(futures):
                        config = futures[future]
                        if self.stop_event.is_set():
                            break
                        try:
                            success = future.result()
                            spot_results[config.instrument_name] = success
                        except Exception as e:
                            logger.error(f"[{config.instrument_name}] Spot fetch failed: {e}")
                            spot_results[config.instrument_name] = False

                if self.stop_event.is_set():
                    break

                # --- Phase 2: Fetch NIFTY options ---
                if spot_results.get("NIFTY") and self.nifty.option_symbols:
                    self.status = "Fetching NIFTY options..."
                    opt_start = time.time()
                    self._fetch_and_store_options_data(self.nifty, today_str, today_str)
                    logger.info(f"[NIFTY] Options fetched in {time.time() - opt_start:.2f}s")
                    self.nifty.last_update = datetime.now(pytz.timezone('Asia/Kolkata'))

                    try:
                        self._check_and_emit_trade_signal(self.nifty, today_str)
                    except Exception as e:
                        logger.debug(f"Signal check skipped for NIFTY: {e}")
                    try:
                        self._check_and_emit_volume_spike(self.nifty, today_str)
                    except Exception as e:
                        logger.debug(f"Volume spike check skipped for NIFTY: {e}")

                # --- Phase 3: Fetch BANKNIFTY options ---
                if spot_results.get("BANKNIFTY") and self.banknifty.option_symbols:
                    self.status = "Fetching BANKNIFTY options..."
                    opt_start = time.time()
                    self._fetch_and_store_options_data(self.banknifty, today_str, today_str)
                    logger.info(f"[BANKNIFTY] Options fetched in {time.time() - opt_start:.2f}s")
                    self.banknifty.last_update = datetime.now(pytz.timezone('Asia/Kolkata'))

                    try:
                        self._check_and_emit_trade_signal(self.banknifty, today_str)
                    except Exception as e:
                        logger.debug(f"Signal check skipped for BANKNIFTY: {e}")
                    try:
                        self._check_and_emit_volume_spike(self.banknifty, today_str)
                    except Exception as e:
                        logger.debug(f"Volume spike check skipped for BANKNIFTY: {e}")

                cycle_elapsed = time.time() - cycle_start
                last_ts = self.banknifty.last_update or self.nifty.last_update
                if last_ts:
                    self.status = f"Running - Last update: {last_ts.strftime('%H:%M:%S')}"
                else:
                    self.status = "Running"
                logger.info(f"Full fetch cycle (both instruments) completed in {cycle_elapsed:.2f}s")

                # --- MARKET CLOSE CHECK ---
                nfo_end_hour, nfo_end_min = 15, 40  # fallback
                try:
                    today_date = date_type.today()
                    timings = get_market_timings_for_date(today_date)
                    for t in timings:
                        if t.get('exchange') == 'NFO':
                            end_dt = datetime.fromtimestamp(t['end_time'] / 1000, tz=pytz.timezone('Asia/Kolkata'))
                            nfo_end_hour = end_dt.hour
                            nfo_end_min = end_dt.minute
                            break
                except Exception as e:
                    logger.debug(f"Could not fetch NFO timings for close check, using default 15:40: {e}")

                market_close_time = now.replace(hour=nfo_end_hour, minute=nfo_end_min, second=0, microsecond=0)

                if now > market_close_time:
                    nifty_ts = get_last_option_candle_timestamp_for_instrument('NIFTY')
                    banknifty_ts = get_last_option_candle_timestamp_for_instrument('BANKNIFTY')
                    both_done = True
                    for inst_ts, inst_name in [(nifty_ts, 'NIFTY'), (banknifty_ts, 'BANKNIFTY')]:
                        if inst_ts:
                            inst_dt = datetime.fromtimestamp(inst_ts)
                            if inst_dt.hour == nfo_end_hour and inst_dt.minute == nfo_end_min - 1:
                                logger.debug(f"[{inst_name}] Last candle ({nfo_end_hour}:{nfo_end_min - 1:02d}) fetched.")
                            else:
                                both_done = False
                        else:
                            both_done = False
                    if both_done:
                        logger.info(f"Market closed. Both NIFTY and BANKNIFTY last candles fetched. Stopping fetcher.")
                        self.is_running = False
                        self.status = "Stopped (Market Closed)"
                        self.stop_event.set()
                        break
                    else:
                        logger.debug(f"Market closed but waiting for all candles. NIFTY: {nifty_ts}, BANKNIFTY: {banknifty_ts}")

            except Exception as e:
                logger.error(f"Exception during incremental fetch: {e}")

# Create a single, global instance of the fetcher
nifty_fetcher = NiftyDataFetcher()
