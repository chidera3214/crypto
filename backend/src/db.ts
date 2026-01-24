import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import { Pool } from 'pg';

let sqliteDb: Database | null = null;
let pgPool: Pool | null = null;
let isPostgres = false;

export const initDB = async () => {
  try {
    if (process.env.DATABASE_URL) {
      // PostgreSQL Mode (Render)
      console.log('[DB] Detected DATABASE_URL. Switching to PostgreSQL mode.');
      isPostgres = true;
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false // Required for Render's self-signed certs
        }
      });

      // Test connection
      const client = await pgPool.connect();
      console.log('[DB] Connected to PostgreSQL successfully.');
      client.release();

      // Create Tables for Postgres
      await query(`
        CREATE TABLE IF NOT EXISTS signals (
          id SERIAL PRIMARY KEY,
          symbol TEXT NOT NULL,
          type TEXT NOT NULL,
          price REAL NOT NULL,
          stop_loss REAL NOT NULL,
          take_profit REAL NOT NULL,
          reason TEXT,
          agree_count INTEGER DEFAULT 0,
          disagree_count INTEGER DEFAULT 0,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          raw_data TEXT
        );
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS trades (
          id SERIAL PRIMARY KEY,
          signal_id INTEGER REFERENCES signals(id),
          entry_price REAL NOT NULL,
          quantity REAL DEFAULT 1.0,
          status TEXT DEFAULT 'OPEN',
          pnl REAL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

    } else {
      // SQLite Mode (Local)
      const dbPath = path.join(process.cwd(), 'database.sqlite');
      console.log(`[DB] Using SQLite database at: ${dbPath}`);
      isPostgres = false;

      sqliteDb = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });

      // Create Tables for SQLite
      await sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS signals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          type TEXT NOT NULL,
          price REAL NOT NULL,
          stop_loss REAL NOT NULL,
          take_profit REAL NOT NULL,
          reason TEXT,
          agree_count INTEGER DEFAULT 0,
          disagree_count INTEGER DEFAULT 0,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          raw_data TEXT
        );
      `);

      await sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          signal_id INTEGER,
          entry_price REAL NOT NULL,
          quantity REAL DEFAULT 1.0,
          status TEXT DEFAULT 'OPEN',
          pnl REAL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (signal_id) REFERENCES signals(id)
        );
      `);
      console.log('[DB] SQLite Database initialized successfully.');
    }
  } catch (err) {
    console.error('[DB] Error initializing database:', err);
  }
};

export const query = async (text: string, params: any[] = []) => {
  if (isPostgres) {
    if (!pgPool) throw new Error("PostgreSQL pool not initialized");

    // Postgres uses $1, $2, etc. SQLite uses ?
    // We need to convert ? to $1, $2 if usage was purely based on SQLite style params
    // OR we standardize on one. Since original code assumed SQLite (?), let's convert ? to $n for PG.

    let paramIndex = 1;
    const pgText = text.replace(/\?/g, () => `$${paramIndex++}`);

    const result = await pgPool.query(pgText, params);
    return { rows: result.rows, rowCount: result.rowCount };
  } else {
    if (!sqliteDb) throw new Error("SQLite database not initialized");

    if (text.toLowerCase().startsWith('select')) {
      const rows = await sqliteDb.all(text, params);
      return { rows, rowCount: rows.length };
    } else {
      const result = await sqliteDb.run(text, params);
      // SQLite RETURNING simulation if needed, but for now we rely on the implementation plan
      // that RETURNING works on modern sqlite or we just return rows if available.

      // If the query has RETURNING, we try to fetch it.
      if (text.toUpperCase().includes('RETURNING')) {
        // In SQLite 'run' doesn't return rows. 'all' does.
        // If we used 'run' above, we missed the return.
        // Let's us 'all' if RETURNING is present.
      }

      // Re-run safely for RETURNING clauses in SQLite if the first run didn't return rows?
      // Actually simply using 'all' for everything in SQLite is safer if we want return values
      // EXCEPT 'run' provides lastID and changes. 

      // Let's refine the strategy:
      // If it is INSERT/UPDATE with RETURNING, use 'all'.
      if (text.toUpperCase().includes('RETURNING')) {
        const rows = await sqliteDb.all(text, params);
        return { rows, rowCount: rows.length };
      }

      return { rows: [], rowCount: result.changes };
    }
  }
};
