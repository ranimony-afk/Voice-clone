-- VoiceForge Phase 3A: Secure Identity, Ownership, Consent and Persistence Foundation
-- Migration: 0001_phase3a_security_persistence.sql

-- 1. Consent Records Table
CREATE TABLE IF NOT EXISTS consent_records (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  voice_id VARCHAR(128) NOT NULL,
  voice_name VARCHAR(120) NOT NULL,
  challenge_id VARCHAR(128) NOT NULL,
  required_phrase TEXT NOT NULL,
  reference_audio_hash VARCHAR(64) NOT NULL,
  consent_audio_hash VARCHAR(64) NOT NULL,
  similarity_score REAL NOT NULL,
  threshold REAL DEFAULT 0.72 NOT NULL,
  status VARCHAR(30) DEFAULT 'active' NOT NULL,
  verified_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  revoked_at TIMESTAMPTZ,
  audit_signature TEXT NOT NULL,
  createdAt TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consent_records_user ON consent_records(user_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_voice ON consent_records(voice_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_status ON consent_records(status);

-- 2. Private Media Table
CREATE TABLE IF NOT EXISTS private_media (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  media_type VARCHAR(50) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  byte_size INT NOT NULL,
  sha256_hash VARCHAR(64) NOT NULL,
  audio_format VARCHAR(20) NOT NULL,
  is_encrypted BOOLEAN DEFAULT FALSE NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_private_media_user ON private_media(user_id);
CREATE INDEX IF NOT EXISTS idx_private_media_type ON private_media(media_type);

-- 3. Synthesis Jobs Table
CREATE TABLE IF NOT EXISTS synthesis_jobs (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  voice_id VARCHAR(128) NOT NULL,
  status VARCHAR(30) DEFAULT 'pending' NOT NULL,
  execution_mode VARCHAR(20) NOT NULL,
  input_text TEXT NOT NULL,
  language VARCHAR(10) NOT NULL,
  output_media_id VARCHAR(128),
  output_signed_url TEXT,
  duration_seconds REAL,
  character_count INT,
  credits_charged INT DEFAULT 0 NOT NULL,
  watermark_signature VARCHAR(128),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_user ON synthesis_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_voice ON synthesis_jobs(voice_id);
CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_status ON synthesis_jobs(status);

-- 4. Audit Events Table
CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  resource_id VARCHAR(128),
  ip_address VARCHAR(64),
  user_agent TEXT,
  status VARCHAR(30) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_user ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);

-- 5. Revoked Tokens Table (Durable Token Revocation Registry)
CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128),
  reason VARCHAR(255),
  revoked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);

