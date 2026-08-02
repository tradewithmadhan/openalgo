import { useEffect, useState, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { createChart, ColorType, type IChartApi, type ISeriesApi, LineSeries, CandlestickSeries, HistogramSeries, LineStyle } from 'lightweight-charts';
import { useMadhanTheme } from '@/pages/madhan/useMadhanTheme';
import { useMarketData } from '@/hooks/useMarketData';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Zap, ZapOff } from 'lucide-react';

interface MultiOptionsChartProps {
    refreshTrigger: number;
    atmStrike?: number;
    expiryDate?: string | null;
}

interface OptionOHLC {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    oi: number;
}

interface SpotData {
    timestamps: number[];
    prices: number[];
}

const aggregateData = (data: OptionOHLC[], period: number): OptionOHLC[] => {
    if (period === 1) return data;
    const aggregated: OptionOHLC[] = [];
    let currentBucket: OptionOHLC | null = null;
    let bucketStartTime = 0;

    const periodSeconds = period * 60;

    data.forEach(candle => {
        const candleTime = candle.timestamp;
        const bucketStart = Math.floor(candleTime / periodSeconds) * periodSeconds;

        if (currentBucket && bucketStart !== bucketStartTime) {
            aggregated.push(currentBucket);
            currentBucket = null;
        }

        if (!currentBucket) {
            bucketStartTime = bucketStart;
            currentBucket = {
                ...candle,
                timestamp: bucketStart,
                high: candle.high,
                low: candle.low,
                volume: candle.volume,
                oi: candle.oi
            };
        } else {
            currentBucket.high = Math.max(currentBucket.high, candle.high);
            currentBucket.low = Math.min(currentBucket.low, candle.low);
            currentBucket.close = candle.close;
            currentBucket.volume += candle.volume;
            currentBucket.oi = candle.oi; // Take latest OI
        }
    });

    if (currentBucket) {
        aggregated.push(currentBucket);
    }

    return aggregated;
};

const aggregateSpotData = (data: SpotData, period: number) => {
    if (period === 1) {
        return data.timestamps.map((ts, i) => ({
            time: ts / 1000 as any,
            value: data.prices[i]
        }));
    }
    
    const aggregated: { time: any, value: number }[] = [];
    let currentBucket: { time: number, value: number } | null = null;
    let bucketStartTime = 0;
    const periodSeconds = period * 60;

    data.timestamps.forEach((tsMs, i) => {
        const tsSec = tsMs / 1000;
        const bucketStart = Math.floor(tsSec / periodSeconds) * periodSeconds;
        const price = data.prices[i];

        if (currentBucket && bucketStart !== bucketStartTime) {
            aggregated.push(currentBucket);
            currentBucket = null;
        }

        if (!currentBucket) {
            bucketStartTime = bucketStart;
            currentBucket = {
                time: bucketStart,
                value: price
            };
        } else {
            // For Area/Line, usually we want the Close of the bucket
            currentBucket.value = price; 
        }
    });

    if (currentBucket) {
        aggregated.push(currentBucket);
    }
    return aggregated;
}

// Compute running maximum of high (step line that only goes up)
const computeRunningMaxHigh = (data: OptionOHLC[], period: number): { time: number; value: number }[] => {
    if (!data.length) return [];
    const aggregated = aggregateData(data, period);
    let runningMax = Number.NEGATIVE_INFINITY;
    return aggregated.map(d => {
        runningMax = Math.max(runningMax, d.high);
        return { time: d.timestamp, value: runningMax };
    });
};

// Compute running minimum of low (step line that only goes down)
const computeRunningMinLow = (data: OptionOHLC[], period: number): { time: number; value: number }[] => {
    if (!data.length) return [];
    const aggregated = aggregateData(data, period);
    let runningMin = Number.POSITIVE_INFINITY;
    return aggregated.map(d => {
        runningMin = Math.min(runningMin, d.low);
        return { time: d.timestamp, value: runningMin };
    });
};

