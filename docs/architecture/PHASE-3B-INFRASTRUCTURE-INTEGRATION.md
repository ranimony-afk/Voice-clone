# VoiceForge Phase 3B: Controlled Infrastructure Integration Architecture

**Document Version**: 1.0.0  
**Phase**: Phase 3B (Controlled Infrastructure Integration & Security Verification)  
**Status**: Authoritative Architectural Specification  
**Classification**: Engineering & Security Architecture  

---

## 1. Executive Overview

VoiceForge Phase 3B advances the security posture established in Phase 3A-V from source-level guarantees and in-memory caches to verified infrastructure integration in a controlled non-production environment. 

This architecture addresses five critical infrastructure and security domains:
1. **Durable Session Revocation**: Transitioning token invalidation from transient memory to restart-durable persistence across processes and instances.
2. **Relational PostgreSQL Persistence**: Validating schema migrations, referential integrity, unique constraints, and transaction rollback on live PostgreSQL 15.
3. **Provider-Neutral Private Storage**: Decoupling filesystem specifics into a clean `StorageProvider` interface with POSIX hardening and S3 compatibility.
4. **Consent & Asynchronous Job Race Defense**: Eliminating race conditions across the job lifecycle (`pending` -> `processing` -> `completed` / `cancelled`).
5. **Execution-Mode Integrity**: Enforcing the strict boundary between genuine neural execution, explicit demo mode, and fail-closed unavailability.

---

## 2. Durable Authentication & Session Revocation

### 2.1 Threat Mitigation & Token Lifecycle
In previous phases, session revocation relied on in-memory `Set<string>`, which did not survive server restarts and could not synchronize across clustered server instances. 

Phase 3B introduces `DurableRevocationStore`:
- **Cryptographic One-Way Hashing**: Revocation entries store only the **SHA-256 hash** of the token (`token_hash = SHA256(token)`). Raw session tokens and signing secrets are never written to disk, database rows, or application logs.
- **Dual-Layer Persistence**:
  1. *Relational Storage (Primary)*: When PostgreSQL is configured, revoked token hashes are inserted into the `revoked_tokens` table.
  2. *Durable File Storage (Local/Container)*: Hashes are atomically written to `storage/auth/revoked_tokens.json` with restricted POSIX permissions (`0o600`).
  3. *In-Memory LRU Cache*: Revocation lookups are served in $O(1)$ time from memory, loaded at process initialization.
- **Fail-Closed Secret Enforcement**: `AuthService.getAuthSecret()` verifies `process.env.VOICEFORGE_AUTH_SECRET`. In `NODE_ENV=production`, absence of this secret throws a fatal configuration error.

```
+-------------------------------------------------------------+
|                     Client Request                          |
|             (Authorization: Bearer <token>)                 |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                   requireAuth Middleware                     |
|                                                             |
|  1. Extract Bearer token                                    |
|  2. Compute SHA-256(token)                                  |
|  3. Query DurableRevocationStore.isRevoked(token)           |
|     - Cache hit? -> Immediate 401 AUTH_TOKEN_REVOKED        |
|     - Disk/DB check                                         |
|  4. Verify HMAC-SHA256 signature with getAuthSecret()       |
|  5. Check expiration timestamp (now < exp)                  |
|  6. Bind req.user = AuthenticatedUser                       |
+-------------------------------------------------------------+
```

---

## 3. Real PostgreSQL Persistence & Integrity Controls

### 3.1 Migration Architecture & Idempotency
PostgreSQL schema versioning is managed via `server/db/migrate.ts` and raw DDL `server/db/migrations/0001_phase3a_security_persistence.sql`.
- **Idempotency Guarantee**: All DDL statements employ `IF NOT EXISTS` guards and transaction blocks (`BEGIN ... COMMIT`). Repeated execution of migrations against an active database succeeds with zero errors and preserves existing rows.
- **Connection Resilience**: Connection acquisition is wrapped in error-handling blocks that release client resources and fail gracefully with diagnostic error objects if the database host is unreachable.

### 3.2 Constraint Matrix & Tenant Isolation

| Table | Primary Key | Foreign Key Constraints | Unique Constraints | Multi-Tenant Index |
| :--- | :--- | :--- | :--- | :--- |
| `users` | `id UUID` | None | `email UNIQUE` | None |
| `api_keys` | `id UUID` | `user_id -> users.id (CASCADE)` | None | `idx_api_keys_user` |
| `voices` | `id VARCHAR(128)` | `user_id -> users.id (SET NULL)`| None | `idx_voices_user` |
| `consent_records` | `id VARCHAR(128)` | Independent tenant reference | None | `idx_consent_user`, `idx_consent_voice` |
| `private_media` | `id VARCHAR(128)` | Independent tenant reference | None | `idx_media_user` |
| `synthesis_jobs` | `id VARCHAR(128)` | Independent tenant reference | None | `idx_jobs_user`, `idx_jobs_status` |
| `audit_events` | `id VARCHAR(128)` | Independent tenant reference | None | `idx_audit_user`, `idx_audit_type` |
| `revoked_tokens` | `token_hash (64)`| None | `token_hash PRIMARY KEY` | `idx_revoked_tokens_user` |

