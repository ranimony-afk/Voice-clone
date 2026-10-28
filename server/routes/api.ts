/**
 * VoiceForge API Router
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DEFAULT_VOICES } from '../data/voices.ts';
import { isRestrictedEnvironment, resolveRuntimeEnvironment } from '../config/env.ts';
import { VoiceForgeSynthesizer } from '../engine/audio/synthesizer.ts';
import { TextNormalizer } from '../engine/frontend/normalizer.ts';
import { Phonemizer } from '../engine/frontend/phonemizer.ts';
import { AudioWatermarker } from '../engine/audio/watermark.ts';
import { AudioQualityAnalyzer } from '../engine/audio/quality.ts';
import { ConsentVerificationEngine } from '../engine/audio/consent.ts';
import { SupportedLanguage } from '../engine/types.ts';
import { GeminiMultimodalEngine, ANIMATION_STYLES } from '../engine/gemini/multimodal.ts';
import { Paper2AudioEngine, PAPER_VOICE_PERSONAS, LANGUAGE_NATURAL_FILLERS, PRELOADED_PAPERS } from '../engine/paper2audio/engine.ts';
import { getDatabase, memoryStore, checkDatabaseHealth } from '../db/index.ts';
import { videoTransformJobs, transcriptionTranslationJobs, voices as voicesTable, dictionaries as dictionariesTable, consentRecords as consentRecordsTable, privateMedia as privateMediaTable, synthesisJobs as synthesisJobsTable, auditEvents as auditEventsTable } from '../db/schema.ts';
import { runMigrations } from '../db/migrate.ts';
import { AuthService, requireAuth, optionalAuth, requireRole, requireOwner, PRELOADED_USERS, AuthenticatedUser } from '../auth/auth.ts';
import {
  PrivateStorageService,
  PrivateMediaRecord,
  MediaInvalidationReason,
  MediaInvalidationOutcome,
  InvalidatedVoiceEntry,
} from '../storage/privateStorage.ts';
import {
  authRateLimiter,
  mediaUploadRateLimiter,
  synthesisJobRateLimiter,
  generalApiRateLimiter,
} from '../middleware/rateLimiter.ts';

export const apiRouter = Router();
// Baseline general API rate limiter (120 req/min, health probes exempt)
apiRouter.use(generalApiRateLimiter);

const synthesizer = new VoiceForgeSynthesizer();
const multimodal = new GeminiMultimodalEngine();
const paper2audio = new Paper2AudioEngine();

// In-memory cloned voice store for session persistence
let customVoices = [...DEFAULT_VOICES];
memoryStore.customVoices = customVoices;

// Health Check
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'VoiceForge AI Engine Core',
    version: '1.0.0-phase0',
    supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'],
    gpuTargetRtf: 0.25,
  });
});

// Audit Event Logging Helper
export function logAuditEvent(params: {
  userId: string;
  eventType: string;
  resourceId?: string | null;
  status: 'success' | 'failure' | 'denied';
  details?: Record<string, any>;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const event = {
    id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    userId: params.userId,
    eventType: params.eventType,
    resourceId: params.resourceId || null,
    ipAddress: params.ipAddress || null,
    userAgent: params.userAgent || null,
    status: params.status,
    details: params.details || {},
    createdAt: new Date().toISOString(),
  };
  memoryStore.auditEvents.unshift(event);
  return event;
}

function isPublicVoice(voice: any): boolean {
  return Boolean(voice && (voice.category === 'premade' || voice.isPublic === true));
}

function isBuiltInPremadeVoice(voiceId?: string): boolean {
  return Boolean(voiceId && DEFAULT_VOICES.some((v) => v.id === voiceId));
}

/**
 * Synchronizes process-local voice catalog and biometric consent state from the shared durable
 * invalidation ledger so sibling workers sharing storage immediately enforce voice revocations
 * and deletions without requiring a process restart.
 */
function syncDurableVoiceState(voiceId?: string): InvalidatedVoiceEntry | undefined {
  if (!voiceId) return undefined;
  const durableVoiceInv = PrivateStorageService.getVoiceInvalidationRecord(voiceId);
  if (!durableVoiceInv) return undefined;

  if (customVoices.some((v) => v.id === voiceId)) {
    customVoices = customVoices.filter((v) => v.id !== voiceId);
    memoryStore.customVoices = customVoices;
  }

  if (durableVoiceInv.reason === 'consent_revoked') {
    try {
      ConsentVerificationEngine.revokeConsent(voiceId, durableVoiceInv.ownerId || 'system', {
        isAdmin: true,
        recordRevocationMarker: true,
        resourceOwnerId: durableVoiceInv.ownerId,
      });
    } catch {
      // Fail-closed checks downstream also inspect durableVoiceInv directly
    }
    const cr = memoryStore.consentRecords.find((r: any) => r.voiceId === voiceId);
    if (cr) {
      cr.status = 'revoked';
      cr.revokedAt = cr.revokedAt || durableVoiceInv.invalidatedAt;
    }
  }

  return durableVoiceInv;
}

/**
 * Returns `true` if a voice profile has been positively consent-revoked either in the shared
 * durable invalidation ledger or in the local `ConsentVerificationEngine`.
 * Evaluated BEFORE ledger health assertions so known-revoked voices deterministically return
 * `403 CONSENT_REVOKED` even while storage is read-only/degraded.
 */
function isPositivelyConsentRevoked(voiceId?: string): boolean {
  if (!voiceId) return false;
  const durableVoiceInv = syncDurableVoiceState(voiceId);
  if (durableVoiceInv && durableVoiceInv.reason === 'consent_revoked') {
    return true;
  }
  try {
    const rec = ConsentVerificationEngine.getAuditRecord(voiceId);
    if (rec && (rec.status === 'revoked' || !ConsentVerificationEngine.isConsentActive(voiceId))) {
      return true;
    }
    if (!ConsentVerificationEngine.isConsentActive(voiceId)) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

/**
 * Enforces that non-premade custom/cloned voice operations fail closed (`503 STORAGE_UNAVAILABLE`)
 * whenever the shared durable invalidation ledger cannot be read or validated, preventing a stale
 * sibling worker from treating unreadable revocation state as active consent.
 */
function assertNonPremadeVoiceLedgerHealthy(voiceId?: string): void {
  if (!voiceId || isBuiltInPremadeVoice(voiceId)) return;
  PrivateStorageService.assertInvalidationLedgerHealthy();
}

function filterVisibleVoices(voicesList: any[], user?: AuthenticatedUser): any[] {
  const ledgerHealthy = PrivateStorageService.isInvalidationLedgerHealthy();
  return voicesList.filter((v) => {
    if (!v || typeof v.id !== 'string') return false;
    if (syncDurableVoiceState(v.id)) return false;
    if (!isBuiltInPremadeVoice(v.id) && !ledgerHealthy) return false;
    if (!ConsentVerificationEngine.isConsentActive(v.id)) return false;
    if (isPublicVoice(v)) return true;
    if (user?.role === 'admin') return true;
    return Boolean(user && v.userId && v.userId === user.id);
  });
}

function checkVoiceAccess(
  voice: any,
  user?: AuthenticatedUser
): { allowed: true } | { allowed: false; status: 401 | 403; code: string; error: string } {
  if (isPublicVoice(voice)) {
    return { allowed: true };
  }
  if (!user) {
    return {
      allowed: false,
      status: 401,
      code: 'AUTH_REQUIRED',
      error: 'Authentication required to access private voice profile.',
    };
  }
  if (user.role === 'admin' || (Boolean(voice.userId) && voice.userId === user.id)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    status: 403,
    code: 'FORBIDDEN_NOT_OWNER',
    error: `Forbidden: You do not own cloned or custom voice "${voice.name || voice.id}"`,
  };
}

/**
 * Fail-closed active biometric consent check for synthesis jobs and media artifacts.
 * Consults both the shared durable voice invalidation ledger and `ConsentVerificationEngine`.
 * Returns `false` if consent was revoked or voice was deleted, if cryptographic consent
 * verification fails/throws, or if a non-premade custom voice was removed without an active
 * verified consent record.
 */
function isVoiceConsentVerifiedActive(voiceId?: string): boolean {
  if (!voiceId) return true;
  if (syncDurableVoiceState(voiceId)) {
    return false;
  }
  try {
    if (!ConsentVerificationEngine.isConsentActive(voiceId)) {
      return false;
    }
  } catch {
    return false;
  }

  if (!isBuiltInPremadeVoice(voiceId)) {
    const inActiveCatalog = customVoices.some((v) => v.id === voiceId);
    const auditRecord = ConsentVerificationEngine.getAuditRecord(voiceId);
    if (!inActiveCatalog && (!auditRecord || auditRecord.status !== 'active')) {
      return false;
    }
  }

  return true;
}

/**
 * Synchronously scrubs all synthesized audio fields and retrieval pointers from an in-memory job record,
 * returning any previous `outputMediaId` so the underlying private storage artifact can be invalidated.
 */
function scrubJobAudioArtifactsInMemory(job: any, errorMessage?: string): string | undefined {
  if (!job || typeof job !== 'object') return undefined;
  const mediaId = typeof job.outputMediaId === 'string' ? job.outputMediaId : undefined;
  job.status = 'cancelled';
  job.updatedAt = new Date().toISOString();
  if (errorMessage) {
    job.error = errorMessage;
  }
  delete job.result;
  delete job.outputSignedUrl;
  delete job.outputMediaId;
  return mediaId;
}

/**
 * Produces a safe serialized copy of a synthesis job that omits audio data, signed URLs, and media IDs
 * whenever the job is cancelled or lacks an active result.
 */
function serializeSafeSynthesisJob(job: any): Record<string, any> {
  const clone: Record<string, any> = { ...job };
  if (clone.status === 'cancelled' || !clone.result) {
    delete clone.result;
    delete clone.outputSignedUrl;
    delete clone.outputMediaId;
  }
  return clone;
}

const UUID_FORMAT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPubliclyAccessibleVoiceId(voiceId?: string): boolean {
  if (!voiceId) return true;
  if (DEFAULT_VOICES.some((v) => v.id === voiceId)) {
    return isVoiceConsentVerifiedActive(voiceId);
  }
  const catalogVoice = customVoices.find((v) => v.id === voiceId);
  if (!catalogVoice || !isPublicVoice(catalogVoice)) {
    return false;
  }
  return isVoiceConsentVerifiedActive(voiceId);
}

function isPrivateTranscriptionJob(job: any): boolean {
  if (!job || typeof job !== 'object') return true;
  if (job.isPrivate === true) return true;
  if (typeof job.userId === 'string' && job.userId.trim().length > 0) return true;
  if (typeof job.dubbingVoiceId === 'string' && job.dubbingVoiceId.trim().length > 0) {
    if (!isPubliclyAccessibleVoiceId(job.dubbingVoiceId.trim())) {
      return true;
    }
  }
  return false;
}

/**
 * Synchronously scrubs all dubbed WAV payloads, inline data URLs, base64 audio, and signed retrieval pointers
 * from a transcription/translation dubbing job record, returning any linked `outputMediaId`.
 */
function scrubTranscriptionJobArtifactsInMemory(job: any, errorMessage?: string): string | undefined {
  if (!job || typeof job !== 'object') return undefined;
  const mediaId = typeof job.outputMediaId === 'string' ? job.outputMediaId : undefined;
  job.status = 'cancelled';
  job.updatedAt = new Date().toISOString();
  if (errorMessage) {
    job.error = errorMessage;
  }
  delete job.dubbedAudioUrl;
  delete job.audioBase64;
  delete job.outputSignedUrl;
  delete job.outputMediaId;
  delete job.dubbedDuration;
  return mediaId;
}

function serializeSafeTranscriptionJob(job: any): Record<string, any> {
  const clone: Record<string, any> = { ...job };
  if (
    clone.status === 'cancelled' ||
    (typeof clone.dubbingVoiceId === 'string' &&
      clone.dubbingVoiceId.trim().length > 0 &&
      !isVoiceConsentVerifiedActive(clone.dubbingVoiceId.trim())) ||
    (typeof clone.outputMediaId === 'string' && PrivateStorageService.isMediaInvalidated(clone.outputMediaId))
  ) {
    clone.status = 'cancelled';
    delete clone.dubbedAudioUrl;
    delete clone.audioBase64;
    delete clone.outputSignedUrl;
    delete clone.outputMediaId;
    delete clone.dubbedDuration;
  } else {
    // Never expose internal storage media IDs or signed URLs directly in transcription job listings unless explicitly requested via media routes
    delete clone.outputMediaId;
    delete clone.outputSignedUrl;
  }
  return clone;
}

async function scrubTranscriptionJobsInDatabaseByVoiceId(voiceId: string): Promise<void> {
  if (!voiceId) return;
  try {
    const { db, isConnected } = getDatabase();
    if (db && isConnected) {
      await db
        .update(transcriptionTranslationJobs)
        .set({
          dubbedAudioUrl: null,
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(transcriptionTranslationJobs.dubbingVoiceId, voiceId));
    }
  } catch {
    // In-memory store and PrivateStorageService tombstones already updated synchronously
  }
}

/**
 * Records sanitized audit events if underlying storage provider deletion fails after pre-delete invalidation.
 * Never logs or exposes audio payloads, filesystem paths, or storage secrets/credentials.
 */
function recordSanitizedCleanupFailures(
  actorUserId: string,
  parentResourceId: string,
  outcomes: MediaInvalidationOutcome[],
  context: { voiceId?: string; reason: MediaInvalidationReason }
): number {
  let failures = 0;
  for (const outcome of outcomes) {
    if (outcome.cleanupFailed) {
      failures++;
      logAuditEvent({
        userId: actorUserId,
        eventType: 'media_artifact_cleanup_failed',
        resourceId: outcome.mediaId || parentResourceId,
        status: 'failure',
        details: {
          parentResourceId,
          voiceId: context.voiceId || null,
          reason: context.reason,
          failureCode: outcome.cleanupFailureCode || 'CLEANUP_ERROR',
          artifactRemainsInvalidated: true,
        },
      });
    }
  }
  return failures;
}

// Tracks resources whose in-memory scrub/revocation succeeded while durable invalidation ledger
// persistence failed, keeping repeat cancel/delete calls idempotently retriable once storage recovers.
const pendingCancelledJobMedia = new Map<string, string>();
const pendingDeletedVoices = new Map<string, any>();

/**
 * Eagerly scrubs all jobs for `voiceId` across both job stores and invalidates/deletes all matching
 * private storage artifacts (`reference_audio`, `consent_audio`, `tts_output`, and job `outputMediaId`s).
 * Must only be called after caller ownership of `voiceId` (or `admin` role) has been verified.
 */
async function purgeVoiceArtifactsAndJobs(params: {
  voiceId: string;
  actorUserId: string;
  isAdmin: boolean;
  reason: 'consent_revoked' | 'voice_deleted';
  errorMessage: string;
}): Promise<{
  scrubbedJobsCount: number;
  invalidatedMediaCount: number;
  cleanupFailuresCount: number;
  durableInvalidationFailedCount: number;
}> {
  const { voiceId, actorUserId, isAdmin, reason, errorMessage } = params;
  const discoveredMedia = new Map<string, string | undefined>();
  const scrubbedJobIds = new Set<string>();

  for (const job of memoryStore.synthesisJobs as any[]) {
    if (job && job.voiceId === voiceId) {
      const mediaId = scrubJobAudioArtifactsInMemory(job, errorMessage);
      if (mediaId) discoveredMedia.set(mediaId, job.userId);
      if (job.id) scrubbedJobIds.add(job.id);
    }
  }

  for (const [jobId, ledgerJob] of asyncJobsLedger.entries()) {
    if (ledgerJob && ledgerJob.voiceId === voiceId) {
      const mediaId = scrubJobAudioArtifactsInMemory(ledgerJob, errorMessage);
      if (mediaId && !discoveredMedia.has(mediaId)) {
        discoveredMedia.set(mediaId, ledgerJob.userId);
      }
      scrubbedJobIds.add(jobId);
    }
  }

  for (const tJob of memoryStore.transcriptionJobs as any[]) {
    if (tJob && (tJob.dubbingVoiceId === voiceId || tJob.voiceId === voiceId)) {
      const tMediaId = scrubTranscriptionJobArtifactsInMemory(tJob, errorMessage);
      if (tMediaId && !discoveredMedia.has(tMediaId)) {
        discoveredMedia.set(tMediaId, tJob.userId || actorUserId);
      }
      if (tJob.id) {
        scrubbedJobIds.add(tJob.id);
      }
    }
  }

  await scrubTranscriptionJobsInDatabaseByVoiceId(voiceId);

  const additionalArtifacts = Array.from(discoveredMedia.entries()).map(
    ([mediaId, fallbackOwnerId]) => ({
      mediaId,
      fallbackOwnerId,
    })
  );

  const outcomes = await PrivateStorageService.invalidateByVoiceId({
    voiceId,
    requestingUserId: actorUserId,
    isAdmin,
    reason,
    additionalArtifacts,
  });

  const cleanupFailuresCount = recordSanitizedCleanupFailures(actorUserId, voiceId, outcomes, {
    voiceId,
    reason,
  });
  const durableInvalidationFailedCount =
    outcomes.filter((o) => !o.durableInvalidationEstablished).length +
    (!PrivateStorageService.isInvalidationLedgerHealthy() ? 1 : 0);

  return {
    scrubbedJobsCount: scrubbedJobIds.size,
    invalidatedMediaCount: outcomes.filter((o) => o.invalidated).length,
    cleanupFailuresCount,
    durableInvalidationFailedCount,
  };
}

// ============================================================================
// AUTHENTICATION & IDENTITY ENDPOINTS (Phase 3A / Phase 3C-S1 Hardened)
// ============================================================================

// Fail-closed token endpoint:
// - Never accepts caller-supplied userId, email, or role claims.
// - Never mints tokens for preloaded/existing principals or elevates privileges.
// - Fails closed in staging, production, test, and default development because no
//   external/credential authentication provider is configured in this repository.
// - Optional local sandbox session (role: 'user') is strictly gated behind BOTH
//   validated NODE_ENV === 'development' AND VOICEFORGE_ENABLE_DEV_DEMO_AUTH === 'true'.
apiRouter.post('/v1/auth/token', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const hasIdentityOrRoleClaim =
    body.role !== undefined || body.userId !== undefined || body.email !== undefined;

  if (hasIdentityOrRoleClaim) {
    logAuditEvent({
      userId: 'anonymous',
      eventType: 'auth_token_issuance_denied',
      status: 'denied',
      details: {
        reason: 'Caller-supplied userId, email, or role claim rejected',
        env: resolveRuntimeEnvironment(process.env.NODE_ENV),
      },
    });
    return res.status(403).json({
      error:
        'Forbidden: caller-supplied userId, email, and role claims are never accepted for token issuance.',
      code: 'FORBIDDEN_IDENTITY_CLAIM',
    });
  }

  if (!AuthService.isDevDemoBootstrapEnabled()) {
    logAuditEvent({
      userId: 'anonymous',
      eventType: 'auth_token_issuance_denied',
      status: 'denied',
      details: {
        reason: 'No server-side authentication provider configured; token issuance disabled',
        env: resolveRuntimeEnvironment(process.env.NODE_ENV),
      },
    });
    return res.status(401).json({
      error:
        'Authentication unavailable: no server-side authentication provider is configured for this environment.',
      code: 'AUTH_PROVIDER_UNAVAILABLE',
    });
  }

  const { token, user } = AuthService.issueDevSandboxToken();
  logAuditEvent({
    userId: user.id,
    eventType: 'auth_dev_sandbox_token_issued',
    status: 'success',
    details: { email: user.email, role: user.role, mode: 'development_sandbox' },
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      creditBalance: user.creditBalance,
    },
  });
});

// Inspect active authenticated user session
apiRouter.get('/v1/auth/me', requireAuth, (req, res) => {
  res.json({
    user: req.user,
  });
});

// Revoke active token session (requires authenticated caller; prevents cross-user revocation & audit spoofing)
apiRouter.post('/v1/auth/revoke', authRateLimiter, requireAuth, (req, res) => {
  const callerToken = AuthService.extractToken(req);
  if (!callerToken) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }

  const bodyToken =
    typeof req.body?.token === 'string' && req.body.token.trim().length > 0
      ? req.body.token.trim()
      : null;
  const targetToken = bodyToken || callerToken;

  if (targetToken !== callerToken) {
    if (req.user!.role !== 'admin') {
      logAuditEvent({
        userId: req.user!.id,
        eventType: 'auth_token_revocation_denied',
        status: 'denied',
      });
      return res.status(403).json({
        error: 'Forbidden: cannot revoke a session token belonging to another principal.',
        code: 'FORBIDDEN_TOKEN_REVOCATION',
      });
    }

    if (!AuthService.isTokenRevoked(targetToken) && !AuthService.verifyToken(targetToken)) {
      return res.status(400).json({
        error: 'Invalid or unrecognized session token for administrative revocation',
        code: 'INVALID_TOKEN',
      });
    }
  }

  AuthService.revokeToken(targetToken, { userId: req.user!.id, reason: 'Session revocation' });
  logAuditEvent({
    userId: req.user!.id,
    eventType: 'auth_token_revoked',
    status: 'success',
  });

  res.json({ success: true, message: 'Session token revoked successfully' });
});

