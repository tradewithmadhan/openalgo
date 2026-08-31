import json
import os
import time
import urllib.parse
from datetime import datetime, timedelta

import httpx
import pandas as pd

from broker.zerodhaenctoken.database.master_contract_db import SymToken, db_session
from database.token_db import get_br_symbol, get_oa_symbol
from utils.httpx_client import get_httpx_client
from utils.logging import get_logger

logger = get_logger(__name__)


# OpenAlgo→Kite exchange-prefix translation for /quote, /quote/ltp, /quote/ohlc.
# Kite uses NSE/BSE/NFO/BFO/MCX/NCO/CDS/BCD/GLOBAL/NSEIX as the prefix in
# `i=EXCHANGE:tradingsymbol`. NSE_INDEX/BSE_INDEX/MCX_INDEX use NSE/BSE/MCX on
# the broker side. GLOBAL_INDEX folds two Kite feeds (GLOBAL + NSEIX) — the
# per-row brexchange column carries the original Kite exchange code.
_OA_INDEX_TO_KITE = {
    "NSE_INDEX": "NSE",
    "BSE_INDEX": "BSE",
    "MCX_INDEX": "MCX",
}


def _kite_quote_exchange(oa_exchange: str, brexchange: str | None) -> str:
    """Resolve the OpenAlgo exchange + per-row brexchange to the Kite-side
    exchange prefix used in /quote* endpoints."""
    if oa_exchange == "GLOBAL_INDEX":
        # brexchange holds the original Kite exchange code (GLOBAL or NSEIX).
        # Fall back to GLOBAL for legacy rows where the loader set brexchange
        # to the OA-side code.
        if brexchange and brexchange != "GLOBAL_INDEX":
            return brexchange
        return "GLOBAL"
    return _OA_INDEX_TO_KITE.get(oa_exchange, oa_exchange)


ENCTOKEN = os.environ.get("ZERODHA_ENCTOKEN", "")


def _get_enctoken_from_db(auth_token):
    """Get enctoken from database using the auth_token (api_key:access_token).

    First tries DB lookup, falls back to env var.
    """
    try:
        from database.auth_db import get_enctoken_by_auth_token
        enctoken, _username = get_enctoken_by_auth_token(auth_token)
        if enctoken:
            return enctoken
    except Exception:
        pass
    # Fallback to env var
    return ENCTOKEN

class ZerodhaPermissionError(Exception):
    """Custom exception for Zerodha API permission errors"""

    pass


class ZerodhaAPIError(Exception):
    """Custom exception for other Zerodha API errors"""

    pass


def get_api_response(endpoint, auth, method="GET", payload=None):
    """
    Make an API request to Kite personal API using enctoken auth.

    Args:
        endpoint (str): API endpoint (e.g., '/quote')
        auth (str): Authentication token (enctoken)
        method (str): HTTP method (GET, POST, etc.)
        payload (dict, optional): Request payload for POST requests

    Returns:
        dict: API response data

    Raises:
        ZerodhaPermissionError: For permission-related errors
        ZerodhaAPIError: For other API errors
    """
    AUTH_TOKEN = _get_enctoken_from_db(auth)
    base_url = "https://kite.zerodha.com/oms"

    # Get the shared httpx client with connection pooling
    client = get_httpx_client()

    headers = {
        "Authorization": f"enctoken {AUTH_TOKEN}",
    }

    # Keep query params in URL to preserve duplicate keys (e.g., multiple i= for quotes)
    url = f"{base_url}{endpoint}"

    # Quote endpoints not supported on personal /oms/ API — return empty data
    if "/quote" in endpoint or "/quote/ltp" in endpoint:
        return {"status": "success", "data": {}}

    try:
        if payload:
            logger.debug(f"Payload: {json.dumps(payload, indent=2)}")

        # Retry transient network errors (stale HTTP/2 connections)
        for attempt in range(3):
            try:
                if method.upper() == "GET":
                    response = client.get(url, headers=headers)
                elif method.upper() == "POST":
                    headers["Content-Type"] = "application/json"
                    response = client.post(url, headers=headers, json=payload)
                else:
                    raise ZerodhaAPIError(f"Unsupported HTTP method: {method}")
                break  # success
            except (httpx.ReadError, httpx.ConnectError, httpx.RemoteProtocolError) as e:
                logger.warning(f"Transient network error (attempt {attempt + 1}/3): {e}")
                if attempt < 2:
                    time.sleep(0.5)
                    client = httpx.Client(timeout=30)
                else:
                    raise

        # Log the complete response
        # logger.info("=== API Response Details ===")
        logger.debug(f"Status Code: {response.status_code}")
        logger.debug(f"Response Headers: {dict(response.headers)}")
        logger.debug(f"Response Body: {response.text}")

        # Parse JSON response
        response_data = response.json()

        # Check for permission errors
        if response_data.get("status") == "error":
            error_type = response_data.get("error_type")
            error_message = response_data.get("message", "Unknown error")

            if error_type == "PermissionException" or "permission" in error_message.lower():
                raise ZerodhaPermissionError(f"API Permission denied: {error_message}.")
            else:
                raise ZerodhaAPIError(f"API Error: {error_message}")

        return response_data

    except ZerodhaPermissionError:
        raise
    except ZerodhaAPIError:
        raise
    except Exception as e:
        error_msg = str(e)
        logger.exception(f"API request failed: {error_msg}")

        # Try to extract more error details if available
        try:
            if hasattr(e, "response") and e.response is not None:
                error_detail = e.response.json()
                error_msg = error_detail.get("message", error_msg)
        except Exception:
            pass

        raise ZerodhaAPIError(f"API request failed: {error_msg}")


