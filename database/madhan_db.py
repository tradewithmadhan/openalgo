"""
Database setup and utility functions for MadhaN's custom data.
"""
import os
import re
import pandas as pd
from datetime import datetime, time, date, timedelta
from sqlalchemy import create_engine, Column, Integer, Float, String, Index, text, func, select, literal_column, and_, case
from sqlalchemy.inspection import inspect
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import SQLAlchemyError
from utils.logging import get_logger

from database.market_calendar_db import is_market_holiday
from typing import Optional


def get_valid_trading_day(
    input_date: Optional[date] = None,
    exchange: Optional[str] = None
) -> date:
    trading_date = input_date or date.today()

    while True:
        if trading_date.weekday() >= 5:
            trading_date -= timedelta(days=1)
            continue

        if is_market_holiday(trading_date, exchange):
            trading_date -= timedelta(days=1)
            continue

        return trading_date




logger = get_logger(__name__)

# Database setup
DATABASE_URL = os.getenv('DATABASE_URL', 'sqlite:///openalgo.db')

# Heuristic: If we are using the default URL (root), but db/openalgo.db exists,
# it implies we are likely running in a context where env vars weren't loaded yet
# but the project structure uses db/ folder.
if DATABASE_URL == 'sqlite:///openalgo.db' and os.path.exists(os.path.join('db', 'openalgo.db')):
     DATABASE_URL = 'sqlite:///db/openalgo.db'

# Create a new DB file in the same directory as the main DB
MADHAN_DB_PATH = os.path.join(os.path.dirname(DATABASE_URL.replace('sqlite:///', '')), 'madhan.db')
logger.info(f"Madhan DB initialized at: {MADHAN_DB_PATH} (DATABASE_URL: {DATABASE_URL})")
engine = create_engine(f'sqlite:///{MADHAN_DB_PATH}')
Base = declarative_base()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class NiftyData(Base):
    """SQLAlchemy model for storing Nifty 1-minute data."""
    __tablename__ = 'nifty_data'
    timestamp = Column(Integer, primary_key=True, unique=True, comment="Unix timestamp in seconds")
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)
    volume = Column(Integer)
    oi = Column(Integer)

class OptionData(Base):
    """SQLAlchemy model for storing Nifty options 1-minute data."""
    __tablename__ = 'option_data'
    id = Column(Integer, primary_key=True)
    timestamp = Column(Integer, nullable=False, comment="Unix timestamp in seconds")
    symbol = Column(String, nullable=False)
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)
    volume = Column(Integer)
    oi = Column(Integer)
    __table_args__ = (Index('idx_option_timestamp_symbol', 'timestamp', 'symbol', unique=True),)

class PreviousDayOI(Base):
    """SQLAlchemy model for storing previous day's closing OI and price."""
    __tablename__ = 'previous_day_oi'
    symbol = Column(String, primary_key=True, unique=True)
    oi = Column(Integer)
    close = Column(Float)
    timestamp = Column(Integer, comment="Unix timestamp in seconds")

class TrackedSymbol(Base):
    """SQLAlchemy model for storing tracked option symbols for Madhan's fetcher."""
    __tablename__ = 'madhan_tracked_symbols'
    symbol = Column(String, primary_key=True, unique=True)

class FetcherState(Base):
    """Stores key-value state for the Nifty fetcher to persist across restarts."""
    __tablename__ = 'madhan_fetcher_state'
    key = Column(String, primary_key=True, unique=True)
    value = Column(String)


def init_db():
    """Creates the database tables if they don't exist."""
    try:
        # This will create tables that don't exist.
        Base.metadata.create_all(bind=engine)
        logger.info("Madhan DB tables created or verified successfully.")
        
        # Manual check and add for 'oi' column in 'nifty_data'.
        # This is a simple migration for users who created the DB before this column was added.
        inspector = inspect(engine)
        if inspector.has_table('nifty_data'):
            nifty_columns = [c['name'] for c in inspector.get_columns('nifty_data')]
            if 'oi' not in nifty_columns:
                logger.warning("Column 'oi' not found in 'nifty_data' table. Adding it now.")
                with engine.connect() as connection:
                    # Using a transaction for safety
                    with connection.begin():
                        connection.execute(text('ALTER TABLE nifty_data ADD COLUMN oi INTEGER'))
                    logger.info("Column 'oi' added to 'nifty_data' table.")
    except Exception as e:
        logger.error(f"Error creating/updating Madhan DB tables: {e}")

def store_nifty_data(df: pd.DataFrame):
    """Efficiently upserts (inserts or updates) Nifty data into the database."""
    if df.empty:
        return

    session = SessionLocal()
    try:
        records = df.to_dict(orient='records')
        if not records:
            return

        stmt = insert(NiftyData).values(records)
        
        # On conflict (duplicate timestamp), update the existing row
        update_dict = {c.name: getattr(stmt.excluded, c.name) for c in NiftyData.__table__.columns if c.name != 'timestamp'}
        on_conflict_stmt = stmt.on_conflict_do_update(
            index_elements=['timestamp'],
            set_=update_dict
        )
        
        session.execute(on_conflict_stmt)
        session.commit()
        logger.info(f"Upserted {len(records)} Nifty data records.")
    except SQLAlchemyError as e:
        session.rollback()
        logger.error(f"Database error during Nifty data upsert: {e}")
    finally:
        session.close()

def store_option_data(df: pd.DataFrame):
    """Efficiently upserts (inserts or updates) Nifty options data into the database."""
    if df.empty:
        return

    session = SessionLocal()
    try:
        records = df.to_dict(orient='records')
        if not records:
            return

        stmt = insert(OptionData).values(records)
        
        # On conflict (duplicate timestamp and symbol), update the existing row
        update_dict = {
            c.name: getattr(stmt.excluded, c.name) 
            for c in OptionData.__table__.columns 
            if c.name not in ['id', 'timestamp', 'symbol']
        }
        on_conflict_stmt = stmt.on_conflict_do_update(
            index_elements=['timestamp', 'symbol'],
            set_=update_dict
        )
        
        session.execute(on_conflict_stmt)
        session.commit()
        logger.info(f"Upserted {len(records)} Option data records.")
    except SQLAlchemyError as e:
        session.rollback()
        logger.error(f"Database error during Option data upsert: {e}")
    finally:
        session.close()

def store_previous_day_oi(data: list):
    """Efficiently upserts previous day's OI data into the database."""
    if not data:
        return

    session = SessionLocal()
    try:
        # The data is a list of dicts
        stmt = insert(PreviousDayOI).values(data)
        
        # On conflict (duplicate symbol), update the existing row
        update_dict = {
            'oi': stmt.excluded.oi,
            'close': stmt.excluded.close,
            'timestamp': stmt.excluded.timestamp
        }
        on_conflict_stmt = stmt.on_conflict_do_update(
            index_elements=['symbol'],
            set_=update_dict
        )
        
        session.execute(on_conflict_stmt)
        session.commit()
        logger.info(f"Upserted {len(data)} previous day OI records.")
    except SQLAlchemyError as e:
        session.rollback()
        logger.error(f"Database error during previous day OI upsert: {e}")
    finally:
        session.close()

def get_tracked_symbols() -> list[str]:
    """Retrieves all tracked symbols from the database."""
    session = SessionLocal()
    try:
        results = session.query(TrackedSymbol.symbol).order_by(TrackedSymbol.symbol).all()
        symbols = [r[0] for r in results]
        logger.info(f"Loaded {len(symbols)} tracked symbols from the database.")
        return symbols
    except Exception as e:
        logger.error(f"Error fetching tracked symbols: {e}")
        return []
    finally:
        session.close()

