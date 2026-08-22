import { createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi, LineSeries } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMadhanTheme } from '@/pages/madhan/useMadhanTheme';
import { useInstrument } from '../InstrumentContext';

import { Zap, ZapOff } from 'lucide-react';
import { showToast } from '@/utils/toast';

interface SupportResistanceData {
    timestamps: number[];
    oi_support: (number | null)[];
    oi_resistance: (number | null)[];
    coi_support: (number | null)[];
    coi_resistance: (number | null)[];
    oi_sr: any;
    coi_sr: any;
}

interface SupportResistanceChartProps {
    refreshTrigger: number;
}

export function SupportResistanceChart({ refreshTrigger }: SupportResistanceChartProps) {
    const { instrument } = useInstrument();
    const { mode: madhanMode } = useMadhanTheme();
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const oiSupportSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const oiResistanceSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const coiSupportSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const coiResistanceSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const spotSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const lastSpotTimeRef = useRef<number | null>(null);
    const prevWidthRef = useRef(0);
    const shouldFitContent = useRef(true);
    const wsRef = useRef<WebSocket | null>(null);

    const [data, setData] = useState<SupportResistanceData | null>(null);
    const [spotData, setSpotData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLive, setIsLive] = useState(true);
    
    // Toggles
    const [showOi, setShowOi] = useState(true);
    const [showCoi, setShowCoi] = useState(false);
    const [showSpot, setShowSpot] = useState(true);

    // Apply theme settings
    const applyTheme = (chart: IChartApi, isDark: boolean) => {
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
        const textColor = isDark ? '#d1d5db' : '#374151';
        
        chart.applyOptions({
            layout: {
                textColor,
                background: { type: ColorType.Solid, color: 'transparent' },
            },
            grid: {
                vertLines: { color: gridColor },
                horzLines: { color: gridColor },
            },
        });
    };

    // WebSocket Connection
    useEffect(() => {
        if (!isLive) {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            return;
        }

        const connectWebSocket = async () => {
            try {
                // Get CSRF Token
                const csrfResponse = await fetch('/auth/csrf-token', { credentials: 'include' });
                const csrfData = await csrfResponse.json();
                const csrfToken = csrfData.csrf_token;

                // Get WebSocket Config
                const configResponse = await fetch('/api/websocket/config', {
                    headers: { 'X-CSRFToken': csrfToken },
                    credentials: 'include',
                });
                const configData = await configResponse.json();

                if (configData.status !== 'success') throw new Error('Config fetch failed');

                const wsUrl = configData.websocket_url;
                const socket = new WebSocket(wsUrl);
                wsRef.current = socket;

                socket.onopen = async () => {
                    try {
                        // Authenticate
                        const authCsrfResponse = await fetch('/auth/csrf-token', { credentials: 'include' });
                        const authCsrfData = await authCsrfResponse.json();
                        const authCsrfToken = authCsrfData.csrf_token;

                        const apiKeyResponse = await fetch('/api/websocket/apikey', {
                            headers: { 'X-CSRFToken': authCsrfToken },
                            credentials: 'include',
                        });
                        const apiKeyData = await apiKeyResponse.json();

                        if (apiKeyData.status === 'success' && apiKeyData.api_key) {
                            socket.send(JSON.stringify({ action: 'authenticate', api_key: apiKeyData.api_key }));
                        }
                    } catch (error) {
                        console.error('WebSocket Auth Failed', error);
                        setIsLive(false);
                    }
                };

                socket.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);
                        const type = message.type || message.status;
                        
                        if (type === 'auth' && message.status === 'success') {
                            console.log('[WS] Auth success, subscribing...');
                            showToast.success('Live connection established');
                            // Subscribe to NIFTY
                            socket.send(JSON.stringify({ 
                                action: 'subscribe', 
                                symbols: [{ symbol: instrument, exchange: 'NSE_INDEX' }],
                                mode: 1 // LTP
                            }));
                        } else if (type === 'market_data' && message.data) {
                            const { symbol, exchange, data } = message;
                            // console.log('[WS] Data received:', symbol, data.ltp, data.timestamp);
                            if (symbol === instrument && exchange === 'NSE_INDEX' && data.ltp && spotSeriesRef.current) {
                                // Update chart
                                let rawTime: number;
                                if (data.timestamp) {
                                    if (typeof data.timestamp === 'number') {
                                        // Heuristic: If timestamp is less than 100 billion, it's likely seconds (valid until year 5138)
                                        // Current ms timestamp is ~1.7 trillion
                                        if (data.timestamp < 100000000000) {
                                            rawTime = data.timestamp;
                                        } else {
                                            rawTime = data.timestamp / 1000;
                                        }
                                    } else {
                                        // String or other format
                                        rawTime = new Date(data.timestamp).getTime() / 1000;
                                    }
                                } else {
                                    rawTime = Date.now() / 1000;
                                }
                                
                                // Round to nearest minute to aggregate updates
                                const time = Math.floor(rawTime / 60) * 60;

                                console.log(`[WS] Update: LTP=${data.ltp}, RawTime=${rawTime}, AggTime=${time}, LastRef=${lastSpotTimeRef.current}`);

                                // Prevent updating with older timestamps
                                if (lastSpotTimeRef.current !== null && time < lastSpotTimeRef.current) {
                                    console.warn(`[WS] Skipping update: Time ${time} < Last ${lastSpotTimeRef.current}`);
                                    return;
                                }

                                try {
                                    spotSeriesRef.current.update({
                                        time: time as any,
                                        value: data.ltp
                                    });
                                    lastSpotTimeRef.current = time;
                                } catch (err) {
                                    console.error('[WS] Chart update failed:', err, { time, ltp: data.ltp, last: lastSpotTimeRef.current });
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing WS message', e);
                    }
                };

                socket.onerror = (error) => {
                     console.error("WebSocket Error", error);
                };
                
            } catch (error) {
                console.error('WebSocket Connection Failed', error);
                setIsLive(false);
                showToast.error('Failed to connect to live data');
            }
        };

        connectWebSocket();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [isLive]);

    // Effect to update chart options when theme changes
    useEffect(() => {
        if (!chartRef.current) return;
        applyTheme(chartRef.current, madhanMode === 'dark');
        
        if (spotSeriesRef.current) {
            const spotColor = madhanMode === 'dark' ? '#d1d5db' : '#4b5563';
            spotSeriesRef.current.applyOptions({ color: spotColor });
        }
    }, [madhanMode]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const response = await fetch(`/madhan/api/nifty/support-resistance?instrument=${instrument}&_=${Date.now()}`);
            const json = await response.json();
            if (json.status === 'success') {
                setData(json.data);
            }
        } catch (error) {
            console.error("Failed to fetch Support & Resistance data", error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchSpotData = async () => {
        try {
            const response = await fetch(`/madhan/api/nifty/spot-data?instrument=${instrument}&_=${Date.now()}`);
            const json = await response.json();
            if (json.status === 'success') {
                setSpotData(json.data);
            }
        } catch (error) {
            console.error("Failed to fetch Spot data", error);
        }
    };

    useEffect(() => {
        fetchData();
        fetchSpotData();
    }, [refreshTrigger, instrument]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: madhanMode === 'dark' ? '#d1d5db' : '#374151',
            },
            grid: {
                vertLines: { color: madhanMode === 'dark' ? 'rgba(42, 46, 57, 0.5)' : 'rgba(209, 213, 219, 0.5)' },
                horzLines: { color: madhanMode === 'dark' ? 'rgba(42, 46, 57, 0.5)' : 'rgba(209, 213, 219, 0.5)' },
            },
            width: chartContainerRef.current.clientWidth,
            height: 500,
            localization: {
                timeFormatter: (time: number) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
                },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                tickMarkFormatter: (time: number) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
                },
            },
            rightPriceScale: {
                borderColor: madhanMode === 'dark' ? 'rgba(42, 46, 57, 0.5)' : 'rgba(209, 213, 219, 0.5)',
            },
        });

        // OI Support (Green)
        const oiSupportSeries = chart.addSeries(LineSeries, {
            color: '#4caf50', 
            lineWidth: 2,
            title: 'OI Support',
            lastValueVisible: false,
        }) as ISeriesApi<"Line">;

        // OI Resistance (Red)
        const oiResistanceSeries = chart.addSeries(LineSeries, {
            color: '#f44336', 
            lineWidth: 2,
            title: 'OI Resistance',
            lastValueVisible: false,
        }) as ISeriesApi<"Line">;

        // COI Support (Green Dashed)
        const coiSupportSeries = chart.addSeries(LineSeries, {
            color: '#4caf50', 
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            title: 'COI Support',
            lastValueVisible: false,
        }) as ISeriesApi<"Line">;

        // COI Resistance (Red Dashed)
        const coiResistanceSeries = chart.addSeries(LineSeries, {
            color: '#f44336', 
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            title: 'COI Resistance',
            lastValueVisible: false,
        }) as ISeriesApi<"Line">;

        // Spot Price (Gray)
        const spotSeries = chart.addSeries(LineSeries, {
            color: '#d1d5db',
            lineWidth: 1,
            title: 'Spot Price',
            // priceScaleId: 'left', // Removed to share scale with Support/Resistance levels
        }) as ISeriesApi<"Line">;

        chartRef.current = chart;
        oiSupportSeriesRef.current = oiSupportSeries;
        oiResistanceSeriesRef.current = oiResistanceSeries;
        coiSupportSeriesRef.current = coiSupportSeries;
        coiResistanceSeriesRef.current = coiResistanceSeries;
        spotSeriesRef.current = spotSeries;

        // Apply initial theme
        applyTheme(chart, madhanMode === 'dark');
        if (spotSeriesRef.current) {
            const spotColor = madhanMode === 'dark' ? '#d1d5db' : '#4b5563';
            spotSeriesRef.current.applyOptions({ color: spotColor });
        }

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener('resize', handleResize);
        
        // Add ResizeObserver for container resize events (e.g. tab switch)
        const resizeObserver = new ResizeObserver((entries) => {
            if (entries.length > 0 && chartRef.current) {
                const { width, height } = entries[0].contentRect;
                if (width > 0 && height > 0) {
                    chartRef.current.applyOptions({ width, height });
                    if (prevWidthRef.current === 0) {
                        chartRef.current.timeScale().fitContent();
                    }
                    prevWidthRef.current = width;
                } else {
                    prevWidthRef.current = 0;
                }
            }
        });
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
            chart.remove();
        };
    }, []);

    useEffect(() => {
        if (!data || !oiSupportSeriesRef.current || !oiResistanceSeriesRef.current || 
            !coiSupportSeriesRef.current || !coiResistanceSeriesRef.current || !spotSeriesRef.current) return;

        // Helper to format data
        const formatData = (values: (number | null)[]) => {
            return data.timestamps.map((ts, i) => {
                if (values[i] === null) return null;
                return {
                    time: ts / 1000 as any,
                    value: values[i] as number,
                };
            }).filter(item => item !== null) as any[];
        };

        const oiSupportData = formatData(data.oi_support);
        const oiResistanceData = formatData(data.oi_resistance);
        const coiSupportData = formatData(data.coi_support);
        const coiResistanceData = formatData(data.coi_resistance);

        oiSupportData.sort((a, b) => (a.time as number) - (b.time as number));
        oiResistanceData.sort((a, b) => (a.time as number) - (b.time as number));
        coiSupportData.sort((a, b) => (a.time as number) - (b.time as number));
        coiResistanceData.sort((a, b) => (a.time as number) - (b.time as number));

        if (showOi) {
            oiSupportSeriesRef.current.setData(oiSupportData);
            oiResistanceSeriesRef.current.setData(oiResistanceData);
            oiSupportSeriesRef.current.applyOptions({ visible: true });
            oiResistanceSeriesRef.current.applyOptions({ visible: true });
        } else {
            oiSupportSeriesRef.current.applyOptions({ visible: false });
            oiResistanceSeriesRef.current.applyOptions({ visible: false });
        }

        if (showCoi) {
            coiSupportSeriesRef.current.setData(coiSupportData);
            coiResistanceSeriesRef.current.setData(coiResistanceData);
            coiSupportSeriesRef.current.applyOptions({ visible: true });
            coiResistanceSeriesRef.current.applyOptions({ visible: true });
        } else {
            coiSupportSeriesRef.current.applyOptions({ visible: false });
            coiResistanceSeriesRef.current.applyOptions({ visible: false });
        }

        if (showSpot && spotData && spotData.timestamps && spotData.prices) {
            // Aggregate spot data to 1-minute intervals to match WebSocket updates
            const spotMap = new Map<number, number>();
            spotData.timestamps.forEach((ts: number, i: number) => {
                const time = Math.floor((ts / 1000) / 60) * 60;
                spotMap.set(time, spotData.prices[i]); // Keep latest price for the minute
            });

            const spotSeriesData = Array.from(spotMap.entries())
                .map(([time, value]) => ({
                    time: time as any,
                    value: value,
                }))
                .sort((a: any, b: any) => (a.time as number) - (b.time as number));

                if (spotSeriesData.length > 0) {
                lastSpotTimeRef.current = spotSeriesData[spotSeriesData.length - 1].time as number;
            } else {
                lastSpotTimeRef.current = null;
            }

            spotSeriesRef.current.setData(spotSeriesData);
            spotSeriesRef.current.applyOptions({ visible: true });
        } else {
            spotSeriesRef.current.applyOptions({ visible: false });
        }
        
        if (chartRef.current && shouldFitContent.current) {
             chartRef.current.timeScale().fitContent();
             shouldFitContent.current = false;
        }

    }, [data, showOi, showCoi, showSpot, spotData]);

    return (
        <Card className="border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-0 pt-0">
                <CardTitle className="text-base font-bold">Support vs Resistance</CardTitle>
                <div className="flex items-center gap-4">
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="live-mode" className="text-xs font-semibold flex items-center gap-1">
                            {isLive ? <Zap className="h-3 w-3 text-yellow-500 fill-yellow-500" /> : <ZapOff className="h-3 w-3" />}
                            Live
                        </Label>
                        <Switch 
                            id="live-mode" 
                            checked={isLive}
                            onCheckedChange={setIsLive}
                        />
                    </div>
                    <div className="flex items-center space-x-2">
                        <Label htmlFor="show-oi-sr" className="text-xs font-semibold">OI S/R</Label>
                        <Switch 
                            id="show-oi-sr" 
                            checked={showOi}
                            onCheckedChange={setShowOi}
                        />
                    </div>
                    <div className="flex items-center space-x-2">
                        <Label htmlFor="show-coi-sr" className="text-xs font-semibold">COI S/R</Label>
                        <Switch 
                            id="show-coi-sr" 
                            checked={showCoi}
                            onCheckedChange={setShowCoi}
                        />
                    </div>
                    <div className="flex items-center space-x-2">
                        <Label htmlFor="show-spot-sr" className="text-xs font-semibold">Spot</Label>
                        <Switch 
                            id="show-spot-sr" 
                            checked={showSpot}
                            onCheckedChange={setShowSpot}
                        />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => { fetchData(); fetchSpotData(); }} disabled={isLoading}>
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div ref={chartContainerRef} className="w-full h-[calc(100vh-300px)]" />
            </CardContent>
        </Card>
    );
}
