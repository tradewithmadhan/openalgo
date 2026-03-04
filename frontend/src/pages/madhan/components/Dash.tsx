import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    time_range: string;
    strike: number;
    total_oi_change: number;
    ce: {
        oi: number;
        ltp: number;
        ltp_change: number;
        oi_change: number;
        interpretation: string;
    };
    pe: {
        oi: number;
        ltp: number;
        ltp_change: number;
        oi_change: number;
        interpretation: string;
    };
}

export function Dash({ refreshTrigger }: { refreshTrigger: number }) {
    const [data, setData] = useState<DashData | null>(null);
    const [timeAnalysis, setTimeAnalysis] = useState<TimeAnalysisRow[]>([]);
    const [mode, setMode] = useState<string>('writer_open');
    
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
                fetch(`/madhan/api/nifty/dash-data?mode=${mode}${endTsParam}`),
                fetch(`/madhan/api/nifty/dash-time-analysis?mode=${mode}${endTsParam}`)
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
    }, [refreshTrigger, mode, isReplayMode, replayTimestamp]);

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
    }, [isReplayMode, mode]);

    const formatTime = (ts: number | null) => {
        if (!ts) return "--:--";
        return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatValue = (val: number) => {
        if (val === undefined || val === null) return '0';
        const abs = Math.abs(val);
        if (abs >= 100000) return (val / 100000).toFixed(2) + 'L';
        if (abs >= 1000) return (val / 1000).toFixed(1) + 'K';
        return val.toString();
    };

    const getInterpretationColor = (interp: string) => {
        switch (interp) {
            case 'Long Build Up': return 'bg-green-500 text-white';
            case 'Short Build Up': return 'bg-red-500 text-white';
            case 'Short Covering': return 'bg-blue-600 text-white';
            case 'Long Unwinding': return 'bg-amber-500 text-white';
            default: return 'bg-slate-200 text-slate-700';
        }
    };

    if (!data) return <div className="p-4 text-center">Loading Dash data...</div>;

    // Writer View Color Helpers for Table
    const getCeColor = (val: number = 1) => val >= 0 ? 'text-red-500' : 'text-green-500';
    const getPeColor = (val: number = 1) => val >= 0 ? 'text-green-500' : 'text-red-500';

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] gap-2 p-1 overflow-hidden bg-background">
            {/* Control Bar */}
            <div className="flex items-center justify-between px-2 py-1 bg-card border rounded-lg shadow-sm">
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
                    <Select value={mode} onValueChange={setMode}>
                        <SelectTrigger className="w-[160px] h-7 text-[10px] font-bold uppercase bg-background">
                            <SelectValue placeholder="Select View" />
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
            <MarketSummary summary={data.summary} />

            {/* Interpretation Table (Image style) */}
            <Card className="flex-1 flex flex-col">
                <CardHeader className="p-2 border-b flex-shrink-0 flex flex-row items-center justify-between">
                    <CardTitle className="text-xs uppercase font-bold text-muted-foreground">Market Time Interval Interpretation</CardTitle>
                    <div className="flex gap-2">
                        {isReplayMode && (
                            <span className="text-[10px] font-black text-amber-500 italic bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/10">
                                REPLAY: {formatTime(replayTimestamp)}
                            </span>
                        )}
                        <span className="text-[10px] font-black text-blue-500 italic bg-blue-500/5 px-2 py-0.5 rounded border border-blue-500/10">
                            MODE: {mode === 'total' ? 'TOTAL' : mode === 'writer_open' ? 'WRITER (OPEN ATM)' : 'WRITER (CURRENT ATM)'}
                        </span>
                    </div>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-hidden">
                    <ScrollArea className="h-full">
                        <Table className="relative">
                            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                                <TableRow className="hover:bg-transparent h-8">
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap text-red-500">C. OI (Sum)</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap border-r">Tot. COI</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap text-red-500">C. LTP (Avg)</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap text-red-500">C. P.Chg</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap text-red-500">C. OI.Chg</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap border-r">C. Interpretation</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap bg-slate-100 dark:bg-slate-900">Strike (ATM)</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap border-l">P. Interpretation</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap text-green-500">P. OI.Chg</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap text-green-500">P. P.Chg</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap text-green-500">P. LTP (Avg)</TableHead>
                                    <TableHead className="text-center text-[9px] uppercase font-bold p-1 whitespace-nowrap text-green-500">P. OI (Sum)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {timeAnalysis.map((row, idx) => (
                                    <TableRow key={idx} className="hover:bg-accent/50 h-8">
                                        <TableCell className="text-center p-1 text-[10px] font-medium whitespace-nowrap">{row.time_range}</TableCell>
                                        <TableCell className={`text-center p-1 text-[10px] ${getCeColor()}`}>{formatValue(row.ce.oi)}</TableCell>
                                        <TableCell className={`text-center p-1 text-[10px] font-bold border-r ${row.total_oi_change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatValue(row.total_oi_change)}
                                        </TableCell>
                                        <TableCell className={`text-center p-1 text-[10px] ${getCeColor()}`}>{row.ce.ltp}</TableCell>
                                        <TableCell className={`text-center p-1 text-[10px] ${row.ce.ltp_change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {row.ce.ltp_change > 0 ? '+' : ''}{row.ce.ltp_change}
                                        </TableCell>
                                        <TableCell className={`text-center p-1 text-[10px] ${getCeColor(row.ce.oi_change)}`}>
                                            {formatValue(row.ce.oi_change)}
                                        </TableCell>
                                        <TableCell className="p-1 text-center border-r">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold inline-block w-full ${getInterpretationColor(row.ce.interpretation)}`}>
                                                {row.ce.interpretation}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center p-1 bg-slate-50 dark:bg-slate-900/50 font-bold text-[10px]">{row.strike}</TableCell>
                                        <TableCell className="p-1 text-center border-l">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold inline-block w-full ${getInterpretationColor(row.pe.interpretation)}`}>
                                                {row.pe.interpretation}
                                            </span>
                                        </TableCell>
                                        <TableCell className={`text-center p-1 text-[10px] ${getPeColor(row.pe.oi_change)}`}>
                                            {formatValue(row.pe.oi_change)}
                                        </TableCell>
                                        <TableCell className={`text-center p-1 text-[10px] ${row.pe.ltp_change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {row.pe.ltp_change > 0 ? '+' : ''}{row.pe.ltp_change}
                                        </TableCell>
                                        <TableCell className={`text-center p-1 text-[10px] ${getPeColor()}`}>{row.pe.ltp}</TableCell>
                                        <TableCell className={`text-center p-1 text-[10px] ${getPeColor()}`}>{formatValue(row.pe.oi)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
