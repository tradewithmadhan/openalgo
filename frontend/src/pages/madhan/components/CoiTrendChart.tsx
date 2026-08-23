import { createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi, BaselineSeries, LineSeries } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMadhanTheme } from '@/pages/madhan/useMadhanTheme';
import { Zap, ZapOff } from 'lucide-react';
import { showToast } from '@/utils/toast';
import { useInstrument } from '../InstrumentContext';

interface CoiTrendData {
    timestamps: number[];
    coi_percent: number[];
    oi_trend_percent: number[];
}

interface CoiTrendChartProps {
    refreshTrigger: number;
}

export function CoiTrendChart({ refreshTrigger }: CoiTrendChartProps) {
    const { instrument } = useInstrument();
    const { mode: madhanMode } = useMadhanTheme();
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const coiSeriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);
    const oiTrendSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const spotSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const spotSeriesDataRef = useRef<Array<{ time: any; value: number }>>([]);
    const lastSpotTimeRef = useRef<number | null>(null);
    const prevWidthRef = useRef(0);
    const shouldFitContent = useRef(true);
    const wsRef = useRef<WebSocket | null>(null);
    const chartActiveRef = useRef(false);

    const [data, setData] = useState<CoiTrendData | null>(null);
    const [spotData, setSpotData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLive, setIsLive] = useState(true);
    const [showTrend, setShowTrend] = useState(true);
    const [showSpot, setShowSpot] = useState(true);
    const [strikeMode, setStrikeMode] = useState<'option1' | 'option2'>('option2'); // option2 (Writers View) default

    const toValidSpotPoint = (timeRaw: unknown, valueRaw: unknown): { time: any; value: number } | null => {
        const timeNum = typeof timeRaw === 'string' ? Number(timeRaw) : timeRaw;
        const valueNum = typeof valueRaw === 'string' ? Number(valueRaw) : valueRaw;
        if (!Number.isFinite(timeNum) || !Number.isFinite(valueNum)) return null;
        if ((valueNum as number) <= 0) return null;
        return {
            time: timeNum as any,
            value: valueNum as number,
        };
    };

    const toValidTrendPoint = (timeRaw: unknown, valueRaw: unknown): { time: any; value: number } | null => {
        const timeNum = typeof timeRaw === 'string' ? Number(timeRaw) : timeRaw;
        const valueNum = typeof valueRaw === 'string' ? Number(valueRaw) : valueRaw;
        if (!Number.isFinite(timeNum) || !Number.isFinite(valueNum)) return null;
        return {
            time: timeNum as any,
            value: valueNum as number,
        };
    };

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                strike_selection_mode: strikeMode,
                upside_strikes: '10',
                downside_strikes: '10'
            });
            params.set('instrument', instrument);
            const response = await fetch(`/madhan/api/nifty/coi-trend?${params.toString()}&_=${Date.now()}`);
            const json = await response.json();
            if (json.status === 'success') {
                setData(json.data);
            }
        } catch (error) {
            console.error("Failed to fetch COI Trend data", error);
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

    // WebSocket Connection for live spot LTP
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
                const csrfResponse = await fetch('/auth/csrf-token', { credentials: 'include' });
                const csrfData = await csrfResponse.json();
                const csrfToken = csrfData.csrf_token;

                const configResponse = await fetch('/api/websocket/config', {
                    headers: { 'X-CSRFToken': csrfToken },
                    credentials: 'include',
                });
                const configData = await configResponse.json();

                if (configData.status !== 'success') throw new Error('Config fetch failed');

                const socket = new WebSocket(configData.websocket_url);
                wsRef.current = socket;

                socket.onopen = async () => {
                    try {
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
                        if (!chartActiveRef.current) return;
                        if (wsRef.current !== socket) return;
                        const message = JSON.parse(event.data);
                        const type = message.type || message.status;

                        if (type === 'auth' && message.status === 'success') {
                            showToast.success('Live connection established');
                            socket.send(JSON.stringify({
                                action: 'subscribe',
                                symbols: [{ symbol: instrument, exchange: 'NSE_INDEX' }],
                                mode: 1,
                            }));
                        } else if (type === 'market_data' && message.data) {
                            const { symbol, exchange, data } = message;
                            const ltpRaw = data?.ltp ?? data?.data?.ltp;
                            const ltp = typeof ltpRaw === 'string' ? Number(ltpRaw) : ltpRaw;

                            if (
                                symbol === instrument &&
                                exchange === 'NSE_INDEX' &&
                                Number.isFinite(ltp) &&
                                ltp > 0 &&
                                spotSeriesRef.current
                            ) {
                                let rawTime: number;
                                if (data.timestamp) {
                                    if (typeof data.timestamp === 'number') {
                                        rawTime = data.timestamp < 100000000000 ? data.timestamp : data.timestamp / 1000;
                                    } else {
                                        rawTime = new Date(data.timestamp).getTime() / 1000;
                                    }
                                } else {
                                    rawTime = Date.now() / 1000;
                                }

                                const time = Math.floor(rawTime / 60) * 60;

                                if (lastSpotTimeRef.current !== null && time < lastSpotTimeRef.current) {
                                    return;
                                }

                                try {
                                    if (!chartActiveRef.current || !spotSeriesRef.current) return;
                                    const nextPoint = toValidSpotPoint(time, ltp);
                                    if (!nextPoint) return;

                                    if (spotSeriesDataRef.current.length > 0 && lastSpotTimeRef.current === time) {
                                        spotSeriesDataRef.current[spotSeriesDataRef.current.length - 1] = nextPoint;
                                    } else {
                                        spotSeriesDataRef.current.push(nextPoint);
                                    }

                                    spotSeriesRef.current.setData(spotSeriesDataRef.current);
                                    lastSpotTimeRef.current = time;
                                } catch (err) {
                                    console.error('[WS] COI spot update failed:', err, { time, ltp });
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error parsing WS message', error);
                    }
                };

                socket.onerror = (error) => {
                    console.error('WebSocket Error', error);
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

    // Effect to update chart options when theme changes
    useEffect(() => {
        if (!chartRef.current) return;
        applyTheme(chartRef.current, madhanMode === 'dark');
        
        if (spotSeriesRef.current) {
            const spotColor = madhanMode === 'dark' ? '#d1d5db' : '#4b5563';
            spotSeriesRef.current.applyOptions({ color: spotColor });
        }
    }, [madhanMode]);

    useEffect(() => {
        fetchData();
        fetchSpotData();
    }, [refreshTrigger, strikeMode, instrument]);

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
            height: chartContainerRef.current.clientHeight,
            localization: {
                timeFormatter: (time: number) => {
                    const date = new Date(time * 1000);
                    return date.toLocaleTimeString('en-IN', { 
                        timeZone: 'Asia/Kolkata', 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        hour12: false 
                    });
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
                visible: true,
                borderColor: madhanMode === 'dark' ? 'rgba(42, 46, 57, 0.5)' : 'rgba(209, 213, 219, 0.5)',
            },
            leftPriceScale: {
                visible: true,
                borderColor: madhanMode === 'dark' ? 'rgba(42, 46, 57, 0.5)' : 'rgba(209, 213, 219, 0.5)',
            },
        });

        const coiSeries = chart.addSeries(BaselineSeries, {
            baseValue: { type: 'price', price: 0 },
            topLineColor: '#22c55e', // Green for positive
            bottomLineColor: '#ef4444', // Red for negative
            topFillColor1: 'transparent',
            topFillColor2: 'transparent',
            bottomFillColor1: 'transparent',
            bottomFillColor2: 'transparent',
            lineWidth: 2,
            title: 'COI %',
            priceScaleId: 'right',
        }) as ISeriesApi<"Baseline">;

        coiSeries.createPriceLine({
            price: 0,
            color: 'rgba(255, 255, 255, 0.5)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
            title: '',
        });

        const oiTrendSeries = chart.addSeries(LineSeries, {
            color: '#FF6D00',
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            title: 'OI Trend %',
            priceScaleId: 'right',
        }) as ISeriesApi<"Line">;

        const spotSeries = chart.addSeries(LineSeries, {
            color: '#d1d5db',
            lineWidth: 1,
            title: 'Spot Price',
            priceScaleId: 'left',
        }) as ISeriesApi<"Line">;

        chartRef.current = chart;
        coiSeriesRef.current = coiSeries;
        oiTrendSeriesRef.current = oiTrendSeries;
        spotSeriesRef.current = spotSeries;
        chartActiveRef.current = true;

        // Apply initial theme
        applyTheme(chart, madhanMode === 'dark');
        if (spotSeriesRef.current) {
            const spotColor = madhanMode === 'dark' ? '#d1d5db' : '#4b5563';
            spotSeriesRef.current.applyOptions({ color: spotColor });
        }

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                const width = chartContainerRef.current.clientWidth;
                chartRef.current.applyOptions({ width });
                // If the chart was previously hidden (width 0) and is now visible, fit content
                if (width > 0) {
                    // We can't easily track previous width here without a ref, 
                    // but calling fitContent() on resize is generally safe for this dashboard use case
                    // where precise zoom preservation on window resize is less critical than 
                    // the chart actually showing up when tabs switch.
                    // However, to be safe, let's just ensure we trigger a redraw.
                }
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
            chartActiveRef.current = false;
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            coiSeriesRef.current = null;
            oiTrendSeriesRef.current = null;
            spotSeriesRef.current = null;
            spotSeriesDataRef.current = [];
            lastSpotTimeRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!chartActiveRef.current) return;
        if (!data || !coiSeriesRef.current || !oiTrendSeriesRef.current || !spotSeriesRef.current) return;

        const coiData = data.timestamps
            .map((ts, i) => toValidTrendPoint(ts / 1000, data.coi_percent[i]))
            .filter((p: { time: any; value: number } | null): p is { time: any; value: number } => p !== null);

        const oiTrendData = data.timestamps
            .map((ts, i) => toValidTrendPoint(ts / 1000, data.oi_trend_percent[i]))
            .filter((p: { time: any; value: number } | null): p is { time: any; value: number } => p !== null);

        // Sort data by time just in case
        coiData.sort((a, b) => (a.time as number) - (b.time as number));
        oiTrendData.sort((a, b) => (a.time as number) - (b.time as number));

        try {
            coiSeriesRef.current.setData(coiData);
        } catch (err) {
            console.error('[COI] setData failed', err, { points: coiData.length });
            return;
        }
        if (showTrend) {
            try {
                oiTrendSeriesRef.current.setData(oiTrendData);
            } catch (err) {
                console.error('[OI Trend] setData failed', err, { points: oiTrendData.length });
                return;
            }
            // Ensure series is visible
            oiTrendSeriesRef.current.applyOptions({ visible: true });
        } else {
            oiTrendSeriesRef.current.applyOptions({ visible: false });
        }

        if (showSpot && spotData && spotData.timestamps && spotData.prices) {
            const spotSeriesData = spotData.timestamps.map((ts: number, i: number) => {
                return toValidSpotPoint(ts / 1000, spotData.prices[i]);
            }).filter((p: { time: any; value: number } | null): p is { time: any; value: number } => p !== null);
            spotSeriesData.sort((a: any, b: any) => (a.time as number) - (b.time as number));
            spotSeriesDataRef.current = spotSeriesData;
            try {
                spotSeriesRef.current.setData(spotSeriesDataRef.current);
            } catch (err) {
                console.error('[Spot] setData failed', err, { points: spotSeriesDataRef.current.length });
                return;
            }
            spotSeriesRef.current.applyOptions({ visible: true });

            if (spotSeriesDataRef.current.length > 0) {
                lastSpotTimeRef.current = spotSeriesDataRef.current[spotSeriesDataRef.current.length - 1].time as number;
            } else {
                lastSpotTimeRef.current = null;
            }
        } else {
            spotSeriesDataRef.current = [];
            lastSpotTimeRef.current = null;
            spotSeriesRef.current.applyOptions({ visible: false });
        }
        
        if (chartRef.current && shouldFitContent.current) {
             chartRef.current.timeScale().fitContent();
             shouldFitContent.current = false;
        }

    }, [data, showTrend, showSpot, spotData]);

    return (
        <Card className="border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 px-0 pt-0">
                <CardTitle className="text-base font-bold">OI vs COI Trend</CardTitle>
                <div className="flex items-center gap-4">
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="live-mode-coi" className="text-xs font-semibold flex items-center gap-1">
                            {isLive ? <Zap className="h-3 w-3 text-yellow-500 fill-yellow-500" /> : <ZapOff className="h-3 w-3" />}
                            Live
                        </Label>
                        <Switch
                            id="live-mode-coi"
                            checked={isLive}
                            onCheckedChange={setIsLive}
                        />
                    </div>
                    <div className="flex items-center space-x-2">
                        <Label htmlFor="writers-view" className="text-xs font-semibold">Writers View</Label>
                        <Switch 
                            id="writers-view" 
                            checked={strikeMode === 'option2'}
                            onCheckedChange={(checked) => setStrikeMode(checked ? 'option2' : 'option1')}
                        />
                    </div>
                    <div className="flex items-center space-x-2">
                        <Label htmlFor="show-trend" className="text-xs font-semibold">Show Trend</Label>
                        <Switch 
                            id="show-trend" 
                            checked={showTrend}
                            onCheckedChange={setShowTrend}
                        />
                    </div>
                    <div className="flex items-center space-x-2">
                        <Label htmlFor="show-spot-coi" className="text-xs font-semibold">Spot</Label>
                        <Switch 
                            id="show-spot-coi" 
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
                <div ref={chartContainerRef} className="w-full h-[calc(100vh-280px)]" />
            </CardContent>
        </Card>
    );
}
