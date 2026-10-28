/**
 * VoiceForge Cryptographic Audio Watermarking & Provenance Engine
 * Implements C2PA-inspired authenticated provenance records and tamper-proof verification:
 * - Server-controlled HMAC-SHA256 signing keys with key-rotation support
 * - Generation identifiers linked to SHA-256 audio-content hashes
 * - Verification of signature authenticity and tamper detection
 * - Clear distinction between:
 *     1. Cryptographic Audio Content Hash (SHA-256)
 *     2. Signed Provenance Metadata (HMAC-SHA256)
 *     3. Container-Embedded Provenance Metadata (RIFF 'VFPR' Chunk)
 */

import crypto from 'node:crypto';
import { isRestrictedEnvironment } from '../../config/env.ts';

const DEV_FALLBACK_WATERMARK_KEY = 'vf_watermark_hmac_secret_key_prod_8f1b2c3d4e5a';
const DEV_FALLBACK_LEGACY_WATERMARK_KEY = 'vf_watermark_hmac_secret_key_legacy_rotation';
const KNOWN_PUBLIC_FALLBACK_WATERMARK_KEYS = new Set<string>([
  DEV_FALLBACK_WATERMARK_KEY,
  DEV_FALLBACK_LEGACY_WATERMARK_KEY,
]);

