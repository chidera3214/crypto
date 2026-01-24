import React, { useState, useEffect } from 'react';
import { Signal, useSignal } from '../hooks/useSignal';
import { useTrade } from '../hooks/useTrade';
import { useLivePrice } from '../hooks/useLivePrice';
import { ChartComponent } from './ChartComponent';
import { ChatComponent } from './ChatComponent';
import { ArrowUp, ArrowDown, Activity, X, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';

interface SignalCardProps {
  signal: Signal;
}

export const SignalCard: React.FC<SignalCardProps> = ({ signal }) => {
  const [showChart, setShowChart] = useState(false);
  const { connected, markAsTaken, takenSignalIds } = useSignal();
  const { executeTrade, loading, error } = useTrade();
  const [tradeTaken, setTradeTaken] = useState(false);
  const [voted, setVoted] = useState(false);
  const [isAutoExecuting, setIsAutoExecuting] = useState(false);

  // Risk Management State
  const [balance, setBalance] = useState(20); // Default to $20 as per user request
  const [riskPercent, setRiskPercent] = useState(2); // Risk 2% per trade

  const isBuy = signal.type === 'BUY';
  const date = new Date(signal.timestamp * 1000).toLocaleTimeString();
  const livePrice = useLivePrice(signal.symbol);

  const stopLoss = signal.setup_zones?.stop_loss || 0;
  const takeProfit = signal.setup_zones?.take_profit || 0;

  useEffect(() => {
    if (signal.id && takenSignalIds.includes(signal.id)) {
      setTradeTaken(true);
    }

    const settings = localStorage.getItem('alpha_settings');
    if (settings) {
      const { autoExecute } = JSON.parse(settings);
      if (autoExecute && !tradeTaken) {
        handleAutoTrade();
      }
    }
  }, [takenSignalIds]);

  const handleAutoTrade = async () => {
    setIsAutoExecuting(true);
    // Add a small delay to simulate "thinking" or high-speed execution
    setTimeout(async () => {
      await handleTrade();
      setIsAutoExecuting(false);
    }, 1500);
  };

  const handleTrade = async () => {
    if (!signal.id) return;
    const result = await executeTrade(signal.id, signal.price);
    if (result) {
      setTradeTaken(true);
      markAsTaken(signal.id);
    }
  };

  const handleSentiment = async (type: 'agree' | 'disagree') => {
    if (voted || !signal.id) return;
    try {
      const apiHost = process.env.NEXT_PUBLIC_API_URL || 'localhost:4000';
      const protocol = apiHost.includes('localhost') ? 'http' : 'https';
      const baseUrl = apiHost.startsWith('http') ? apiHost : `${protocol}://${apiHost}`;
      await fetch(`${baseUrl}/signal/${signal.id}/sentiment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      setVoted(true);
    } catch (err) {
      console.error('Failed to vote:', err);
    }
  };

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl bg-white/5 p-6 shadow-xl backdrop-blur-xl border border-white/10 transition-all hover:bg-white/10">
        <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-transparent via-blue-500 to-transparent opacity-50" />

        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-2xl font-bold text-white tracking-tight">{signal.symbol}</h3>
            <span className="text-xs text-zinc-400 font-mono">{signal.timeframe} • {date}</span>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className={clsx(
              "px-3 py-1 rounded-full text-xs font-bold tracking-wider flex items-center gap-1",
              isBuy ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
            )}>
              {isBuy ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
              {signal.type}
            </div>

            <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">
              <span className="text-[10px] text-zinc-500 font-bold uppercase">Live</span>
              <span className={clsx(
                "text-sm font-mono font-bold",
                livePrice && livePrice > signal.price ? "text-green-400" : "text-red-400"
              )}>
                ${livePrice?.toFixed(2) || "---"}
              </span>
            </div>
            <div className="flex items-center gap-2 bg-black/40 px-2 py-1 rounded-lg border border-white/5">
              <button
                onClick={() => handleSentiment('agree')}
                disabled={voted}
                className={clsx("flex items-center gap-1 text-[10px] font-bold transition-colors", voted ? "text-zinc-600" : "text-green-500 hover:text-green-400")}>
                <CheckCircle size={12} /> {signal.agree_count || 0}
              </button>
              <div className="w-[1px] h-3 bg-zinc-800" />
              <button
                onClick={() => handleSentiment('disagree')}
                disabled={voted}
                className={clsx("flex items-center gap-1 text-[10px] font-bold transition-colors", voted ? "text-zinc-600" : "text-red-500 hover:text-red-400")}>
                <X size={12} /> {signal.disagree_count || 0}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center p-3 rounded-lg bg-black/20 border border-white/5">
            <span className="text-sm text-zinc-400">Entry Price</span>
            <span className="text-lg font-mono text-white font-medium">{signal.price.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <span className="block text-xs text-red-300 mb-1">Stop Loss</span>
              <span className="font-mono text-red-200">{stopLoss.toFixed(2)}</span>
            </div>
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <span className="block text-xs text-green-300 mb-1">Take Profit</span>
              <span className="font-mono text-green-200">{takeProfit.toFixed(2)}</span>
            </div>
          </div>

          <p className="text-sm text-zinc-400 mt-2 italic border-l-2 border-zinc-700 pl-3">
            "{signal.reason}"
          </p>

          {/* Dynamic Position Sizer */}
          <div className="mt-4 p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 space-y-3">
            <div className="flex justify-between items-center text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
              <span>Position Sizer</span>
              <span className="text-blue-400 flex items-center gap-1"><ShieldCheck size={10} /> Safe Mode</span>
            </div>

            <div className="flex gap-4 items-center">
              <div className="flex-1">
                <label className="text-[10px] text-zinc-500 block mb-1">Account Balance ($)</label>
                <input
                  type="number"
                  value={balance}
                  onChange={(e) => setBalance(Number(e.target.value))}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-blue-500/50"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-zinc-500 block mb-1">Risk per trade (%)</label>
                <input
                  type="number"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(Number(e.target.value))}
                  className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-blue-500/50"
                />
              </div>
            </div>

            {(() => {
              const distanceToSL = Math.abs(signal.price - stopLoss);
              const distanceToTP = Math.abs(signal.price - takeProfit);
              const riskAmount = (balance * riskPercent) / 100;
              const lotSize = riskAmount / distanceToSL;
              const potentialProfit = lotSize * distanceToTP;

              // LIVE PNL if trade is taken
              const currentPrice = livePrice || signal.price;
              const pnl = tradeTaken ? (isBuy ? (currentPrice - signal.price) * lotSize : (signal.price - currentPrice) * lotSize) : 0;

              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
                    <div>
                      <span className="text-[10px] text-zinc-500 block uppercase font-bold">Lot Size</span>
                      <span className="text-sm font-mono text-blue-400 font-bold">
                        {lotSize < 0.00001 ? "Dust" : lotSize.toFixed(6)} <span className="text-[10px] font-normal opacity-70 italic">BTC</span>
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-zinc-500 block uppercase font-bold">Risk vs Reward</span>
                      <span className="text-xs font-mono">
                        <span className="text-red-400">-${riskAmount.toFixed(2)}</span>
                        <span className="mx-1 text-zinc-600">/</span>
                        <span className="text-green-400">+${potentialProfit.toFixed(2)}</span>
                      </span>
                    </div>
                  </div>

                  {tradeTaken && (
                    <div className={clsx(
                      "p-2 rounded-lg text-center font-mono font-bold text-sm",
                      pnl >= 0 ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"
                    )}>
                      LIVE PNL: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-white/5 flex gap-2">
          <button
            onClick={() => setShowChart(true)}
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-2 rounded-lg transition-colors shadow-lg shadow-blue-500/20">
            View Setup
          </button>

          {!tradeTaken ? (
            <button
              onClick={handleTrade}
              disabled={loading || isAutoExecuting}
              className={clsx(
                "px-3 text-white rounded-lg transition-colors flex items-center gap-2 font-medium",
                (loading || isAutoExecuting) ? "bg-zinc-700 cursor-not-allowed" : "bg-green-600 hover:bg-green-500"
              )}>
              {loading || isAutoExecuting ? (
                <>
                  <Activity size={18} className="animate-spin" />
                  <span className="text-xs">{isAutoExecuting ? "Auto-Executing..." : "Processing..."}</span>
                </>
              ) : (
                <>
                  <Activity size={18} />
                  <span>Take</span>
                </>
              )}
            </button>
          ) : (
            <div className="px-3 py-2 bg-green-500/20 text-green-400 rounded-lg flex items-center gap-2 border border-green-500/30">
              <CheckCircle size={18} />
              <span className="text-sm font-bold">Taken</span>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
            <AlertCircle size={12} />
            {error}
          </div>
        )}
      </div>

      {showChart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center p-4 border-b border-zinc-800 bg-zinc-900/50">
              <div>
                <h3 className="font-bold text-white">{signal.symbol} Setup</h3>
                <p className="text-xs text-zinc-400">Live Market Data via Binance</p>
              </div>
              <button onClick={() => setShowChart(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors text-zinc-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-col md:flex-row h-[600px]">
              {/* Left: Chart */}
              <div className="flex-1 p-4 bg-black border-r border-zinc-800 overflow-hidden">
                <ChartComponent signal={signal} />
              </div>

              {/* Right: Chat */}
              <div className="w-full md:w-[350px] p-4 bg-zinc-900/50">
                <ChatComponent
                  room={signal.symbol}
                  title={`${signal.symbol} Discussion`}
                  signalContext={{
                    signal,
                    tradeTaken,
                    lotSize: (balance * riskPercent / 100) / Math.abs(signal.price - (signal.setup_zones?.stop_loss || 0))
                  }}
                />
              </div>
            </div>

            <div className="p-4 bg-zinc-900/50 flex justify-end gap-3 border-t border-zinc-800">
              <button onClick={() => setShowChart(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">
                Dismiss
              </button>

              {!tradeTaken ? (
                <button
                  onClick={handleTrade}
                  disabled={loading || isAutoExecuting}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg font-medium shadow-lg shadow-green-500/20 flex items-center gap-2">
                  {loading || isAutoExecuting ? (isAutoExecuting ? "Auto-Executing..." : "Processing...") : "Place Trade"}
                </button>
              ) : (
                <button disabled className="px-4 py-2 bg-zinc-800 text-green-400 text-sm rounded-lg font-medium border border-green-500/20">
                  Trade Executed
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
