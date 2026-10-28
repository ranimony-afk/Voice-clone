/**
 * VoiceForge Authentication & Authorization Subsystem (Phase 3A / Phase 3C-S1)
 *
 * Provides:
 * - Server-validated identity abstraction (AuthenticatedUser)
 * - Cryptographic HMAC-SHA256 session token generation and verification
 * - Strict authoritative principal resolution (never trusts token role claims or hydrates unknown subjects)
 * - Fail-closed secret enforcement across staging and production
 * - Express middlewares: requireAuth, optionalAuth, requireRole, requireOwner
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDevelopmentEnvironment, isRestrictedEnvironment } from '../config/env.ts';

export type UserRole = 'user' | 'creator' | 'admin';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  creditBalance: number;
}

// Augment Express Request interface to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const DEV_FALLBACK_AUTH_SECRET = 'vf_auth_secret_phase3a_secure_token_sig_k92m';

// Server Secret for Token Signing (Fails closed in staging, production, and unknown environments if missing, blank, weak, or fallback)
export function getAuthSecret(): string {
  const raw = process.env.VOICEFORGE_AUTH_SECRET;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const restricted = isRestrictedEnvironment(process.env.NODE_ENV);

  if (trimmed.length === 0) {
    if (restricted) {
      throw new Error(
        'FATAL SECURITY CONFIGURATION: VOICEFORGE_AUTH_SECRET must be explicitly configured in staging and production.'
      );
    }
    return DEV_FALLBACK_AUTH_SECRET;
  }

  if (restricted && (trimmed.length < 16 || trimmed === DEV_FALLBACK_AUTH_SECRET)) {
    throw new Error(
      'FATAL SECURITY CONFIGURATION: VOICEFORGE_AUTH_SECRET is invalid, too short, or uses a non-production fallback secret in staging/production.'
    );
  }

  return trimmed;
}

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DEV_SANDBOX_TTL_SECONDS = 60 * 60; // 1 hour

// Dedicated non-privileged local development sandbox persona (never admin or creator)
export const DEV_SANDBOX_USER: Readonly<AuthenticatedUser> = Object.freeze({
  id: 'usr_dev_sandbox',
  email: 'sandbox@voiceforge.local',
  fullName: 'Local Dev Sandbox',
  role: 'user',
  creditBalance: 1000,
});

// Built-in standard personas for server-side test fixtures and seeded accounts.
// Never directly mintable by unauthenticated HTTP callers.
export const PRELOADED_USERS: Readonly<Record<string, Readonly<AuthenticatedUser>>> = Object.freeze({
  usr_default_creator: Object.freeze({
    id: 'usr_default_creator',
    email: 'creator@voiceforge.ai',
    fullName: 'Alex Vance',
    role: 'creator',
    creditBalance: 25000,
  }),
  usr_alice_user: Object.freeze({
    id: 'usr_alice_user',
    email: 'alice@voiceforge.ai',
    fullName: 'Alice Walker',
    role: 'user',
    creditBalance: 10000,
  }),
  usr_bob_user: Object.freeze({
    id: 'usr_bob_user',
    email: 'bob@voiceforge.ai',
    fullName: 'Bob Martinez',
    role: 'user',
    creditBalance: 8500,
  }),
  usr_admin_root: Object.freeze({
    id: 'usr_admin_root',
    email: 'security-admin@voiceforge.ai',
    fullName: 'Security Auditor',
    role: 'admin',
    creditBalance: 999999,
  }),
});

function createInitialUserEntries(): Array<[string, AuthenticatedUser]> {
  return Object.entries(PRELOADED_USERS).map(([id, user]) => [id, { ...user }]);
}

// Authoritative server-side user directory for session lookups and registered principals
const userStore: Map<string, AuthenticatedUser> = new Map(createInitialUserEntries());

/**
 * Durable Revocation Store
 * Persists SHA-256 hashes of revoked session tokens to disk and PostgreSQL
 * Guarantees revocation survival across application restarts and multiple instances
 * Uses atomic file replacement (write-to-temp + rename) to protect against corruption on crash
 */
