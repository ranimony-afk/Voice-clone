# VoiceForge Comprehensive Application Security Threat Model

**Document Version**: 1.0.0 (Phase 3A)  
**Author**: VoiceForge Application Security Engineering Team  
**Scope**: Authentication, Authorization, Biometric Voice Consent, Private Media Storage, and Neural Synthesis Orchestration  
**Status**: APPROVED & ENFORCED  

---

## 1. System Overview & Trust Boundaries

VoiceForge is a multi-tenant AI voice platform supporting text-to-speech, zero-shot voice cloning, and multimedia rendering. Because cloned voices constitute biometric identifiers and sensitive personal data, strict trust boundaries must be maintained.

### 1.1 Architectural Trust Boundaries
```text
[ Browser / Untrusted Client ]
       │  (HTTPS / TLS 1.3)
       ▼ [Trust Boundary 1: Client to API Gateway]
[ Express Application API & Auth Middleware ]
       │
       ├────────────────────────┬────────────────────────┬────────────────────────┐
       ▼ [TB 2: API to DB]      ▼ [TB 3: Storage]        ▼ [TB 4: Internal RPC]   ▼ [TB 5: Jobs]
[ PostgreSQL Database ]   [ Private Storage ]     [ OmniVoice Service ]    [ Async Workers ]
  - Users                   - Private WAV Objects   - Neural Diffusion       - FFmpeg Render
  - Voice Profiles          - Signed URLs           - Model Latents          - Video Stitch
  - Consent Audit Trail     - Magic-byte checking   - 3-State Contract       - Job Isolation
```

- **Trust Boundary 1 (Client → API)**: The browser is untrusted. Client-supplied IDs (`userId`, `ownerId`), cookies, and request headers must be treated as hostile until cryptographically verified by server-side middleware.
- **Trust Boundary 2 (API → Database)**: The database contains tenant data. Queries must enforce parameterization and tenancy boundaries (`WHERE user_id = $auth_user`).
- **Trust Boundary 3 (API → Object Storage)**: Media files (uploaded reference voice recordings, live consent phrases, synthesized WAVs) are private by default. No public buckets. Access requires short-lived, HMAC-signed URLs.
- **Trust Boundary 4 (API → OmniVoice Microservice)**: Model worker operates on a private network (`OMNIVOICE_SERVICE_URL`). API communicates through validated Pydantic schemas. Unauthenticated network access to the worker is prohibited.
- **Trust Boundary 5 (API → Background Workers)**: Asynchronous synthesis jobs retain ownership context (`job.userId = req.user.id`). Workers execute strictly within the requesting user's authorization envelope.

---

## 2. Threat Classification & Mitigation Ledger (STRIDE)

### 2.1 Spoofing Identity
* **Threat**: Attacker supplies an arbitrary `userId` (e.g., `userId: "admin"` or `userId: "victim_uuid"`) in JSON request bodies to clone voices or access resources under another user's identity.
* **Mitigation**: The API strictly ignores client-supplied `userId` or `ownerId` in request bodies. The identity is extracted exclusively from validated server-side tokens (`req.user.id`). Any attempt to alter ownership fields fails closed.

### 2.2 Tampering with Biometric Consent
* **Threat**: Attacker modifies a consent challenge nonce, timestamps, or required phrases, or re-uses another user's consent audio to clone a third party's voice without authorization.
* **Mitigation**:
  1. Consent challenges are signed with server-side HMAC-SHA256 (`signature = HMAC(challengeId:nonce:userId:voiceName:issuedAt:expiresAt)`).
  2. Short TTL (5 minutes) with single-use nonce consumption prevents replay attacks.
  3. Spoken consent audio undergoes acoustic feature extraction and cosine similarity verification against the reference sample (minimum 0.72 threshold).
  4. Once enrolled, consent records are immutable in PostgreSQL. Revocation immediately terminates synthesis permissions.

### 2.3 Repudiation & Audit Trail
* **Threat**: A rogue user generates deepfakes or impersonations, then deletes their profile to evade forensic attribution.
* **Mitigation**:
  1. Immutable `audit_events` and `consent_records` retain cryptographic SHA-256 hashes of the audio, verified timestamps, and HMAC signatures even after profile deletion.
  2. All generated WAV files embed authenticated RIFF chunk metadata (`VFPR`) signed by server keys.

### 2.4 Information Disclosure (Insecure Direct Object References & Data Leakage)
* **Threat**: Attacker iterates through sequential voice IDs, media IDs, or job IDs (`/api/v1/jobs/1`, `/api/v1/jobs/2`) to retrieve private synthesized audio or transcripts belonging to other users.
* **Mitigation**:
  1. All database and resource keys use cryptographically random UUIDv4 or high-entropy tokens (`job_172..._8f3a`).
  2. Strict server-side ownership checks (`if (job.userId !== req.user.id && req.user.role !== 'admin') return res.status(403)`).
  3. Error messages sanitize internal server errors, never returning stack traces, internal paths (`/tmp/...`), or database connection strings.

### 2.5 Denial of Service & Resource Exhaustion
* **Threat**: Attacker uploads gigabyte-sized files, transmits infinite text strings, or triggers thousands of simultaneous GPU diffusion jobs to starve system resources.
* **Mitigation**:
  1. Content-length limits: JSON bodies limited to 10MB; uploaded media limited to 50MB.
  2. Audio duration checks: Reference audio capped at 30 seconds; text script capped at 5,000 characters.
  3. Pre-flight rate limiting and credit deduction before dispatching compute-intensive diffusion jobs.

### 2.6 Elevation of Privilege
* **Threat**: Regular user escalates their role to `admin` or executes administrative database migrations and diagnostic endpoints.
* **Mitigation**:
  1. Role attribute (`role: 'admin'`) is set exclusively via server-side migrations or internal configuration, never accepting role overrides via registration or profile update APIs.
  2. Migration scripts are command-line utilities, never exposed as unauthenticated HTTP endpoints.

---

## 3. Storage Security & Media Lifecycle

1. **Private-by-Default Policy**: No audio files or voice embeddings are stored in public cloud storage buckets or publicly accessible web directories.
2. **Pre-Signed Uploads & Downloads**: Clients receive time-limited (15-minute TTL), cryptographically signed URLs for both uploading reference samples and downloading synthesized WAV outputs.
3. **Magic-Byte Content Validation**: File extensions (e.g. `.wav`, `.mp3`) are untrusted. Upload handlers inspect binary magic bytes (e.g., `RIFF....WAVE`, `\x1a\x45\xdf\xa3` for WebM) to prevent executable upload attacks.
4. **Data Retention & Revocation**: When an owner revokes consent or deletes a voice profile:
   - Voice is marked `isActive = false` in the database.
   - Reference audio files in storage are deleted or scheduled for permanent erasure.
   - Any active synthesis jobs targeting that voice ID immediately fail closed.

---

## 4. Execution Policy Security Guarantees

1. **Zero Silent Fallback**: In production environments (`NODE_ENV=production`), the system rejects requests if the genuine neural diffusion engine is offline. It never silently generates synthetic harmonic formant audio to deceive users into believing neural voice cloning succeeded.
2. **Explicit Demo Isolation**: Development harmonic demo mode (`executionMode: 'DEMO'`) requires explicit authorization (`allowDemo: true`) and non-production configuration. It is strictly barred from issuing reusable neural voice clone prompt IDs.
