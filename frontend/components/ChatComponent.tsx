"use client";

import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, Hash, User, TrendingUp, TrendingDown } from 'lucide-react';
import { useLivePrice } from '../hooks/useLivePrice';
import { Signal } from '../hooks/useSignal';
import { clsx } from 'clsx';

const apiHost = process.env.NEXT_PUBLIC_API_URL || 'localhost:4000';
const protocol = apiHost.includes('localhost') ? 'http' : 'https';
const SOCKET_URL = apiHost.startsWith('http') ? apiHost : `${protocol}://${apiHost}`;

interface ChatProps {
  room: string;
  title?: string;
  signalContext?: {
    signal: Signal;
    tradeTaken: boolean;
    lotSize: number;
  };
}

interface Message {
  user: string;
  message: string;
  room: string;
  timestamp: number;
}

export const ChatComponent: React.FC<ChatProps> = ({ room, title, signalContext }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const livePrice = useLivePrice(signalContext?.signal.symbol || room);

  // Mock User ID
  const [userId] = useState(`Trader_${Math.floor(Math.random() * 1000)}`);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join_room', room);
    });

    newSocket.on('chat_message', (msg: Message) => {
      if (msg.room === room) {
        setMessages(prev => [...prev, msg]);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [room]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;

    const payload = {
      room,
      message: input,
      user: userId,
      timestamp: Date.now()
    };

    socket.emit('chat_message', payload);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full bg-black/40 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/5 bg-white/5 flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Hash size={16} className="text-zinc-500" />
            <span className="font-semibold text-zinc-200">{title || room}</span>
          </div>
          {livePrice && (
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-black/40 border border-white/5">
              <span className="text-[10px] text-zinc-500 font-bold uppercase">Price</span>
              <span className="text-xs font-mono font-bold text-blue-400">${livePrice.toFixed(2)}</span>
            </div>
          )}
        </div>

        {signalContext && signalContext.tradeTaken && livePrice && (
          <div className={clsx(
            "flex justify-between items-center px-3 py-2 rounded-xl border font-mono text-xs",
            (() => {
              const { signal, lotSize } = signalContext;
              const isBuy = signal.type === 'BUY';
              const pnl = isBuy ? (livePrice - signal.price) * lotSize : (signal.price - livePrice) * lotSize;
              return pnl >= 0 ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400";
            })()
          )}>
            <div className="flex items-center gap-2">
              <TrendingUp size={14} />
              <span>LIVE PNL</span>
            </div>
            <span className="font-bold text-sm">
              {(() => {
                const { signal, lotSize } = signalContext;
                const isBuy = signal.type === 'BUY';
                const pnl = isBuy ? (livePrice - signal.price) * lotSize : (signal.price - livePrice) * lotSize;
                return `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
              })()}
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[500px]">
        {messages.length === 0 && (
          <div className="text-center text-zinc-600 text-sm py-10">
            No messages yet. Start the discussion!
          </div>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.user === userId;
          return (
            <div key={i} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <div className="flex items-center gap-2 mb-1">
                {!isMe && <User size={12} className="text-zinc-500" />}
                <span className="text-[10px] text-zinc-500">{msg.user}</span>
              </div>
              <div className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm ${isMe
                ? 'bg-blue-600 text-white rounded-br-none'
                : 'bg-zinc-800 text-zinc-200 rounded-bl-none'
                }`}>
                {msg.message}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="p-3 bg-white/5 border-t border-white/5 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your strategy..."
          className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors"
        />
        <button type="submit" className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors">
          <Send size={18} />
        </button>
      </form>
    </div>
  );
};
