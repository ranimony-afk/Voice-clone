/**
 * VoiceForge Database Client
 * Drizzle ORM configured for PostgreSQL with connection resilience
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;
let isConnected = false;

// In-memory persistent caches for zero-downtime execution and rapid response
export const memoryStore = {
  videoJobs: [] as Array<any>,
  transcriptionJobs: [] as Array<any>,
  customVoices: [] as Array<any>,
  dictionaries: [] as Array<any>,
  dubbingJobs: [] as Array<any>,
  usageEvents: [] as Array<any>,
};

export function getDatabase() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbInstance && dbUrl && dbUrl.startsWith('postgres')) {
    try {
      pool = new Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 3000,
      });

      pool.on('error', (err) => {
        console.warn('[DB Pool Notice]', err.message);
      });

      dbInstance = drizzle(pool, { schema });
      isConnected = true;
      console.log('[Database] PostgreSQL connection pool initialized with Drizzle ORM');
    } catch (e: any) {
      console.warn('[Database] Initial connection notice:', e.message);
    }
  }

  return {
    db: dbInstance,
    isConnected,
    schema,
  };
}

export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  engine: string;
  totalVideoJobs: number;
  totalTranslationJobs: number;
  totalVoices: number;
  totalDictionaries: number;
  dbUrlConfigured: boolean;
}> {
  const dbUrl = process.env.DATABASE_URL;
  const isConfigured = Boolean(dbUrl && dbUrl.startsWith('postgres'));

  let pgConnected = false;
  if (pool) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      pgConnected = true;
    } catch {
      pgConnected = false;
    }
  }

  return {
    connected: pgConnected,
    engine: pgConnected ? 'PostgreSQL 15+ (Drizzle ORM)' : 'Resilient In-Memory & File Store',
    totalVideoJobs: memoryStore.videoJobs.length,
    totalTranslationJobs: memoryStore.transcriptionJobs.length,
    totalVoices: memoryStore.customVoices.length,
    totalDictionaries: memoryStore.dictionaries.length,
    dbUrlConfigured: isConfigured,
  };
}
