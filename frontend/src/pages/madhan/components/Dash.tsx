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
        <div className="flex flex-col h-[calc(100vh-140px)] gap-0 p-0 overflow-hidden bg-[#0a0a0a] text-slate-200 w-full font-sans">
            {/* Control Bar */}
            <div className="flex items-center justify-between px-4 bg-[#111111] border-b border-white/5 w-full h-10 shadow-2xl">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isReplayMode ? 'bg-amber-500 animate-pulse' : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse'}`} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">
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
                            ? 'bg-amber-500/10 border-amber-500/50 text-amber-500 hover:bg-amber-500/20' 
                            : 'bg-white/5 border-white/20 text-white hover:bg-white/10'
                        }`}
                    >
                        {isReplayMode ? <RotateCcw size={10} /> : <Play size={10} className="fill-white" />}
                        {isReplayMode ? 'Stop Replay' : 'Start Replay'}
                    </button>
                </div>

                <div className="flex-1 px-8 flex items-center gap-4">
                    <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">09:15</span>
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
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                    </div>
                    <div className="flex items-center gap-3 min-w-fit">
                        <div className="flex flex-col items-center justify-center h-full">
                            <span className="text-[11px] font-black text-blue-400 leading-none">
                                {formatTime(replayTimestamp || Math.min(latestDataTimestamp || Math.floor(Date.now() / 1000), marketEndTime))}
                            </span>
                            <span className="text-[8px] font-bold text-slate-600 leading-none mt-1">
                                {formatTime(Math.min(latestDataTimestamp || Math.floor(Date.now() / 1000), marketEndTime))}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2 pr-2">
                    <Select value={summaryMode} onValueChange={setSummaryMode}>
                        <SelectTrigger className="w-[160px] h-7 text-[9px] font-black uppercase bg-black border-white/10 text-slate-300">
                            <SelectValue placeholder="Mode" />
                        </SelectTrigger>
                        <SelectContent className="bg-black border-white/10 text-slate-300">
                            <SelectItem value="total" className="text-[9px] font-black uppercase">Total Strikes</SelectItem>
                            <SelectItem value="writer_open" className="text-[9px] font-black uppercase">Writer View (Open ATM)</SelectItem>
                            <SelectItem value="writer_current" className="text-[9px] font-black uppercase">Writer View (Current ATM)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Summary Row */}
            <div className="w-full bg-[#0a0a0a] p-2 border-b border-white/5">
                <MarketSummary summary={data.summary} />
            </div>

            {/* Interpretation Table */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-1.5 bg-[#111111]/50 border-b border-white/5 w-full">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Interval Interpretation</span>
                    
                    <div className="flex items-center gap-2">
                        <Select value={tableMode} onValueChange={setTableMode}>
                            <SelectTrigger className="w-[180px] h-6 text-[8px] font-black uppercase bg-black border-white/10 text-slate-400">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-white/10 text-slate-400">
                                <SelectItem value="total">Total Strikes</SelectItem>
                                <SelectItem value="writer_open">Writer View (Open ATM)</SelectItem>
                                <SelectItem value="writer_current">Writer View (Current ATM)</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={tableTimeframe} onValueChange={setTableTimeframe}>
                            <SelectTrigger className="w-[60px] h-6 text-[8px] font-black uppercase bg-black border-white/10 text-slate-400">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-white/10 text-slate-400">
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

                <div className="flex-1 relative overflow-hidden bg-black">
                    <div className="absolute inset-0 overflow-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                        <Table className="relative w-full border-collapse">
                            <TableHeader className="sticky top-0 bg-[#0a0a0a] z-20">
                                <TableRow className="hover:bg-transparent border-b border-white/5 h-8">
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">#</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Date</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Time</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Ltp</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Day H/L Break</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Call Oi</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Put Oi</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Diff. In Oi</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Dir.</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Chg. Dir</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Dir %</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Net Pcr</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500 border-r border-white/5">Day H/L Diff Oi</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-black px-2 text-slate-500">Sentiment</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {timeAnalysis.map((row, idx) => (
                                    <TableRow key={idx} className="hover:bg-white/5 border-b border-white/5 h-8 transition-colors">
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-bold text-slate-500 border-r border-white/5">{row.index}</TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-bold text-slate-400 border-r border-white/5">{row.date}</TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-black text-slate-300 border-r border-white/5">{row.time}</TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-black text-blue-400 border-r border-white/5">{row.ltp.toFixed(2)}</TableCell>
                                        <TableCell className="text-center px-2 py-0 border-r border-white/5">
                                            <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase inline-block w-full max-w-[80px] ${
                                                row.hl_break.includes('High') || row.hl_break.includes('H Break') ? 'bg-green-600/20 text-green-500 border border-green-500/30' :
                                                row.hl_break.includes('Low') || row.hl_break.includes('L Break') ? 'bg-red-600/20 text-red-500 border border-red-500/30' :
                                                'text-slate-600'
                                            }`}>
                                                {row.hl_break || '-'}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] text-red-500 font-black border-r border-white/5">{formatValue(row.ce_oi)}</TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] text-green-500 font-black border-r border-white/5">{formatValue(row.pe_oi)}</TableCell>
                                        <TableCell className={`text-center px-2 py-0 text-[10px] font-black border-r border-white/5 ${row.diff_oi >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                            {formatValue(row.diff_oi)}
                                        </TableCell>
                                        <TableCell className={`text-center px-2 py-0 text-xs font-black border-r border-white/5 ${row.direction === '▲' ? 'text-green-500' : row.direction === '▼' ? 'text-red-500' : ''}`}>
                                            {row.direction}
                                        </TableCell>
                                        <TableCell className={`text-center px-2 py-0 text-[10px] font-black border-r border-white/5 ${row.chg_direction >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                            {formatValue(row.chg_direction)}
                                        </TableCell>
                                        <TableCell className={`text-center px-2 py-0 text-[9px] font-black border-r border-white/5 ${row.chg_direction_pct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                            {row.chg_direction_pct > 0 ? '+' : ''}{row.chg_direction_pct}%
                                        </TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-black border-r border-white/5 text-slate-100">{row.net_pcr.toFixed(2)}</TableCell>
                                        <TableCell className="text-center px-2 py-0 text-[10px] font-black text-slate-400 border-r border-white/5">{formatValue(row.day_hl_diff)}</TableCell>
                                        <TableCell className="text-center px-2 py-0">
                                            <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase inline-block w-full max-w-[90px] ${
                                                row.sentiment.includes('Strong Bullish') ? 'bg-green-600/20 text-green-500 border border-green-500/30' :
                                                row.sentiment.includes('Bullish') ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                                                row.sentiment.includes('Strong Bearish') ? 'bg-red-600/20 text-red-500 border border-red-500/30' :
                                                row.sentiment.includes('Bearish') ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                                                'bg-slate-500/10 text-slate-500 border border-slate-500/20'
                                            }`}>
                                                {row.sentiment}
                                            </div>
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
