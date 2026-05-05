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
  type ChartOptions
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

interface CePeStrikeVolumeChangesData {
  timestamps: number[];
  ce_changes: number[];
  pe_changes: number[];
}

interface SpotData {
  timestamps: number[];
  prices: number[];
}

interface CePeStrikeVolumeChangesChartProps {
  refreshTrigger: number;
  atmStrike?: number;
}

export function CePeStrikeVolumeChangesChart({ refreshTrigger, atmStrike }: CePeStrikeVolumeChangesChartProps) {
  const { mode } = useThemeStore();
  const [data, setData] = useState<CePeStrikeVolumeChangesData | null>(null);
  const [spotData, setSpotData] = useState<SpotData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStrike, setSelectedStrike] = useState<string>("");
  const [strikes, setStrikes] = useState<number[]>([]);
  const [volumeView, setVolumeView] = useState<'split' | 'combined'>('split');
  const [showSpot, setShowSpot] = useState(true);
  const [ignoreFirst, setIgnoreFirst] = useState(true);
  const ignoreCount = 2;

  useEffect(() => {
    if (atmStrike) {
      const newStrikes = [];
      for (let i = -10; i <= 10; i++) {
        newStrikes.push(atmStrike + (i * 50));
      }
      newStrikes.sort((a, b) => b - a);
      setStrikes(newStrikes);
      if (!selectedStrike) {
        setSelectedStrike(atmStrike.toString());
      }
    }
  }, [atmStrike]);

  const fetchData = async () => {
    if (!selectedStrike) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        strike_price: selectedStrike,
      });
      const response = await fetch(`/madhan/api/nifty/ce-pe-strike-volume-changes?${params.toString()}`);
      const json = await response.json();
      if (json.timestamps) {
        setData(json);
      }
    } catch (error) {
      console.error("Failed to fetch CE/PE Strike Volume data", error);
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

    const filledTimestamps: number[] = [];
    const filledCeData: (number | null)[] = [];
    const filledPeData: (number | null)[] = [];
    const combinedData: (number | null)[] = [];

    let interval = 3 * 60 * 1000;
    if (data.timestamps.length >= 2) {
      interval = data.timestamps[1] - data.timestamps[0];
    }

    let currentTime = data.timestamps[0];
    const endTime = new Date(data.timestamps[0]);
    endTime.setHours(15, 30, 0, 0);
    const endTimestamp = endTime.getTime();

    const dataMap = new Map<number, { ce: number, pe: number }>();
    data.timestamps.forEach((ts, idx) => {
      dataMap.set(ts, {
        ce: data.ce_changes[idx],
        pe: data.pe_changes[idx],
      });
    });

    let index = 0;
    while (currentTime <= endTimestamp) {
      filledTimestamps.push(currentTime);
      const entry = dataMap.get(currentTime);
      if (entry) {
        const shouldIgnore = ignoreFirst && index < ignoreCount;
        if (shouldIgnore) {
          filledCeData.push(null);
          filledPeData.push(null);
          combinedData.push(null);
        } else {
          filledCeData.push(entry.ce);
          filledPeData.push(-Math.abs(entry.pe));
          combinedData.push(Math.abs(entry.ce) + Math.abs(entry.pe));
        }
      } else {
        filledCeData.push(null);
        filledPeData.push(null);
        combinedData.push(null);
      }
      index += 1;
      currentTime += interval;
    }

    const datasets: ChartData<'bar' | 'line'>['datasets'] =
      volumeView === 'combined'
        ? [
            {
              type: 'bar' as const,
              label: 'Combined Volume (CE + PE)',
              data: combinedData,
              backgroundColor: 'rgba(59, 130, 246, 0.45)',
              borderColor: 'rgba(59, 130, 246, 0.9)',
              borderWidth: 1,
              barThickness: 'flex',
              maxBarThickness: 60,
              categoryPercentage: 1.0,
              barPercentage: 1.0,
              yAxisID: 'y',
            },
          ]
        : [
            {
              type: 'bar' as const,
              label: 'CE Volume',
              data: filledCeData,
              backgroundColor: 'rgba(16, 185, 129, 0.5)',
              borderColor: 'rgba(16, 185, 129, 0.9)',
              borderWidth: 1,
              barThickness: 'flex',
              maxBarThickness: 60,
              categoryPercentage: 1.0,
              barPercentage: 1.0,
              yAxisID: 'y',
            },
            {
              type: 'bar' as const,
              label: 'PE Volume',
              data: filledPeData,
              backgroundColor: 'rgba(239, 68, 68, 0.5)',
              borderColor: 'rgba(239, 68, 68, 0.9)',
              borderWidth: 1,
              barThickness: 'flex',
              maxBarThickness: 60,
              categoryPercentage: 1.0,
              barPercentage: 1.0,
              yAxisID: 'y',
            },
          ];

    if (showSpot && spotData && spotData.timestamps?.length && spotData.prices?.length) {
      const alignedSpotPrices: (number | null)[] = [];
      const lastSpotTimestamp = spotData.timestamps[spotData.timestamps.length - 1];

      for (let i = 0; i < filledTimestamps.length; i++) {
        const cepeTimestamp = filledTimestamps[i];
        if (cepeTimestamp > lastSpotTimestamp + 60 * 1000) {
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

      datasets.push({
        type: 'line' as const,
        label: 'Spot',
        data: alignedSpotPrices,
        borderColor: mode === 'dark' ? '#60a5fa' : '#2563eb',
        backgroundColor: 'transparent',
        yAxisID: 'y1',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
      });
    }

    return {
      labels: filledTimestamps.map(ts => new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })),
      datasets
    };
  }, [data, spotData, showSpot, mode, ignoreFirst, volumeView]);

  const maxAbs = useMemo(() => {
    const ceVals = data?.ce_changes || [];
    const peVals = data?.pe_changes || [];
    if (volumeView === 'combined') {
      const combinedVals = ceVals.map((v, i) =>
        ignoreFirst && i < ignoreCount ? 0 : Math.abs(v || 0) + Math.abs(peVals[i] || 0)
      );
      return Math.max(1, ...combinedVals);
    }
    const splitCe = ceVals.map((v, i) => (ignoreFirst && i < ignoreCount ? 0 : Math.abs(v || 0)));
    const splitPe = peVals.map((v, i) => (ignoreFirst && i < ignoreCount ? 0 : Math.abs(v || 0)));
    return Math.max(1, ...splitCe, ...splitPe);
  }, [data, ignoreFirst, volumeView]);

  const spotRange = useMemo(() => {
    if (!spotData?.prices?.length) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const p of spotData.prices) {
      if (p === null || p === undefined) continue;
      if (p < min) min = p;
      if (p > max) max = p;
    }
    if (!isFinite(min) || !isFinite(max)) return null;
    return { min, max };
  }, [spotData]);

  const chartOptions: ChartOptions<'bar' | 'line'> = useMemo(() => ({
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
          color: mode === 'dark' ? '#e5e7eb' : '#111827',
          usePointStyle: true,
        },
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      },
      title: {
        display: false,
      },
    },
    scales: {
      x: {
        ticks: {
          color: mode === 'dark' ? '#9ca3af' : '#6b7280',
          maxTicksLimit: 12,
        },
        grid: {
          color: mode === 'dark' ? 'rgba(75, 85, 99, 0.3)' : 'rgba(229, 231, 235, 0.6)',
        },
      },
      y: {
        suggestedMin: volumeView === 'combined' ? 0 : -maxAbs,
        suggestedMax: maxAbs,
        ticks: {
          color: mode === 'dark' ? '#9ca3af' : '#6b7280',
        },
        grid: {
          color: mode === 'dark' ? 'rgba(75, 85, 99, 0.3)' : 'rgba(229, 231, 235, 0.6)',
        },
      },
      y1: {
        position: 'right',
        display: showSpot,
        beginAtZero: false,
        grace: '5%',
        suggestedMin: spotRange ? spotRange.min : undefined,
        suggestedMax: spotRange ? spotRange.max : undefined,
        grid: {
          drawOnChartArea: false,
        },
        ticks: {
          color: mode === 'dark' ? '#9ca3af' : '#6b7280',
        },
      },
    },
  }), [mode, maxAbs, showSpot, spotRange, volumeView]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-2">
        <CardTitle className="text-sm font-semibold">CE/PE Strike Changes per Candle (Volume)</CardTitle>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">Strike</Label>
            <Select value={selectedStrike} onValueChange={setSelectedStrike}>
              <SelectTrigger className="h-7 w-[120px] text-[11px]">
                <SelectValue placeholder="Select strike" />
              </SelectTrigger>
              <SelectContent>
                {strikes.map((strike) => (
                  <SelectItem key={strike} value={strike.toString()}>
                    {strike}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">Ignore first 2</Label>
            <Switch checked={ignoreFirst} onCheckedChange={setIgnoreFirst} />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">Combined</Label>
            <Switch
              checked={volumeView === 'combined'}
              onCheckedChange={(v) => setVolumeView(v ? 'combined' : 'split')}
            />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">Spot</Label>
            <Switch checked={showSpot} onCheckedChange={setShowSpot} />
          </div>
          <Button size="icon" variant="ghost" onClick={fetchData} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="w-full h-[calc(50vh-220px)]">
          <Chart type='bar' data={chartData} options={chartOptions} />
        </div>
      </CardContent>
    </Card>
  );
}
