import { createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi, BaselineSeries, LineSeries } from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useThemeStore } from '@/stores/themeStore';

interface CoiTrendData {
    timestamps: number[];
    coi_percent: number[];
    oi_trend_percent: number[];
}

interface CoiTrendChartProps {
    refreshTrigger: number;
}

export function CoiTrendChart({ refreshTrigger }: CoiTrendChartProps) {
    const { mode } = useThemeStore();
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const coiSeriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);
    const oiTrendSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const spotSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const prevWidthRef = useRef(0);
    const shouldFitContent = useRef(true);

    const [data, setData] = useState<CoiTrendData | null>(null);
    const [spotData, setSpotData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showTrend, setShowTrend] = useState(true);
    const [showSpot, setShowSpot] = useState(false);
    const [strikeMode, setStrikeMode] = useState<'option1' | 'option2'>('option2'); // option2 (Writers View) default

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                strike_selection_mode: strikeMode,
                upside_strikes: '10',
                downside_strikes: '10'
            });
            const response = await fetch(`/madhan/api/nifty/coi-trend?${params.toString()}`);
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
            const response = await fetch('/madhan/api/nifty/spot-data');
            const json = await response.json();
            if (json.status === 'success') {
                setSpotData(json.data);
            }
        } catch (error) {
            console.error("Failed to fetch Spot data", error);
        }
    };

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
        applyTheme(chartRef.current, mode === 'dark');
        
        if (spotSeriesRef.current) {
            const spotColor = mode === 'dark' ? '#d1d5db' : '#4b5563';
            spotSeriesRef.current.applyOptions({ color: spotColor });
        }
    }, [mode]);

    useEffect(() => {
        fetchData();
        fetchSpotData();
    }, [refreshTrigger, strikeMode]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#d1d5db',
            },
            grid: {
                vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
                horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
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
            },
            leftPriceScale: {
                visible: true,
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

        // Apply initial theme
        applyTheme(chart, mode === 'dark');
        if (spotSeriesRef.current) {
            const spotColor = mode === 'dark' ? '#d1d5db' : '#4b5563';
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
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
            chart.remove();
        };
    }, []);

    useEffect(() => {
        if (!data || !coiSeriesRef.current || !oiTrendSeriesRef.current || !spotSeriesRef.current) return;

        const coiData = data.timestamps.map((ts, i) => ({
            time: ts / 1000 as any, // lightweight-charts expects seconds for UTCTimestamp
            value: data.coi_percent[i],
        }));

        const oiTrendData = data.timestamps.map((ts, i) => ({
            time: ts / 1000 as any,
            value: data.oi_trend_percent[i],
        }));

        // Sort data by time just in case
        coiData.sort((a, b) => (a.time as number) - (b.time as number));
        oiTrendData.sort((a, b) => (a.time as number) - (b.time as number));

        coiSeriesRef.current.setData(coiData);
        if (showTrend) {
            oiTrendSeriesRef.current.setData(oiTrendData);
            // Ensure series is visible
            oiTrendSeriesRef.current.applyOptions({ visible: true });
        } else {
            oiTrendSeriesRef.current.applyOptions({ visible: false });
        }

        if (showSpot && spotData && spotData.timestamps && spotData.prices) {
            const spotSeriesData = spotData.timestamps.map((ts: number, i: number) => ({
                time: ts / 1000 as any,
                value: spotData.prices[i],
            }));
            spotSeriesData.sort((a: any, b: any) => (a.time as number) - (b.time as number));
            spotSeriesRef.current.setData(spotSeriesData);
            spotSeriesRef.current.applyOptions({ visible: true });
        } else {
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
                <div ref={chartContainerRef} className="w-full h-[calc(100vh-300px)]" />
            </CardContent>
        </Card>
    );
}
