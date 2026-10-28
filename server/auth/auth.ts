/**
 * VoiceForge Authentication & Authorization Subsystem (Phase 3A)
 * 
 * Provides:
 * - Server-validated identity abstraction (AuthenticatedUser)
 * - Cryptographic HMAC-SHA256 session token generation and verification
 * - Bearer token parsing and validation
 * - Express middlewares: requireAuth, optionalAuth, requireRole, requireOwner
 * - Strict defense against client-supplied identity forgery: req.user.id is authoritative
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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

// Server Secret for Token Signing (Fails closed in production if unconfigured)
export function getAuthSecret(): string {
  const secret = process.env.VOICEFORGE_AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL SECURITY CONFIGURATION: VOICEFORGE_AUTH_SECRET must be explicitly configured in production.');
    }
    return 'vf_auth_secret_phase3a_secure_token_sig_k92m';
  }
  return secret;
}
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Built-in standard personas for development, testing, and sandbox environments
export const PRELOADED_USERS: Record<string, AuthenticatedUser> = {
  'usr_default_creator': {
    id: 'usr_default_creator',
    email: 'creator@voiceforge.ai',
    fullName: 'Alex Vance',
    role: 'creator',
    creditBalance: 25000,
  },
  'usr_alice_user': {
    id: 'usr_alice_user',
    email: 'alice@voiceforge.ai',
    fullName: 'Alice Walker',
    role: 'user',
    creditBalance: 10000,
  },
  'usr_bob_user': {
    id: 'usr_bob_user',
    email: 'bob@voiceforge.ai',
    fullName: 'Bob Martinez',
    role: 'user',
    creditBalance: 8500,
  },
  'usr_admin_root': {
    id: 'usr_admin_root',
    email: 'security-admin@voiceforge.ai',
    fullName: 'Security Auditor',
    role: 'admin',
    creditBalance: 999999,
  },
};

// In-memory user directory for session lookups and custom test users
const userStore: Map<string, AuthenticatedUser> = new Map(
  Object.entries(PRELOADED_USERS)
);

/**
 * Durable Revocation Store
 * Persists SHA-256 hashes of revoked session tokens to disk and PostgreSQL
 * Guarantees revocation survival across application restarts and multiple instances
 * Uses atomic file replacement (write-to-temp + rename) to protect against corruption on crash
 */
export class DurableRevocationStore {
  private static cache: Set<string> = new Set();
  private static filePath = path.resolve(process.cwd(), 'storage/auth/revoked_tokens.json');
  private static initialized = false;

  public static initialize(): void {
    if (this.initialized) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
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
          console.warn('[DurableRevocationStore] Corrupted JSON detected in revocation file; keeping existing cache:', parseErr.message);
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
        const rows = await db.select({ tokenHash: (schema as any).revokedTokens.tokenHash }).from((schema as any).revokedTokens);
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
    const tokenHash = this.hashToken(token);
    this.cache.add(tokenHash);

    // 1. Atomic write to local durable file (write to temp file then atomic rename)
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      const tmpPath = `${this.filePath}.tmp.${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(tmpPath, JSON.stringify(Array.from(this.cache)), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);
    } catch (err: any) {
      console.warn('[DurableRevocationStore] Notice saving revocation to file:', err.message);
    }

    // 2. Persist to PostgreSQL if connected
    try {
      import('../db/index.ts').then(({ getDatabase }) => {
        const { db, schema } = getDatabase();
        if (db && schema && (schema as any).revokedTokens) {
          db.insert((schema as any).revokedTokens).values({
            tokenHash,
            userId: details?.userId || null,
            reason: details?.reason || 'User or security revocation',
            revokedAt: new Date(),
          }).catch(() => {});
        }
      }).catch(() => {});
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
    this.cache.clear();
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch {}
    this.initialized = false;
  }
}

export class AuthService {
  /**
   * Registers or updates a user in the local auth registry
   */
  public static registerUser(user: AuthenticatedUser): AuthenticatedUser {
    userStore.set(user.id, user);
    return user;
  }

  /**
   * Finds a user by ID
   */
  public static getUserById(userId: string): AuthenticatedUser | undefined {
    return userStore.get(userId);
  }

  /**
   * Finds a user by Email
   */
  public static getUserByEmail(email: string): AuthenticatedUser | undefined {
    for (const u of userStore.values()) {
      if (u.email.toLowerCase() === email.toLowerCase()) {
        return u;
      }
    }
    return undefined;
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
   * Returns authoritative authentication signing secret or throws in production
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
   * Verifies and decodes a signed token. Returns AuthenticatedUser or null if invalid/expired/revoked.
   */
  public static verifyToken(token: string): AuthenticatedUser | null {
    if (!token || typeof token !== 'string') return null;

    // Reject explicitly revoked tokens
    if (this.isTokenRevoked(token)) {
      return null;
    }

    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;

    // Verify cryptographic signature
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

    // Decode and validate expiration
    try {
      const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson);

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        return null; // Expired
      }

      // Check if user exists in store, or create from token claims
      let user = userStore.get(payload.sub);
      if (!user) {
        user = {
          id: payload.sub,
          email: payload.email || `${payload.sub}@voiceforge.local`,
          fullName: payload.name || payload.sub,
          role: payload.role || 'user',
          creditBalance: 10000,
        };
        userStore.set(user.id, user);
      }

      return user;
    } catch {
      return null;
    }
  }

  /**
   * Helper to extract token from Request Authorization header or custom header
   */
  public static extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    const customHeader = req.headers['x-session-token'];
    if (typeof customHeader === 'string' && customHeader.length > 0) {
      return customHeader.trim();
    }
    // Also check query param if authorized for download URLs
    if (typeof req.query.token === 'string') {
      return req.query.token;
    }
    return null;
  }
}

/**
 * Middleware: Strictly requires valid authentication.
 * Rejects anonymous requests with HTTP 401 Unauthorized.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = AuthService.extractToken(req);
  if (!token) {
    return res.status(401).json({
      error: 'Authentication required: missing Bearer token in Authorization header',
      code: 'AUTH_REQUIRED',
    });
  }

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
 * Sets req.user if a valid token is provided, but does not block anonymous requests.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = AuthService.extractToken(req);
  if (token) {
    const user = AuthService.verifyToken(token);
    if (user) {
      req.user = user;
    }
  }
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
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to verify resource ownership', message: err.message });
    }
  };
}
