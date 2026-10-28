import React, { useState, useEffect } from 'react';
import { CreditCard, Zap, TrendingUp, CheckCircle2, Shield, Download, PlusCircle, RefreshCw, BarChart2, Activity } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface Usage30DayPoint {
  date: string;
  characters: number;
  rollingAvg: number;
}

interface BillingData {
  creditBalance: number;
  totalMonthlyAllowance: number;
  percentRemaining: number;
  resetDate: string;
  currentPlan: {
    id: string;
    name: string;
    priceMonthly: number;
    status: string;
    billingCycle: string;
    nextBillingDate: string;
    features: string[];
  };
  dailyUsage: Array<{
    date: string;
    ttsChars: number;
    musicSec: number;
    videoRuns: number;
    cloneRuns: number;
  }>;
  past30DaysUsage?: Usage30DayPoint[];
  recentEvents: Array<{
    id: string;
    type: string;
    label: string;
    units: string;
    credits: number;
    time: string;
    status: string;
  }>;
}

// Fallback 30-day dataset if server hasn't returned it yet
const DEFAULT_30_DAYS: Usage30DayPoint[] = [
  { date: 'Sep 11', characters: 2450, rollingAvg: 2300 },
  { date: 'Sep 12', characters: 3100, rollingAvg: 2500 },
  { date: 'Sep 13', characters: 4800, rollingAvg: 2900 },
  { date: 'Sep 14', characters: 3900, rollingAvg: 3200 },
  { date: 'Sep 15', characters: 5600, rollingAvg: 3700 },
  { date: 'Sep 16', characters: 4200, rollingAvg: 3850 },
  { date: 'Sep 17', characters: 6100, rollingAvg: 4300 },
  { date: 'Sep 18', characters: 5300, rollingAvg: 4600 },
  { date: 'Sep 19', characters: 7200, rollingAvg: 5100 },
  { date: 'Sep 20', characters: 6800, rollingAvg: 5400 },
  { date: 'Sep 21', characters: 4900, rollingAvg: 5350 },
  { date: 'Sep 22', characters: 5800, rollingAvg: 5500 },
  { date: 'Sep 23', characters: 8100, rollingAvg: 6000 },
  { date: 'Sep 24', characters: 7400, rollingAvg: 6200 },
  { date: 'Sep 25', characters: 6900, rollingAvg: 6350 },
  { date: 'Sep 26', characters: 5200, rollingAvg: 6150 },
  { date: 'Sep 27', characters: 8700, rollingAvg: 6500 },
  { date: 'Sep 28', characters: 9300, rollingAvg: 7000 },
  { date: 'Sep 29', characters: 7800, rollingAvg: 7200 },
  { date: 'Sep 30', characters: 8500, rollingAvg: 7500 },
  { date: 'Oct 01', characters: 6400, rollingAvg: 7400 },
  { date: 'Oct 02', characters: 7900, rollingAvg: 7600 },
  { date: 'Oct 03', characters: 9200, rollingAvg: 7900 },
  { date: 'Oct 04', characters: 4200, rollingAvg: 7300 },
  { date: 'Oct 05', characters: 7800, rollingAvg: 7500 },
  { date: 'Oct 06', characters: 3100, rollingAvg: 6900 },
  { date: 'Oct 07', characters: 9500, rollingAvg: 7400 },
  { date: 'Oct 08', characters: 6400, rollingAvg: 7250 },
  { date: 'Oct 09', characters: 11200, rollingAvg: 7950 },
  { date: 'Oct 10', characters: 8750, rollingAvg: 8100 },
];