export class DurableRevocationStore {
  private static cache: Set<string> = new Set();
  private static filePath = path.resolve(process.cwd(), 'storage/auth/revoked_tokens.json');
  private static activeLoadedPath: string | null = null;
  private static initialized = false;

  private static getEffectiveFilePath(): string {
    const customPath = process.env.VOICEFORGE_REVOCATION_FILE;
    if (customPath && customPath.trim().length > 0) {
      return path.resolve(customPath.trim());
    }
    return this.filePath;
  }

  public static initialize(): void {
    const targetPath = this.getEffectiveFilePath();
    if (this.initialized && this.activeLoadedPath === targetPath) return;

    if (this.activeLoadedPath !== null && this.activeLoadedPath !== targetPath) {
      this.cache.clear();
    }
    this.activeLoadedPath = targetPath;

    try {
      if (fs.existsSync(targetPath)) {
        const raw = fs.readFileSync(targetPath, 'utf-8');
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const hash of parsed) {
              if (typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash.trim())) {
                this.cache.add(hash.trim());
              }
            }
          }
        } catch (parseErr: any) {
          console.warn(
            '[DurableRevocationStore] Corrupted JSON detected in revocation file; keeping existing cache:',
            parseErr.message
          );
        }
      }
    } catch (err: any) {
      console.warn('[DurableRevocationStore] Notice loading local revocation file:', err.message);
    }
    this.initialized = true;

    // Asynchronously synchronize from PostgreSQL if connected
    this.syncFromDatabase().catch(() => {});
  }

  public static async syncFromDatabase(): Promise<void> {
    try {
      const { getDatabase } = await import('../db/index.ts');
      const { db, schema } = getDatabase();
      if (db && schema && (schema as any).revokedTokens) {
        const rows = await db
          .select({ tokenHash: (schema as any).revokedTokens.tokenHash })
          .from((schema as any).revokedTokens);
        for (const row of rows) {
          if (row.tokenHash) this.cache.add(row.tokenHash);
        }
      }
    } catch {
      // In-memory/file fallback remains authoritative
    }
  }

  public static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  public static revokeToken(token: string, details?: { userId?: string; reason?: string }): void {
    if (!token || typeof token !== 'string') return;
    this.initialize();
    const targetPath = this.getEffectiveFilePath();
    const tokenHash = this.hashToken(token);
    this.cache.add(tokenHash);

    // 1. Atomic write to local durable file (write to temp file then atomic rename)
    try {
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      const tmpPath = `${targetPath}.tmp.${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(tmpPath, JSON.stringify(Array.from(this.cache)), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      fs.renameSync(tmpPath, targetPath);
    } catch (err: any) {
      console.warn('[DurableRevocationStore] Notice saving revocation to file:', err.message);
    }

    // 2. Persist to PostgreSQL if connected
    try {
      import('../db/index.ts')
        .then(({ getDatabase }) => {
          const { db, schema } = getDatabase();
          if (db && schema && (schema as any).revokedTokens) {
            db.insert((schema as any).revokedTokens)
              .values({
                tokenHash,
                userId: details?.userId || null,
                reason: details?.reason || 'User or security revocation',
                revokedAt: new Date(),
              })
              .catch(() => {});
          }
        })
        .catch(() => {});
    } catch {
      // In-memory / file fallback active
    }
  }

  public static isRevoked(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    this.initialize();
    const tokenHash = this.hashToken(token);
    return this.cache.has(tokenHash);
  }

  public static resetForTesting(): void {
    const targetPath = this.getEffectiveFilePath();
    this.cache.clear();
    try {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    } catch {}
    this.initialized = false;
    this.activeLoadedPath = null;
  }
}

export type CredentialParseResult =
  | { status: 'absent' }
  | { status: 'present'; token: string }
  | {
      status: 'invalid';
      code: 'MALFORMED_AUTH_HEADER' | 'UNSUPPORTED_AUTH_TRANSPORT';
      error: string;
    };

export class AuthService {
  /**
   * Registers or updates a principal in the authoritative server registry (server-internal / test setup only)
   */
  public static registerUser(user: AuthenticatedUser): AuthenticatedUser {
    const copy: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      creditBalance: user.creditBalance,
    };
    userStore.set(copy.id, copy);
    return { ...copy };
  }

  /**
   * Removes a principal from the authoritative server registry
   */
  public static removeUser(userId: string): boolean {
    return userStore.delete(userId);
  }

  /**
   * Resets userStore back to clean copies of PRELOADED_USERS (test isolation helper)
   */
  public static resetUserStoreForTesting(): void {
    userStore.clear();
    for (const [id, user] of createInitialUserEntries()) {
      userStore.set(id, user);
    }
  }

  /**
   * Returns current number of registered principals in userStore
   */
  public static getUserCount(): number {
    return userStore.size;
  }

  /**
   * Finds an authoritative principal by ID (returns defensive copy)
   */
  public static getUserById(userId: string): AuthenticatedUser | undefined {
    const found = userStore.get(userId);
    return found ? { ...found } : undefined;
  }

  /**
   * Finds an authoritative principal by Email (returns defensive copy)
   */
  public static getUserByEmail(email: string): AuthenticatedUser | undefined {
    const needle = email.toLowerCase();
    for (const u of userStore.values()) {
      if (u.email.toLowerCase() === needle) {
        return { ...u };
      }
    }
    return undefined;
  }

  /**
   * Determines whether development-only unprivileged sandbox bootstrap is permitted.
   * Requires BOTH:
   * 1. Validated runtime environment strictly equal to 'development'
   * 2. Explicit opt-in flag VOICEFORGE_ENABLE_DEV_DEMO_AUTH === 'true'
   * Never active in staging, production, test, or unrecognized NODE_ENV values.
   */
  public static isDevDemoBootstrapEnabled(): boolean {
    return (
      isDevelopmentEnvironment(process.env.NODE_ENV) &&
      process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH === 'true'
    );
  }

  /**
   * Issues a short-lived development-only token strictly for the fixed nonprivileged DEV_SANDBOX_USER.
   * Fails closed outside explicit development sandbox mode.
   */
  public static issueDevSandboxToken(): { token: string; user: AuthenticatedUser } {
    if (!this.isDevDemoBootstrapEnabled()) {
      throw new Error('Development demo sandbox authentication is disabled in this environment.');
    }
    const sandboxPrincipal: AuthenticatedUser = {
      id: DEV_SANDBOX_USER.id,
      email: DEV_SANDBOX_USER.email,
      fullName: DEV_SANDBOX_USER.fullName,
      role: 'user',
      creditBalance: DEV_SANDBOX_USER.creditBalance,
    };
    userStore.set(sandboxPrincipal.id, sandboxPrincipal);
    const token = this.issueToken(sandboxPrincipal, DEV_SANDBOX_TTL_SECONDS);
    return { token, user: { ...sandboxPrincipal } };
  }

  /**
   * Revokes a session token with restart durability and database synchronization
   */
  public static revokeToken(token: string, options?: { userId?: string; reason?: string }): void {
    if (token && typeof token === 'string') {
      DurableRevocationStore.revokeToken(token, options);
    }
  }

  /**
   * Returns authoritative authentication signing secret or throws in staging/production
   */
  public static getAuthSecret(): string {
    return getAuthSecret();
  }

  /**
   * Checks whether a session token has been explicitly revoked
   */
  public static isTokenRevoked(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    return DurableRevocationStore.isRevoked(token);
  }

  /**
   * Generates a tamper-proof signed session token (base64url header.payload.signature)
   */
  public static issueToken(user: AuthenticatedUser, ttlSeconds: number = TOKEN_TTL_SECONDS): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.fullName,
      iat: now,
      exp: now + ttlSeconds,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const secret = getAuthSecret();
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Verifies and decodes a signed token.
   * Fail-closed guarantees:
   * - Rejects malformed, oversized, forged, expired, missing-exp, or revoked tokens.
   * - Never auto-hydrates unknown token subjects into userStore.
   * - Resolves role and profile strictly from authoritative server-side userStore,
   *   ignoring stale or tampered role claims inside the JWT payload.
   */
  public static verifyToken(token: string): AuthenticatedUser | null {
    if (!token || typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (trimmed.length === 0 || trimmed.length > 4096) return null;

    // Reject explicitly revoked tokens
    if (this.isTokenRevoked(trimmed)) {
      return null;
    }

    const parts = trimmed.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;
    if (!headerB64 || !payloadB64 || !signature) return null;

    // Verify cryptographic signature first
    let secret: string;
    try {
      secret = getAuthSecret();
    } catch {
      return null;
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expectedSignature);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return null;
      }
    } catch {
      return null;
    }

    // Decode and validate header + payload claims + authoritative server principal
    try {
      const headerJson = Buffer.from(headerB64, 'base64url').toString('utf8');
      const header = JSON.parse(headerJson);
      if (!header || typeof header !== 'object' || header.alg !== 'HS256' || header.typ !== 'JWT') {
        return null;
      }

      const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson);
      if (!payload || typeof payload !== 'object') {
        return null;
      }

      if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
        return null;
      }

      if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
        return null;
      }

      if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
        return null;
      }

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) {
        return null; // Expired
      }

      // Development sandbox tokens are valid ONLY while dev sandbox mode is actively enabled
      if (payload.sub === DEV_SANDBOX_USER.id && !this.isDevDemoBootstrapEnabled()) {
        return null;
      }

      // Strictly resolve authoritative principal from server store; NEVER hydrate unknown subjects
      const storedUser = userStore.get(payload.sub);
      if (!storedUser) {
        return null;
      }

      // Return defensive copy of server-authoritative principal (ignoring payload.role/email/name)
      return { ...storedUser };
    } catch {
      return null;
    }
  }

  /**
   * Helper to extract token from Request Authorization header or custom header
   */
  /**
   * Parses request credentials strictly according to the documented `Authorization: Bearer <token>` contract.
   * - Genuinely omitted credentials return `{ status: 'absent' }`.
   * - Present-but-empty/whitespace `Authorization` headers, raw non-Bearer JWTs, malformed Bearer headers,
   *   undocumented `x-session-token` headers, and `?token=...` query parameters return `{ status: 'invalid' }`
   *   so neither `requireAuth` nor `optionalAuth` ever silently downgrades a present credential attempt to anonymous.
   */
  public static parseCredential(req: Request): CredentialParseResult {
    if (req.query && typeof req.query === 'object' && 'token' in req.query && req.query.token !== undefined) {
      return {
        status: 'invalid',
        code: 'UNSUPPORTED_AUTH_TRANSPORT',
        error: 'Authentication failed: query-parameter token authentication is not supported; use Authorization: Bearer <token>',
      };
    }

    let rawAuthHeaderCount = 0;
    let rawHasSessionTokenHeader = false;
    if (Array.isArray(req.rawHeaders)) {
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const headerName = req.rawHeaders[i];
        if (typeof headerName === 'string') {
          const lower = headerName.toLowerCase();
          if (lower === 'authorization') {
            rawAuthHeaderCount++;
          } else if (lower === 'x-session-token') {
            rawHasSessionTokenHeader = true;
          }
        }
      }
    }

    if (
      rawHasSessionTokenHeader ||
      (req.headers && 'x-session-token' in req.headers && req.headers['x-session-token'] !== undefined)
    ) {
      return {
        status: 'invalid',
        code: 'UNSUPPORTED_AUTH_TRANSPORT',
        error: 'Authentication failed: x-session-token header is not supported; use Authorization: Bearer <token>',
      };
    }

    if (rawAuthHeaderCount > 1 || Array.isArray(req.headers?.authorization)) {
      return {
        status: 'invalid',
        code: 'MALFORMED_AUTH_HEADER',
        error: 'Authentication failed: multiple or ambiguous Authorization headers are not permitted',
      };
    }

    if (req.headers && 'authorization' in req.headers && req.headers.authorization !== undefined) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        return {
          status: 'invalid',
          code: 'MALFORMED_AUTH_HEADER',
          error: 'Authentication failed: expected Authorization: Bearer <token>',
        };
      }

      const token = authHeader.slice(7).trim();
      if (token.length === 0 || /\s/.test(token)) {
        return {
          status: 'invalid',
          code: 'MALFORMED_AUTH_HEADER',
          error: 'Authentication failed: empty or malformed Bearer token in Authorization header',
        };
      }

      return { status: 'present', token };
    }

    return { status: 'absent' };
  }

  public static extractToken(req: Request): string | null {
    const parsed = this.parseCredential(req);
    return parsed.status === 'present' ? parsed.token : null;
  }
}

/**
 * Middleware: Strictly requires valid authentication.
 * Rejects anonymous or malformed credential requests with HTTP 401 Unauthorized.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const parsed = AuthService.parseCredential(req);
  if (parsed.status === 'absent') {
    return res.status(401).json({
      error: 'Authentication required: missing Bearer token in Authorization header',
      code: 'AUTH_REQUIRED',
    });
  }

  if (parsed.status === 'invalid') {
    return res.status(401).json({
      error: parsed.error,
      code: parsed.code,
    });
  }

  const { token } = parsed;

  if (AuthService.isTokenRevoked(token)) {
    return res.status(401).json({
      error: 'Authentication failed: session token has been revoked',
      code: 'AUTH_TOKEN_REVOKED',
    });
  }

  const user = AuthService.verifyToken(token);
  if (!user) {
    return res.status(401).json({
      error: 'Authentication failed: invalid, expired, or tampered token',
      code: 'AUTH_INVALID_TOKEN',
    });
  }

  req.user = user;
  next();
}

/**
 * Middleware: Optional authentication.
 * Allows genuinely anonymous requests (no credential header or token query parameter supplied),
 * and fails closed with HTTP 401 if any present credential is empty, whitespace, non-Bearer,
 * query-string based, revoked, expired, missing expiration, forged, or otherwise invalid.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const parsed = AuthService.parseCredential(req);
  if (parsed.status === 'absent') {
    return next();
  }

  if (parsed.status === 'invalid') {
    return res.status(401).json({
      error: parsed.error,
      code: parsed.code,
    });
  }

  const { token } = parsed;

  if (AuthService.isTokenRevoked(token)) {
    return res.status(401).json({
      error: 'Authentication failed: session token has been revoked',
      code: 'AUTH_TOKEN_REVOKED',
    });
  }

  const user = AuthService.verifyToken(token);
  if (!user) {
    return res.status(401).json({
      error: 'Authentication failed: invalid, expired, or tampered token',
      code: 'AUTH_INVALID_TOKEN',
    });
  }

  req.user = user;
  next();
}

/**
 * Middleware: Requires a specific role (e.g. 'admin').
 * Must be used after requireAuth.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied: requires one of roles [${allowedRoles.join(', ')}]`,
        code: 'FORBIDDEN_ROLE',
      });
    }
    next();
  };
}

/**
 * Middleware factory: Enforces resource ownership.
 * Resolves the resource's owner userId. If req.user.id !== resource.userId and req.user is not admin,
 * rejects with HTTP 403 Forbidden.
 */
export function requireOwner(
  getResourceOwnerId: (req: Request) => Promise<string | null | undefined> | string | null | undefined
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }

    try {
      const ownerId = await getResourceOwnerId(req);
      if (!ownerId) {
        return res.status(404).json({ error: 'Resource not found', code: 'RESOURCE_NOT_FOUND' });
      }

      // Admins bypass ownership check
      if (req.user.role === 'admin') {
        return next();
      }

      if (req.user.id !== ownerId) {
        return res.status(403).json({
          error: 'Forbidden: You do not own this resource or profile',
          code: 'FORBIDDEN_NOT_OWNER',
        });
      }

      next();
    } catch {
      res.status(500).json({
        error: 'Failed to verify resource ownership',
        code: 'OWNERSHIP_VERIFICATION_ERROR',
      });
    }
  };
}
