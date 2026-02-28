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
        if (abs >= 100000) return (val / 100000).toFixed(2) + 'L';
        if (abs >= 1000) return (val / 1000).toFixed(1) + 'K';
        return val.toString();
    };

    const getCeColor = (val: number = 1) => val >= 0 ? 'text-red-500' : 'text-green-500';
    const getPeColor = (val: number = 1) => val >= 0 ? 'text-green-500' : 'text-red-500';

    const getSectionSentiment = (type: 'oi' | 'coi' | 'strikes' | 'pcr') => {
        switch (type) {
            case 'oi':
                if (summary.pcr_oi > 1.1) return { label: 'BULLISH', color: 'text-green-500' };
                if (summary.pcr_oi < 0.9) return { label: 'BEARISH', color: 'text-red-500' };
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
                if (summary.pcr_oi > 1 && summary.max_pain > summary.current_atm) return { label: 'BULLISH', color: 'text-green-500' };
                if (summary.pcr_oi < 1 && summary.max_pain < summary.current_atm) return { label: 'BEARISH', color: 'text-red-500' };
                return { label: 'CAUTION', color: 'text-yellow-500' };
        }
    };

    const getSentiment = () => {
        let score = 0;
        if (summary.pcr_oi > 1.2) score += 2;
        else if (summary.pcr_oi > 1.0) score += 1;
        else if (summary.pcr_oi < 0.7) score -= 2;
        else if (summary.pcr_oi < 0.9) score -= 1;
        
        const netCoi = summary.total_put_coi - summary.total_call_coi;
        if (netCoi > 500000) score += 2;
        else if (netCoi > 0) score += 1;
        else if (netCoi < -500000) score -= 2;
        else if (netCoi < 0) score -= 1;

        if (summary.pcr_vol > 1.1) score += 1;
        else if (summary.pcr_vol < 0.9) score -= 1;
        
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
        const v1 = isCOI ? Math.max(0, val1) : val1;
        const v2 = isCOI ? Math.max(0, val2) : val2;
        const total = v1 + v2;
        const cePercent = total > 0 ? (v1 / total) * 100 : 50;
        const pePercent = 100 - cePercent;
        const isCeDominant = cePercent >= pePercent;
        const displayPercent = Math.round(isCeDominant ? cePercent : pePercent);
        const radius = 48;
        const circumference = 2 * Math.PI * radius;
        const strokeDashoffset = circumference - (displayPercent / 100) * circumference;

        return (
            <div className="relative flex items-center justify-center w-32 h-32">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r={radius} stroke="currentColor" strokeWidth="10" fill="transparent" className={isCeDominant ? "text-green-900/10" : "text-red-900/10"} />
                    <circle cx="60" cy="60" r={radius} stroke="currentColor" strokeWidth="10" fill="transparent" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" className={`${isCeDominant ? "text-red-500" : "text-green-500"} transition-all duration-700 shadow-[0_0_15px_rgba(239,68,68,0.4)]`} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-black text-white">{displayPercent}%</span>
                    <span className={`text-[10px] font-bold uppercase ${isCeDominant ? "text-red-400" : "text-green-400"}`}>{isCeDominant ? "Call" : "Put"}</span>
                    {isCOI && <span className="text-[8px] text-slate-500 font-bold uppercase mt-0.5">Writing</span>}
                </div>
            </div>
        );
    };

    return (
        <div className="grid grid-cols-5 gap-2 w-full">
            {/* Total OI Section */}
            <Card className="p-3 bg-slate-950 border-slate-800 flex flex-col items-center relative overflow-hidden">
                <div className="w-full flex justify-between items-center mb-4">
                    <div className="text-[9px] font-bold text-slate-400 uppercase">Total OI</div>
                    <div className="flex gap-4">
                        <div className="flex flex-col items-end">
                            <span className="text-[7px] text-slate-500 font-bold uppercase leading-none">Call</span>
                            <span className={`${getCeColor()} text-[10px] font-black tracking-tight`}>{formatValue(summary.total_call_oi)}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[7px] text-slate-500 font-bold uppercase leading-none">Put</span>
                            <span className={`${getPeColor()} text-[10px] font-black tracking-tight`}>{formatValue(summary.total_put_oi)}</span>
                        </div>
                    </div>
                </div>
                <div className="flex-1 flex items-center justify-center"><DonutChart val1={summary.total_call_oi} val2={summary.total_put_oi} /></div>
                <div className={`absolute bottom-1 right-2 text-[7px] font-black italic tracking-widest ${getSectionSentiment('oi').color}`}>{getSectionSentiment('oi').label}</div>
            </Card>

            {/* COI Section */}
            <Card className="p-3 bg-slate-950 border-slate-800 flex flex-col items-center relative overflow-hidden">
                <div className="w-full flex justify-between items-center mb-4">
                    <div className="text-[9px] font-bold text-slate-400 uppercase">Change in OI (COI)</div>
                    <div className="flex gap-4">
                        <div className="flex flex-col items-end">
                            <span className="text-[7px] text-slate-500 font-bold uppercase leading-none">Call Chg</span>
                            <span className={`${getCeColor(summary.total_call_coi)} text-[10px] font-black tracking-tight`}>{formatValue(summary.total_call_coi)}</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[7px] text-slate-500 font-bold uppercase leading-none">Put Chg</span>
                            <span className={`${getPeColor(summary.total_put_coi)} text-[10px] font-black tracking-tight`}>{formatValue(summary.total_put_coi)}</span>
                        </div>
                    </div>
                </div>
                <div className="flex-1 flex items-center justify-center"><DonutChart val1={summary.total_call_coi} val2={summary.total_put_coi} isCOI={true} /></div>
                <div className={`absolute bottom-1 right-2 text-[7px] font-black italic tracking-widest ${getSectionSentiment('coi').color}`}>{getSectionSentiment('coi').label}</div>
            </Card>

            {/* Strikes & ATM Section */}
            <Card className="p-3 bg-slate-950 border-slate-800 flex flex-col relative">
                <div className="text-[9px] font-bold text-slate-400 uppercase mb-2">Strikes & ATM</div>
                <div className="flex flex-col gap-1">
                    {[
                        { type: 'CE', strike: summary.highest_call_oi.strike, oi: summary.highest_call_oi.oi, color: getCeColor(), isMax: summary.highest_call_oi.oi >= summary.highest_put_oi.oi, highlight: 'bg-red-500/10 border-red-500/20' },
                        { type: 'PE', strike: summary.highest_put_oi.strike, oi: summary.highest_put_oi.oi, color: getPeColor(), isMax: summary.highest_put_oi.oi > summary.highest_call_oi.oi, highlight: 'bg-green-500/10 border-green-500/20' },
                        { type: 'ATM', strike: summary.current_atm, oi: 0, color: 'text-blue-400', isMax: false, highlight: 'bg-blue-500/5 border-blue-500/10' }
                    ].sort((a, b) => b.strike - a.strike).map((item, idx) => (
                        <div key={idx} className={`flex justify-between items-center px-1.5 py-1 rounded border ${item.highlight} ${item.isMax ? 'shadow-[0_0_10px_rgba(239,68,68,0.1)]' : ''}`}>
                            <span className={`${item.color} text-[10px] font-black`}>{item.type}: {item.strike}</span>
                            {item.oi > 0 && <span className="text-slate-100 text-[10px] font-black">{formatValue(item.oi)}</span>}
                            {item.type === 'ATM' && <span className="text-blue-400 text-[8px] font-bold italic">LIVE</span>}
                        </div>
                    ))}
                </div>
                <div className={`absolute bottom-1 right-2 text-[7px] font-black italic tracking-widest ${getSectionSentiment('strikes').color}`}>{getSectionSentiment('strikes').label}</div>
            </Card>

            {/* PCR & Max Pain Section */}
            <Card className="p-3 bg-slate-950 border-slate-800 flex flex-col relative">
                <div className="text-[9px] font-bold text-slate-400 uppercase mb-2">PCR & Max Pain</div>
                <div className="grid grid-cols-2 gap-2 flex-1">
                    <div className="flex flex-col bg-slate-900/80 p-2 rounded border border-slate-800 shadow-inner justify-center">
                        <span className="text-[7px] text-slate-500 font-bold uppercase tracking-tighter">PCR OI</span>
                        <span className="text-base font-black text-white leading-none">{summary.pcr_oi}</span>
                    </div>
                    <div className="flex flex-col bg-slate-900/80 p-2 rounded border border-slate-800 shadow-inner justify-center">
                        <span className="text-[7px] text-slate-500 font-bold uppercase tracking-tighter">PCR VOL</span>
                        <span className="text-base font-black text-white leading-none">{summary.pcr_vol}</span>
                    </div>
                    <div className="flex flex-col bg-blue-500/10 p-2 rounded border border-blue-500/20 shadow-[inset_0_0_10px_rgba(59,130,246,0.05)] justify-center">
                        <span className="text-[7px] text-blue-400/70 font-bold uppercase tracking-tighter">Max Pain</span>
                        <span className="text-base font-black text-blue-400 leading-none">{summary.max_pain}</span>
                    </div>
                    <div className="flex flex-col bg-slate-900/80 p-2 rounded border border-slate-800 shadow-inner justify-center">
                        <span className="text-[7px] text-slate-500 font-bold uppercase tracking-tighter">Current ATM</span>
                        <span className="text-base font-black text-slate-100 leading-none">{summary.current_atm}</span>
                    </div>
                </div>
                <div className={`absolute bottom-1 right-2 text-[7px] font-black italic tracking-widest ${getSectionSentiment('pcr').color}`}>{getSectionSentiment('pcr').label}</div>
            </Card>

            {/* Sentiment Section */}
            <Card className={`p-3 bg-slate-950 border-slate-800 border-l-4 ${sentiment.border} relative overflow-hidden flex flex-col items-center justify-center text-center`}>
                <div className="text-[9px] font-bold text-slate-400 uppercase mb-2">Sentiment</div>
                <div className={`text-sm font-black tracking-tight mb-1 ${sentiment.color}`}>{sentiment.label}</div>
                <div className="text-[9px] text-slate-500 font-medium">Net: {formatValue(summary.total_put_coi - summary.total_call_coi)}</div>
            </Card>
        </div>
    );
}
