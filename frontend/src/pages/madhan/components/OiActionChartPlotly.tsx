import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMadhanTheme } from '../useMadhanTheme';
import Plot from '@/lib/Plot2D';

interface OiStrikeHistoryResponse {
  status: string;
  timestamps: number[];
  strikes: Record<string, { ce_oi: (number | null)[]; pe_oi: (number | null)[] }>;
}

interface OiActionChartPlotlyProps {
  refreshTrigger: number;
  atmStrike?: number;
}

// Generate fixed time labels from 09:15 to 15:30
function generateFullTimeLabels(): string[] {
  const labels: string[] = [];
  for (let h = 9; h <= 15; h++) {
    for (let m = 0; m < 60; m++) {
      if (h === 9 && m < 15) continue;
      if (h === 15 && m > 40) break;
      labels.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return labels;
}

const FULL_TIME_LABELS = generateFullTimeLabels();

export function OiActionChartPlotly({ refreshTrigger, atmStrike }: OiActionChartPlotlyProps) {
  const { mode } = useMadhanTheme();
  const [data, setData] = useState<OiStrikeHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showFillColor, setShowFillColor] = useState(true);
  const [focusNearAtm, setFocusNearAtm] = useState(true);

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

  const { plotData, plotLayout } = useMemo(() => {
    if (!data || !data.timestamps || data.timestamps.length === 0 || !data.strikes) {
      return { plotData: [], plotLayout: {} };
    }

    const dark = mode === 'dark';
    const textColor = dark ? '#d1d5db' : '#374151';
    const gridColor = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const timeLineColor = dark ? 'rgba(156,163,175,0.6)' : 'rgba(107,114,128,0.5)';
    const crossoverGreen = dark ? 'rgba(34,197,94,0.7)' : 'rgba(22,163,74,0.6)';
    const crossoverRed = dark ? 'rgba(239,68,68,0.7)' : 'rgba(220,38,38,0.6)';

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
      return { plotData: [], plotLayout: {} };
    }

    const atm = atmStrike || strikes[Math.floor(strikes.length / 2)];
    const maxDistance = strikes.reduce((max, s) => Math.max(max, Math.abs(s - atm)), 50);

    const ceBase = [239, 68, 68];
    const peBase = [34, 197, 94];

    const traces: any[] = [];

    // Build sparse maps per strike
    for (const strike of strikes) {
      const distance = Math.abs(strike - atm);
      if (focusNearAtm && distance > 100) continue;

      const opacity = Math.max(0.15, 1.0 - Math.pow(distance / maxDistance, 0.5) * 0.85);
      const isAtm = strike === atm;
      const lineWidth = isAtm ? 2.5 : 1.2;
      const strikeData = data.strikes[String(strike)];

      const ceMap = new Map<string, number | null>();
      const peMap = new Map<string, number | null>();
      for (let i = 0; i < data.timestamps.length; i++) {
        const label = tsToLabel(data.timestamps[i]);
        ceMap.set(label, strikeData.ce_oi[i]);
        peMap.set(label, strikeData.pe_oi[i]);
      }

      const ceY = FULL_TIME_LABELS.map(l => ceMap.has(l) ? (ceMap.get(l) ?? null) : null);
      const peY = FULL_TIME_LABELS.map(l => peMap.has(l) ? (peMap.get(l) ?? null) : null);

      // CE trace
      traces.push({
        x: FULL_TIME_LABELS,
        y: ceY,
        type: 'scatter',
        mode: 'lines',
        name: `${strike} CE`,
        line: {
          color: `rgba(${ceBase[0]},${ceBase[1]},${ceBase[2]},${opacity})`,
          width: lineWidth,
        },
        connectgaps: false,
        hovertemplate: `%{y:,.0f}<extra>${strike} CE</extra>`,
      });

      // PE trace
      traces.push({
        x: FULL_TIME_LABELS,
        y: peY,
        type: 'scatter',
        mode: 'lines',
        name: `${strike} PE`,
        line: {
          color: `rgba(${peBase[0]},${peBase[1]},${peBase[2]},${opacity})`,
          width: lineWidth,
        },
        connectgaps: false,
        hovertemplate: `%{y:,.0f}<extra>${strike} PE</extra>`,
      });

      // Dynamic fill: red when CE > PE, green when PE > CE using toself polygons
      if (showFillColor) {
        const fillColorAlpha = (0.15 * opacity).toFixed(3);

        // Build segments: contiguous runs of same dominant side
        const segments: { start: number; end: number; dominant: 'ce' | 'pe' }[] = [];
        let segStart = -1;
        let prevDom: 'ce' | 'pe' | null = null;

        for (let i = 0; i < FULL_TIME_LABELS.length; i++) {
          const ce = ceY[i];
          const pe = peY[i];
          const dom: 'ce' | 'pe' | null =
            ce != null && pe != null && ce > pe ? 'ce' :
            ce != null && pe != null && pe > ce ? 'pe' : null;

          if (dom !== prevDom) {
            if (segStart >= 0 && prevDom) {
              segments.push({ start: segStart, end: i, dominant: prevDom });
            }
            segStart = dom != null ? i : -1;
            prevDom = dom;
          }
        }
        if (segStart >= 0 && prevDom) {
          segments.push({ start: segStart, end: FULL_TIME_LABELS.length, dominant: prevDom });
        }

        for (const seg of segments) {
          const color = seg.dominant === 'ce' ? ceBase : peBase;
          const xFwd = FULL_TIME_LABELS.slice(seg.start, seg.end);
          const xRev = [...xFwd].reverse();
          const yTop = (seg.dominant === 'ce' ? ceY : peY).slice(seg.start, seg.end);
          const yBot = (seg.dominant === 'ce' ? peY : ceY).slice(seg.start, seg.end);

          traces.push({
            x: [...xFwd, ...xRev],
            y: [...yTop, ...(yBot as any[]).reverse()],
            type: 'scatter',
            mode: 'none',
            fill: 'toself',
            fillcolor: `rgba(${color[0]},${color[1]},${color[2]},${fillColorAlpha})`,
            line: { width: 0 },
            showlegend: false,
            hoverinfo: 'skip',
          });
        }
      }
    }

    // Compute crossover markers as vertical lines
    const shapes: any[] = [];
    // Fixed lines at 09:30 and 15:00
    for (const target of ['09:30', '15:00']) {
      shapes.push({
        type: 'line',
        x0: target,
        x1: target,
        y0: 0,
        y1: 1,
        yref: 'paper',
        line: { color: timeLineColor, width: 1, dash: 'dash' },
      });
    }

    // Crossover markers
    for (const strike of strikes) {
      const sd = data.strikes[String(strike)];
      let prevDiff: number | null = null;
      for (let i = 0; i < data.timestamps.length; i++) {
        const ce = sd.ce_oi[i];
        const pe = sd.pe_oi[i];
        if (ce == null || pe == null) continue;
        const diff = pe - ce;
        if (prevDiff !== null) {
          const label = tsToLabel(data.timestamps[i]);
          if (prevDiff <= 0 && diff > 0) {
            shapes.push({
              type: 'line',
              x0: label,
              x1: label,
              y0: 0,
              y1: 1,
              yref: 'paper',
              line: { color: crossoverGreen, width: 1.5, dash: 'dash' },
            });
          } else if (prevDiff >= 0 && diff < 0) {
            shapes.push({
              type: 'line',
              x0: label,
              x1: label,
              y0: 0,
              y1: 1,
              yref: 'paper',
              line: { color: crossoverRed, width: 1.5, dash: 'dash' },
            });
          }
        }
        prevDiff = diff;
      }
    }

    const layout: any = {
      autosize: true,
      margin: { l: 60, r: 20, t: 10, b: 40 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: textColor, size: 10 },
      xaxis: {
        type: 'category',
        categoryarray: FULL_TIME_LABELS,
        tickangle: -45,
        gridcolor: gridColor,
        nticks: 20,
        tickfont: { size: 10, color: textColor },
      },
      yaxis: {
        title: { text: 'Open Interest', font: { size: 11, color: textColor } },
        gridcolor: gridColor,
        automargin: true,
        tickformat: ',d',
        tickfont: { size: 10, color: textColor },
      },
      hovermode: 'x unified',
      hoverlabel: {
        bgcolor: dark ? '#1f2937' : '#ffffff',
        bordercolor: dark ? '#374151' : '#e5e7eb',
        font: { color: dark ? '#d1d5db' : '#374151', size: 10 },
      },
      legend: {
        orientation: 'h',
        y: 1.02,
        x: 0.5,
        xanchor: 'center',
        font: { size: 9, color: textColor },
        itemwidth: 30,
      },
      shapes,
      showlegend: true,
    };

    return { plotData: traces, plotLayout: layout };
  }, [data, atmStrike, showFillColor, focusNearAtm, mode]);

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
              id="focus-near-atm-plotly"
              checked={focusNearAtm}
              onCheckedChange={setFocusNearAtm}
              className="scale-75"
            />
            <Label htmlFor="focus-near-atm-plotly" className="text-[10px] text-muted-foreground whitespace-nowrap cursor-pointer">
              Focus
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id="fill-color-plotly"
              checked={showFillColor}
              onCheckedChange={setShowFillColor}
              className="scale-75"
            />
            <Label htmlFor="fill-color-plotly" className="text-[10px] text-muted-foreground whitespace-nowrap cursor-pointer">
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
            <Plot
              data={plotData}
              layout={plotLayout}
              config={{ responsive: true, displayModeBar: false }}
              useResizeHandler
              style={{ width: '100%', height: '100%' }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
