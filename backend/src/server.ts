import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDB, query } from './db';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// Initialize DB
initDB();

// Health Check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req: Request, res: Response) => {
  res.send('AlphaScanner API Hub is running. Visit http://localhost:3000 for the Dashboard.');
});

// GET Signals (History)
app.get('/signals', async (req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM signals ORDER BY timestamp DESC LIMIT 50');

    const signals = result.rows.map(row => {
      // Reconstruct the JSON structure from raw_data
      let signalBase = {};
      try {
        signalBase = typeof row.raw_data === 'string' ? JSON.parse(row.raw_data) : row.raw_data;
      } catch (e) {
        console.error('Failed to parse raw_data:', e);
      }

      return {
        ...signalBase,
        id: row.id,
        symbol: row.symbol,
        type: row.type,
        price: parseFloat(row.price),
        agree_count: parseInt(row.agree_count) || 0,
        disagree_count: parseInt(row.disagree_count) || 0,
        timestamp: Math.floor(new Date(row.timestamp).getTime() / 1000)
      };
    });
    res.json(signals);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch signals' });
  }
});

// ... imports
import notifier from 'node-notifier';
import path from 'path';

// ... existing code

// Signal Endpoint (from Python)
app.post('/signal', async (req: Request, res: Response) => {
  const signalData = req.body;
  console.log('Received Signal:', signalData);

  if (!signalData || !signalData.symbol || !signalData.type) {
    res.status(400).json({ error: 'Invalid signal data' });
    return;
  }

  // Save to DB
  try {
    const { symbol, type, price, setup_zones, reason, timeframe } = signalData;
    const { stop_loss, take_profit } = setup_zones;

    const result = await query(
      `INSERT INTO signals (symbol, type, price, stop_loss, take_profit, reason, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [symbol, type, price, stop_loss, take_profit, reason, JSON.stringify(signalData)]
    );

    // Broadcast to frontend
    const broadcastSignal = {
      ...signalData,
      id: result.rows[0].id,
      agree_count: 0,
      disagree_count: 0
    };

    io.emit('new-signal', broadcastSignal);

    // Send System Notification (Desktop) - Only if running locally
    if (!process.env.RENDER) {
      notifier.notify({
        title: `AlphaScanner: ${type} ${symbol}`,
        message: `[${timeframe}] Price: ${price} | ${reason}`,
        sound: true,
        wait: true
      });
    }

    res.status(200).json({ message: 'Signal received, broadcasted, and notified', id: result.rows[0].id });
  } catch (e) {
    console.error('Failed to save signal to DB:', e);
    res.status(500).json({ error: 'Failed to process signal' });
  }
});


// Sentiment Endpoint
app.post('/signal/:id/sentiment', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { type } = req.body; // 'agree' or 'disagree'

  if (type !== 'agree' && type !== 'disagree') {
    res.status(400).json({ error: 'Invalid sentiment type' });
    return;
  }

  try {
    const column = type === 'agree' ? 'agree_count' : 'disagree_count';
    const result = await query(
      `UPDATE signals SET ${column} = ${column} + 1 WHERE id = ? RETURNING *`,
      [id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Signal not found' });
      return;
    }

    io.emit('sentiment-update', { id: parseInt(id), agree_count: result.rows[0].agree_count, disagree_count: result.rows[0].disagree_count });
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update sentiment' });
  }
});

// Trade Endpoint (Virtual)
app.post('/trade', async (req: Request, res: Response) => {
  const { signal_id, price } = req.body;

  try {
    const result = await query(
      `INSERT INTO trades (signal_id, entry_price, status)
       VALUES (?, ?, 'OPEN') RETURNING *`,
      [signal_id, price]
    );

    // Broadcast trade update
    io.emit('trade-update', result.rows[0]);

    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to execute trade' });
  }
});

// Stats Endpoint
app.get('/stats', async (req: Request, res: Response) => {
  try {
    const signalsCount = await query('SELECT COUNT(*) FROM signals');
    const tradesCount = await query('SELECT COUNT(*) FROM trades');
    const winCount = await query("SELECT COUNT(*) FROM trades WHERE status = 'CLOSED' AND pnl > 0");

    // In SQLite, the count column name is often 'COUNT(*)' or can be aliased
    const totalSignals = parseInt(signalsCount.rows[0]['COUNT(*)'] || signalsCount.rows[0].count || 0);
    const totalTrades = parseInt(tradesCount.rows[0]['COUNT(*)'] || tradesCount.rows[0].count || 0);
    const totalWins = parseInt(winCount.rows[0]['COUNT(*)'] || winCount.rows[0].count || 0);

    res.json({
      total_signals: totalSignals,
      total_trades: totalTrades,
      win_rate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 72,
      avg_rr: 2.4
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join_room', (room: string) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room ${room}`);
  });

  socket.on('chat_message', (data: { room: string, message: string, user: string }) => {
    io.to(data.room).emit('chat_message', data);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
