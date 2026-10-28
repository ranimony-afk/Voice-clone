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
import { isRestrictedEnvironment } from '../config/env.ts';

const DEV_FALLBACK_STORAGE_SECRET = 'vf_storage_sec_sig_p3a_88a91';

export type MediaInvalidationReason =
  | 'consent_revoked'
  | 'voice_deleted'
  | 'job_cancelled'
  | 'manual_delete';

export type VoiceInvalidationReason = 'consent_revoked' | 'voice_deleted';

export type LedgerPersistenceStage =
  | 'voice_barrier'
  | 'batch_tombstones'
  | 'post_cleanup'
  | 'single_tombstone'
  | 'reconcile_persist'
  | 'catalog_store'
  | 'general';

export interface InvalidatedVoiceEntry {
  voiceId: string;
  ownerId: string;
  reason: VoiceInvalidationReason;
  invalidatedAt: string;
}

export interface PersistedMediaCatalogEntry {
  id: string;
  ownerId: string;
  voiceId?: string;
  storageKey: string;
  createdAt: string;
}

export interface InvalidatedMediaEntry {
  id: string;
  ownerId: string;
  voiceId?: string;
  storageKey?: string;
  reason: MediaInvalidationReason;
  invalidatedAt: string;
  cleanupFailed: boolean;
  cleanupFailureCode?: string;
}

