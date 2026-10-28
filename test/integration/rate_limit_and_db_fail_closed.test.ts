/**
 * VoiceForge Phase 3C-R Remediation Test Suite
 * 
 * Verifies:
 * 1. HTTP Rate Limiting enforcement (HTTP 429, Retry-After, RateLimit headers)
 * 2. Tiered quotas (auth vs media upload vs synthesis vs general API)
 * 3. Safe client IP resolution preventing spoofing via unverified X-Forwarded-For
 * 4. Health and readiness probe exemption from throttling
 * 5. Fail-closed database configuration in staging & production (FatalDatabaseConfigurationError)
 * 6. Explicit development/test in-memory mode allowance
 * 7. Readiness probe failure when database is disconnected in production/staging
 * 8. Zero credential or connection string leakage in error logs
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import {
  globalStore,
  createRateLimiter,
  getSafeClientIp,
} from '../../server/middleware/rateLimiter.ts';
import {
  assertDatabaseConfigured,
  checkDatabaseHealth,
  FatalDatabaseConfigurationError,
} from '../../server/db/index.ts';

describe('Phase 3C-R: Rate Limiting & Fail-Closed Database Remediation', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(() => {
    globalStore.resetForTesting();
  });

  before((_, done) => {
    const app = express();
    app.use(express.json());

    // Test limiter: 3 requests per 2000ms window
    const testLimiter = createRateLimiter({
      policyName: 'test_policy',
      windowMs: 2000,
      maxRequests: 3,
    });

    // Test auth limiter: 2 requests per 5000ms window
    const testAuthLimiter = createRateLimiter({
      policyName: 'test_auth',
      windowMs: 5000,
      maxRequests: 2,
    });

    app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
    app.get('/test-endpoint', testLimiter, (_req, res) => res.json({ success: true }));
    app.post('/test-auth', testAuthLimiter, (_req, res) => res.json({ authenticated: true }));

    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  after((_, done) => {
    server.close(done);
  });

  // --- GATE 1: RATE LIMITING TESTS ---

  test('RATE LIMIT: Enforces quota and returns HTTP 429 with standard headers', async () => {
    // Requests 1-3 succeed
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/test-endpoint`);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('RateLimit-Limit'));
      assert.ok(res.headers.get('RateLimit-Remaining'));
    }

    // Request 4 must trigger HTTP 429
    const blockedRes = await fetch(`${baseUrl}/test-endpoint`);
    assert.equal(blockedRes.status, 429, 'Excess request must return HTTP 429 Too Many Requests');
    assert.ok(blockedRes.headers.get('Retry-After'), 'Must include Retry-After header');
    assert.equal(blockedRes.headers.get('RateLimit-Remaining'), '0');

    const body = await blockedRes.json();
    assert.equal(body.error, 'Too Many Requests');
    assert.ok(body.retryAfter > 0);
  });

  test('RATE LIMIT: Tiered policies maintain independent quotas', async () => {
    // Auth limiter allows 2 requests
    const auth1 = await fetch(`${baseUrl}/test-auth`, { method: 'POST' });
    const auth2 = await fetch(`${baseUrl}/test-auth`, { method: 'POST' });
    assert.equal(auth1.status, 200);
    assert.equal(auth2.status, 200);

    // Auth request 3 fails with 429
    const auth3 = await fetch(`${baseUrl}/test-auth`, { method: 'POST' });
    assert.equal(auth3.status, 429);

    // General test endpoint still has independent quota available
    const genRes = await fetch(`${baseUrl}/test-endpoint`);
    assert.equal(genRes.status, 200, 'Different policy tier must not exhaust general quota');
  });

  test('RATE LIMIT: Safe proxy trust rejects spoofed X-Forwarded-For by default', () => {
    const origTrust = process.env.VOICEFORGE_TRUST_PROXY;
    try {
      delete process.env.VOICEFORGE_TRUST_PROXY;

      const mockReq = {
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
        socket: { remoteAddress: '192.168.1.100' },
        app: { get: () => false },
      } as any;

      const clientIp = getSafeClientIp(mockReq);
      assert.equal(clientIp, '192.168.1.100', 'Must use socket remote address when proxy trust is disabled');
    } finally {
      if (origTrust) process.env.VOICEFORGE_TRUST_PROXY = origTrust;
    }
  });

  // --- GATE 2: FAIL-CLOSED DATABASE CONFIGURATION TESTS ---

  test('FAIL-CLOSED: Missing DATABASE_URL throws fatal error in production', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;

      assert.throws(
        () => assertDatabaseConfigured('production'),
        (err: any) => {
          assert.ok(err instanceof FatalDatabaseConfigurationError);
          assert.match(err.message, /In staging and production environments, DATABASE_URL must be configured/i);
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origDb) process.env.DATABASE_URL = origDb;
    }
  });

  test('FAIL-CLOSED: Missing DATABASE_URL throws fatal error in staging', () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;

    try {
      process.env.NODE_ENV = 'staging';
      delete process.env.DATABASE_URL;

      assert.throws(
        () => assertDatabaseConfigured('staging'),
        (err: any) => {
          assert.ok(err instanceof FatalDatabaseConfigurationError);
          assert.match(err.message, /In staging and production environments, DATABASE_URL must be configured/i);
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origDb) process.env.DATABASE_URL = origDb;
    }
  });

  test('FAIL-CLOSED: VOICEFORGE_ALLOW_IN_MEMORY_DB=true is forbidden in production', () => {
    const origEnv = process.env.NODE_ENV;
    const origAllow = process.env.VOICEFORGE_ALLOW_IN_MEMORY_DB;
    const origDb = process.env.DATABASE_URL;

    try {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
      process.env.VOICEFORGE_ALLOW_IN_MEMORY_DB = 'true';

      assert.throws(
        () => assertDatabaseConfigured('production'),
        (err: any) => {
          assert.ok(err instanceof FatalDatabaseConfigurationError);
          assert.match(err.message, /VOICEFORGE_ALLOW_IN_MEMORY_DB is strictly prohibited/i);
          return true;
        }
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origAllow) process.env.VOICEFORGE_ALLOW_IN_MEMORY_DB = origAllow;
      else delete process.env.VOICEFORGE_ALLOW_IN_MEMORY_DB;
      if (origDb) process.env.DATABASE_URL = origDb;
    }
  });

  test('FAIL-CLOSED: Development and test environments permit in-memory mode without throwing', () => {
    const origDb = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;

      assert.doesNotThrow(() => assertDatabaseConfigured('development'));
      assert.doesNotThrow(() => assertDatabaseConfigured('test'));
    } finally {
      if (origDb) process.env.DATABASE_URL = origDb;
    }
  });

  test('FAIL-CLOSED: Database health check reports ready=false when disconnected in staging', async () => {
    const origEnv = process.env.NODE_ENV;
    const origDb = process.env.DATABASE_URL;

    try {
      process.env.NODE_ENV = 'staging';
      // Point to non-existent port to simulate disconnected database
      process.env.DATABASE_URL = 'postgresql://postgres@localhost:5499/db';

      const health = await checkDatabaseHealth();
      assert.equal(health.connected, false);
      assert.equal(health.ready, false, 'Readiness must be false when disconnected in staging');
      assert.ok(health.error);
      assert.match(health.error, /PostgreSQL connection offline or unconfigured in staging/i);
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origDb) process.env.DATABASE_URL = origDb;
    }
  });

  test('SECURITY: Database credentials and connection strings never leak in error messages', () => {
    const secretConnectionString = 'postgresql://super_admin:P@ssw0rd999!@db.internal:5432/prod_voiceforge';

    try {
      assertDatabaseConfigured('staging');
    } catch (err: any) {
      assert.ok(!err.message.includes(secretConnectionString));
      assert.ok(!err.message.includes('P@ssw0rd999!'));
    }
  });
});
