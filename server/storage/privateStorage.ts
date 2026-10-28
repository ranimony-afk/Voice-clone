/**
 * VoiceForge Private Storage Service (Phase 3A)
 * 
 * Provides:
 * - Isolated, non-public media storage on the server filesystem
 * - Strict binary magic-byte inspection (WAV, MP3, OGG, FLAC, WebM) rejecting malicious payloads
 * - Tamper-proof HMAC-SHA256 signed download URLs with configurable TTL (default 15 minutes)
 * - Tenant ownership and access enforcement for all private audio assets
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { memoryStore } from '../db/index.ts';

export interface PrivateMediaRecord {
  id: string;
  userId: string;
  voiceId?: string; // Optional linkage to originating voice profile for consent lifecycle enforcement
  mediaType: 'reference_audio' | 'consent_audio' | 'tts_output' | 'stem' | 'general';
  storageKey: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256Hash: string;
  audioFormat: 'wav' | 'mp3' | 'webm' | 'ogg' | 'flac' | 'unknown';
  isEncrypted: boolean;
  expiresAt?: string;
  createdAt: string;
}

export interface AudioInspectionResult {
  valid: boolean;
  format: 'wav' | 'mp3' | 'webm' | 'ogg' | 'flac' | 'unknown';
  mimeType: string;
  error?: string;
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

/**
 * Provider-Neutral Storage Interface (Phase 3B)
 */
export interface StorageProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  store(key: string, buffer: Buffer): Promise<void>;
  retrieve(key: string): Promise<Buffer>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

/**
 * Local POSIX Filesystem Storage Provider
 * Implements strict private directory permissions (0o700) and file permissions (0o600)
 */
export class LocalStorageProvider implements StorageProvider {
  public readonly name = 'local_posix_filesystem';
  private root: string;

