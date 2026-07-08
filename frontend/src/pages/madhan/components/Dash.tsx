import { useEffect, useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MarketSummary } from './MarketSummary';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, RotateCcw } from 'lucide-react';

interface DashData {
    summary: {
        total_call_oi: number;
        total_put_oi: number;
        total_call_coi: number;
        total_put_coi: number;
        total_call_vol: number;
        total_put_vol: number;
        highest_call_oi: { strike: number; oi: number; coi: number };
        highest_put_oi: { strike: number; oi: number; coi: number };
        max_pain: number;
        current_atm: number;
        pcr_oi: number;
        pcr_vol: number;
    };
    chain_data: Array<{
        strike: number;
        ce_oi: number;
        ce_coi: number;
        ce_vol: number;
        pe_oi: number;
        pe_coi: number;
        pe_vol: number;
    }>;
}

interface TimeAnalysisRow {
    index: number;
    date: string;
    time: string;
    atm: number;
    ltp: number;
    hl_break: string;
    ce_oi: number;
    pe_oi: number;
    diff_oi: number;
    direction: string;
    chg_direction: number;
    chg_direction_pct: number;
    net_pcr: number;
    day_hl_diff: number;
    sentiment: string;
}

export function Dash({ refreshTrigger }: { refreshTrigger: number }) {
    const [data, setData] = useState<DashData | null>(null);
    const [timeAnalysis, setTimeAnalysis] = useState<TimeAnalysisRow[]>([]);
    
    // Separate Individual States
    const [summaryMode, setSummaryMode] = useState<string>('writer_current');
    const [tableMode, setTableMode] = useState<string>('writer_current');
    const [tableTimeframe, setTableTimeframe] = useState<string>('3');
    
    // Replay State
    const [isReplayMode, setIsReplayMode] = useState(false);
    const [replayTimestamp, setReplayTimestamp] = useState<number | null>(null);
    const [latestDataTimestamp, setLatestDataTimestamp] = useState<number | null>(null);
    const [isFetching, setIsFetching] = useState(false);

    const marketStartTime = useMemo(() => {
        const d = new Date();
        d.setHours(9, 15, 0, 0);
        return Math.floor(d.getTime() / 1000);
    }, []);

    const marketEndTime = useMemo(() => {
        const d = new Date();
        d.setHours(15, 30, 0, 0);
        return Math.floor(d.getTime() / 1000);
    }, []);

    const fetchData = async (isManual = false) => {
        if (isFetching && !isManual) return;
        setIsFetching(true);
        try {
            const endTsParam = isReplayMode && replayTimestamp ? `&end_ts=${replayTimestamp}` : '';
            const [dashRes, timeRes] = await Promise.all([
                fetch(`/madhan/api/nifty/dash-data?mode=${summaryMode}${endTsParam}&_=${Date.now()}`),
                fetch(`/madhan/api/nifty/dash-time-analysis?mode=${tableMode}&interval=${tableTimeframe}${endTsParam}&_=${Date.now()}`)
            ]);
            
            const dashJson = await dashRes.json();
            const timeJson = await timeRes.json();
            
            if (dashJson.status === 'success') {
                setData(dashJson);
                // Update latest timestamp from data if not in replay mode
                if (!isReplayMode && dashJson.chain_data.length > 0) {
                    const timestamps = dashJson.chain_data
                        .map((d: any) => d.timestamp || 0)
                        .filter((ts: number) => ts > 0);
                    
                    if (timestamps.length > 0) {
                        const maxTs = Math.max(...timestamps);
                        const cappedMaxTs = Math.min(maxTs, marketEndTime);
                        setLatestDataTimestamp(cappedMaxTs);
                        if (!replayTimestamp) setReplayTimestamp(cappedMaxTs);
                    }
                }
            }
            if (timeJson.status === 'success') setTimeAnalysis(timeJson.data);
        } catch (error) {
            console.error("Failed to fetch Dash data", error);
        } finally {
            setIsFetching(false);
        }
    };

    // Initial fetch and on dependencies change
    useEffect(() => {
        fetchData(true);
    }, [refreshTrigger, summaryMode, tableMode, tableTimeframe, isReplayMode, replayTimestamp]);

    const formatTime = (ts: number | null) => {
        if (!ts) return "--:--";
        return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatValue = (val: number) => {
        if (val === undefined || val === null) return '0';
        const abs = Math.abs(val);
        if (abs >= 10000000) return (val / 10000000).toFixed(2) + 'Cr';
        if (abs >= 100000) return (val / 100000).toFixed(2) + 'L';
        if (abs >= 1000) return (val / 1000).toFixed(1) + 'K';
        return val.toString();
    };

    if (!data) return <div className="p-4 text-center">Loading Dash data...</div>;

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] gap-0 p-0 overflow-hidden bg-background text-foreground w-full font-sans">
            {/* Control Bar */}
            <div className="flex items-center justify-between px-4 bg-card border-b border-border w-full h-10 shadow-sm dark:shadow-2xl">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isReplayMode ? 'bg-amber-500 animate-pulse' : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse'}`} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-foreground">
                            {isReplayMode ? 'Replay Mode' : 'Live Market'}
                        </span>
                    </div>
                    
                    <button 
                        onClick={() => {
                            if (isReplayMode) {
                                setIsReplayMode(false);
                                setReplayTimestamp(latestDataTimestamp);
                            } else {
                                setIsReplayMode(true);
                                if (!replayTimestamp) setReplayTimestamp(marketStartTime);
                            }
                        }}
                        className={`flex items-center gap-2 px-3 py-1 rounded border transition-all text-[9px] font-black uppercase ${
                            isReplayMode 
                            ? 'bg-amber-500/10 border-amber-500/50 text-amber-600 dark:text-amber-500 hover:bg-amber-500/20' 
                            : 'bg-muted border-border text-foreground hover:bg-accent'
                        }`}
                    >
                        {isReplayMode ? <RotateCcw size={10} /> : <Play size={10} className="fill-current" />}
                        {isReplayMode ? 'Stop Replay' : 'Start Replay'}
                    </button>
                </div>

                <div className="flex-1 px-8 flex items-center gap-4">
                    <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap">09:15</span>
                    <div className="flex-1 relative group flex items-center h-full">
                        <input 
                            type="range" 
                            min={marketStartTime}
                            max={Math.min(latestDataTimestamp || Math.floor(Date.now() / 1000), marketEndTime)}
                            step={60}
                            value={replayTimestamp || Math.min(latestDataTimestamp || Math.floor(Date.now() / 1000), marketEndTime)}
                            onChange={(e) => {
                                setReplayTimestamp(parseInt(e.target.value));
                                setIsReplayMode(true);
                            }}
                            className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                        />
                    </div>
                    <div className="flex items-center gap-3 min-w-fit pr-4">
                        <div className="flex flex-col items-center justify-center h-full">
                            <span className="text-[11px] font-black text-primary leading-none">
                                {formatTime(replayTimestamp || Math.min(latestDataTimestamp || Math.floor(Date.now() / 1000), marketEndTime))}
                            </span>
                            <span className="text-[8px] font-bold text-muted-foreground leading-none mt-1">
                                {formatTime(Math.min(latestDataTimestamp || Math.floor(Date.now() / 1000), marketEndTime))}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 pr-2">
                    <Select value={summaryMode} onValueChange={setSummaryMode}>
                        <SelectTrigger className="w-[160px] h-7 text-[9px] font-black uppercase bg-background border-border text-foreground">
                            <SelectValue placeholder="Mode" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border text-popover-foreground">
                            <SelectItem value="total" className="text-[9px] font-black uppercase">Total Strikes</SelectItem>
                            <SelectItem value="writer_open" className="text-[9px] font-black uppercase">Writer View (Open ATM)</SelectItem>
                            <SelectItem value="writer_current" className="text-[9px] font-black uppercase">Writer View (Current ATM)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Summary Row */}
            <div className="w-full bg-background p-2 border-b border-border">
                <MarketSummary summary={data.summary} />
            </div>

            {/* Interpretation Table */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-1.5 bg-muted/30 border-b border-border w-full">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">Interval Interpretation</span>
                    
                    <div className="flex items-center gap-2">
                        <Select value={tableMode} onValueChange={setTableMode}>
                            <SelectTrigger className="w-[180px] h-6 text-[8px] font-black uppercase bg-background border-border text-muted-foreground">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border text-popover-foreground">
                                <SelectItem value="total">Total Strikes</SelectItem>
                                <SelectItem value="writer_open">Writer View (Open ATM)</SelectItem>
                                <SelectItem value="writer_current">Writer View (Current ATM)</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={tableTimeframe} onValueChange={setTableTimeframe}>
                            <SelectTrigger className="w-[60px] h-6 text-[8px] font-black uppercase bg-background border-border text-muted-foreground">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border text-popover-foreground">
                                <SelectItem value="1">1 Min</SelectItem>
                                <SelectItem value="3">3 Min</SelectItem>
                                <SelectItem value="5">5 Min</SelectItem>
                                <SelectItem value="15">15 Min</SelectItem>
                                <SelectItem value="30">30 Min</SelectItem>
                                <SelectItem value="60">60 Min</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex-1 relative overflow-hidden bg-background">
                    <div className="absolute inset-0 overflow-auto scrollbar-thin">
                        <Table className="relative w-full border-collapse">
                            <TableHeader className="sticky top-0 bg-background z-20">
                                <TableRow className="hover:bg-transparent border-b border-border h-8">
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">#</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Date</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Time</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">ATM</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Ltp</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Day H/L Break</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-red-500 border-r border-border">Call Oi</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-green-600 border-r border-border">Put Oi</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Diff. In Oi</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Dir.</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Chg. Dir</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Dir %</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Net Pcr</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground border-r border-border">Day H/L Diff Oi</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-muted-foreground">Sentiment</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {timeAnalysis.map((row, idx) => {
                                    const prevRow = idx < timeAnalysis.length - 1 ? timeAnalysis[idx + 1] : null;
                                    const atmClass =
                                        !prevRow ? 'text-muted-foreground' :
                                        row.atm > prevRow.atm ? 'text-green-600 dark:text-green-500' :
                                        row.atm < prevRow.atm ? 'text-red-600 dark:text-red-500' :
                                        'text-muted-foreground';
                                    const ltpClass =
                                        !prevRow ? 'text-primary' :
                                        row.ltp > prevRow.ltp ? 'text-green-600 dark:text-green-500' :
                                        row.ltp < prevRow.ltp ? 'text-red-600 dark:text-red-500' :
                                        'text-primary';
                                    return (
                                    <TableRow key={idx} className="hover:bg-muted/50 border-b border-border h-8 transition-colors">
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-bold text-muted-foreground border-r border-border">{row.index}</TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-bold text-muted-foreground/80 border-r border-border">{row.date}</TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-black text-foreground border-r border-border">{row.time}</TableCell>
                                        <TableCell className={`text-center px-2 py-0 text-[10px] font-black border-r border-border ${atmClass}`}>{row.atm}</TableCell>
                                        <TableCell className={`text-center px-2 py-0 text-[10px] font-black border-r border-border bg-primary/5 ${ltpClass}`}>{row.ltp.toFixed(2)}</TableCell>
                                        <TableCell className="text-center px-2 py-0 border-r border-border">
                                            <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase inline-block w-full max-w-[80px] ${
                                                row.hl_break.includes('High') || row.hl_break.includes('H Break') ? 'bg-green-600/20 text-green-600 dark:text-green-500 border border-green-500/30' :
                                                row.hl_break.includes('Low') || row.hl_break.includes('L Break') ? 'bg-red-600/20 text-red-600 dark:text-red-500 border border-red-500/30' :
                                                'text-slate-600'
                                            }`}>
                                                {row.hl_break || '-'}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] text-red-500 font-black border-r border-border">{formatValue(row.ce_oi)}</TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] text-green-600 dark:text-green-500 font-black border-r border-border">{formatValue(row.pe_oi)}</TableCell>
                                        <TableCell className={`text-center px-2 py-0 text-[10px] font-black border-r border-border ${row.diff_oi >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                                            {formatValue(row.diff_oi)}
                                        </TableCell>
                                        <TableCell className={`text-center px-2 py-0 text-xs font-black border-r border-border ${row.direction === '▲' ? 'text-green-600' : row.direction === '▼' ? 'text-red-600' : ''}`}>
                                            {row.direction}
                                        </TableCell>
                                        <TableCell className={`text-center px-2 py-0 text-[10px] font-black border-r border-border ${row.chg_direction >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatValue(row.chg_direction)}
                                        </TableCell>
                                        <TableCell className="text-center px-2 py-0 border-r border-border">
                                            <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase inline-block w-full max-w-[70px] ${
                                                Math.abs(row.chg_direction_pct) > 50
                                                ? (row.chg_direction_pct >= 0
                                                    ? 'bg-green-600/20 text-green-600 dark:text-green-500 border border-green-500/30'
                                                    : 'bg-red-600/20 text-red-600 dark:text-red-500 border border-red-500/30')
                                                : (row.chg_direction_pct >= 0 ? 'text-green-600' : 'text-red-600')
                                            }`}>
                                                {row.chg_direction_pct > 0 ? '+' : ''}{row.chg_direction_pct}%
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-black border-r border-border text-foreground">{row.net_pcr.toFixed(2)}</TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-black text-muted-foreground border-r border-border">{formatValue(row.day_hl_diff)}</TableCell>
                                        <TableCell className="text-center px-2 py-0">
                                            <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase inline-block w-full max-w-[90px] ${
                                                row.sentiment.includes('Strong Bullish') ? 'bg-green-600/20 text-green-600 dark:text-green-500 border border-green-500/30' :
                                                row.sentiment.includes('Bullish') ? 'bg-green-500/10 text-green-600 dark:text-green-500 border border-green-500/20' :
                                                row.sentiment.includes('Strong Bearish') ? 'bg-red-600/20 text-red-600 dark:text-red-500 border border-red-500/30' :
                                                row.sentiment.includes('Bearish') ? 'bg-red-500/10 text-red-600 dark:text-red-500 border border-red-500/20' :
                                                'bg-muted text-muted-foreground border border-border'
                                            }`}>
                                                {row.sentiment}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </div>
        </div>
    );
}