def save_tracked_symbols(symbols: list[str]):
    """Clears and saves the list of tracked symbols to the database."""
    if not symbols:
        return
    session = SessionLocal()
    try:
        # Clear the existing table first
        session.query(TrackedSymbol).delete()
        
        # Prepare new records
        records = [{'symbol': s} for s in symbols]
        
        # Bulk insert the new symbols
        session.bulk_insert_mappings(TrackedSymbol, records)
        
        session.commit()
        logger.info(f"Saved {len(symbols)} tracked symbols to the database.")
    except SQLAlchemyError as e:
        session.rollback()
        logger.error(f"Database error during tracked symbols save: {e}")
    finally:
        session.close()

def clear_madhan_db():
    """Clears all data from tables in the Madhan database while preserving table schemas."""
    session = SessionLocal()
    try:
        # Clear data from all tables while preserving schemas
        session.query(NiftyData).delete()
        session.query(OptionData).delete()
        session.query(PreviousDayOI).delete()
        session.query(TrackedSymbol).delete()
        session.query(FetcherState).delete()
        
        session.commit()
        logger.info("Madhan DB data cleared successfully (table schemas preserved).")
    except SQLAlchemyError as e:
        session.rollback()
        logger.error(f"Database error clearing Madhan DB data: {e}")
    except Exception as e:
        session.rollback()
        logger.error(f"Error clearing Madhan DB data: {e}")
    finally:
        session.close()

def save_fetcher_state(key: str, value: any):
    """Saves a key-value state for the fetcher. The value will be converted to a string."""
    if not key or value is None:
        logger.warning(f"Attempted to save fetcher state with invalid key/value. Key: {key}")
        return

    session = SessionLocal()
    try:
        stmt = insert(FetcherState).values(key=key, value=str(value))
        on_conflict_stmt = stmt.on_conflict_do_update(
            index_elements=['key'],
            set_={'value': stmt.excluded.value}
        )
        session.execute(on_conflict_stmt)
        session.commit()
        logger.info(f"Saved fetcher state: {key} = {value}")
    except SQLAlchemyError as e:
        session.rollback()
        logger.error(f"Database error saving fetcher state for key {key}: {e}")
    finally:
        session.close()

def get_fetcher_state(key: str):
    """Retrieves a state value for the fetcher. Returns None if not found."""
    session = SessionLocal()
    try:
        result = session.query(FetcherState.value).filter(FetcherState.key == key).scalar()
        if result:
            logger.info(f"Retrieved fetcher state: {key} = {result}")
        else:
            logger.info(f"Fetcher state not found for key: {key}")
        return result
    except SQLAlchemyError as e:
        logger.error(f"Database error retrieving fetcher state for key {key}: {e}")
        return None
    finally:
        session.close()


def get_nifty_data(limit: int = 500, end_ts: int = None):
    """Retrieves Nifty data records, optionally up to end_ts."""
    session = SessionLocal()
    try:
        query = session.query(NiftyData)
        if end_ts:
            query = query.filter(NiftyData.timestamp <= end_ts)
        
        # Query and order by timestamp descending, then limit
        results = query.order_by(NiftyData.timestamp.desc()).limit(limit).all()
        # Reverse the results to get ascending order for display
        results.reverse()
        return [
            {'timestamp': r.timestamp, 'open': r.open, 'high': r.high, 'low': r.low, 'close': r.close, 'volume': r.volume, 'oi': r.oi}
            for r in results
        ]
    except Exception as e:
        logger.error(f"Error fetching Nifty data: {e}")
        return []
    finally:
        session.close()

def get_option_data(end_ts: int = None):
    """
    Retrieves the latest record, total count, and cumulative day volume for each tracked option symbol.
    If end_ts is provided, it returns the state as of that timestamp (Replay mode).
    """
    session = SessionLocal()
    try:
        from sqlalchemy.orm import aliased

        # Determine the start of the current trading day for volume summing
        today = get_valid_trading_day(exchange="NSE")
        start_of_day = datetime.combine(today, time.min)
        start_ts = int(start_of_day.timestamp())

        # Subquery to rank records and get count
        # For 'rn' (latest record), we only filter by end_ts if provided to maintain backward compatibility
        rn_filter = [OptionData.timestamp <= end_ts] if end_ts else []
        
        # For 'day_volume', we always want to sum from the start of the current day session
        vol_filter = [OptionData.timestamp >= start_ts]
        if end_ts:
            vol_filter.append(OptionData.timestamp <= end_ts)

        subq = (
            select(
                OptionData,
                func.row_number().over(
                    partition_by=OptionData.symbol,
                    order_by=OptionData.timestamp.desc()
                ).label('rn'),
                func.count(OptionData.id).over(
                    partition_by=OptionData.symbol
                ).label('candle_count'),
                # Only sum volume for rows that match the session window (start_ts to end_ts)
                func.sum(case((and_(*vol_filter), OptionData.volume), else_=0)).over(
                    partition_by=OptionData.symbol
                ).label('total_day_volume')
            ).filter(*rn_filter)
        ).subquery()

        option_data_alias = aliased(OptionData, subq)
        
        # Query for the latest record (rn=1) for each symbol
        results = session.query(option_data_alias, subq.c.candle_count, subq.c.total_day_volume).filter(subq.c.rn == 1).order_by(option_data_alias.symbol).all()

        return [
            {
                'timestamp': r.timestamp, 
                'symbol': r.symbol, 
                'open': r.open, 
                'high': r.high, 
                'low': r.low, 
                'close': r.close, 
                'volume': r.volume, 
                'day_volume': int(total_day_volume) if total_day_volume is not None else 0,
                'oi': r.oi, 
                'candle_count': candle_count
            }
            for r, candle_count, total_day_volume in results
        ]
    except Exception as e:
        logger.error(f"Error fetching Option data: {e}")
        return []
    finally:
        session.close()

def get_previous_day_oi():
    """
    Retrieves previous day OI records from the database.
    Filters for data belonging to the valid trading day immediately preceding the current trading day.
    """
    session = SessionLocal()
    try:
        # Determine the previous trading day
        current_trading_day = get_valid_trading_day(exchange="NSE")
        prev_trading_day = get_valid_trading_day(current_trading_day - timedelta(days=1), exchange="NSE")
        
        # Create timestamp range for that day
        start_of_day = datetime.combine(prev_trading_day, time.min)
        end_of_day = datetime.combine(prev_trading_day, time.max)
        
        start_ts = int(start_of_day.timestamp())
        end_ts = int(end_of_day.timestamp())

        logger.info(f"Fetching previous day OI for date: {prev_trading_day} (TS: {start_ts} to {end_ts})")

        # First, try to get data for the exact previous trading day
        results = session.query(PreviousDayOI).filter(
            PreviousDayOI.timestamp >= start_ts,
            PreviousDayOI.timestamp <= end_ts
        ).order_by(PreviousDayOI.symbol).all()

        if results:
            logger.info(f"Found {len(results)} records for the correct date.")
            return [
                {'symbol': r.symbol, 'oi': r.oi, 'close': r.close, 'timestamp': r.timestamp}
                for r in results
            ]
        
        # Fallback: If no data for the exact date, return whatever is in the table (likely stale data)
        # This prevents the UI from breaking if the fetcher missed a day or calculated the wrong date.
        logger.warning(f"No data found for {prev_trading_day}. Falling back to latest available data in table.")
        results = session.query(PreviousDayOI).order_by(PreviousDayOI.symbol).all()
        
        return [
            {'symbol': r.symbol, 'oi': r.oi, 'close': r.close, 'timestamp': r.timestamp}
            for r in results
        ]
    except Exception as e:
        logger.error(f"Error fetching previous day OI data: {e}")
        return []
    finally:
        session.close()

