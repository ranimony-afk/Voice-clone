/**
 * VoiceForge Validated Configuration
 * Validates environment variables with Zod at server boot and provides
 * fail-closed runtime environment resolution so staging or unrecognized
 * NODE_ENV values can never silently degrade into development mode.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

export const ALLOWED_NODE_ENVS = ['development', 'staging', 'production', 'test'] as const;
export type RuntimeEnvironment = (typeof ALLOWED_NODE_ENVS)[number];

/**
 * Resolves the runtime environment fail-closed:
 * - Unset (`undefined`) defaults to `'development'` for local developer ergonomics.
 * - Explicit `'development' | 'staging' | 'production' | 'test'` resolves as-is.
 * - Any other explicit value (empty string, `'prod'`, `'stage'`, uppercase, typo)
 *   fails closed to `'production'` so misconfiguration never unlocks development-only paths.
 */
export function resolveRuntimeEnvironment(
  rawNodeEnv: string | undefined = process.env.NODE_ENV
): RuntimeEnvironment {
  // Note: In Node.js, `process.env.NODE_ENV = undefined` coerces `undefined` to the literal string `'undefined'`.
  if (rawNodeEnv === undefined || rawNodeEnv === 'undefined') {
    return 'development';
  }
  const normalized = rawNodeEnv.trim();
  if (
    normalized === 'development' ||
    normalized === 'staging' ||
    normalized === 'production' ||
    normalized === 'test'
  ) {
    return normalized;
  }
  return 'production';
}

export function isDevelopmentEnvironment(
  rawNodeEnv: string | undefined = process.env.NODE_ENV
): boolean {
  return resolveRuntimeEnvironment(rawNodeEnv) === 'development';
}

export function isRestrictedEnvironment(
  rawNodeEnv: string | undefined = process.env.NODE_ENV
): boolean {
  const env = resolveRuntimeEnvironment(rawNodeEnv);
  return env === 'staging' || env === 'production';
}

const envSchema = z.object({
  NODE_ENV: z.enum(ALLOWED_NODE_ENVS).default('development'),
  PORT: z.number().default(3000),
  GEMINI_API_KEY: z.string().optional().default(''),
  DATABASE_URL: z.string().optional().default(''),
  APP_URL: z.string().optional().default('http://localhost:3000'),
  CORS_ALLOWED_ORIGINS: z.string().optional().default('*'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: NodeJS.ProcessEnv = process.env): EnvConfig {
  const resolvedNodeEnv = resolveRuntimeEnvironment(rawEnv.NODE_ENV);
  const restricted = resolvedNodeEnv === 'staging' || resolvedNodeEnv === 'production';
  const envData = {
    ...rawEnv,
    NODE_ENV: resolvedNodeEnv,
    PORT: 3000,
  };

  const result = envSchema.safeParse(envData);
  if (!result.success) {
    console.error('[Config] Invalid environment configuration:');
    console.error(result.error.format());
    return {
      NODE_ENV: resolvedNodeEnv,
      PORT: 3000,
      GEMINI_API_KEY: rawEnv.GEMINI_API_KEY || '',
      DATABASE_URL: rawEnv.DATABASE_URL || '',
      APP_URL: rawEnv.APP_URL || 'http://localhost:3000',
      CORS_ALLOWED_ORIGINS: restricted ? '' : '*',
    };
  }
  return { ...result.data, NODE_ENV: resolvedNodeEnv, PORT: 3000 };
}

export const config = parseEnv();
