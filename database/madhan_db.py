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