def get_nifty_data_count():
    """Retrieves the total count of Nifty data records."""
    session = SessionLocal()
    try:
        count = session.query(func.count(NiftyData.timestamp)).scalar()
        return count or 0
    except Exception as e:
        logger.error(f"Error counting Nifty data: {e}")
        return 0
    finally:
        session.close()

def get_nth_candle_oi_for_all_symbols(n: int):
    """
    For the current day, gets the OI of the Nth candle for all tracked symbols.
    """
    session = SessionLocal()
    try:
        today = get_valid_trading_day(exchange="NSE")
        start_of_day = datetime.combine(today, time.min)
        start_of_day_ts = int(start_of_day.timestamp())

        # Subquery for NiftyData
        nifty_subq = (
            select(
                literal_column("'NIFTY'").label("symbol"),
                func.coalesce(NiftyData.oi, 0).label('oi'),
                func.row_number().over(
                    order_by=NiftyData.timestamp.asc()
                ).label('rn')
            ).filter(
                NiftyData.timestamp >= start_of_day_ts
            ).subquery()
        )
        nth_nifty_candle = session.query(nifty_subq).filter(nifty_subq.c.rn == n).all()

        # Subquery for OptionData
        option_subq = (
            select(
                OptionData.symbol,
                func.coalesce(OptionData.oi, 0).label('oi'),
                func.row_number().over(
                    partition_by=OptionData.symbol,
                    order_by=OptionData.timestamp.asc()
                ).label('rn')
            ).filter(
                OptionData.timestamp >= start_of_day_ts
            ).subquery()
        )
        nth_option_candles = session.query(option_subq).filter(option_subq.c.rn == n).all()

        # Combine results into a dictionary
        oi_map = {row.symbol: row.oi for row in nth_nifty_candle}
        oi_map.update({row.symbol: row.oi for row in nth_option_candles})

        return oi_map

    except Exception as e:
        # Improved error logging with ordinal suffix and full traceback
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') if n % 100 not in (11, 12, 13) else 'th'
        logger.error(f"Error fetching {n}{suffix} candle OI: {e}", exc_info=True)
        return {}
    finally:
        session.close()

def get_current_day_historical_data(end_ts: int = None):
    """Fetches all 1-minute candle data for the current day for Nifty and Options, optionally up to end_ts."""
    session = SessionLocal()
    try:
        today = get_valid_trading_day(exchange="NSE")
        start_of_day = datetime.combine(today, time.min)
        start_of_day_ts = int(start_of_day.timestamp())

        nifty_filter = [NiftyData.timestamp >= start_of_day_ts]
        option_filter = [OptionData.timestamp >= start_of_day_ts]
        if end_ts:
            nifty_filter.append(NiftyData.timestamp <= end_ts)
            option_filter.append(OptionData.timestamp <= end_ts)

        nifty_data_query = session.query(
            literal_column("'NIFTY'").label("symbol"),
            NiftyData.timestamp,
            func.coalesce(NiftyData.oi, 0).label("oi"),
            NiftyData.close,
            func.coalesce(NiftyData.volume, 0).label("volume"),
        ).filter(*nifty_filter)
        nifty_data = nifty_data_query.all()
        option_data = session.query(
            OptionData.symbol,
            OptionData.timestamp,
            func.coalesce(OptionData.oi, 0).label("oi"),
            OptionData.close,
            func.coalesce(OptionData.volume, 0).label("volume"),
        ).filter(*option_filter).all()

        combined_data = [row._asdict() for row in nifty_data] + [row._asdict() for row in option_data]
        
        return combined_data

    except Exception as e:
        logger.error(f"Error fetching current day historical data: {e}", exc_info=True)
        return []
    finally:
        session.close()

def get_current_day_instrument_data(symbol: str):
    """Fetches all 1-minute candle data for the current day for a specific instrument/symbol."""
    session = SessionLocal()
    try:
        today = get_valid_trading_day(exchange="NSE")
        start_of_day = datetime.combine(today, time.min)
        start_of_day_ts = int(start_of_day.timestamp())

        if symbol == 'NIFTY':
            # Query Nifty data
            nifty_data = session.query(
                NiftyData.timestamp,
                NiftyData.open,
                NiftyData.high,
                NiftyData.low,
                NiftyData.close,
                NiftyData.volume,
                func.coalesce(NiftyData.oi, 0).label('oi')
            ).filter(
                NiftyData.timestamp >= start_of_day_ts
            ).order_by(NiftyData.timestamp.asc()).all()
            
            return [row._asdict() for row in nifty_data]
        else:
            # Query Option data for the specific symbol
            option_data = session.query(
                OptionData.timestamp,
                OptionData.open,
                OptionData.high,
                OptionData.low,
                OptionData.close,
                OptionData.volume,
                func.coalesce(OptionData.oi, 0).label('oi')
            ).filter(
                OptionData.symbol == symbol,
                OptionData.timestamp >= start_of_day_ts
            ).order_by(OptionData.timestamp.asc()).all()
            
            return [row._asdict() for row in option_data]

    except Exception as e:
        logger.error(f"Error fetching current day instrument data for {symbol}: {e}", exc_info=True)
        return []
    finally:
        session.close()


def extract_strike(symbol: str) -> int | None:
    m = re.search(r'(\d+)(CE|PE)$', symbol)
    if not m:
        return None
    tail = m.group(1)
    candidates = []
    if len(tail) >= 6:
        candidates.append(int(tail[-6:]))
    if len(tail) >= 5:
        candidates.append(int(tail[-5:]))
    for cand in candidates:
        if 10000 <= cand <= 100000 and cand % 50 == 0:
            return cand
    return int(tail[-5:]) if len(tail) >= 5 else None


