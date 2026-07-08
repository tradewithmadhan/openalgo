import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useThemeStore } from '@/stores/themeStore';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  LineController,
  BarController,
  type ChartData,
  type ChartOptions,
  type ScriptableContext
} from 'chart.js';
import { Chart } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  LineController,
  BarController
);

interface CePeStrikeChangesData {
    timestamps: number[];
    ce_changes: number[];
    pe_changes: number[];
}

interface SpotData {
    timestamps: number[];
    prices: number[];
}

interface CePeStrikeChangesChartProps {
    refreshTrigger: number;
    atmStrike?: number;
}

export function CePeStrikeChangesChart({ refreshTrigger, atmStrike }: CePeStrikeChangesChartProps) {
    const { mode } = useThemeStore();
    const [data, setData] = useState<CePeStrikeChangesData | null>(null);
    const [spotData, setSpotData] = useState<SpotData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedStrike, setSelectedStrike] = useState<string>("");
    const [strikes, setStrikes] = useState<number[]>([]);
    const [showDivergence, setShowDivergence] = useState(true);
    const [showSpot, setShowSpot] = useState(true);

    useEffect(() => {
        console.log('CePeStrikeChangesChart atmStrike:', atmStrike);
        if (atmStrike) {
            const newStrikes = [];
            // Generate +/- 10 strikes around ATM (step 50 for Nifty)
            for (let i = -10; i <= 10; i++) {
                newStrikes.push(atmStrike + (i * 50));
            }
            // Sort strikes descending (higher strikes on top)
            newStrikes.sort((a, b) => b - a);
            setStrikes(newStrikes);
            
            // If no strike is selected, or if the current selected strike is not in the new list (optional, but good for safety), select ATM
            if (!selectedStrike) {
                console.log('Setting default selectedStrike:', atmStrike);
                setSelectedStrike(atmStrike.toString());
            }
        }
    }, [atmStrike]);

    const fetchData = async () => {
        if (!selectedStrike) {
            console.log('Skipping fetch - no selectedStrike');
            return;
        }
        
        console.log('Fetching CE/PE Strike Changes for:', selectedStrike);
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                strike_price: selectedStrike,
            });
            const response = await fetch(`/madhan/api/nifty/ce-pe-strike-changes?${params.toString()}&_=${Date.now()}`);
            const json = await response.json();
            // API returns data directly without status wrapper
            if (json.timestamps) {
                // console.log('Fetch success, data points:', json.timestamps.length);
                setData(json);
            } else {
                console.error('Fetch failed or no data:', json);
            }
        } catch (error) {
            console.error("Failed to fetch CE/PE Strike Changes data", error);
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

    useEffect(() => {
        fetchData();
        fetchSpotData();
    }, [refreshTrigger, selectedStrike]);

    const chartData: ChartData<'bar' | 'line'> = useMemo(() => {
        if (!data || !data.timestamps || data.timestamps.length === 0) {
            return { labels: [], datasets: [] };
        }

        // Fill data with nulls until 15:30
        const filledTimestamps = [...data.timestamps];
        const filledCeData: (number | null)[] = [...(data.ce_changes || [])];
        const filledPeData: (number | null)[] = [...(data.pe_changes || [])];
        
        const lastTs = filledTimestamps[filledTimestamps.length - 1];
        if (lastTs) {
             const lastDate = new Date(lastTs);
             const targetEnd = new Date(lastDate);
             targetEnd.setHours(15, 30, 0, 0);
             
             // Determine interval (default to 3 mins if not enough points)
             let interval = 3 * 60 * 1000;
             if (filledTimestamps.length >= 2) {
                 interval = filledTimestamps[filledTimestamps.length - 1] - filledTimestamps[filledTimestamps.length - 2];
             }

             let nextTime = lastTs + interval;
             while (nextTime <= targetEnd.getTime()) {
                 filledTimestamps.push(nextTime);
                 filledCeData.push(null);
                 filledPeData.push(null);
                 nextTime += interval;
             }
        }

        const labels = filledTimestamps.map(ts => 
            new Date(ts).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' })
        );

        const ceData = filledCeData;
        const peData = filledPeData;

        const ceBgColors: string[] = [];
        const ceBorderColors: string[] = [];
        const peBgColors: string[] = [];
        const peBorderColors: string[] = [];
        const divergenceMarkerData: (number | null)[] = [];
        const divergenceMarkerColors: string[] = [];

        const ceBaseBg = 'rgba(239, 68, 68, 0.8)';
        const ceBaseBorder = 'rgba(239, 68, 68, 1)';
        const peBaseBg = 'rgba(59, 130, 246, 0.8)';
        const peBaseBorder = 'rgba(59, 130, 246, 1)';

        for (let i = 0; i < labels.length; i++) {
            const ceVal = ceData[i] || 0;
            const peVal = peData[i] || 0;

            let isDivergentRaw = false;
            let divergenceBg = null;
            let divergenceBorder = null;

            if (ceVal > 0 && peVal < 0) {
                isDivergentRaw = true;
                divergenceBg = 'rgba(239, 68, 68, 0.9)';
                divergenceBorder = 'rgba(239, 68, 68, 1)';
            } else if (peVal > 0 && ceVal < 0) {
                isDivergentRaw = true;
                divergenceBg = 'rgba(59, 130, 246, 0.9)';
                divergenceBorder = 'rgba(59, 130, 246, 1)';
            } else if (ceVal < 0 && peVal < 0) {
                const absCe = Math.abs(ceVal);
                const absPe = Math.abs(peVal);
                if (absCe > 2 * absPe) {
                    isDivergentRaw = true;
                    divergenceBg = 'rgba(59, 130, 246, 0.9)';
                    divergenceBorder = 'rgba(59, 130, 246, 1)';
                } else if (absPe > 2 * absCe) {
                    isDivergentRaw = true;
                    divergenceBg = 'rgba(239, 68, 68, 0.9)';
                    divergenceBorder = 'rgba(239, 68, 68, 1)';
                }
            }

            const isDivergent = showDivergence && isDivergentRaw;

            let markerValue: number | null = null;
            let markerColor = null;

            if (isDivergent && divergenceBg && divergenceBorder) {
                ceBgColors.push(divergenceBg);
                ceBorderColors.push(divergenceBorder);
                peBgColors.push(divergenceBg);
                peBorderColors.push(divergenceBorder);

                const minVal = Math.min(ceVal, peVal);
                // Calculate offset for marker
                const localMaxAbs = Math.max(Math.abs(ceVal), Math.abs(peVal));
                const offset = localMaxAbs * 0.1 || 1;
                
                markerValue = minVal - offset;
                markerColor = divergenceBorder;
            } else {
                ceBgColors.push(ceBaseBg);
                ceBorderColors.push(ceBaseBorder);
                peBgColors.push(peBaseBg);
                peBorderColors.push(peBaseBorder);
            }

            divergenceMarkerData.push(markerValue);
            divergenceMarkerColors.push(markerColor || 'transparent');
        }

        const datasets: any[] = [
            {
                type: 'bar' as const,
                label: 'CE Change',
                data: ceData,
                backgroundColor: ceBgColors,
                borderColor: ceBorderColors,
                borderWidth: 2,
                barThickness: 'flex',
                maxBarThickness: 60,
                yAxisID: 'y',
                order: 2,
            },
            {
                type: 'bar' as const,
                label: 'PE Change',
                data: peData,
                backgroundColor: peBgColors,
                borderColor: peBorderColors,
                borderWidth: 2,
                barThickness: 'flex',
                maxBarThickness: 60,
                yAxisID: 'y',
                order: 3,
            }
        ];

        if (showDivergence) {
            datasets.push({
                type: 'line' as const,
                label: 'Divergence',
                data: divergenceMarkerData,
                backgroundColor: divergenceMarkerColors,
                borderColor: divergenceMarkerColors,
                borderWidth: 0,
                pointRadius: (ctx: ScriptableContext<'line'>) => {
                    const val = ctx.raw as number | null;
                    return (val === null || val === undefined) ? 0 : 4;
                },
                pointStyle: 'circle',
                fill: false,
                yAxisID: 'y',
                order: 1,
            });
        }

        if (showSpot && spotData && spotData.timestamps && spotData.prices && spotData.timestamps.length > 0) {
             const alignedSpotPrices = [];
             const segmentColors: string[] = [];
             
             for (let i = 0; i < data.timestamps.length; i++) {
                const cepeTimestamp = data.timestamps[i];
                let closestIndex = 0;
                let minDiff = Math.abs(spotData.timestamps[0] - cepeTimestamp);

                for (let j = 1; j < spotData.timestamps.length; j++) {
                    const diff = Math.abs(spotData.timestamps[j] - cepeTimestamp);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIndex = j;
                    }
                }
                alignedSpotPrices.push(spotData.prices[closestIndex]);
            }

             for (let i = 1; i < alignedSpotPrices.length; i++) {
                const current = alignedSpotPrices[i];
                const previous = alignedSpotPrices[i - 1];
                if (current > previous) {
                    segmentColors.push('rgba(34, 197, 94, 1)'); // Green
                } else {
                    segmentColors.push('rgba(239, 68, 68, 1)'); // Red
                }
            }

            datasets.push({
                type: 'line' as const,
                label: 'Nifty Spot',
                data: alignedSpotPrices,
                borderColor: 'rgba(156, 163, 175, 1)', // Fallback
                backgroundColor: 'transparent',
                borderWidth: 1,
                fill: false,
                yAxisID: 'y1',
                tension: 0,
                pointRadius: 0,
                segment: {
                    borderColor: (ctx: any) => {
                         const index = ctx.p0DataIndex;
                         if (index < segmentColors.length) {
                             return segmentColors[index];
                         }
                         return 'rgba(156, 163, 175, 1)';
                    }
                },
                order: 0,
            });
        }

        return {
            labels,
            datasets,
        };
    }, [data, showDivergence, showSpot, spotData]);

    const isDark = mode === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#d1d5db' : '#374151';

    const options: ChartOptions<'bar' | 'line'> = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    color: textColor,
                    usePointStyle: true,
                }
            },
            title: {
                display: false,
            },
            tooltip: {
                 backgroundColor: 'rgba(0, 0, 0, 0.8)',
                 titleColor: '#f3f4f6',
                 bodyColor: '#d1d5db',
                 borderColor: 'rgba(255, 255, 255, 0.1)',
                 borderWidth: 1,
            }
        },
        scales: {
            x: {
                grid: {
                    color: gridColor,
                },
                ticks: {
                    color: textColor,
                }
            },
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                grid: {
                    color: gridColor,
                },
                ticks: {
                    color: textColor,
                },
                title: {
                    display: true,
                    text: 'Change in OI',
                    color: textColor
                }
            },
            y1: {
                type: 'linear',
                display: showSpot, // Only display if spot is shown
                position: 'right',
                beginAtZero: false,
                grace: '5%',
                grid: {
                    drawOnChartArea: false,
                },
                ticks: {
                    color: textColor,
                },
                title: {
                    display: true,
                    text: 'Nifty Spot',
                    color: textColor
                }
            }
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-bold">CE/PE Strike Changes per Candle</CardTitle>
                <div className="flex flex-wrap items-center gap-4">
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="divergence-cepestrike" className="text-xs font-semibold">Divergence</Label>
                        <Switch 
                            id="divergence-cepestrike" 
                            checked={showDivergence}
                            onCheckedChange={setShowDivergence}
                        />
                    </div>
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="spot-cepestrike" className="text-xs font-semibold">Spot</Label>
                        <Switch 
                            id="spot-cepestrike" 
                            checked={showSpot}
                            onCheckedChange={setShowSpot}
                        />
                    </div>
                     <Select value={selectedStrike} onValueChange={setSelectedStrike}>
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                            <SelectValue placeholder="Strike" />
                        </SelectTrigger>
                        <SelectContent>
                            {strikes.map((strike) => (
                                <SelectItem key={strike} value={strike.toString()}>
                                    {strike}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => { fetchData(); fetchSpotData(); }} disabled={isLoading}>
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="w-full h-[calc(50vh-220px)]">
                     <Chart type='bar' data={chartData} options={options} />
                </div>
            </CardContent>
        </Card>
    );
}