function timingSafeHexEqual(actualHex: string, expectedHex: string): boolean {
  if (typeof actualHex !== 'string' || typeof expectedHex !== 'string') return false;
  if (actualHex.length !== expectedHex.length || actualHex.length === 0 || actualHex.length % 2 !== 0) {
    return false;
  }
  if (!/^[0-9a-f]+$/i.test(actualHex) || !/^[0-9a-f]+$/i.test(expectedHex)) {
    return false;
  }
  try {
    const a = Buffer.from(actualHex, 'hex');
    const b = Buffer.from(expectedHex, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface ProvenanceManifest {
  manifestVersion: '1.0';
  generationId: string;
  userId: string;
  voiceId: string;
  audioContentHash: string;
  timestamp: number;
  sampleRate: number;
  durationSeconds: number;
  keyId: string;
  signature: string;
}

export interface WatermarkVerificationResult {
  isValid: boolean;
  tamperDetected: boolean;
  details: string;
  manifest?: ProvenanceManifest;
  verifiedAt: string;
  integrityType: 'signed_metadata' | 'content_hash_matched' | 'unverified';
}

export class AudioWatermarker {
  private static readonly CURRENT_KEY_ID = 'k_prod_2026_v1';
  private static readonly LEGACY_KEY_ID = 'k_legacy_2025_v0';

  // In-memory provenance ledger (in production synced to PostgreSQL generations table)
  private static manifestLedger: Map<string, ProvenanceManifest> = new Map();

  /**
   * Resolves the active watermark HMAC signing secret dynamically with fail-closed enforcement
   * in staging, production, and unknown environments. Never logs secret values.
   */
  public static getSigningSecret(): string {
    const raw = process.env.VOICEFORGE_WATERMARK_KEY;
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    const restricted = isRestrictedEnvironment(process.env.NODE_ENV);

    if (trimmed.length === 0) {
      if (restricted) {
        throw new Error(
          'FATAL SECURITY CONFIGURATION: VOICEFORGE_WATERMARK_KEY must be explicitly configured in staging and production.'
        );
      }
      return DEV_FALLBACK_WATERMARK_KEY;
    }

    if (restricted && (trimmed.length < 16 || KNOWN_PUBLIC_FALLBACK_WATERMARK_KEYS.has(trimmed))) {
      throw new Error(
        'FATAL SECURITY CONFIGURATION: VOICEFORGE_WATERMARK_KEY is invalid, too short, or uses a publicly known fallback secret in staging/production.'
      );
    }

    return trimmed;
  }

  /**
   * Resolves verification keys dynamically while forbidding publicly known fallback secrets
   * in staging, production, and unknown environments (including rotated legacy key IDs).
   */
  private static resolveKeyForVerification(
    keyId: string
  ):
    | { status: 'ok'; secret: string }
    | { status: 'unknown_key' }
    | { status: 'restricted_secret_unavailable' } {
    if (keyId === this.CURRENT_KEY_ID) {
      try {
        return { status: 'ok', secret: this.getSigningSecret() };
      } catch {
        return { status: 'restricted_secret_unavailable' };
      }
    }

    if (keyId === this.LEGACY_KEY_ID) {
      const restricted = isRestrictedEnvironment(process.env.NODE_ENV);
      const rawLegacy = process.env.VOICEFORGE_WATERMARK_LEGACY_KEY;
      const trimmedLegacy = typeof rawLegacy === 'string' ? rawLegacy.trim() : '';

      if (restricted) {
        if (trimmedLegacy.length < 16 || KNOWN_PUBLIC_FALLBACK_WATERMARK_KEYS.has(trimmedLegacy)) {
          return { status: 'restricted_secret_unavailable' };
        }
        return { status: 'ok', secret: trimmedLegacy };
      }

      return {
        status: 'ok',
        secret: trimmedLegacy.length > 0 ? trimmedLegacy : DEV_FALLBACK_LEGACY_WATERMARK_KEY,
      };
    }

    return { status: 'unknown_key' };
  }

  /**
   * Generates an authentic cryptographically signed provenance manifest and signature token
   */
  public static signGeneration(params: {
    generationId: string;
    userId: string;
    voiceId: string;
    audioBuffer: Buffer;
    sampleRate: number;
    durationSeconds: number;
    timestamp?: number;
  }): { signature: string; manifest: ProvenanceManifest; audioWithMetadata: Buffer } {
    const timestamp = params.timestamp || Date.now();
    const keyId = this.CURRENT_KEY_ID;
    const secret = this.getSigningSecret();

    // 1. Content Hash (SHA-256) over raw audio bytes
    const audioContentHash = crypto.createHash('sha256').update(params.audioBuffer).digest('hex');

    // 2. Canonical payload string
    const payload = `${params.generationId}|${params.userId}|${params.voiceId}|${audioContentHash}|${params.sampleRate}|${params.durationSeconds.toFixed(2)}|${timestamp}|${keyId}`;

    // 3. Cryptographic signature
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const manifest: ProvenanceManifest = {
      manifestVersion: '1.0',
      generationId: params.generationId,
      userId: params.userId,
      voiceId: params.voiceId,
      audioContentHash,
      timestamp,
      sampleRate: params.sampleRate,
      durationSeconds: params.durationSeconds,
      keyId,
      signature,
    };

    // Store manifest in ledger
    this.manifestLedger.set(params.generationId, manifest);
    this.manifestLedger.set(signature, manifest);

    // 4. Embed provenance chunk into WAV container if applicable
    const audioWithMetadata = this.embedProvenanceChunk(params.audioBuffer, manifest);

    return {
      signature,
      manifest,
      audioWithMetadata,
    };
  }

  /**
   * Verifies provenance authenticity and checks for audio tampering
   */
  public static verifyAudioProvenance(
    audioBufferOrBase64: Buffer | string,
    signatureOrToken?: string
  ): WatermarkVerificationResult {
    const audioBuffer = Buffer.isBuffer(audioBufferOrBase64)
      ? audioBufferOrBase64
      : Buffer.from(
          audioBufferOrBase64.includes('base64,') ? audioBufferOrBase64.split('base64,')[1] : audioBufferOrBase64,
          'base64'
        );

    // Check if manifest is embedded in WAV chunk
    let manifest: ProvenanceManifest | null | undefined = this.extractEmbeddedManifest(audioBuffer);

    // If not embedded, lookup via signature token
    if (!manifest && signatureOrToken) {
      manifest = this.manifestLedger.get(signatureOrToken);
    }

    if (!manifest) {
      return {
        isValid: false,
        tamperDetected: false,
        details: 'No cryptographically authentic VoiceForge provenance record found in metadata or ledger.',
        verifiedAt: new Date().toISOString(),
        integrityType: 'unverified',
      };
    }

    // Check key ID & restricted-environment key availability
    const keyResolution = this.resolveKeyForVerification(manifest.keyId);
    if (keyResolution.status === 'unknown_key') {
      return {
        isValid: false,
        tamperDetected: true,
        details: `Unknown signing key ID "${manifest.keyId}". Signature cannot be authenticated.`,
        manifest,
        verifiedAt: new Date().toISOString(),
        integrityType: 'unverified',
      };
    }

    if (keyResolution.status === 'restricted_secret_unavailable') {
      return {
        isValid: false,
        tamperDetected: false,
        details: 'Watermark verification rejected: valid restricted-environment signing key is not configured.',
        manifest,
        verifiedAt: new Date().toISOString(),
        integrityType: 'unverified',
      };
    }

    const secret = keyResolution.secret;

    // Verify cryptographic signature integrity
    const payload = `${manifest.generationId}|${manifest.userId}|${manifest.voiceId}|${manifest.audioContentHash}|${manifest.sampleRate}|${manifest.durationSeconds.toFixed(2)}|${manifest.timestamp}|${manifest.keyId}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    if (!timingSafeHexEqual(manifest.signature, expectedSig)) {
      return {
        isValid: false,
        tamperDetected: true,
        details: 'Tamper Alert: Cryptographic HMAC signature mismatch. Manifest data has been forged or modified.',
        manifest,
        verifiedAt: new Date().toISOString(),
        integrityType: 'unverified',
      };
    }

    // Check Audio Content Hash Match (detects audio sample tampering)
    // Strip trailing custom chunk if present when hashing
    const baseAudioBuffer = this.stripProvenanceChunk(audioBuffer);
    const actualContentHash = crypto.createHash('sha256').update(baseAudioBuffer).digest('hex');

    if (actualContentHash !== manifest.audioContentHash) {
      return {
        isValid: false,
        tamperDetected: true,
        details: `Tamper Alert: Audio content hash mismatch! Expected ${manifest.audioContentHash.substring(0, 16)}..., computed ${actualContentHash.substring(0, 16)}... Audio samples have been modified or re-encoded after generation.`,
        manifest,
        verifiedAt: new Date().toISOString(),
        integrityType: 'unverified',
      };
    }

    return {
      isValid: true,
      tamperDetected: false,
      details: `Authentic VoiceForge generation verified. Generated for user "${manifest.userId}" on ${new Date(manifest.timestamp).toISOString()} with voice "${manifest.voiceId}". Content hash and HMAC signature verified.`,
      manifest,
      verifiedAt: new Date().toISOString(),
      integrityType: 'content_hash_matched',
    };
  }

  /**
   * Helper: Legacy backwards-compatible signature generation
   */
  public static generateSignature(userId: string, voiceId: string, timestamp: number): string {
    const keyId = this.CURRENT_KEY_ID;
    const secret = this.getSigningSecret();
    const genId = `gen_${timestamp}_${crypto.randomBytes(4).toString('hex')}`;
    const dummyHash = crypto.createHash('sha256').update(`${userId}:${voiceId}:${timestamp}`).digest('hex');
    const payload = `${genId}|${userId}|${voiceId}|${dummyHash}|24000|1.00|${timestamp}|${keyId}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Helper: Backward-compatible verifyWatermark
   */
  public static verifyWatermark(signature: string): {
    isValid: boolean;
    provider: string;
    verifiedAt: string;
  } {
    const manifest = this.manifestLedger.get(signature);
    if (!manifest) {
      // Reject arbitrary strings - must be in ledger or valid HMAC
      return {
        isValid: false,
        provider: 'VoiceForge AI Audio Integrity System',
        verifiedAt: new Date().toISOString(),
      };
    }

    const keyResolution = this.resolveKeyForVerification(manifest.keyId);
    if (keyResolution.status !== 'ok') {
      return {
        isValid: false,
        provider: 'VoiceForge AI Audio Integrity System',
        verifiedAt: new Date().toISOString(),
      };
    }

    const payload = `${manifest.generationId}|${manifest.userId}|${manifest.voiceId}|${manifest.audioContentHash}|${manifest.sampleRate}|${manifest.durationSeconds.toFixed(2)}|${manifest.timestamp}|${manifest.keyId}`;
    const expected = crypto.createHmac('sha256', keyResolution.secret).update(payload).digest('hex');

    return {
      isValid: timingSafeHexEqual(manifest.signature, expected),
      provider: 'VoiceForge AI Audio Integrity System',
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Embeds a custom RIFF chunk 'vfpr' (VoiceForge Provenance) at the end of the WAV buffer
   */
  private static embedProvenanceChunk(buffer: Buffer, manifest: ProvenanceManifest): Buffer {
    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
      return buffer; // Non-WAV, return as-is
    }

    const jsonStr = JSON.stringify(manifest);
    const jsonBytes = Buffer.from(jsonStr, 'utf8');
    const chunkLength = jsonBytes.length;

    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write('vfpr', 0, 4, 'ascii'); // Chunk ID: VoiceForge Provenance
    chunkHeader.writeUInt32LE(chunkLength, 4);

    const paddedLength = chunkLength % 2 === 1 ? chunkLength + 1 : chunkLength;
    const chunkPayload = Buffer.alloc(paddedLength);
    jsonBytes.copy(chunkPayload, 0);

    const combined = Buffer.concat([buffer, chunkHeader, chunkPayload]);

    // Update RIFF total length at bytes 4-7
    const newRiffSize = combined.length - 8;
    combined.writeUInt32LE(newRiffSize, 4);

    return combined;
  }

  /**
   * Extracts embedded 'vfpr' chunk from WAV buffer if present
   */
  private static extractEmbeddedManifest(buffer: Buffer): ProvenanceManifest | null {
    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
      return null;
    }

    try {
      let offset = 12;
      while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkId === 'vfpr') {
          const jsonBytes = buffer.subarray(offset + 8, offset + 8 + chunkSize);
          const manifest: ProvenanceManifest = JSON.parse(jsonBytes.toString('utf8'));
          return manifest;
        }

        const paddedSize = chunkSize % 2 === 1 ? chunkSize + 1 : chunkSize;
        offset += 8 + paddedSize;
      }
    } catch {
      return null;
    }

    return null;
  }

  /**
   * Strips embedded 'vfpr' chunk to recover the exact base audio bytes for content hash verification
   */
  private static stripProvenanceChunk(buffer: Buffer): Buffer {
    if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') {
      return buffer;
    }

    try {
      let offset = 12;
      while (offset + 8 <= buffer.length) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkId === 'vfpr') {
          const stripped = buffer.subarray(0, offset);
          const newRiffSize = stripped.length - 8;
          const result = Buffer.from(stripped);
          result.writeUInt32LE(newRiffSize, 4);
          return result;
        }

        const paddedSize = chunkSize % 2 === 1 ? chunkSize + 1 : chunkSize;
        offset += 8 + paddedSize;
      }
    } catch {
      return buffer;
    }

    return buffer;
  }
}
