"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSignal, Signal } from '@/hooks/useSignal';
import { SignalCard } from '@/components/SignalCard';
import { ChatComponent } from '@/components/ChatComponent';
import { Activity, ShieldCheck, Zap, Settings } from 'lucide-react';
import { clsx } from 'clsx';

export default function Home() {
  const { connected, latestSignal, signals, takenSignalIds } = useSignal();
  const [stats, setStats] = useState({ win_rate: 68, avg_rr: 2.5, total_signals: 0 });
  const [autoExecute, setAutoExecute] = useState(false);
  const [timeframeFilter, setTimeframeFilter] = useState<'ALL' | '1m' | '5m' | '15m' | '4h'>('ALL');

  useEffect(() => {
    // Fetch Stats
    const apiHost = process.env.NEXT_PUBLIC_API_URL || 'localhost:4000';
    const protocol = apiHost.includes('localhost') ? 'http' : 'https';
    const baseUrl = apiHost.startsWith('http') ? apiHost : `${protocol}://${apiHost}`;
    fetch(`${baseUrl}/stats`)
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error('Failed to fetch stats:', err));

    // Sync Auto-Execute setting
    const settings = localStorage.getItem('alpha_settings');
    if (settings) {
      setAutoExecute(JSON.parse(settings).autoExecute);
    }
  }, [signals]);

  const toggleAutoExecute = () => {
    const newState = !autoExecute;
    setAutoExecute(newState);
    const settings = JSON.parse(localStorage.getItem('alpha_settings') || '{}');
    localStorage.setItem('alpha_settings', JSON.stringify({ ...settings, autoExecute: newState }));
  };

  const filteredSignals = signals.filter(s => {
    if (timeframeFilter === 'ALL') return true;
    return s.timeframe === timeframeFilter;
  });

  return (
    <main className="min-h-screen bg-[#09090b] text-white selection:bg-blue-500/30">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/20 rounded-full blur-[128px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-16">
          <div>
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
              AlphaScanner
              <span className="text-blue-500">.</span>
            </h1>
            <p className="text-zinc-500 mt-2">Autonomous Market Intelligence</p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {/* Auto-Execute Toggle */}
            <button
              onClick={toggleAutoExecute}
              className={clsx(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all",
                autoExecute
                  ? "bg-blue-500/10 border-blue-500/20 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.1)]"
                  : "bg-zinc-900/50 border-zinc-800 text-zinc-500"
              )}>
              <Zap size={16} className={autoExecute ? "fill-blue-400" : ""} />
              {autoExecute ? "AUTO-EXECUTE: ON" : "AUTO-EXECUTE: OFF"}
            </button>

            <Link href="/settings" className="p-2 bg-zinc-900/50 border border-zinc-800 rounded-xl transition-colors text-zinc-400 hover:text-white">
              <Settings size={20} />
            </Link>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${connected ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              {connected ? "SYSTEM ONLINE" : "DISCONNECTED"}
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Main Feed */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Zap size={20} className="text-yellow-500" />
                Live Signals
              </h2>

              {/* Timeframe Filter Tabs */}
              <div className="flex p-1 bg-zinc-900/80 border border-zinc-800 rounded-lg">
                {(['ALL', '1m', '5m', '15m', '4h'] as const).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframeFilter(tf)}
                    className={clsx(
                      "px-4 py-1.5 text-xs font-bold rounded-md transition-all",
                      timeframeFilter === tf
                        ? "bg-zinc-800 text-white shadow-sm"
                        : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    {tf === 'ALL' ? 'All Timeframes' : tf.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {filteredSignals.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/50">
                <Activity className="text-zinc-700 mb-4" size={48} />
                <p className="text-zinc-500">Waiting for signals...</p>
                <p className="text-zinc-600 text-sm mt-2">
                  {timeframeFilter === 'ALL' ? 'Scanner is running...' : `No active ${timeframeFilter} signals.`}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[...filteredSignals]
                  .sort((a, b) => {
                    const aTaken = a.id && takenSignalIds.includes(a.id);
                    const bTaken = b.id && takenSignalIds.includes(b.id);
                    if (aTaken && !bTaken) return -1;
                    if (!aTaken && bTaken) return 1;
                    return 0; // Maintain arrival order otherwise
                  })
                  .map((sig, i) => (
                    <SignalCard key={sig.id || i} signal={sig} />
                  ))}
              </div>
            )}
          </div>

          {/* Sidebar / Stats */}
          <div className="space-y-8">
            <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800">
              <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                <ShieldCheck size={18} className="text-blue-500" />
                Performance
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-zinc-400">Win Rate</span>
                  <span className="text-green-400 font-mono">{stats.win_rate.toFixed(0)}%</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-zinc-400">Avg R:R</span>
                  <span className="text-white font-mono">1:{stats.avg_rr}</span>
                </div>
                <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${stats.win_rate}%` }} />
                </div>
              </div>
            </div>

            <div className="h-[500px]">
              <ChatComponent room="global" title="Global Community" />
            </div>

            <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800">
              <h3 className="text-lg font-medium mb-4">Active Modes</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-2 bg-zinc-900/50 rounded-lg">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                  <span className="text-sm text-zinc-300">Scalp: BB + RSI (1m)</span>
                </div>
                <div className="flex items-center gap-3 p-2 bg-zinc-900/50 rounded-lg">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                  <span className="text-sm text-zinc-300">BB + RSI + MACD (15m)</span>
                </div>
                <div className="flex items-center gap-3 p-2 bg-zinc-900/50 rounded-lg">
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                  <span className="text-sm text-zinc-300">BB + RSI + MACD (4h)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
