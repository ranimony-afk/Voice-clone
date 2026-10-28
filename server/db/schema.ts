import { pgTable, text, varchar, integer, boolean, timestamp, jsonb, real, uuid } from 'drizzle-orm/pg-core';

// Users Table
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  fullName: varchar('full_name', { length: 120 }),
  passwordHash: varchar('password_hash', { length: 255 }),
  role: varchar('role', { length: 30 }).default('user').notNull(),
  creditBalance: integer('credit_balance').default(10000).notNull(),
  monthlyAllowance: integer('monthly_allowance').default(10000).notNull(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 120 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// API Keys Table
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
  keyHash: varchar('key_hash', { length: 255 }).notNull(),
  rateLimitPerMinute: integer('rate_limit_per_minute').default(120).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  isRevoked: boolean('is_revoked').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Voices Table
export const voices = pgTable('voices', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 50 }).notNull(), // 'premade' | 'cloned_instant' | 'cloned_professional' | 'designed'
  gender: varchar('gender', { length: 20 }).default('female').notNull(),
  primaryLanguage: varchar('primary_language', { length: 10 }).default('en').notNull(),
  supportedLanguages: jsonb('supported_languages').default(['en', 'hi', 'ta', 'ml', 'ja']).notNull(),
  accent: varchar('accent', { length: 80 }),
  previewAudioUrl: text('preview_audio_url'),
  avatarUrl: text('avatar_url'),
  defaultSettings: jsonb('default_settings').default({
    stability: 0.75,
    similarity: 0.85,
    style: 0.20,
    speed: 1.0,
    pitch: 0.0,
    speakerBoost: true,
  }).notNull(),
  isPublic: boolean('is_public').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Pronunciation Dictionaries Table (Personal Pronunciation Dictionary overrides)
