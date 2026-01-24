"use client";

import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, ISeriesApi, Time, CandlestickSeries } from 'lightweight-charts';
import { Signal } from '../hooks/useSignal';

interface ChartComponentProps {
  signal: Signal;
}

export const ChartComponent: React.FC<ChartComponentProps> = ({ signal }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || !signal.context_candles) return;

    const width = chartContainerRef.current.clientWidth || 600;
    const height = 400;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#09090b' },
        textColor: '#d4d4d8',
      },
      grid: {
        vertLines: { color: '#27272a' },
        horzLines: { color: '#27272a' },
      },
      width: width,
      height: height,
    });

    // 1. Candlestick Series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const seenTimes = new Set<number>();
    const candles = signal.context_candles
      .map(c => ({
        time: (Number(c.time)) as Time,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      }))
      .filter(c => {
        const t = Number(c.time);
        if (isNaN(t) || seenTimes.has(t)) return false;
        seenTimes.add(t);
        return true;
      })
      .sort((a, b) => (Number(a.time)) - (Number(b.time)));

    if (candles.length > 0) {
      candleSeries.setData(candles);
    }

    // 2. Overlays
    const { setup_zones, price } = signal;
    if (!setup_zones) return;

    // Entry Line
    candleSeries.createPriceLine({
      price: price,
      color: '#3b82f6',
      lineWidth: 2,
      lineStyle: 0, // Solid
      axisLabelVisible: true,
      title: 'ENTRY',
    });

    // Entry Zone (High/Low)
    if (setup_zones.entry_zone) {
      candleSeries.createPriceLine({
        price: setup_zones.entry_zone.high,
        color: '#3b82f6',
        lineWidth: 1,
        lineStyle: 1, // Dotted
        axisLabelVisible: true,
        title: 'ZONE HIGH',
      });

      candleSeries.createPriceLine({
        price: setup_zones.entry_zone.low,
        color: '#3b82f6',
        lineWidth: 1,
        lineStyle: 1, // Dotted
        axisLabelVisible: true,
        title: 'ZONE LOW',
      });
    }

    // Stop Loss
    if (setup_zones.stop_loss) {
      candleSeries.createPriceLine({
        price: setup_zones.stop_loss,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 1, // Dotted
        axisLabelVisible: true,
        title: 'SL',
      });
    }

    // Take Profit
    if (setup_zones.take_profit) {
      candleSeries.createPriceLine({
        price: setup_zones.take_profit,
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: 1, // Dotted
        axisLabelVisible: true,
        title: 'TP',
      });
    }

    // 3. Live WebSocket Feed
    const binanceSymbol = signal.symbol.replace('/', '').toLowerCase();
    const interval = signal.timeframe || '15m';

    // Attempt multiple stream endpoints in case of regional blocks
    const streamEndpoints = [
      `wss://stream.binance.com:9443/ws/${binanceSymbol}@kline_${interval}`,
      `wss://stream1.binance.com:9443/ws/${binanceSymbol}@kline_${interval}`,
      `wss://stream2.binance.com:9443/ws/${binanceSymbol}@kline_${interval}`,
      `wss://stream3.binance.com:9443/ws/${binanceSymbol}@kline_${interval}`
    ];

    let ws: WebSocket;
    let endpointIndex = 0;

    const connectWS = () => {
      if (endpointIndex >= streamEndpoints.length) return;

      ws = new WebSocket(streamEndpoints[endpointIndex]);

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const kline = message.k;

        candleSeries.update({
          time: (kline.t / 1000) as Time,
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
        });
      };

      ws.onerror = () => {
        console.warn(`WebSocket error on ${streamEndpoints[endpointIndex]}. Trying next...`);
        endpointIndex++;
        connectWS();
      };
    };

    connectWS();

    // Fit Content
    if (candles.length > 1) {
      chart.timeScale().fitContent();
    }

    // Resize Observer
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (ws) ws.close();
      chart.remove();
    };
  }, [signal]);

  return (
    <div ref={chartContainerRef} className="w-full h-[400px] bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800" />
  );
};
