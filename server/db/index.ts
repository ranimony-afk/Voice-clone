/**
 * VoiceForge Database Client
 * Drizzle ORM configured for PostgreSQL with connection resilience
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';
import { isRestrictedEnvironment } from '../config/env.ts';

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
  consentRecords: [] as Array<any>,
  privateMedia: [] as Array<any>,
  synthesisJobs: [] as Array<any>,
  auditEvents: [] as Array<any>,
  revokedTokens: new Set<string>(),
};

export class FatalDatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalDatabaseConfigurationError';
  }
}

/**
 * Asserts that the database is explicitly and safely configured for the active environment.
 * In staging and production, missing or malformed database configuration fails closed immediately.
 */
export function assertDatabaseConfigured(environment?: string): void {
  const isStagingOrProd = isRestrictedEnvironment(
    environment !== undefined ? environment : process.env.NODE_ENV
  );

  if (isStagingOrProd) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl || typeof dbUrl !== 'string' || !dbUrl.trim() || !dbUrl.startsWith('postgres')) {
      throw new FatalDatabaseConfigurationError(
        'FATAL DATABASE CONFIGURATION: In staging and production environments, DATABASE_URL must be configured with a valid postgresql:// connection string. Silent in-memory database fallback is strictly prohibited.'
      );
    }
    if (process.env.VOICEFORGE_ALLOW_IN_MEMORY_DB === 'true') {
      throw new FatalDatabaseConfigurationError(
        'FATAL DATABASE CONFIGURATION: VOICEFORGE_ALLOW_IN_MEMORY_DB is strictly prohibited in staging and production environments.'
      );
    }
  }
}

export function getDatabase() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbInstance && dbUrl && dbUrl.startsWith('postgres')) {
    try {
      const isLocal = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl.includes('sslmode=disable');
      pool = new Pool({
        connectionString: dbUrl,
        ssl: isLocal ? false : { rejectUnauthorized: false },
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
  ready: boolean;
  error?: string;
}> {
  const isStagingOrProd = isRestrictedEnvironment(process.env.NODE_ENV);
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

  const isReady = isStagingOrProd ? pgConnected : true;
  const errorMsg = (!pgConnected && isStagingOrProd)
    ? 'PostgreSQL connection offline or unconfigured in staging/production environment.'
    : undefined;

  return {
    connected: pgConnected,
    engine: pgConnected ? 'PostgreSQL 15+ (Drizzle ORM)' : (isStagingOrProd ? 'UNAVAILABLE' : 'Development In-Memory Store'),
    totalVideoJobs: memoryStore.videoJobs.length,
    totalTranslationJobs: memoryStore.transcriptionJobs.length,
    totalVoices: memoryStore.customVoices.length,
    totalDictionaries: memoryStore.dictionaries.length,
    dbUrlConfigured: isConfigured,
    ready: isReady,
    error: errorMsg,
  };
}
