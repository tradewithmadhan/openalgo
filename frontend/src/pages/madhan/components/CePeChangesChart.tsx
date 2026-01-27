import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
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

interface CePeChangesData {
    timestamps: number[];
    ce_changes: number[];
    pe_changes: number[];
}

interface SpotData {
    timestamps: number[];
    prices: number[];
}

interface CePeChangesChartProps {
    refreshTrigger: number;
}

export function CePeChangesChart({ refreshTrigger }: CePeChangesChartProps) {
    const { mode } = useThemeStore();
    const [data, setData] = useState<CePeChangesData | null>(null);
    const [spotData, setSpotData] = useState<SpotData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [strikeMode, setStrikeMode] = useState<'option1' | 'option2'>('option2'); // option2 (Writers View) default
    const [showDivergence, setShowDivergence] = useState(false);
    const [showSpot, setShowSpot] = useState(false);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                strike_selection_mode: strikeMode,
                upside_strikes: '10',
                downside_strikes: '10'
            });
            const response = await fetch(`/madhan/api/nifty/ce-pe-changes?${params.toString()}`);
            const json = await response.json();
            if (json.status === 'success') {
                setData(json.data);
            }
        } catch (error) {
            console.error("Failed to fetch CE/PE Changes data", error);
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
    }, [refreshTrigger, strikeMode]);

    const chartData: ChartData<'bar' | 'line'> = useMemo(() => {
        if (!data || !data.timestamps || data.timestamps.length === 0) {
            return { labels: [], datasets: [] };
        }

        // Generate full day timestamps (9:15 to 15:30)
        const timestamps: number[] = [];
        const ceData: (number | null)[] = [];
        const peData: (number | null)[] = [];
        
        // Determine interval (default 3 min = 180000 ms)
        let interval = 3 * 60 * 1000;
        if (data.timestamps.length >= 2) {
            interval = data.timestamps[1] - data.timestamps[0];
        }

        // Set start time to 9:15 AM of the data date
        const baseDate = new Date(data.timestamps[0]);
        baseDate.setHours(9, 15, 0, 0);
        let currentTime = baseDate.getTime();

        // Set end time to 3:30 PM
        const endDate = new Date(baseDate);
        endDate.setHours(15, 30, 0, 0);
        const endTime = endDate.getTime();

        // Create map for O(1) lookup
        const dataMap = new Map<number, { ce: number, pe: number }>();
        data.timestamps.forEach((ts, i) => {
            // Round timestamp to nearest interval to handle slight drifts
            // But usually exact match is better if data is consistent
            dataMap.set(ts, { 
                ce: data.ce_changes[i], 
                pe: data.pe_changes[i] 
            });
        });

        while (currentTime <= endTime) {
            timestamps.push(currentTime);
            
            // Look for data point (allow some tolerance if needed, but exact for now)
            // To handle potential slight time mismatches, we could check a range, 
            // but assuming aligned data for now.
            // Let's try to find an exact match first.
            const exactMatch = dataMap.get(currentTime);
            
            if (exactMatch) {
                ceData.push(exactMatch.ce);
                peData.push(exactMatch.pe);
            } else {
                // Try finding a match within tolerance (e.g. +/- 1 sec)
                // or just push null
                // Actually, if we generated the timestamps based on the first one, 
                // we might drift if the source data has gaps or irregular intervals.
                // Better approach: use the generated timeline and match.
                ceData.push(null);
                peData.push(null);
            }

            currentTime += interval;
        }
        
        // However, if the generated loop misses the actual data points because of alignment,
        // we should double check. 
        // If the data.timestamps are not perfectly 9:15, 9:18... 
        // Let's rely on the actual data timestamps for the "filled" parts and only null fill the rest.
        // A safer way:
        // 1. Take all existing timestamps.
        // 2. Generate missing timestamps.
        // 3. Sort and merge.
        
        // Let's re-implement simpler:
        // 1. Get existing data
        // 2. Determine last timestamp.
        // 3. Generate timestamps from (last + interval) until 15:30.
        // 4. Append these with null values.
        
        const filledTimestamps = [...data.timestamps];
        const filledCeData: (number | null)[] = [...(data.ce_changes || [])];
        const filledPeData: (number | null)[] = [...(data.pe_changes || [])];
        
        const lastTs = filledTimestamps[filledTimestamps.length - 1];
        
        const targetEnd = new Date(lastTs);
        targetEnd.setHours(15, 30, 0, 0);
        
        let nextTime = lastTs + interval;
        while (nextTime <= targetEnd.getTime()) {
             filledTimestamps.push(nextTime);
             filledCeData.push(null as any); // ChartJS handles null
             filledPeData.push(null as any);
             nextTime += interval;
        }

        const labels = filledTimestamps.map(ts => 
            new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
        );

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
            const ceVal = filledCeData[i];
            const peVal = filledPeData[i];

            // If null, push default transparent/skip
            if (ceVal === null || peVal === null) {
                 ceBgColors.push('transparent');
                 ceBorderColors.push('transparent');
                 peBgColors.push('transparent');
                 peBorderColors.push('transparent');
                 divergenceMarkerData.push(null);
                 divergenceMarkerColors.push('transparent');
                 continue;
            }

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
                data: filledCeData,
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
                data: filledPeData,
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
             
             const lastSpotTimestamp = spotData.timestamps[spotData.timestamps.length - 1];

             for (let i = 0; i < filledTimestamps.length; i++) {
                const cepeTimestamp = filledTimestamps[i];
                
                // If timestamp is ahead of last known spot data by more than 5 minutes, stop plotting
                if (cepeTimestamp > lastSpotTimestamp + 5 * 60 * 1000) {
                    alignedSpotPrices.push(null);
                    continue;
                }

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
                
                if (current === null || previous === null || current === undefined || previous === undefined) {
                    segmentColors.push('rgba(156, 163, 175, 1)'); // Default/Gap
                    continue;
                }

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
                <CardTitle className="text-base font-bold">CE/PE Changes per Candle</CardTitle>
                <div className="flex flex-wrap items-center gap-4">
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="writers-view-cepe" className="text-xs font-semibold">Writers View</Label>
                        <Switch 
                            id="writers-view-cepe" 
                            checked={strikeMode === 'option2'}
                            onCheckedChange={(checked) => setStrikeMode(checked ? 'option2' : 'option1')}
                        />
                    </div>
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="divergence-cepe" className="text-xs font-semibold">Divergence</Label>
                        <Switch 
                            id="divergence-cepe" 
                            checked={showDivergence}
                            onCheckedChange={setShowDivergence}
                        />
                    </div>
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="spot-cepe" className="text-xs font-semibold">Spot</Label>
                        <Switch 
                            id="spot-cepe" 
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
                <div className="w-full h-[calc(50vh-220px)]">
                     <Chart type='bar' data={chartData} options={options} />
                </div>
            </CardContent>
        </Card>
    );
}