def get_coi_history(days: int = 30):
    """
    Returns daily COI (Change in OI) history for all tracked option symbols.
    Uses ROW_NUMBER() partitioned by symbol+date to get last candle OI per day,
    same pattern as get_option_data().
    
    COI for a day = end-of-day OI - previous day's end-of-day OI.
    """
    from datetime import timezone as tz
    from sqlalchemy.orm import aliased
    IST = tz(timedelta(hours=5, minutes=30))

    session = SessionLocal()
    try:
        today = get_valid_trading_day(exchange="NSE")
        lookback = today - timedelta(days=days * 2)
        start_ts = int(datetime.combine(lookback, time.min).timestamp())
        end_ts = int(datetime.combine(today, time.max).timestamp())

        # Use ROW_NUMBER() to get last candle per symbol per day — same pattern as get_option_data()
        # SQLite datetime() converts Unix timestamp (seconds) to datetime string
        subq = (
            select(
                OptionData.symbol,
                OptionData.timestamp,
                OptionData.oi,
                # Extract date from Unix timestamp using SQLite datetime function
                func.date(func.datetime(OptionData.timestamp, 'unixepoch', '+5 hours', '+30 minutes')).label('day'),
                func.row_number().over(
                    partition_by=[OptionData.symbol, func.date(func.datetime(OptionData.timestamp, 'unixepoch', '+5 hours', '+30 minutes'))],
                    order_by=OptionData.timestamp.desc()
                ).label('rn'),
            ).filter(
                OptionData.timestamp >= start_ts,
                OptionData.timestamp <= end_ts,
            )
        ).subquery()

        rows = session.query(
            subq.c.symbol,
            subq.c.day,
            subq.c.oi,
        ).filter(subq.c.rn == 1).all()

        logger.info(f"COI history: got {len(rows)} last-candle-per-symbol-per-day rows")
        if not rows:
            return {}

        # Group by date -> {strike: {ceOI, peOI}}
        from collections import defaultdict
        day_strikes = defaultdict(lambda: defaultdict(lambda: {'ceOI': 0, 'peOI': 0}))
        all_dates = set()

        for sym, day, oi in rows:
            if not sym or not day or oi is None:
                continue
            all_dates.add(day)
            strike = extract_strike(sym)
            if strike is None:
                continue
            if sym.endswith('CE'):
                day_strikes[day][strike]['ceOI'] = oi
            elif sym.endswith('PE'):
                day_strikes[day][strike]['peOI'] = oi

        sorted_dates = sorted(all_dates)
        logger.info(f"COI history: {len(sorted_dates)} dates: {sorted_dates}")

        if len(sorted_dates) < 2:
            return {}

        # COI = today - yesterday
        coi_by_date = {}
        today_str = today.strftime('%Y-%m-%d')
        for i in range(1, len(sorted_dates)):
            today_d = sorted_dates[i]
            prev_d = sorted_dates[i - 1]
            strikes_map = {}
            for strike in sorted(set(list(day_strikes[today_d].keys()) + list(day_strikes[prev_d].keys()))):
                today_ce = day_strikes[today_d].get(strike, {}).get('ceOI', 0)
                prev_ce = day_strikes[prev_d].get(strike, {}).get('ceOI', 0)
                today_pe = day_strikes[today_d].get(strike, {}).get('peOI', 0)
                prev_pe = day_strikes[prev_d].get(strike, {}).get('peOI', 0)
                ce_coi = today_ce - prev_ce
                pe_coi = today_pe - prev_pe
                if ce_coi != 0 or pe_coi != 0:
                    strikes_map[strike] = {'price': strike, 'ceOI': ce_coi, 'peOI': pe_coi}
            # Skip current day — already shown by the live COI panel
            if today_d != today_str and strikes_map:
                coi_by_date[today_d] = [strikes_map[s] for s in sorted(strikes_map.keys())]

        return coi_by_date

    except Exception as e:
        logger.error(f"Error fetching COI history: {e}", exc_info=True)
        return {}
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Backtest helpers — read parquet files from db/options_data/
# ---------------------------------------------------------------------------

import pytz as _pytz

# Parquet data directory (relative to project root)
_BACKTEST_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'options_data')

# Strategy registry — add new strategies here.
# Each strategy maps to a signal_key from get_backtest_signals().
STRATEGY_REGISTRY = {
    'CE-PE': {
        'signal_key': 'ce_pe_hc',
        'description': 'CE/PE extrinsic signal with HC filter',
    },
    'CP': {
        'signal_key': 'cp_open',
        'description': 'Combined extrinsic signal with IR filter',
    },
}

# Derived from registry — backward compatible
STRATEGIES = list(STRATEGY_REGISTRY.keys())


def get_lot_size(unix_ts: int) -> int:
    """Returns historical lot size based on date. Matches live system values."""
    IST = _pytz.timezone('Asia/Kolkata')
    dt = datetime.fromtimestamp(unix_ts, tz=IST).date()
    if dt >= date(2026, 1, 1):
        return 65
    if dt >= date(2024, 11, 1):
        return 75
    if dt >= date(2024, 4, 1):
        return 25
    if dt >= date(2015, 10, 1):
        return 75
    if dt >= date(2014, 10, 1):
        return 25
    if dt >= date(2007, 2, 1):
        return 50
    return 50


def _parquet_path(date_str: str) -> str:
    """Returns the expected parquet file path for a given date string (YYYY-MM-DD)."""
    return os.path.join(_BACKTEST_DATA_DIR, f'{date_str}-index-nfo-data.parquet')


def get_backtest_available_dates() -> list[str]:
    """Scans the parquet data directory and returns sorted list of available dates.
    Extracts date from filenames like '2025-11-04-index-nfo-data.parquet'."""
    if not os.path.isdir(_BACKTEST_DATA_DIR):
        return []
    dates = []
    for f in os.listdir(_BACKTEST_DATA_DIR):
        if f.endswith('-index-nfo-data.parquet'):
            d = f.replace('-index-nfo-data.parquet', '')
            # Validate date format
            try:
                datetime.strptime(d, '%Y-%m-%d')
                dates.append(d)
            except ValueError:
                continue
    return sorted(dates)


def get_backtest_day_data(date_str: str) -> dict | None:
    """Reads a parquet file for the given date and returns pre-processed data.

    Returns None if file not found.  Result dict contains:
        - spot_data: list[dict] — NIFTY 50 SPOT 1-min candles (timestamp, open, high, low, close, volume)
        - options_df: DataFrame — all NIFTY CE/PE options for the day
        - open_atm: int — round(NIFTY_50_SPOT_first_candle_open / 50) * 50
        - expiry: datetime.date — nearest expiry (>= date, skip same-day expiry)
        - expiry_str: str — expiry formatted for symbol like '25N04' (Nov 4 weekly)
        - spot_lookup: dict[int, float] — {timestamp: close} for intrinsic/extrinsic calc

    Matches live system logic:
        - Open ATM: nifty_fetch_service.py:236 (first candle OPEN, not close)
        - Expiry selection: nifty_fetch_service.py:256 (skip same-day expiry)
    """
    path = _parquet_path(date_str)
    if not os.path.exists(path):
        return None

    df = pd.read_parquet(path)

    # Safety: skip parquet files missing required columns
    required_cols = {'name', 'instrument_type', 'strike', 'expiry', 'date'}
    if not required_cols.issubset(df.columns):
        return None

    # --- NIFTY 50 SPOT data (instrument_type='SPOT', name='NIFTY 50') ---
    spot = df[(df['name'] == 'NIFTY 50') & (df['instrument_type'] == 'SPOT')].copy()
    spot = spot.sort_values('date')
    if spot.empty:
        return None

    # Convert datetime to unix timestamp (seconds) for consistency with live system
    ist_tz = _pytz.timezone('Asia/Kolkata')
    spot['timestamp'] = spot['date'].apply(lambda d: int(d.timestamp()))

    spot_data = spot[['timestamp', 'open', 'high', 'low', 'close', 'volume']].to_dict('records')

    # --- Open ATM: first candle OPEN rounded to nearest 50 ---
    # Matches nifty_fetch_service.py:236 — open_price = today_df['open'].iloc[0]
    open_price = float(spot.iloc[0]['open'])
    open_atm = round(open_price / 50) * 50

    # --- Nearest expiry: first expiry >= date, skip same-day expiry ---
    # Matches nifty_fetch_service.py:256 — if current date == expiry, use next
    nifty_opts = df[(df['name'] == 'NIFTY') & (df['instrument_type'].isin(['CE', 'PE']))].copy()
    all_expiries = sorted(nifty_opts['expiry'].dropna().unique())
    selected_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    nearest_expiry = None
    for exp in all_expiries:
        if exp >= selected_date:
            if exp == selected_date and all_expiries.index(exp) < len(all_expiries) - 1:
                # On expiry day — skip to next expiry (matches live behavior)
                continue
            nearest_expiry = exp
            break

    if nearest_expiry is None and all_expiries:
        nearest_expiry = all_expiries[-1]

    if nearest_expiry is None:
        return None

    # Filter options to nearest expiry only
    nifty_opts = nifty_opts[nifty_opts['expiry'] == nearest_expiry].copy()

    # Build spot_lookup: {unix_timestamp: close} for intrinsic/extrinsic calculations
    spot_lookup = {int(row['timestamp']): float(row['close']) for _, row in spot.iterrows()}

    # Format expiry for symbol matching (e.g., 2025-11-04 -> '25N04' for weekly, '25DEC' for monthly)
    # We store the actual expiry date and let callers match by expiry column
    expiry_str = nearest_expiry.strftime('%d%b%y').upper()

    return {
        'spot_data': spot_data,
        'options_df': nifty_opts,
        'open_atm': int(open_atm),
        'expiry': nearest_expiry,
        'expiry_str': expiry_str,
        'spot_lookup': spot_lookup,
    }


