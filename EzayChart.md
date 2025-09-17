# EzayChart - Advanced Options Trading Chart

## Overview
EzayChart is an advanced options trading chart implementation using TradingView Lightweight Charts library. It provides comprehensive visualization of options data with calculated metrics for better trading insights.

## Features

### 1. Timezone Support
- **IST Conversion**: All timestamps are converted from UTC to Indian Standard Time (IST)
- **Implementation**: Uses `pytz` library to convert timestamps to Asia/Kolkata timezone
- **Display**: Chart shows timezone information in the title

### 2. Data Types Visualization
The chart supports multiple data type views:

#### Premium Data (Default)
- **CE Premium**: Call option premium (OHLC data)
- **PE Premium**: Put option premium (OHLC data)
- **Display**: Traditional candlestick, line, area, or bar charts

#### Combined Premium
- **Combined Premium**: Sum of Call and Put premiums
- **LLP (Lowest Low Premium)**: Tracks the lowest point of combined premium
- **Formula**: `Combined Premium = Call Close + Put Close`

#### Intrinsic Values
- **Call Intrinsic**: `max(Spot Price - Strike Price, 0)`
- **Put Intrinsic**: `max(Strike Price - Spot Price, 0)`
- **Purpose**: Shows the inherent value of options

#### Extrinsic Values
- **Call Extrinsic**: `Call Premium - Call Intrinsic`
- **Put Extrinsic**: `Put Premium - Put Intrinsic`
- **Combined Extrinsic**: `Call Extrinsic + Put Extrinsic`
- **Purpose**: Shows time value and volatility premium

## Calculated Fields

### 1. Open Combined Premium
```python
Open_combined_premium = Call_day_open + Put_day_open
```
- **Description**: Sum of opening prices for both Call and Put options
- **Usage**: Tracks the combined premium at market open

### 2. Combined Premium
```python
Combined_premium = Call_close + Put_close
```
- **Description**: Sum of closing prices for both Call and Put options
- **Usage**: Real-time combined premium tracking

### 3. LLP (Lowest Low Premium)
```python
LLP = min(Combined_premium_history)
```
- **Description**: Tracks the lowest point reached by combined premium
- **Implementation**: Calculated as running minimum of combined premium
- **Usage**: Identifies support levels for straddle/strangle strategies

### 4. Call Intrinsic Value
```python
Call_Intrinsic = max(Spot_close - Strike_Price, 0)
```
- **Description**: Intrinsic value of call option
- **Usage**: Determines if call option is in-the-money (ITM)

### 5. Call Extrinsic Value
```python
Call_Extrinsic = Call_close - Call_Intrinsic
```
- **Description**: Time value component of call option
- **Usage**: Measures time decay and volatility premium

### 6. Put Intrinsic Value
```python
Put_Intrinsic = max(Strike_Price - Spot_close, 0)
```
- **Description**: Intrinsic value of put option
- **Usage**: Determines if put option is in-the-money (ITM)

### 7. Put Extrinsic Value
```python
Put_Extrinsic = Put_close - Put_Intrinsic
```
- **Description**: Time value component of put option
- **Usage**: Measures time decay and volatility premium

### 8. Combined Extrinsic Value
```python
Combined_Extrinsic = Call_Extrinsic + Put_Extrinsic
```
- **Description**: Total time value of both options
- **Usage**: Tracks overall time decay for straddle/strangle positions

## API Endpoint

### URL
```
GET /madhan/api/ezayChart_data?strike={strike_price}
```

### Response Structure
```json
{
    "status": "success",
    "data": {
        "ce_data": [
            {
                "time": 1640995200,
                "open": 150.5,
                "high": 155.0,
                "low": 148.0,
                "close": 152.0,
                "call_intrinsic": 25.0,
                "call_extrinsic": 127.0
            }
        ],
        "pe_data": [
            {
                "time": 1640995200,
                "open": 145.0,
                "high": 150.0,
                "low": 142.0,
                "close": 147.0,
                "put_intrinsic": 0.0,
                "put_extrinsic": 147.0
            }
        ],
        "combined_data": [
            {
                "time": 1640995200,
                "open": 295.5,
                "high": 305.0,
                "low": 290.0,
                "close": 299.0
            }
        ],
        "llp": [
            {
                "time": 1640995200,
                "value": 290.0
            }
        ],
        "timezone": "Asia/Kolkata",
        "spot_data": {
            "current_price": 18525.0,
            "strike_price": 18500
        }
    }
}
```