export interface MediaInvalidationOutcome {
  mediaId: string;
  invalidated: boolean;
  alreadyInvalidated: boolean;
  notFound: boolean;
  deletedFromProvider: boolean;
  durableInvalidationEstablished: boolean;
  cleanupFailed: boolean;
  cleanupFailureCode?: string;
}

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

  public getRootDir(): string {
    return this.root;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.root)) {
        fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      }
      const stat = fs.statSync(this.root);
      if (!stat.isDirectory() || (stat.mode & 0o200) === 0) {
        return false;
      }
      fs.accessSync(this.root, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
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
      const fd = fs.openSync(fullPath, 'w', 0o600);
      try {
        fs.writeFileSync(fd, buffer);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      throw new StorageUnavailableError('Local storage write failed: underlying storage is unavailable.');
    }
  }

  public async retrieve(key: string): Promise<Buffer> {
    const fullPath = path.join(this.root, key);
    if (!fs.existsSync(fullPath)) {
      throw new Error('Media file not found');
    }
    try {
      return fs.readFileSync(fullPath);
    } catch {
      throw new StorageUnavailableError('Local storage read failed: underlying storage is unavailable.');
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
    const fullPath = path.join(this.root, key);
    try {
      fs.lstatSync(fullPath);
      return true;
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        return false;
      }
      throw new StorageUnavailableError(
        'Local storage existence check failed: underlying storage is unavailable.'
      );
    }
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
  private static activeLocalRoot: string = PrivateStorageService.STORAGE_ROOT;
  // Process cache backed by an atomic durable on-disk invalidation ledger (.invalidated_media.json)
  // plus a pre-initialized append-only companion WAL (.invalidated_media.json.wal) so revoked,
  // cancelled, or deleted media stays permanently inaccessible across process restarts even if
  // underlying storage cleanup fails or directory-level rename permissions degrade at runtime.
  private static invalidatedMedia: Map<string, InvalidatedMediaEntry> = new Map();
  private static invalidatedVoices: Map<string, InvalidatedVoiceEntry> = new Map();
  private static persistedMediaCatalog: Map<string, PersistedMediaCatalogEntry> = new Map();
  private static unpersistedInvalidationsByPath: Map<string, Map<string, InvalidatedMediaEntry>> =
    new Map();
  private static unpersistedVoicesByPath: Map<string, Map<string, InvalidatedVoiceEntry>> =
    new Map();
  private static initializedLedgerPaths: Set<string> = new Set();
  private static loadedTombstonePath: string | null = null;
  private static loadedTombstoneSignature: string | null = null;
  private static tombstoneLedgerHealthy: boolean = true;
  private static tombstoneLedgerError: string | null = null;
  private static persistSeq: number = 0;
  private static testPersistenceHook:
    | ((stage: LedgerPersistenceStage, tmpPath: string, targetPath: string) => void)
    | null = null;

  public static setPersistenceHookForTesting(
    hook: ((stage: LedgerPersistenceStage, tmpPath: string, targetPath: string) => void) | null
  ): void {
    this.testPersistenceHook = hook;
  }

  /**
   * Pluggable storage provider injection
   */
  public static setProvider(customProvider: StorageProvider): void {
    this.provider = customProvider;
    if (customProvider instanceof LocalStorageProvider) {
      this.activeLocalRoot = customProvider.getRootDir();
    }
    this.ensureTombstonesLoaded();
  }

  public static getProvider(): StorageProvider {
    return this.provider;
  }

  public static getEffectiveTombstoneFilePath(): string {
    const explicitFile = process.env.VOICEFORGE_MEDIA_TOMBSTONE_FILE;
    if (typeof explicitFile === 'string' && explicitFile.trim().length > 0) {
      return path.resolve(explicitFile.trim());
    }
    if (this.provider instanceof LocalStorageProvider) {
      return path.join(this.provider.getRootDir(), '.invalidated_media.json');
    }
    const envDir = process.env.VOICEFORGE_STORAGE_DIR;
    if (typeof envDir === 'string' && envDir.trim().length > 0) {
      return path.join(path.resolve(envDir.trim()), '.invalidated_media.json');
    }
    return path.join(this.activeLocalRoot || this.STORAGE_ROOT, '.invalidated_media.json');
  }

  private static getEffectiveTombstoneWalPath(targetPath?: string): string {
    const base = targetPath || this.getEffectiveTombstoneFilePath();
    return `${base}.wal`;
  }

  private static getUnpersistedMapForPath(targetPath: string): Map<string, InvalidatedMediaEntry> {
    let map = this.unpersistedInvalidationsByPath.get(targetPath);
    if (!map) {
      map = new Map();
      this.unpersistedInvalidationsByPath.set(targetPath, map);
    }
    return map;
  }

  private static getUnpersistedVoiceMapForPath(
    targetPath: string
  ): Map<string, InvalidatedVoiceEntry> {
    let map = this.unpersistedVoicesByPath.get(targetPath);
    if (!map) {
      map = new Map();
      this.unpersistedVoicesByPath.set(targetPath, map);
    }
    return map;
  }

  private static hasUnpersistedInvalidation(mediaId: string, targetPath?: string): boolean {
    const p = targetPath || this.getEffectiveTombstoneFilePath();
    return Boolean(this.unpersistedInvalidationsByPath.get(p)?.has(mediaId));
  }

  private static isValidReason(reason: unknown): reason is MediaInvalidationReason {
    return (
      reason === 'consent_revoked' ||
      reason === 'voice_deleted' ||
      reason === 'job_cancelled' ||
      reason === 'manual_delete'
    );
  }

  private static isValidVoiceReason(reason: unknown): reason is VoiceInvalidationReason {
    return reason === 'consent_revoked' || reason === 'voice_deleted';
  }

  private static validateAndMergeVoiceEntry(
    item: any,
    options?: { skipIfPresent?: boolean }
  ): void {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.voiceId !== 'string' ||
      item.voiceId.length === 0 ||
      typeof item.ownerId !== 'string' ||
      item.ownerId.length === 0 ||
      !this.isValidVoiceReason(item.reason) ||
      typeof item.invalidatedAt !== 'string'
    ) {
      throw new Error('Malformed voice entry in media tombstone ledger');
    }

    const existing = this.invalidatedVoices.get(item.voiceId);
    if (existing && options?.skipIfPresent) {
      if (item.reason === 'consent_revoked' && existing.reason !== 'consent_revoked') {
        existing.reason = 'consent_revoked';
      }
      return;
    }

    const mergedReason: VoiceInvalidationReason =
      existing?.reason === 'consent_revoked' || item.reason === 'consent_revoked'
        ? 'consent_revoked'
        : item.reason;

    this.invalidatedVoices.set(item.voiceId, {
      voiceId: item.voiceId,
      ownerId: existing?.ownerId || item.ownerId,
      reason: mergedReason,
      invalidatedAt: existing?.invalidatedAt || item.invalidatedAt,
    });
  }

  private static validateAndMergeCatalogEntry(
    item: any,
    options?: { skipIfPresent?: boolean }
  ): void {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      item.id.length === 0 ||
      typeof item.ownerId !== 'string' ||
      item.ownerId.length === 0 ||
      typeof item.storageKey !== 'string' ||
      item.storageKey.length === 0 ||
      typeof item.createdAt !== 'string' ||
      (item.voiceId !== undefined && typeof item.voiceId !== 'string')
    ) {
      throw new Error('Malformed catalog entry in media tombstone ledger');
    }

    // Do not retain catalog records whose tombstone cleanup was already confirmed
    const existingTombstone = this.invalidatedMedia.get(item.id);
    if (existingTombstone && !existingTombstone.cleanupFailed) {
      this.persistedMediaCatalog.delete(item.id);
      return;
    }

    if (this.persistedMediaCatalog.has(item.id) && options?.skipIfPresent) {
      return;
    }

    this.persistedMediaCatalog.set(item.id, {
      id: item.id,
      ownerId: item.ownerId,
      voiceId: typeof item.voiceId === 'string' && item.voiceId.length > 0 ? item.voiceId : undefined,
      storageKey: item.storageKey,
      createdAt: item.createdAt,
    });
  }

  private static promoteVoiceInvalidationFromMediaEntrySync(entry: {
    voiceId?: string;
    ownerId: string;
    reason: MediaInvalidationReason;
    invalidatedAt: string;
  }): void {
    if (
      typeof entry.voiceId === 'string' &&
      entry.voiceId.length > 0 &&
      (entry.reason === 'consent_revoked' || entry.reason === 'voice_deleted')
    ) {
      this.validateAndMergeVoiceEntry({
        voiceId: entry.voiceId,
        ownerId: entry.ownerId,
        reason: entry.reason,
        invalidatedAt: entry.invalidatedAt,
      });
    }
  }

  private static validateAndMergeEntry(
    item: any,
    options?: { skipIfPresent?: boolean }
  ): void {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      item.id.length === 0 ||
      typeof item.ownerId !== 'string' ||
      item.ownerId.length === 0 ||
      !this.isValidReason(item.reason) ||
      typeof item.invalidatedAt !== 'string' ||
      typeof item.cleanupFailed !== 'boolean'
    ) {
      throw new Error('Malformed entry in media tombstone ledger');
    }

    const existing = this.invalidatedMedia.get(item.id);
    if (existing && options?.skipIfPresent) {
      if (item.reason === 'consent_revoked' && existing.reason !== 'consent_revoked') {
        existing.reason = 'consent_revoked';
      }
      if (!existing.storageKey && typeof item.storageKey === 'string') {
        existing.storageKey = item.storageKey;
      }
      if (!existing.voiceId && typeof item.voiceId === 'string') {
        existing.voiceId = item.voiceId;
      }
      this.promoteVoiceInvalidationFromMediaEntrySync(existing);
      if (!existing.cleanupFailed) {
        this.persistedMediaCatalog.delete(existing.id);
      }
      return;
    }

    const mergedReason: MediaInvalidationReason =
      existing?.reason === 'consent_revoked' || item.reason === 'consent_revoked'
        ? 'consent_revoked'
        : item.reason;

    const mergedEntry: InvalidatedMediaEntry = {
      id: item.id,
      ownerId: item.ownerId,
      voiceId: typeof item.voiceId === 'string' ? item.voiceId : existing?.voiceId,
      storageKey: typeof item.storageKey === 'string' ? item.storageKey : existing?.storageKey,
      reason: mergedReason,
      invalidatedAt: item.invalidatedAt,
      cleanupFailed: item.cleanupFailed,
      cleanupFailureCode:
        item.cleanupFailed && typeof item.cleanupFailureCode === 'string'
          ? item.cleanupFailureCode
          : undefined,
    };

    this.invalidatedMedia.set(item.id, mergedEntry);
    this.promoteVoiceInvalidationFromMediaEntrySync(mergedEntry);
    if (!mergedEntry.cleanupFailed) {
      this.persistedMediaCatalog.delete(mergedEntry.id);
    }
  }

  private static fsyncDirectorySync(dirPath: string): void {
    let dirFd: number | null = null;
    try {
      dirFd = fs.openSync(dirPath, fs.constants.O_RDONLY);
      fs.fsyncSync(dirFd);
    } catch (err: any) {
      if (err && (err.code === 'EINVAL' || err.code === 'ENOTSUP' || err.code === 'EBADF')) {
        return;
      }
      throw err;
    } finally {
      if (dirFd !== null) {
        try {
          fs.closeSync(dirFd);
        } catch {}
      }
    }
  }

  private static findNearestExistingAncestorSync(startDir: string): string | null {
    let cur = path.resolve(startDir);
    while (true) {
      if (fs.existsSync(cur)) {
        return cur;
      }
      const parent = path.dirname(cur);
      if (parent === cur) {
        return null;
      }
      cur = parent;
    }
  }

  /**
   * Verifies that the ledger directory (or nearest existing ancestor) and any existing ledger/WAL
   * files are regular writable files/directories. Checks both POSIX owner-write mode bits and
   * kernel `accessSync` so permission regressions are caught under both unprivileged and root UIDs.
   */
  private static isLedgerLocationWritableSync(targetPath: string): boolean {
    try {
      const dir = path.dirname(targetPath);
      const checkDir = this.findNearestExistingAncestorSync(dir);
      if (!checkDir) {
        return false;
      }
      const dirStat = fs.statSync(checkDir);
      if (!dirStat.isDirectory() || (dirStat.mode & 0o200) === 0) {
        return false;
      }
      fs.accessSync(checkDir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);

      if (fs.existsSync(targetPath)) {
        const lstat = fs.lstatSync(targetPath);
        if (!lstat.isFile() || lstat.isSymbolicLink() || (lstat.mode & 0o200) === 0) {
          return false;
        }
        fs.accessSync(targetPath, fs.constants.R_OK | fs.constants.W_OK);
      }

      const walPath = this.getEffectiveTombstoneWalPath(targetPath);
      if (fs.existsSync(walPath)) {
        const walStat = fs.lstatSync(walPath);
        if (!walStat.isFile() || walStat.isSymbolicLink() || (walStat.mode & 0o200) === 0) {
          return false;
        }
        fs.accessSync(walPath, fs.constants.R_OK | fs.constants.W_OK);
      }

      return true;
    } catch {
      return false;
    }
  }

  private static directoryContainsNonTrivialEntriesSync(dirPath: string, targetPath: string): boolean {
    if (!fs.existsSync(dirPath)) {
      return false;
    }
    try {
      const entries = fs.readdirSync(dirPath);
      const ledgerBase = path.basename(targetPath);
      for (const name of entries) {
        if (name === '.gitkeep' || name === '.DS_Store' || name === ledgerBase) {
          continue;
        }
        return true;
      }
      return false;
    } catch {
      // Unreadable existing storage directory is treated conservatively (fail-closed)
      return true;
    }
  }

  /**
   * Determines whether private media artifacts may already exist when `.invalidated_media.json`
   * is missing (`ENOENT`). Never treats a missing ledger as empty when any storage root or WAL
   * indicates prior initialization or stored private media.
   */
  private static mayPrivateArtifactsExistSync(targetPath: string): boolean {
    if (this.initializedLedgerPaths.has(targetPath)) {
      return true;
    }
    const walPath = this.getEffectiveTombstoneWalPath(targetPath);
    if (fs.existsSync(walPath)) {
      return true;
    }

    const dirsToInspect = new Set<string>([path.resolve(path.dirname(targetPath))]);
    if (this.provider instanceof LocalStorageProvider) {
      dirsToInspect.add(path.resolve(this.provider.getRootDir()));
    } else if (
      typeof process.env.VOICEFORGE_STORAGE_DIR === 'string' &&
      process.env.VOICEFORGE_STORAGE_DIR.trim().length > 0
    ) {
      dirsToInspect.add(path.resolve(process.env.VOICEFORGE_STORAGE_DIR.trim()));
    }

    for (const d of dirsToInspect) {
      if (this.directoryContainsNonTrivialEntriesSync(d, targetPath)) {
        return true;
      }
    }

    if (
      !(this.provider instanceof LocalStorageProvider) &&
      (memoryStore.privateMedia as PrivateMediaRecord[]).length > 0
    ) {
      return true;
    }

    return false;
  }

  private static computeLedgerDiskSignatureSync(targetPath: string): {
    exists: boolean;
    signature: string;
    walHasBytes: boolean;
  } {
    const stat = fs.lstatSync(targetPath, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) {
      const err: any = new Error('Tombstone ledger path is not a regular file');
      err.code = 'ENOTREG';
      throw err;
    }
    const walPath = this.getEffectiveTombstoneWalPath(targetPath);
    let walPart = 'nowal';
    let walHasBytes = false;
    if (fs.existsSync(walPath)) {
      const walStat = fs.lstatSync(walPath, { bigint: true });
      if (!walStat.isFile() || walStat.isSymbolicLink()) {
        const err: any = new Error('Tombstone WAL path is not a regular file');
        err.code = 'ENOTREG_WAL';
        throw err;
      }
      walHasBytes = walStat.size > 0n;
      walPart = `${walStat.ino}:${walStat.size}:${walStat.mtimeNs}:${walStat.ctimeNs}`;
    }
    return {
      exists: true,
      signature: `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}|${walPart}`,
      walHasBytes,
    };
  }

  private static appendEmergencyWalSync(
    targetPath: string,
    entries: InvalidatedMediaEntry[],
    voiceEntries: InvalidatedVoiceEntry[] = []
  ): boolean {
    const walPath = this.getEffectiveTombstoneWalPath(targetPath);
    try {
      if (!fs.existsSync(walPath)) {
        return false;
      }
      const walStat = fs.lstatSync(walPath);
      if (!walStat.isFile() || walStat.isSymbolicLink()) {
        return false;
      }
      const serializedLines: string[] = [];
      for (const ve of voiceEntries) {
        serializedLines.push(JSON.stringify({ v: 1, voiceEntry: ve }));
      }
      for (const e of entries) {
        serializedLines.push(JSON.stringify({ v: 1, entry: e }));
      }
      if (serializedLines.length === 0) {
        return true;
      }
      const lines = serializedLines.join('\n') + '\n';
      const fd = fs.openSync(walPath, 'a');
      try {
        fs.writeFileSync(fd, lines, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch {
      return false;
    }
  }

  private static ensureWalFilePresentSync(targetPath: string): void {
    const walPath = this.getEffectiveTombstoneWalPath(targetPath);
    const dir = path.dirname(walPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(walPath)) {
      const fd = fs.openSync(walPath, 'w', 0o600);
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      this.fsyncDirectorySync(dir);
    }
  }

  private static clearWalFileSync(targetPath: string): void {
    const walPath = this.getEffectiveTombstoneWalPath(targetPath);
    if (!fs.existsSync(walPath)) {
      this.ensureWalFilePresentSync(targetPath);
      return;
    }
    const fd = fs.openSync(walPath, 'r+');
    try {
      fs.ftruncateSync(fd, 0);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  private static writeLedgerSnapshotInternalSync(
    targetPath: string,
    stage: LedgerPersistenceStage = 'general'
  ): void {
    const dir = path.dirname(targetPath);
    const seq = ++this.persistSeq;
    const tmpPath = `${targetPath}.tmp.${process.pid}.${seq}.${crypto.randomBytes(6).toString('hex')}`;

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      if (!this.isLedgerLocationWritableSync(targetPath)) {
        throw new Error('Ledger location is not writable');
      }

      // Prune any catalog entries whose tombstone cleanup was already confirmed
      for (const [id, inv] of this.invalidatedMedia.entries()) {
        if (!inv.cleanupFailed) {
          this.persistedMediaCatalog.delete(id);
        }
      }

      const payload = JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          entries: Array.from(this.invalidatedMedia.values()),
          invalidatedVoices: Array.from(this.invalidatedVoices.values()),
          mediaCatalog: Array.from(this.persistedMediaCatalog.values()),
        },
        null,
        2
      );

      const fd = fs.openSync(tmpPath, 'w', 0o600);
      try {
        fs.writeFileSync(fd, payload, 'utf8');
        if (this.testPersistenceHook) {
          this.testPersistenceHook(stage, tmpPath, targetPath);
        }
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      fs.renameSync(tmpPath, targetPath);
      this.ensureWalFilePresentSync(targetPath);
      this.clearWalFileSync(targetPath);
      this.fsyncDirectorySync(dir);

      const sigInfo = this.computeLedgerDiskSignatureSync(targetPath);
      this.loadedTombstonePath = targetPath;
      this.loadedTombstoneSignature = sigInfo.signature;
      this.initializedLedgerPaths.add(targetPath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {}
      throw err;
    }
  }

  private static isUnrecoverableLedgerError(code: string | null): boolean {
    return (
      code === 'MEDIA_TOMBSTONE_LEDGER_MISSING_WITH_ARTIFACTS' ||
      code === 'MEDIA_TOMBSTONE_LEDGER_CORRUPTED_OR_UNREADABLE' ||
      code === 'MEDIA_TOMBSTONE_WAL_CORRUPTED' ||
      code === 'MEDIA_TOMBSTONE_LEDGER_NOT_REGULAR_FILE' ||
      code === 'MEDIA_TOMBSTONE_LEDGER_STAT_FAILED'
    );
  }

  /**
   * Loads and synchronizes durable media invalidation tombstones, voice-level revocations,
   * shared media catalog metadata, and any emergency WAL entries from disk.
   * Fails closed if the tombstone ledger is missing while artifacts may exist, corrupted, unreadable,
   * unwritable, or carrying unpersisted invalidations that cannot yet be flushed to disk.
   */
  private static ensureTombstonesLoaded(): void {
    const targetPath = this.getEffectiveTombstoneFilePath();
    const unpersistedForPath = this.getUnpersistedMapForPath(targetPath);
    const unpersistedVoicesForPath = this.getUnpersistedVoiceMapForPath(targetPath);

    if (this.loadedTombstonePath !== targetPath) {
      this.invalidatedMedia.clear();
      this.invalidatedVoices.clear();
      this.persistedMediaCatalog.clear();
      for (const [, pendingVoice] of unpersistedVoicesForPath.entries()) {
        this.validateAndMergeVoiceEntry(pendingVoice);
      }
      for (const [, pendingEntry] of unpersistedForPath.entries()) {
        this.validateAndMergeEntry(pendingEntry);
      }
      this.loadedTombstonePath = targetPath;
      this.loadedTombstoneSignature = null;
      this.tombstoneLedgerHealthy = true;
      this.tombstoneLedgerError = null;
    } else {
      // Ensure sticky unpersisted entries remain present in memory cache
      for (const [vId, pendingVoice] of unpersistedVoicesForPath.entries()) {
        if (!this.invalidatedVoices.has(vId)) {
          this.validateAndMergeVoiceEntry(pendingVoice);
        }
      }
      for (const [id, pendingEntry] of unpersistedForPath.entries()) {
        if (!this.invalidatedMedia.has(id)) {
          this.validateAndMergeEntry(pendingEntry);
        }
      }
    }

    let diskSig: { exists: boolean; signature: string; walHasBytes: boolean };
    try {
      diskSig = this.computeLedgerDiskSignatureSync(targetPath);
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        if (
          unpersistedForPath.size > 0 ||
          unpersistedVoicesForPath.size > 0 ||
          this.mayPrivateArtifactsExistSync(targetPath)
        ) {
          this.tombstoneLedgerHealthy = false;
          this.tombstoneLedgerError = 'MEDIA_TOMBSTONE_LEDGER_MISSING_WITH_ARTIFACTS';
          return;
        }
        if (!this.isLedgerLocationWritableSync(targetPath)) {
          this.tombstoneLedgerHealthy = false;
          this.tombstoneLedgerError = 'MEDIA_TOMBSTONE_LEDGER_UNWRITABLE';
          return;
        }
        this.tombstoneLedgerHealthy = true;
        this.tombstoneLedgerError = null;
        return;
      }
      if (err && (err.code === 'ENOTREG' || err.code === 'ENOTREG_WAL')) {
        this.tombstoneLedgerHealthy = false;
        this.tombstoneLedgerError = 'MEDIA_TOMBSTONE_LEDGER_NOT_REGULAR_FILE';
        return;
      }
      this.tombstoneLedgerHealthy = false;
      this.tombstoneLedgerError = 'MEDIA_TOMBSTONE_LEDGER_STAT_FAILED';
      return;
    }

    const writable = this.isLedgerLocationWritableSync(targetPath);

    const needsDiskReload =
      !this.tombstoneLedgerHealthy ||
      this.loadedTombstoneSignature === null ||
      diskSig.signature !== this.loadedTombstoneSignature ||
      diskSig.walHasBytes;

    if (needsDiskReload) {
      let parsed: any;
      try {
        const raw = fs.readFileSync(targetPath, 'utf8');
        parsed = JSON.parse(raw);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !Array.isArray(parsed.entries) ||
          ('invalidatedVoices' in parsed &&
            parsed.invalidatedVoices !== undefined &&
            !Array.isArray(parsed.invalidatedVoices)) ||
          ('mediaCatalog' in parsed &&
            parsed.mediaCatalog !== undefined &&
            !Array.isArray(parsed.mediaCatalog))
        ) {
          throw new Error('Malformed media tombstone ledger schema');
        }

        if (Array.isArray(parsed.invalidatedVoices)) {
          for (const vItem of parsed.invalidatedVoices) {
            this.validateAndMergeVoiceEntry(vItem);
          }
        }
        for (const item of parsed.entries) {
          this.validateAndMergeEntry(item);
        }
        if (Array.isArray(parsed.mediaCatalog)) {
          // Retain local in-memory active catalog records alongside newly synced disk catalog records
          const activeLocalIds = new Set(
            (memoryStore.privateMedia as PrivateMediaRecord[]).map((m) => m.id)
          );
          for (const existingId of Array.from(this.persistedMediaCatalog.keys())) {
            if (!activeLocalIds.has(existingId)) {
              this.persistedMediaCatalog.delete(existingId);
            }
          }
          for (const cItem of parsed.mediaCatalog) {
            this.validateAndMergeCatalogEntry(cItem);
          }
        }
      } catch {
        this.tombstoneLedgerHealthy = false;
        this.tombstoneLedgerError = 'MEDIA_TOMBSTONE_LEDGER_CORRUPTED_OR_UNREADABLE';
        return;
      }

      const walPath = this.getEffectiveTombstoneWalPath(targetPath);
      if (fs.existsSync(walPath)) {
        try {
          const walRaw = fs.readFileSync(walPath, 'utf8');
          if (walRaw.length > 0) {
            const lines = walRaw.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              const walObj = JSON.parse(trimmed);
              if (walObj && typeof walObj === 'object' && 'voiceEntry' in walObj) {
                this.validateAndMergeVoiceEntry(walObj.voiceEntry);
              } else {
                const candidate =
                  walObj && typeof walObj === 'object' && 'entry' in walObj
                    ? walObj.entry
                    : walObj;
                this.validateAndMergeEntry(candidate);
              }
            }
          }
        } catch {
          this.tombstoneLedgerHealthy = false;
          this.tombstoneLedgerError = 'MEDIA_TOMBSTONE_WAL_CORRUPTED';
          return;
        }
      }

      // Re-apply any unpersisted in-memory invalidations on top of disk entries
      for (const pendingVoice of unpersistedVoicesForPath.values()) {
        this.validateAndMergeVoiceEntry(pendingVoice);
      }
      for (const pendingEntry of unpersistedForPath.values()) {
        this.validateAndMergeEntry(pendingEntry);
      }

      this.loadedTombstoneSignature = diskSig.signature;
      this.initializedLedgerPaths.add(targetPath);
    }

    if (!writable) {
      this.tombstoneLedgerHealthy = false;
      this.tombstoneLedgerError = 'MEDIA_TOMBSTONE_LEDGER_UNWRITABLE';
      return;
    }

    // Never clear unpersisted invalidations or replay-pending WAL entries without durably compacting them first
    if (unpersistedForPath.size > 0 || unpersistedVoicesForPath.size > 0 || diskSig.walHasBytes) {
      try {
        this.writeLedgerSnapshotInternalSync(targetPath, 'general');
        unpersistedForPath.clear();
        unpersistedVoicesForPath.clear();
        this.tombstoneLedgerHealthy = true;
        this.tombstoneLedgerError = null;
      } catch {
        this.tombstoneLedgerHealthy = false;
        this.tombstoneLedgerError = 'MEDIA_TOMBSTONE_LEDGER_PERSIST_FAILED';
      }
      return;
    }

    this.tombstoneLedgerHealthy = true;
    this.tombstoneLedgerError = null;
  }

  /**
   * Ensures the durable invalidation ledger and companion WAL exist and are writable BEFORE any
   * private media bytes are persisted to storage, preventing populated storage roots from ever
   * starting life without an authoritative ledger file.
   */
  private static ensureLedgerInitializedBeforeStoreSync(): void {
    const targetPath = this.getEffectiveTombstoneFilePath();
    this.ensureTombstonesLoaded();
    if (!this.tombstoneLedgerHealthy) {
      throw new StorageUnavailableError(
        `Private media invalidation ledger unavailable (${this.tombstoneLedgerError || 'LEDGER_ERROR'}); refusing to store private media.`
      );
    }

    const walPath = this.getEffectiveTombstoneWalPath(targetPath);
    if (!fs.existsSync(targetPath) || !fs.existsSync(walPath)) {
      if (!this.persistTombstonesSync()) {
        throw new StorageUnavailableError(
          `Private media invalidation ledger could not be initialized (${this.tombstoneLedgerError || 'LEDGER_INIT_FAILED'}).`
        );
      }
    }
  }

  private static checkDiskRecoverableAndMergeUnseenSync(
    targetPath: string
  ): { ok: true } | { ok: false; code: string } {
    try {
      this.computeLedgerDiskSignatureSync(targetPath);
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        if (
          this.tombstoneLedgerError === 'MEDIA_TOMBSTONE_LEDGER_MISSING_WITH_ARTIFACTS' ||
          this.mayPrivateArtifactsExistSync(targetPath)
        ) {
          return { ok: false, code: 'MEDIA_TOMBSTONE_LEDGER_MISSING_WITH_ARTIFACTS' };
        }
        return { ok: true };
      }
      if (err && (err.code === 'ENOTREG' || err.code === 'ENOTREG_WAL')) {
        return { ok: false, code: 'MEDIA_TOMBSTONE_LEDGER_NOT_REGULAR_FILE' };
      }
      return { ok: false, code: 'MEDIA_TOMBSTONE_LEDGER_STAT_FAILED' };
    }

    try {
      const raw = fs.readFileSync(targetPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Array.isArray(parsed.entries) ||
        ('invalidatedVoices' in parsed &&
          parsed.invalidatedVoices !== undefined &&
          !Array.isArray(parsed.invalidatedVoices)) ||
        ('mediaCatalog' in parsed &&
          parsed.mediaCatalog !== undefined &&
          !Array.isArray(parsed.mediaCatalog))
      ) {
        return { ok: false, code: 'MEDIA_TOMBSTONE_LEDGER_CORRUPTED_OR_UNREADABLE' };
      }
      if (Array.isArray(parsed.invalidatedVoices)) {
        for (const vItem of parsed.invalidatedVoices) {
          this.validateAndMergeVoiceEntry(vItem, { skipIfPresent: true });
        }
      }
      for (const item of parsed.entries) {
        this.validateAndMergeEntry(item, { skipIfPresent: true });
      }
      if (Array.isArray(parsed.mediaCatalog)) {
        for (const cItem of parsed.mediaCatalog) {
          this.validateAndMergeCatalogEntry(cItem, { skipIfPresent: true });
        }
      }
    } catch {
      return { ok: false, code: 'MEDIA_TOMBSTONE_LEDGER_CORRUPTED_OR_UNREADABLE' };
    }

    const walPath = this.getEffectiveTombstoneWalPath(targetPath);
    if (fs.existsSync(walPath)) {
      try {
        const walRaw = fs.readFileSync(walPath, 'utf8');
        if (walRaw.length > 0) {
          for (const line of walRaw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const walObj = JSON.parse(trimmed);
            if (walObj && typeof walObj === 'object' && 'voiceEntry' in walObj) {
              this.validateAndMergeVoiceEntry(walObj.voiceEntry, { skipIfPresent: true });
            } else {
              const candidate =
                walObj && typeof walObj === 'object' && 'entry' in walObj
                  ? walObj.entry
                  : walObj;
              this.validateAndMergeEntry(candidate, { skipIfPresent: true });
            }
          }
        }
      } catch {
        return { ok: false, code: 'MEDIA_TOMBSTONE_WAL_CORRUPTED' };
      }
    }

    return { ok: true };
  }

  /**
   * Atomically persists the invalidation tombstone registry to disk via write-temp + fsync + rename + dir-fsync.
   * Refuses to overwrite an unrecoverable corrupted/missing-with-artifacts primary ledger. If directory-level
   * atomic rename fails while the pre-initialized WAL remains writable, records an emergency durable WAL entry
   * while still marking the primary ledger unhealthy (fail-closed) and returning `false`.
   */
  private static persistTombstonesSync(
    emergencyEntries: InvalidatedMediaEntry[] = [],
    emergencyVoices: InvalidatedVoiceEntry[] = [],
    stage: LedgerPersistenceStage = 'general'
  ): boolean {
    const targetPath = this.getEffectiveTombstoneFilePath();
    const unpersistedForPath = this.getUnpersistedMapForPath(targetPath);
    const unpersistedVoicesForPath = this.getUnpersistedVoiceMapForPath(targetPath);

    const diskCheck = this.checkDiskRecoverableAndMergeUnseenSync(targetPath);
    if (!diskCheck.ok) {
      for (const vEntry of emergencyVoices) {
        unpersistedVoicesForPath.set(vEntry.voiceId, { ...vEntry });
      }
      for (const entry of emergencyEntries) {
        unpersistedForPath.set(entry.id, { ...entry });
      }
      if (emergencyEntries.length > 0 || emergencyVoices.length > 0) {
        this.appendEmergencyWalSync(targetPath, emergencyEntries, emergencyVoices);
      }
      this.tombstoneLedgerHealthy = false;
      this.tombstoneLedgerError = diskCheck.code;
      return false;
    }

    try {
      this.writeLedgerSnapshotInternalSync(targetPath, stage);
      unpersistedForPath.clear();
      unpersistedVoicesForPath.clear();
      this.tombstoneLedgerHealthy = true;
      this.tombstoneLedgerError = null;
      return true;
    } catch {
      for (const vEntry of emergencyVoices) {
        unpersistedVoicesForPath.set(vEntry.voiceId, { ...vEntry });
      }
      for (const entry of emergencyEntries) {
        unpersistedForPath.set(entry.id, { ...entry });
      }
      const candidates =
        emergencyEntries.length > 0 ? emergencyEntries : Array.from(unpersistedForPath.values());
      const voiceCandidates =
        emergencyVoices.length > 0
          ? emergencyVoices
          : Array.from(unpersistedVoicesForPath.values());
      if (candidates.length > 0 || voiceCandidates.length > 0) {
        this.appendEmergencyWalSync(targetPath, candidates, voiceCandidates);
      }
      this.tombstoneLedgerHealthy = false;
      this.tombstoneLedgerError = 'MEDIA_TOMBSTONE_LEDGER_PERSIST_FAILED';
      return false;
    }
  }

  public static isInvalidationLedgerHealthy(): boolean {
    this.ensureTombstonesLoaded();
    return this.tombstoneLedgerHealthy;
  }

  public static assertInvalidationLedgerHealthy(): void {
    if (!this.isInvalidationLedgerHealthy()) {
      throw new StorageUnavailableError(
        `Private media invalidation ledger unavailable (${this.tombstoneLedgerError || 'LEDGER_ERROR'}); failing closed.`
      );
    }
  }

  /**
   * Executes or verifies physical byte cleanup for a storage key without conflating
   * authorization denial with physical removal:
   * - Distinguishes genuinely absent artifacts (`ENOENT` on available storage) from
   *   stat/permission errors (`EACCES`/`EIO`).
   * - When the artifact exists prior to deletion, requires BOTH `provider.delete() === true`
   *   AND verified post-delete absence (`provider.exists() === false`) before reporting
   *   physical cleanup complete.
   */
  private static async verifyOrPerformPhysicalCleanup(storageKey?: string): Promise<{
    deletedFromProvider: boolean;
    physicalCleanupConfirmed: boolean;
    failureCode?: string;
  }> {
    if (!storageKey) {
      return { deletedFromProvider: false, physicalCleanupConfirmed: true };
    }

    let existedBeforeDelete = true;
    try {
      existedBeforeDelete = await this.provider.exists(storageKey);
    } catch (err) {
      return {
        deletedFromProvider: false,
        physicalCleanupConfirmed: false,
        failureCode:
          err instanceof StorageUnavailableError
            ? 'STORAGE_UNAVAILABLE_ON_DELETE'
            : 'PROVIDER_EXISTS_CHECK_FAILED',
      };
    }

    if (!existedBeforeDelete) {
      let providerAvailable = false;
      try {
        providerAvailable = await this.provider.isAvailable();
      } catch {
        providerAvailable = false;
      }
      if (!providerAvailable) {
        return {
          deletedFromProvider: false,
          physicalCleanupConfirmed: false,
          failureCode: 'STORAGE_UNAVAILABLE_ON_DELETE',
        };
      }

      let reportedDeleted = false;
      try {
        reportedDeleted = await this.provider.delete(storageKey);
      } catch {
        // Best-effort idempotent provider notification for an already-missing key
      }

      try {
        const stillExists = await this.provider.exists(storageKey);
        if (!stillExists) {
          return {
            deletedFromProvider: reportedDeleted,
            physicalCleanupConfirmed: true,
          };
        }
        return {
          deletedFromProvider: false,
          physicalCleanupConfirmed: false,
          failureCode: 'PROVIDER_BYTES_STILL_PRESENT_AFTER_DELETE',
        };
      } catch (err) {
        return {
          deletedFromProvider: false,
          physicalCleanupConfirmed: false,
          failureCode:
            err instanceof StorageUnavailableError
              ? 'STORAGE_UNAVAILABLE_ON_DELETE'
              : 'PROVIDER_EXISTS_CHECK_FAILED',
        };
      }
    }

    try {
      const providerReportedDeleted = await this.provider.delete(storageKey);
      let stillExists = true;
      try {
        stillExists = await this.provider.exists(storageKey);
      } catch {
        stillExists = true;
      }

      if (!providerReportedDeleted || stillExists) {
        return {
          deletedFromProvider: false,
          physicalCleanupConfirmed: false,
          failureCode:
            stillExists && providerReportedDeleted
              ? 'PROVIDER_BYTES_STILL_PRESENT_AFTER_DELETE'
              : 'PROVIDER_DELETE_RETURNED_FALSE',
        };
      }

      return {
        deletedFromProvider: true,
        physicalCleanupConfirmed: true,
      };
    } catch (err) {
      return {
        deletedFromProvider: false,
        physicalCleanupConfirmed: false,
        failureCode:
          err instanceof StorageUnavailableError
            ? 'STORAGE_UNAVAILABLE_ON_DELETE'
            : 'PROVIDER_DELETE_EXCEPTION',
      };
    }
  }

  /**
   * Retries physical byte deletion (and connected DB metadata cleanup) for any durable tombstones
   * whose prior cleanup failed or was interrupted mid-flight (`cleanupFailed: true`), and promotes
   * any cataloged artifacts belonging to a durably invalidated voice into pending cleanup tombstones
   * before deleting them. Clears `cleanupFailed` ONLY after confirming physical absence + DB cleanup
   * AND durably persisting.
   */
  public static async reconcilePendingDeletions(): Promise<{
    attempted: number;
    resolved: number;
    stillFailing: number;
  }> {
    this.ensureTombstonesLoaded();
    if (!this.tombstoneLedgerHealthy) {
      throw new StorageUnavailableError('Cannot reconcile deletions while tombstone ledger is unhealthy');
    }

    // Promote any cataloged or in-memory artifacts whose voiceId has a durable voice-level
    // invalidation record (covers crash between voice_barrier Step 1A and batch_tombstones Step 1B,
    // or cross-worker stored artifacts) into durable CLEANUP_PENDING tombstones BEFORE physical unlink.
    const promotedFromVoiceBarrier: InvalidatedMediaEntry[] = [];
    const nowIso = new Date().toISOString();

    for (const cat of this.persistedMediaCatalog.values()) {
      if (!cat.voiceId) continue;
      const vInv = this.invalidatedVoices.get(cat.voiceId);
      if (!vInv) continue;
      const existing = this.invalidatedMedia.get(cat.id);
      if (!existing) {
        const promoted: InvalidatedMediaEntry = {
          id: cat.id,
          ownerId: cat.ownerId || vInv.ownerId,
          voiceId: cat.voiceId,
          storageKey: cat.storageKey,
          reason: vInv.reason,
          invalidatedAt: vInv.invalidatedAt || nowIso,
          cleanupFailed: true,
          cleanupFailureCode: 'CLEANUP_PENDING',
        };
        this.invalidatedMedia.set(cat.id, promoted);
        promotedFromVoiceBarrier.push(promoted);
      } else if (vInv.reason === 'consent_revoked' && existing.reason !== 'consent_revoked') {
        existing.reason = 'consent_revoked';
        promotedFromVoiceBarrier.push(existing);
      }
    }

    const mediaList = memoryStore.privateMedia as PrivateMediaRecord[];
    for (let i = mediaList.length - 1; i >= 0; i--) {
      const m = mediaList[i];
      if (!m.voiceId) continue;
      const vInv = this.invalidatedVoices.get(m.voiceId);
      if (!vInv) continue;
      if (!this.invalidatedMedia.has(m.id)) {
        const promoted: InvalidatedMediaEntry = {
          id: m.id,
          ownerId: m.userId || vInv.ownerId,
          voiceId: m.voiceId,
          storageKey: m.storageKey,
          reason: vInv.reason,
          invalidatedAt: vInv.invalidatedAt || nowIso,
          cleanupFailed: true,
          cleanupFailureCode: 'CLEANUP_PENDING',
        };
        this.invalidatedMedia.set(m.id, promoted);
        promotedFromVoiceBarrier.push(promoted);
      }
      mediaList.splice(i, 1);
    }

    if (promotedFromVoiceBarrier.length > 0) {
      if (!this.persistTombstonesSync(promotedFromVoiceBarrier, [], 'batch_tombstones')) {
        throw new StorageUnavailableError(
          'Failed to persist promoted voice-revocation tombstones prior to reconciliation'
        );
      }
    }

    let attempted = 0;
    let resolved = 0;
    let stillFailing = 0;
    const newlyResolved: Array<{
      entry: InvalidatedMediaEntry;
      prevCode?: string;
      prevCatalog?: PersistedMediaCatalogEntry;
    }> = [];

    for (const entry of this.invalidatedMedia.values()) {
      if (!entry.cleanupFailed) continue;
      attempted++;
      const cleanupRes = await this.verifyOrPerformPhysicalCleanup(entry.storageKey);
      const dbOutcome = await this.deleteFromDatabaseIfConnected(entry.id);
      if (cleanupRes.physicalCleanupConfirmed && dbOutcome.ok) {
        const prevCode = entry.cleanupFailureCode;
        const prevCatalog = this.persistedMediaCatalog.get(entry.id);
        entry.cleanupFailed = false;
        delete entry.cleanupFailureCode;
        this.persistedMediaCatalog.delete(entry.id);
        newlyResolved.push({ entry, prevCode, prevCatalog });
        resolved++;
      } else {
        entry.cleanupFailureCode =
          cleanupRes.failureCode || (!dbOutcome.ok ? 'DATABASE_DELETE_FAILED' : entry.cleanupFailureCode);
        stillFailing++;
      }
    }

    if (newlyResolved.length > 0) {
      if (!this.persistTombstonesSync([], [], 'reconcile_persist')) {
        for (const item of newlyResolved) {
          item.entry.cleanupFailed = true;
          if (item.prevCode) {
            item.entry.cleanupFailureCode = item.prevCode;
          }
          if (item.prevCatalog) {
            this.persistedMediaCatalog.set(item.entry.id, item.prevCatalog);
          }
        }
        throw new StorageUnavailableError('Failed to persist reconciled tombstone state');
      }
    }

    return { attempted, resolved, stillFailing };
  }

  public static resetTombstonesForTesting(): void {
    const targetPath = this.getEffectiveTombstoneFilePath();
    const walPath = this.getEffectiveTombstoneWalPath(targetPath);
    const dir = path.dirname(targetPath);
    this.invalidatedMedia.clear();
    this.invalidatedVoices.clear();
    this.persistedMediaCatalog.clear();
    this.unpersistedInvalidationsByPath.delete(targetPath);
    this.unpersistedVoicesByPath.delete(targetPath);
    this.initializedLedgerPaths.delete(targetPath);
    this.loadedTombstonePath = targetPath;
    this.loadedTombstoneSignature = null;
    this.tombstoneLedgerHealthy = true;
    this.tombstoneLedgerError = null;
    this.testPersistenceHook = null;
    try {
      if (fs.existsSync(walPath)) {
        fs.unlinkSync(walPath);
      }
    } catch {}
    try {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    } catch {}
    if (this.directoryContainsNonTrivialEntriesSync(dir, targetPath)) {
      try {
        this.writeLedgerSnapshotInternalSync(targetPath, 'general');
      } catch {}
    }
  }

  /**
   * Retrieves the HMAC signing secret with fail-closed behavior in staging and production.
   * Never logs secret values.
   */
  public static getSigningSecret(): string {
    const raw = process.env.VOICEFORGE_STORAGE_SECRET;
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    const restricted = isRestrictedEnvironment(process.env.NODE_ENV);

    if (trimmed.length === 0) {
      if (restricted) {
        throw new Error(
          'FATAL SECURITY CONFIGURATION: VOICEFORGE_STORAGE_SECRET must be explicitly configured in staging and production.'
        );
      }
      return DEV_FALLBACK_STORAGE_SECRET;
    }

    if (restricted && (trimmed.length < 16 || trimmed === DEV_FALLBACK_STORAGE_SECRET)) {
      throw new Error(
        'FATAL SECURITY CONFIGURATION: VOICEFORGE_STORAGE_SECRET is invalid or uses a non-production fallback secret in staging/production.'
      );
    }

    return trimmed;
  }

  private static findKnownMediaContextSync(mediaId: string): {
    ownerId: string;
    voiceId?: string;
    storageKey?: string;
  } | undefined {
    const inMem = (memoryStore.privateMedia as PrivateMediaRecord[]).find((m) => m.id === mediaId);
    if (inMem) {
      return {
        ownerId: inMem.userId,
        voiceId: inMem.voiceId,
        storageKey: inMem.storageKey,
      };
    }
    const inCat = this.persistedMediaCatalog.get(mediaId);
    if (inCat) {
      return {
        ownerId: inCat.ownerId,
        voiceId: inCat.voiceId,
        storageKey: inCat.storageKey,
      };
    }
    return undefined;
  }

  private static resolveEffectiveInvalidationSync(
    mediaId: string
  ): InvalidatedMediaEntry | undefined {
    const direct = this.invalidatedMedia.get(mediaId);
    if (direct) {
      if (direct.voiceId) {
        const vInv = this.invalidatedVoices.get(direct.voiceId);
        if (vInv?.reason === 'consent_revoked' && direct.reason !== 'consent_revoked') {
          return { ...direct, reason: 'consent_revoked' };
        }
      }
      return direct;
    }

    const ctx = this.findKnownMediaContextSync(mediaId);
    if (ctx?.voiceId) {
      const vInv = this.invalidatedVoices.get(ctx.voiceId);
      if (vInv) {
        return {
          id: mediaId,
          ownerId: ctx.ownerId || vInv.ownerId,
          voiceId: ctx.voiceId,
          storageKey: ctx.storageKey,
          reason: vInv.reason,
          invalidatedAt: vInv.invalidatedAt,
          cleanupFailed: true,
          cleanupFailureCode: 'CLEANUP_PENDING',
        };
      }
    }

    return undefined;
  }

  public static isVoiceInvalidated(voiceId?: string): boolean {
    if (!voiceId) return false;
    this.ensureTombstonesLoaded();
    if (!this.tombstoneLedgerHealthy) {
      return true;
    }
    return this.invalidatedVoices.has(voiceId);
  }

  public static getVoiceInvalidationRecord(voiceId?: string): InvalidatedVoiceEntry | undefined {
    if (!voiceId) return undefined;
    this.ensureTombstonesLoaded();
    const rec = this.invalidatedVoices.get(voiceId);
    return rec ? { ...rec } : undefined;
  }

  public static isMediaInvalidated(mediaId?: string): boolean {
    if (!mediaId) return false;
    this.ensureTombstonesLoaded();
    if (!this.tombstoneLedgerHealthy) {
      return true;
    }
    return Boolean(this.resolveEffectiveInvalidationSync(mediaId));
  }

  public static getInvalidationRecord(
    mediaId?: string
  ): Omit<InvalidatedMediaEntry, 'storageKey'> | undefined {
    if (!mediaId) return undefined;
    this.ensureTombstonesLoaded();
    const record = this.resolveEffectiveInvalidationSync(mediaId);
    if (!record) return undefined;
    const { storageKey: _omitStorageKey, ...publicRecord } = record;
    return publicRecord;
  }

  /**
   * Initializes the private storage root directory and loads durable invalidation tombstones
   */
  public static init(): void {
    const rootDir =
      this.provider instanceof LocalStorageProvider
        ? this.provider.getRootDir()
        : process.env.VOICEFORGE_STORAGE_DIR || this.STORAGE_ROOT;
    if (!fs.existsSync(rootDir)) {
      try {
        fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
      } catch {
        // Handled fail-closed by ensureTombstonesLoaded / isLedgerLocationWritableSync
      }
    }
    this.ensureTombstonesLoaded();
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

  private static verifySignedUrlHmacOnly(
    mediaId: string,
    userId: string,
    expires: number,
    signature: string
  ): boolean {
    if (!mediaId || !userId || !expires || !signature) return false;

    const now = Math.floor(Date.now() / 1000);
    if (expires < now) return false;

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
   * Verifies the authenticity and validity of a signed download URL.
   * Always returns false if the target media artifact or its originating voice profile has been
   * invalidated, or if the durable invalidation ledger is unreadable/corrupted.
   */
  public static verifySignedUrl(
    mediaId: string,
    userId: string,
    expires: number,
    signature: string
  ): boolean {
    this.ensureTombstonesLoaded();
    if (!this.tombstoneLedgerHealthy) {
      return false;
    }
    if (this.resolveEffectiveInvalidationSync(mediaId)) {
      return false;
    }
    return this.verifySignedUrlHmacOnly(mediaId, userId, expires, signature);
  }

  /**
   * Checks whether a previously issued signed URL belonged to an invalidated media artifact
   * (either via direct media tombstone or durable voice-level revocation) without making the
   * artifact retrievable. Used strictly to surface specific 403 revocation/cancellation codes
   * (`CONSENT_REVOKED` / `MEDIA_ARTIFACT_INVALIDATED`) instead of allowing cross-tenant probing.
   */
  public static hasValidSignedUrlForInvalidatedMedia(
    mediaId: string,
    userId: string,
    expires: number,
    signature: string
  ): boolean {
    this.ensureTombstonesLoaded();
    if (!this.tombstoneLedgerHealthy) {
      return false;
    }
    const inv = this.resolveEffectiveInvalidationSync(mediaId);
    if (!inv || inv.ownerId !== userId) {
      return false;
    }
    return this.verifySignedUrlHmacOnly(mediaId, userId, expires, signature);
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

    if (!(await this.provider.isAvailable())) {
      throw new StorageUnavailableError(
        `Storage provider ${this.provider.name} is currently unavailable.`
      );
    }

    // Ensure durable invalidation ledger + companion WAL exist BEFORE writing private audio bytes
    this.ensureLedgerInitializedBeforeStoreSync();

    // Refuse to materialize private audio for a voice profile whose revocation/deletion is already durable
    if (params.voiceId && this.invalidatedVoices.has(params.voiceId)) {
      throw new Error(
        'Media rejected: Biometric consent or voice profile associated with this artifact has been revoked.'
      );
    }

    const mediaId = `med_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const safeExt = inspection.format === 'unknown' ? 'bin' : inspection.format;
    const storageKey = `${params.userId}/${mediaId}.${safeExt}`;
    const createdAt = new Date().toISOString();

    // Persist shared catalog lineage BEFORE writing physical bytes so any worker or crash-recovery
    // process can enumerate all voice-linked storage keys without process-local memory.
    this.persistedMediaCatalog.set(mediaId, {
      id: mediaId,
      ownerId: params.userId,
      voiceId: params.voiceId,
      storageKey,
      createdAt,
    });
    if (!this.persistTombstonesSync([], [], 'catalog_store')) {
      this.persistedMediaCatalog.delete(mediaId);
      throw new StorageUnavailableError(
        `Private media catalog persistence failed (${this.tombstoneLedgerError || 'CATALOG_PERSIST_FAILED'}); refusing to store private media.`
      );
    }

    // Delegate byte persistence to the active storage provider
    try {
      await this.provider.store(storageKey, params.buffer);
    } catch (err) {
      this.persistedMediaCatalog.delete(mediaId);
      this.persistTombstonesSync([], [], 'catalog_store');
      throw err;
    }

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
      createdAt,
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
   * Retrieves a private media file, validating ownership and durable media/voice invalidation state
   */
  public static async getMedia(
    mediaId: string,
    requestingUserId: string,
    isAdmin: boolean = false
  ): Promise<{ buffer: Buffer; meta: PrivateMediaRecord }> {
    this.init();
    this.assertInvalidationLedgerHealthy();

    const inv = this.resolveEffectiveInvalidationSync(mediaId);
    if (inv) {
      if (!isAdmin && inv.ownerId !== requestingUserId) {
        throw new Error('Forbidden: You do not own this media asset');
      }
      throw new Error('Media artifact has been invalidated and is permanently inaccessible');
    }

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

  private static async deleteFromDatabaseIfConnected(mediaId: string): Promise<{ ok: boolean }> {
    try {
      const { getDatabase } = await import('../db/index.ts');
      const { db, isConnected, schema } = getDatabase();
      if (!db || !isConnected || !schema?.privateMedia) {
        return { ok: true };
      }
      const { eq } = await import('drizzle-orm');
      await db.delete(schema.privateMedia).where(eq(schema.privateMedia.id, mediaId));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  private static async enumerateDatabaseArtifactsForVoiceIfConnected(voiceId: string): Promise<{
    ok: boolean;
    records: Array<{ id: string; userId: string; storageKey?: string }>;
  }> {
    try {
      const { getDatabase } = await import('../db/index.ts');
      const { db, isConnected, schema } = getDatabase();
      if (!db || !isConnected || !schema?.synthesisJobs) {
        return { ok: true, records: [] };
      }
      const { eq, inArray } = await import('drizzle-orm');
      const jobRows = await db
        .select({
          outputMediaId: schema.synthesisJobs.outputMediaId,
          userId: schema.synthesisJobs.userId,
        })
        .from(schema.synthesisJobs)
        .where(eq(schema.synthesisJobs.voiceId, voiceId));

      const mediaIds = Array.from(
        new Set(
          jobRows
            .map((r: any) => r.outputMediaId)
            .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        )
      );
      if (mediaIds.length === 0) {
        return { ok: true, records: [] };
      }

      const storageById = new Map<string, { userId: string; storageKey: string }>();
      if (schema.privateMedia) {
        const pmRows = await db
          .select({
            id: schema.privateMedia.id,
            userId: schema.privateMedia.userId,
            storageKey: schema.privateMedia.storageKey,
          })
          .from(schema.privateMedia)
          .where(inArray(schema.privateMedia.id, mediaIds));
        for (const pm of pmRows as any[]) {
          if (pm && typeof pm.id === 'string') {
            storageById.set(pm.id, { userId: pm.userId, storageKey: pm.storageKey });
          }
        }
      }

      const records = mediaIds.map((id) => {
        const pm = storageById.get(id);
        const jobOwner = (jobRows as any[]).find((j) => j.outputMediaId === id)?.userId || '';
        return {
          id,
          userId: pm?.userId || jobOwner,
          storageKey: pm?.storageKey,
        };
      });
      return { ok: true, records };
    } catch {
      return { ok: false, records: [] };
    }
  }

  /**
   * Authoritatively invalidates a private media artifact BEFORE attempting underlying byte deletion.
   * - Enforces tenant ownership (`requestingUserId === ownerId`, `isAdmin === true`, or verified `allowVoiceOwnerCleanup === true`).
   * - Never begins destructive `provider.delete()` or DB deletion until the durable authorization tombstone
   *   has been persisted on disk.
   * - If `provider.delete()` throws or fails to remove an existing file, the artifact remains permanently
   *   invalidated and inaccessible via `verifySignedUrl` and `getMedia`, and `cleanupFailed: true` is returned
   *   with a sanitized failure code (never exposing audio bytes, filesystem paths, or storage credentials).
   */
  public static async invalidateAndDeleteMedia(params: {
    mediaId: string;
    requestingUserId: string;
    isAdmin?: boolean;
    allowVoiceOwnerCleanup?: boolean;
    reason: MediaInvalidationReason;
    fallbackOwnerId?: string;
    fallbackVoiceId?: string;
  }): Promise<MediaInvalidationOutcome> {
    const {
      mediaId,
      requestingUserId,
      isAdmin = false,
      allowVoiceOwnerCleanup = false,
      reason,
      fallbackOwnerId,
      fallbackVoiceId,
    } = params;

    if (!mediaId) {
      return {
        mediaId: '',
        invalidated: false,
        alreadyInvalidated: false,
        notFound: true,
        deletedFromProvider: false,
        durableInvalidationEstablished: false,
        cleanupFailed: false,
      };
    }

    this.ensureTombstonesLoaded();

    const mediaList = memoryStore.privateMedia as PrivateMediaRecord[];
    const meta = mediaList.find((m) => m.id === mediaId);
    const catalogMeta = this.persistedMediaCatalog.get(mediaId);
    const existingInv = this.invalidatedMedia.get(mediaId);

    const authoritativeOwnerId =
      meta?.userId ?? existingInv?.ownerId ?? catalogMeta?.ownerId ?? fallbackOwnerId;
    if (
      authoritativeOwnerId &&
      !isAdmin &&
      !allowVoiceOwnerCleanup &&
      authoritativeOwnerId !== requestingUserId
    ) {
      throw new Error('Forbidden: You do not own this media asset');
    }

    const effectiveVoiceId = meta?.voiceId ?? existingInv?.voiceId ?? catalogMeta?.voiceId ?? fallbackVoiceId;
    const voiceInvalidation: InvalidatedVoiceEntry[] =
      effectiveVoiceId && (reason === 'consent_revoked' || reason === 'voice_deleted')
        ? [
            {
              voiceId: effectiveVoiceId,
              ownerId: authoritativeOwnerId || requestingUserId,
              reason,
              invalidatedAt: new Date().toISOString(),
            },
          ]
        : [];
    for (const ve of voiceInvalidation) {
      this.validateAndMergeVoiceEntry(ve);
    }

    if (!meta && existingInv) {
      const wasUnpersisted = this.hasUnpersistedInvalidation(mediaId);
      let updated = false;
      if (reason === 'consent_revoked' && existingInv.reason !== 'consent_revoked') {
        existingInv.reason = 'consent_revoked';
        updated = true;
      }
      if (!existingInv.storageKey && catalogMeta?.storageKey) {
        existingInv.storageKey = catalogMeta.storageKey;
        updated = true;
      }

      if (updated || wasUnpersisted || !this.tombstoneLedgerHealthy) {
        if (!this.persistTombstonesSync([existingInv], voiceInvalidation, 'single_tombstone')) {
          return {
            mediaId,
            invalidated: true,
            alreadyInvalidated: true,
            notFound: false,
            deletedFromProvider: false,
            durableInvalidationEstablished: false,
            cleanupFailed: true,
            cleanupFailureCode: existingInv.cleanupFailureCode || 'TOMBSTONE_PERSISTENCE_UNAVAILABLE',
          };
        }
      }

      // Retry physical + DB cleanup only AFTER durable tombstone persistence is confirmed
      let deletedFromProvider = !existingInv.cleanupFailed;
      let statusChanged = false;
      const prevCode = existingInv.cleanupFailureCode;
      const prevCatalog = this.persistedMediaCatalog.get(mediaId);
      if (existingInv.cleanupFailed) {
        const cleanupRes = await this.verifyOrPerformPhysicalCleanup(existingInv.storageKey);
        const dbOutcome = await this.deleteFromDatabaseIfConnected(mediaId);
        if (cleanupRes.physicalCleanupConfirmed && dbOutcome.ok) {
          existingInv.cleanupFailed = false;
          delete existingInv.cleanupFailureCode;
          this.persistedMediaCatalog.delete(mediaId);
          deletedFromProvider = true;
          statusChanged = true;
        } else {
          deletedFromProvider = false;
          const nextCode =
            cleanupRes.failureCode ||
            (!dbOutcome.ok ? 'DATABASE_DELETE_FAILED' : existingInv.cleanupFailureCode);
          if (nextCode && nextCode !== existingInv.cleanupFailureCode) {
            existingInv.cleanupFailureCode = nextCode;
            statusChanged = true;
          }
        }
      }

      let persisted = true;
      if (statusChanged) {
        persisted = this.persistTombstonesSync([existingInv], voiceInvalidation, 'post_cleanup');
        if (!persisted && !existingInv.cleanupFailed) {
          existingInv.cleanupFailed = true;
          existingInv.cleanupFailureCode = prevCode || 'CLEANUP_PENDING';
          if (prevCatalog) {
            this.persistedMediaCatalog.set(mediaId, prevCatalog);
          }
        }
      }

      return {
        mediaId,
        invalidated: true,
        alreadyInvalidated: true,
        notFound: false,
        deletedFromProvider,
        durableInvalidationEstablished: persisted,
        cleanupFailed: !persisted || existingInv.cleanupFailed,
        cleanupFailureCode: !persisted
          ? existingInv.cleanupFailureCode || 'TOMBSTONE_PERSISTENCE_UNAVAILABLE'
          : existingInv.cleanupFailureCode,
      };
    }

    const effectiveStorageKey = meta?.storageKey ?? catalogMeta?.storageKey;

    if (!meta && !catalogMeta) {
      if (fallbackOwnerId) {
        const entry: InvalidatedMediaEntry = {
          id: mediaId,
          ownerId: fallbackOwnerId,
          voiceId: fallbackVoiceId,
          reason,
          invalidatedAt: new Date().toISOString(),
          cleanupFailed: true,
          cleanupFailureCode: 'CLEANUP_PENDING',
        };
        this.invalidatedMedia.set(mediaId, entry);
        if (!this.persistTombstonesSync([entry], voiceInvalidation, 'single_tombstone')) {
          return {
            mediaId,
            invalidated: true,
            alreadyInvalidated: false,
            notFound: true,
            deletedFromProvider: false,
            durableInvalidationEstablished: false,
            cleanupFailed: true,
            cleanupFailureCode: 'TOMBSTONE_PERSISTENCE_UNAVAILABLE',
          };
        }

        const dbOutcome = await this.deleteFromDatabaseIfConnected(mediaId);
        if (dbOutcome.ok) {
          entry.cleanupFailed = false;
          delete entry.cleanupFailureCode;
        } else {
          entry.cleanupFailed = true;
          entry.cleanupFailureCode = 'DATABASE_DELETE_FAILED';
        }
        const persisted = this.persistTombstonesSync([entry], voiceInvalidation, 'post_cleanup');
        if (!persisted && !entry.cleanupFailed) {
          entry.cleanupFailed = true;
          entry.cleanupFailureCode = 'CLEANUP_PENDING';
        }
        return {
          mediaId,
          invalidated: true,
          alreadyInvalidated: false,
          notFound: true,
          deletedFromProvider: false,
          durableInvalidationEstablished: persisted,
          cleanupFailed: !persisted || entry.cleanupFailed,
          cleanupFailureCode: !persisted
            ? entry.cleanupFailureCode || 'TOMBSTONE_PERSISTENCE_UNAVAILABLE'
            : entry.cleanupFailureCode,
        };
      }
      return {
        mediaId,
        invalidated: false,
        alreadyInvalidated: false,
        notFound: true,
        deletedFromProvider: false,
        durableInvalidationEstablished: this.tombstoneLedgerHealthy,
        cleanupFailed: false,
      };
    }

    // STEP 1: Fail-closed invalidation FIRST, synchronously in memory AND durably on disk BEFORE storage/DB I/O.
    // Record `cleanupFailed: true` (`CLEANUP_PENDING`) until physical deletion + DB cleanup are both confirmed.
    // If durable tombstone persistence fails, NEVER start destructive cleanup.
    const entry: InvalidatedMediaEntry = {
      id: mediaId,
      ownerId: meta?.userId ?? catalogMeta!.ownerId,
      voiceId: effectiveVoiceId,
      storageKey: effectiveStorageKey,
      reason,
      invalidatedAt: new Date().toISOString(),
      cleanupFailed: true,
      cleanupFailureCode: 'CLEANUP_PENDING',
    };
    this.invalidatedMedia.set(mediaId, entry);

    for (let i = mediaList.length - 1; i >= 0; i--) {
      if (mediaList[i].id === mediaId) {
        mediaList.splice(i, 1);
      }
    }

    const step1Persisted = this.persistTombstonesSync([entry], voiceInvalidation, 'single_tombstone');
    if (!step1Persisted) {
      return {
        mediaId,
        invalidated: true,
        alreadyInvalidated: false,
        notFound: false,
        deletedFromProvider: false,
        durableInvalidationEstablished: false,
        cleanupFailed: true,
        cleanupFailureCode: 'TOMBSTONE_PERSISTENCE_UNAVAILABLE',
      };
    }

    // STEP 2: Delete underlying storage bytes and verify physical absence (never equate auth denial with byte cleanup)
    const cleanupRes = await this.verifyOrPerformPhysicalCleanup(effectiveStorageKey);

    // STEP 3: Await database metadata cleanup if PostgreSQL is connected (no un-awaited background race)
    const dbOutcome = await this.deleteFromDatabaseIfConnected(mediaId);
    const prevCatalog = this.persistedMediaCatalog.get(mediaId);
    if (cleanupRes.physicalCleanupConfirmed && dbOutcome.ok) {
      entry.cleanupFailed = false;
      delete entry.cleanupFailureCode;
      this.persistedMediaCatalog.delete(mediaId);
    } else {
      entry.cleanupFailed = true;
      entry.cleanupFailureCode =
        cleanupRes.failureCode || (!dbOutcome.ok ? 'DATABASE_DELETE_FAILED' : 'CLEANUP_PENDING');
    }

    // Persist final cleanup status durably ONLY AFTER physical + DB cleanup outcomes are confirmed
    const finalPersistOk = this.persistTombstonesSync([entry], voiceInvalidation, 'post_cleanup');
    if (!finalPersistOk && !entry.cleanupFailed) {
      entry.cleanupFailed = true;
      entry.cleanupFailureCode = 'CLEANUP_PENDING';
      if (prevCatalog) {
        this.persistedMediaCatalog.set(mediaId, prevCatalog);
      }
    }

    return {
      mediaId,
      invalidated: true,
      alreadyInvalidated: false,
      notFound: false,
      deletedFromProvider: cleanupRes.deletedFromProvider,
      durableInvalidationEstablished: finalPersistOk,
      cleanupFailed: !finalPersistOk || entry.cleanupFailed,
      cleanupFailureCode: !finalPersistOk
        ? entry.cleanupFailureCode || 'TOMBSTONE_PERSISTENCE_UNAVAILABLE'
        : entry.cleanupFailureCode,
    };
  }

  /**
   * Batch-atomically invalidates and deletes all private media artifacts associated with `voiceId`:
   * 1. Enumerates the complete affected artifact set across `memoryStore.privateMedia`, the shared
   *    durable `persistedMediaCatalog`, existing tombstones, connected PostgreSQL records, and any
   *    caller-supplied job media references (`additionalArtifacts`).
   * 2. Establishes a durable voice-level revocation/invalidation barrier (`voice_barrier`) AND
   *    persists `CLEANUP_PENDING` (`cleanupFailed: true`) tombstones for EVERY affected artifact
   *    (`batch_tombstones`) BEFORE invoking the first `provider.delete()` or database delete.
   * 3. Never begins destructive cleanup if durable barrier persistence fails.
   * 4. Performs physical + connected DB cleanup for each pending artifact and marks `cleanupFailed: false`
   *    ONLY after verified absence and durable post-cleanup persistence (`post_cleanup`).
   */
  public static async invalidateByVoiceId(params: {
    voiceId: string;
    requestingUserId: string;
    isAdmin?: boolean;
    reason: MediaInvalidationReason;
    additionalArtifacts?: Array<{ mediaId: string; fallbackOwnerId?: string }>;
  }): Promise<MediaInvalidationOutcome[]> {
    const {
      voiceId,
      requestingUserId,
      isAdmin = false,
      reason,
      additionalArtifacts = [],
    } = params;
    if (!voiceId) return [];

    this.ensureTombstonesLoaded();

    const nowIso = new Date().toISOString();
    const voiceReason: VoiceInvalidationReason =
      reason === 'consent_revoked' ? 'consent_revoked' : 'voice_deleted';
    const existingVoice = this.invalidatedVoices.get(voiceId);
    const mergedVoiceReason: VoiceInvalidationReason =
      existingVoice?.reason === 'consent_revoked' || voiceReason === 'consent_revoked'
        ? 'consent_revoked'
        : voiceReason;
    const voiceEntry: InvalidatedVoiceEntry = {
      voiceId,
      ownerId: existingVoice?.ownerId || requestingUserId,
      reason: mergedVoiceReason,
      invalidatedAt: existingVoice?.invalidatedAt || nowIso,
    };

    const dbEnum = await this.enumerateDatabaseArtifactsForVoiceIfConnected(voiceId);
    const dbByMediaId = new Map<string, { id: string; userId: string; storageKey?: string }>();
    for (const r of dbEnum.records) {
      dbByMediaId.set(r.id, r);
    }

    const fallbackOwnersByMediaId = new Map<string, string | undefined>();
    for (const extra of additionalArtifacts) {
      if (extra && typeof extra.mediaId === 'string' && extra.mediaId.length > 0) {
        if (!fallbackOwnersByMediaId.has(extra.mediaId)) {
          fallbackOwnersByMediaId.set(extra.mediaId, extra.fallbackOwnerId);
        }
      }
    }

    const mediaList = memoryStore.privateMedia as PrivateMediaRecord[];
    const candidateIds = new Set<string>();

    for (const m of mediaList) {
      if (m.voiceId === voiceId) {
        candidateIds.add(m.id);
      }
    }
    for (const cat of this.persistedMediaCatalog.values()) {
      if (cat.voiceId === voiceId) {
        candidateIds.add(cat.id);
      }
    }
    for (const inv of this.invalidatedMedia.values()) {
      if (inv.voiceId === voiceId) {
        candidateIds.add(inv.id);
      }
    }
    for (const dbId of dbByMediaId.keys()) {
      candidateIds.add(dbId);
    }
    for (const extraId of fallbackOwnersByMediaId.keys()) {
      candidateIds.add(extraId);
    }

    interface StagedBatchItem {
      entry: InvalidatedMediaEntry;
      alreadyInvalidated: boolean;
      notFound: boolean;
      needsCleanup: boolean;
      deletedFromProvider: boolean;
      resolvedNow: boolean;
      prevCleanupCode?: string;
      prevCatalog?: PersistedMediaCatalogEntry;
    }

    const stagedItems: StagedBatchItem[] = [];
    for (const mediaId of candidateIds) {
      const meta = mediaList.find((m) => m.id === mediaId);
      const cat = this.persistedMediaCatalog.get(mediaId);
      const existingInv = this.invalidatedMedia.get(mediaId);
      const dbRec = dbByMediaId.get(mediaId);
      const extraOwner = fallbackOwnersByMediaId.get(mediaId);

      const alreadyInvalidated = Boolean(!meta && existingInv);
      const notFound = Boolean(!meta && !cat && !existingInv && !dbRec);
      const storageKey =
        meta?.storageKey ?? existingInv?.storageKey ?? cat?.storageKey ?? dbRec?.storageKey;
      const ownerId =
        meta?.userId ??
        existingInv?.ownerId ??
        cat?.ownerId ??
        (dbRec?.userId && dbRec.userId.length > 0 ? dbRec.userId : undefined) ??
        extraOwner ??
        requestingUserId;
      const mergedReason: MediaInvalidationReason =
        existingInv?.reason === 'consent_revoked' || reason === 'consent_revoked'
          ? 'consent_revoked'
          : existingInv?.reason || reason;

      const alreadyCleanedAndDurable = Boolean(
        existingInv &&
          !meta &&
          !existingInv.cleanupFailed &&
          !this.hasUnpersistedInvalidation(mediaId) &&
          this.tombstoneLedgerHealthy
      );

      const needsCleanup = !alreadyCleanedAndDurable;
      const entry: InvalidatedMediaEntry = {
        id: mediaId,
        ownerId,
        voiceId,
        storageKey,
        reason: mergedReason,
        invalidatedAt: existingInv?.invalidatedAt || nowIso,
        cleanupFailed: needsCleanup,
        cleanupFailureCode: needsCleanup
          ? existingInv?.cleanupFailureCode || 'CLEANUP_PENDING'
          : undefined,
      };

      stagedItems.push({
        entry,
        alreadyInvalidated,
        notFound,
        needsCleanup,
        deletedFromProvider: alreadyCleanedAndDurable,
        resolvedNow: false,
        prevCleanupCode: existingInv?.cleanupFailureCode,
      });
    }

    // Remove all voice-linked artifacts from in-memory catalog immediately
    for (let i = mediaList.length - 1; i >= 0; i--) {
      if (mediaList[i].voiceId === voiceId || candidateIds.has(mediaList[i].id)) {
        mediaList.splice(i, 1);
      }
    }

    const stagedEntries = stagedItems.map((s) => s.entry);

    // If connected DB enumeration failed, fail closed before starting any destructive cleanup
    if (!dbEnum.ok) {
      this.invalidatedVoices.set(voiceId, voiceEntry);
      for (const s of stagedItems) {
        this.invalidatedMedia.set(s.entry.id, s.entry);
      }
      this.persistTombstonesSync(stagedEntries, [voiceEntry], 'batch_tombstones');
      return stagedItems.map((s) => ({
        mediaId: s.entry.id,
        invalidated: true,
        alreadyInvalidated: s.alreadyInvalidated,
        notFound: s.notFound,
        deletedFromProvider: false,
        durableInvalidationEstablished: false,
        cleanupFailed: true,
        cleanupFailureCode: 'DATABASE_ENUMERATION_FAILED',
      }));
    }

    // STEP 1A: Establish durable voice-level revocation/invalidation barrier FIRST.
    // Even if the process crashes immediately after Step 1A before per-artifact entries are written,
    // `invalidatedVoices` + `mediaCatalog` durably deny access to every artifact of this voice across
    // all workers and allow `reconcilePendingDeletions()` to promote & delete every physical file.
    this.invalidatedVoices.set(voiceId, voiceEntry);
    const voiceBarrierOk = this.persistTombstonesSync([], [voiceEntry], 'voice_barrier');
    if (!voiceBarrierOk) {
      for (const s of stagedItems) {
        this.invalidatedMedia.set(s.entry.id, s.entry);
      }
      const targetPath = this.getEffectiveTombstoneFilePath();
      const unpersistedMap = this.getUnpersistedMapForPath(targetPath);
      for (const entry of stagedEntries) {
        unpersistedMap.set(entry.id, { ...entry });
      }
      if (stagedEntries.length > 0) {
        this.appendEmergencyWalSync(targetPath, stagedEntries, []);
      }
      return stagedItems.map((s) => ({
        mediaId: s.entry.id,
        invalidated: true,
        alreadyInvalidated: s.alreadyInvalidated,
        notFound: s.notFound,
        deletedFromProvider: false,
        durableInvalidationEstablished: false,
        cleanupFailed: true,
        cleanupFailureCode: 'TOMBSTONE_PERSISTENCE_UNAVAILABLE',
      }));
    }

    // STEP 1B: Persist `CLEANUP_PENDING` (`cleanupFailed: true`) tombstones for the ENTIRE affected
    // artifact batch BEFORE calling `provider.delete()` or `deleteFromDatabaseIfConnected()`.
    for (const s of stagedItems) {
      this.invalidatedMedia.set(s.entry.id, s.entry);
    }

    if (stagedItems.length > 0 || this.testPersistenceHook !== null) {
      const batchTombstonesOk = this.persistTombstonesSync(
        stagedEntries,
        [voiceEntry],
        'batch_tombstones'
      );
      if (!batchTombstonesOk) {
        return stagedItems.map((s) => ({
          mediaId: s.entry.id,
          invalidated: true,
          alreadyInvalidated: s.alreadyInvalidated,
          notFound: s.notFound,
          deletedFromProvider: false,
          durableInvalidationEstablished: false,
          cleanupFailed: true,
          cleanupFailureCode: 'TOMBSTONE_PERSISTENCE_UNAVAILABLE',
        }));
      }
    }

    // STEP 2: Only AFTER durable voice + full-batch authorization barriers are committed on disk,
    // execute physical byte cleanup and connected DB deletion for each pending artifact.
    let anyStateUpdated = false;
    for (const item of stagedItems) {
      if (!item.needsCleanup) continue;
      anyStateUpdated = true;

      const cleanupRes = await this.verifyOrPerformPhysicalCleanup(item.entry.storageKey);
      const dbOutcome = await this.deleteFromDatabaseIfConnected(item.entry.id);

      if (cleanupRes.physicalCleanupConfirmed && dbOutcome.ok) {
        item.prevCatalog = this.persistedMediaCatalog.get(item.entry.id);
        item.entry.cleanupFailed = false;
        delete item.entry.cleanupFailureCode;
        this.persistedMediaCatalog.delete(item.entry.id);
        item.deletedFromProvider = cleanupRes.deletedFromProvider;
        item.resolvedNow = true;
      } else {
        item.deletedFromProvider = false;
        item.entry.cleanupFailed = true;
        item.entry.cleanupFailureCode =
          cleanupRes.failureCode ||
          (!dbOutcome.ok ? 'DATABASE_DELETE_FAILED' : 'CLEANUP_PENDING');
      }
    }

    // STEP 3: Persist post-cleanup state; revert `cleanupFailed` transitions if persistence fails
    // so incomplete persistence never reports complete cleanup.
    let finalPersistOk = this.tombstoneLedgerHealthy;
    if (anyStateUpdated || !this.tombstoneLedgerHealthy) {
      finalPersistOk = this.persistTombstonesSync(stagedEntries, [voiceEntry], 'post_cleanup');
      if (!finalPersistOk) {
        for (const item of stagedItems) {
          if (item.resolvedNow) {
            item.entry.cleanupFailed = true;
            item.entry.cleanupFailureCode = item.prevCleanupCode || 'CLEANUP_PENDING';
            if (item.prevCatalog) {
              this.persistedMediaCatalog.set(item.entry.id, item.prevCatalog);
            }
          }
        }
      }
    }

    return stagedItems.map((item) => ({
      mediaId: item.entry.id,
      invalidated: true,
      alreadyInvalidated: item.alreadyInvalidated,
      notFound: item.notFound,
      deletedFromProvider: item.deletedFromProvider,
      durableInvalidationEstablished: finalPersistOk,
      cleanupFailed: !finalPersistOk || item.entry.cleanupFailed,
      cleanupFailureCode: !finalPersistOk
        ? item.entry.cleanupFailureCode || 'TOMBSTONE_PERSISTENCE_UNAVAILABLE'
        : item.entry.cleanupFailureCode,
    }));
  }

  /**
   * Deletes a private media file with fail-closed pre-delete invalidation
   */
  public static async deleteMedia(
    mediaId: string,
    requestingUserId: string,
    isAdmin: boolean = false
  ): Promise<boolean> {
    const outcome = await this.invalidateAndDeleteMedia({
      mediaId,
      requestingUserId,
      isAdmin,
      reason: 'manual_delete',
    });
    if (outcome.notFound) return false;
    if (!outcome.durableInvalidationEstablished || outcome.cleanupFailed) {
      throw new StorageUnavailableError(
        `Media artifact ${mediaId} was invalidated in memory, but durable invalidation or storage cleanup failed (${outcome.cleanupFailureCode || 'UNKNOWN'}).`
      );
    }
    return true;
  }
}
