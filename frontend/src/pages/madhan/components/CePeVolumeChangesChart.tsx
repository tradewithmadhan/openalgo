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

interface CePeVolumeChangesData {
  timestamps: number[];
  ce_changes: number[];
  pe_changes: number[];
}

interface SpotData {
  timestamps: number[];
  prices: number[];
}

interface CePeVolumeChangesChartProps {
  refreshTrigger: number;
}

export function CePeVolumeChangesChart({ refreshTrigger }: CePeVolumeChangesChartProps) {
  const { mode } = useThemeStore();
  const [data, setData] = useState<CePeVolumeChangesData | null>(null);
  const [spotData, setSpotData] = useState<SpotData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [strikeMode, setStrikeMode] = useState<'option1' | 'option2'>('option2');
  const [showSpot, setShowSpot] = useState(true);
  const [ignoreFirst, setIgnoreFirst] = useState(true);
  const ignoreCount = 2;

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        strike_selection_mode: strikeMode,
        upside_strikes: '10',
        downside_strikes: '10'
      });
      const response = await fetch(`/madhan/api/nifty/ce-pe-volume-changes?${params.toString()}`);
      const json = await response.json();
      if (json.status === 'success') {
        setData(json.data);
      }
    } catch (error) {
      console.error("Failed to fetch CE/PE Volume data", error);
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

    const timestamps: number[] = [];
    const ceData: (number | null)[] = [];
    const peData: (number | null)[] = [];

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
        pe: data.pe_changes[idx]
      });
    });

    let index = 0;
    while (currentTime <= endTimestamp) {
      timestamps.push(currentTime);
      const entry = dataMap.get(currentTime);
      if (entry) {
        const shouldIgnore = ignoreFirst && index < ignoreCount;
        ceData.push(shouldIgnore ? null : entry.ce);
        peData.push(shouldIgnore ? null : -Math.abs(entry.pe));
      } else {
        ceData.push(null);
        peData.push(null);
      }
      index += 1;
      currentTime += interval;
    }

    const datasets: ChartData<'bar' | 'line'>['datasets'] = [
        {
          type: 'bar' as const,
          label: 'CE Volume',
          data: ceData,
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
          data: peData,
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

      for (let i = 0; i < timestamps.length; i++) {
        const cepeTimestamp = timestamps[i];
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
      labels: timestamps.map(ts => new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })),
      datasets
    };
  }, [data, spotData, showSpot, mode, ignoreFirst]);

  const maxAbs = useMemo(() => {
    const ceVals = (data?.ce_changes || []).map((v, i) => (ignoreFirst && i < ignoreCount ? 0 : Math.abs(v || 0)));
    const peVals = (data?.pe_changes || []).map((v, i) => (ignoreFirst && i < ignoreCount ? 0 : Math.abs(v || 0)));
    return Math.max(1, ...ceVals, ...peVals);
  }, [data, ignoreFirst]);

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
        suggestedMin: -maxAbs,
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
  }), [mode, maxAbs, showSpot, spotRange]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-2">
        <CardTitle className="text-sm font-semibold">CE/PE Changes per Candle (Volume)</CardTitle>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">Writers</Label>
            <Switch checked={strikeMode === 'option2'} onCheckedChange={(v) => setStrikeMode(v ? 'option2' : 'option1')} />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-[11px]">Ignore first 2</Label>
            <Switch checked={ignoreFirst} onCheckedChange={setIgnoreFirst} />
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
