import { useState, useEffect } from 'react';

export const useLivePrice = (symbol: string) => {
    const [price, setPrice] = useState<number | null>(null);

    useEffect(() => {
        if (!symbol) return;

        // Mapping for specific internal symbols to valid Binance Stream symbols
        // Format: [stream_symbol, endpoint_type]
        // endpoint_type: 'spot', 'fapi' (USDT-M), 'dapi' (COIN-M)
        const symbolMap: { [key: string]: [string, 'spot' | 'fapi' | 'dapi'] } = {
            'BTCUSD': ['btcusd_perp', 'dapi'], // Coin-Margined Futures (USD Quoted)
            'XAUUSD': ['xauusdt', 'fapi'],     // USDT-Margined Futures
            'BTC/USD': ['btcusd_perp', 'dapi'],
            'XAU/USD': ['xauusdt', 'fapi']
        };

        let binanceSymbol = symbol.replace('/', '').toLowerCase();
        let type: 'spot' | 'fapi' | 'dapi' = 'spot';

        // Override if in map
        if (symbolMap[symbol]) {
            [binanceSymbol, type] = symbolMap[symbol];
        } else if (symbolMap[symbol.toUpperCase()]) {
            [binanceSymbol, type] = symbolMap[symbol.toUpperCase()];
        }

        let baseUrl = 'wss://stream.binance.com:9443/ws';
        if (type === 'fapi') baseUrl = 'wss://fstream.binance.com/ws';
        if (type === 'dapi') baseUrl = 'wss://dstream.binance.com/ws';

        const streamUrl = `${baseUrl}/${binanceSymbol}@ticker`;

        const ws = new WebSocket(streamUrl);

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.c) {
                setPrice(parseFloat(data.c));
            }
        };

        ws.onerror = (err) => {
            console.error(`WebSocket error for ${symbol}:`, err);
        };

        return () => {
            ws.close();
        };
    }, [symbol]);

    return price;
};
