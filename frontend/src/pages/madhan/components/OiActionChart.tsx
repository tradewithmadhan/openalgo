import { useEffect, useState, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMadhanTheme } from '../useMadhanTheme';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  Filler,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
  type Chart,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  Filler,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface OiStrikeHistoryResponse {
  status: string;
  timestamps: number[];
  strikes: Record<string, { ce_oi: (number | null)[]; pe_oi: (number | null)[] }>;
}

interface OiActionChartProps {
  refreshTrigger: number;
  atmStrike?: number;
}

function buildColor(baseRgb: string, opacity: number): string {
  return `rgba(${baseRgb}, ${opacity})`;
}

// Generate fixed labels from 09:15 to 15:30 (376 minutes)
function generateFullTimeLabels(): string[] {
  const labels: string[] = [];
  for (let h = 9; h <= 15; h++) {
    for (let m = 0; m < 60; m++) {
      if (h === 9 && m < 15) continue;
      if (h === 15 && m > 30) break;
      labels.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return labels;
}

const FULL_TIME_LABELS = generateFullTimeLabels();

// Build a lookup: label -> index in the full axis
const LABEL_INDEX = new Map<string, number>();
FULL_TIME_LABELS.forEach((label, i) => LABEL_INDEX.set(label, i));

// Crossover marker: { index: number in full axis, color: string }
interface CrossoverMarker {
  index: number;
  color: string;
}

// Vertical line plugin: draws fixed lines at 09:30/15:00 + crossover lines
// Reads crossover markers from chartInstance._crossoverMarkers (set by component)
const verticalLinePlugin = {
  id: 'verticalLines',
  afterDraw(chart: Chart) {
    const ctx = chart.ctx;
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;

    // Fixed lines at 09:30 and 15:00
    const targets = ['09:30', '15:00'];
    for (const target of targets) {
      const idx = LABEL_INDEX.get(target);
      if (idx === undefined) continue;
      const x = xAxis.getPixelForValue(idx);
      if (x < xAxis.left || x > xAxis.right) continue;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(156, 163, 175, 0.6)';
      ctx.lineWidth = 1;
      ctx.moveTo(x, yAxis.top);
      ctx.lineTo(x, yAxis.bottom);
      ctx.stroke();
      ctx.restore();
    }

    // Crossover lines (stored on chart instance by component)
    const crossovers: CrossoverMarker[] = (chart as any)._crossoverMarkers || [];
    for (const co of crossovers) {
      const x = xAxis.getPixelForValue(co.index);
      if (x < xAxis.left || x > xAxis.right) continue;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = co.color;
      ctx.lineWidth = 1.5;
      ctx.moveTo(x, yAxis.top);
      ctx.lineTo(x, yAxis.bottom);
      ctx.stroke();
      ctx.restore();
    }
  },
};

export function OiActionChart({ refreshTrigger, atmStrike }: OiActionChartProps) {
  const { mode } = useMadhanTheme();
  const [data, setData] = useState<OiStrikeHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showFillColor, setShowFillColor] = useState(false);
  const [focusNearAtm, setFocusNearAtm] = useState(false);
  const chartRef = useRef<Chart<'line'>>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/madhan/api/nifty/oi-strike-history?_=${Date.now()}`);
      const json = await response.json();
      if (json.status === 'success') {
        setData(json);
      }
    } catch (error) {
      console.error('Failed to fetch OI strike history', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [refreshTrigger]);

  const chartData: ChartData<'line'> = useMemo(() => {
    if (!data || !data.timestamps || data.timestamps.length === 0 || !data.strikes) {
      return { labels: FULL_TIME_LABELS, datasets: [] };
    }

    // Map API timestamps to HH:MM labels
    const tsToLabel = (ts: number) =>
      new Date(ts * 1000).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });

    const strikes = Object.keys(data.strikes)
      .map(Number)
      .sort((a, b) => a - b);

    if (strikes.length === 0) {
      return { labels: FULL_TIME_LABELS, datasets: [] };
    }

    const atm = atmStrike || strikes[Math.floor(strikes.length / 2)];
    const maxDistance = strikes.reduce((max, s) => Math.max(max, Math.abs(s - atm)), 50);

    const ceBaseRgb = '239, 68, 68';
    const peBaseRgb = '34, 197, 94';

    const datasets: any[] = [];

    for (const strike of strikes) {
      const distance = Math.abs(strike - atm);
      if (focusNearAtm && distance > 100) continue; // ±2 strikes = ±100
      const opacity = Math.max(0.15, 1.0 - Math.pow(distance / maxDistance, 0.5) * 0.85);
      const isAtm = strike === atm;

      const strikeData = data.strikes[String(strike)];

      // Build sparse map: label -> value
      const ceMap = new Map<string, number | null>();
      const peMap = new Map<string, number | null>();
      for (let i = 0; i < data.timestamps.length; i++) {
        const label = tsToLabel(data.timestamps[i]);
        ceMap.set(label, strikeData.ce_oi[i]);
        peMap.set(label, strikeData.pe_oi[i]);
      }

      // Fill into the full 376-slot array
      const ceFull: (number | null)[] = FULL_TIME_LABELS.map(l => ceMap.has(l) ? (ceMap.get(l) ?? null) : null);
      const peFull: (number | null)[] = FULL_TIME_LABELS.map(l => peMap.has(l) ? (peMap.get(l) ?? null) : null);

      datasets.push({
        label: `${strike} CE`,
        data: ceFull,
        borderColor: buildColor(ceBaseRgb, opacity),
        backgroundColor: buildColor(ceBaseRgb, opacity * 0.1),
        borderWidth: isAtm ? 2.5 : 1.2,
        pointRadius: 0,
        tension: 0,
        fill: false,
        spanGaps: true,
      });

      datasets.push({
        label: `${strike} PE`,
        data: peFull,
        borderColor: buildColor(peBaseRgb, opacity),
        backgroundColor: buildColor(peBaseRgb, opacity * 0.1),
        borderWidth: isAtm ? 2.5 : 1.2,
        pointRadius: 0,
        tension: 0,
        fill: showFillColor
          ? { target: datasets.length - 1, above: `rgba(34, 197, 94, ${(0.10 * opacity).toFixed(3)})`, below: `rgba(239, 68, 68, ${(0.10 * opacity).toFixed(3)})` }
          : false,
        spanGaps: true,
      });
    }

    return { labels: FULL_TIME_LABELS, datasets };
  }, [data, atmStrike, showFillColor, focusNearAtm]);

  const isDark = mode === 'dark';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
  const textColor = isDark ? '#d1d5db' : '#374151';

  // Compute crossovers outside useMemo so options can reference them
  const crossoverMarkers = useMemo<CrossoverMarker[]>(() => {
    if (!data || !data.timestamps || data.timestamps.length === 0 || !data.strikes) return [];
    const tsToLabel = (ts: number) =>
      new Date(ts * 1000).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit',
      });
    const strikes = Object.keys(data.strikes).map(Number).sort((a, b) => a - b);
    const markers: CrossoverMarker[] = [];
    for (const strike of strikes) {
      const sd = data.strikes[String(strike)];
      let prevDiff: number | null = null;
      for (let i = 0; i < data.timestamps.length; i++) {
        const ce = sd.ce_oi[i];
        const pe = sd.pe_oi[i];
        if (ce == null || pe == null) continue;
        const diff = pe - ce;
        if (prevDiff !== null) {
          if (prevDiff <= 0 && diff > 0) {
            const label = tsToLabel(data.timestamps[i]);
            const idx = LABEL_INDEX.get(label);
            if (idx !== undefined) markers.push({ index: idx, color: 'rgba(34, 197, 94, 0.7)' });
          } else if (prevDiff >= 0 && diff < 0) {
            const label = tsToLabel(data.timestamps[i]);
            const idx = LABEL_INDEX.get(label);
            if (idx !== undefined) markers.push({ index: idx, color: 'rgba(239, 68, 68, 0.7)' });
          }
        }
        prevDiff = diff;
      }
    }
    return markers;
  }, [data]);

  // Push crossover markers onto chart instance for the plugin to read, then redraw
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    (chart as any)._crossoverMarkers = crossoverMarkers;
    chart.update('none');
  }, [crossoverMarkers]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: textColor,
          usePointStyle: true,
          pointStyle: 'line',
          font: { size: 10 },
          boxWidth: 20,
          boxHeight: 0,
          padding: 6,
        },
        maxHeight: 80,
      },
      title: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        titleColor: '#f3f4f6',
        bodyColor: '#d1d5db',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        callbacks: {
          title: (items) => items[0]?.label || '',
          label: (ctx) => {
            const val = ctx.raw as number | null;
            if (val == null) return '';
            const formatted = val >= 100000
              ? `${(val / 100000).toFixed(1)}L`
              : val >= 1000
              ? `${(val / 1000).toFixed(1)}K`
              : val.toLocaleString('en-IN');
            return ` ${ctx.dataset.label}: ${formatted}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          maxTicksLimit: 20,
          font: { size: 10 },
        },
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        grid: { color: gridColor },
        ticks: {
          color: textColor,
          font: { size: 10 },
          callback: (value) => {
            const v = Number(value);
            if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
            if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
            return v.toLocaleString('en-IN');
          },
        },
        title: {
          display: true,
          text: 'Open Interest',
          color: textColor,
        },
      },
    },
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-bold">OI Action — All Strikes</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            <span className="text-red-500 font-semibold">Red = CE</span>
            {' | '}
            <span className="text-green-500 font-semibold">Green = PE</span>
            {' | '}
            Bright = ATM ±2
            {' | '}
            <span className="text-gray-400">| | | 9:30 &amp; 15:00</span>
            {' | '}
            <span className="text-green-500">| PE↑CE</span>
            {' '}
            <span className="text-red-500">| CE↑PE</span>
          </span>
          <div className="flex items-center gap-1.5">
            <Switch
              id="focus-near-atm"
              checked={focusNearAtm}
              onCheckedChange={setFocusNearAtm}
              className="scale-75"
            />
            <Label htmlFor="focus-near-atm" className="text-[10px] text-muted-foreground whitespace-nowrap cursor-pointer">
              Focus
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id="fill-color"
              checked={showFillColor}
              onCheckedChange={setShowFillColor}
              className="scale-75"
            />
            <Label htmlFor="fill-color" className="text-[10px] text-muted-foreground whitespace-nowrap cursor-pointer">
              Fill
            </Label>
          </div>
          <Button variant="ghost" size="icon" onClick={fetchData} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="w-full h-[calc(100vh-280px)]">
          {!data || data.timestamps.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {isLoading ? 'Loading...' : 'No OI data yet. Start the fetcher.'}
            </div>
          ) : (
            <Line ref={chartRef} data={chartData} options={options} plugins={[verticalLinePlugin]} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