class BrokerData:
    def __init__(self, auth_token):
        """Initialize Zerodha data handler with authentication token"""
        self.auth_token = auth_token

        # Map common timeframe format to Zerodha intervals
        self.timeframe_map = {
            # Seconds
            "5s": "5second",
            # Minutes
            "1m": "minute",
            "3m": "3minute",
            "5m": "5minute",
            "10m": "10minute",
            "15m": "15minute",
            "30m": "30minute",
            "60m": "60minute",
            # For flux scan to work for 1h interval
            "1h": "60minute",
            # Daily
            "D": "day",
        }

        # Market timing configuration for different exchanges
        self.market_timings = {
            "NSE": {"start": "09:15:00", "end": "15:30:00"},
            "BSE": {"start": "09:15:00", "end": "15:30:00"},
            "NFO": {"start": "09:15:00", "end": "15:30:00"},
            "CDS": {"start": "09:00:00", "end": "17:00:00"},
            "BCD": {"start": "09:00:00", "end": "17:00:00"},
            "MCX": {"start": "09:00:00", "end": "23:30:00"},
        }

        # Default market timings if exchange not found
        self.default_market_timings = {"start": "00:00:00", "end": "23:59:59"}

    def get_market_timings(self, exchange: str) -> dict:
        """Get market start and end times for given exchange"""
        return self.market_timings.get(exchange, self.default_market_timings)

    def get_quotes(self, symbol: str, exchange: str) -> dict:
        """
        Get real-time quotes for given symbol via on-demand WebSocket.
        Falls back to empty if WS proxy is unavailable.
        """
        try:
            from .ws_fetch import ws_get_quotes
            result = ws_get_quotes(symbol, exchange)
            if result and result.get("ltp", 0) > 0:
                return result
            # WS returned no data — symbol may not be subscribed, try with exchange info
            br_symbol = get_br_symbol(symbol, exchange)
            logger.debug(f"WS returned no data for {exchange}:{br_symbol}, trying with br_symbol")
            result = ws_get_quotes(br_symbol, exchange)
            if result and result.get("ltp", 0) > 0:
                return result
            raise ZerodhaAPIError("No quote data available via WebSocket")
        except ZerodhaPermissionError as e:
            logger.debug(f"Permission error fetching quotes: {e}")
            raise
        except (ZerodhaAPIError, Exception) as e:
            logger.exception(f"Error fetching quotes: {e}")
            raise ZerodhaAPIError(f"Error fetching quotes: {e}")

    def get_multiquotes(self, symbols: list) -> list:
        """
        Get real-time quotes for multiple symbols via on-demand WebSocket.
        """
        try:
            from .ws_fetch import ws_get_multiquotes
            return ws_get_multiquotes(symbols)
        except ZerodhaPermissionError as e:
            logger.debug(f"Permission error fetching multiquotes: {e}")
            raise
        except Exception as e:
            logger.exception("Error fetching multiquotes")
            raise ZerodhaAPIError(f"Error fetching multiquotes: {e}")

    def _process_quotes_batch(self, symbols: list) -> list:
        """
        Process a single batch of symbols (internal method)
        Args:
            symbols: List of dicts with 'symbol' and 'exchange' keys (max 500)
        Returns:
            list: List of quote data for the batch
        """
        # Build list of exchange:symbol pairs and symbol map
        instruments = []
        symbol_map = {}  # Map "exchange:br_symbol" to original symbol/exchange
        skipped_symbols = []  # Track symbols that couldn't be resolved

        for item in symbols:
            symbol = item["symbol"]
            exchange = item["exchange"]
            br_symbol = get_br_symbol(symbol, exchange)
            logger.info(f"Symbol mapping: {symbol}@{exchange} -> br_symbol={br_symbol}")

            # Track symbols that couldn't be resolved
            if not br_symbol:
                logger.warning(
                    f"Skipping symbol {symbol} on {exchange}: could not resolve broker symbol"
                )
                skipped_symbols.append(
                    {
                        "symbol": symbol,
                        "exchange": exchange,
                        "error": "Could not resolve broker symbol",
                    }
                )
                continue

            # Normalize exchange for indices and GLOBAL_INDEX (uses brexchange to
            # disambiguate between Kite's GLOBAL and NSEIX feeds).
            with db_session() as session:
                row = (
                    session.query(SymToken.brexchange)
                    .filter(SymToken.exchange == exchange, SymToken.brsymbol == br_symbol)
                    .first()
                )
                row_brexchange = row[0] if row else None
            api_exchange = _kite_quote_exchange(exchange, row_brexchange)

            instrument_key = f"{api_exchange}:{br_symbol}"
            instruments.append(instrument_key)
            symbol_map[instrument_key] = {
                "symbol": symbol,
                "exchange": exchange,
                "br_symbol": br_symbol,
                "api_exchange": api_exchange,
            }

        # Return skipped symbols if no valid instruments
        if not instruments:
            logger.warning("No valid instruments to fetch quotes for")
            return skipped_symbols

        # Build query string with multiple 'i' parameters
        # Format: /quote?i=NSE:SBIN&i=NSE:TCS&i=BSE:INFY
        query_params = "&".join([f"i={urllib.parse.quote(inst)}" for inst in instruments])
        endpoint = f"/quote?{query_params}"

        # Log the instruments being requested
        logger.info(f"Requesting quotes for {len(instruments)} instruments")
        logger.info(
            f"Instruments: {instruments[:5]}..."
            if len(instruments) > 5
            else f"Instruments: {instruments}"
        )
        logger.info(f"Endpoint length: {len(endpoint)} characters")
        logger.info(
            f"Full endpoint: {endpoint}"
            if len(instruments) <= 10
            else f"Endpoint (first 300 chars): {endpoint[:300]}..."
        )

        # Make API call for this batch
        response = get_api_response(endpoint, self.auth_token)
        logger.info(f"Zerodha API response status: {response.get('status')}")
        logger.info(f"Zerodha API response data keys: {list(response.get('data', {}).keys())[:10]}")
        logger.info(f"Full Zerodha response: {json.dumps(response, indent=2)[:1000]}...")

        # Parse response and build results
        results = []
        quotes_data = response.get("data", {})

        for instrument_key, original in symbol_map.items():
            quote = quotes_data.get(instrument_key)

            if not quote:
                # Symbol not found in response, add error entry
                logger.warning(f"No quote data found for {instrument_key}")
                results.append(
                    {
                        "symbol": original["symbol"],
                        "exchange": original["exchange"],
                        "error": "No quote data available",
                    }
                )
                continue

            # Parse and format quote data
            result_item = {
                "symbol": original["symbol"],
                "exchange": original["exchange"],
                "data": {
                    "ask": quote.get("depth", {}).get("sell", [{}])[0].get("price", 0),
                    "bid": quote.get("depth", {}).get("buy", [{}])[0].get("price", 0),
                    "high": quote.get("ohlc", {}).get("high", 0),
                    "low": quote.get("ohlc", {}).get("low", 0),
                    "ltp": quote.get("last_price", 0),
                    "open": quote.get("ohlc", {}).get("open", 0),
                    "prev_close": quote.get("ohlc", {}).get("close", 0),
                    "volume": quote.get("volume", 0),
                    "oi": quote.get("oi", 0),
                },
            }
            results.append(result_item)

        # Include skipped symbols in results
        return skipped_symbols + results

    def get_history(
        self, symbol: str, exchange: str, timeframe: str, from_date: str, to_date: str
    ) -> pd.DataFrame:
        """
        Get historical data for given symbol and timeframe
        Args:
            symbol: Trading symbol
            exchange: Exchange (e.g., NSE, BSE)
            timeframe: Timeframe (e.g., 1m, 5m, 15m, 60m, D)
            from_date: Start date in format YYYY-MM-DD
            to_date: End date in format YYYY-MM-DD
        Returns:
            pd.DataFrame: Historical data with OHLCV
        """
        try:
            # Convert timeframe to Zerodha format
            resolution = self.timeframe_map.get(timeframe)
            if not resolution:
                raise Exception(f"Unsupported timeframe: {timeframe}")

            # Convert symbol to broker format
            br_symbol = get_br_symbol(symbol, exchange)

            # Get the token from database
            with db_session() as session:
                symbol_info = (
                    session.query(SymToken)
                    .filter(SymToken.exchange == exchange, SymToken.brsymbol == br_symbol)
                    .first()
                )

                if not symbol_info:
                    all_symbols = (
                        session.query(SymToken).filter(SymToken.exchange == exchange).all()
                    )
                    logger.debug(
                        f"All matching symbols in DB: {[(s.symbol, s.brsymbol, s.exchange, s.brexchange, s.token) for s in all_symbols]}"
                    )
                    raise Exception(f"Could not find instrument token for {exchange}:{symbol}")

                # Split token to get instrument_token for historical data
                instrument_token = symbol_info.token.split("::::")[0]
                row_brexchange = symbol_info.brexchange

            exchange = _kite_quote_exchange(exchange, row_brexchange)

            # Convert dates to datetime objects
            start_date = pd.to_datetime(from_date)
            end_date = pd.to_datetime(to_date)

            # Initialize empty list to store DataFrames
            dfs = []

            # Kite per-request limits: 2000 days for `day`, 60 days for intraday.
            # 5second candles are heavy — limit to 5 days per request.
            if resolution == "day":
                chunk_days = 2000
            elif resolution == "5second":
                chunk_days = 5
            else:
                chunk_days = 60
            current_start = start_date
            while current_start <= end_date:
                current_end = min(current_start + timedelta(days=chunk_days - 1), end_date)

                # Format dates for API call
                from_str = current_start.strftime("%Y-%m-%d+00:00:00")
                to_str = current_end.strftime("%Y-%m-%d+23:59:59")

                # Log the request details
                logger.debug(
                    f"Fetching {resolution} data for {exchange}:{symbol} from {from_str} to {to_str}"
                )

                # Construct endpoint
                endpoint = f"/instruments/historical/{instrument_token}/{resolution}?from={from_str}&to={to_str}&oi=1"
                logger.debug(f"Making request to endpoint: {endpoint}")

                # Use get_api_response
                response = get_api_response(endpoint, self.auth_token)

                if not response or response.get("status") != "success":
                    logger.error(f"API Response: {response}")
                    raise Exception(
                        f"Error from Zerodha API: {response.get('message', 'Unknown error')}"
                    )

                # Convert to DataFrame
                candles = response.get("data", {}).get("candles", [])
                if candles:
                    df = pd.DataFrame(
                        candles,
                        columns=["timestamp", "open", "high", "low", "close", "volume", "oi"],
                    )
                    dfs.append(df)

                # Move to next chunk
                current_start = current_end + timedelta(days=1)

            # If no data was found, return empty DataFrame
            if not dfs:
                return pd.DataFrame(
                    columns=["timestamp", "open", "high", "low", "close", "volume", "oi"]
                )

            # Combine all chunks
            final_df = pd.concat(dfs, ignore_index=True)

            # Convert timestamp to epoch properly using ISO format
            final_df["timestamp"] = pd.to_datetime(final_df["timestamp"], format="ISO8601")

            # For daily timeframe, convert UTC to IST by adding 5 hours and 30 minutes
            if timeframe == "D":
                final_df["timestamp"] = final_df["timestamp"] + pd.Timedelta(hours=5, minutes=30)

            final_df["timestamp"] = (
                final_df["timestamp"].astype("int64") // 10**9
            )  # Convert nanoseconds to seconds

            # Sort by timestamp and remove duplicates
            final_df = (
                final_df.sort_values("timestamp")
                .drop_duplicates(subset=["timestamp"])
                .reset_index(drop=True)
            )

            # Ensure volume is integer
            final_df["volume"] = final_df["volume"].astype(int)
            final_df["oi"] = final_df["oi"].astype(int)

            return final_df

        except ZerodhaPermissionError as e:
            logger.exception(f"Permission error fetching historical data: {e}")
            raise
        except (ZerodhaAPIError, Exception) as e:
            logger.exception(f"Error fetching historical data: {e}")
            raise ZerodhaAPIError(f"Error fetching historical data: {e}")

    def get_market_depth(self, symbol: str, exchange: str) -> dict:
        """
        Get market depth for given symbol via on-demand WebSocket.
        """
        try:
            from .ws_fetch import ws_get_depth
            result = ws_get_depth(symbol, exchange)
            if result and result.get("ltp", 0) > 0:
                return result
            raise ZerodhaAPIError("No depth data available via WebSocket")
        except ZerodhaPermissionError as e:
            logger.error(f"Permission error fetching market depth: {str(e)}")
            raise
        except (ZerodhaAPIError, Exception) as e:
            logger.error(f"Error fetching market depth: {str(e)}")
            raise ZerodhaAPIError(f"Error fetching market depth: {str(e)}")

    def get_depth(self, symbol: str, exchange: str) -> dict:
        """Alias for get_market_depth to maintain compatibility with common API"""
        return self.get_market_depth(symbol, exchange)