## Chart Controls

### 1. Chart Type Selection
- **Candlestick**: Traditional OHLC representation
- **Line**: Simple line chart using close prices
- **Area**: Filled area chart
- **Bar**: OHLC bar chart

### 2. Option Type Selection
- **Both**: Display both CE and PE data
- **CE Only**: Display only Call option data
- **PE Only**: Display only Put option data

### 3. Data Type Selection
- **Premium**: Traditional option premium data
- **Combined**: Combined premium with LLP overlay
- **Intrinsic**: Intrinsic values of options
- **Extrinsic**: Extrinsic (time) values of options

### 4. Strike Price Selection
- Dynamic dropdown populated with available strikes
- Real-time data loading on selection change

## Technical Implementation

### Frontend (JavaScript)
- **Library**: TradingView Lightweight Charts (Latest Version)
- **Framework**: Vanilla JavaScript with modern ES6+ features
- **Responsive**: Adapts to different screen sizes
- **Real-time**: Dynamic data loading and chart updates

### Backend (Python/Flask)
- **Framework**: Flask with Blueprint architecture
- **Database**: Integration with existing data sources
- **Timezone**: pytz library for timezone conversion
- **Math**: Built-in math library for calculations

### Data Processing
1. **Fetch**: Retrieve CE/PE data from database
2. **Calculate**: Compute intrinsic/extrinsic values
3. **Combine**: Generate combined premium data
4. **Convert**: Transform timestamps to IST
5. **Format**: Structure data for TradingView charts

## Usage Examples

### Basic Premium Chart
```javascript
// Load premium data for strike 18500
currentStrike = '18500';
currentDataType = 'premium';
loadOptionData();
```

### Combined Premium with LLP
```javascript
// Switch to combined premium view
currentDataType = 'combined';
createChart();
```

### Intrinsic Value Analysis
```javascript
// Analyze intrinsic values
currentDataType = 'intrinsic';
currentOptionType = 'both';
createChart();
```

## Trading Insights

### 1. Straddle/Strangle Analysis
- Use **Combined Premium** view to track total position value
- Monitor **LLP** for support levels
- Analyze **Combined Extrinsic** for time decay impact

### 2. Option Greeks Approximation
- **Delta**: Compare intrinsic vs extrinsic values
- **Theta**: Monitor extrinsic value decay over time
- **Gamma**: Observe intrinsic value changes near strike

### 3. Market Timing
- **Entry**: Look for high extrinsic values (high IV)
- **Exit**: Monitor LLP levels for profit booking
- **Risk**: Track combined premium for position sizing

## Performance Considerations

### 1. Data Optimization
- Efficient database queries with proper indexing
- Minimal data transfer with calculated fields
- Client-side caching for repeated requests

### 2. Chart Performance
- Lightweight Charts library for smooth rendering
- Optimized data structures for large datasets
- Progressive loading for historical data

### 3. Real-time Updates
- WebSocket support for live data (future enhancement)
- Efficient data diff algorithms
- Minimal DOM manipulation

## Future Enhancements

1. **Real-time Data**: WebSocket integration for live updates
2. **More Greeks**: Add Delta, Gamma, Theta calculations
3. **Alerts**: Price and level-based notifications
4. **Export**: Data export functionality
5. **Backtesting**: Historical strategy analysis
6. **Mobile**: Enhanced mobile responsiveness

## Dependencies

### Python
```
Flask>=2.0.0
pytz>=2021.3
```

### JavaScript
```
TradingView Lightweight Charts (Latest CDN)
```

## Configuration

### Timezone Settings
```python
TIMEZONE = 'Asia/Kolkata'
UTC_OFFSET = '+05:30'
```

### Chart Settings
```javascript
const chartOptions = {
    layout: {
        backgroundColor: '#ffffff',
        textColor: '#333333',
    },
    grid: {
        vertLines: { color: '#e1e1e1' },
        horzLines: { color: '#e1e1e1' },
    },
    timeScale: {
        timeVisible: true,
        secondsVisible: false,
    }
};
```

---

*Last Updated: January 2024*
*Version: 1.0.0*