def get_backtest_strikes(date_str: str) -> dict | None:
    """Returns strike list for backtest — 10 above and 10 below Open ATM.

    Matches live system pattern (nifty_fetch_service.py:268):
        strikes = [open_atm + (i * 50)] for i in range(-10, 11)
        = 21 strikes total, 42 symbols (CE + PE each)

    Returns None if parquet file not found.
    Response format matches /api/strikes:
        { status, data: [strikes], strikes_data: {...}, symbols_map: {...} }
    """
    day = get_backtest_day_data(date_str)
    if day is None:
        return None

    open_atm = day['open_atm']
    expiry = day['expiry']
    options_df = day['options_df']
    expiry_str = expiry.strftime('%d%b%y').upper()

    # Generate 21 strikes: open_atm ± 10 × 50
    strikes = [open_atm + (i * 50) for i in range(-10, 11)]

    # Build strikes_data and symbols_map matching live /api/strikes format
    strikes_data = {}
    symbols_map = {}

    for strike in strikes:
        # Find CE and PE symbols for this strike from parquet data
        ce_rows = options_df[(options_df['strike'] == strike) & (options_df['instrument_type'] == 'CE')]
        pe_rows = options_df[(options_df['strike'] == strike) & (options_df['instrument_type'] == 'PE')]

        ce_symbol = ce_rows['symbol'].iloc[0] if not ce_rows.empty else None
        pe_symbol = pe_rows['symbol'].iloc[0] if not pe_rows.empty else None

        strikes_data[strike] = {'ce_symbol': ce_symbol, 'pe_symbol': pe_symbol}

        if ce_symbol:
            symbols_map[f'{strike}_CE'] = {
                'symbol': ce_symbol, 'exchange': 'NFO', 'strike': strike, 'type': 'CE',
            }
        if pe_symbol:
            symbols_map[f'{strike}_PE'] = {
                'symbol': pe_symbol, 'exchange': 'NFO', 'strike': strike, 'type': 'PE',
            }

    return {
        'status': 'success',
        'data': strikes,
        'strikes_data': strikes_data,
        'symbols_map': symbols_map,
        'open_atm': open_atm,
        'expiry': expiry_str,
    }


def _format_backtest_chart_enhanced(rows: list[dict], option_type: str, strike_price: int, spot_lookup: dict) -> list[dict]:
    """Formats parquet option rows into enhanced chart data with intrinsic/extrinsic/signals.

    Mirrors the logic of format_chart_data_enhanced() in blueprints/madhan.py:1548.
    Input rows should already be sorted by timestamp ascending.
    """
    ist_tz = _pytz.timezone('Asia/Kolkata')
    enhanced = []

    for i, item in enumerate(rows):
        if item['open'] is None or item['close'] is None:
            continue

        # Convert unix timestamp to IST (parquet date is already IST-aware, but we use timestamp)
        utc_dt = datetime.fromtimestamp(item['timestamp'], tz=_pytz.UTC)
        ist_dt = utc_dt.astimezone(ist_tz)
        ist_timestamp = int(ist_dt.timestamp())

        # Get corresponding spot price for this candle
        spot_close = spot_lookup.get(item['timestamp'], 0)

        # Intrinsic / extrinsic — same as live ezayChart_data:1565
        if option_type == 'CE':
            intrinsic = max(spot_close - strike_price, 0)
        else:
            intrinsic = max(strike_price - spot_close, 0)
        extrinsic = item['close'] - intrinsic

        # Signal detection — same as live ezayChart_data:1579
        extrinsic_signal = False
        if i > 0:
            prev_item = rows[i - 1]
            prev_spot_close = spot_lookup.get(prev_item['timestamp'], 0)
            if option_type == 'CE':
                prev_intrinsic = max(prev_spot_close - strike_price, 0)
            else:
                prev_intrinsic = max(strike_price - prev_spot_close, 0)
            prev_extrinsic = prev_item['close'] - prev_intrinsic

            condition1 = (prev_item['low'] is not None and prev_item['low'] < prev_extrinsic and item['close'] > extrinsic)
            condition2 = (item['low'] is not None and item['low'] < extrinsic and item['close'] > extrinsic)

            if condition1 or condition2:
                prev_had_signal = enhanced[-1].get('extrinsic_signal', False) if enhanced else False
                if not prev_had_signal:
                    extrinsic_signal = True

        enhanced.append({
            'time': ist_timestamp,
            'open': round(item['open'], 2),
            'high': round(item['high'], 2),
            'low': round(item['low'], 2),
            'close': round(item['close'], 2),
            'volume': item['volume'],
            'intrinsic': round(intrinsic, 2),
            'extrinsic': round(extrinsic, 2),
            'extrinsic_signal': extrinsic_signal,
        })

    return enhanced


