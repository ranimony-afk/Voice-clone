/**
 * VoiceForge PostgreSQL Schema Migration Runner
 * Creates tables, types, and indexes from schema definition
 */

import pg from 'pg';
const { Pool } = pg;

export async function runMigrations(connectionString?: string): Promise<{ success: boolean; message: string; tablesCreated?: string[] }> {
  const dbUrl = connectionString || process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith('postgres')) {
    return {
      success: false,
      message: 'DATABASE_URL not configured. Running in high-performance local store mode.',
    };
  }

  const isLocal = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl.includes('sslmode=disable');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  let client: pg.PoolClient | null = null;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Extension
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        full_name VARCHAR(120),
        password_hash VARCHAR(255),
        role VARCHAR(30) DEFAULT 'user' NOT NULL,
        credit_balance INT DEFAULT 10000 NOT NULL,
        monthly_allowance INT DEFAULT 10000 NOT NULL,
        stripe_customer_id VARCHAR(120),
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // API Keys table
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(80) NOT NULL,
        key_prefix VARCHAR(16) NOT NULL,
        key_hash VARCHAR(255) NOT NULL,
        rate_limit_per_minute INT DEFAULT 120 NOT NULL,
        last_used_at TIMESTAMPTZ,
        is_revoked BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Voices table
    await client.query(`
      CREATE TABLE IF NOT EXISTS voices (
        id VARCHAR(128) PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        name VARCHAR(120) NOT NULL,
        description TEXT,
        category VARCHAR(50) NOT NULL,
        gender VARCHAR(20) DEFAULT 'female' NOT NULL,
        primary_language VARCHAR(10) DEFAULT 'en' NOT NULL,
        supported_languages JSONB DEFAULT '["en", "hi", "ta", "ml", "ja"]'::jsonb NOT NULL,
        accent VARCHAR(80),
        preview_audio_url TEXT,
        avatar_url TEXT,
        default_settings JSONB DEFAULT '{"stability": 0.75, "similarity": 0.85, "style": 0.20, "speed": 1.0, "pitch": 0.0, "speakerBoost": true}'::jsonb NOT NULL,
        is_public BOOLEAN DEFAULT FALSE NOT NULL,
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Pronunciation Dictionaries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS dictionaries (
        id VARCHAR(128) PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        word VARCHAR(120) NOT NULL,
        phonemes VARCHAR(255) NOT NULL,
        language VARCHAR(10) DEFAULT 'en' NOT NULL,
        notes TEXT,
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Video Transform Jobs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS video_transform_jobs (
        id VARCHAR(128) PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        title VARCHAR(255),
        input_url TEXT,
        style_preset VARCHAR(60) NOT NULL,
        direction VARCHAR(30) DEFAULT 'to_animated' NOT NULL,
        custom_prompt TEXT,
        aspect_ratio VARCHAR(10) DEFAULT '16:9' NOT NULL,
        status VARCHAR(30) DEFAULT 'pending' NOT NULL,
        progress_percentage INT DEFAULT 0 NOT NULL,
        output_video_url TEXT,
        stylized_keyframe_url TEXT,
        scene_analysis TEXT,
        duration_seconds REAL DEFAULT 10.0,
        operation_name VARCHAR(255),
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Transcription & Translation Jobs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS transcription_translation_jobs (
        id VARCHAR(128) PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        media_title VARCHAR(255),
        media_url TEXT,
        source_lang VARCHAR(20) DEFAULT 'en' NOT NULL,
        source_lang_name VARCHAR(60) DEFAULT 'English',
        target_lang VARCHAR(20) DEFAULT 'ta' NOT NULL,
        target_lang_name VARCHAR(60) DEFAULT 'Tamil',
        full_transcript TEXT,
        translated_text TEXT,
        phonetic_guide TEXT,
        transcript_segments JSONB DEFAULT '[]'::jsonb NOT NULL,
        translated_segments JSONB DEFAULT '[]'::jsonb NOT NULL,
        dubbed_audio_url TEXT,
        dubbing_voice_id VARCHAR(128),
        srt_content TEXT,
        confidence REAL DEFAULT 0.98,
        status VARCHAR(30) DEFAULT 'completed' NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Dubbing Jobs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS dubbing_jobs (
        id VARCHAR(128) PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        source_media_url TEXT,
        source_language VARCHAR(20),
        target_language VARCHAR(20) NOT NULL,
        status VARCHAR(30) DEFAULT 'pending' NOT NULL,
        progress_percentage INT DEFAULT 0 NOT NULL,
        transcript_segments JSONB,
        translated_segments JSONB,
        dubbed_video_url TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        completed_at TIMESTAMPTZ
      );
    `);

    // Usage events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action_type VARCHAR(60) NOT NULL,
        units_consumed INT NOT NULL,
        credits_debited INT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // Phase 3A: Consent Records table
    await client.query(`
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
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_consent_records_user ON consent_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_consent_records_voice ON consent_records(voice_id);
    `);

    // Phase 3A: Private Media table
    await client.query(`
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
    `);

    // Phase 3A: Synthesis Jobs table
    await client.query(`
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
    `);

    // Phase 3A: Audit Events table
    await client.query(`
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
    `);

    // Phase 3B: Revoked Tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        token_hash VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(128),
        reason VARCHAR(255),
        revoked_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        expires_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON revoked_tokens(user_id);
    `);

    await client.query('COMMIT');

    return {
      success: true,
      message: 'PostgreSQL schema migrations applied successfully with all tables and indexes including Phase 3A security tables and Phase 3B durable revocation table.',
      tablesCreated: [
        'users',
        'api_keys',
        'voices',
        'dictionaries',
        'video_transform_jobs',
        'transcription_translation_jobs',
        'dubbing_jobs',
        'usage_events',
        'consent_records',
        'private_media',
        'synthesis_jobs',
        'audit_events',
        'revoked_tokens',
      ],
    };
  } catch (err: any) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }
    return {
      success: false,
      message: `Migration failed: ${err.message}`,
    };
  } finally {
    if (client) {
      try {
        client.release();
      } catch {}
    }
    try {
      await pool.end();
    } catch {}
  }
}