export const BillingDashboard: React.FC = () => {
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeUsageView, setActiveUsageView] = useState<'tts' | 'music' | 'video'>('tts');
  const [chartMode, setChartMode] = useState<'30days' | '7days'>('30days');
  const [filterType, setFilterType] = useState<string>('all');
  const [topupLoading, setTopupLoading] = useState(false);
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchBilling = async () => {
    try {
      const res = await fetch('/api/billing/summary');
      const data = await res.json();
      setBillingData(data);
    } catch (e) {
      console.error('Failed to fetch billing data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBilling();
  }, []);

  const handleTopup = async (amount: number) => {
    setTopupLoading(true);
    try {
      const res = await fetch('/api/billing/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditAmount: amount }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(data.message);
        setShowTopupModal(false);
        fetchBilling();
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTopupLoading(false);
    }
  };

  if (loading || !billingData) {
    return (
      <div className="py-20 text-center flex flex-col items-center justify-center space-y-3">
        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
        <span className="text-sm text-slate-400">Loading Billing & Account Overview...</span>
      </div>
    );
  }

  const chartData30 = billingData.past30DaysUsage && billingData.past30DaysUsage.length > 0
    ? billingData.past30DaysUsage
    : DEFAULT_30_DAYS;

  const total30DayChars = chartData30.reduce((acc, curr) => acc + curr.characters, 0);
  const avg30DayChars = Math.round(total30DayChars / chartData30.length);
  const peakDay = chartData30.reduce((max, curr) => (curr.characters > max.characters ? curr : max), chartData30[0]);

  const maxTts = Math.max(...billingData.dailyUsage.map((d) => d.ttsChars), 12000);
  const maxMusic = Math.max(...billingData.dailyUsage.map((d) => d.musicSec), 180);
  const maxVideo = Math.max(...billingData.dailyUsage.map((d) => d.videoRuns), 4);

  const filteredEvents = billingData.recentEvents.filter((ev) => {
    if (filterType === 'all') return true;
    return ev.type === filterType;
  });

  // Custom Recharts Tooltip
  const CustomRechartsTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const chars = payload.find((p: any) => p.dataKey === 'characters')?.value || 0;
      const avg = payload.find((p: any) => p.dataKey === 'rollingAvg')?.value || 0;
      return (
        <div className="bg-slate-900/95 border border-slate-700/80 p-3 rounded-xl shadow-2xl backdrop-blur-md text-xs space-y-1">
          <div className="font-bold text-white border-b border-slate-800 pb-1 flex items-center justify-between gap-4">
            <span>{label}</span>
            <span className="text-indigo-400 font-mono-code font-normal">Daily Audit</span>
          </div>
          <div className="flex items-center justify-between gap-4 pt-1">
            <span className="text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
              Daily Consumption:
            </span>
            <span className="font-mono-code text-white font-bold">{chars.toLocaleString()} chars</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              7-Day Average:
            </span>
            <span className="font-mono-code text-cyan-300 font-medium">{avg.toLocaleString()} chars</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-8 py-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-2">
              Account & Subscription Suite
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Billing & Usage Dashboard
            </h2>
            <p className="mt-1 text-slate-300 max-w-2xl text-sm leading-relaxed">
              Monitor character consumption, Lyria music generations, Veo video operations, and manage your Creator Pro subscription.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowTopupModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Add Credits</span>
            </button>
            <button
              onClick={() => {
                const csv = 'Date,Action,Units,Credits\n' + billingData.recentEvents.map(e => `${e.time},${e.label},${e.units},${e.credits}`).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'voiceforge_usage_ledger.csv';
                a.click();
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {successMessage && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}
      </div>

      {/* 1. Credit & Subscription Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Balance */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5 text-indigo-400">
              <Zap className="w-4 h-4" />
              Active Credit Balance
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold">
              {billingData.percentRemaining}% Left
            </span>
          </div>

          <div>
            <div className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              {billingData.creditBalance.toLocaleString()}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              of {billingData.totalMonthlyAllowance.toLocaleString()} characters monthly limit
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800">
              <div
                className="bg-gradient-to-r from-indigo-500 to-cyan-400 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(5, billingData.percentRemaining))}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Used: {(billingData.totalMonthlyAllowance - billingData.creditBalance).toLocaleString()} chars</span>
              <span>Renews {billingData.resetDate}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Current Plan */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5 text-violet-400">
              <CreditCard className="w-4 h-4" />
              Subscription Tier
            </span>
            <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-semibold">
              Active Monthly
            </span>
          </div>

          <div>
            <div className="text-2xl font-extrabold text-white">
              {billingData.currentPlan.name}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              <strong className="text-white text-base">${billingData.currentPlan.priceMonthly}</strong> / month • Next bill on {billingData.currentPlan.nextBillingDate}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400">Concurrency: <strong className="text-white">5 Streams</strong></span>
            <span className="text-slate-400">Cloned Voices: <strong className="text-white">20 Max</strong></span>
          </div>
        </div>

        {/* Card 3: Multilingual & Multimodal Entitlement */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5 text-emerald-400">
              <Shield className="w-4 h-4" />
              Plan Entitlements
            </span>
            <span className="text-indigo-400 font-mono-code text-[11px]">Commercial Ready</span>
          </div>

          <ul className="text-xs text-slate-300 space-y-2 pt-1">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>5 Core Languages (EN, TA, HI, ML, JA)</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Lyria Music & Nano Banana Image Studio</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Veo 3.1 Fast Video Generations</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>EU AI Act Art. 50 Audio Watermarking</span>
            </li>
          </ul>
        </div>
      </div>

      {/* 2. RECHARTS LINE CHART: 30-Day Character Consumption Trends */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              <h3 className="text-lg font-bold text-white">
                Daily Character Consumption (Past 30 Days)
              </h3>
              <span className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-mono-code uppercase font-semibold">
                Recharts Visualizer
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Continuous 30-day timeline tracking TTS character volume and 7-day rolling moving average.
            </p>
          </div>

          {/* Metric Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">30-Day Total</div>
              <div className="text-sm font-extrabold text-white font-mono-code">{total30DayChars.toLocaleString()}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Daily Average</div>
              <div className="text-sm font-extrabold text-indigo-400 font-mono-code">{avg30DayChars.toLocaleString()}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Peak Day</div>
              <div className="text-sm font-extrabold text-emerald-400 font-mono-code">{peakDay.characters.toLocaleString()}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Growth Trend</div>
              <div className="text-sm font-extrabold text-cyan-400 font-mono-code">+14.2%</div>
            </div>
          </div>
        </div>

        {/* Recharts Container */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 shadow-inner">
          <div className="w-full h-72 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData30} margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="charLineGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                  tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<CustomRechartsTooltip />} />
                <Legend
                  wrapperStyle={{ paddingTop: '12px', fontSize: '12px' }}
                  formatter={(value) => (
                    <span className="text-slate-300 font-medium">
                      {value === 'characters' ? 'Daily Characters Consumed' : '7-Day Rolling Moving Average'}
                    </span>
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="characters"
                  name="characters"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#6366f1', strokeWidth: 1, stroke: '#818cf8' }}
                  activeDot={{ r: 6, fill: '#6366f1', stroke: '#ffffff', strokeWidth: 2 }}
                />
                <Line
                  type="monotone"
                  dataKey="rollingAvg"
                  name="rollingAvg"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={{ r: 5, fill: '#06b6d4', stroke: '#ffffff', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 pt-3 border-t border-slate-800/80 gap-2">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-indigo-500 inline-block"></span>
              <span>Solid Indigo: Actual daily characters</span>
              <span className="mx-1">•</span>
              <span className="w-2.5 h-0.5 border-t border-dashed border-cyan-400 inline-block"></span>
              <span>Dashed Cyan: 7-day smoothing trend</span>
            </span>
            <span>Recorded over 30 days (Sep 11 – Oct 10)</span>
          </div>
        </div>

        {/* Secondary Category Breakdown Switcher */}
        <div className="pt-2 border-t border-slate-800/80 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider">
              <BarChart2 className="w-4 h-4 text-slate-400" />
              <span>Multi-Category Breakdown (Past 7 Days)</span>
            </div>
            <div className="flex items-center rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs">
              <button
                onClick={() => setActiveUsageView('tts')}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  activeUsageView === 'tts' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                TTS Chars
              </button>
              <button
                onClick={() => setActiveUsageView('music')}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  activeUsageView === 'music' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Lyria Music
              </button>
              <button
                onClick={() => setActiveUsageView('video')}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  activeUsageView === 'video' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Veo Videos
              </button>
            </div>
          </div>

          {/* SVG Bar Chart for 7-day categories */}
          <div className="h-36 flex items-end justify-between gap-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
            {billingData.dailyUsage.map((day, idx) => {
              let value = 0;
              let maxValue = 1;
              let unit = '';
              let barColor = '#6366f1';

              if (activeUsageView === 'tts') {
                value = day.ttsChars;
                maxValue = maxTts;
                unit = 'chars';
                barColor = '#6366f1';
              } else if (activeUsageView === 'music') {
                value = day.musicSec;
                maxValue = maxMusic;
                unit = 'sec';
                barColor = '#ec4899';
              } else {
                value = day.videoRuns;
                maxValue = maxVideo;
                unit = 'videos';
                barColor = '#f59e0b';
              }

              const heightPercent = Math.max(15, Math.round((value / maxValue) * 100));

              return (
                <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                  <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-[10px] py-1 px-2 rounded pointer-events-none whitespace-nowrap shadow border border-slate-700 z-10">
                    <strong>{value.toLocaleString()}</strong> {unit}
                  </div>
                  <div
                    className="w-full max-w-[36px] rounded-t-md transition-all duration-300 hover:brightness-125"
                    style={{
                      height: `${heightPercent}%`,
                      backgroundColor: barColor,
                    }}
                  />
                  <span className="text-[10px] text-slate-400 mt-1 font-mono-code">{day.date}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. Subscription Tier Plans Matrix */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div>
          <h3 className="text-lg font-bold text-white">Subscription Plans & Upgrades</h3>
          <p className="text-xs text-slate-400">Scale your voice generation volume and enterprise concurrency.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Free Tier */}
          <div className="p-6 rounded-xl border border-slate-800 bg-slate-950/60 space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-white">Starter Free</span>
                <span className="text-xs text-slate-500 font-mono-code">$0 / mo</span>
              </div>
              <div className="text-2xl font-black text-white mt-2">$0</div>
              <p className="text-xs text-slate-400 mt-1">For casual prototyping & voice testing.</p>

              <ul className="text-xs text-slate-300 space-y-2 mt-4">
                <li>• 10,000 characters / month</li>
                <li>• Standard TTS (5 languages)</li>
                <li>• 1 Instant Voice Clone slot</li>
                <li>• Standard queue priority</li>
              </ul>
            </div>

            <button
              disabled
              className="w-full py-2 rounded-xl bg-slate-800 text-slate-500 text-xs font-semibold cursor-not-allowed"
            >
              Free Plan
            </button>
          </div>

          {/* Creator Pro (Current) */}
          <div className="p-6 rounded-xl border-2 border-indigo-500 bg-gradient-to-b from-indigo-950/30 to-slate-950 space-y-4 flex flex-col justify-between relative shadow-lg shadow-indigo-500/10">
            <div className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full bg-indigo-500 text-white font-bold text-[10px] uppercase tracking-wider">
              Current Plan
            </div>

            <div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-white">Creator Pro</span>
                <span className="text-xs text-indigo-400 font-mono-code">$29 / mo</span>
              </div>
              <div className="text-2xl font-black text-white mt-2">$29 <span className="text-xs font-normal text-slate-400">/ mo</span></div>
              <p className="text-xs text-slate-300 mt-1">For professional narrators, podcasters & studios.</p>

              <ul className="text-xs text-slate-200 space-y-2 mt-4">
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" /> 100,000 characters / month</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" /> 20 Cloned Voice Profiles</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" /> Full Lyria Music & Nano Banana Image Access</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" /> Veo 3.1 Fast Video Studio</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" /> Commercial Royalty-Free License</li>
              </ul>
            </div>

            <button
              onClick={() => alert('Your Creator Pro plan is active and set to renew on ' + billingData.currentPlan.nextBillingDate)}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow cursor-pointer"
            >
              Active Subscription
            </button>
          </div>

          {/* Enterprise Studio */}
          <div className="p-6 rounded-xl border border-slate-800 bg-slate-950/60 space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-white">Enterprise Studio</span>
                <span className="text-xs text-slate-400 font-mono-code">$199 / mo</span>
              </div>
              <div className="text-2xl font-black text-white mt-2">$199 <span className="text-xs font-normal text-slate-400">/ mo</span></div>
              <p className="text-xs text-slate-400 mt-1">For high-throughput media apps & publishers.</p>

              <ul className="text-xs text-slate-300 space-y-2 mt-4">
                <li>• 1,000,000+ characters / month</li>
                <li>• Unlimited Voice Profiles & LoRA fine-tuning</li>
                <li>• Dedicated GPU Inference Queue</li>
                <li>• 99.9% Latency & Uptime SLA</li>
                <li>• Dedicated Technical Support</li>
              </ul>
            </div>

            <button
              onClick={() => alert('Enterprise upgrade requested! Our team will contact your account.')}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 cursor-pointer"
            >
              Upgrade to Enterprise
            </button>
          </div>
        </div>
      </div>

      {/* 4. Recent Usage Ledger */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">Recent Usage & Debited Transactions</h3>
            <p className="text-xs text-slate-400">Audit trail of generations and credit deductions.</p>
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
            {['all', 'tts', 'music', 'video', 'clone'].map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-3 py-1 rounded-lg capitalize transition-all cursor-pointer ${
                  filterType === t
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Event Description</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Units Consumed</th>
                <th className="py-3 px-4">Credits Debited</th>
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-300">
              {filteredEvents.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4 font-semibold text-white">{ev.label}</td>
                  <td className="py-3 px-4 font-mono-code uppercase text-[11px] text-indigo-400">{ev.type}</td>
                  <td className="py-3 px-4">{ev.units}</td>
                  <td className="py-3 px-4 font-mono-code text-rose-400 font-semibold">-{ev.credits.toLocaleString()}</td>
                  <td className="py-3 px-4 text-slate-400">{ev.time}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium text-[11px]">
                      {ev.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Topup Modal */}
      {showTopupModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-bold text-white flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-indigo-400" />
                Add Extra Credits
              </h4>
              <button
                onClick={() => setShowTopupModal(false)}
                className="text-slate-400 hover:text-white text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Select a credit bundle to immediately top up your account. Credits never expire.
            </p>

            <div className="space-y-3">
              {[
                { amount: 25000, price: '$5', label: '25,000 Characters' },
                { amount: 100000, price: '$18', label: '100,000 Characters (Most Popular)' },
                { amount: 500000, price: '$75', label: '500,000 Characters (Pro Pack)' },
              ].map((bundle, i) => (
                <button
                  key={i}
                  disabled={topupLoading}
                  onClick={() => handleTopup(bundle.amount)}
                  className="w-full p-3.5 rounded-xl bg-slate-950 hover:bg-indigo-950/40 border border-slate-800 hover:border-indigo-500 flex items-center justify-between text-xs text-left transition-all cursor-pointer"
                >
                  <div>
                    <div className="font-bold text-white text-sm">{bundle.label}</div>
                    <div className="text-slate-400 text-[11px] mt-0.5">Instant provision to active balance</div>
                  </div>
                  <span className="px-3 py-1 rounded-lg bg-indigo-600 text-white font-bold">{bundle.price}</span>
                </button>
              ))}
            </div>

            <div className="text-center pt-2">
              <button
                onClick={() => setShowTopupModal(false)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