def _run_backtest_trades(
    strategy: str,
    ce_data: list[dict],
    pe_data: list[dict],
    combined_data: list[dict],
    date_str: str,
    expiry_str: str,
    ce_symbol: str,
    pe_symbol: str,
    strike_price: int,
) -> tuple[list[dict], dict | None]:
    """Run backtest trade simulation for a single strategy.

    Returns (trades_list, summary_dict).
    Each trade: { strategy, date, strike, symbol, expiry, side, entryTime, entryPrice,
                  exitTime, exitPrice, pnlPct, pnlAmount, lotSize, exitReason, maxRunupPct }
    """
    ce_by_time = {item['time']: item for item in ce_data}
    pe_by_time = {item['time']: item for item in pe_data}
    pe_close_map = {item['time']: item['close'] for item in pe_data}

    trades: list[dict] = []
    state = 'idle'  # idle | pending | in_position
    side = 'CE'
    pending_entry_price = 0
    entry_time = 0
    entry_price = 0
    target_hit = False
    max_high = 0

    def _emit_trade(t, entry_t, entry_p, exit_t, exit_p, reason):
        pnl_pct = ((exit_p - entry_p) / entry_p) * 100 if entry_p > 0 else 0
        lot = get_lot_size(t)
        pnl_amount = (exit_p - entry_p) * lot
        max_runup = ((max_high - entry_p) / entry_p) * 100 if entry_p > 0 else 0
        symbol = ce_symbol if side == 'CE' else pe_symbol
        trades.append({
            'strategy': strategy,
            'date': date_str,
            'strike': strike_price,
            'symbol': symbol,
            'expiry': expiry_str,
            'side': side,
            'entryTime': entry_t,
            'entryPrice': entry_p,
            'exitTime': t,
            'exitPrice': exit_p,
            'pnlPct': round(pnl_pct, 2),
            'pnlAmount': round(pnl_amount, 2),
            'lotSize': lot,
            'exitReason': reason,
            'maxRunupPct': round(max_runup, 2),
        })

    for comb in combined_data:
        t = comb['time']
        ce = ce_by_time.get(t)
        pe = pe_by_time.get(t)
        if not ce or not pe:
            continue
        if target_hit:
            continue

        if state == 'in_position':
            opt_high = ce['high'] if side == 'CE' else pe['high']
            if opt_high > max_high:
                max_high = opt_high

            exit_price = 0
            exit_reason = 'eod'

            if strategy == 'CE-PE':
                if side == 'CE' and ce['high'] >= comb['combined_extrinsic']:
                    exit_price = ce['close']
                    exit_reason = 'target'
                elif side == 'PE' and pe['high'] >= comb['combined_extrinsic']:
                    exit_price = pe['close']
                    exit_reason = 'target'
                elif side == 'CE' and pe.get('extrinsic_signal'):
                    exit_price = ce['close']
                    exit_reason = 'opposite'
                elif side == 'PE' and ce.get('extrinsic_signal'):
                    exit_price = pe['close']
                    exit_reason = 'opposite'

            elif strategy == 'CP':
                opt_close = ce['close'] if side == 'CE' else pe['close']
                llp_val = comb.get('llp', 0)
                if opt_high >= llp_val and llp_val > 0:
                    exit_price = opt_close
                    exit_reason = 'target'
                elif opt_close < comb['combined_extrinsic']:
                    exit_price = opt_close
                    exit_reason = 'opposite'

            if exit_price > 0:
                _emit_trade(t, entry_time, entry_price, t, exit_price, exit_reason)
                state = 'idle'
                if exit_reason == 'target':
                    target_hit = True

        elif state == 'pending':
            current_high = ce['high'] if side == 'CE' else pe['high']
            if current_high >= pending_entry_price:
                state = 'in_position'
                entry_time = t
                entry_price = pending_entry_price
                max_high = current_high

                # Fill-candle exit check
                exit_price = 0
                exit_reason = 'eod'

                if strategy == 'CE-PE':
                    if side == 'CE' and ce['high'] >= comb['combined_extrinsic']:
                        exit_price = ce['close']
                        exit_reason = 'target'
                    elif side == 'PE' and pe['high'] >= comb['combined_extrinsic']:
                        exit_price = pe['close']
                        exit_reason = 'target'
                    elif side == 'CE' and pe.get('extrinsic_signal'):
                        exit_price = ce['close']
                        exit_reason = 'opposite'
                    elif side == 'PE' and ce.get('extrinsic_signal'):
                        exit_price = pe['close']
                        exit_reason = 'opposite'

                elif strategy == 'CP':
                    opt_close = ce['close'] if side == 'CE' else pe['close']
                    llp_val = comb.get('llp', 0)
                    if current_high >= llp_val and llp_val > 0:
                        exit_price = opt_close
                        exit_reason = 'target'
                    elif opt_close < comb['combined_extrinsic']:
                        exit_price = opt_close
                        exit_reason = 'opposite'

                if exit_price > 0:
                    _emit_trade(t, entry_time, entry_price, t, exit_price, exit_reason)
                    state = 'idle'
                    if exit_reason == 'target':
                        target_hit = True
            else:
                same_side = ce.get('extrinsic_signal') if side == 'CE' else pe.get('extrinsic_signal')
                if same_side:
                    pending_entry_price = current_high + 1
                opposite = pe.get('extrinsic_signal') if side == 'CE' else ce.get('extrinsic_signal')
                if opposite:
                    state = 'idle'

        if state == 'idle' and not target_hit:
            if strategy == 'CE-PE':
                if ce.get('extrinsic_signal') and ce['close'] > pe_close_map.get(t, 0):
                    state = 'pending'
                    side = 'CE'
                    pending_entry_price = ce['high'] + 1
                elif pe.get('extrinsic_signal') and pe['close'] > ce['close']:
                    state = 'pending'
                    side = 'PE'
                    pending_entry_price = pe['high'] + 1
            elif strategy == 'CP':
                if comb.get('combined_extrinsic_signal'):
                    if ce['close'] > pe['close']:
                        state = 'pending'
                        side = 'CE'
                        pending_entry_price = ce['high'] + 1
                    elif pe['close'] > ce['close']:
                        state = 'pending'
                        side = 'PE'
                        pending_entry_price = pe['high'] + 1

    # EOD exit if still in position
    if state == 'in_position' and combined_data:
        last = combined_data[-1]
        last_t = last['time']
        last_ce = ce_by_time.get(last_t)
        last_pe = pe_by_time.get(last_t)
        last_price = (last_ce['close'] if side == 'CE' else (last_pe['close'] if last_pe else entry_price)) or entry_price
        _emit_trade(last_t, entry_time, entry_price, last_t, last_price, 'eod')

    # Summary
    summary = None
    if trades:
        wins = sum(1 for tr in trades if tr['pnlPct'] > 0)
        summary = {
            'total': len(trades),
            'wins': wins,
            'losses': len(trades) - wins,
            'winRate': round((wins / len(trades)) * 100, 1),
            'totalPnl': round(sum(tr['pnlPct'] for tr in trades), 2),
            'totalPnlAmount': round(sum(tr['pnlAmount'] for tr in trades), 2),
        }

    return trades, summary


