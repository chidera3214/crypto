import { useState, useEffect, useRef } from 'react';

const BINANCE_REST_URL = 'https://api.binance.com/api/v3/ticker/price';
const POLL_INTERVAL_MS = 3000; // Poll every 3 seconds

export const useLivePrice = (symbol: string) => {
    const [price, setPrice] = useState<number | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!symbol) return;

        const binanceSymbol = symbol.replace('/', '').toUpperCase();

        const fetchPrice = async () => {
            try {
                const response = await fetch(
                    `${BINANCE_REST_URL}?symbol=${binanceSymbol}`
                );

                if (!response.ok) {
                    console.warn(`Price fetch failed for ${symbol}: ${response.status}`);
                    return;
                }

                const data = await response.json();
                if (data.price) {
                    setPrice(parseFloat(data.price));
                }
            } catch (err) {
                console.warn(`Price fetch error for ${symbol}:`, err);
            }
        };

        // Fetch immediately, then poll on interval
        fetchPrice();
        intervalRef.current = setInterval(fetchPrice, POLL_INTERVAL_MS);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [symbol]);

    return price;
};