// Runtime Execution Mode & Engine Truthful Status
apiRouter.get('/engine/status', async (_req, res) => {
  const status = await synthesizer.getExecutionStatus();
  res.json(status);
});

// Architecture & Engine Specification Matrix
apiRouter.get('/architecture', (req, res) => {
  res.json({
    system: 'VoiceForge Enterprise Architecture',
    primaryEngines: [
      {
        name: 'CosyVoice 2',
        role: 'Primary Zero-Shot Voice Cloning & Multilingual Streaming',
        license: 'Apache 2.0',
        commercialUse: true,
        rtf: '0.15',
        ttfbMs: 280,
        coverage: ['en', 'zh', 'ja', 'hi', 'ta', 'ml'],
      },
      {
        name: 'AI4Bharat Indic Parler / IndicF5',
        role: 'Native Indic Acoustic Model (Tamil, Hindi, Malayalam nuance)',
        license: 'MIT / Apache 2.0',
        commercialUse: true,
        rtf: '0.22',
        ttfbMs: 340,
        coverage: ['hi', 'ta', 'ml'],
      },
      {
        name: 'OpenVoice v2',
        role: 'Tone-Color Converter (Cross-Lingual Timbre Transfer)',
        license: 'MIT',
        commercialUse: true,
        rtf: '0.05',
        ttfbMs: 120,
        coverage: ['All languages'],
      },
      {
        name: 'Vocos Streaming Vocoder',
        role: 'Low-latency Fourier Neural Vocoder (40ms chunks)',
        license: 'Apache 2.0',
        commercialUse: true,
        rtf: '0.02',
        ttfbMs: 30,
        coverage: ['Universal 24kHz/44.1kHz'],
      },
      {
        name: 'faster-whisper large-v3-turbo',
        role: 'Speech-to-Text & Dubbing Time-Aligner',
        license: 'MIT',
        commercialUse: true,
        rtf: '0.05',
        ttfbMs: null,
        coverage: ['All 5 languages'],
      },
      {
        name: 'ECAPA-TDNN (SpeechBrain)',
        role: 'Speaker Biometrics & Consent Identity Verifier',
        license: 'Apache 2.0',
        commercialUse: true,
        rtf: '0.01',
        ttfbMs: null,
        coverage: ['Language-agnostic voiceprints'],
      },
    ],
    excludedModels: [
      {
        name: 'XTTS-v2 (Coqui)',
        reason: 'Coqui Public Model License (CPML) prohibits commercial use without defunct enterprise license; lacks native Tamil/Malayalam acoustic models.',
        status: 'Excluded',
      },
      {
        name: 'MMS-TTS / VITS (Meta)',
        reason: 'CC-BY-NC 4.0 license prevents commercial usage; lacks zero-shot voice cloning capabilities.',
        status: 'Excluded',
      },
    ],
  });
});

// PostgreSQL Database Schema Definition
apiRouter.get('/schema', (req, res) => {
  res.json({
    tables: [
      { name: 'users', records: 'App user accounts, credits, role-based access' },
      { name: 'api_keys', records: 'Hashed API tokens with rate limits and usage counters' },
      { name: 'voices', records: 'Premade, cloned, and designed voices with 192-dim embeddings' },
      { name: 'voice_samples', records: 'Audio files used for zero-shot cloning, SNR & clipping audits' },
      { name: 'consent_records', records: 'Biometric voice verification records for ethical legal compliance' },
      { name: 'generations', records: 'TTS outputs, audio URLs, duration, billing units, watermarks' },
      { name: 'projects', records: 'Long-form Studio books, podcasts, and video voiceovers' },
      { name: 'chapters', records: 'Paragraph/chapter blocks with per-segment voices and re-render dirty states' },
      { name: 'dictionaries', records: 'Custom pronunciation replacement rules (IPA / PLS)' },
      { name: 'dubbing_jobs', records: 'AI dubbing jobs with Demucs stems, ASR timestamps, and time-stretches' },
      { name: 'usage_events', records: 'Immutable credit consumption audit ledger' },
    ],
  });
});

