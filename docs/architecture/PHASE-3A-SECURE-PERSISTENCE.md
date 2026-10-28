# VoiceForge Phase 3A: Secure Persistence Architecture

## 1. Executive Summary

Phase 3A elevates VoiceForge from an ephemeral, client-asserted state model to a tamper-proof, server-validated, multi-tenant persistence foundation. Every voice profile, biometric consent verification, media asset, and synthesis job is cryptographically authenticated and tightly bound to a server-validated user identity.

Client-supplied user IDs in request bodies and query parameters are untrusted and rejected for identity determination. All operations rely strictly on `req.user.id` resolved via HMAC-SHA256 bearer session tokens.

---

## 2. Relational Schema Extensions

```
+-------------------+       +-----------------------+       +---------------------+
|       users       | <---+ |    consent_records    |       |    synthesis_jobs   |
+-------------------+       +-----------------------+       +---------------------+
| id (PK)           |       | id (PK)               |       | id (PK)             |
| email             |       | user_id (FK -> users) | <---+ | user_id (FK)        |
| full_name         |       | voice_id (FK)         |       | voice_id (FK)       |
| role              |       | challenge_id          |       | status              |
| credit_balance    |       | reference_audio_hash  |       | execution_mode      |
+-------------------+       | consent_audio_hash    |       | output_media_id(FK) |
        |                   | similarity_score      |       +---------------------+
        |                   | status (active/revok) |                  |
        |                   | audit_signature       |                  v
        |                   +-----------------------+       +---------------------+
        |                                                   |    private_media    |
        +-------------------------------------------------> +---------------------+
        |                                                   | id (PK)             |
        v                                                   | user_id (FK)        |
+-------------------+                                       | media_type          |
|   audit_events    |                                       | storage_key         |
+-------------------+                                       | mime_type, byte_size|
| id (PK)           |                                       | sha256_hash         |
| user_id (FK)      |                                       | audio_format        |
| event_type        |                                       | is_encrypted        |
| resource_id       |                                       | expires_at          |
| status / details  |                                       +---------------------+
+-------------------+
```

### Table Definitions

1. **`consent_records`**
   - **Purpose**: Immutable audit log of biometric voice enrollment and consent verification.
   - **Key Fields**: `user_id`, `voice_id`, `challenge_id`, `reference_audio_hash`, `consent_audio_hash`, `similarity_score`, `threshold`, `status` (`active` | `revoked`), `audit_signature`.
   - **Integrity Guarantee**: Once created, only status may transition from `active` to `revoked`. Revocation records timestamp and identity of revoking actor.

2. **`private_media`**
   - **Purpose**: Metadata ledger for all uploaded reference audio, consent audio, synthesized speech outputs, and stems.
   - **Key Fields**: `user_id`, `media_type`, `storage_key`, `filename`, `mime_type`, `byte_size`, `sha256_hash`, `audio_format`, `is_encrypted`, `expires_at`.
   - **Zero Public Exposure**: Raw audio is stored in an isolated filesystem location or private object storage, NEVER exposed through static web server endpoints.

3. **`synthesis_jobs`**
   - **Purpose**: Stateful tracking of asynchronous synthesis operations.
   - **Key Fields**: `user_id`, `voice_id`, `status` (`pending`, `processing`, `completed`, `failed`, `cancelled`), `execution_mode` (`NEURAL`, `DEMO`, `UNAVAILABLE`), `output_media_id`, `output_signed_url`, `watermark_signature`.
   - **Tenant Isolation**: Queries strictly filter by `user_id = req.user.id`.

4. **`audit_events`**
   - **Purpose**: Append-only security audit trail for compliance, forensic tracking, and fraud detection.
   - **Key Fields**: `user_id`, `event_type`, `resource_id`, `ip_address`, `user_agent`, `status`, `details`, `created_at`.

---

## 3. In-Memory Resilient Store (`memoryStore`)

For local execution, development, and serverless environments without an active PostgreSQL instance, `memoryStore` mirrors all table collections with identical schema structures:
- `memoryStore.consentRecords`
- `memoryStore.privateMedia`
- `memoryStore.synthesisJobs`
- `memoryStore.auditEvents`
- `memoryStore.customVoices`

All security guarantees (ownership checks, consent validation, revocations) apply identically in memory and in PostgreSQL.

---

## 4. Consent Enforcement in the Synthesis Pipeline

When `VoiceForgeSynthesizer.synthesize` or `/api/v1/tts/jobs` is invoked:
1. The synthesizer inspects the requested `voiceId`.
2. If `voice.category` is `cloned_instant` or `cloned_professional`:
   - Checks `consent_records` in database / memoryStore.
   - Checks `ConsentVerificationEngine.isConsentActive(voice.id)`.
   - If consent is missing or `status === 'revoked'`, synthesis immediately aborts with:
     `HTTP 403 Forbidden: Biometric consent for cloned voice has been revoked by the owner.`
   - No audio is generated. No credits are charged. An audit event is logged.
