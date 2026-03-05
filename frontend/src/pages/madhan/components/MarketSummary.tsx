import { Card } from '@/components/ui/card';

interface SummaryData {
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
}

interface MarketSummaryProps {
    summary: SummaryData;
}

export function MarketSummary({ summary }: MarketSummaryProps) {
    const formatValue = (val: number) => {
        if (val === undefined || val === null) return '0';
        const abs = Math.abs(val);
        if (abs >= 10000000) return (val / 10000000).toFixed(2) + 'Cr';
        if (abs >= 100000) return (val / 100000).toFixed(2) + 'L';
        if (abs >= 1000) return (val / 1000).toFixed(1) + 'K';
        return val.toString();
    };

    const getCeColor = (val: number = 1) => val >= 0 ? 'text-red-500' : 'text-green-500';
    const getPeColor = (val: number = 1) => val >= 0 ? 'text-green-500' : 'text-red-500';

    const getPcrColor = (val: number) => {
        if (val > 1.0) return 'text-green-500';
        if (val < 0.8) return 'text-red-500';
        return 'text-yellow-500';
    };

    const getSectionSentiment = (type: 'oi' | 'coi' | 'strikes' | 'pcr') => {
        switch (type) {
            case 'oi':
                if (summary.pcr_oi > 1.0) return { label: 'BULLISH', color: 'text-green-500' };
                if (summary.pcr_oi < 0.8) return { label: 'BEARISH', color: 'text-red-500' };
                return { label: 'NEUTRAL', color: 'text-yellow-500' };
            case 'coi':
                const net = summary.total_put_coi - summary.total_call_coi;
                if (net > 100000) return { label: 'BULLISH', color: 'text-green-500' };
                if (net < -100000) return { label: 'BEARISH', color: 'text-red-500' };
                return { label: 'NEUTRAL', color: 'text-yellow-500' };
            case 'strikes':
                if (summary.highest_put_oi.oi > summary.highest_call_oi.oi) return { label: 'SUPPORT STRONG', color: 'text-green-500' };
                return { label: 'RESISTANCE STRONG', color: 'text-red-500' };
            case 'pcr':
                if (summary.pcr_oi > 1.0 && summary.max_pain > summary.current_atm) return { label: 'BULLISH', color: 'text-green-500' };
                if (summary.pcr_oi < 0.8 && summary.max_pain < summary.current_atm) return { label: 'BEARISH', color: 'text-red-500' };
                return { label: 'CAUTION', color: 'text-yellow-500' };
        }
    };

    const getSentiment = () => {
        let score = 0;
        if (summary.pcr_oi > 1.0) score += 1;
        else if (summary.pcr_oi < 0.8) score -= 1;
        
        const netCoi = summary.total_put_coi - summary.total_call_coi;
        if (netCoi > 500000) score += 2;
        else if (netCoi > 0) score += 1;
        else if (netCoi < -500000) score -= 2;
        else if (netCoi < 0) score -= 1;

        if (summary.pcr_vol > 1.0) score += 1;
        else if (summary.pcr_vol < 0.8) score -= 1;
        
        if (summary.max_pain > summary.current_atm) score += 1;
        else if (summary.max_pain < summary.current_atm) score -= 1;
        
        if (score >= 3) return { label: 'STRONG BULLISH', color: 'text-green-500', border: 'border-l-green-500' };
        if (score >= 1) return { label: 'BULLISH', color: 'text-green-400', border: 'border-l-green-400' };
        if (score <= -3) return { label: 'STRONG BEARISH', color: 'text-red-500', border: 'border-l-red-500' };
        if (score <= -1) return { label: 'BEARISH', color: 'text-red-400', border: 'border-l-red-400' };
        return { label: 'NEUTRAL', color: 'text-yellow-500', border: 'border-l-yellow-500' };
    };

    const sentiment = getSentiment();

    const DonutChart = ({ val1, val2, isCOI = false }: { val1: number, val2: number, isCOI?: boolean }) => {
        let bullishStrength = 0;
        let bearishStrength = 0;

        if (isCOI) {
            bullishStrength = (val2 > 0 ? val2 : 0) + (val1 < 0 ? Math.abs(val1) : 0);
            bearishStrength = (val1 > 0 ? val1 : 0) + (val2 < 0 ? Math.abs(val2) : 0);
        } else {
            bullishStrength = val2;
            bearishStrength = val1;
        }

        const total = bullishStrength + bearishStrength;
        const isBullish = bullishStrength >= bearishStrength;
        const displayPercent = total > 0 ? Math.round((isBullish ? bullishStrength : bearishStrength) / total * 100) : 50;
        
        const radius = 42;
        const circumference = 2 * Math.PI * radius;
        const strokeDashoffset = circumference - (displayPercent / 100) * circumference;

        return (
            <div className="relative flex items-center justify-center w-20 h-20">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r={radius} stroke="#1a1a1a" strokeWidth="10" fill="transparent" />
                    <circle 
                        cx="60" 
                        cy="60" 
                        r={radius} 
                        stroke="currentColor" 
                        strokeWidth="10" 
                        fill="transparent" 
                        strokeDasharray={circumference} 
                        strokeDashoffset={strokeDashoffset} 
                        strokeLinecap="round" 
                        className={`${isBullish ? "text-green-500 shadow-[0_0_12px_rgba(34,197,94,0.5)]" : "text-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]"} transition-all duration-1000 ease-out`} 
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-base font-black text-white leading-none tracking-tighter">{displayPercent}%</span>
                    <span className={`text-[7px] font-black uppercase tracking-widest ${isBullish ? "text-green-500" : "text-red-500"}`}>{isBullish ? (isCOI ? "PUT BIAS" : "PUT") : (isCOI ? "CALL BIAS" : "CALL")}</span>
                </div>
            </div>
        );
    };

    const maxOI = Math.max(summary.highest_call_oi.oi, summary.highest_put_oi.oi);

    return (
        <div className="grid grid-cols-5 gap-2 w-full bg-transparent">
            {/* Total OI Section */}
            <Card className="bg-black/40 border-white/5 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl rounded-lg h-[120px]">
                <div className="absolute top-2 left-2 text-[8px] font-black text-slate-500 uppercase tracking-widest">Total OI</div>
                <div className="absolute top-2 right-2 flex gap-2">
                    <div className="flex flex-col items-end">
                        <span className="text-[6px] text-slate-600 font-black uppercase mb-0">Call</span>
                        <span className={`text-red-500 text-[9px] font-black tracking-tight`}>{formatValue(summary.total_call_oi)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[6px] text-slate-600 font-black uppercase mb-0">Put</span>
                        <span className={`text-green-500 text-[9px] font-black tracking-tight`}>{formatValue(summary.total_put_oi)}</span>
                    </div>
                </div>
                <DonutChart val1={summary.total_call_oi} val2={summary.total_put_oi} />
                <div className={`absolute bottom-1 right-2 text-[6px] font-black italic tracking-widest uppercase ${getSectionSentiment('oi').color}`}>{getSectionSentiment('oi').label}</div>
            </Card>

            {/* COI Section */}
            <Card className="bg-black/40 border-white/5 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl rounded-lg h-[120px]">
                <div className="absolute top-2 left-2 text-[8px] font-black text-slate-500 uppercase tracking-widest">Change in OI</div>
                <div className="absolute top-2 right-2 flex gap-2">
                    <div className="flex flex-col items-end">
                        <span className="text-[6px] text-slate-600 font-black uppercase mb-0">Call Chg</span>
                        <span className={`${getCeColor(summary.total_call_coi)} text-[9px] font-black tracking-tight`}>{formatValue(summary.total_call_coi)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                        <span className="text-[6px] text-slate-600 font-black uppercase mb-0">Put Chg</span>
                        <span className={`${getPeColor(summary.total_put_coi)} text-[9px] font-black tracking-tight`}>{formatValue(summary.total_put_coi)}</span>
                    </div>
                </div>
                <DonutChart val1={summary.total_call_coi} val2={summary.total_put_coi} isCOI={true} />
                <div className={`absolute bottom-1 right-2 text-[6px] font-black italic tracking-widest uppercase ${getSectionSentiment('coi').color}`}>{getSectionSentiment('coi').label}</div>
            </Card>

            {/* Strikes & ATM Section */}
            <Card className="bg-black/40 border-white/5 flex flex-col items-center justify-center relative shadow-2xl rounded-lg h-[120px]">
                <div className="absolute top-2 left-2 text-[8px] font-black text-slate-500 uppercase tracking-widest">Strikes & ATM</div>
                <div className="w-[85%] flex flex-col gap-1.5">
                    {[
                        { type: 'CE', strike: summary.highest_call_oi.strike, oi: summary.highest_call_oi.oi, color: 'text-red-500', barColor: 'bg-red-500/20' },
                        { type: 'PE', strike: summary.highest_put_oi.strike, oi: summary.highest_put_oi.oi, color: 'text-green-500', barColor: 'bg-green-500/20' },
                        { type: 'ATM', strike: summary.current_atm, oi: 0, color: 'text-blue-500', barColor: 'bg-blue-500/10' }
                    ].sort((a, b) => b.strike - a.strike).map((item, idx) => (
                        <div key={idx} className={`relative flex flex-col justify-center px-0 py-0 group overflow-hidden`}>
                            <div className="flex justify-between items-center z-10">
                                <span className={`${item.color} text-[8px] font-black tracking-wider uppercase`}>{item.type}: {item.strike}</span>
                                {item.oi > 0 ? (
                                    <span className="text-white text-[9px] font-black tracking-tight">{formatValue(item.oi)}</span>
                                ) : (
                                    <span className="text-blue-500 text-[6px] font-black italic animate-pulse">LIVE</span>
                                )}
                            </div>
                            <div className="mt-0.5 h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                {item.oi > 0 && (
                                    <div className={`h-full ${item.barColor.replace('/20', '')} transition-all duration-1000 ease-out`} style={{ width: `${(item.oi / maxOI) * 100}%` }} />
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className={`absolute bottom-1 right-2 text-[6px] font-black italic tracking-widest uppercase ${getSectionSentiment('strikes').color}`}>{getSectionSentiment('strikes').label}</div>
            </Card>

            {/* PCR & Max Pain Section */}
            <Card className="bg-black/40 border-white/5 flex flex-col items-center justify-center relative shadow-2xl rounded-lg h-[120px]">
                <div className="absolute top-2 left-2 text-[8px] font-black text-slate-500 uppercase tracking-widest">PCR & Max Pain</div>
                <div className="grid grid-cols-2 gap-2 w-[85%]">
                    <div className="flex flex-col gap-1.5 justify-center">
                        <div className="flex flex-col bg-white/5 p-1 rounded border border-white/5">
                            <span className="text-[6px] text-slate-500 font-black uppercase mb-0">PCR OI</span>
                            <span className={`text-sm font-black leading-none ${getPcrColor(summary.pcr_oi)}`}>{summary.pcr_oi}</span>
                        </div>
                        <div className="flex flex-col bg-white/5 p-1 rounded border border-white/5">
                            <span className="text-[6px] text-slate-500 font-black uppercase mb-0">PCR VOL</span>
                            <span className={`text-sm font-black leading-none ${getPcrColor(summary.pcr_vol)}`}>{summary.pcr_vol}</span>
                        </div>
                    </div>
                    
                    <div className="flex flex-col gap-1.5 justify-center">
                        <div className="flex flex-col bg-blue-500/5 p-1 rounded border border-blue-500/10">
                            <span className="text-[6px] text-blue-500/70 font-black uppercase mb-0">ATM</span>
                            <span className="text-sm font-black text-white leading-none">{summary.current_atm}</span>
                        </div>
                        <div className="flex flex-col bg-blue-500/5 p-1 rounded border border-blue-500/10">
                            <span className="text-[6px] text-blue-500/70 font-black uppercase mb-0">Pain</span>
                            <span className="text-sm font-black text-blue-400 leading-none">{summary.max_pain}</span>
                        </div>
                    </div>
                </div>
                <div className={`absolute bottom-1 right-2 text-[6px] font-black italic tracking-widest uppercase ${getSectionSentiment('pcr').color}`}>{getSectionSentiment('pcr').label}</div>
            </Card>

            {/* Sentiment Section */}
            <Card className={`bg-black border-white/5 border-l-[4px] ${sentiment.border} relative overflow-hidden flex flex-col items-center justify-center text-center shadow-2xl rounded-lg h-[120px]`}>
                <div className="absolute top-2 left-2 text-[8px] font-black text-slate-500 uppercase tracking-widest">Sentiment</div>
                <div className={`text-lg font-black tracking-tighter mb-1 uppercase ${sentiment.color} drop-shadow-[0_0_10px_rgba(34,197,94,0.3)]`}>{sentiment.label}</div>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[7px] text-slate-500 font-black bg-white/5 px-2 py-0.5 rounded-full border border-white/5 whitespace-nowrap">Net: {formatValue(summary.total_put_coi - summary.total_call_coi)}</div>
            </Card>
        </div>
    );
}