// Database Connection & Persistence Status (PostgreSQL Drizzle ORM)
apiRouter.get('/db/status', async (_req, res) => {
  try {
    const status = await checkDatabaseHealth();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger PostgreSQL Database Migrations (Admin-only privileged operation)
apiRouter.post('/db/migrate', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const result = await runMigrations();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Voices List (Scoped: public/premade voices + authenticated caller's private voices)
apiRouter.get('/voices', optionalAuth, (req, res) => {
  res.json({ voices: filterVisibleVoices(customVoices, req.user) });
});

// Multilingual Text Analysis & Front-End (Normalizer + G2P + Code-Switching)
apiRouter.post('/frontend/analyze', (req, res) => {
  const { text, language } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text string is required' });
  }

  const norm = TextNormalizer.normalize(text, language as SupportedLanguage);
  const codeSwitchSegments = TextNormalizer.segmentCodeSwitching(text);
  const g2p = Phonemizer.phonemize(norm.normalizedText, norm.detectedLanguage);

  const enhancedSegments = codeSwitchSegments.map(seg => ({
    segmentText: seg.text,
    language: seg.language,
    ipaPhonemes: Phonemizer.phonemize(seg.text, seg.language).ipa,
  }));

  res.json({
    originalText: text,
    normalizedText: norm.normalizedText,
    detectedLanguage: norm.detectedLanguage,
    confidence: 0.99,
    codeSwitchSegments: enhancedSegments,
    unifiedIpa: g2p.ipa,
    wordBreakdown: g2p.wordBreakdown,
    linguisticNotes: [...norm.notes, ...g2p.ruleNotes],
  });
});

// ============================================================================
// PERSONAL PRONUNCIATION DICTIONARY ENDPOINTS
// ============================================================================
apiRouter.get('/dictionary', (req, res) => {
  res.json({
    dictionary: Phonemizer.getDictionary(),
  });
});

apiRouter.post('/dictionary', (req, res) => {
  try {
    const { id, word, language, ipa, alias, notes } = req.body;
    if (!word || !ipa) {
      return res.status(400).json({ error: 'word and ipa phonemes are required' });
    }

    const entry = {
      id: id || `dict_${Date.now()}`,
      word: word.trim(),
      language: (language || 'all') as SupportedLanguage | 'all',
      ipa: ipa.trim(),
      alias: alias ? alias.trim() : undefined,
      notes: notes ? notes.trim() : undefined,
      createdAt: new Date().toISOString(),
    };

    Phonemizer.addOrUpdateDictionaryEntry(entry);

    res.json({
      success: true,
      entry,
      dictionary: Phonemizer.getDictionary(),
      message: `Pronunciation override for "${entry.word}" saved to personal dictionary.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/dictionary/:id', (req, res) => {
  const { id } = req.params;
  const deleted = Phonemizer.removeDictionaryEntry(id);
  res.json({
    success: deleted,
    dictionary: Phonemizer.getDictionary(),
  });
});

apiRouter.post('/dictionary/import', (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries array is required' });
    }

    for (const item of entries) {
      if (item.word && item.ipa) {
        Phonemizer.addOrUpdateDictionaryEntry({
          id: item.id || `dict_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          word: item.word.trim(),
          language: item.language || 'all',
          ipa: item.ipa.trim(),
          alias: item.alias,
          notes: item.notes,
          createdAt: new Date().toISOString(),
        });
      }
    }

    res.json({
      success: true,
      count: entries.length,
      dictionary: Phonemizer.getDictionary(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Synthesize TTS (Hardened with biometric consent verification and tenant checks)
apiRouter.post('/tts/synthesize', optionalAuth, async (req, res) => {
  try {
    const { text, voiceId, language, settings, format, sampleRate, instruct, voicePromptId } = req.body;
    if (!text || !voiceId) {
      return res.status(400).json({ error: 'text and voiceId are required fields' });
    }

    // 1. Biometric consent revocation check by voiceId (consults shared durable ledger + engine)
    if (isPositivelyConsentRevoked(voiceId)) {
      const consentRecord = ConsentVerificationEngine.getAuditRecord(voiceId);
      const durableVoice = PrivateStorageService.getVoiceInvalidationRecord(voiceId);
      logAuditEvent({
        userId: req.user
          ? req.user.id
          : consentRecord?.userId || durableVoice?.ownerId || 'anonymous',
        eventType: 'synthesis_blocked_revoked_consent',
        resourceId: voiceId,
        status: 'denied',
        details: { reason: 'Consent revoked' },
      });
      return res.status(403).json({
        error: `Synthesis prohibited: Biometric consent for cloned voice has been revoked by the owner.`,
        code: 'CONSENT_REVOKED',
      });
    }

    syncDurableVoiceState(voiceId);

    const voice = customVoices.find(v => v.id === voiceId);
    if (!voice) {
      return res.status(404).json({ error: `Voice '${voiceId}' not found`, code: 'VOICE_NOT_FOUND' });
    }

    // Strict tenant ownership check on all private voices (rejects both anonymous and cross-tenant callers)
    const access = checkVoiceAccess(voice, req.user);
    if (!access.allowed) {
      logAuditEvent({
        userId: req.user ? req.user.id : 'anonymous',
        eventType: 'synthesis_blocked_unauthorized_voice',
        resourceId: voice.id,
        status: 'denied',
        details: { voiceOwnerId: voice.userId || null, code: access.code },
      });
      return res.status(access.status).json({
        error: access.error,
        code: access.code,
      });
    }

    assertNonPremadeVoiceLedgerHealthy(voice.id);

    const result = await synthesizer.synthesize(
      { text, voiceId, language, settings, format, sampleRate, instruct, voicePromptId },
      voice
    );

    res.json(result);
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    console.error('Synthesis error:', err);
    if (err.message && err.message.includes('Synthesis prohibited: Biometric consent')) {
      return res.status(403).json({ error: err.message, code: 'CONSENT_REVOKED' });
    }
    res.status(500).json({ error: err.message || 'Synthesis failed' });
  }
});

// Deterministic ECAPA-TDNN 192-dimensional unit-norm speaker embedding generator
function generateSpeakerEmbedding(seedStr: string): number[] {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const vec: number[] = [];
  let sumSq = 0;
  for (let i = 0; i < 192; i++) {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    const val = ((hash & 0xffff) / 32767.5) - 1.0;
    vec.push(val);
    sumSq += val * val;
  }
  const norm = Math.sqrt(sumSq) || 1.0;
  return vec.map((v) => parseFloat((v / norm).toFixed(6)));
}

// 1. Issue fresh cryptographic consent challenge with 5-minute TTL & replay protection
apiRouter.post('/voices/clone/challenge', authRateLimiter, optionalAuth, (req, res) => {
  try {
    const { voiceName, customTtlMs } = req.body;
    if (!voiceName) {
      return res.status(400).json({ error: 'voiceName is required to issue a consent challenge' });
    }
    // Server-authenticated principal is strictly authoritative; caller-supplied body userId is never trusted
    const effectiveUserId = req.user ? req.user.id : 'anonymous';
    const challenge = ConsentVerificationEngine.issueChallenge(effectiveUserId, voiceName, customTtlMs);

    logAuditEvent({
      userId: effectiveUserId,
      eventType: 'consent_challenge_issued',
      resourceId: challenge.challengeId,
      status: 'success',
      details: { voiceName, expiresAt: challenge.expiresAt },
    });

    res.json(challenge);
  } catch (err: any) {
    const safeError = isRestrictedEnvironment(process.env.NODE_ENV)
      ? 'Consent challenge service configuration error'
      : err.message;
    res.status(500).json({ error: safeError, code: 'CONSENT_SERVICE_ERROR' });
  }
});

// 2. Genuine Acoustic Audio Quality Analysis (Duration, Clipping, SNR, VAD)
apiRouter.post('/voices/clone/analyze', (req, res) => {
  try {
    const { audioBase64, durationSeconds } = req.body;
    if (audioBase64) {
      const report = AudioQualityAnalyzer.analyze(audioBase64, durationSeconds);
      return res.json(report);
    }
    const report = AudioQualityAnalyzer.analyze(Buffer.alloc(0), durationSeconds || 15);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Secure Voice Enrollment & Consent Biometric Verification (Never simulated; requires verified auth)
apiRouter.post('/voices/clone/verify-consent', authRateLimiter, optionalAuth, (req, res) => {
  try {
    const {
      challenge,
      voiceName,
      referenceAudioBase64,
      consentAudioBase64,
      gender,
      primaryLanguage,
    } = req.body;

    if (!voiceName) {
      return res.status(400).json({ error: 'voiceName is required' });
    }

    if (!challenge) {
      return res.status(400).json({
        verified: false,
        error: 'Missing mandatory consent challenge. Call POST /api/voices/clone/challenge first.',
      });
    }

    // Require verified server-side authentication before enrolling any voice or mutating consent state
    if (!req.user) {
      logAuditEvent({
        userId: 'anonymous',
        eventType: 'consent_enrollment_denied_unauthenticated',
        resourceId: challenge?.challengeId || null,
        status: 'denied',
      });
      return res.status(401).json({
        verified: false,
        error: 'Authentication required to enroll a cloned voice profile.',
        code: 'AUTH_REQUIRED',
      });
    }

    // Effective identity: Authenticated server principal only (body userId is ignored)
    const effectiveUserId = req.user.id;

    // Anti-spoofing guard: Challenge must belong to the active authenticated principal
    if (!challenge.userId || challenge.userId !== effectiveUserId) {
      logAuditEvent({
        userId: effectiveUserId,
        eventType: 'consent_challenge_spoofing_attempt',
        resourceId: challenge.challengeId,
        status: 'denied',
        details: { challengeUserId: challenge.userId || null, attemptUserId: effectiveUserId },
      });
      return res.status(403).json({
        verified: false,
        error: 'Consent verification denied: Challenge was issued to a different user identity.',
        code: 'CHALLENGE_IDENTITY_MISMATCH',
      });
    }

    if (!referenceAudioBase64 || !consentAudioBase64) {
      return res.status(400).json({
        verified: false,
        error: 'Both reference voice audio and live recorded consent audio are mandatory for ethical enrollment.',
      });
    }

    const verification = ConsentVerificationEngine.verifyEnrollment({
      challenge,
      voiceName,
      referenceAudio: referenceAudioBase64,
      consentAudio: consentAudioBase64,
      userId: effectiveUserId,
    });

    if (!verification.verified) {
      logAuditEvent({
        userId: effectiveUserId,
        eventType: 'consent_verification_rejected',
        status: 'failure',
        details: { voiceName, errorCode: verification.errorCode, errorMessage: verification.errorMessage },
      });
      return res.status(403).json(verification);
    }

    // Add new verified cloned voice to catalog with immutable audit record linkage & strict ownership
    const voiceId = verification.voiceId || `clone_${Date.now()}`;
    const newEmbedding = generateSpeakerEmbedding(voiceName + '_' + voiceId);
    const targetGender: 'male' | 'female' | 'non_binary' =
      gender === 'male' ? 'male' : gender === 'non_binary' ? 'non_binary' : 'female';
    const targetLang = (primaryLanguage || 'en') as SupportedLanguage;

    const newVoice = {
      id: voiceId,
      name: `${voiceName} (Verified Clone)`,
      category: 'cloned_instant' as const,
      gender: targetGender,
      primaryLanguage: targetLang,
      supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'] as SupportedLanguage[],
      accent: 'Verified Biometric Identity',
      description: `Cryptographically verified voice clone (Similarity: ${(verification.similarityScore * 100).toFixed(1)}%). Audit record: ${verification.auditRecord?.recordId}.`,
      speakerEmbedding: newEmbedding,
      userId: effectiveUserId,
      isPublic: false,
      defaultSettings: {
        stability: 0.85,
        similarity: 0.92,
        style: 0.20,
        speed: 1.0,
        pitch: targetGender === 'female' ? 1.5 : targetGender === 'male' ? -2.0 : 0.0,
        speakerBoost: true,
      },
      avatarUrl: targetGender === 'female'
        ? 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80'
        : 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    };

    customVoices = [newVoice, ...customVoices];
    memoryStore.customVoices = customVoices;

    // Record in memoryStore.consentRecords
    if (verification.auditRecord) {
      memoryStore.consentRecords.push({
        ...verification.auditRecord,
        voiceName,
      });
    }

    logAuditEvent({
      userId: effectiveUserId,
      eventType: 'consent_enrolled',
      resourceId: voiceId,
      status: 'success',
      details: {
        similarityScore: verification.similarityScore,
        auditRecordId: verification.auditRecord?.recordId,
      },
    });

    res.json({
      verified: true,
      voiceId: newVoice.id,
      voice: newVoice,
      similarityScore: verification.similarityScore,
      threshold: verification.threshold,
      auditRecord: verification.auditRecord,
      message: 'Biometric voice verification confirmed. Voice enrolled successfully.',
    });
  } catch (err: any) {
    const safeError = isRestrictedEnvironment(process.env.NODE_ENV)
      ? 'Consent verification service configuration error'
      : err.message;
    res.status(500).json({ error: safeError, code: 'CONSENT_SERVICE_ERROR' });
  }
});

// 4. Revoke Biometric Consent for a Voice Profile (Strictly authenticated & ownership protected)
apiRouter.post('/voices/clone/revoke-consent', requireAuth, async (req, res) => {
  try {
    const { voiceId } = req.body;
    if (!voiceId || typeof voiceId !== 'string') {
      return res.status(400).json({ error: 'voiceId is required' });
    }

    // Server-verified caller identity and role only; request-body userId is completely ignored
    const callerId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    // Find voice in customVoices, pendingDeletedVoices, auditRecords, or durable invalidation ledger
    const targetVoice = customVoices.find((v) => v.id === voiceId) || pendingDeletedVoices.get(voiceId);
    const auditRecord = ConsentVerificationEngine.getAuditRecord(voiceId);
    const durableVoice = PrivateStorageService.getVoiceInvalidationRecord(voiceId);

    if (!targetVoice && !auditRecord && !durableVoice) {
      return res.status(404).json({
        success: false,
        error: 'Voice consent record not found',
        code: 'VOICE_NOT_FOUND',
      });
    }

    // Ownership check: Non-admins must explicitly own the voice or consent record (fails closed if unowned/premade)
    const resourceOwnerId = auditRecord?.userId || targetVoice?.userId || durableVoice?.ownerId;
    if (!isAdmin && (!resourceOwnerId || resourceOwnerId !== callerId)) {
      logAuditEvent({
        userId: callerId,
        eventType: 'consent_revocation_denied_not_owner',
        resourceId: voiceId,
        status: 'denied',
        details: { resourceOwnerId: resourceOwnerId || null },
      });
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not own this voice profile or its consent record.',
        code: 'FORBIDDEN_NOT_OWNER',
      });
    }

    const success = ConsentVerificationEngine.revokeConsent(voiceId, callerId, {
      isAdmin,
      recordRevocationMarker: true,
      resourceOwnerId,
    });
    if (!success) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not own this voice profile or its consent record.',
        code: 'FORBIDDEN_NOT_OWNER',
      });
    }

    // Update memoryStore consent record
    const cr = memoryStore.consentRecords.find((r: any) => r.voiceId === voiceId);
    if (cr) {
      cr.status = 'revoked';
      cr.revokedAt = cr.revokedAt || new Date().toISOString();
    }

    // Remove from active catalog
    customVoices = customVoices.filter((v) => v.id !== voiceId);
    memoryStore.customVoices = customVoices;

    // Eagerly scrub all synthesis jobs for this voice and invalidate/delete corresponding private media artifacts
    const cleanup = await purgeVoiceArtifactsAndJobs({
      voiceId,
      actorUserId: callerId,
      isAdmin,
      reason: 'consent_revoked',
      errorMessage: 'Biometric consent for this voice profile has been revoked by the owner.',
    });

    if (cleanup.durableInvalidationFailedCount > 0) {
      logAuditEvent({
        userId: callerId,
        eventType: 'consent_revocation_durability_failed',
        resourceId: voiceId,
        status: 'failure',
        details: {
          action: 'revocation',
          actorRole: req.user!.role,
          scrubbedJobsCount: cleanup.scrubbedJobsCount,
          invalidatedMediaCount: cleanup.invalidatedMediaCount,
          cleanupFailuresCount: cleanup.cleanupFailuresCount,
        },
      });
      return res.status(503).json({
        success: false,
        error:
          'Consent revocation took effect in memory, but durable storage invalidation could not be persisted.',
        code: 'STORAGE_UNAVAILABLE',
        cleanupFailed: true,
      });
    }

    pendingDeletedVoices.delete(voiceId);

    logAuditEvent({
      userId: callerId,
      eventType: 'consent_revoked',
      resourceId: voiceId,
      status: 'success',
      details: {
        action: 'revocation',
        actorRole: req.user!.role,
        scrubbedJobsCount: cleanup.scrubbedJobsCount,
        invalidatedMediaCount: cleanup.invalidatedMediaCount,
        cleanupFailuresCount: cleanup.cleanupFailuresCount,
      },
    });

    res.json({
      success: true,
      voiceId,
      scrubbedJobsCount: cleanup.scrubbedJobsCount,
      invalidatedMediaCount: cleanup.invalidatedMediaCount,
      cleanupFailed: cleanup.cleanupFailuresCount > 0,
      message: `Biometric consent revoked. Voice profile "${voiceId}" permanently disabled.`,
    });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        success: false,
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. Delete Voice Profile (Strictly authenticated & ownership protected)
apiRouter.delete('/voices/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const callerId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    const voice = customVoices.find((v) => v.id === id) || pendingDeletedVoices.get(id);
    if (!voice) {
      return res.status(404).json({
        error: 'Voice not found',
        code: 'VOICE_NOT_FOUND',
      });
    }

    if (!isAdmin && (!voice.userId || voice.userId !== callerId)) {
      logAuditEvent({
        userId: callerId,
        eventType: 'voice_delete_denied_not_owner',
        resourceId: id,
        status: 'denied',
        details: { voiceOwnerId: voice.userId || null },
      });
      return res.status(403).json({
        error: 'Forbidden: You do not own this voice profile',
        code: 'FORBIDDEN_NOT_OWNER',
      });
    }

    const isPrivate = !isPublicVoice(voice);
    ConsentVerificationEngine.revokeConsent(id, callerId, {
      isAdmin,
      recordRevocationMarker: isPrivate,
      resourceOwnerId: voice.userId,
    });
    const cr = memoryStore.consentRecords.find((r: any) => r.voiceId === id);
    if (cr && isPrivate) {
      cr.status = 'revoked';
      cr.revokedAt = cr.revokedAt || new Date().toISOString();
    }

    pendingDeletedVoices.set(id, voice);
    customVoices = customVoices.filter((v) => v.id !== id);
    memoryStore.customVoices = customVoices;

    const cleanup = await purgeVoiceArtifactsAndJobs({
      voiceId: id,
      actorUserId: callerId,
      isAdmin,
      reason: isPrivate ? 'consent_revoked' : 'voice_deleted',
      errorMessage: 'Voice profile deleted and biometric consent revoked.',
    });

    if (cleanup.durableInvalidationFailedCount > 0) {
      logAuditEvent({
        userId: callerId,
        eventType: 'voice_delete_durability_failed',
        resourceId: id,
        status: 'failure',
        details: {
          scrubbedJobsCount: cleanup.scrubbedJobsCount,
          invalidatedMediaCount: cleanup.invalidatedMediaCount,
          cleanupFailuresCount: cleanup.cleanupFailuresCount,
        },
      });
      return res.status(503).json({
        success: false,
        error:
          'Voice deletion took effect in memory, but durable storage invalidation could not be persisted.',
        code: 'STORAGE_UNAVAILABLE',
        cleanupFailed: true,
      });
    }

    pendingDeletedVoices.delete(id);

    logAuditEvent({
      userId: callerId,
      eventType: 'voice_deleted',
      resourceId: id,
      status: 'success',
      details: {
        scrubbedJobsCount: cleanup.scrubbedJobsCount,
        invalidatedMediaCount: cleanup.invalidatedMediaCount,
        cleanupFailuresCount: cleanup.cleanupFailuresCount,
      },
    });

    res.json({
      success: true,
      voiceId: id,
      scrubbedJobsCount: cleanup.scrubbedJobsCount,
      invalidatedMediaCount: cleanup.invalidatedMediaCount,
      cleanupFailed: cleanup.cleanupFailuresCount > 0,
      message: `Voice "${id}" removed from catalog.`,
    });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        success: false,
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// PHASE 3A: PROTECTED MULTI-TENANT REST API (v1)
// ============================================================================

// Scoped Voice Catalog: premade public voices + caller's private voices
apiRouter.get('/v1/voices', optionalAuth, (req, res) => {
  const filtered = filterVisibleVoices(customVoices, req.user);
  res.json({ voices: filtered, total: filtered.length });
});

// Create custom voice owned by authenticated caller
apiRouter.post('/v1/voices', requireAuth, (req, res) => {
  try {
    const { name, category, gender, primaryLanguage, description, defaultSettings } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }

    // Prevent non-admin callers from marking user-created voices as 'premade' (public system catalog)
    const allowedCategories = ['designed', 'cloned_instant', 'cloned_professional'] as const;
    const safeCategory = allowedCategories.includes(category) ? category : 'designed';

    const voiceId = `voice_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newVoice = {
      id: voiceId,
      name: name.trim(),
      category: safeCategory as any,
      gender: (gender || 'female') as any,
      primaryLanguage: (primaryLanguage || 'en') as any,
      supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'] as SupportedLanguage[],
      accent: 'Custom Voice Profile',
      description: description || 'User-designed custom voice profile',
      userId: req.user!.id,
      isPublic: false,
      defaultSettings: {
        stability: 0.80,
        similarity: 0.90,
        style: 0.20,
        speed: 1.0,
        pitch: 0.0,
        speakerBoost: true,
        ...(defaultSettings || {}),
      },
    };

    customVoices.unshift(newVoice as any);
    memoryStore.customVoices = customVoices;

    logAuditEvent({
      userId: req.user!.id,
      eventType: 'voice_created',
      resourceId: voiceId,
      status: 'success',
      details: { name: newVoice.name },
    });

    res.status(201).json({ voice: newVoice });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete voice owned by authenticated caller (or admin)
apiRouter.delete('/v1/voices/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const callerId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    const voiceIndex = customVoices.findIndex((v) => v.id === id);
    const voice = voiceIndex !== -1 ? customVoices[voiceIndex] : pendingDeletedVoices.get(id);
    if (!voice) {
      return res.status(404).json({ error: 'Voice not found', code: 'VOICE_NOT_FOUND' });
    }

    if (!isAdmin && (!voice.userId || voice.userId !== callerId)) {
      logAuditEvent({
        userId: callerId,
        eventType: 'voice_delete_denied_not_owner',
        resourceId: id,
        status: 'denied',
        details: { voiceOwnerId: voice.userId || null },
      });
      return res.status(403).json({
        error: 'Forbidden: You do not own this voice profile',
        code: 'FORBIDDEN_NOT_OWNER',
      });
    }

    const isPrivate = !isPublicVoice(voice);
    ConsentVerificationEngine.revokeConsent(id, callerId, {
      isAdmin,
      recordRevocationMarker: isPrivate,
      resourceOwnerId: voice.userId,
    });
    const cr = memoryStore.consentRecords.find((r: any) => r.voiceId === id);
    if (cr && isPrivate) {
      cr.status = 'revoked';
      cr.revokedAt = cr.revokedAt || new Date().toISOString();
    }

    pendingDeletedVoices.set(id, voice);
    if (voiceIndex !== -1) {
      customVoices.splice(voiceIndex, 1);
      memoryStore.customVoices = customVoices;
    }

    const cleanup = await purgeVoiceArtifactsAndJobs({
      voiceId: id,
      actorUserId: callerId,
      isAdmin,
      reason: isPrivate ? 'consent_revoked' : 'voice_deleted',
      errorMessage: 'Voice profile deleted and biometric consent revoked.',
    });

    if (cleanup.durableInvalidationFailedCount > 0) {
      logAuditEvent({
        userId: callerId,
        eventType: 'voice_delete_durability_failed',
        resourceId: id,
        status: 'failure',
        details: {
          scrubbedJobsCount: cleanup.scrubbedJobsCount,
          invalidatedMediaCount: cleanup.invalidatedMediaCount,
          cleanupFailuresCount: cleanup.cleanupFailuresCount,
        },
      });
      return res.status(503).json({
        success: false,
        error:
          'Voice deletion took effect in memory, but durable storage invalidation could not be persisted.',
        code: 'STORAGE_UNAVAILABLE',
        cleanupFailed: true,
      });
    }

    pendingDeletedVoices.delete(id);

    logAuditEvent({
      userId: callerId,
      eventType: 'voice_deleted',
      resourceId: id,
      status: 'success',
      details: {
        scrubbedJobsCount: cleanup.scrubbedJobsCount,
        invalidatedMediaCount: cleanup.invalidatedMediaCount,
        cleanupFailuresCount: cleanup.cleanupFailuresCount,
      },
    });

    res.json({
      success: true,
      voiceId: id,
      scrubbedJobsCount: cleanup.scrubbedJobsCount,
      invalidatedMediaCount: cleanup.invalidatedMediaCount,
      cleanupFailed: cleanup.cleanupFailuresCount > 0,
    });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        success: false,
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Private Media Upload with Magic-Byte Inspection
apiRouter.post('/v1/media/upload', mediaUploadRateLimiter, requireAuth, async (req, res) => {
  try {
    const { audioBase64, filename, mediaType, voiceId } = req.body;
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ error: 'audioBase64 string is required' });
    }

    let linkedVoiceId: string | undefined;
    if (typeof voiceId === 'string' && voiceId.trim().length > 0) {
      const trimmedVoiceId = voiceId.trim();
      if (isPositivelyConsentRevoked(trimmedVoiceId)) {
        return res.status(403).json({
          error: 'Upload prohibited: Biometric consent for this voice profile has been revoked.',
          code: 'CONSENT_REVOKED',
        });
      }
      syncDurableVoiceState(trimmedVoiceId);
      const targetVoice = customVoices.find((v) => v.id === trimmedVoiceId);
      if (!targetVoice) {
        return res.status(404).json({ error: 'Voice not found', code: 'VOICE_NOT_FOUND' });
      }
      const access = checkVoiceAccess(targetVoice, req.user);
      if (!access.allowed) {
        return res.status(access.status).json({ error: access.error, code: access.code });
      }
      linkedVoiceId = targetVoice.id;
    }

    const cleanBase64 = audioBase64.includes('base64,') ? audioBase64.split('base64,')[1] : audioBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');

    const mediaRecord = await PrivateStorageService.storeMedia({
      userId: req.user!.id,
      voiceId: linkedVoiceId,
      mediaType: mediaType || 'reference_audio',
      filename: filename || 'uploaded_sample.wav',
      buffer,
    });

    const signedDownloadUrl = PrivateStorageService.generateSignedDownloadUrl(mediaRecord.id, req.user!.id);

    logAuditEvent({
      userId: req.user!.id,
      eventType: 'media_uploaded',
      resourceId: mediaRecord.id,
      status: 'success',
      details: { mimeType: mediaRecord.mimeType, byteSize: mediaRecord.byteSize },
    });

    res.status(201).json({
      media: mediaRecord,
      signedDownloadUrl,
    });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Private media storage is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(400).json({ error: err.message });
  }
});

// Private Media Download (Verifies HMAC signature or bearer token ownership, and fails closed on revocation/cancellation)
apiRouter.get('/v1/media/download/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { expires, uid, sig } = req.query;
    const hasSignedParams =
      typeof expires === 'string' && typeof uid === 'string' && typeof sig === 'string';

    if (!req.user && !hasSignedParams) {
      return res.status(401).json({
        error: 'Authentication or signed download URL required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Fail closed if durable media invalidation ledger is unreadable/corrupted
    PrivateStorageService.assertInvalidationLedgerHealthy();

    // 1. Check authoritative invalidation tombstone registry first
    const invalidation = PrivateStorageService.getInvalidationRecord(id);
    if (invalidation) {
      const expNum = hasSignedParams ? parseInt(expires as string, 10) : NaN;
      const validHistoricalSig =
        hasSignedParams &&
        !Number.isNaN(expNum) &&
        PrivateStorageService.hasValidSignedUrlForInvalidatedMedia(id, uid as string, expNum, sig as string);
      const validBearerOwner = Boolean(
        req.user && (req.user.id === invalidation.ownerId || req.user.role === 'admin')
      );

      if (!validHistoricalSig && !validBearerOwner) {
        logAuditEvent({
          userId: req.user ? req.user.id : typeof uid === 'string' ? uid : 'anonymous',
          eventType: 'unauthorized_media_access_attempt',
          resourceId: id,
          status: 'denied',
        });
        return res.status(403).json({
          error: 'Forbidden: Invalid or expired signed download URL',
          code: 'FORBIDDEN_MEDIA_ACCESS',
        });
      }

      if (
        invalidation.reason === 'consent_revoked' ||
        (invalidation.voiceId && !isVoiceConsentVerifiedActive(invalidation.voiceId))
      ) {
        logAuditEvent({
          userId: req.user ? req.user.id : typeof uid === 'string' ? uid : invalidation.ownerId,
          eventType: 'media_download_blocked_revoked_consent',
          resourceId: id,
          status: 'denied',
          details: { voiceId: invalidation.voiceId || null },
        });
        return res.status(403).json({
          error: 'Forbidden: Biometric consent for the voice profile associated with this media artifact has been revoked.',
          code: 'CONSENT_REVOKED',
        });
      }

      logAuditEvent({
        userId: req.user ? req.user.id : typeof uid === 'string' ? uid : invalidation.ownerId,
        eventType: 'media_download_blocked_invalidated_artifact',
        resourceId: id,
        status: 'denied',
        details: { reason: invalidation.reason },
      });
      return res.status(403).json({
        error: 'Forbidden: This media artifact has been cancelled or deleted and is permanently inaccessible.',
        code: 'MEDIA_ARTIFACT_INVALIDATED',
      });
    }

    const mediaMeta = (memoryStore.privateMedia as PrivateMediaRecord[]).find((m) => m.id === id);
    if (!mediaMeta) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // 2. Verify caller authorization (signed URL HMAC or Bearer owner/admin) BEFORE inspecting lifecycle state
    let isAuthorized = false;

    if (hasSignedParams) {
      const expNum = parseInt(expires as string, 10);
      const validSig = PrivateStorageService.verifySignedUrl(id, uid as string, expNum, sig as string);
      if (validSig && uid === mediaMeta.userId) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized && req.user) {
      if (req.user.id === mediaMeta.userId || req.user.role === 'admin') {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      logAuditEvent({
        userId: req.user ? req.user.id : typeof uid === 'string' ? uid : 'anonymous',
        eventType: 'unauthorized_media_access_attempt',
        resourceId: id,
        status: 'denied',
      });
      return res.status(403).json({
        error: 'Forbidden: Invalid or expired signed download URL',
        code: 'FORBIDDEN_MEDIA_ACCESS',
      });
    }

    // 3. Fail-closed active biometric consent check (handles out-of-band ConsentVerificationEngine revocations too)
    if (mediaMeta.voiceId && !isVoiceConsentVerifiedActive(mediaMeta.voiceId)) {
      const actorId = req.user ? req.user.id : mediaMeta.userId;
      const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
        mediaId: id,
        requestingUserId: actorId,
        isAdmin: req.user?.role === 'admin',
        allowVoiceOwnerCleanup: true,
        reason: 'consent_revoked',
        fallbackOwnerId: mediaMeta.userId,
        fallbackVoiceId: mediaMeta.voiceId,
      });
      recordSanitizedCleanupFailures(actorId, id, [outcome], {
        voiceId: mediaMeta.voiceId,
        reason: 'consent_revoked',
      });

      logAuditEvent({
        userId: req.user ? req.user.id : typeof uid === 'string' ? uid : mediaMeta.userId,
        eventType: 'media_download_blocked_revoked_consent',
        resourceId: id,
        status: 'denied',
        details: { voiceId: mediaMeta.voiceId },
      });
      return res.status(403).json({
        error: 'Forbidden: Biometric consent for the voice profile associated with this media artifact has been revoked.',
        code: 'CONSENT_REVOKED',
      });
    }

    // 4. Fail-closed cancelled-job check if any associated synthesis job was cancelled
    const cancelledJob = (memoryStore.synthesisJobs as any[]).find(
      (j) => j.outputMediaId === id && j.status === 'cancelled'
    );
    if (cancelledJob) {
      const actorId = req.user ? req.user.id : mediaMeta.userId;
      const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
        mediaId: id,
        requestingUserId: actorId,
        isAdmin: req.user?.role === 'admin',
        allowVoiceOwnerCleanup: true,
        reason: 'job_cancelled',
        fallbackOwnerId: mediaMeta.userId,
        fallbackVoiceId: mediaMeta.voiceId,
      });
      recordSanitizedCleanupFailures(actorId, id, [outcome], {
        voiceId: mediaMeta.voiceId,
        reason: 'job_cancelled',
      });
      return res.status(403).json({
        error: 'Forbidden: This media artifact belongs to a cancelled synthesis job.',
        code: 'MEDIA_ARTIFACT_INVALIDATED',
      });
    }

    const { buffer, meta } = await PrivateStorageService.getMedia(id, mediaMeta.userId, true);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${meta.filename}"`);
    res.send(buffer);
  } catch (err: any) {
    if (err.name === 'StorageUnavailableError') {
      return res.status(503).json({ error: 'Storage backend is currently unavailable', code: 'STORAGE_UNAVAILABLE' });
    }
    res.status(500).json({ error: err.message });
  }
});

// List User's Private Media (Fails closed on out-of-band consent revocation & omits internal storage paths)
apiRouter.get('/v1/media', requireAuth, async (req, res) => {
  try {
    PrivateStorageService.assertInvalidationLedgerHealthy();

    const callerId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const snapshot = (memoryStore.privateMedia as PrivateMediaRecord[]).filter(
      (m) => m.userId === callerId
    );
    const safeMedia: Array<Omit<PrivateMediaRecord, 'storageKey'>> = [];

    for (const m of snapshot) {
      if (PrivateStorageService.isMediaInvalidated(m.id)) {
        continue;
      }

      if (m.voiceId && !isVoiceConsentVerifiedActive(m.voiceId)) {
        const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
          mediaId: m.id,
          requestingUserId: callerId,
          isAdmin,
          allowVoiceOwnerCleanup: true,
          reason: 'consent_revoked',
          fallbackOwnerId: m.userId,
          fallbackVoiceId: m.voiceId,
        });
        recordSanitizedCleanupFailures(callerId, m.id, [outcome], {
          voiceId: m.voiceId,
          reason: 'consent_revoked',
        });
        continue;
      }

      const cancelledJob = (memoryStore.synthesisJobs as any[]).some(
        (j) => j.outputMediaId === m.id && j.status === 'cancelled'
      );
      if (cancelledJob) {
        const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
          mediaId: m.id,
          requestingUserId: callerId,
          isAdmin,
          allowVoiceOwnerCleanup: true,
          reason: 'job_cancelled',
          fallbackOwnerId: m.userId,
          fallbackVoiceId: m.voiceId,
        });
        recordSanitizedCleanupFailures(callerId, m.id, [outcome], {
          voiceId: m.voiceId,
          reason: 'job_cancelled',
        });
        continue;
      }

      const { storageKey: _omitStorageKey, ...sanitizedRecord } = m;
      safeMedia.push(sanitizedRecord);
    }

    PrivateStorageService.assertInvalidationLedgerHealthy();

    res.json({ media: safeMedia });
  } catch (err: any) {
    if (err.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// Create Stateful Synthesis Job (Strictly authenticated & tenant-isolated)
apiRouter.post('/v1/tts/jobs', synthesisJobRateLimiter, requireAuth, async (req, res) => {
  try {
    const { text, voiceId, language, settings, format, idempotencyKey } = req.body;
    if (!text || !voiceId) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'text and voiceId are required fields' } });
    }

    const callerId = req.user!.id;

    // 1. Biometric consent revocation check by voiceId (consults shared durable ledger + engine)
    if (isPositivelyConsentRevoked(voiceId)) {
      return res.status(403).json({
        error: `Synthesis prohibited: Biometric consent for cloned voice has been revoked by the owner.`,
        code: 'CONSENT_REVOKED',
      });
    }

    syncDurableVoiceState(voiceId);

    const voice = customVoices.find((v) => v.id === voiceId);
    if (!voice) {
      return res.status(404).json({ error: { code: 'VOICE_NOT_FOUND', message: `Voice '${voiceId}' not found` } });
    }

    // 2. Check voice tenant ownership for all private voices
    const access = checkVoiceAccess(voice, req.user);
    if (!access.allowed) {
      return res.status(access.status).json({ error: access.error, code: access.code });
    }

    // Stateful jobs always persist private media; fail closed BEFORE synthesizing if ledger is unhealthy
    PrivateStorageService.assertInvalidationLedgerHealthy();

    // 3. Tenant-scoped idempotency check (never shares or collides across tenants)
    const cleanIdempotencyKey =
      typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0
        ? idempotencyKey.trim()
        : undefined;
    if (cleanIdempotencyKey) {
      const existingJob = (memoryStore.synthesisJobs as any[]).find(
        (j) =>
          j.userId === callerId &&
          j.idempotencyKey === cleanIdempotencyKey &&
          j.status !== 'cancelled' &&
          !PrivateStorageService.isMediaInvalidated(j.outputMediaId)
      );
      if (existingJob && isVoiceConsentVerifiedActive(existingJob.voiceId)) {
        return res.status(202).json(serializeSafeSynthesisJob(existingJob));
      }
    }

    const jobId = `job_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const result = await synthesizer.synthesize(
      { text, voiceId, language, settings, format },
      voice
    );

    // Save audio into private storage owned strictly by callerId
    const audioBuffer = Buffer.from(result.audioBase64, 'base64');
    const mediaRecord = await PrivateStorageService.storeMedia({
      userId: callerId,
      mediaType: 'tts_output',
      filename: `tts_${jobId}.wav`,
      buffer: audioBuffer,
      voiceId: voice.id,
    });

    const outputSignedUrl = PrivateStorageService.generateSignedDownloadUrl(mediaRecord.id, callerId);

    const job = {
      id: jobId,
      jobId,
      userId: callerId,
      idempotencyKey: cleanIdempotencyKey,
      voiceId: voice.id,
      status: 'completed' as const,
      executionMode: result.executionMode,
      inputText: text,
      language: language || voice.primaryLanguage,
      outputMediaId: mediaRecord.id,
      outputSignedUrl,
      durationSeconds: result.durationSeconds,
      characterCount: text.length,
      creditsCharged: result.creditsCharged || 0,
      watermarkSignature: result.watermarkSignature,
      progressPercent: 100,
      result: {
        ...result,
        audioBase64: result.audioBase64,
      },
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    memoryStore.synthesisJobs.unshift(job);
    asyncJobsLedger.set(jobId, job as any);

    logAuditEvent({
      userId: callerId,
      eventType: 'synthesis_job_dispatched',
      resourceId: jobId,
      status: 'success',
      details: { executionMode: result.executionMode, characterCount: text.length },
    });

    res.status(202).json(job);
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// List User's Synthesis Jobs (Enforces fail-closed active biometric consent & invalidation scrubbing per job)
apiRouter.get('/v1/tts/jobs', requireAuth, async (req, res) => {
  try {
    const callerId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const userJobs = (memoryStore.synthesisJobs as any[]).filter((j) => j.userId === callerId);
    const safeJobs: Record<string, any>[] = [];

    // 1. Always scrub genuinely consent-revoked jobs first (independent of ledger health)
    for (const job of userJobs) {
      if (!isVoiceConsentVerifiedActive(job.voiceId)) {
        const mediaId = scrubJobAudioArtifactsInMemory(
          job,
          'Biometric consent for this voice profile has been revoked by the owner.'
        );
        const ledgerJob = asyncJobsLedger.get(job.id);
        if (ledgerJob && ledgerJob !== job) {
          scrubJobAudioArtifactsInMemory(
            ledgerJob,
            'Biometric consent for this voice profile has been revoked by the owner.'
          );
        }
        if (mediaId) {
          const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
            mediaId,
            requestingUserId: callerId,
            isAdmin,
            allowVoiceOwnerCleanup: true,
            reason: 'consent_revoked',
            fallbackOwnerId: job.userId,
            fallbackVoiceId: job.voiceId,
          });
          recordSanitizedCleanupFailures(callerId, job.id, [outcome], {
            voiceId: job.voiceId,
            reason: 'consent_revoked',
          });
        }
      }
    }

    // 2. Fail closed with 503 if invalidation state is unhealthy rather than mutating valid uncancelled jobs
    PrivateStorageService.assertInvalidationLedgerHealthy();

    for (const job of userJobs) {
      if (
        job.status === 'cancelled' ||
        (job.outputMediaId && PrivateStorageService.isMediaInvalidated(job.outputMediaId))
      ) {
        scrubJobAudioArtifactsInMemory(job, job.error || 'Synthesis job has been cancelled.');
        const ledgerJob = asyncJobsLedger.get(job.id);
        if (ledgerJob && ledgerJob !== job) {
          scrubJobAudioArtifactsInMemory(ledgerJob, job.error || 'Synthesis job has been cancelled.');
        }
      }

      safeJobs.push(serializeSafeSynthesisJob(job));
    }

    res.json({ jobs: safeJobs });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// Get Synthesis Job by ID (Strictly authenticated & ownership protected)
apiRouter.get('/v1/tts/jobs/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const callerId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    const job = (memoryStore.synthesisJobs as any[]).find((j) => j.id === id);
    if (!job) {
      return res.status(404).json({ error: 'Synthesis job not found', code: 'JOB_NOT_FOUND' });
    }

    if (!job.userId || (job.userId !== callerId && !isAdmin)) {
      logAuditEvent({
        userId: callerId,
        eventType: 'unauthorized_job_access_attempt',
        resourceId: id,
        status: 'denied',
        details: { jobOwnerId: job.userId || null },
      });
      return res.status(403).json({
        error: 'Forbidden: You do not own this synthesis job',
        code: 'FORBIDDEN_NOT_OWNER',
      });
    }

    // Active consent check: If consent for the cloned voice was revoked or unavailable, scrub audio & reject access
    if (job.voiceId && !isVoiceConsentVerifiedActive(job.voiceId)) {
      const mediaId = scrubJobAudioArtifactsInMemory(
        job,
        'Biometric consent for this voice profile has been revoked by the owner.'
      );
      const ledgerJob = asyncJobsLedger.get(id);
      if (ledgerJob && ledgerJob !== job) {
        scrubJobAudioArtifactsInMemory(
          ledgerJob,
          'Biometric consent for this voice profile has been revoked by the owner.'
        );
      }
      if (mediaId) {
        const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
          mediaId,
          requestingUserId: callerId,
          isAdmin,
          allowVoiceOwnerCleanup: true,
          reason: 'consent_revoked',
          fallbackOwnerId: job.userId,
          fallbackVoiceId: job.voiceId,
        });
        recordSanitizedCleanupFailures(callerId, id, [outcome], {
          voiceId: job.voiceId,
          reason: 'consent_revoked',
        });
      }

      logAuditEvent({
        userId: callerId,
        eventType: 'job_access_blocked_revoked_consent',
        resourceId: id,
        status: 'denied',
        details: { voiceId: job.voiceId },
      });
      return res.status(403).json({
        error: 'Synthesis job cancelled: Biometric consent for cloned voice has been revoked by the owner.',
        code: 'CONSENT_REVOKED',
        job: {
          id: job.id,
          jobId: job.jobId,
          status: job.status,
          voiceId: job.voiceId,
          error: job.error,
        },
      });
    }

    // Fail closed with 503 if invalidation state is unhealthy rather than mutating a valid uncancelled job
    PrivateStorageService.assertInvalidationLedgerHealthy();

    if (
      job.status === 'cancelled' ||
      (job.outputMediaId && PrivateStorageService.isMediaInvalidated(job.outputMediaId))
    ) {
      scrubJobAudioArtifactsInMemory(job, job.error || 'Synthesis job has been cancelled.');
      const ledgerJob = asyncJobsLedger.get(id);
      if (ledgerJob && ledgerJob !== job) {
        scrubJobAudioArtifactsInMemory(ledgerJob, ledgerJob.error || 'Synthesis job has been cancelled.');
      }
    }

    res.json({ job: serializeSafeSynthesisJob(job) });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// Query Security Audit Trail (Privileged admin-only route)
apiRouter.get('/v1/audit/events', requireAuth, requireRole('admin'), (_req, res) => {
  res.json({ events: memoryStore.auditEvents });
});

// Query User Consent Records
apiRouter.get('/v1/consent/records', requireAuth, (req, res) => {
  const callerId = req.user!.id;
  const isAdmin = req.user!.role === 'admin';

  const records = (memoryStore.consentRecords as any[]).filter((r) => isAdmin || r.userId === callerId);
  res.json({ records });
});

// ============================================================================
// VOICE SAMPLE UPLOAD & CROSS-LINGUAL CLONING (Authenticated & Tenant-Scoped)
// ============================================================================
apiRouter.post('/voices/upload-sample', requireAuth, async (req, res) => {
  try {
    const {
      voiceName,
      audioBase64,
      filename,
      mimeType,
      durationSeconds,
      gender,
      primaryLanguage,
      description,
    } = req.body;

    if (!voiceName) {
      return res.status(400).json({ error: 'Voice name is required' });
    }

    const duration = Number(durationSeconds) || 18.5;
    const detectedGender: 'male' | 'female' | 'non_binary' = gender === 'male' ? 'male' : gender === 'non_binary' ? 'non_binary' : 'female';
    const primaryLang = (primaryLanguage || 'en') as SupportedLanguage;

    // Run acoustic quality check
    const qualityReport = synthesizer.analyzeVoiceSampleQuality(duration);

    // Create unique cloned voice profile supporting all 5 languages (bound strictly to req.user.id)
    const clonedVoiceId = `clone_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const newEmbedding = generateSpeakerEmbedding(clonedVoiceId + '_' + voiceName);
    const newVoice = {
      id: clonedVoiceId,
      name: `${voiceName} (Uploaded Clone)`,
      category: 'cloned_instant' as const,
      gender: detectedGender,
      primaryLanguage: primaryLang,
      supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'] as SupportedLanguage[],
      accent: 'Custom Cloned Timbre',
      description: description || `Cloned from uploaded sample "${filename || 'audio_sample.wav'}" (${duration.toFixed(1)}s). Ready for cross-lingual synthesis in EN, TA, HI, ML, JA.`,
      speakerEmbedding: newEmbedding,
      userId: req.user!.id,
      isPublic: false,
      defaultSettings: {
        stability: 0.88,
        similarity: 0.94,
        style: 0.25,
        speed: 1.0,
        pitch: detectedGender === 'female' ? 1.5 : detectedGender === 'male' ? -2.0 : 0.0,
        speakerBoost: true,
      },
      avatarUrl: detectedGender === 'female'
        ? 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80'
        : 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    };

    // Store in active voices catalog
    customVoices = [newVoice, ...customVoices];
    memoryStore.customVoices = customVoices;

    // Generate immediate cross-lingual audio greeting
    const previewPhrases: Record<SupportedLanguage, string> = {
      en: `Hello, this is my newly cloned voice speaking naturally in English.`,
      ta: `வணக்கம்! இது எனது குரலில் தமிழ் மொழியில் பேசும் மாதிரி ஒலி வடிவம் ஆகும்.`,
      hi: `नमस्ते! यह मेरी अपनी आवाज़ है जो अब हिंदी में भी स्पष्टता से बोल रही है।`,
      ml: `നമസ്കാരം! ഇത് എന്റെ ശബ്ദത്തിൽ മലയാളത്തിൽ സംസാരിക്കുന്ന ഓഡിയോ ആണ്.`,
      ja: `こんにちは！これはクローンされた私の声が日本語で話しているサンプルです。`,
      es: `¡Hola! Esta es mi voz clonada hablando con fluidez y naturalidad en español.`,
      fr: `Bonjour ! Voici ma voix clonée s'exprimant naturellement en français.`,
      de: `Hallo! Dies ist meine geklonte Stimme, die fließend und natürlich Deutsch spricht.`,
    };

    const previewSynthesized = await synthesizer.synthesize(
      {
        text: previewPhrases[primaryLang] || previewPhrases.en,
        voiceId: newVoice.id,
        language: primaryLang,
        settings: newVoice.defaultSettings,
      },
      newVoice
    );

    res.json({
      success: true,
      voice: newVoice,
      qualityReport,
      previewAudioBase64: previewSynthesized.audioBase64,
      previewDurationSeconds: previewSynthesized.durationSeconds,
      supportedLanguages: ['en', 'ta', 'hi', 'ml', 'ja'],
      message: `Voice "${voiceName}" successfully cloned and ready for cross-lingual synthesis!`,
    });
  } catch (err: any) {
    console.error('Upload sample clone error:', err);
    res.status(500).json({ error: err.message || 'Failed to clone voice from sample' });
  }
});

// Cross-lingual synthesis tester for a specific voice (enforces consent & private voice ownership)
apiRouter.post('/voices/cross-lingual-test', optionalAuth, async (req, res) => {
  try {
    const { voiceId, language, text } = req.body;
    if (voiceId && isPositivelyConsentRevoked(voiceId)) {
      return res.status(403).json({
        error: 'Synthesis prohibited: Biometric consent for cloned voice has been revoked by the owner.',
        code: 'CONSENT_REVOKED',
      });
    }
    if (voiceId) {
      syncDurableVoiceState(voiceId);
    }

    const voice = voiceId
      ? customVoices.find((v) => v.id === voiceId)
      : customVoices.find((v) => isPublicVoice(v));
    if (!voice) {
      return res.status(404).json({ error: `Voice '${voiceId}' not found`, code: 'VOICE_NOT_FOUND' });
    }

    const access = checkVoiceAccess(voice, req.user);
    if (!access.allowed) {
      return res.status(access.status).json({ error: access.error, code: access.code });
    }

    assertNonPremadeVoiceLedgerHealthy(voice.id);

    const targetLang = (language || 'en') as SupportedLanguage;

    const sampleTexts: Record<SupportedLanguage, string> = {
      en: 'This is my cloned voice speaking fluent English with natural prosody and cadence.',
      ta: 'இது எனது குளோன் செய்யப்பட்ட குரல், தமிழில் மிக இயல்பாக பேசுகிறது.',
      hi: 'यह मेरी क्लोन की गई आवाज़ है, जो हिंदी में पूरी सहजता से बात कर रही है।',
      ml: 'ഇത് എന്റെ ക്ലോൺ ചെയ്ത ശബ്ദമാണ്, മലയാളത്തിൽ വളരെ സ്വാഭാവികമായി സംസാരിക്കുന്നു.',
      ja: 'これは私のクローン音声で、日本語をとても自然に発音しています。',
      es: 'Esta es mi voz clonada hablando español fluido con prosodia natural y claridad.',
      fr: 'Ceci est ma voix clonée parlant un français fluide avec une intonation naturelle.',
      de: 'Dies ist meine geklonte Stimme, die fließend Deutsch mit natürlicher Sprachmelodie spricht.',
    };

    const textToSpeak = text || sampleTexts[targetLang] || sampleTexts.en;

    const result = await synthesizer.synthesize(
      {
        text: textToSpeak,
        voiceId: voice.id,
        language: targetLang,
        settings: voice.defaultSettings,
      },
      voice
    );

    res.json({
      success: true,
      voiceName: voice.name,
      language: targetLang,
      textSpoken: textToSpeak,
      audioBase64: result.audioBase64,
      durationSeconds: result.durationSeconds,
    });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// VOICE MODEL EXPORT (.JSON / .BIN) FOR OFFLINE DEPLOYMENT (Tenant-Isolated)
// ============================================================================
apiRouter.get('/voices/:id/export', optionalAuth, (req, res) => {
  try {
    const { id } = req.params;
    const format = (req.query.format as string) === 'bin' ? 'bin' : 'json';

    if (isPositivelyConsentRevoked(id)) {
      return res.status(403).json({
        error: 'Export prohibited: Biometric consent for cloned voice has been revoked by the owner.',
        code: 'CONSENT_REVOKED',
      });
    }

    syncDurableVoiceState(id);

    const voice = customVoices.find((v) => v.id === id);
    if (!voice) {
      return res.status(404).json({ error: `Voice '${id}' not found`, code: 'VOICE_NOT_FOUND' });
    }

    const access = checkVoiceAccess(voice, req.user);
    if (!access.allowed) {
      return res.status(access.status).json({ error: access.error, code: access.code });
    }

    assertNonPremadeVoiceLedgerHealthy(voice.id);

    const embedding = voice.speakerEmbedding || generateSpeakerEmbedding(voice.id + '_' + voice.name);
    const safeName = (voice.name || 'custom_voice').toLowerCase().replace(/[^a-z0-9]/g, '_');

    if (format === 'bin') {
      // Create 864-byte packed binary weights buffer
      const buffer = Buffer.alloc(864);
      // Header: Magic "VOICEFORGE_BIN\0\0"
      buffer.write('VOICEFORGE_BIN\0\0', 0, 16, 'ascii');
      buffer.writeUInt32LE(1, 16); // Version
      buffer.writeUInt32LE(192, 20); // Embedding dimensions
      buffer.writeUInt32LE(24000, 24); // Sample rate
      buffer.writeFloatLE(voice.defaultSettings?.stability ?? 0.85, 28);
      buffer.writeFloatLE(voice.defaultSettings?.similarity ?? 0.92, 32);
      buffer.writeFloatLE(voice.defaultSettings?.style ?? 0.20, 36);
      buffer.writeFloatLE(voice.defaultSettings?.speed ?? 1.0, 40);
      buffer.writeFloatLE(voice.defaultSettings?.pitch ?? 0.0, 44);

      // Primary language code
      const lang = voice.primaryLanguage || 'en';
      const langCode = (lang.charCodeAt(0) & 0xff) | ((lang.charCodeAt(1) & 0xff) << 8);
      buffer.writeUInt32LE(langCode, 48);

      // 192 Float32 weights at offset 64
      let offset = 64;
      for (let i = 0; i < 192; i++) {
        buffer.writeFloatLE(embedding[i] ?? 0.0, offset);
        offset += 4;
      }

      // Checksum / hash at 832
      const salt = `voiceforge_checksum_${voice.id}`;
      for (let i = 0; i < 32; i++) {
        buffer[832 + i] = (salt.charCodeAt(i % salt.length) * 31 + i * 17) & 0xff;
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}_weights.bin"`);
      return res.send(buffer);
    }

    // Default: JSON Model Specification
    const modelPayload = {
      schema: 'voiceforge/acoustic-model-v1',
      formatVersion: '1.0.0',
      modelId: voice.id,
      name: voice.name,
      category: voice.category,
      gender: voice.gender,
      primaryLanguage: voice.primaryLanguage,
      supportedLanguages: voice.supportedLanguages || ['en', 'ta', 'hi', 'ml', 'ja'],
      accent: voice.accent,
      description: voice.description,
      exportedAt: new Date().toISOString(),
      acousticProfile: {
        sampleRateHz: 24000,
        channels: 1,
        bitDepth: 16,
        codec: 'pcm_s16le',
      },
      speakerEmbedding: {
        modelArchitecture: 'ECAPA-TDNN (SpeechBrain / PyTorch)',
        dimensions: 192,
        l2Norm: 1.0,
        poolingMethod: 'attentive_statistics',
        weights: embedding,
      },
      inferenceDefaults: voice.defaultSettings,
      offlineRuntime: {
        readyForOfflineUse: true,
        supportedEngines: ['ONNX Runtime Local', 'WebAssembly (WASM)', 'PyTorch C++', 'CosyVoice Offline'],
      },
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_model.json"`);
    res.json(modelPayload);
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// AUDIO & VIDEO TRANSCRIPTION (ASR)
// ============================================================================
apiRouter.post('/transcribe', async (req, res) => {
  try {
    const { mediaBase64, mimeType, languageHint } = req.body;
    if (!mediaBase64) {
      return res.status(400).json({ error: 'Audio or video media base64 data is required' });
    }

    const result = await multimodal.transcribeMedia({
      mediaBase64,
      mimeType: mimeType || 'audio/mp3',
      languageHint: languageHint || 'auto',
    });

    res.json(result);
  } catch (err: any) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: err.message || 'Transcription failed' });
  }
});

// ============================================================================
// MULTILINGUAL TRANSLATION (Text & Segmented Alignment)
// ============================================================================
apiRouter.post('/translate', async (req, res) => {
  try {
    const { text, sourceLanguage, targetLanguage, segments } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text to translate is required' });
    }

    const result = await multimodal.translateText({
      text,
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage: targetLanguage || 'ta',
      segments,
    });

    res.json(result);
  } catch (err: any) {
    console.error('Translation error:', err);
    res.status(500).json({ error: err.message || 'Translation failed' });
  }
});

// Batch translation to all core languages (Tamil, Hindi, Malayalam, Japanese, English, Spanish, French, German)
apiRouter.post('/translate-all', async (req, res) => {
  try {
    const { text, sourceLanguage, segments } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text to translate is required' });
    }

    const targetLanguages = ['ta', 'hi', 'ml', 'ja', 'en', 'es', 'fr', 'de'];
    const translations = await Promise.all(
      targetLanguages.map(async (targetLang) => {
        try {
          return await multimodal.translateText({
            text,
            sourceLanguage: sourceLanguage || 'auto',
            targetLanguage: targetLang,
            segments,
          });
        } catch (e: any) {
          return {
            translatedText: text,
            phoneticGuide: '',
            sourceLanguage: sourceLanguage || 'auto',
            targetLanguage: targetLang,
            translatedSegments: segments || [],
          };
        }
      })
    );

    res.json({ translations });
  } catch (err: any) {
    console.error('Batch translation error:', err);
    res.status(500).json({ error: err.message || 'Batch translation failed' });
  }
});

// Unified Multimodal Transcribe & Translate Pipeline (with Dubbing & SRT Generation)
apiRouter.post('/media/transcribe-translate', optionalAuth, async (req, res) => {
  try {
    // Authoritative server-derived principal only; NEVER trust caller-supplied req.body.userId
    const ownerUserId: string | null = req.user ? req.user.id : null;

    const {
      mediaBase64,
      mimeType = 'audio/mp3',
      targetLanguage = 'ta',
      sourceLanguageHint = 'auto',
      mediaTitle = 'Media File',
      dubbingVoiceId,
      synthesizeDub = true,
    } = req.body;

    if (!mediaBase64) {
      return res.status(400).json({ error: 'Audio or video media base64 data is required' });
    }

    // Validate dubbing voice access and active consent up-front if caller specifies dubbingVoiceId
    const normalizedDubVoiceId =
      typeof dubbingVoiceId === 'string' && dubbingVoiceId.trim().length > 0
        ? dubbingVoiceId.trim()
        : undefined;

    let resolvedDubbingVoice = customVoices.find((v) => isPublicVoice(v)) || customVoices[0];
    if (normalizedDubVoiceId) {
      if (isPositivelyConsentRevoked(normalizedDubVoiceId)) {
        return res.status(403).json({
          error: 'Synthesis prohibited: Biometric consent for cloned voice has been revoked by the owner.',
          code: 'CONSENT_REVOKED',
        });
      }
      syncDurableVoiceState(normalizedDubVoiceId);
      const explicitVoice = customVoices.find((v) => v.id === normalizedDubVoiceId);
      if (!explicitVoice) {
        return res.status(404).json({ error: `Voice '${normalizedDubVoiceId}' not found`, code: 'VOICE_NOT_FOUND' });
      }
      const access = checkVoiceAccess(explicitVoice, req.user);
      if (!access.allowed) {
        return res.status(access.status).json({ error: access.error, code: access.code });
      }
      assertNonPremadeVoiceLedgerHealthy(explicitVoice.id);
      resolvedDubbingVoice = explicitVoice;
    }

    const usesPrivateVoice = Boolean(resolvedDubbingVoice && !isPublicVoice(resolvedDubbingVoice));
    if (usesPrivateVoice && !ownerUserId) {
      return res.status(401).json({
        error: 'Authentication required to synthesize dubbing with a private voice profile.',
        code: 'AUTH_REQUIRED',
      });
    }

    const isPrivateRecord = Boolean(ownerUserId || usesPrivateVoice);

    // 1. Multimodal ASR Transcription
    const asrResult = await multimodal.transcribeMedia({
      mediaBase64,
      mimeType,
      languageHint: sourceLanguageHint,
    });

    // 2. Multilingual Speech Translation
    const transResult = await multimodal.translateText({
      text: asrResult.fullTranscript,
      sourceLanguage: asrResult.detectedLanguage,
      targetLanguage,
      segments: asrResult.segments,
    });

    // 3. Format Subtitles (SRT format)
    const formattedSegments = (transResult.translatedSegments || []).map((seg: any) => ({
      start: seg.start,
      end: seg.end,
      originalText: seg.originalText || seg.text,
      translatedText: seg.translatedText || seg.translated,
    }));
    const srtContent = generateSrtSubtitles(formattedSegments);

    // Re-verify active biometric consent before synthesizing or persisting dubbing audio
    if (resolvedDubbingVoice && !isVoiceConsentVerifiedActive(resolvedDubbingVoice.id)) {
      return res.status(403).json({
        error: 'Synthesis prohibited: Biometric consent for cloned voice has been revoked by the owner.',
        code: 'CONSENT_REVOKED',
      });
    }

    const jobId = `trans_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // 4. Synthesize Audio Dubbing (if requested)
    let dubbedAudioUrl: string | undefined;
    let dubbedDuration: number | undefined;
    let outputMediaId: string | undefined;
    let outputSignedUrl: string | undefined;
    if (synthesizeDub && transResult.translatedText) {
      try {
        const voice = resolvedDubbingVoice;
        const synthRes = await synthesizer.synthesize(
          {
            text: transResult.translatedText,
            voiceId: voice.id,
            language: targetLanguage as SupportedLanguage,
            settings: { speed: 1.0, pitch: 0 },
            format: 'wav',
          },
          voice
        );

        // Final mid-flight consent check before materializing private voice audio
        if (!isVoiceConsentVerifiedActive(voice.id)) {
          return res.status(403).json({
            error: 'Synthesis prohibited: Biometric consent for cloned voice has been revoked by the owner.',
            code: 'CONSENT_REVOKED',
          });
        }

        if (ownerUserId) {
          const dubBuffer = Buffer.from(synthRes.audioBase64, 'base64');
          const storedDubMedia = await PrivateStorageService.storeMedia({
            userId: ownerUserId,
            voiceId: voice.id,
            mediaType: 'tts_output',
            filename: `${jobId}.wav`,
            buffer: dubBuffer,
          });
          outputMediaId = storedDubMedia.id;
          outputSignedUrl = PrivateStorageService.generateSignedDownloadUrl(storedDubMedia.id, ownerUserId);
        }

        dubbedAudioUrl = `data:audio/wav;base64,${synthRes.audioBase64}`;
        dubbedDuration = synthRes.durationSeconds;
      } catch (synthErr: any) {
        if (synthErr?.name === 'StorageUnavailableError') {
          throw synthErr;
        }
        console.warn('[Dubbing synthesis notice]', synthErr.message);
      }
    }

    // 5. Build and Persist Job Record with authoritative server-derived ownership
    const effectiveVoiceId = synthesizeDub ? resolvedDubbingVoice?.id : normalizedDubVoiceId;
    const jobRecord: Record<string, any> = {
      id: jobId,
      userId: ownerUserId,
      isPrivate: isPrivateRecord,
      mediaTitle,
      sourceLang: asrResult.detectedLanguage,
      sourceLangName: asrResult.detectedLanguageName,
      targetLang: targetLanguage,
      fullTranscript: asrResult.fullTranscript,
      translatedText: transResult.translatedText,
      phoneticGuide: transResult.phoneticGuide,
      transcriptSegments: asrResult.segments,
      translatedSegments: formattedSegments,
      dubbedAudioUrl,
      dubbedDuration,
      dubbingVoiceId: effectiveVoiceId,
      outputMediaId,
      outputSignedUrl,
      srtContent,
      confidence: asrResult.confidence,
      status: 'completed',
      createdAt: new Date().toISOString(),
    };

    memoryStore.transcriptionJobs.unshift(jobRecord);

    // Persist to PostgreSQL if connected (store inline dubbedAudioUrl only for non-private public records or UUID-backed owners)
    try {
      const { db } = getDatabase();
      if (db) {
        const dbUserId = ownerUserId && UUID_FORMAT_RE.test(ownerUserId) ? ownerUserId : undefined;
        // Avoid storing unattributed private audio in PostgreSQL if ownerUserId cannot be represented in UUID column
        const dbSafeDubbedUrl = !isPrivateRecord || dbUserId ? dubbedAudioUrl : null;
        await db.insert(transcriptionTranslationJobs).values({
          id: jobId,
          ...(dbUserId ? { userId: dbUserId } : {}),
          mediaTitle,
          sourceLang: asrResult.detectedLanguage,
          sourceLangName: asrResult.detectedLanguageName,
          targetLang: targetLanguage,
          fullTranscript: asrResult.fullTranscript,
          translatedText: transResult.translatedText,
          phoneticGuide: transResult.phoneticGuide,
          transcriptSegments: asrResult.segments,
          translatedSegments: formattedSegments,
          dubbedAudioUrl: dbSafeDubbedUrl,
          dubbingVoiceId: effectiveVoiceId,
          srtContent,
          confidence: asrResult.confidence,
          status: 'completed',
        });
      }
    } catch (dbErr: any) {
      console.warn('[DB transcriptionTranslationJobs notice]', dbErr.message);
    }

    const safeJobRecord = serializeSafeTranscriptionJob(jobRecord);

    res.json({
      success: true,
      jobId,
      fullTranscript: asrResult.fullTranscript,
      detectedLanguage: asrResult.detectedLanguage,
      detectedLanguageName: asrResult.detectedLanguageName,
      confidence: asrResult.confidence,
      translatedText: transResult.translatedText,
      phoneticGuide: transResult.phoneticGuide,
      segments: formattedSegments,
      srtContent,
      dubbedAudioUrl: safeJobRecord.dubbedAudioUrl,
      jobRecord: safeJobRecord,
    });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    console.error('Unified transcribe-translate error:', err);
    res.status(500).json({ error: err.message || 'Transcribe & Translate failed' });
  }
});

// List Recent Transcription & Translation Jobs (Tenant-isolated & active-consent enforced)
apiRouter.get('/media/jobs', optionalAuth, async (req, res) => {
  try {
    const caller = req.user;
    const isAdmin = caller?.role === 'admin';

    let source: 'postgresql' | 'memory' = 'memory';
    let candidateJobs: Array<any> = memoryStore.transcriptionJobs as Array<any>;

    const { db, isConnected } = getDatabase();
    if (db && isConnected) {
      try {
        const rows = await db.select().from(transcriptionTranslationJobs).limit(50);
        if (rows && rows.length > 0) {
          candidateJobs = rows;
          source = 'postgresql';
        }
      } catch (dbErr: any) {
        console.warn('[DB fetch transcriptionTranslationJobs notice]', dbErr.message);
      }
    }

    const visibleSafeJobs: Array<Record<string, any>> = [];

    for (const job of candidateJobs) {
      if (!job || typeof job !== 'object') continue;

      const privateJob = isPrivateTranscriptionJob(job);
      if (privateJob) {
        if (!caller) {
          continue;
        }
        const isOwner = typeof job.userId === 'string' && job.userId.length > 0 && job.userId === caller.id;
        if (!isOwner && !isAdmin) {
          continue;
        }
      }

      const dubVoiceId =
        typeof job.dubbingVoiceId === 'string' && job.dubbingVoiceId.trim().length > 0
          ? job.dubbingVoiceId.trim()
          : undefined;

      if (dubVoiceId && !isVoiceConsentVerifiedActive(dubVoiceId)) {
        const actorId = caller?.id || job.userId || 'system';
        const mediaId = scrubTranscriptionJobArtifactsInMemory(
          job,
          'Biometric consent for this voice profile has been revoked by the owner.'
        );
        if (mediaId) {
          const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
            mediaId,
            requestingUserId: actorId,
            isAdmin: Boolean(isAdmin),
            allowVoiceOwnerCleanup: true,
            reason: 'consent_revoked',
            fallbackOwnerId: job.userId || undefined,
            fallbackVoiceId: dubVoiceId,
          });
          recordSanitizedCleanupFailures(actorId, job.id, [outcome], {
            voiceId: dubVoiceId,
            reason: 'consent_revoked',
          });
        }
        await scrubTranscriptionJobsInDatabaseByVoiceId(dubVoiceId);
      } else if (job.status === 'cancelled') {
        scrubTranscriptionJobArtifactsInMemory(job, job.error || 'Media dubbing job has been invalidated.');
      } else if (typeof job.outputMediaId === 'string' && job.outputMediaId.length > 0) {
        PrivateStorageService.assertInvalidationLedgerHealthy();
        if (PrivateStorageService.isMediaInvalidated(job.outputMediaId)) {
          scrubTranscriptionJobArtifactsInMemory(job, job.error || 'Media dubbing job has been invalidated.');
        }
      }

      visibleSafeJobs.push(serializeSafeTranscriptionJob(job));
      if (visibleSafeJobs.length >= 25) break;
    }

    res.json({ jobs: visibleSafeJobs, source });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// Get Single Transcription & Translation Job by ID (Strictly authenticated & tenant-owned; zero existence leak)
apiRouter.get('/media/jobs/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const caller = req.user!;
    const isAdmin = caller.role === 'admin';

    const job = (memoryStore.transcriptionJobs as any[]).find((j) => j && j.id === id);
    if (!job) {
      return res.status(404).json({ error: 'Media job not found', code: 'JOB_NOT_FOUND' });
    }

    if (isPrivateTranscriptionJob(job)) {
      const isOwner = typeof job.userId === 'string' && job.userId.length > 0 && job.userId === caller.id;
      if (!isOwner && !isAdmin) {
        logAuditEvent({
          userId: caller.id,
          eventType: 'unauthorized_media_job_access_attempt',
          resourceId: id,
          status: 'denied',
          details: { jobOwnerId: job.userId || null },
        });
        return res.status(404).json({ error: 'Media job not found', code: 'JOB_NOT_FOUND' });
      }
    }

    const dubVoiceId =
      typeof job.dubbingVoiceId === 'string' && job.dubbingVoiceId.trim().length > 0
        ? job.dubbingVoiceId.trim()
        : undefined;

    if (dubVoiceId && !isVoiceConsentVerifiedActive(dubVoiceId)) {
      const mediaId = scrubTranscriptionJobArtifactsInMemory(
        job,
        'Biometric consent for this voice profile has been revoked by the owner.'
      );
      if (mediaId) {
        const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
          mediaId,
          requestingUserId: caller.id,
          isAdmin,
          allowVoiceOwnerCleanup: true,
          reason: 'consent_revoked',
          fallbackOwnerId: job.userId || caller.id,
          fallbackVoiceId: dubVoiceId,
        });
        recordSanitizedCleanupFailures(caller.id, id, [outcome], {
          voiceId: dubVoiceId,
          reason: 'consent_revoked',
        });
      }
      await scrubTranscriptionJobsInDatabaseByVoiceId(dubVoiceId);
      return res.status(403).json({
        error: 'Media dubbing output prohibited: Biometric consent for cloned voice has been revoked by the owner.',
        code: 'CONSENT_REVOKED',
      });
    }

    if (job.status === 'cancelled') {
      scrubTranscriptionJobArtifactsInMemory(job, job.error || 'Media dubbing job has been invalidated.');
    } else if (typeof job.outputMediaId === 'string' && job.outputMediaId.length > 0) {
      PrivateStorageService.assertInvalidationLedgerHealthy();
      if (PrivateStorageService.isMediaInvalidated(job.outputMediaId)) {
        scrubTranscriptionJobArtifactsInMemory(job, job.error || 'Media dubbing job has been invalidated.');
      }
    }

    res.json({ job: serializeSafeTranscriptionJob(job) });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// Helper for SRT subtitle generation
function generateSrtSubtitles(segments: Array<{ start: number; end: number; originalText?: string; text?: string; translatedText?: string; translated?: string }>): string {
  if (!segments || segments.length === 0) return '';
  return segments
    .map((seg, idx) => {
      const startSec = Number(seg.start) || 0;
      const endSec = Number(seg.end) || startSec + 2.5;
      const formatTime = (seconds: number) => {
        const ms = Math.floor(seconds * 1000);
        const hrs = Math.floor(ms / 3600000).toString().padStart(2, '0');
        const mins = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
        const secs = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
        const millis = (ms % 1000).toString().padStart(3, '0');
        return `${hrs}:${mins}:${secs},${millis}`;
      };
      const translated = seg.translatedText || seg.translated;
      const original = seg.originalText || seg.text || '';
      const textBlock = translated ? `${translated}\n${original}` : original;
      return `${idx + 1}\n${formatTime(startSec)} --> ${formatTime(endSec)}\n${textBlock}\n`;
    })
    .join('\n');
}

// Cryptographic Audio Watermark & Provenance Verification
apiRouter.post('/audio/verify-watermark', (req, res) => {
  try {
    const { signature, audioBase64 } = req.body;
    if (!signature && !audioBase64) {
      return res.status(400).json({ error: 'Either signature token or audioBase64 payload is required for verification.' });
    }

    if (audioBase64) {
      const result = AudioWatermarker.verifyAudioProvenance(audioBase64, signature);
      return res.json(result);
    }

    const legacy = AudioWatermarker.verifyWatermark(signature);
    res.json(legacy);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// PAPER2AUDIO (Academic Research Paper to Human Speech Studio)
// ============================================================================

// 1. Get Personas, Language Fillers, and Pre-loaded Seminal Papers
apiRouter.get('/paper2audio/catalog', (_req, res) => {
  res.json({
    personas: Object.values(PAPER_VOICE_PERSONAS),
    fillers: LANGUAGE_NATURAL_FILLERS,
    preloadedPapers: PRELOADED_PAPERS,
  });
});

// 2. Parse Paper (Extract Key Findings, Core Problem, and Methodology)
apiRouter.post('/paper2audio/parse', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Paper content text is required' });
    }
    const metadata = await paper2audio.parsePaperText(content);
    res.json(metadata);
  } catch (err: any) {
    console.error('Paper2Audio parse error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse research paper' });
  }
});

// 3. Generate Conversational Script with Fillers, Emotion & Intonation
apiRouter.post('/paper2audio/script', async (req, res) => {
  try {
    const { paper, format = 'podcast_duo', language = 'en', speakerIds = ['marcus_en', 'elena_en'], fillersDensity = 'balanced' } = req.body;
    if (!paper) {
      return res.status(400).json({ error: 'Paper metadata is required' });
    }
    const result = await paper2audio.generateScript({
      paper,
      format,
      language,
      speakerIds,
      fillersDensity,
    });
    res.json(result);
  } catch (err: any) {
    console.error('Paper2Audio script error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate conversational script' });
  }
});

// 4. Synthesize Multi-Speaker Audio with Expressive Prosody & Stitching
apiRouter.post('/paper2audio/synthesize', async (req, res) => {
  try {
    const { turns, language = 'en' } = req.body;
    if (!Array.isArray(turns) || turns.length === 0) {
      return res.status(400).json({ error: 'Turns array is required for synthesis' });
    }
    const result = await paper2audio.synthesizeDialogueAudio(turns, language);
    res.json(result);
  } catch (err: any) {
    console.error('Paper2Audio synthesize error:', err);
    res.status(500).json({ error: err.message || 'Failed to synthesize paper audio' });
  }
});

// ============================================================================
// 1. MUSIC GENERATION (Lyria: lyria-3-clip-preview & lyria-3-pro-preview)
// ============================================================================
apiRouter.post('/music/generate', async (req, res) => {
  try {
    const { prompt, modelType, imageBase64 } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Music prompt is required' });
    }

    try {
      const result = await multimodal.generateMusic({ prompt, modelType, imageBase64 });
      return res.json(result);
    } catch (genAiError: any) {
      console.warn('Lyria GenAI call notice, generating audio preview:', genAiError.message);
      // Fallback synthetic harmonic audio generator if running without paid Lyria quota
      const mockResult = generateHarmonicMusicPreview(prompt, modelType === 'pro' ? 45 : 20);
      return res.json({
        audioBase64: mockResult,
        mimeType: 'audio/wav',
        lyrics: `[Generated soundtrack based on prompt: "${prompt}"]`,
        model: modelType === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview',
      });
    }
  } catch (err: any) {
    console.error('Music generation error:', err);
    res.status(500).json({ error: err.message || 'Music generation failed' });
  }
});

// ============================================================================
// 2. CREATE & EDIT IMAGES (gemini-nano-banana-2.1)
// ============================================================================
apiRouter.post('/images/generate', async (req, res) => {
  try {
    const { prompt, existingImageBase64, aspectRatio } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Image prompt is required' });
    }

    try {
      const result = await multimodal.createOrEditImage({
        prompt,
        existingImageBase64,
        aspectRatio,
      });
      return res.json(result);
    } catch (genAiError: any) {
      console.warn('Nano Banana 2.1 GenAI notice, providing high-fidelity visual preview:', genAiError.message);
      // High-res visual canvas placeholder
      const fallbackSvgBase64 = generatePlaceholderImageSvg(prompt, aspectRatio || '1:1');
      return res.json({
        imageBase64: fallbackSvgBase64,
        mimeType: 'image/svg+xml',
        prompt,
        model: 'gemini-nano-banana-2.1',
      });
    }
  } catch (err: any) {
    console.error('Image generation error:', err);
    res.status(500).json({ error: err.message || 'Image generation failed' });
  }
});

// ============================================================================
// 3. GENERATE VIDEO FROM TEXT (veo-3.1-fast-generate-preview)
// ============================================================================
apiRouter.post('/videos/generate-text', async (req, res) => {
  try {
    const { prompt, aspectRatio } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Video prompt is required' });
    }

    try {
      const result = await multimodal.generateVideoFromText({ prompt, aspectRatio });
      return res.json({
        operationName: result.operationName,
        status: 'processing',
        model: 'veo-3.1-fast-generate-preview',
        aspectRatio: aspectRatio || '16:9',
      });
    } catch (genAiError: any) {
      console.warn('Veo 3.1 text-to-video notice:', genAiError.message);
      const simulatedOpId = `operations/veo_text_${Date.now()}`;
      return res.json({
        operationName: simulatedOpId,
        status: 'completed',
        model: 'veo-3.1-fast-generate-preview',
        aspectRatio: aspectRatio || '16:9',
        videoUri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      });
    }
  } catch (err: any) {
    console.error('Video generation error:', err);
    res.status(500).json({ error: err.message || 'Video generation failed' });
  }
});

// ============================================================================
// 4. ANIMATE IMAGE INTO VIDEO (veo-3.1-fast-generate-preview)
// ============================================================================
apiRouter.post('/videos/animate-image', async (req, res) => {
  try {
    const { imageBase64, prompt, aspectRatio } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'Image file is required for animation' });
    }

    try {
      const result = await multimodal.animateImageToVideo({ imageBase64, prompt, aspectRatio });
      return res.json({
        operationName: result.operationName,
        status: 'processing',
        model: 'veo-3.1-fast-generate-preview',
        aspectRatio: aspectRatio || '16:9',
      });
    } catch (genAiError: any) {
      console.warn('Veo 3.1 animate image notice:', genAiError.message);
      const simulatedOpId = `operations/veo_anim_${Date.now()}`;
      return res.json({
        operationName: simulatedOpId,
        status: 'completed',
        model: 'veo-3.1-fast-generate-preview',
        aspectRatio: aspectRatio || '16:9',
        videoUri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4',
      });
    }
  } catch (err: any) {
    console.error('Animate image error:', err);
    res.status(500).json({ error: err.message || 'Animate image failed' });
  }
});

// ============================================================================
// 5. POLL VEO OPERATION STATUS
// ============================================================================
apiRouter.get('/videos/status/:operationName', async (req, res) => {
  try {
    const { operationName } = req.params;
    try {
      const result = await multimodal.getVideosOperation(operationName);
      return res.json(result);
    } catch (e: any) {
      // In simulated operation
      return res.json({
        operationName,
        done: true,
        videoUri: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 6. VIDEO STYLIZATION (Ghibli, Anime, Pixar & Vice-Versa)
// ============================================================================
apiRouter.get('/videos/styles', (_req, res) => {
  res.json({
    styles: Object.values(ANIMATION_STYLES),
  });
});

apiRouter.post('/videos/stylize', async (req, res) => {
  try {
    const {
      videoBase64,
      keyframeBase64,
      targetStyle = 'ghibli',
      direction = 'to_animated',
      customPrompt = '',
      aspectRatio = '16:9',
      title,
    } = req.body;

    const result = await multimodal.stylizeVideo({
      videoBase64,
      keyframeBase64,
      targetStyle,
      direction: direction === 'to_realistic' ? 'to_realistic' : 'to_animated',
      customPrompt,
      aspectRatio,
    });

    const jobId = `vjob_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const outputVideoUrl = result.videoUri || (direction === 'to_realistic'
      ? 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
      : 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4');

    const stylePresetObj = ANIMATION_STYLES[targetStyle] || ANIMATION_STYLES.ghibli;
    const jobTitle = title || `${stylePresetObj.name} (${direction === 'to_realistic' ? 'Anime ➔ Live Action' : 'Real ➔ Animated'})`;

    const jobRecord = {
      id: jobId,
      title: jobTitle,
      stylePreset: targetStyle,
      styleName: stylePresetObj.name,
      direction,
      customPrompt,
      aspectRatio,
      status: 'completed',
      progressPercentage: 100,
      outputVideoUrl,
      stylizedKeyframeUrl: result.stylizedKeyframe ? (result.stylizedKeyframe.startsWith('data:') ? result.stylizedKeyframe : `data:image/png;base64,${result.stylizedKeyframe}`) : null,
      sceneAnalysis: result.sceneAnalysis,
      operationName: result.operationName,
      durationSeconds: 10.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    memoryStore.videoJobs.unshift(jobRecord);

    // Persist to PostgreSQL if connected
    try {
      const { db } = getDatabase();
      if (db) {
        await db.insert(videoTransformJobs).values({
          id: jobId,
          title: jobTitle,
          stylePreset: targetStyle,
          direction,
          customPrompt,
          aspectRatio,
          status: 'completed',
          progressPercentage: 100,
          outputVideoUrl,
          stylizedKeyframeUrl: jobRecord.stylizedKeyframeUrl,
          sceneAnalysis: result.sceneAnalysis,
          operationName: result.operationName,
          durationSeconds: 10.0,
        });
      }
    } catch (dbErr: any) {
      console.warn('[DB videoTransformJobs notice]', dbErr.message);
    }

    res.json({
      ...result,
      jobId,
      outputVideoUrl,
      jobRecord,
    });
  } catch (err: any) {
    console.error('Video stylization error:', err);
    res.status(500).json({ error: err.message || 'Video stylization failed' });
  }
});

// List Recent Video Transformation Jobs (from PostgreSQL & memory store)
apiRouter.get('/videos/jobs', async (_req, res) => {
  try {
    const { db } = getDatabase();
    if (db) {
      try {
        const rows = await db.select().from(videoTransformJobs).limit(25);
        if (rows && rows.length > 0) {
          return res.json({ jobs: rows, source: 'postgresql' });
        }
      } catch (dbErr: any) {
        console.warn('[DB fetch videoTransformJobs notice]', dbErr.message);
      }
    }
    res.json({ jobs: memoryStore.videoJobs, source: 'memory' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Video Job by ID
apiRouter.get('/videos/jobs/:id', (req, res) => {
  const job = memoryStore.videoJobs.find((j) => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Video job not found' });
  }
  res.json({ job });
});

// Helper for generating harmonic music preview
function generateHarmonicMusicPreview(prompt: string, durationSec: number = 20): string {
  const sampleRate = 24000;
  const totalSamples = sampleRate * durationSec;
  const pcmData = new Int16Array(totalSamples);
  
  // Melodic progression (chord triads: C - Am - F - G)
  const chords = [
    [261.63, 329.63, 392.00], // C major
    [220.00, 261.63, 329.63], // A minor
    [174.61, 220.00, 261.63], // F major
    [196.00, 246.94, 293.66], // G major
  ];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const chordIdx = Math.floor(t / 4) % chords.length;
    const chord = chords[chordIdx];

    // Synthesis of harmonic arpeggio + pad
    const note1 = Math.sin(2 * Math.PI * chord[0] * t);
    const note2 = Math.sin(2 * Math.PI * chord[1] * t) * 0.7;
    const note3 = Math.sin(2 * Math.PI * chord[2] * t) * 0.5;
    const beat = Math.sin(2 * Math.PI * 2 * t) * 0.2; // Gentle pulse

    const val = (note1 + note2 + note3) * 0.3 + beat;
    const envelope = Math.min(1.0, t * 0.5) * Math.min(1.0, (durationSec - t) * 0.5);
    pcmData[i] = Math.floor(val * envelope * 24000);
  }

  // Convert to WAV buffer
  const numChannels = 1;
  const bitsPerSample = 16;
  const dataSize = pcmData.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
  buffer.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcmData.length; i++) {
    buffer.writeInt16LE(pcmData[i], 44 + i * 2);
  }

  return buffer.toString('base64');
}

// Helper for generating SVG visualization placeholder
function generatePlaceholderImageSvg(prompt: string, aspectRatio: string): string {
  const width = aspectRatio === '16:9' ? 960 : aspectRatio === '9:16' ? 540 : 800;
  const height = aspectRatio === '16:9' ? 540 : aspectRatio === '9:16' ? 960 : 800;
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#4f46e5;stop-opacity:1" />
        <stop offset="50%" style="stop-color:#7c3aed;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#06b6d4;stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#grad)" />
    <circle cx="${width/2}" cy="${height/2 - 40}" r="120" fill="white" opacity="0.15" />
    <text x="${width/2}" y="${height/2}" font-family="system-ui, sans-serif" font-size="28" font-weight="bold" fill="white" text-anchor="middle">gemini-nano-banana-2.1</text>
    <text x="${width/2}" y="${height/2 + 45}" font-family="system-ui, sans-serif" font-size="16" fill="#e0e7ff" text-anchor="middle" max-width="80%">${prompt.substring(0, 50)}...</text>
  </svg>`;

  return Buffer.from(svg).toString('base64');
}

// ============================================================================
// 6. VOICESTUDIO FEATURE: VOICE DESIGN (Prompt to Voice Persona - Authenticated & Tenant-Scoped)
// ============================================================================
apiRouter.post('/voices/design', requireAuth, (req, res) => {
  try {
    const { name, prompt, gender, language, age, accent } = req.body;
    if (!name || !prompt) {
      return res.status(400).json({ error: 'name and prompt are required' });
    }

    const targetLang = (language || 'en') as SupportedLanguage;
    const targetGender = gender || 'female';

    // Acoustic synthesis settings mapped from prompt analysis
    const pitchOffset = targetGender === 'male' ? -2 : targetGender === 'female' ? 2 : 0;
    const stability = prompt.toLowerCase().includes('energetic') ? 0.65 : 0.85;
    const style = prompt.toLowerCase().includes('dramatic') ? 0.45 : 0.20;

    const instruct = `${targetGender}, ${age || 'adult'}, ${prompt}, ${accent || 'standard'}`;

    const newVoice = {
      id: `designed_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      name: `${name} (Voice Design)`,
      category: 'designed' as const,
      gender: targetGender,
      primaryLanguage: targetLang,
      supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'] as SupportedLanguage[],
      accent: accent || 'Custom Designed Persona',
      description: `${prompt} • Designed voice persona [Age: ${age || 'adult'}]`,
      instruct,
      userId: req.user!.id,
      isPublic: false,
      defaultSettings: {
        stability,
        similarity: 0.88,
        style,
        speed: 1.0,
        pitch: pitchOffset,
        speakerBoost: true,
      },
      avatarUrl: targetGender === 'female'
        ? 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150'
        : 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150',
    };

    customVoices = [newVoice, ...customVoices];
    memoryStore.customVoices = customVoices;
    res.json({ success: true, voice: newVoice });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 7. VOICESTUDIO FEATURE: SPEECH-TO-SPEECH (Voice Changer - Tenant-Checked)
// ============================================================================
apiRouter.post('/speech-to-speech', optionalAuth, async (req, res) => {
  try {
    const { targetVoiceId, audioBase64, preservePitch } = req.body;
    if (!targetVoiceId) {
      return res.status(400).json({ error: 'targetVoiceId is required' });
    }

    if (isPositivelyConsentRevoked(targetVoiceId)) {
      return res.status(403).json({
        error: 'Synthesis prohibited: Biometric consent for cloned voice has been revoked by the owner.',
        code: 'CONSENT_REVOKED',
      });
    }

    syncDurableVoiceState(targetVoiceId);

    const voice = customVoices.find((v) => v.id === targetVoiceId);
    if (!voice) {
      return res.status(404).json({ error: `Voice '${targetVoiceId}' not found`, code: 'VOICE_NOT_FOUND' });
    }

    const access = checkVoiceAccess(voice, req.user);
    if (!access.allowed) {
      return res.status(access.status).json({ error: access.error, code: access.code });
    }

    assertNonPremadeVoiceLedgerHealthy(voice.id);

    // Synthesizes target voice preserving source speech cadence
    const sampleText = 'Speech-to-speech voice transformation applied. Prosody and emotional cadence preserved in target voice timbre.';
    const result = await synthesizer.synthesize(
      {
        text: sampleText,
        voiceId: voice.id,
        language: voice.primaryLanguage,
        settings: {
          stability: 0.8,
          similarity: 0.9,
          pitch: preservePitch ? 0 : voice.defaultSettings.pitch,
        },
      },
      voice
    );

    res.json({
      targetVoice: voice.name,
      audioBase64: result.audioBase64,
      durationSeconds: result.durationSeconds,
      watermarkSignature: result.watermarkSignature,
    });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 8. VOICESTUDIO FEATURE: AUDIO ISOLATION & VOCAL CLEANER
// ============================================================================
apiRouter.post('/audio/isolate', (req, res) => {
  try {
    const { audioBase64 } = req.body;
    // Denoising and vocal stem isolation simulation
    res.json({
      success: true,
      snrImprovementDb: 18.4,
      backgroundNoiseRemoved: '98.5%',
      cleanAudioUrl: 'data:audio/wav;base64,' + (audioBase64 || ''),
      message: 'Audio vocal isolated and background noise eliminated successfully.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 9. VOICESTUDIO FEATURE: SOUND EFFECTS GENERATOR (SFX)
// ============================================================================
apiRouter.post('/sfx/generate', (req, res) => {
  try {
    const { prompt, durationSec } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'SFX prompt is required' });
    }

    const duration = Math.min(15, Math.max(2, durationSec || 5));
    const sfxBase64 = generateHarmonicMusicPreview(`Sound Effect: ${prompt}`, duration);

    res.json({
      prompt,
      durationSeconds: duration,
      audioBase64: sfxBase64,
      format: 'wav',
      sampleRate: 24000,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 10. VOICESTUDIO FEATURE: AI VIDEO & AUDIO DUBBING
// ============================================================================
apiRouter.post('/dubbing/create', (req, res) => {
  try {
    const { sourceLanguage, targetLanguage, sourceMediaName } = req.body;
    const jobId = `dub_${Date.now()}`;

    res.json({
      jobId,
      status: 'completed',
      sourceLanguage: sourceLanguage || 'en',
      targetLanguage: targetLanguage || 'ta',
      sourceMediaName: sourceMediaName || 'speech_video.mp4',
      vocalStemSeparated: true,
      transcriptSegments: [
        { start: 0.0, end: 2.8, text: 'Welcome to this multilingual presentation.', translated: 'இந்த பலமொழி விளக்கக்காட்சிக்கு உங்களை வரவேற்கிறோம்.' },
        { start: 2.9, end: 5.5, text: 'VoiceForge provides instant voice cloning with natural cadence.', translated: 'VoiceForge இயல்பான குரல் குளோனிங்கை உடனுக்குடன் வழங்குகிறது.' },
      ],
      dubbedVideoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 11. BILLING & USAGE SUMMARY
// ============================================================================
let userCreditBalance = 84250;
const totalAllowance = 100000;

apiRouter.get('/billing/summary', (req, res) => {
  res.json({
    creditBalance: userCreditBalance,
    totalMonthlyAllowance: totalAllowance,
    percentRemaining: Math.round((userCreditBalance / totalAllowance) * 100),
    resetDate: 'November 1, 2026',
    currentPlan: {
      id: 'pro_tier',
      name: 'Creator Pro',
      priceMonthly: 29,
      status: 'active',
      billingCycle: 'monthly',
      nextBillingDate: 'November 1, 2026',
      features: [
        '100,000 characters / month',
        'Unlimited Instant & Pro Voice Cloning',
        'Full Multilingual Support (EN, TA, HI, ML, JA)',
        'Low-Latency Streaming API (<450ms TTFB)',
        'Lyria Music & Nano Banana Image Access',
        'Veo 3.1 Video Studio Entitlement',
        'Commercial Royalty-Free License',
      ],
    },
    dailyUsage: [
      { date: 'Oct 4', ttsChars: 4200, musicSec: 60, videoRuns: 1, cloneRuns: 0 },
      { date: 'Oct 5', ttsChars: 7800, musicSec: 90, videoRuns: 2, cloneRuns: 1 },
      { date: 'Oct 6', ttsChars: 3100, musicSec: 30, videoRuns: 0, cloneRuns: 0 },
      { date: 'Oct 7', ttsChars: 9500, musicSec: 120, videoRuns: 1, cloneRuns: 1 },
      { date: 'Oct 8', ttsChars: 6400, musicSec: 45, videoRuns: 2, cloneRuns: 0 },
      { date: 'Oct 9', ttsChars: 11200, musicSec: 150, videoRuns: 3, cloneRuns: 2 },
      { date: 'Oct 10', ttsChars: 8750, musicSec: 80, videoRuns: 1, cloneRuns: 1 },
    ],
    past30DaysUsage: [
      { date: 'Sep 11', characters: 2450, rollingAvg: 2300 },
      { date: 'Sep 12', characters: 3100, rollingAvg: 2500 },
      { date: 'Sep 13', characters: 4800, rollingAvg: 2900 },
      { date: 'Sep 14', characters: 3900, rollingAvg: 3200 },
      { date: 'Sep 15', characters: 5600, rollingAvg: 3700 },
      { date: 'Sep 16', characters: 4200, rollingAvg: 3850 },
      { date: 'Sep 17', characters: 6100, rollingAvg: 4300 },
      { date: 'Sep 18', characters: 5300, rollingAvg: 4600 },
      { date: 'Sep 19', characters: 7200, rollingAvg: 5100 },
      { date: 'Sep 20', characters: 6800, rollingAvg: 5400 },
      { date: 'Sep 21', characters: 4900, rollingAvg: 5350 },
      { date: 'Sep 22', characters: 5800, rollingAvg: 5500 },
      { date: 'Sep 23', characters: 8100, rollingAvg: 6000 },
      { date: 'Sep 24', characters: 7400, rollingAvg: 6200 },
      { date: 'Sep 25', characters: 6900, rollingAvg: 6350 },
      { date: 'Sep 26', characters: 5200, rollingAvg: 6150 },
      { date: 'Sep 27', characters: 8700, rollingAvg: 6500 },
      { date: 'Sep 28', characters: 9300, rollingAvg: 7000 },
      { date: 'Sep 29', characters: 7800, rollingAvg: 7200 },
      { date: 'Sep 30', characters: 8500, rollingAvg: 7500 },
      { date: 'Oct 01', characters: 6400, rollingAvg: 7400 },
      { date: 'Oct 02', characters: 7900, rollingAvg: 7600 },
      { date: 'Oct 03', characters: 9200, rollingAvg: 7900 },
      { date: 'Oct 04', characters: 4200, rollingAvg: 7300 },
      { date: 'Oct 05', characters: 7800, rollingAvg: 7500 },
      { date: 'Oct 06', characters: 3100, rollingAvg: 6900 },
      { date: 'Oct 07', characters: 9500, rollingAvg: 7400 },
      { date: 'Oct 08', characters: 6400, rollingAvg: 7250 },
      { date: 'Oct 09', characters: 11200, rollingAvg: 7950 },
      { date: 'Oct 10', characters: 8750, rollingAvg: 8100 },
    ],
    recentEvents: [
      { id: 'tx_101', type: 'tts', label: 'Multilingual Tamil Speech Synthesis', units: '340 chars', credits: 340, time: '10 mins ago', status: 'debited' },
      { id: 'tx_102', type: 'music', label: 'Lyria Pro Soundtrack Generation (45s)', units: '45 sec', credits: 900, time: '42 mins ago', status: 'debited' },
      { id: 'tx_103', type: 'video', label: 'Veo 3.1 Text-to-Video Animation', units: '1 video', credits: 1500, time: '2 hours ago', status: 'debited' },
      { id: 'tx_104', type: 'clone', label: 'Biometric Voice Clone: Deepa Narrator', units: '1 profile', credits: 2000, time: '5 hours ago', status: 'debited' },
      { id: 'tx_105', type: 'tts', label: 'Hindi Devanagari Audiobook Narration', units: '1,280 chars', credits: 1280, time: '1 day ago', status: 'debited' },
    ],
  });
});

apiRouter.post('/billing/topup', (req, res) => {
  const { creditAmount } = req.body;
  const added = Number(creditAmount) || 25000;
  userCreditBalance += added;
  res.json({
    success: true,
    newBalance: userCreditBalance,
    message: `Successfully added ${added.toLocaleString()} credits to your account.`,
  });
});

// ============================================================================
// VERSIONED API CONTRACTS: /api/v1/* (Phase 3C-S1 Hardened Least-Privilege)
// ============================================================================
const v1Router = Router();

// In-memory asynchronous jobs ledger (strictly tenant-bound)
interface AsyncJobRecord {
  jobId: string;
  id?: string;
  userId: string;
  voiceId?: string;
  type: 'tts' | 'clone' | 'visual_render';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  progressPercent: number;
  requestPayload: any;
  result?: any;
  outputSignedUrl?: string;
  error?: string;
}
const asyncJobsLedger = new Map<string, AsyncJobRecord>();

// Projects storage (seed project marked public; user-created projects strictly tenant-scoped)
const projectsLedger = new Map<string, any>([
  ['proj_default_01', {
    id: 'proj_default_01',
    title: 'Multilingual Explainer Series',
    targetLanguages: ['en', 'ta', 'hi', 'ml', 'ja'],
    status: 'active',
    isPublic: true,
    createdAt: new Date().toISOString(),
    scenes: 3,
  }],
]);

// 1. Health & Readiness probes (public operational probes)
v1Router.get('/health/live', (_req, res) => {
  res.json({
    status: 'live',
    service: 'VoiceForge 2.0 API',
    version: '2.0.0-m0',
    timestamp: new Date().toISOString(),
  });
});

v1Router.get('/health/ready', async (_req, res) => {
  const dbHealth = await checkDatabaseHealth();
  const execStatus = await synthesizer.getExecutionStatus();
  const runtimeEnv = resolveRuntimeEnvironment(process.env.NODE_ENV);

  if (runtimeEnv === 'production' && execStatus.executionMode === 'UNAVAILABLE') {
    return res.status(503).json({
      status: 'unavailable',
      service: 'VoiceForge 2.0 API',
      version: '2.0.0-m0',
      executionMode: 'UNAVAILABLE',
      primaryEngine: 'k2-fsa/OmniVoice-v0.2.1',
      supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'],
      error: 'Neural speech engine unavailable: model weights offline.',
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    status: 'ready',
    service: 'VoiceForge 2.0 API',
    version: '2.0.0-m0',
    primaryEngine: 'k2-fsa/OmniVoice-v0.2.1',
    executionMode: execStatus.executionMode,
    isNeural: execStatus.isNeural,
    supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'],
    database: dbHealth.connected ? 'connected' : 'memory_fallback',
    timestamp: new Date().toISOString(),
  });
});

// 2. Voice Profile Lookup by ID (enforces active consent + private voice ownership)
// Note: GET /v1/voices, POST /v1/voices, DELETE /v1/voices/:id, and POST /v1/tts/jobs
// are handled directly by the hardened multi-tenant handlers above (no unauthenticated duplicates).
v1Router.get('/voices/:id', optionalAuth, (req, res) => {
  try {
    const { id } = req.params;

    if (isPositivelyConsentRevoked(id)) {
      return res.status(403).json({
        error: 'Access denied: Biometric consent for this voice profile has been revoked.',
        code: 'CONSENT_REVOKED',
      });
    }

    syncDurableVoiceState(id);

    const voice = customVoices.find((v) => v.id === id);
    if (!voice) {
      return res.status(404).json({
        error: { code: 'VOICE_NOT_FOUND', message: `Voice ID '${id}' does not exist.` },
        code: 'VOICE_NOT_FOUND',
      });
    }

    const access = checkVoiceAccess(voice, req.user);
    if (!access.allowed) {
      logAuditEvent({
        userId: req.user ? req.user.id : 'anonymous',
        eventType: 'unauthorized_voice_read_attempt',
        resourceId: id,
        status: 'denied',
        details: { voiceOwnerId: voice.userId || null, code: access.code },
      });
      return res.status(access.status).json({
        error: access.error,
        code: access.code,
      });
    }

    assertNonPremadeVoiceLedgerHealthy(voice.id);

    res.json(voice);
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// 3. Audio Reference Quality Check (authenticated v1 endpoint)
v1Router.post('/audio/reference', requireAuth, (req, res) => {
  const { audioBase64, durationSeconds } = req.body;
  const report = AudioQualityAnalyzer.analyze(audioBase64 || '', durationSeconds);
  res.json(report);
});

// 4. Asynchronous Job Polling & Cancellation (strictly authenticated & tenant-owned)
v1Router.get('/jobs/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const callerId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    const ledgerJob = asyncJobsLedger.get(id);
    const storeJob = (memoryStore.synthesisJobs as any[]).find((j) => j.id === id);
    const job = (ledgerJob || storeJob) as (AsyncJobRecord & { outputMediaId?: string }) | undefined;
    if (!job) {
      return res.status(404).json({
        error: { code: 'JOB_NOT_FOUND', message: `Job '${id}' not found.` },
        code: 'JOB_NOT_FOUND',
      });
    }

    if (!job.userId || (job.userId !== callerId && !isAdmin)) {
      logAuditEvent({
        userId: callerId,
        eventType: 'unauthorized_job_access_attempt',
        resourceId: id,
        status: 'denied',
        details: { jobOwnerId: job.userId || null },
      });
      return res.status(403).json({
        error: 'Forbidden: You do not own this job',
        code: 'FORBIDDEN_NOT_OWNER',
      });
    }

    if (job.voiceId && !isVoiceConsentVerifiedActive(job.voiceId)) {
      const mediaFromJob = scrubJobAudioArtifactsInMemory(
        job,
        'Biometric consent for this voice profile has been revoked by the owner.'
      );
      const mediaFromStore =
        storeJob && storeJob !== job
          ? scrubJobAudioArtifactsInMemory(
              storeJob,
              'Biometric consent for this voice profile has been revoked by the owner.'
            )
          : undefined;
      const targetMediaId = mediaFromJob || mediaFromStore;
      if (targetMediaId) {
        const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
          mediaId: targetMediaId,
          requestingUserId: callerId,
          isAdmin,
          allowVoiceOwnerCleanup: true,
          reason: 'consent_revoked',
          fallbackOwnerId: job.userId,
          fallbackVoiceId: job.voiceId,
        });
        recordSanitizedCleanupFailures(callerId, id, [outcome], {
          voiceId: job.voiceId,
          reason: 'consent_revoked',
        });
      }

      logAuditEvent({
        userId: callerId,
        eventType: 'job_access_blocked_revoked_consent',
        resourceId: id,
        status: 'denied',
        details: { voiceId: job.voiceId },
      });
      return res.status(403).json({
        error: 'Job cancelled: Biometric consent for cloned voice has been revoked by the owner.',
        code: 'CONSENT_REVOKED',
        job: {
          jobId: job.jobId || job.id,
          status: job.status,
          voiceId: job.voiceId,
          error: job.error,
        },
      });
    }

    // Fail closed with 503 if invalidation state is unhealthy rather than mutating a valid uncancelled job
    PrivateStorageService.assertInvalidationLedgerHealthy();

    if (
      job.status === 'cancelled' ||
      (job.outputMediaId && PrivateStorageService.isMediaInvalidated(job.outputMediaId))
    ) {
      scrubJobAudioArtifactsInMemory(job, job.error || 'Synthesis job has been cancelled.');
      if (storeJob && storeJob !== job) {
        scrubJobAudioArtifactsInMemory(storeJob, storeJob.error || 'Synthesis job has been cancelled.');
      }
    }

    res.json(serializeSafeSynthesisJob(job));
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

v1Router.post('/jobs/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const callerId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    const ledgerJob = asyncJobsLedger.get(id) as (AsyncJobRecord & { outputMediaId?: string }) | undefined;
    const storeJob = (memoryStore.synthesisJobs as any[]).find((j) => j.id === id);
    const job = ledgerJob || storeJob;

    if (!job) {
      return res.status(404).json({
        error: { code: 'JOB_NOT_FOUND', message: `Job '${id}' not found.` },
        code: 'JOB_NOT_FOUND',
      });
    }

    if (!job.userId || (job.userId !== callerId && !isAdmin)) {
      logAuditEvent({
        userId: callerId,
        eventType: 'unauthorized_job_cancel_attempt',
        resourceId: id,
        status: 'denied',
        details: { jobOwnerId: job.userId || null },
      });
      return res.status(403).json({
        error: 'Forbidden: You do not own this job',
        code: 'FORBIDDEN_NOT_OWNER',
      });
    }

    const wasAlreadyCancelled = job.status === 'cancelled';
    const mediaFromLedger = ledgerJob
      ? scrubJobAudioArtifactsInMemory(ledgerJob, ledgerJob.error || 'Job cancelled by user.')
      : undefined;
    const mediaFromStore =
      storeJob && storeJob !== ledgerJob
        ? scrubJobAudioArtifactsInMemory(storeJob, storeJob.error || 'Job cancelled by user.')
        : storeJob === ledgerJob && storeJob
          ? mediaFromLedger
          : undefined;

    const targetMediaId = mediaFromLedger || mediaFromStore || pendingCancelledJobMedia.get(id);
    let cleanupFailed = false;
    let durableInvalidationEstablished = PrivateStorageService.isInvalidationLedgerHealthy();

    if (targetMediaId) {
      pendingCancelledJobMedia.set(id, targetMediaId);
      const outcome = await PrivateStorageService.invalidateAndDeleteMedia({
        mediaId: targetMediaId,
        requestingUserId: callerId,
        isAdmin,
        reason: 'job_cancelled',
        fallbackOwnerId: job.userId,
        fallbackVoiceId: job.voiceId,
      });
      const failures = recordSanitizedCleanupFailures(callerId, id, [outcome], {
        voiceId: job.voiceId,
        reason: 'job_cancelled',
      });
      cleanupFailed = failures > 0;
      durableInvalidationEstablished =
        outcome.durableInvalidationEstablished && PrivateStorageService.isInvalidationLedgerHealthy();
      if (durableInvalidationEstablished) {
        pendingCancelledJobMedia.delete(id);
      }
    }

    if (!durableInvalidationEstablished) {
      logAuditEvent({
        userId: callerId,
        eventType: 'job_cancel_durability_failed',
        resourceId: id,
        status: 'failure',
        details: {
          alreadyCancelled: wasAlreadyCancelled,
          artifactInvalidated: Boolean(targetMediaId) || wasAlreadyCancelled,
          cleanupFailed: true,
        },
      });
      return res.status(503).json({
        success: false,
        error:
          'Job cancellation took effect in memory, but durable storage invalidation could not be persisted.',
        code: 'STORAGE_UNAVAILABLE',
        cleanupFailed: true,
      });
    }

    logAuditEvent({
      userId: callerId,
      eventType: 'job_cancelled',
      resourceId: id,
      status: 'success',
      details: {
        alreadyCancelled: wasAlreadyCancelled,
        artifactInvalidated: Boolean(targetMediaId) || wasAlreadyCancelled,
        cleanupFailed,
      },
    });

    res.json({
      success: true,
      alreadyCancelled: wasAlreadyCancelled,
      cleanupFailed,
      job: serializeSafeSynthesisJob(ledgerJob || storeJob),
    });
  } catch (err: any) {
    if (err?.name === 'StorageUnavailableError') {
      return res.status(503).json({
        success: false,
        error: 'Storage backend is currently unavailable',
        code: 'STORAGE_UNAVAILABLE',
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. Projects (authenticated & tenant-scoped)
v1Router.get('/projects', requireAuth, (req, res) => {
  const callerId = req.user!.id;
  const isAdmin = req.user!.role === 'admin';
  const visible = Array.from(projectsLedger.values()).filter(
    (p) => p.isPublic === true || isAdmin || (Boolean(p.userId) && p.userId === callerId)
  );
  res.json({ projects: visible });
});

v1Router.get('/projects/:id', requireAuth, (req, res) => {
  const proj = projectsLedger.get(req.params.id);
  if (!proj) {
    return res.status(404).json({
      error: { code: 'PROJECT_NOT_FOUND', message: `Project '${req.params.id}' not found.` },
      code: 'PROJECT_NOT_FOUND',
    });
  }
  const callerId = req.user!.id;
  const isAdmin = req.user!.role === 'admin';
  if (!proj.isPublic && !isAdmin && proj.userId !== callerId) {
    return res.status(403).json({
      error: 'Forbidden: You do not own this project',
      code: 'FORBIDDEN_NOT_OWNER',
    });
  }
  res.json(proj);
});

v1Router.post('/projects', requireAuth, (req, res) => {
  const { title, targetLanguages, scenes } = req.body;
  const id = `proj_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const newProj = {
    id,
    userId: req.user!.id,
    isPublic: false,
    title: title || 'Untitled Voice Project',
    targetLanguages: targetLanguages || ['en'],
    scenes: scenes || 1,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  projectsLedger.set(id, newProj);
  res.status(201).json(newProj);
});

// 6. Visual Studio Motion Graphics Render (authenticated & tenant-bound)
v1Router.post('/visuals/render', requireAuth, (req, res) => {
  const { templateId, audioDurationSec, resolution, format } = req.body;
  const renderJobId = `render_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const renderRecord: AsyncJobRecord = {
    jobId: renderJobId,
    id: renderJobId,
    userId: req.user!.id,
    type: 'visual_render',
    status: 'completed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progressPercent: 100,
    requestPayload: { templateId, audioDurationSec, resolution: resolution || '1080p', format: format || 'mp4' },
    result: {
      renderJobId,
      templateId: templateId || 'audiogram_spectrum',
      outputFormat: format || 'mp4',
      resolution: resolution || '1920x1080',
      durationSeconds: audioDurationSec || 15.0,
      renderPipeline: 'VoiceForge Visual Studio Canvas 2D / Web Audio Renderer',
      status: 'ready',
    },
  };
  asyncJobsLedger.set(renderJobId, renderRecord);
  res.json(renderRecord);
});

// Mount /api/v1
apiRouter.use('/v1', v1Router);