def get_backtest_chart_data(date_str: str, strike_price: int) -> dict | None:
    """Returns chart data for a specific strike from parquet — same format as /api/ezayChart_data.

    Response format:
        {
          status, data: {
            strike, ce_symbol, pe_symbol,
            ce_data: [...], pe_data: [...], combined_data: [...],
            llp, timezone
          }
        }
    """
    day = get_backtest_day_data(date_str)
    if day is None:
        return None

    options_df = day['options_df']
    spot_lookup = day['spot_lookup']
    spot_data = day['spot_data']

    # Find CE and PE symbols for the requested strike
    ce_rows = options_df[(options_df['strike'] == strike_price) & (options_df['instrument_type'] == 'CE')]
    pe_rows = options_df[(options_df['strike'] == strike_price) & (options_df['instrument_type'] == 'PE')]

    ce_symbol = ce_rows['symbol'].iloc[0] if not ce_rows.empty else None
    pe_symbol = pe_rows['symbol'].iloc[0] if not pe_rows.empty else None

    if not ce_symbol and not pe_symbol:
        return None

    # Convert parquet rows to list-of-dicts sorted by timestamp
    def df_to_rows(df_slice):
        if df_slice.empty:
            return []
        df_sorted = df_slice.sort_values('date')
        df_sorted['timestamp'] = df_sorted['date'].apply(lambda d: int(d.timestamp()))
        return df_sorted[['timestamp', 'open', 'high', 'low', 'close', 'volume']].to_dict('records')

    ce_raw = df_to_rows(ce_rows)
    pe_raw = df_to_rows(pe_rows)

    # Format enhanced data — mirrors blueprints/madhan.py:1622
    formatted_ce = _format_backtest_chart_enhanced(ce_raw, 'CE', strike_price, spot_lookup) if ce_raw else []
    formatted_pe = _format_backtest_chart_enhanced(pe_raw, 'PE', strike_price, spot_lookup) if pe_raw else []

    # Build combined data — mirrors blueprints/madhan.py:1626-1698
    combined_data = []
    running_llp = None

    if formatted_ce and formatted_pe:
        ce_dict = {item['time']: item for item in formatted_ce}
        pe_dict = {item['time']: item for item in formatted_pe}
        common_timestamps = sorted(set(ce_dict.keys()) & set(pe_dict.keys()))

        for i, ts in enumerate(common_timestamps):
            ce_item = ce_dict[ts]
            pe_item = pe_dict[ts]

            open_combined_premium = ce_item['open'] + pe_item['open']
            combined_premium = ce_item['close'] + pe_item['close']
            combined_extrinsic = ce_item['extrinsic'] + pe_item['extrinsic']

            # Combined Extrinsic signal — mirrors blueprints/madhan.py:1646-1662
            combined_extrinsic_signal = False
            if i > 0:
                prev_ts = common_timestamps[i - 1]
                prev_ce = ce_dict[prev_ts]
                prev_pe = pe_dict[prev_ts]
                prev_combined_ext = prev_ce['extrinsic'] + prev_pe['extrinsic']

                ce_c1 = prev_ce['low'] < prev_combined_ext and ce_item['close'] > combined_extrinsic and ce_item['close'] > pe_item['close']
                ce_c2 = ce_item['low'] < combined_extrinsic and ce_item['close'] > combined_extrinsic and ce_item['close'] > pe_item['close']
                pe_c1 = prev_pe['low'] < prev_combined_ext and pe_item['close'] > combined_extrinsic and pe_item['close'] > ce_item['close']
                pe_c2 = pe_item['low'] < combined_extrinsic and pe_item['close'] > combined_extrinsic and pe_item['close'] > ce_item['close']

                if ce_c1 or ce_c2 or pe_c1 or pe_c2:
                    prev_had = combined_data[-1].get('combined_extrinsic_signal', False) if combined_data else False
                    if not prev_had:
                        combined_extrinsic_signal = True

            # CP_CE signal — mirrors blueprints/madhan.py:1664-1668
            cp_ce_signal = False
            if (ce_item.get('extrinsic_signal') or pe_item.get('extrinsic_signal')) and combined_extrinsic > 0:
                tolerance = combined_extrinsic * 0.01
                if abs(combined_premium - combined_extrinsic) <= tolerance:
                    cp_ce_signal = True

            combined_volume = (ce_item.get('volume') or 0) + (pe_item.get('volume') or 0)

            combined_data.append({
                'time': ts,
                'open_combined_premium': round(open_combined_premium, 2),
                'combined_premium': round(combined_premium, 2),
                'combined_extrinsic': round(combined_extrinsic, 2),
                'ce_intrinsic': round(ce_item['intrinsic'], 2),
                'pe_intrinsic': round(pe_item['intrinsic'], 2),
                'ce_extrinsic': round(ce_item['extrinsic'], 2),
                'pe_extrinsic': round(pe_item['extrinsic'], 2),
                'spot_close': round(spot_lookup.get(ts, 0), 2),
                'combined_volume': combined_volume,
                'combined_extrinsic_signal': combined_extrinsic_signal,
                'ce_extrinsic_signal': ce_item.get('extrinsic_signal', False),
                'pe_extrinsic_signal': pe_item.get('extrinsic_signal', False),
                'cp_ce_signal': cp_ce_signal,
            })

    # Running LLP — mirrors blueprints/madhan.py:1691-1697
    for item in combined_data:
        cp = item['combined_premium']
        if running_llp is None or cp < running_llp:
            running_llp = cp
        item['llp'] = round(running_llp, 2)

    expiry_str_fmt = day['expiry'].strftime('%Y-%m-%d') if day.get('expiry') else ''

    all_trades = {}
    all_summaries = {}
    for strat in STRATEGIES:
        trades, summ = _run_backtest_trades(
            strat, formatted_ce, formatted_pe, combined_data,
            date_str, expiry_str_fmt, ce_symbol or '', pe_symbol or '', strike_price,
        )
        all_trades[strat] = trades
        if summ:
            all_summaries[strat] = summ

    return {
        'strike': strike_price,
        'ce_symbol': ce_symbol,
        'pe_symbol': pe_symbol,
        'ce_data': formatted_ce,
        'pe_data': formatted_pe,
        'combined_data': combined_data,
        'llp': round(running_llp, 2) if running_llp is not None else 0,
        'timezone': 'Asia/Kolkata',
        'trades': all_trades,
        'summary': all_summaries,
        'strategies': STRATEGIES,
    }


