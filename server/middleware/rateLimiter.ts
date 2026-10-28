/**
 * VoiceForge Rate Limiting Subsystem (Phase 3C-R Remediation)
 * 
 * Provides:
 * - High-precision sliding-window rate limiting without external dependencies
 * - Route-specific tiered enforcement (Auth, Media Upload, Synthesis, General API)
 * - Safe client IP extraction preventing unverified proxy spoofing
 * - IETF-standard RateLimit headers and consistent HTTP 429 responses
 * - Zero exposure of credentials, tokens, or private data in keys or logs
 * 
 * Architectural Limitation Note:
 * This implementation is process-local. For multi-replica clustered deployments,
 * a distributed state store (e.g. Redis with sliding log) should back this interface.
 */

import { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  policyName: string;
  skip?: (req: Request) => boolean;
  keyGenerator?: (req: Request) => string;
}

export class SlidingWindowStore {
  private hits: Map<string, number[]> = new Map();
  private gcInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Background garbage collection to prune stale keys every 60 seconds
    this.gcInterval = setInterval(() => this.cleanup(), 60000);
    if (this.gcInterval.unref) {
      this.gcInterval.unref();
    }
  }

  public check(
    key: string,
    limit: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; resetSeconds: number; retryAfterSeconds: number } {
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = this.hits.get(key) || [];
    // Filter timestamps within current sliding window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] || now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      this.hits.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        resetSeconds: retryAfterSeconds,
        retryAfterSeconds,
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    const remaining = Math.max(0, limit - timestamps.length);
    const resetSeconds = Math.max(1, Math.ceil(windowMs / 1000));

    return {
      allowed: true,
      remaining,
      resetSeconds,
      retryAfterSeconds: 0,
    };
  }

  public cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      // 1 hour maximum retention for any window
      const valid = timestamps.filter((t) => t > now - 3600000);
      if (valid.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, valid);
      }
    }
  }

  public resetForTesting(): void {
    this.hits.clear();
  }

  public destroy(): void {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
    this.hits.clear();
  }
}

export const globalStore = new SlidingWindowStore();

/**
 * Safely extracts client IP address.
 * Never trusts arbitrary X-Forwarded-For headers unless proxy trust is explicitly configured.
 */
export function getSafeClientIp(req: Request): string {
  const isTrustedProxy = Boolean(
    req.app?.get('trust proxy') ||
    process.env.VOICEFORGE_TRUST_PROXY === 'true' ||
    process.env.TRUST_PROXY === 'true'
  );

  if (isTrustedProxy) {
    if (req.ip) return req.ip;
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string') {
      const parts = fwd.split(',').map((p) => p.trim());
      if (parts.length > 0 && parts[0]) {
        return parts[0];
      }
    }
  }

  // Safe fallback: socket remote address (cannot be spoofed by client headers)
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Creates an Express rate-limiting middleware
 */
export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, maxRequests, policyName, skip, keyGenerator } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (skip && skip(req)) {
      return next();
    }

    const clientIp = keyGenerator ? keyGenerator(req) : getSafeClientIp(req);
    // Prefix key with policy name to isolate tier quotas
    const rateLimitKey = `${policyName}:${clientIp}`;

    const result = globalStore.check(rateLimitKey, maxRequests, windowMs);

    // Standard IETF RateLimit Headers
    res.setHeader('RateLimit-Limit', maxRequests.toString());
    res.setHeader('RateLimit-Remaining', result.remaining.toString());
    res.setHeader('RateLimit-Reset', result.resetSeconds.toString());

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfterSeconds.toString());
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded for ${policyName}. Please retry in ${result.retryAfterSeconds} seconds.`,
        retryAfter: result.retryAfterSeconds,
        policy: policyName,
      });
      return;
    }

    next();
  };
}

// 1. Auth Rate Limiter (Protects login, token issuance/revocation, biometric verification)
// 10 requests per 15 minutes per IP
export const authRateLimiter = createRateLimiter({
  policyName: 'auth_protection',
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
});

// 2. Media Upload Rate Limiter (Protects heavy binary ingest from bandwidth exhaustion)
// 30 requests per minute per IP
export const mediaUploadRateLimiter = createRateLimiter({
  policyName: 'media_upload',
  windowMs: 60 * 1000,
  maxRequests: 30,
});

// 3. Synthesis Job Rate Limiter (Protects CPU/GPU inference queue from flooding)
// 20 requests per minute per IP
export const synthesisJobRateLimiter = createRateLimiter({
  policyName: 'synthesis_jobs',
  windowMs: 60 * 1000,
  maxRequests: 20,
});

// 4. General API Rate Limiter (Baseline DoS protection for all /api routes)
// 120 requests per minute per IP
export const generalApiRateLimiter = createRateLimiter({
  policyName: 'general_api',
  windowMs: 60 * 1000,
  maxRequests: 120,
  skip: (req) => {
    // Health and readiness endpoints must never be throttled by the API limiter
    return req.path === '/healthz' || req.path === '/readyz';
  },
});
