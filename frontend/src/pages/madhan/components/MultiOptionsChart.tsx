import { useEffect, useState, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { createChart, ColorType, type IChartApi, type ISeriesApi, LineSeries, CandlestickSeries, LineStyle, createSeriesMarkers } from 'lightweight-charts';
import { useThemeStore } from '@/stores/themeStore';
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

export function MultiOptionsChart({ refreshTrigger, atmStrike, expiryDate }: MultiOptionsChartProps) {
    const { mode } = useThemeStore();
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
    const markersPluginRef = useRef<any>(null);
    const optionSeriesRefs = useRef<Map<string, ISeriesApi<"Line" | "Candlestick">>>(new Map());
    const optionSeriesTypes = useRef<Map<string, "Line" | "Candlestick">>(new Map());

    const [strikes, setStrikes] = useState<number[]>([]);
    const [selectedStrikes, setSelectedStrikes] = useState<Set<number>>(new Set());
    const [spotData, setSpotData] = useState<SpotData | null>(null);
    const [optionsData, setOptionsData] = useState<Map<string, OptionOHLC[]>>(new Map());
    const [backendSignals, setBackendSignals] = useState<any[]>([]);
    const [showSpot, setShowSpot] = useState(false);
    const [showOptions, setShowOptions] = useState(true);
    const [timeframe, setTimeframe] = useState<1 | 3 | 5 | 15>(1);
    const [isLive, setIsLive] = useState(true);
    const [showSignals, setShowSignals] = useState(true);

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
            for (let i = -5; i <= 5; i++) {
                newStrikes.push(atmStrike + (i * 50));
            }
            newStrikes.sort((a, b) => b - a); // Higher strikes on top
            setStrikes(newStrikes);
            // Default select ATM
            setSelectedStrikes(new Set([atmStrike]));
        }
    }, [atmStrike]);

    // Fetch signals from backend
    useEffect(() => {
        const fetchSignals = async () => {
            try {
                const response = await fetch(`/madhan/api/nifty/signals-cross?timeframe=${timeframe}`);
                const json = await response.json();
                if (json.status === 'success') {
                    setBackendSignals(json.data);
                }
            } catch (error) {
                console.error("Failed to fetch signals", error);
            }
        };
        if (showSignals) fetchSignals();
    }, [refreshTrigger, timeframe, showSignals]);

    // Fetch Spot Data
    useEffect(() => {
        const fetchSpotData = async () => {
            try {
                const response = await fetch('/madhan/api/nifty/spot-data');
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
            const response = await fetch(`/madhan/api/nifty/option-ohlc?symbol=${symbol}`);
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

        const isDark = mode === 'dark';
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
            markersPluginRef.current = null;
            optionSeriesRefs.current.clear();
            optionSeriesTypes.current.clear();
        };
    }, [mode]); // Re-create on mode change

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
        
        if (showOptions) {
            strikes.forEach(strike => {
                const ceSymbol = getSymbol(strike, 'CE');
                const peSymbol = getSymbol(strike, 'PE');
                if (!ceSymbol || !peSymbol) return;

                const isSelected = selectedStrikes.has(strike);
                const desiredType = isSelected ? 'Candlestick' : 'Line';

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
                            color: '#22c55e', // Green
                            lineWidth: 1,
                            lineStyle: LineStyle.Dotted,
                            priceScaleId: 'right', // Options on Right Scale
                            title: `${strike} CE`,
                            lastValueVisible: false,
                            priceLineVisible: false,
                        });
                    }
                    optionSeriesRefs.current.set(ceKey, ceSeries);
                    optionSeriesTypes.current.set(ceKey, desiredType);
                } else if (desiredType === 'Line') {
                    // Ensure Line style is correct if it was already a Line
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

                        // Keep real-time candle during refresh if it's newer than historical data
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
                                // Already in currentOHLCRef
                            } else {
                                // Seed from historical last
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
                            upColor: '#3b82f6', // Blue
                            downColor: '#f97316', // Orange
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
                            color: '#ef4444', // Red
                            lineWidth: 1,
                            lineStyle: LineStyle.Dotted,
                            priceScaleId: 'right', // Options on Right Scale
                            title: `${strike} PE`,
                            lastValueVisible: false,
                            priceLineVisible: false,
                        });
                    }
                    optionSeriesRefs.current.set(peKey, peSeries);
                    optionSeriesTypes.current.set(peKey, desiredType);
                } else if (desiredType === 'Line') {
                     // Ensure Line style is correct if it was already a Line
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

                        // Keep real-time candle during refresh if it's newer than historical data
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
                                // Already in currentOHLCRef
                            } else {
                                // Seed from historical last
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
        }

        // Remove series not in the current strikes list or if options hidden
        currentSeriesKeys.forEach(key => {
            const series = optionSeriesRefs.current.get(key);
            if (series) {
                chartRef.current!.removeSeries(series);
                optionSeriesRefs.current.delete(key);
                optionSeriesTypes.current.delete(key);
            }
        });

        // Calculate Signals if enabled
        if (showSignals && spotSeriesRef.current && backendSignals.length > 0) {
            const markers = backendSignals.map(s => ({
                time: (s.time / 1000) as any,
                position: (s.type.includes('CALL') ? 'belowBar' : 'aboveBar') as any,
                color: s.type.includes('CALL') ? '#22c55e' : '#ef4444',
                shape: (s.type.includes('CALL') ? 'arrowUp' : 'arrowDown') as any,
                text: s.type,
                size: 1
            }));

            if (markersPluginRef.current) {
                markersPluginRef.current.setMarkers(markers);
            } else if (spotSeriesRef.current) {
                // Type casting to avoid build error with lightweight-charts v5 markers
                markersPluginRef.current = (createSeriesMarkers as any)(spotSeriesRef.current, markers);
            }
        } else if (markersPluginRef.current) {
            markersPluginRef.current.setMarkers([]);
        }

    }, [spotData, optionsData, selectedStrikes, strikes, mode, showSpot, showOptions, timeframe, showSignals, backendSignals]); 

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
                            <Label htmlFor="show-signals-multi" className="text-[10px] font-semibold flex items-center gap-1 cursor-pointer">
                                Signals
                            </Label>
                            <Switch 
                                id="show-signals-multi" 
                                checked={showSignals}
                                onCheckedChange={setShowSignals}
                                className="scale-75"
                            />
                        </div>
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
                    </div>
                </CardHeader>
                <CardContent className="p-0 flex-1 min-h-0">
                    <div ref={chartContainerRef} className="w-full h-full" />
                </CardContent>
            </Card>
        </div>
    );
}