  constructor(rootPath: string) {
    this.root = rootPath;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.root)) {
        fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      }
      return true;
    } catch {
      return false;
    }
  }

  public async store(key: string, buffer: Buffer): Promise<void> {
    const fullPath = path.join(this.root, key);
    const dir = path.dirname(fullPath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(fullPath, buffer, { mode: 0o600 });
    } catch (err: any) {
      throw new StorageUnavailableError(`Local storage write failed: ${err.message}`);
    }
  }

  public async retrieve(key: string): Promise<Buffer> {
    const fullPath = path.join(this.root, key);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Media file not found at path: ${key}`);
    }
    try {
      return fs.readFileSync(fullPath);
    } catch (err: any) {
      throw new StorageUnavailableError(`Local storage read failed: ${err.message}`);
    }
  }

  public async delete(key: string): Promise<boolean> {
    const fullPath = path.join(this.root, key);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  public async exists(key: string): Promise<boolean> {
    return fs.existsSync(path.join(this.root, key));
  }
}

/**
 * S3-Compatible Object Storage Provider Template
 * Private by default with explicit unconfigured/unavailable handling
 */
export class S3CompatibleStorageProvider implements StorageProvider {
  public readonly name = 's3_compatible_object_storage';
  private bucket: string | undefined;
  private endpoint: string | undefined;

  constructor(config?: { bucket?: string; endpoint?: string }) {
    this.bucket = config?.bucket || process.env.VOICEFORGE_S3_BUCKET;
    this.endpoint = config?.endpoint || process.env.VOICEFORGE_S3_ENDPOINT;
  }

  public async isAvailable(): Promise<boolean> {
    return Boolean(this.bucket && this.endpoint && process.env.VOICEFORGE_S3_ACCESS_KEY);
  }

  public async store(_key: string, _buffer: Buffer): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new StorageUnavailableError('S3 object storage provider is unconfigured or credentials are missing.');
    }
    throw new StorageUnavailableError('S3 cloud client not bound in offline container environment.');
  }

  public async retrieve(_key: string): Promise<Buffer> {
    throw new StorageUnavailableError('S3 cloud storage unavailable.');
  }

  public async delete(_key: string): Promise<boolean> {
    return false;
  }

  public async exists(_key: string): Promise<boolean> {
    return false;
  }
}

export class PrivateStorageService {
  private static readonly STORAGE_ROOT = process.env.VOICEFORGE_STORAGE_DIR || '/tmp/voiceforge-storage';
  public static readonly MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB max payload
  private static readonly DEFAULT_URL_TTL_SECONDS = 15 * 60; // 15 minutes
  private static provider: StorageProvider = new LocalStorageProvider(PrivateStorageService.STORAGE_ROOT);

  /**
   * Pluggable storage provider injection
   */
  public static setProvider(customProvider: StorageProvider): void {
    this.provider = customProvider;
  }

  public static getProvider(): StorageProvider {
    return this.provider;
  }

  /**
   * Retrieves the HMAC signing secret with fail-closed behavior in production
   */
  public static getSigningSecret(): string {
    const secret = process.env.VOICEFORGE_STORAGE_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('FATAL SECURITY CONFIGURATION: VOICEFORGE_STORAGE_SECRET must be explicitly configured in production.');
      }
      return 'vf_storage_sec_sig_p3a_88a91';
    }
    return secret;
  }

  /**
   * Initializes the private storage root directory
   */
  public static init(): void {
    if (!fs.existsSync(this.STORAGE_ROOT)) {
      fs.mkdirSync(this.STORAGE_ROOT, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Inspects binary audio magic bytes to prevent file upload polyglots, scripts, or malicious executables
   */
  public static inspectAudioBytes(buffer: Buffer): AudioInspectionResult {
    if (!buffer || buffer.length < 4) {
      return { valid: false, format: 'unknown', mimeType: 'application/octet-stream', error: 'File is too small or empty' };
    }

    // Explicit malicious header checks
    const headAscii = buffer.subarray(0, Math.min(buffer.length, 64)).toString('ascii').toLowerCase();
    if (
      headAscii.includes('<html') ||
      headAscii.includes('<!doctype') ||
      headAscii.includes('<svg') ||
      headAscii.includes('<?php') ||
      headAscii.startsWith('#!') ||
      headAscii.startsWith('mz') // Windows PE
    ) {
      return { valid: false, format: 'unknown', mimeType: 'application/octet-stream', error: 'Malicious non-audio payload detected' };
    }

    // 1. WAV Check (RIFF ... WAVE with structural header inspection)
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && // RIFF
      buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45  // WAVE
    ) {
      if (buffer.length < 44) {
        return { valid: false, format: 'wav', mimeType: 'audio/wav', error: 'Truncated or corrupted WAV container (< 44 bytes)' };
      }
      // Inspect fmt subchunk if standard PCM
      const subchunk1Id = buffer.toString('ascii', 12, 16);
      if (subchunk1Id === 'fmt ') {
        const numChannels = buffer.readUInt16LE(22);
        const sampleRate = buffer.readUInt32LE(24);
        const bitsPerSample = buffer.readUInt16LE(34);
        if (numChannels === 0 || numChannels > 8 || sampleRate < 4000 || sampleRate > 192000 || (bitsPerSample !== 16 && bitsPerSample !== 24 && bitsPerSample !== 32)) {
          return { valid: false, format: 'wav', mimeType: 'audio/wav', error: 'Malformed audio parameters in WAV fmt subchunk' };
        }
      }
      return { valid: true, format: 'wav', mimeType: 'audio/wav' };
    }

    // 2. MP3 Check (ID3 tag or MPEG sync frame)
    if (
      buffer.length >= 3 &&
      buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33 // ID3
    ) {
      return { valid: true, format: 'mp3', mimeType: 'audio/mpeg' };
    }
    // MPEG Frame Sync: 0xFF followed by 0xE0 mask
    if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
      return { valid: true, format: 'mp3', mimeType: 'audio/mpeg' };
    }

    // 3. OGG Check (OggS)
    if (
      buffer.length >= 4 &&
      buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53 // OggS
    ) {
      return { valid: true, format: 'ogg', mimeType: 'audio/ogg' };
    }

    // 4. FLAC Check (fLaC)
    if (
      buffer.length >= 4 &&
      buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43 // fLaC
    ) {
      return { valid: true, format: 'flac', mimeType: 'audio/flac' };
    }

    // 5. WebM Check (EBML 0x1A 0x45 0xDF 0xA3)
    if (
      buffer.length >= 4 &&
      buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3
    ) {
      return { valid: true, format: 'webm', mimeType: 'audio/webm' };
    }

    return { valid: false, format: 'unknown', mimeType: 'application/octet-stream', error: 'Unrecognized audio container header' };
  }

  /**
   * Generates a tamper-proof HMAC-signed download URL for a private media record
   */
  public static generateSignedDownloadUrl(
    mediaId: string,
    userId: string,
    ttlSeconds: number = this.DEFAULT_URL_TTL_SECONDS
  ): string {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${mediaId}:${userId}:${expires}`;
    const secret = this.getSigningSecret();
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    return `/api/v1/media/download/${encodeURIComponent(mediaId)}?expires=${expires}&uid=${encodeURIComponent(userId)}&sig=${sig}`;
  }

  /**
   * Verifies the authenticity and validity of a signed download URL
   */
  public static verifySignedUrl(
    mediaId: string,
    userId: string,
    expires: number,
    signature: string
  ): boolean {
    if (!mediaId || !userId || !expires || !signature) return false;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (expires < now) return false;

    // Verify HMAC
    let secret: string;
    try {
      secret = this.getSigningSecret();
    } catch {
      return false;
    }

    const payload = `${mediaId}:${userId}:${expires}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expectedSig);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /**
   * Stores an audio buffer securely in private storage and records metadata
   */
  public static async storeMedia(params: {
    userId: string;
    voiceId?: string;
    mediaType: 'reference_audio' | 'consent_audio' | 'tts_output' | 'stem' | 'general';
    filename: string;
    buffer: Buffer;
    audioFormat?: string;
  }): Promise<PrivateMediaRecord> {
    this.init();

    // Enforce maximum file size
    if (params.buffer.length > this.MAX_MEDIA_BYTES) {
      throw new Error(`Media rejected: payload size (${params.buffer.length} bytes) exceeds maximum limit of 25MB.`);
    }

    // Magic bytes & container inspection
    const inspection = this.inspectAudioBytes(params.buffer);
    if (!inspection.valid) {
      throw new Error(`Media rejected by security inspector: ${inspection.error}`);
    }

    const mediaId = `med_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const safeExt = inspection.format === 'unknown' ? 'bin' : inspection.format;
    const storageKey = `${params.userId}/${mediaId}.${safeExt}`;

    // Delegate byte persistence to the active storage provider
    await this.provider.store(storageKey, params.buffer);

    const sha256Hash = crypto.createHash('sha256').update(params.buffer).digest('hex');

    const record: PrivateMediaRecord = {
      id: mediaId,
      userId: params.userId,
      voiceId: params.voiceId,
      mediaType: params.mediaType,
      storageKey,
      filename: params.filename || `${mediaId}.${safeExt}`,
      mimeType: inspection.mimeType,
      byteSize: params.buffer.length,
      sha256Hash,
      audioFormat: inspection.format,
      isEncrypted: false,
      createdAt: new Date().toISOString(),
    };

    // Save in memory store
    memoryStore.privateMedia.push(record);

    // Persist to PostgreSQL if connected
    try {
      import('../db/index.ts').then(({ getDatabase }) => {
        const { db, schema } = getDatabase();
        if (db && schema?.privateMedia) {
          db.insert(schema.privateMedia).values({
            id: record.id,
            userId: record.userId,
            mediaType: record.mediaType,
            storageKey: record.storageKey,
            filename: record.filename,
            mimeType: record.mimeType,
            byteSize: record.byteSize,
            sha256Hash: record.sha256Hash,
            audioFormat: record.audioFormat,
            isEncrypted: record.isEncrypted,
            createdAt: new Date(record.createdAt),
          }).catch(() => {});
        }
      }).catch(() => {});
    } catch {
      // In-memory fallback
    }

    return record;
  }

  /**
   * Retrieves a private media file, validating ownership
   */
  public static async getMedia(
    mediaId: string,
    requestingUserId: string,
    isAdmin: boolean = false
  ): Promise<{ buffer: Buffer; meta: PrivateMediaRecord }> {
    this.init();

    const meta = (memoryStore.privateMedia as PrivateMediaRecord[]).find((m) => m.id === mediaId);
    if (!meta) {
      throw new Error('Media asset not found');
    }

    if (!isAdmin && meta.userId !== requestingUserId) {
      throw new Error('Forbidden: You do not own this media asset');
    }

    const buffer = await this.provider.retrieve(meta.storageKey);
    return { buffer, meta };
  }

  /**
   * Deletes a private media file
   */
  public static async deleteMedia(
    mediaId: string,
    requestingUserId: string,
    isAdmin: boolean = false
  ): Promise<boolean> {
    const metaIndex = (memoryStore.privateMedia as PrivateMediaRecord[]).findIndex((m) => m.id === mediaId);
    if (metaIndex === -1) return false;

    const meta = memoryStore.privateMedia[metaIndex];
    if (!isAdmin && meta.userId !== requestingUserId) {
      throw new Error('Forbidden: You do not own this media asset');
    }

    await this.provider.delete(meta.storageKey);

    memoryStore.privateMedia.splice(metaIndex, 1);
    return true;
  }
}
