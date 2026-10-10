-- ============================================================================
-- VoiceForge Production PostgreSQL Schema (PostgreSQL 15+)
-- Database: voiceforge_prod
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('user', 'pro', 'enterprise', 'admin');
CREATE TYPE voice_category AS ENUM ('premade', 'cloned_instant', 'cloned_professional', 'designed');
CREATE TYPE voice_gender AS ENUM ('female', 'male', 'non_binary');
CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE supported_language AS ENUM ('en', 'hi', 'ta', 'ml', 'ja');
CREATE TYPE audio_format AS ENUM ('mp3', 'wav', 'ogg_opus', 'flac');
CREATE TYPE consent_status AS ENUM ('approved', 'rejected', 'pending_review');

-- ----------------------------------------------------------------------------
-- 1. USERS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(120),
    password_hash VARCHAR(255),
    role user_role DEFAULT 'user' NOT NULL,
    credit_balance BIGINT DEFAULT 10000 NOT NULL, -- 10,000 characters free on signup
    monthly_allowance BIGINT DEFAULT 10000 NOT NULL,
    stripe_customer_id VARCHAR(120),
    stripe_subscription_id VARCHAR(120),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe ON users(stripe_customer_id);

-- ----------------------------------------------------------------------------
-- 2. API KEYS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    key_prefix VARCHAR(12) NOT NULL, -- e.g. "vf_live_3f9a"
    key_hash VARCHAR(255) NOT NULL,   -- SHA-256 hash of secret key
    rate_limit_per_minute INT DEFAULT 120 NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    is_revoked BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- ----------------------------------------------------------------------------
-- 3. VOICES TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE voices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL for system premade voices
    name VARCHAR(120) NOT NULL,
    description TEXT,
    category voice_category NOT NULL,
    gender voice_gender DEFAULT 'female' NOT NULL,
    primary_language supported_language DEFAULT 'en' NOT NULL,
    supported_languages supported_language[] DEFAULT '{en,hi,ta,ml,ja}' NOT NULL,
    accent VARCHAR(60), -- e.g. "Tamil-English", "Tokyo", "Standard Hindi", "Kerala"
    preview_audio_url TEXT,
    speaker_embedding_vector REAL[], -- 192 or 512-dim embedding vector from ECAPA-TDNN / CosyVoice
    default_settings JSONB DEFAULT '{"stability": 0.75, "similarity": 0.85, "style": 0.20, "speed": 1.0, "pitch": 0.0}'::jsonb NOT NULL,
    is_public BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_voices_user ON voices(user_id);
CREATE INDEX idx_voices_category ON voices(category);
CREATE INDEX idx_voices_public ON voices(is_public) WHERE is_public = TRUE;

-- ----------------------------------------------------------------------------
-- 4. VOICE SAMPLES TABLE (Cloning reference audio)
-- ----------------------------------------------------------------------------
CREATE TABLE voice_samples (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voice_id UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    storage_url TEXT NOT NULL,
    duration_seconds REAL NOT NULL,
    sample_rate INT NOT NULL,
    channels INT NOT NULL,
    snr_db REAL, -- Signal-to-noise ratio in decibels
    clipping_ratio REAL, -- Percentage of clipped audio frames
    is_normalized BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_voice_samples_voice ON voice_samples(voice_id);

-- ----------------------------------------------------------------------------
-- 5. CONSENT RECORDS TABLE (Ethical AI & Legal Verification)
-- ----------------------------------------------------------------------------
CREATE TABLE consent_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    voice_id UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
    consent_phrase_prompt TEXT NOT NULL,
    recorded_audio_url TEXT NOT NULL,
    speaker_similarity_score REAL NOT NULL, -- Similarity score between reference sample and consent statement
    ip_address INET,
    user_agent TEXT,
    status consent_status DEFAULT 'approved' NOT NULL,
    verified_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_consent_records_user ON consent_records(user_id);
CREATE INDEX idx_consent_records_voice ON consent_records(voice_id);

-- ----------------------------------------------------------------------------
-- 6. GENERATIONS TABLE (TTS output logs)
-- ----------------------------------------------------------------------------
CREATE TABLE generations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    voice_id UUID NOT NULL REFERENCES voices(id) ON DELETE RESTRICT,
    input_text TEXT NOT NULL,
    normalized_text TEXT,
    language supported_language NOT NULL,
    output_audio_url TEXT NOT NULL,
    audio_format audio_format DEFAULT 'mp3' NOT NULL,
    sample_rate INT DEFAULT 24000 NOT NULL,
    duration_seconds REAL NOT NULL,
    character_count INT NOT NULL,
    credits_charged INT NOT NULL,
    generation_time_ms INT NOT NULL,
    ttfb_ms INT, -- Time to first byte
    settings JSONB NOT NULL,
    watermark_signature VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_generations_user ON generations(user_id);
CREATE INDEX idx_generations_voice ON generations(voice_id);
CREATE INDEX idx_generations_created ON generations(created_at DESC);

-- ----------------------------------------------------------------------------
-- 7. PROJECTS TABLE (Long-form audiobooks / podcasts)
-- ----------------------------------------------------------------------------
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    target_language supported_language DEFAULT 'en' NOT NULL,
    default_voice_id UUID REFERENCES voices(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_projects_user ON projects(user_id);

-- ----------------------------------------------------------------------------
-- 8. CHAPTERS TABLE (Project paragraphs / sections)
-- ----------------------------------------------------------------------------
CREATE TABLE chapters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    order_index INT NOT NULL,
    title VARCHAR(150),
    raw_content TEXT NOT NULL,
    voice_id UUID REFERENCES voices(id) ON DELETE SET NULL,
    settings JSONB,
    rendered_audio_url TEXT,
    duration_seconds REAL,
    is_dirty BOOLEAN DEFAULT TRUE NOT NULL, -- Needs re-synthesis
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_chapters_project ON chapters(project_id, order_index);

-- ----------------------------------------------------------------------------
-- 9. PRONUNCIATION DICTIONARIES TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE dictionaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    language supported_language NOT NULL,
    rules JSONB DEFAULT '[]'::jsonb NOT NULL, -- Array of {word: string, replacement: string, type: 'ipa' | 'alias'}
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_dictionaries_user ON dictionaries(user_id);

-- ----------------------------------------------------------------------------
-- 10. DUBBING JOBS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE dubbing_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_media_url TEXT NOT NULL,
    source_language supported_language,
    target_language supported_language NOT NULL,
    status job_status DEFAULT 'pending' NOT NULL,
    progress_percentage INT DEFAULT 0 NOT NULL,
    vocal_stem_url TEXT,
    background_stem_url TEXT,
    transcript_segments JSONB, -- Array of {start: float, end: float, text: string, speaker: string}
    translated_segments JSONB, -- Array of translated & time-aligned utterances
    output_media_url TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_dubbing_jobs_user ON dubbing_jobs(user_id);
CREATE INDEX idx_dubbing_jobs_status ON dubbing_jobs(status);

-- ----------------------------------------------------------------------------
-- 11. USAGE EVENTS TABLE (Billing & Audit Ledger)
-- ----------------------------------------------------------------------------
CREATE TABLE usage_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL, -- 'tts_generation', 'voice_clone', 'dubbing_minute'
    units_consumed INT NOT NULL, -- characters or audio seconds
    credits_debited INT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_usage_events_user ON usage_events(user_id, created_at DESC);