def get_backtest_signals(date_str: str) -> dict | None:
    """Returns all-strike signals for a backtest date — same format as /api/ezayChart_signals.

    Only processes 10 strikes above and 10 below Open ATM (21 strikes).
    Response format: { status, last_time, data: [{ time, strike, ce_signal, pe_signal, cp_signal, cp_ce_signal, ce_close, pe_close }] }
    """
    day = get_backtest_day_data(date_str)
    if day is None:
        return None

    open_atm = day['open_atm']
    options_df = day['options_df']
    spot_lookup = day['spot_lookup']
    ist_tz = _pytz.timezone('Asia/Kolkata')

    strikes = [open_atm + (i * 50) for i in range(-10, 11)]
    all_signals = []
    last_data_time = 0
    first_candle_per_strike = {}

    for strike_price in strikes:
        # Find CE and PE for this strike
        ce_rows = options_df[(options_df['strike'] == strike_price) & (options_df['instrument_type'] == 'CE')]
        pe_rows = options_df[(options_df['strike'] == strike_price) & (options_df['instrument_type'] == 'PE')]

        if ce_rows.empty or pe_rows.empty:
            continue

        # Convert to sorted row dicts
        def to_rows(df_slice):
            df_sorted = df_slice.sort_values('date')
            df_sorted['timestamp'] = df_sorted['date'].apply(lambda d: int(d.timestamp()))
            return df_sorted[['timestamp', 'open', 'high', 'low', 'close', 'volume']].to_dict('records')

        ce_data = to_rows(ce_rows)
        pe_data = to_rows(pe_rows)

        if not ce_data or not pe_data:
            continue

        # Track latest candle timestamp
        if ce_data[-1]['timestamp'] > last_data_time:
            last_data_time = ce_data[-1]['timestamp']
        if pe_data[-1]['timestamp'] > last_data_time:
            last_data_time = pe_data[-1]['timestamp']

        # Compute extrinsic + signal for CE and PE — mirrors blueprints/madhan.py:1772-1804
        def compute_extrinsic(data, option_type):
            result = []
            for i, item in enumerate(data):
                if item['open'] is None or item['close'] is None:
                    continue
                utc_dt = datetime.fromtimestamp(item['timestamp'], tz=_pytz.UTC)
                ist_dt = utc_dt.astimezone(ist_tz)
                ist_ts = int(ist_dt.timestamp())
                spot_close = spot_lookup.get(item['timestamp'], 0)

                if option_type == 'CE':
                    intrinsic = max(spot_close - strike_price, 0)
                else:
                    intrinsic = max(strike_price - spot_close, 0)
                extrinsic = item['close'] - intrinsic

                # Extrinsic signal — same logic as live
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

                result.append({
                    'time': ist_ts,
                    'open': item['open'],
                    'close': item['close'],
                    'low': item['low'],
                    'extrinsic': round(extrinsic, 2),
                    'signal': extrinsic_signal,
                })
            return result

        ce_enhanced = compute_extrinsic(ce_data, 'CE')
        pe_enhanced = compute_extrinsic(pe_data, 'PE')

        ce_dict = {item['time']: item for item in ce_enhanced}
        pe_dict = {item['time']: item for item in pe_enhanced}
        common_ts = sorted(set(ce_dict.keys()) & set(pe_dict.keys()))

        prev_cp_signal = False
        prev_cp_ce_sig = False

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

            # CP (Combined Extrinsic) signal — mirrors blueprints/madhan.py:1822-1838
            cp_signal = False
            if i > 0:
                prev_ts = common_ts[i - 1]
                prev_ce = ce_dict[prev_ts]
                prev_pe = pe_dict[prev_ts]
                prev_combined_ext = prev_ce['extrinsic'] + prev_pe['extrinsic']
                ce_c1 = prev_ce['low'] < prev_combined_ext and ce_item['close'] > combined_extrinsic and ce_item['close'] > pe_item['close']
                ce_c2 = ce_item['low'] < combined_extrinsic and ce_item['close'] > combined_extrinsic and ce_item['close'] > pe_item['close']
                pe_c1 = prev_pe['low'] < prev_combined_ext and pe_item['close'] > combined_extrinsic and pe_item['close'] > ce_item['close']
                pe_c2 = pe_item['low'] < combined_extrinsic and pe_item['close'] > combined_extrinsic and pe_item['close'] > ce_item['close']
                if not prev_cp_signal:
                    if ce_c1 or ce_c2:
                        cp_signal = 'CE'
                    elif pe_c1 or pe_c2:
                        cp_signal = 'PE'
            prev_cp_signal = bool(cp_signal)

            # CP_CE signal — mirrors blueprints/madhan.py:1840-1846
            cp_ce_signal = False
            if (ce_item['signal'] or pe_item['signal']) and combined_extrinsic > 0:
                tolerance = combined_extrinsic * 0.01
                if abs(combined_premium - combined_extrinsic) <= tolerance:
                    cp_ce_signal = True
            prev_cp_ce_sig = cp_ce_signal

            if ce_item['signal'] or pe_item['signal'] or cp_signal or cp_ce_signal:
                all_signals.append({
                    'time': ts,
                    'strike': strike_price,
                    'ce_signal': ce_item['signal'],
                    'pe_signal': pe_item['signal'],
                    'cp_signal': cp_signal,
                    'cp_ce_signal': cp_ce_signal,
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
        'ir': [],
    }

    # IR: all strikes where day's 1st candle open+close < combined_ext for both CE and PE
    for strike, fc in first_candle_per_strike.items():
        if (fc['ce_open'] < fc['combined_ext'] and fc['ce_close'] < fc['combined_ext'] and
                fc['pe_open'] < fc['combined_ext'] and fc['pe_close'] < fc['combined_ext']):
            signals['ir'].append(strike)
    signals['ir'].sort()

    for row in all_signals:
        if signals['ce_pe']['time'] == 0 and (row['ce_signal'] or row['pe_signal']):
            signals['ce_pe'] = {
                'time': row['time'],
                'type': 'CE' if row['ce_signal'] else 'PE',
                'strike': row['strike'],
            }
        if signals['ce_pe_hc']['time'] == 0:
            if row['ce_signal'] and row['ce_close'] > row['pe_close']:
                signals['ce_pe_hc'] = {'time': row['time'], 'type': 'CE', 'strike': row['strike']}
            elif row['pe_signal'] and row['pe_close'] > row['ce_close']:
                signals['ce_pe_hc'] = {'time': row['time'], 'type': 'PE', 'strike': row['strike']}
        if signals['cp']['time'] == 0 and row['cp_signal']:
            signals['cp'] = {'time': row['time'], 'strike': row['strike']}
        if signals['cp_open']['time'] == 0 and row['cp_signal']:
            fc = first_candle_per_strike.get(row['strike'])
            if fc and (fc['ce_open'] < fc['combined_ext'] and fc['ce_close'] < fc['combined_ext'] and
                       fc['pe_open'] < fc['combined_ext'] and fc['pe_close'] < fc['combined_ext']):
                signals['cp_open'] = {'time': row['time'], 'strike': row['strike']}

    return {'status': 'success', 'last_time': last_data_time, 'data': all_signals, 'signals': signals}


def get_backtest_range(from_date: str, to_date: str) -> dict | None:
    """Run multi-day backtest across a date range.

    For each trading day:
    1. Calls get_backtest_signals() once to get signal strikes for all strategies.
    2. For each strategy in STRATEGY_REGISTRY, extracts the strike from its signal_key.
    3. Calls get_backtest_chart_data() with that strike to get trades.
    4. Injects 'method' field (= signal_key) into each trade.

    Returns aggregated results per strategy and per day.
    """
    available = get_backtest_available_dates()
    if not available:
        return None

    dates_in_range = [d for d in available if from_date <= d <= to_date]
    if not dates_in_range:
        return None

    all_strategy_trades: dict[str, list[dict]] = {s: [] for s in STRATEGY_REGISTRY}
    per_day: list[dict] = []

    for date_str in dates_in_range:
        try:
            signals_result = get_backtest_signals(date_str)
        except Exception:
            signals_result = None
        if signals_result is None:
            per_day.append({
                'date': date_str,
                'ce_pe_strike': 0, 'cp_strike': 0,
                'trades': {'CE-PE': [], 'CP': []},
                'summary': {'CE-PE': None, 'CP': None},
            })
            continue

        sig = signals_result.get('signals', {})
        day_result = {'date': date_str, 'trades': {}, 'summary': {}}
        day_strike_map: dict[str, int] = {}

        for strat_name, strat_config in STRATEGY_REGISTRY.items():
            signal_key = strat_config['signal_key']
            strike = sig.get(signal_key, {}).get('strike', 0)
            day_strike_map[f'{strat_name.lower().replace("-", "_")}_strike'] = strike

            if strike <= 0:
                day_result['trades'][strat_name] = []
                day_result['summary'][strat_name] = None
                continue

            try:
                chart = get_backtest_chart_data(date_str, strike)
            except Exception:
                chart = None
            if chart is None:
                day_result['trades'][strat_name] = []
                day_result['summary'][strat_name] = None
                continue

            trades = chart.get('trades', {}).get(strat_name, [])
            for t in trades:
                t['method'] = signal_key
            day_result['trades'][strat_name] = trades
            day_result['summary'][strat_name] = chart.get('summary', {}).get(strat_name)
            all_strategy_trades[strat_name].extend(trades)

        day_result.update(day_strike_map)
        per_day.append(day_result)

    # Aggregate per-strategy summaries
    strategy_summaries: dict[str, dict | None] = {}
    for strat_name in STRATEGY_REGISTRY:
        trades = all_strategy_trades[strat_name]
        if not trades:
            strategy_summaries[strat_name] = None
            continue
        wins = sum(1 for t in trades if t['pnlPct'] > 0)
        strategy_summaries[strat_name] = {
            'total': len(trades),
            'wins': wins,
            'losses': len(trades) - wins,
            'winRate': round((wins / len(trades)) * 100, 1),
            'totalPnl': round(sum(t['pnlPct'] for t in trades), 2),
            'totalPnlAmount': round(sum(t['pnlAmount'] for t in trades), 2),
        }

    return {
        'from_date': from_date,
        'to_date': to_date,
        'total_days': len(dates_in_range),
        'days_with_signals': {
            s: sum(1 for d in per_day if d['trades'].get(s)) for s in STRATEGY_REGISTRY
        },
        'strategies': {
            s: {
                'trades': all_strategy_trades[s],
                'summary': strategy_summaries[s],
            } for s in STRATEGY_REGISTRY
        },
        'per_day': per_day,
    }
