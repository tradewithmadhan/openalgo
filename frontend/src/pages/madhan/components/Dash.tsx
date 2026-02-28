import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarketSummary } from './MarketSummary';

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

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [dashRes, timeRes] = await Promise.all([
                    fetch('/madhan/api/nifty/dash-data'),
                    fetch('/madhan/api/nifty/dash-time-analysis')
                ]);
                
                const dashJson = await dashRes.json();
                const timeJson = await timeRes.json();
                
                if (dashJson.status === 'success') setData(dashJson);
                if (timeJson.status === 'success') setTimeAnalysis(timeJson.data);
            } catch (error) {
                console.error("Failed to fetch Dash data", error);
            }
        };
        fetchData();
    }, [refreshTrigger]);

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
            {/* Summary Row */}
            <MarketSummary summary={data.summary} />

            {/* Interpretation Table (Image style) */}
            <Card className="flex-1 flex flex-col">
                <CardHeader className="p-2 border-b flex-shrink-0">
                    <CardTitle className="text-xs uppercase font-bold text-muted-foreground">Market Time Interval Interpretation (All Strikes)</CardTitle>
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
