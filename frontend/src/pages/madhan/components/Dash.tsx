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
    const [summaryMode, setSummaryMode] = useState<string>('writer_open');
    const [tableMode, setTableMode] = useState<string>('writer_open');
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
                fetch(`/madhan/api/nifty/dash-data?mode=${summaryMode}${endTsParam}`),
                fetch(`/madhan/api/nifty/dash-time-analysis?mode=${tableMode}&interval=${tableTimeframe}${endTsParam}`)
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

    // Custom 1-minute aligned refresh logic
    useEffect(() => {
        if (isReplayMode) return;

        const getMsUntilNextMinute = () => {
            const now = new Date();
            return (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 2000; // Aligned + 2s buffer
        };

        let timeoutId: any;
        const scheduleNextRefresh = () => {
            timeoutId = setTimeout(() => {
                fetchData();
                scheduleNextRefresh();
            }, getMsUntilNextMinute());
        };

        scheduleNextRefresh();
        return () => clearTimeout(timeoutId);
    }, [isReplayMode, summaryMode, tableMode, tableTimeframe]);

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
        <div className="flex flex-col h-[calc(100vh-140px)] gap-0 p-0 overflow-hidden bg-background w-full">
            {/* Control Bar */}
            <div className="flex items-center justify-between px-2 py-0 bg-card border-b shadow-sm w-full h-7">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full animate-pulse ${isReplayMode ? 'bg-amber-500' : 'bg-green-500'}`} />
                        <span className="text-[10px] font-black uppercase tracking-tighter">
                            {isReplayMode ? 'Replay Mode' : 'Live Market'}
                        </span>
                    </div>
                    
                    <button 
                        onClick={() => {
                            setIsReplayMode(!isReplayMode);
                            if (isReplayMode) setReplayTimestamp(latestDataTimestamp);
                        }}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-all text-[9px] font-bold uppercase ${
                            isReplayMode 
                            ? 'bg-amber-500/10 border-amber-500/50 text-amber-600' 
                            : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                        {isReplayMode ? <RotateCcw size={12} /> : <Play size={12} />}
                        {isReplayMode ? 'Back to Live' : 'Start Replay'}
                    </button>
                </div>

                <div className="flex-1 px-4 flex items-center gap-3">
                    <span className="text-[9px] font-bold text-muted-foreground w-10">09:15</span>
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
                        className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                    <div className="flex flex-col items-center min-w-[60px]">
                        <span className="text-[11px] font-black text-blue-600 leading-none">
                            {formatTime(replayTimestamp || Math.min(latestDataTimestamp || Math.floor(Date.now() / 1000), marketEndTime))}
                        </span>
                        <span className="text-[9px] font-bold text-muted-foreground w-10 ml-2">
                            {formatTime(Math.min(latestDataTimestamp || Math.floor(Date.now() / 1000), marketEndTime))}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Select value={summaryMode} onValueChange={setSummaryMode}>
                        <SelectTrigger className="w-[160px] h-7 text-[10px] font-bold uppercase bg-background">
                            <SelectValue placeholder="Select Summary View" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="total" className="text-[10px] font-bold">Total Strikes</SelectItem>
                            <SelectItem value="writer_open" className="text-[10px] font-bold">Writer View (Open ATM)</SelectItem>
                            <SelectItem value="writer_current" className="text-[10px] font-bold">Writer View (Current ATM)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Summary Row */}
            <div className="w-full border-b bg-card">
                <MarketSummary summary={data.summary} />
            </div>

            {/* Interpretation Table (Image style) */}
            <div className="flex-1 flex flex-col overflow-hidden bg-background">
                <div className="flex items-center justify-between px-2 py-0 border-b bg-muted/5 w-full h-6">
                    <div className="flex items-center gap-1.5 h-full">
                        <span className="text-[8px] font-black uppercase tracking-tighter text-muted-foreground leading-none">Interval Interpretation</span>
                        {isReplayMode && (
                            <span className="text-[7px] font-black text-amber-500 italic bg-amber-500/10 px-1 py-0 rounded border border-amber-500/20 leading-none ml-1">
                                REPLAY: {formatTime(replayTimestamp)}
                            </span>
                        )}
                    </div>
                    
                    <div className="flex items-center gap-1 h-full">
                        <Select value={tableMode} onValueChange={setTableMode}>
                            <SelectTrigger className="w-[180px] h-4.5 text-[8px] font-bold uppercase bg-background border-slate-200 px-1.5 py-0">
                                <SelectValue placeholder="Select Table View" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="total" className="text-[8px] font-bold">Total Strikes</SelectItem>
                                <SelectItem value="writer_open" className="text-[8px] font-bold">Writer View (Open ATM)</SelectItem>
                                <SelectItem value="writer_current" className="text-[8px] font-bold">Writer View (Current ATM)</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={tableTimeframe} onValueChange={setTableTimeframe}>
                            <SelectTrigger className="w-[60px] h-4.5 text-[8px] font-bold uppercase bg-background border-slate-200 px-1 py-0">
                                <SelectValue placeholder="Interval" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1" className="text-[8px] font-bold">1 Min</SelectItem>
                                <SelectItem value="3" className="text-[8px] font-bold">3 Min</SelectItem>
                                <SelectItem value="5" className="text-[8px] font-bold">5 Min</SelectItem>
                                <SelectItem value="15" className="text-[8px] font-bold">15 Min</SelectItem>
                                <SelectItem value="30" className="text-[8px] font-bold">30 Min</SelectItem>
                                <SelectItem value="60" className="text-[8px] font-bold">60 Min</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="flex-1 relative overflow-hidden bg-background">
                    <div className="absolute inset-0 overflow-auto scrollbar-thin">
                        <Table className="relative w-full border-collapse">
                            <TableHeader className="sticky top-0 bg-background z-20 shadow-[0_1px_0_rgba(0,0,0,0.1)]">
                                <TableRow className="hover:bg-transparent border-b h-4">
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">#</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">Date</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">Time</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">LTP</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">Day H/L Break</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap text-red-500 bg-background border-r">Call OI</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap text-green-500 bg-background border-r">Put OI</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">Diff. in OI</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">Dir.</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">Chg. Dir</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">Dir %</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">Net PCR</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background border-r">Day H/L Diff OI</TableHead>
                                    <TableHead className="text-center text-[8px] uppercase font-black p-0 h-4 whitespace-nowrap bg-background">Sentiment</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {timeAnalysis.map((row, idx) => (
                                    <TableRow key={idx} className="hover:bg-accent/30 border-b last:border-0 h-4">
                                        <TableCell className="text-center p-0 h-4 text-[8px] font-medium border-r">{row.index}</TableCell>
                                        <TableCell className="text-center p-0 h-4 text-[8px] whitespace-nowrap border-r">{row.date}</TableCell>
                                        <TableCell className="text-center p-0 h-4 text-[8px] whitespace-nowrap border-r">{row.time}</TableCell>
                                        <TableCell className="text-center p-0 h-4 text-[8px] font-bold text-blue-600 border-r">{row.ltp.toFixed(2)}</TableCell>
                                        <TableCell className={`text-center p-0 h-4 text-[7px] font-black italic border-r ${row.hl_break.includes('High') ? 'text-green-600' : row.hl_break.includes('Low') ? 'text-red-600' : 'text-muted-foreground'}`}>
                                            {row.hl_break}
                                        </TableCell>
                                        <TableCell className="text-center p-0 h-4 text-[8px] text-red-500 font-medium border-r">{formatValue(row.ce_oi)}</TableCell>
                                        <TableCell className="text-center p-0 h-4 text-[8px] text-green-500 font-medium border-r">{formatValue(row.pe_oi)}</TableCell>
                                        <TableCell className={`text-center p-0 h-4 text-[8px] font-bold border-r ${row.diff_oi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatValue(row.diff_oi)}
                                        </TableCell>
                                        <TableCell className={`text-center p-0 h-4 text-xs font-bold border-r ${row.direction === '▲' ? 'text-green-600' : row.direction === '▼' ? 'text-red-600' : ''}`}>
                                            {row.direction}
                                        </TableCell>
                                        <TableCell className={`text-center p-0 h-4 text-[8px] font-medium border-r ${row.chg_direction >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatValue(row.chg_direction)}
                                        </TableCell>
                                        <TableCell className={`text-center p-0 h-4 text-[8px] font-medium border-r ${row.chg_direction_pct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {row.chg_direction_pct > 0 ? '+' : ''}{row.chg_direction_pct}%
                                        </TableCell>
                                        <TableCell className="text-center p-0 h-4 text-[8px] font-bold border-r">{row.net_pcr.toFixed(2)}</TableCell>
                                        <TableCell className="text-center p-0 h-4 text-[8px] font-bold text-slate-500 border-r">{formatValue(row.day_hl_diff)}</TableCell>
                                        <TableCell className="text-center p-0 h-4">
                                            <span className={`px-1 py-0 rounded-full text-[7px] font-black uppercase inline-block w-full leading-tight ${
                                                row.sentiment.includes('Strong Bullish') ? 'bg-green-500 text-white' :
                                                row.sentiment.includes('Bullish') ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                row.sentiment.includes('Strong Bearish') ? 'bg-red-500 text-white' :
                                                row.sentiment.includes('Bearish') ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                            }`}>
                                                {row.sentiment}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </div>
        </div>
    );
}
