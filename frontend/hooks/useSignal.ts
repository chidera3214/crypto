import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const apiHost = process.env.NEXT_PUBLIC_API_URL || 'localhost:4000';
const protocol = apiHost.includes('localhost') ? 'http' : 'https';
const SOCKET_URL = apiHost.startsWith('http') ? apiHost : `${protocol}://${apiHost}`;

export interface Signal {
  id?: number;
  symbol: string;
  timeframe: string;
  type: 'BUY' | 'SELL';
  timestamp: number;
  price: number;
  agree_count?: number;
  disagree_count?: number;
  setup_zones: {
    entry_zone: { high: number; low: number };
    stop_loss: number;
    take_profit: number;
  };
  reason: string;
  context_candles?: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
}

const apiHostForFetch = process.env.NEXT_PUBLIC_API_URL || 'localhost:4000';
const isLocal = apiHostForFetch.includes('localhost');
const fetchProtocol = isLocal ? 'http' : 'https';
const baseUrl = apiHostForFetch.startsWith('http') ? apiHostForFetch : `${fetchProtocol}://${apiHostForFetch}`;
const API_URL = `${baseUrl}/signals`;

export const useSignal = () => {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [latestSignal, setLatestSignal] = useState<Signal | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Fetch History
    fetch(API_URL)
      .then(res => res.json())
      .then(data => setSignals(data))
      .catch(err => console.error('Failed to fetch signal history:', err));

    const socket = io(SOCKET_URL);

    socket.on('connect', () => {
      console.log('Connected to Signal Hub');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from Signal Hub');
      setConnected(false);
    });

    socket.on('new-signal', (signal: Signal) => {
      console.log('New Signal Received:', signal);
      setLatestSignal(signal);
      setSignals((prev) => [signal, ...prev]);
    });

    socket.on('sentiment-update', (data: { id: number, agree_count: number, disagree_count: number }) => {
      setSignals(prev => prev.map(s => s.id === data.id ? { ...s, agree_count: data.agree_count, disagree_count: data.disagree_count } : s));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const [takenSignalIds, setTakenSignalIds] = useState<number[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('alpha_taken_signals');
    if (saved) {
      setTakenSignalIds(JSON.parse(saved));
    }
  }, []);

  const markAsTaken = (id: number) => {
    setTakenSignalIds(prev => {
      if (prev.includes(id)) return prev;
      const next = [id, ...prev];
      localStorage.setItem('alpha_taken_signals', JSON.stringify(next));
      return next;
    });
  };

  return { connected, latestSignal, signals, takenSignalIds, markAsTaken };
};