export const dictionaries = pgTable('dictionaries', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  word: varchar('word', { length: 120 }).notNull(),
  phonemes: varchar('phonemes', { length: 255 }).notNull(),
  language: varchar('language', { length: 10 }).default('en').notNull(),
  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Video Transform Jobs Table (Ghibli, Anime, Pixar & Vice-Versa)
export const videoTransformJobs = pgTable('video_transform_jobs', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  title: varchar('title', { length: 255 }),
  inputUrl: text('input_url'),
  stylePreset: varchar('style_preset', { length: 60 }).notNull(),
  direction: varchar('direction', { length: 30 }).default('to_animated').notNull(), // 'to_animated' | 'to_realistic'
  customPrompt: text('custom_prompt'),
  aspectRatio: varchar('aspect_ratio', { length: 10 }).default('16:9').notNull(),
  status: varchar('status', { length: 30 }).default('pending').notNull(), // 'pending' | 'processing' | 'completed' | 'failed'
  progressPercentage: integer('progress_percentage').default(0).notNull(),
  outputVideoUrl: text('output_video_url'),
  stylizedKeyframeUrl: text('stylized_keyframe_url'),
  sceneAnalysis: text('scene_analysis'),
  durationSeconds: real('duration_seconds').default(10.0),
  operationName: varchar('operation_name', { length: 255 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Transcription & Translation Jobs Table
export const transcriptionTranslationJobs = pgTable('transcription_translation_jobs', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  mediaTitle: varchar('media_title', { length: 255 }),
  mediaUrl: text('media_url'),
  sourceLang: varchar('source_lang', { length: 20 }).default('en').notNull(),
  sourceLangName: varchar('source_lang_name', { length: 60 }).default('English'),
  targetLang: varchar('target_lang', { length: 20 }).default('ta').notNull(),
  targetLangName: varchar('target_lang_name', { length: 60 }).default('Tamil'),
  fullTranscript: text('full_transcript'),
  translatedText: text('translated_text'),
  phoneticGuide: text('phonetic_guide'),
  transcriptSegments: jsonb('transcript_segments').default([]).notNull(),
  translatedSegments: jsonb('translated_segments').default([]).notNull(),
  dubbedAudioUrl: text('dubbed_audio_url'),
  dubbingVoiceId: varchar('dubbing_voice_id', { length: 128 }),
  srtContent: text('srt_content'),
  confidence: real('confidence').default(0.98),
  status: varchar('status', { length: 30 }).default('completed').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Speech Synthesis Generations Table
export const generations = pgTable('generations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  voiceId: varchar('voice_id', { length: 128 }).notNull(),
  inputText: text('input_text').notNull(),
  normalizedText: text('normalized_text'),
  language: varchar('language', { length: 10 }).notNull(),
  outputAudioUrl: text('output_audio_url').notNull(),
  audioFormat: varchar('audio_format', { length: 20 }).default('mp3').notNull(),
  durationSeconds: real('duration_seconds').notNull(),
  characterCount: integer('character_count').notNull(),
  creditsCharged: integer('credits_charged').notNull(),
  watermarkSignature: varchar('watermark_signature', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Dubbing Jobs Table
export const dubbingJobs = pgTable('dubbing_jobs', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  sourceMediaUrl: text('source_media_url'),
  sourceLanguage: varchar('source_language', { length: 20 }),
  targetLanguage: varchar('target_language', { length: 20 }).notNull(),
  status: varchar('status', { length: 30 }).default('pending').notNull(),
  progressPercentage: integer('progress_percentage').default(0).notNull(),
  transcriptSegments: jsonb('transcript_segments'),
  translatedSegments: jsonb('translated_segments'),
  dubbedVideoUrl: text('dubbed_video_url'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// Usage Events Table
export const usageEvents = pgTable('usage_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  actionType: varchar('action_type', { length: 60 }).notNull(),
  unitsConsumed: integer('units_consumed').notNull(),
  creditsDebited: integer('credits_debited').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Consent Records Table (Biometric Voice Verification & Ownership)
export const consentRecords = pgTable('consent_records', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: varchar('user_id', { length: 128 }).notNull(),
  voiceId: varchar('voice_id', { length: 128 }).notNull(),
  voiceName: varchar('voice_name', { length: 120 }).notNull(),
  challengeId: varchar('challenge_id', { length: 128 }).notNull(),
  requiredPhrase: text('required_phrase').notNull(),
  referenceAudioHash: varchar('reference_audio_hash', { length: 64 }).notNull(),
  consentAudioHash: varchar('consent_audio_hash', { length: 64 }).notNull(),
  similarityScore: real('similarity_score').notNull(),
  threshold: real('threshold').default(0.72).notNull(),
  status: varchar('status', { length: 30 }).default('active').notNull(), // 'active' | 'revoked'
  verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  auditSignature: text('audit_signature').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Private Media Table (Encrypted/Private Storage Metadata & Magic-Byte Validated Audio)
export const privateMedia = pgTable('private_media', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: varchar('user_id', { length: 128 }).notNull(),
  mediaType: varchar('media_type', { length: 50 }).notNull(), // 'reference_audio' | 'consent_audio' | 'tts_output' | 'stem'
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  filename: varchar('filename', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  byteSize: integer('byte_size').notNull(),
  sha256Hash: varchar('sha256_hash', { length: 64 }).notNull(),
  audioFormat: varchar('audio_format', { length: 20 }).notNull(), // 'wav' | 'mp3' | 'webm' | 'ogg' | 'flac'
  isEncrypted: boolean('is_encrypted').default(false).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Synthesis Jobs Table (Asynchronous and Stateful Synthesis with Ownership & Execution Mode)
export const synthesisJobs = pgTable('synthesis_jobs', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: varchar('user_id', { length: 128 }).notNull(),
  voiceId: varchar('voice_id', { length: 128 }).notNull(),
  status: varchar('status', { length: 30 }).default('pending').notNull(), // 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  executionMode: varchar('execution_mode', { length: 20 }).notNull(), // 'NEURAL' | 'DEMO' | 'UNAVAILABLE'
  inputText: text('input_text').notNull(),
  language: varchar('language', { length: 10 }).notNull(),
  outputMediaId: varchar('output_media_id', { length: 128 }),
  outputSignedUrl: text('output_signed_url'),
  durationSeconds: real('duration_seconds'),
  characterCount: integer('character_count'),
  creditsCharged: integer('credits_charged').default(0).notNull(),
  watermarkSignature: varchar('watermark_signature', { length: 128 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// Audit Events Table (Tamper-Evident Security Log for Sensitive Operations)
export const auditEvents = pgTable('audit_events', {
  id: varchar('id', { length: 128 }).primaryKey(),
  userId: varchar('user_id', { length: 128 }).notNull(),
  eventType: varchar('event_type', { length: 60 }).notNull(), // 'consent_enrolled' | 'consent_revoked' | 'voice_created' | 'voice_deleted' | 'synthesis_dispatched' | 'media_accessed' | 'unauthorized_access_attempt'
  resourceId: varchar('resource_id', { length: 128 }),
  ipAddress: varchar('ip_address', { length: 64 }),
  userAgent: text('user_agent'),
  status: varchar('status', { length: 30 }).notNull(), // 'success' | 'failure' | 'denied'
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Revoked Tokens Table (Durable Token Revocation Registry storing SHA-256 hashes only)
export const revokedTokens = pgTable('revoked_tokens', {
  tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
  userId: varchar('user_id', { length: 128 }),
  reason: varchar('reason', { length: 255 }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

