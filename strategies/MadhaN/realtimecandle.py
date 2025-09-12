from openalgo import api  
import pandas as pd  
import time  
import threading  
from datetime import datetime, timedelta  
from typing import Dict, Any, Optional  
  
class CandleDataWithRealTimeLTP:  
    def __init__(self, api_key: str, host: str = "http://127.0.0.1:5000", ws_url: str = "ws://127.0.0.1:8765"):  
        """Initialize the combined data client"""  
        self.client = api(  
            api_key=api_key,  
            host=host,  
            ws_url=ws_url  
        )  
        self.historical_data = {}  
        self.realtime_ltp = {}  
        self.current_candles = {}  # Store building candles  
        self.lock = threading.Lock()  
        self.backfill_threads = {}  
        self.interval_seconds = {}  # Store interval in seconds for each symbol  
        self.running = False  
          
    def _interval_to_seconds(self, interval: str) -> int:  
        """Convert interval string to seconds"""  
        interval_map = {  
            '1m': 60,  
            '5m': 300,  
            '15m': 900,  
            '30m': 1800,  
            '1h': 3600,  
            '1d': 86400  
        }  
        return interval_map.get(interval, 300)  # Default to 5 minutes  
      
    def get_historical_candles(self, symbol: str, exchange: str, interval: str,   
                             start_date: str, end_date: str) -> pd.DataFrame:  
        """Fetch historical candle data using REST API"""  
        try:  
            response = self.client.history(  
                symbol=symbol,  
                exchange=exchange,  
                interval=interval,  
                start_date=start_date,  
                end_date=end_date  
            )  
              
            # Check if response is successful and extract DataFrame  
            if isinstance(response, dict):  
                if response.get('status') == 'success' and 'data' in response:  
                    df = pd.DataFrame(response['data'])  
                else:  
                    print(f"Error in API response: {response.get('message', 'Unknown error')}")  
                    return pd.DataFrame()  
            else:  
                df = response  
              
            key = f"{exchange}:{symbol}"  
            with self.lock:  
                self.historical_data[key] = df  
                  
            print(f"Fetched {len(df)} historical candles for {key}")  
            return df  
              
        except Exception as e:  
            print(f"Error fetching historical data: {e}")  
            return pd.DataFrame()  
  
    def start_backfill_scheduler(self, symbol: str, exchange: str, interval: str):  
        """Start automatic backfill scheduler for a symbol"""  
        key = f"{exchange}:{symbol}"  
        interval_sec = self._interval_to_seconds(interval)  
        self.interval_seconds[key] = interval_sec  
          
        def backfill_worker():  
            while self.running:  
                try:  
                    # Calculate the time to fetch latest candle  
                    end_date = datetime.now().strftime("%Y-%m-%d")  
                    start_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")  
                      
                    # Fetch latest historical data  
                    latest_df = self.get_historical_candles(symbol, exchange, interval, start_date, end_date)  
                      
                    if not latest_df.empty:  
                        with self.lock:  
                            existing_df = self.historical_data.get(key, pd.DataFrame())  
                            if not existing_df.empty and 'timestamp' in latest_df.columns:  
                                # Merge new data, avoiding duplicates  
                                combined_df = pd.concat([existing_df, latest_df]).drop_duplicates(  
                                    subset=['timestamp'], keep='last'  
                                ).sort_values('timestamp').reset_index(drop=True)  
                                self.historical_data[key] = combined_df  
                                print(f"Backfilled {key}: Updated to {len(combined_df)} candles")  
                      
                    # Sleep for the interval duration  
                    time.sleep(interval_sec)  
                      
                except Exception as e:  
                    print(f"Error in backfill worker for {key}: {e}")  
                    time.sleep(60)  # Wait 1 minute before retrying  
          
        # Start backfill thread  
        thread = threading.Thread(target=backfill_worker, daemon=True)  
        thread.start()  
        self.backfill_threads[key] = thread  
        print(f"Started backfill scheduler for {key} with {interval} interval")  
  
    def start_realtime_ltp(self, instruments: list):  
        """Start real-time LTP subscription via WebSocket"""  
        def on_ltp_update(data):  
            """Callback for LTP updates"""  
            try:  
                if isinstance(data, dict) and 'symbol' in data and 'exchange' in data:  
                    key = f"{data['exchange']}:{data['symbol']}"  
                    ltp_value = None  
                      
                    # Extract LTP from different data formats  
                    if 'ltp' in data:  
                        ltp_value = data['ltp']  
                    elif 'data' in data and isinstance(data['data'], dict) and 'ltp' in data['data']:  
                        ltp_value = data['data']['ltp']  
                      
                    if ltp_value:  
                        current_time = datetime.now()  
                          
                        with self.lock:  
                            # Update real-time LTP  
                            self.realtime_ltp[key] = {  
                                'ltp': ltp_value,  
                                'timestamp': current_time,  
                                'raw_data': data  
                            }  
                              
                            # Build current candle  
                            self._update_current_candle(key, ltp_value, current_time)  
                          
                        print(f"LTP Update: {key} = ₹{ltp_value}")  
                          
            except Exception as e:  
                print(f"Error processing LTP update: {e}")  
          
        # Connect and subscribe to WebSocket  
        try:  
            self.client.connect()  
            self.client.subscribe_ltp(instruments, on_data_received=on_ltp_update)  
            print(f"Subscribed to real-time LTP for {len(instruments)} instruments")  
              
        except Exception as e:  
            print(f"Error starting real-time LTP: {e}")  
  
    def _update_current_candle(self, key: str, ltp: float, timestamp: datetime):  
        """Update the current building candle with new LTP"""  
        interval_sec = self.interval_seconds.get(key, 300)  # Default 5 minutes  
          
        # Calculate current candle start time  
        current_ts = int(timestamp.timestamp())  
        candle_start_ts = (current_ts // interval_sec) * interval_sec  
          
        if key not in self.current_candles or self.current_candles[key]['candle_start'] != candle_start_ts:  
            # Start new candle  
            historical_df = self.historical_data.get(key, pd.DataFrame())  
            last_close = 0  
              
            if not historical_df.empty and 'close' in historical_df.columns:  
                last_close = historical_df.iloc[-1]['close']  
              
            self.current_candles[key] = {  
                'candle_start': candle_start_ts,  
                'timestamp': candle_start_ts,  
                'open': last_close if last_close > 0 else ltp,  
                'high': ltp,  
                'low': ltp,  
                'close': ltp,  
                'volume': 0,  
                'tick_count': 1  
            }  
        else:  
            # Update existing candle  
            candle = self.current_candles[key]  
            candle['high'] = max(candle['high'], ltp)  
            candle['low'] = min(candle['low'], ltp)  
            candle['close'] = ltp  
            candle['tick_count'] += 1  
  
    def get_combined_data(self, symbol: str, exchange: str) -> Dict[str, Any]:  
        """Get combined historical and real-time data"""  
        key = f"{exchange}:{symbol}"  
          
        with self.lock:  
            historical = self.historical_data.get(key, pd.DataFrame())  
            realtime = self.realtime_ltp.get(key, {})  
            current_candle = self.current_candles.get(key, {})  
          
        return {  
            'symbol': symbol,  
            'exchange': exchange,  
            'historical_candles': historical,  
            'current_ltp': realtime.get('ltp'),  
            'ltp_timestamp': realtime.get('timestamp'),  
            'current_candle': current_candle,  
            'last_candle': historical.iloc[-1].to_dict() if not historical.empty else {},  
            'total_candles': len(historical)  
        }  
  
    def create_extended_candles(self, symbol: str, exchange: str) -> pd.DataFrame:  
        """Create extended candle data with current building candle"""  
        combined = self.get_combined_data(symbol, exchange)  
        df = combined['historical_candles'].copy()  
          
        if not df.empty and combined['current_candle']:  
            # Add current building candle  
            current_candle = combined['current_candle'].copy()  
              
            # Ensure all required columns exist  
            if 'timestamp' in df.columns:  
                new_row_df = pd.DataFrame([current_candle])  
                df = pd.concat([df, new_row_df], ignore_index=True)  
          
        return df  
  
    def start_continuous_monitoring(self, instruments: list, interval: str = "5m"):  
        """Start continuous monitoring with backfill and real-time updates"""  
        self.running = True  
          
        # Initial historical data fetch  
        end_date = datetime.now().strftime("%Y-%m-%d")  
        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")  
          
        for instrument in instruments:  
            symbol = instrument["symbol"]  
            exchange = instrument["exchange"]  
              
            print(f"\nInitial fetch for {exchange}:{symbol}")  
            self.get_historical_candles(symbol, exchange, interval, start_date, end_date)  
              
            # Start backfill scheduler  
            self.start_backfill_scheduler(symbol, exchange, interval)  
          
        # Start real-time LTP updates  
        self.start_realtime_ltp(instruments)  
          
        print(f"\nStarted continuous monitoring for {len(instruments)} instruments")  
  
    def stop(self):  
        """Stop all operations"""  
        self.running = False  
          
        try:  
            self.client.disconnect()  
            print("WebSocket connection closed")  
        except Exception as e:  
            print(f"Error stopping connection: {e}")  
          
        # Wait for backfill threads to stop  
        for key, thread in self.backfill_threads.items():  
            if thread.is_alive():  
                print(f"Waiting for backfill thread {key} to stop...")  
                thread.join(timeout=5)  
  
# Enhanced example usage  
def main():  
    api_key = "b58d52652534d69b896466992175f3d4bffc8a0776811fdaa9fdf4eb0eeae9ba"  
      
    data_client = CandleDataWithRealTimeLTP(api_key)  
      
    instruments = [  
        {"exchange": "NSE", "symbol": "RELIANCE"},  
        {"exchange": "NSE", "symbol": "TCS"}  
    ]  
      
    # Start continuous monitoring with 5-minute intervals  
    data_client.start_continuous_monitoring(instruments, interval="5m")  
      
    # Monitor for extended period  
    print("\nMonitoring combined data with automatic backfill...")  
    try:  
        for i in range(24):  # Monitor for 2 minutes (24 * 5 seconds)  
            time.sleep(5)  
              
            for instrument in instruments:  
                symbol = instrument["symbol"]  
                exchange = instrument["exchange"]  
                  
                combined = data_client.get_combined_data(symbol, exchange)  
                  
                print(f"\n{exchange}:{symbol} Live Data:")  
                print(f"  Historical candles: {combined['total_candles']}")  
                print(f"  Current LTP: ₹{combined['current_ltp']}")  
                  
                if combined['current_candle']:  
                    candle = combined['current_candle']  
                    print(f"  Building candle: O={candle['open']:.2f}, H={candle['high']:.2f}, L={candle['low']:.2f}, C={candle['close']:.2f} (Ticks: {candle['tick_count']})")  
                  
                # Show extended candles  
                extended_df = data_client.create_extended_candles(symbol, exchange)  
                if not extended_df.empty:  
                    print(f"  Total candles (with current): {len(extended_df)}")  
      
    except KeyboardInterrupt:  
        print("\nStopping monitoring...")  
      
    finally:  
        data_client.stop()  
        print("Monitoring stopped!")  
  
if __name__ == "__main__":  
    main()