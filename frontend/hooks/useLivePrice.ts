import { useState, useEffect } from 'react';

export const useLivePrice = (symbol: string) => {
    const [price, setPrice] = useState<number | null>(null);

    useEffect(() => {
        if (!symbol) return;

        const binanceSymbol = symbol.replace('/', '').toLowerCase();
        const streamUrl = `wss://stream.binance.com:9443/ws/${binanceSymbol}@ticker`;

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
