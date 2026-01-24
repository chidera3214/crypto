import { useState } from 'react';

const apiHost = process.env.NEXT_PUBLIC_API_URL || 'localhost:4000';
const protocol = apiHost.includes('localhost') ? 'http' : 'https';
const baseUrl = apiHost.startsWith('http') ? apiHost : `${protocol}://${apiHost}`;
const API_URL = `${baseUrl}/trade`;

export interface Trade {
    id: number;
    signal_id: number;
    entry_price: number;
    status: string;
    pnl: number;
}

export const useTrade = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const executeTrade = async (signalId: number, price: number) => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ signal_id: signalId, price }),
            });

            if (!response.ok) {
                throw new Error('Failed to execute trade');
            }

            const trade: Trade = await response.json();
            return trade;
        } catch (err: any) {
            setError(err.message || 'Unknown error');
            return null;
        } finally {
            setLoading(false);
        }
    };

    return { executeTrade, loading, error };
};