### 3.3 Transaction Rollback Integrity
Database mutations across multiple tables are executed within explicit database transactions. If any intermediate operation violates a constraint, a complete `ROLLBACK` is issued, ensuring no orphaned or partially written records persist.

---

## 4. Provider-Neutral Private Media Storage

### 4.1 Storage Abstraction Interface
Media storage is decoupled from the Express web tier via the `StorageProvider` interface:

```typescript
export interface StorageProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  store(key: string, buffer: Buffer): Promise<void>;
  retrieve(key: string): Promise<Buffer>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}
```

### 4.2 Storage Implementations
1. **`LocalStorageProvider`**:
   - Stores media objects within isolated tenant directory hierarchies (`/tmp/voiceforge-storage/<userId>/<mediaId>.<ext>`).
   - Enforces POSIX `0o700` directory permissions and `0o600` file permissions to prevent cross-process snooping.
2. **`S3CompatibleStorageProvider`**:
   - Configurable for AWS S3, Google Cloud Storage (XML API), or MinIO.
   - Fails closed with `StorageUnavailableError` when credentials or bucket endpoints are unconfigured, preventing silent fallback to insecure storage.

### 4.3 Content Inspection & HMAC Signed URLs
- **Magic-Byte Inspection**: Validates binary container headers for WAV, MP3, OGG, FLAC, and WebM. Structural inspection of WAV headers ensures standard PCM (format code 1), 1–8 channels, 8 kHz–96 kHz sample rates, and 16/24/32-bit depths. HTML, SVG, and script payloads are rejected.
- **Payload Limits**: Strict 25 MB ceiling (`MAX_MEDIA_BYTES = 25 * 1024 * 1024`).
- **HMAC-SHA256 Signed URLs**: Valid for 15 minutes (`DEFAULT_URL_TTL_SECONDS = 900`). Signatures bind the `mediaId`, authorized `userId`, and `expires` timestamp. Tampering with any component or querying with expired timestamps fails verification immediately.

---

## 5. Consent & Asynchronous Job Race Condition Defenses

### 5.1 The 7 Race Scenarios & Multi-Gate Protection

```
Client Job Submission
       |
       v
[GATE 1: Pre-Submission Check] ---> Consent revoked? -> 403 CONSENT_REVOKED
       |
       v
Job Enqueued (status: pending)
       |
       v
Worker Pickup
       |
       v
[GATE 2: Worker Pre-Execution Check] -> Consent revoked while queued? -> Cancel Job & Abort
       |
       v
[GATE 3: Worker Tenant Check] -------> workerTenantId != job.userId? -> Fail with Security Violation
       |
       v
Synthesizer Execution (Streaming / Chunks)
       |
       v
[GATE 4: Mid-Flight Revocation Check] -> Consent revoked during audio rendering? -> Cancel Job & Discard Buffer
       |
       v
Private Media Storage (voiceId Linkage)
       |
       v
Job Completed (outputSignedUrl issued)
       |
       v
Artifact Retrieval (GET /v1/media/download/:id)
       |
       v
[GATE 5: Download Time Consent Check] -> Voice consent revoked post-synthesis? -> 403 CONSENT_REVOKED
```

### 5.2 Worker Tenant Isolation
Workers validate that the executing worker thread identity matches `job.userId` or is an authorized internal system worker (`worker_system`). Cross-tenant execution attempts fail immediately.

---

## 6. Execution-Mode Integrity & Transparency

The execution contract established in Phase 2A is strictly maintained:
- **`NEURAL`**: Applies exclusively when genuine neural model weights (OmniVoice / CosyVoice) are physically loaded and executing on GPU/CUDA compute.
- **`DEMO`**: Clearly marked synthetic demonstrative audio in non-production environments with explicit `allow_demo=true`.
- **`UNAVAILABLE`**: When neural weights are missing or inference dependencies fail, the engine fails closed with HTTP 503 instead of masking missing models.
- **Provenance Transparency**: HMAC manifests and SHA-256 audio signatures are cryptographically valid tamper-evidence manifests, truthfully presented without claiming unverified steganographic watermarks or C2PA hardware credentials.
