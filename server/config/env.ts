/**
 * VoiceForge Validated Configuration
 * Validates environment variables with Zod at server boot
 */

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.number().default(3000),
  GEMINI_API_KEY: z.string().optional().default(''),
  DATABASE_URL: z.string().optional().default(''),
  APP_URL: z.string().optional().default('http://localhost:3000'),
  CORS_ALLOWED_ORIGINS: z.string().optional().default('*'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function parseEnv(): EnvConfig {
  const envData = { ...process.env, PORT: 3000 };
  const result = envSchema.safeParse(envData);
  if (!result.success) {
    console.error('[Config] Invalid environment configuration:');
    console.error(result.error.format());
    return {
      NODE_ENV: 'development',
      PORT: 3000,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
      DATABASE_URL: process.env.DATABASE_URL || '',
      APP_URL: process.env.APP_URL || 'http://localhost:3000',
      CORS_ALLOWED_ORIGINS: '*',
    };
  }
  return { ...result.data, PORT: 3000 };
}

export const config = parseEnv();
