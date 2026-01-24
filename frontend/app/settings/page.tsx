"use client";

import React, { useState, useEffect } from 'react';
import { Settings, Shield, Zap, Bell, Save } from 'lucide-react';
import { clsx } from 'clsx';

export default function SettingsPage() {
    const [autoExecute, setAutoExecute] = useState(false);
    const [riskPerTrade, setRiskPerTrade] = useState(1);
    const [maxOpenTrades, setMaxOpenTrades] = useState(3);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem('alpha_settings');
        if (stored) {
            const parsed = JSON.parse(stored);
            setAutoExecute(parsed.autoExecute);
            setRiskPerTrade(parsed.riskPerTrade);
            setMaxOpenTrades(parsed.maxOpenTrades);
        }
    }, []);

    const handleSave = () => {
        localStorage.setItem('alpha_settings', JSON.stringify({
            autoExecute,
            riskPerTrade,
            maxOpenTrades
        }));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <main className="min-h-screen bg-[#09090b] text-white selection:bg-blue-500/30">
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[128px]" />
            </div>

            <div className="relative z-10 max-w-3xl mx-auto px-6 py-12">
                <header className="mb-12">
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <Settings className="text-zinc-500" />
                        Control Center
                    </h1>
                    <p className="text-zinc-500 mt-2">Configure transparency, automation, and risk rules.</p>
                </header>

                <div className="space-y-6">
                    {/* Automation Section */}
                    <section className="p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800 backdrop-blur-sm">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500">
                                <Zap size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-semibold">Execution Engine</h3>
                                <p className="text-sm text-zinc-500">Enable algorithmic order execution</p>
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-4 rounded-xl bg-black/40 border border-white/5">
                            <div>
                                <span className="font-medium">Auto-Execute Mode</span>
                                <p className="text-xs text-zinc-500">Automatically take trades when scanner fires a signal with high sentiment</p>
                            </div>
                            <button
                                onClick={() => setAutoExecute(!autoExecute)}
                                className={clsx(
                                    "relative w-12 h-6 rounded-full transition-colors",
                                    autoExecute ? "bg-blue-600" : "bg-zinc-700"
                                )}>
                                <div className={clsx(
                                    "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                                    autoExecute ? "left-7" : "left-1"
                                )} />
                            </button>
                        </div>
                    </section>

                    {/* Risk Section */}
                    <section className="p-8 rounded-2xl bg-zinc-900/50 border border-zinc-800 backdrop-blur-sm">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="p-3 rounded-xl bg-green-500/10 text-green-500">
                                <Shield size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-semibold">Risk Management</h3>
                                <p className="text-sm text-zinc-500">Capital protection and position sizing</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-sm text-zinc-400">Risk per Trade (%)</label>
                                <input
                                    type="number"
                                    value={riskPerTrade}
                                    onChange={(e) => setRiskPerTrade(Number(e.target.value))}
                                    className="bg-black/50 border border-zinc-800 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500 transition-colors"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-sm text-zinc-400">Max Open Trades</label>
                                <input
                                    type="number"
                                    value={maxOpenTrades}
                                    onChange={(e) => setMaxOpenTrades(Number(e.target.value))}
                                    className="bg-black/50 border border-zinc-800 rounded-xl px-4 py-2 focus:outline-none focus:border-blue-500 transition-colors"
                                />
                            </div>
                        </div>
                    </section>

                    <footer className="flex justify-end pt-4">
                        <button
                            onClick={handleSave}
                            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all shadow-lg shadow-blue-500/20">
                            {saved ? "Settings Saved!" : <><Save size={18} /> Save Configuration</>}
                        </button>
                    </footer>
                </div>
            </div>
        </main>
    );
}