export function MultiOptionsChart({ refreshTrigger, atmStrike, expiryDate }: MultiOptionsChartProps) {
    const { mode: madhanMode } = useMadhanTheme();
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    // Helper to format date for symbol
    const getSymbol = (strike: number, type: 'CE' | 'PE') => {
        if (!expiryDate) return null;
        try {
            // expiryDate is expected to be YYYY-MM-DD or DD-MMM-YY
            let dateObj = new Date(expiryDate);
            
            // If invalid date, try parsing DD-MMM-YY manually
            if (isNaN(dateObj.getTime())) {
                const parts = expiryDate.split('-');
                if (parts.length === 3) {
                    const day = parseInt(parts[0]);
                    const monthStr = parts[1];
                    const yearStr = parts[2];
                    // Handle 2-digit year
                    const year = yearStr.length === 2 ? 2000 + parseInt(yearStr) : parseInt(yearStr);
                    
                    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
                    const monthIndex = monthNames.indexOf(monthStr.toUpperCase());
                    
                    if (monthIndex !== -1 && !isNaN(day) && !isNaN(year)) {
                        dateObj = new Date(year, monthIndex, day);
                    }
                }
            }
            
            if (isNaN(dateObj.getTime())) {
                console.error("Invalid expiry date format:", expiryDate);
                return null;
            }
            
            const day = dateObj.getDate().toString().padStart(2, '0');
            const year = dateObj.getFullYear().toString().slice(-2);
            const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
            const month = monthNames[dateObj.getMonth()];
            // NSE Symbol format: NIFTY + DD + MMM + YY + Strike + CE/PE
            return `NIFTY${day}${month}${year}${strike}${type}`;
        } catch (e) {
            console.error("Error parsing expiry date", e);
            return null;
        }
    };
    
    // Series refs
    const spotSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const optionSeriesRefs = useRef<Map<string, ISeriesApi<"Line" | "Candlestick">>>(new Map());
    const optionSeriesTypes = useRef<Map<string, "Line" | "Candlestick">>(new Map());

    const [strikes, setStrikes] = useState<number[]>([]);
    const [selectedStrikes, setSelectedStrikes] = useState<Set<number>>(new Set());
    const [spotData, setSpotData] = useState<SpotData | null>(null);
    const [optionsData, setOptionsData] = useState<Map<string, OptionOHLC[]>>(new Map());
    const [crossStats, setCrossStats] = useState<any[]>([]);
    const [showSpot, setShowSpot] = useState(false);
    const [showOptions, setShowOptions] = useState(false);
    const [timeframe, setTimeframe] = useState<1 | 3 | 5 | 15>(1);
    const [isLive, setIsLive] = useState(true);
    const [showHighCross, setShowHighCross] = useState(false);
    const [showHighCrossCE, setShowHighCrossCE] = useState(true);
    const [showHighCrossPE, setShowHighCrossPE] = useState(true);
    const highCrossSeriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
    const [showLowCross, setShowLowCross] = useState(false);
    const [showLowCrossCE, setShowLowCrossCE] = useState(true);
    const [showLowCrossPE, setShowLowCrossPE] = useState(true);
    const lowCrossSeriesRefs = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
    const histogramSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const [histogramMode, setHistogramMode] = useState<'strike_vol' | 'total_vol' | 'hlx_count'>('hlx_count');
    const [showHistogram, setShowHistogram] = useState(true);

    // Symbols for WebSocket subscription
    const wsSymbols = useMemo(() => {
        const syms: Array<{ symbol: string; exchange: string }> = [
            { symbol: 'NIFTY', exchange: 'NSE_INDEX' }
        ];

        if (showOptions && expiryDate && strikes.length > 0) {
            strikes.forEach(strike => {
                const ce = getSymbol(strike, 'CE');
                const pe = getSymbol(strike, 'PE');
                if (ce) syms.push({ symbol: ce, exchange: 'NFO' });
                if (pe) syms.push({ symbol: pe, exchange: 'NFO' });
            });
        }
        return syms;
    }, [strikes, expiryDate, showOptions]);

    // WebSocket Hook
    const { data: wsData } = useMarketData({
        symbols: wsSymbols,
        mode: 'LTP',
        enabled: isLive
    });

    // Refs to track current OHLC state for real-time candlestick updates
    const currentOHLCRef = useRef<Map<string, OptionOHLC>>(new Map());
    // Refs to track last updated time for each series to aggregate real-time updates
    const lastUpdateTimeRef = useRef<Map<string, number>>(new Map());

    // Generate strikes around ATM
    useEffect(() => {
        if (atmStrike && atmStrike > 0) {
            const newStrikes = [];
            for (let i = -10; i <= 10; i++) {
                newStrikes.push(atmStrike + (i * 50));
            }
            newStrikes.sort((a, b) => b - a); // Higher strikes on top
            setStrikes(newStrikes);
            // Default select ATM
            setSelectedStrikes(new Set([atmStrike]));
        }
    }, [atmStrike]);

    // Fetch cross-change stats from backend
    useEffect(() => {
        const fetchCrossStats = async () => {
            try {
                const response = await fetch(`/madhan/api/nifty/hx_lx_vol?_=${Date.now()}`);
                const json = await response.json();
                if (json.status === 'success') {
                    setCrossStats(json.data);
                }
            } catch (error) {
                console.error("Failed to fetch cross stats", error);
            }
        };
        if (showHighCross || showLowCross || histogramMode === 'hlx_count') {
            fetchCrossStats();
            const interval = setInterval(fetchCrossStats, 60000);
            return () => clearInterval(interval);
        }
    }, [refreshTrigger, showHighCross, showLowCross, atmStrike, expiryDate, histogramMode]);

    // Fetch Spot Data
    useEffect(() => {
        const fetchSpotData = async () => {
            try {
                const response = await fetch(`/madhan/api/nifty/spot-data?_=${Date.now()}`);
                const json = await response.json();
                if (json.status === 'success') {
                    setSpotData(json.data);
                }
            } catch (error) {
                console.error("Failed to fetch Spot data", error);
            }
        };
        fetchSpotData();
    }, [refreshTrigger]);

    // Fetch data for specific symbol
    const fetchSymbolData = async (symbol: string) => {
        try {
            const response = await fetch(`/madhan/api/nifty/option-ohlc?symbol=${symbol}&_=${Date.now()}`);
            const json = await response.json();
            if (json.status === 'success') {
                const { timestamps, open, high, low, close, volume, oi } = json.data;
                
                // Reconstruct array of objects if data exists
                let formattedData: OptionOHLC[] = [];
                if (timestamps && Array.isArray(timestamps)) {
                     formattedData = timestamps.map((ts: number, i: number) => ({
                        timestamp: ts,
                        open: open[i],
                        high: high[i],
                        low: low[i],
                        close: close[i],
                        volume: volume[i],
                        oi: oi[i]
                    }));
                }

                setOptionsData(prev => {
                    const next = new Map(prev);
                    next.set(symbol, formattedData);
                    return next;
                });
            }
        } catch (error) {
            console.error(`Failed to fetch data for ${symbol}`, error);
        }
    };

    // Effect to fetch data when selection changes or refresh triggers
    useEffect(() => {
        if (!expiryDate) return;
        
        strikes.forEach(strike => {
            const ceSymbol = getSymbol(strike, 'CE');
            const peSymbol = getSymbol(strike, 'PE');
            if (ceSymbol) fetchSymbolData(ceSymbol);
            if (peSymbol) fetchSymbolData(peSymbol);
        });
    }, [strikes, expiryDate, refreshTrigger]);

    // Toggle strike selection
    const toggleStrike = (strike: number) => {
        const newSet = new Set(selectedStrikes);
        if (newSet.has(strike)) {
            newSet.delete(strike);
        } else {
            newSet.add(strike);
        }
        setSelectedStrikes(newSet);
    };

    // Initialize/Recreate Chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Cleanup previous chart
        if (chartRef.current) {
            chartRef.current.remove();
            optionSeriesRefs.current.clear();
        }

        const isDark = madhanMode === 'dark';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
        const textColor = isDark ? '#d1d5db' : '#374151';
        const backgroundColor = 'transparent';

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: backgroundColor },
                textColor: textColor,
            },
            grid: {
                vertLines: { color: gridColor },
                horzLines: { color: gridColor },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            localization: {
                timeFormatter: (time: number) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString('en-IN', { 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        hour12: false, 
                        timeZone: 'Asia/Kolkata' 
                    });
                },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                tickMarkFormatter: (time: number) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString('en-IN', { 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        hour12: false, 
                        timeZone: 'Asia/Kolkata' 
                    });
                },
            },
            rightPriceScale: {
                visible: true,
                borderColor: gridColor,
            },
            leftPriceScale: {
                visible: true,
                borderColor: gridColor,
            },
        });

        chartRef.current = chart;

        // Histogram series for cross-change counts (uses a dedicated price scale)
        const histogramSeries = chart.addSeries(HistogramSeries, {
            priceScaleId: 'histogram',
            overlay: true,
            priceLineVisible: false,
            lastValueVisible: false,
            title: 'Cross Changes',
        });
        chart.priceScale('histogram').applyOptions({
            visible: false,
            scaleMargins: { top: 0.7, bottom: 0 },
        });
        histogramSeriesRef.current = histogramSeries;

        // Spot Series (Left Scale)
        const spotColor = isDark ? '#94a3b8' : '#64748b'; // Slate gray

        const spotSeries = chart.addSeries(LineSeries, {
            color: spotColor,
            lineWidth: 1,
            priceScaleId: 'left',
            title: 'Nifty Spot',
        });
        spotSeriesRef.current = spotSeries;

        // Initial Data load for Spot if available
        if (spotData) {
            const spotChartData = aggregateSpotData(spotData, timeframe);
            spotSeriesRef.current.setData(spotChartData);
            if (spotChartData.length > 0) {
                const last = spotChartData[spotChartData.length - 1];
                lastUpdateTimeRef.current.set('NIFTY', last.time as number);
            }
        }
        
        const resizeObserver = new ResizeObserver((entries) => {
            if (entries.length > 0 && chartRef.current) {
                const { width, height } = entries[0].contentRect;
                if (width > 0 && height > 0) {
                    chartRef.current.applyOptions({ width, height });
                }
            }
        });
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            spotSeriesRef.current = null;
            optionSeriesRefs.current.clear();
            optionSeriesTypes.current.clear();
            highCrossSeriesRefs.current.forEach((s) => {
                try { chart.removeSeries(s); } catch {}
            });
            highCrossSeriesRefs.current.clear();
            lowCrossSeriesRefs.current.forEach((s) => {
                try { chart.removeSeries(s); } catch {}
            });
            lowCrossSeriesRefs.current.clear();
            if (histogramSeriesRef.current) {
                try { chart.removeSeries(histogramSeriesRef.current); } catch {}
                histogramSeriesRef.current = null;
            }
        };
    }, [madhanMode]); // Re-create on mode change

    // Update Chart Data Effect
    useEffect(() => {
        if (!chartRef.current || !spotSeriesRef.current) return;

        // Update Spot Visibility
        spotSeriesRef.current.applyOptions({ visible: showSpot });
        chartRef.current.priceScale('left').applyOptions({ visible: showSpot });

        // Update Spot Data
        if (spotData && spotSeriesRef.current) {
            const spotChartData = aggregateSpotData(spotData, timeframe);
            spotSeriesRef.current.setData(spotChartData);
            if (spotChartData.length > 0) {
                const last = spotChartData[spotChartData.length - 1];
                lastUpdateTimeRef.current.set('NIFTY', last.time as number);
            }
        }

        // Update Options Data
        const currentSeriesKeys = new Set(optionSeriesRefs.current.keys());
        
        // Always process selected strikes (show as candlesticks)
        // Process non-selected as lines only when showOptions=true
        strikes.forEach(strike => {
            const ceSymbol = getSymbol(strike, 'CE');
            const peSymbol = getSymbol(strike, 'PE');
            if (!ceSymbol || !peSymbol) return;

            const isSelected = selectedStrikes.has(strike);
            const desiredType = isSelected ? 'Candlestick' : (showOptions ? 'Line' : null);

            // Skip non-selected strikes when options are hidden
            if (desiredType === null) return;

            // CE
            const ceKey = ceSymbol;
            let ceSeries = optionSeriesRefs.current.get(ceKey);
            const currentCeType = optionSeriesTypes.current.get(ceKey);

            if (ceSeries && currentCeType !== desiredType) {
                chartRef.current!.removeSeries(ceSeries);
                optionSeriesRefs.current.delete(ceKey);
                optionSeriesTypes.current.delete(ceKey);
                ceSeries = undefined;
            }

            if (!ceSeries) {
                if (desiredType === 'Candlestick') {
                    ceSeries = chartRef.current!.addSeries(CandlestickSeries, {
                        upColor: '#22c55e',
                        downColor: '#ef4444',
                        borderVisible: false,
                        wickUpColor: '#22c55e',
                        wickDownColor: '#ef4444',
                        priceScaleId: 'right',
                        title: `${strike} CE`,
                        lastValueVisible: true,
                        priceLineVisible: true,
                    });
                } else {
                    ceSeries = chartRef.current!.addSeries(LineSeries, {
                        color: '#22c55e',
                        lineWidth: 1,
                        lineStyle: LineStyle.Dotted,
                        priceScaleId: 'right',
                        title: `${strike} CE`,
                        lastValueVisible: false,
                        priceLineVisible: false,
                    });
                }
                optionSeriesRefs.current.set(ceKey, ceSeries);
                optionSeriesTypes.current.set(ceKey, desiredType);
            } else if (desiredType === 'Line') {
                ceSeries.applyOptions({
                    lineWidth: 1,
                    lineStyle: LineStyle.Dotted,
                });
            }

            // Set Data for CE
            const ceDataRaw = optionsData.get(ceSymbol);
            if (ceDataRaw) {
                const ceData = aggregateData(ceDataRaw, timeframe);
                if (desiredType === 'Candlestick') {
                    const chartData = ceData.map(d => ({
                        time: d.timestamp as any,
                        open: d.open,
                        high: d.high,
                        low: d.low,
                        close: d.close
                    }));

                    const currentRealtime = currentOHLCRef.current.get(ceKey);
                    if (currentRealtime && (chartData.length === 0 || currentRealtime.timestamp > chartData[chartData.length - 1].time)) {
                        chartData.push({
                            time: currentRealtime.timestamp as any,
                            open: currentRealtime.open,
                            high: currentRealtime.high,
                            low: currentRealtime.low,
                            close: currentRealtime.close
                        });
                    }

                    (ceSeries as ISeriesApi<"Candlestick">).setData(chartData);
                    if (chartData.length > 0) {
                        const last = chartData[chartData.length - 1];
                        lastUpdateTimeRef.current.set(ceKey, last.time as number);
                        if (currentRealtime && last.time === currentRealtime.timestamp) {
                        } else {
                            const lastHistorical = ceData[ceData.length - 1];
                            currentOHLCRef.current.set(ceKey, { ...lastHistorical });
                        }
                    }
                } else {
                    const chartData = ceData.map(d => ({
                        time: d.timestamp as any,
                        value: d.close
                    }));
                    (ceSeries as ISeriesApi<"Line">).setData(chartData);
                    if (chartData.length > 0) {
                        const lastPoint = chartData[chartData.length - 1];
                        lastUpdateTimeRef.current.set(ceKey, lastPoint.time as number);
                    }
                }
            }

            // PE
            const peKey = peSymbol;
            let peSeries = optionSeriesRefs.current.get(peKey);
            const currentPeType = optionSeriesTypes.current.get(peKey);

            if (peSeries && currentPeType !== desiredType) {
                chartRef.current!.removeSeries(peSeries);
                optionSeriesRefs.current.delete(peKey);
                optionSeriesTypes.current.delete(peKey);
                peSeries = undefined;
            }

            if (!peSeries) {
                if (desiredType === 'Candlestick') {
                    peSeries = chartRef.current!.addSeries(CandlestickSeries, {
                        upColor: '#3b82f6',
                        downColor: '#f97316',
                        borderVisible: false,
                        wickUpColor: '#3b82f6',
                        wickDownColor: '#f97316',
                        priceScaleId: 'right',
                        title: `${strike} PE`,
                        lastValueVisible: true,
                        priceLineVisible: true,
                    });
                } else {
                    peSeries = chartRef.current!.addSeries(LineSeries, {
                        color: '#ef4444',
                        lineWidth: 1,
                        lineStyle: LineStyle.Dotted,
                        priceScaleId: 'right',
                        title: `${strike} PE`,
                        lastValueVisible: false,
                        priceLineVisible: false,
                    });
                }
                optionSeriesRefs.current.set(peKey, peSeries);
                optionSeriesTypes.current.set(peKey, desiredType);
            } else if (desiredType === 'Line') {
                peSeries.applyOptions({
                    lineWidth: 1,
                    lineStyle: LineStyle.Dotted,
                });
            }

            // Set Data for PE
            const peDataRaw = optionsData.get(peSymbol);
            if (peDataRaw) {
                const peData = aggregateData(peDataRaw, timeframe);
                if (desiredType === 'Candlestick') {
                    const chartData = peData.map(d => ({
                        time: d.timestamp as any,
                        open: d.open,
                        high: d.high,
                        low: d.low,
                        close: d.close
                    }));

                    const currentRealtime = currentOHLCRef.current.get(peKey);
                    if (currentRealtime && (chartData.length === 0 || currentRealtime.timestamp > chartData[chartData.length - 1].time)) {
                        chartData.push({
                            time: currentRealtime.timestamp as any,
                            open: currentRealtime.open,
                            high: currentRealtime.high,
                            low: currentRealtime.low,
                            close: currentRealtime.close
                        });
                    }

                    (peSeries as ISeriesApi<"Candlestick">).setData(chartData);
                    if (chartData.length > 0) {
                        const last = chartData[chartData.length - 1];
                        lastUpdateTimeRef.current.set(peKey, last.time as number);
                        if (currentRealtime && last.time === currentRealtime.timestamp) {
                        } else {
                            const lastHistorical = peData[peData.length - 1];
                            currentOHLCRef.current.set(peKey, { ...lastHistorical });
                        }
                    }
                } else {
                    const chartData = peData.map(d => ({
                        time: d.timestamp as any,
                        value: d.close
                    }));
                    (peSeries as ISeriesApi<"Line">).setData(chartData);
                    if (chartData.length > 0) {
                        const lastPoint = chartData[chartData.length - 1];
                        lastUpdateTimeRef.current.set(peKey, lastPoint.time as number);
                    }
                }
            }

            currentSeriesKeys.delete(ceKey);
            currentSeriesKeys.delete(peKey);
        });

        // Remove series not in the current strikes list or if options hidden

        // Remove series not in the current strikes list or if options hidden
        currentSeriesKeys.forEach(key => {
            const series = optionSeriesRefs.current.get(key);
            if (series) {
                chartRef.current!.removeSeries(series);
                optionSeriesRefs.current.delete(key);
                optionSeriesTypes.current.delete(key);
            }
        });

        // HighCross lines - rolling highest high per strike/CE/PE
        if (showHighCross && chartRef.current) {
            strikes.forEach(strike => {
                (['CE', 'PE'] as const).forEach(type => {
                    const symbol = getSymbol(strike, type);
                    if (!symbol) return;
                    const key = symbol;
                    const shouldShow = (type === 'CE' ? showHighCrossCE : showHighCrossPE);
                    const existing = highCrossSeriesRefs.current.get(key);

                    if (!shouldShow) {
                        // Remove line if it exists and toggle is off
                        if (existing) {
                            chartRef.current!.removeSeries(existing);
                            highCrossSeriesRefs.current.delete(key);
                        }
                        return;
                    }

                    const rawData = optionsData.get(symbol);
                    if (!rawData || !rawData.length) return;

                    // Remove existing series for this symbol (will recreate)
                    if (existing) {
                        chartRef.current!.removeSeries(existing);
                        highCrossSeriesRefs.current.delete(key);
                    }

                    // Create new line series for running max high
                    const series = chartRef.current!.addSeries(LineSeries, {
                        color: type === 'CE' ? '#ef4444' : '#3b82f6',
                        lineWidth: 1,
                        lineStyle: LineStyle.Solid,
                        priceScaleId: 'right',
                        priceLineVisible: false,
                        lastValueVisible: false,
                        title: `${strike} ${type} HighCross`,
                    });

                    const stepData = computeRunningMaxHigh(rawData, timeframe);
                    series.setData(stepData);
                    highCrossSeriesRefs.current.set(key, series);
                });
            });
        } else {
            // Cleanup all HighCross lines
            highCrossSeriesRefs.current.forEach((s) => {
                try { chartRef.current!.removeSeries(s); } catch {}
            });
            highCrossSeriesRefs.current.clear();
        }

        // LowCross lines - rolling lowest low per strike/CE/PE
        if (showLowCross && chartRef.current) {
            strikes.forEach(strike => {
                (['CE', 'PE'] as const).forEach(type => {
                    const symbol = getSymbol(strike, type);
                    if (!symbol) return;
                    const key = symbol;
                    const shouldShow = (type === 'CE' ? showLowCrossCE : showLowCrossPE);
                    const existing = lowCrossSeriesRefs.current.get(key);

                    if (!shouldShow) {
                        if (existing) {
                            chartRef.current!.removeSeries(existing);
                            lowCrossSeriesRefs.current.delete(key);
                        }
                        return;
                    }

                    const rawData = optionsData.get(symbol);
                    if (!rawData || !rawData.length) return;

                    if (existing) {
                        chartRef.current!.removeSeries(existing);
                        lowCrossSeriesRefs.current.delete(key);
                    }

                    const series = chartRef.current!.addSeries(LineSeries, {
                        color: type === 'CE' ? '#f59e0b' : '#8b5cf6',
                        lineWidth: 1,
                        lineStyle: LineStyle.Solid,
                        priceScaleId: 'right',
                        priceLineVisible: false,
                        lastValueVisible: false,
                        title: `${strike} ${type} LowCross`,
                    });

                    const stepData = computeRunningMinLow(rawData, timeframe);
                    series.setData(stepData);
                    lowCrossSeriesRefs.current.set(key, series);
                });
            });
        } else {
            // Cleanup all LowCross lines
            lowCrossSeriesRefs.current.forEach((s) => {
                try { chartRef.current!.removeSeries(s); } catch {}
            });
            lowCrossSeriesRefs.current.clear();
        }

        // Update Histogram
        if (histogramSeriesRef.current) {
            if (!showHistogram) {
                histogramSeriesRef.current.applyOptions({ visible: false });
                chartRef.current!.priceScale('histogram').applyOptions({ visible: false });
                return;
            }

            let histogramData: { time: number; value: number; color: string }[] = [];

            if (histogramMode === 'hlx_count') {
                // Use backend cross-change counts (always available)
                const backendData = crossStats.length > 0 ? crossStats : [];
                // Aggregate counts by timeframe bucket (backend returns 1-min data)
                const periodSeconds = timeframe * 60;
                const volMap = new Map<number, number>();

                backendData.forEach(item => {
                    const tsSec = item.timestamp / 1000;
                    const bucketStart = Math.floor(tsSec / periodSeconds) * periodSeconds;
                    let total = 0;
                    total += item.ce_hx || 0;
                    total += item.pe_hx || 0;
                    total += item.ce_lx || 0;
                    total += item.pe_lx || 0;
                    if (total > 0) {
                        volMap.set(bucketStart, (volMap.get(bucketStart) || 0) + total);
                    }
                });

                histogramData = Array.from(volMap.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([ts, count]) => ({
                        time: ts,
                        value: count,
                        color: count > 0 ? '#eab33a' : 'rgba(100, 116, 126, 0.1)',
                    }));
            } else if (histogramMode === 'total_vol') {
                // Total volume across all strikes (CE + PE)
                const volMap = new Map<number, number>();
                strikes.forEach(strike => {
                    (['CE', 'PE'] as const).forEach(type => {
                        const symbol = getSymbol(strike, type);
                        if (!symbol) return;
                        const rawData = optionsData.get(symbol);
                        if (!rawData) return;
                        const aggregated = aggregateData(rawData, timeframe);
                        aggregated.forEach(candle => {
                            const ts = candle.timestamp;
                            const prev = volMap.get(ts) || 0;
                            volMap.set(ts, prev + candle.volume);
                        });
                    });
                });

                histogramData = Array.from(volMap.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([ts, vol]) => ({
                             time: ts,
                        value: vol,
                        color: '#3b82f6',
                    }));
            } else if (histogramMode === 'strike_vol') {
                // Selected strike volume (CE + PE combined)
                const volMap = new Map<number, number>();
                selectedStrikes.forEach(strike => {
                    (['CE', 'PE'] as const).forEach(type => {
                        const symbol = getSymbol(strike, type);
                        if (!symbol) return;
                        const rawData = optionsData.get(symbol);
                        if (!rawData) return;
                        const aggregated = aggregateData(rawData, timeframe);
                        aggregated.forEach(candle => {
                            const ts = candle.timestamp;
                            const prev = volMap.get(ts) || 0;
                            volMap.set(ts, prev + candle.volume);
                        });
                    });
                });

                histogramData = Array.from(volMap.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([ts, vol]) => ({
                             time: ts,
                        value: vol,
                        color: '#22c55e',
                    }));
            }

            if (histogramData.length > 0) {
                histogramSeriesRef.current.setData(histogramData);
                histogramSeriesRef.current.applyOptions({ visible: true });
                chartRef.current!.priceScale('histogram').applyOptions({ visible: true });
            } else {
                histogramSeriesRef.current.applyOptions({ visible: false });
                chartRef.current!.priceScale('histogram').applyOptions({ visible: false });
            }
        }
    }, [crossStats, selectedStrikes, showOptions, optionsData, timeframe, showHighCross, showHighCrossCE, showHighCrossPE, showLowCross, showLowCrossCE, showLowCrossPE, spotData, showSpot, histogramMode, showHistogram]);

    // WebSocket Real-time Updates Effect
    useEffect(() => {
        if (!wsData || wsData.size === 0 || !chartRef.current) return;

        // Process Spot update
        const spotWs = wsData.get('NSE_INDEX:NIFTY');
        if (spotWs?.data?.ltp && spotSeriesRef.current) {
            const ltp = spotWs.data.ltp;
            const rawTime = (spotWs.lastUpdate || Date.now()) / 1000;
            const time = Math.floor(rawTime / (timeframe * 60)) * (timeframe * 60);

            const lastTime = lastUpdateTimeRef.current.get('NIFTY');
            if (lastTime === undefined || time >= lastTime) {
                spotSeriesRef.current.update({
                    time: time as any,
                    value: ltp
                });
                lastUpdateTimeRef.current.set('NIFTY', time);
            }
        }

        // Process Options updates
        strikes.forEach(strike => {
            const ceSymbol = getSymbol(strike, 'CE');
            const peSymbol = getSymbol(strike, 'PE');

            if (ceSymbol) {
                const ceWs = wsData.get(`NFO:${ceSymbol}`);
                const ceSeries = optionSeriesRefs.current.get(ceSymbol);
                const ceType = optionSeriesTypes.current.get(ceSymbol);

                if (ceWs?.data?.ltp && ceSeries) {
                    const ltp = ceWs.data.ltp;
                    const rawTime = (ceWs.lastUpdate || Date.now()) / 1000;
                    const time = Math.floor(rawTime / (timeframe * 60)) * (timeframe * 60);
                    const lastTime = lastUpdateTimeRef.current.get(ceSymbol);

                    if (lastTime === undefined || time >= lastTime) {
                        if (ceType === 'Candlestick') {
                            const series = ceSeries as ISeriesApi<"Candlestick">;
                            let currentCandle = currentOHLCRef.current.get(ceSymbol);
                            
                            if (currentCandle && time === currentCandle.timestamp) {
                                // Update existing candle
                                currentCandle.high = Math.max(currentCandle.high, ltp);
                                currentCandle.low = Math.min(currentCandle.low, ltp);
                                currentCandle.close = ltp;
                            } else {
                                // New candle boundary or first update
                                currentCandle = {
                                    timestamp: time,
                                    open: ltp,
                                    high: ltp,
                                    low: ltp,
                                    close: ltp,
                                    volume: 0,
                                    oi: 0
                                };
                                currentOHLCRef.current.set(ceSymbol, currentCandle);
                            }

                            series.update({
                                time: time as any,
                                open: currentCandle.open,
                                high: currentCandle.high,
                                low: currentCandle.low,
                                close: currentCandle.close
                            });
                        } else {
                            (ceSeries as ISeriesApi<"Line">).update({
                                time: time as any,
                                value: ltp
                            });
                        }
                        lastUpdateTimeRef.current.set(ceSymbol, time);
                    }
                }
            }

            if (peSymbol) {
                const peWs = wsData.get(`NFO:${peSymbol}`);
                const peSeries = optionSeriesRefs.current.get(peSymbol);
                const peType = optionSeriesTypes.current.get(peSymbol);

                if (peWs?.data?.ltp && peSeries) {
                    const ltp = peWs.data.ltp;
                    const rawTime = (peWs.lastUpdate || Date.now()) / 1000;
                    const timeframeSecs = timeframe * 60;
                    const time = Math.floor(rawTime / timeframeSecs) * timeframeSecs;
                    const lastTime = lastUpdateTimeRef.current.get(peSymbol);

                    if (lastTime === undefined || time >= lastTime) {
                        if (peType === 'Candlestick') {
                            const series = peSeries as ISeriesApi<"Candlestick">;
                            let currentCandle = currentOHLCRef.current.get(peSymbol);

                            if (currentCandle && time === currentCandle.timestamp) {
                                currentCandle.high = Math.max(currentCandle.high, ltp);
                                currentCandle.low = Math.min(currentCandle.low, ltp);
                                currentCandle.close = ltp;
                            } else {
                                currentCandle = {
                                    timestamp: time,
                                    open: ltp,
                                    high: ltp,
                                    low: ltp,
                                    close: ltp,
                                    volume: 0,
                                    oi: 0
                                };
                                currentOHLCRef.current.set(peSymbol, currentCandle);
                            }

                            series.update({
                                time: time as any,
                                open: currentCandle.open,
                                high: currentCandle.high,
                                low: currentCandle.low,
                                close: currentCandle.close
                            });
                        } else {
                            (peSeries as ISeriesApi<"Line">).update({
                                time: time as any,
                                value: ltp
                            });
                        }
                        lastUpdateTimeRef.current.set(peSymbol, time);
                    }
                }
            }
        });
    }, [wsData, strikes, timeframe]);

    return (
        <div className="flex h-[calc(100vh-140px)] w-full gap-2">
            <Card className="w-24 flex-shrink-0 flex flex-col">
                <CardHeader className="p-1">
                    <CardTitle className="text-xs">Strikes</CardTitle>
                </CardHeader>
                <CardContent className="p-0 flex-1 min-h-0">
                    <ScrollArea className="h-full">
                        <div className="flex flex-col gap-1 p-1">
                            {strikes.map(strike => (
                                <div key={strike} className="flex items-center space-x-1 p-1 hover:bg-accent rounded">
                                    <Checkbox 
                                        id={`strike-${strike}`} 
                                        checked={selectedStrikes.has(strike)}
                                        onCheckedChange={() => toggleStrike(strike)}
                                        className="h-3 w-3"
                                    />
                                    <label 
                                        htmlFor={`strike-${strike}`} 
                                        className="text-[10px] font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer w-full"
                                    >
                                        {strike}
                                    </label>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
            
            <Card className="flex-1 flex flex-col">
                <CardHeader className="p-1 flex flex-row items-center justify-between">
                    <CardTitle className="text-xs">Multi-Option Analysis</CardTitle>
                    <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2 mr-2">
                            <Label htmlFor="live-mode-multi" className="text-[10px] font-semibold flex items-center gap-1 cursor-pointer">
                                {isLive ? <Zap className="h-3 w-3 text-yellow-500 fill-yellow-500" /> : <ZapOff className="h-3 w-3" />}
                                Live
                            </Label>
                            <Switch 
                                id="live-mode-multi" 
                                checked={isLive}
                                onCheckedChange={setIsLive}
                                className="scale-75"
                            />
                        </div>
                        <div className="flex items-center space-x-1 border rounded p-0.5">
                            {[1, 3, 5, 15].map(tf => (
                                <button
                                    key={tf}
                                    onClick={() => setTimeframe(tf as any)}
                                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${timeframe === tf ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground'}`}
                                >
                                    {tf}m
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center space-x-2">
                            <Label htmlFor="show-options-multi" className="text-[10px] font-semibold">Options</Label>
                            <Switch 
                                id="show-options-multi" 
                                checked={showOptions}
                                onCheckedChange={setShowOptions}
                                className="scale-75"
                            />
                        </div>
                         <div className="flex items-center space-x-2">
                            <Label htmlFor="show-spot-multi" className="text-[10px] font-semibold">Spot</Label>
                            <Switch 
                                id="show-spot-multi" 
                                checked={showSpot}
                                onCheckedChange={setShowSpot}
                                className="scale-75"
                            />
                        </div>
                        <div className="flex items-center space-x-2">
                            <Label htmlFor="show-highcross" className="text-[10px] font-semibold">HighCross</Label>
                            <Switch 
                                id="show-highcross" 
                                checked={showHighCross}
                                onCheckedChange={setShowHighCross}
                                className="scale-75"
                            />
                        </div>
                        {showHighCross && (
                            <>
                                <div className="flex items-center space-x-1 ml-2">
                                    <div className="w-2 h-2 rounded-sm bg-red-500" />
                                    <Label htmlFor="show-highcross-ce" className="text-[10px]">CE</Label>
                                    <Switch 
                                        id="show-highcross-ce" 
                                        checked={showHighCrossCE}
                                        onCheckedChange={setShowHighCrossCE}
                                        className="scale-75"
                                    />
                                </div>
                                <div className="flex items-center space-x-1">
                                    <div className="w-2 h-2 rounded-sm bg-blue-500" />
                                    <Label htmlFor="show-highcross-pe" className="text-[10px]">PE</Label>
                                    <Switch 
                                        id="show-highcross-pe" 
                                        checked={showHighCrossPE}
                                        onCheckedChange={setShowHighCrossPE}
                                        className="scale-75"
                                    />
                                </div>
                            </>
                        )}
                        <div className="flex items-center space-x-2">
                            <Label htmlFor="show-lowcross" className="text-[10px] font-semibold">LowCross</Label>
                            <Switch 
                                id="show-lowcross" 
                                checked={showLowCross}
                                onCheckedChange={setShowLowCross}
                                className="scale-75"
                            />
                        </div>
                        {showLowCross && (
                            <>
                                <div className="flex items-center space-x-1 ml-2">
                                    <div className="w-2 h-2 rounded-sm bg-amber-500" />
                                    <Label htmlFor="show-lowcross-ce" className="text-[10px]">CE</Label>
                                    <Switch 
                                        id="show-lowcross-ce" 
                                        checked={showLowCrossCE}
                                        onCheckedChange={setShowLowCrossCE}
                                        className="scale-75"
                                    />
                                </div>
                                <div className="flex items-center space-x-1">
                                    <div className="w-2 h-2 rounded-sm bg-violet-500" />
                                    <Label htmlFor="show-lowcross-pe" className="text-[10px]">PE</Label>
                                    <Switch 
                                        id="show-lowcross-pe" 
                                        checked={showLowCrossPE}
                                        onCheckedChange={setShowLowCrossPE}
                                        className="scale-75"
                                    />
                                </div>
                            </>
                        )}
                        <div className="flex items-center space-x-1 border rounded p-0.5">
                            <button
                                onClick={() => setHistogramMode('strike_vol')}
                                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${histogramMode === 'strike_vol' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground'}`}
                                title="Selected strike volume"
                            >
                                Strike Vol
                            </button>
                            <button
                                onClick={() => setHistogramMode('total_vol')}
                                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${histogramMode === 'total_vol' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground'}`}
                                title="Total volume all strikes"
                            >
                                Total Vol
                            </button>
                            <button
                                onClick={() => setHistogramMode('hlx_count')}
                                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${histogramMode === 'hlx_count' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground'}`}
                                title="HighCross/LowCross counts"
                            >
                                HLx Count
                            </button>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Label htmlFor="show-histogram" className="text-[10px] font-semibold">Histogram</Label>
                            <Switch
                                id="show-histogram"
                                checked={showHistogram}
                                onCheckedChange={setShowHistogram}
                                className="scale-75"
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0 flex-1 min-h-0">
                    <div ref={chartContainerRef} className="w-full h-full" />
                </CardContent>
            </Card>
        </div>
    );
}
