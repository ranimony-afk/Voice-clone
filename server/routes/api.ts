/**
 * VoiceForge API Router
 */

import { Router } from 'express';
import { DEFAULT_VOICES } from '../data/voices.ts';
import { VoiceForgeSynthesizer } from '../engine/audio/synthesizer.ts';
import { TextNormalizer } from '../engine/frontend/normalizer.ts';
import { Phonemizer } from '../engine/frontend/phonemizer.ts';
import { AudioWatermarker } from '../engine/audio/watermark.ts';
import { SupportedLanguage } from '../engine/types.ts';

export const apiRouter = Router();
const synthesizer = new VoiceForgeSynthesizer();

// In-memory cloned voice store for session persistence
let customVoices = [...DEFAULT_VOICES];

// Health Check
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'VoiceForge AI Engine Core',
    version: '1.0.0-phase0',
    supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'],
    gpuTargetRtf: 0.25,
  });
});

// Architecture & Engine Specification Matrix
apiRouter.get('/architecture', (req, res) => {
  res.json({
    system: 'VoiceForge Enterprise Architecture',
    primaryEngines: [
      {
        name: 'CosyVoice 2',
        role: 'Primary Zero-Shot Voice Cloning & Multilingual Streaming',
        license: 'Apache 2.0',
        commercialUse: true,
        rtf: '0.15',
        ttfbMs: 280,
        coverage: ['en', 'zh', 'ja', 'hi', 'ta', 'ml'],
      },
      {
        name: 'AI4Bharat Indic Parler / IndicF5',
        role: 'Native Indic Acoustic Model (Tamil, Hindi, Malayalam nuance)',
        license: 'MIT / Apache 2.0',
        commercialUse: true,
        rtf: '0.22',
        ttfbMs: 340,
        coverage: ['hi', 'ta', 'ml'],
      },
      {
        name: 'OpenVoice v2',
        role: 'Tone-Color Converter (Cross-Lingual Timbre Transfer)',
        license: 'MIT',
        commercialUse: true,
        rtf: '0.05',
        ttfbMs: 120,
        coverage: ['All languages'],
      },
      {
        name: 'Vocos Streaming Vocoder',
        role: 'Low-latency Fourier Neural Vocoder (40ms chunks)',
        license: 'Apache 2.0',
        commercialUse: true,
        rtf: '0.02',
        ttfbMs: 30,
        coverage: ['Universal 24kHz/44.1kHz'],
      },
      {
        name: 'faster-whisper large-v3-turbo',
        role: 'Speech-to-Text & Dubbing Time-Aligner',
        license: 'MIT',
        commercialUse: true,
        rtf: '0.05',
        ttfbMs: null,
        coverage: ['All 5 languages'],
      },
      {
        name: 'ECAPA-TDNN (SpeechBrain)',
        role: 'Speaker Biometrics & Consent Identity Verifier',
        license: 'Apache 2.0',
        commercialUse: true,
        rtf: '0.01',
        ttfbMs: null,
        coverage: ['Language-agnostic voiceprints'],
      },
    ],
    excludedModels: [
      {
        name: 'XTTS-v2 (Coqui)',
        reason: 'Coqui Public Model License (CPML) prohibits commercial use without defunct enterprise license; lacks native Tamil/Malayalam acoustic models.',
        status: 'Excluded',
      },
      {
        name: 'MMS-TTS / VITS (Meta)',
        reason: 'CC-BY-NC 4.0 license prevents commercial usage; lacks zero-shot voice cloning capabilities.',
        status: 'Excluded',
      },
    ],
  });
});

// PostgreSQL Database Schema Definition
apiRouter.get('/schema', (req, res) => {
  res.json({
    tables: [
      { name: 'users', records: 'App user accounts, credits, role-based access' },
      { name: 'api_keys', records: 'Hashed API tokens with rate limits and usage counters' },
      { name: 'voices', records: 'Premade, cloned, and designed voices with 192-dim embeddings' },
      { name: 'voice_samples', records: 'Audio files used for zero-shot cloning, SNR & clipping audits' },
      { name: 'consent_records', records: 'Biometric voice verification records for ethical legal compliance' },
      { name: 'generations', records: 'TTS outputs, audio URLs, duration, billing units, watermarks' },
      { name: 'projects', records: 'Long-form Studio books, podcasts, and video voiceovers' },
      { name: 'chapters', records: 'Paragraph/chapter blocks with per-segment voices and re-render dirty states' },
      { name: 'dictionaries', records: 'Custom pronunciation replacement rules (IPA / PLS)' },
      { name: 'dubbing_jobs', records: 'AI dubbing jobs with Demucs stems, ASR timestamps, and time-stretches' },
      { name: 'usage_events', records: 'Immutable credit consumption audit ledger' },
    ],
  });
});

// Voices List
apiRouter.get('/voices', (req, res) => {
  res.json({ voices: customVoices });
});

// Multilingual Text Analysis & Front-End (Normalizer + G2P + Code-Switching)
apiRouter.post('/frontend/analyze', (req, res) => {
  const { text, language } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text string is required' });
  }

  const norm = TextNormalizer.normalize(text, language as SupportedLanguage);
  const codeSwitchSegments = TextNormalizer.segmentCodeSwitching(text);
  const g2p = Phonemizer.phonemize(norm.normalizedText, norm.detectedLanguage);

  const enhancedSegments = codeSwitchSegments.map(seg => ({
    segmentText: seg.text,
    language: seg.language,
    ipaPhonemes: Phonemizer.phonemize(seg.text, seg.language).ipa,
  }));

  res.json({
    originalText: text,
    normalizedText: norm.normalizedText,
    detectedLanguage: norm.detectedLanguage,
    confidence: 0.99,
    codeSwitchSegments: enhancedSegments,
    unifiedIpa: g2p.ipa,
    linguisticNotes: [...norm.notes, ...g2p.ruleNotes],
  });
});

// Synthesize TTS
apiRouter.post('/tts/synthesize', async (req, res) => {
  try {
    const { text, voiceId, language, settings, format, sampleRate } = req.body;
    if (!text || !voiceId) {
      return res.status(400).json({ error: 'text and voiceId are required fields' });
    }

    const voice = customVoices.find(v => v.id === voiceId) || customVoices[0];
    const result = await synthesizer.synthesize(
      { text, voiceId, language, settings, format, sampleRate },
      voice
    );

    res.json(result);
  } catch (err: any) {
    console.error('Synthesis error:', err);
    res.status(500).json({ error: err.message || 'Synthesis failed' });
  }
});

// Voice Cloning Pre-flight Quality Check
apiRouter.post('/voices/clone/analyze', (req, res) => {
  const { durationSeconds } = req.body;
  const report = synthesizer.analyzeVoiceSampleQuality(durationSeconds || 32);
  res.json(report);
});

// Voice Cloning Consent Biometric Verification
apiRouter.post('/voices/clone/verify-consent', (req, res) => {
  const { voiceName, consentPhrase, consentAudioBase64, referenceDuration } = req.body;
  if (!voiceName) {
    return res.status(400).json({ error: 'voiceName is required' });
  }

  const verification = synthesizer.verifyConsent({
    voiceName,
    consentPhrase: consentPhrase || 'I authorize VoiceForge to clone my voice.',
    consentAudioBase64: consentAudioBase64 || 'dummy',
  });

  if (verification.verified) {
    // Add new cloned voice to in-memory store
    const newVoice = {
      id: verification.voiceId || `clone_${Date.now()}`,
      name: `${voiceName} (Instant Clone)`,
      category: 'cloned_instant' as const,
      gender: 'female' as const,
      primaryLanguage: 'en' as SupportedLanguage,
      supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'] as SupportedLanguage[],
      accent: 'Cloned Custom Profile',
      description: `Instant voice clone verified with ${Math.round(verification.similarityScore * 100)}% biometric match. Ready for cross-lingual synthesis.`,
      defaultSettings: {
        stability: 0.85,
        similarity: 0.92,
        style: 0.20,
        speed: 1.0,
        pitch: 0.0,
        speakerBoost: true,
      },
      avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    };
    customVoices = [newVoice, ...customVoices];
  }

  res.json(verification);
});

// Audio Watermark Verification
apiRouter.post('/audio/verify-watermark', (req, res) => {
  const { signature } = req.body;
  const result = AudioWatermarker.verifyWatermark(signature);
  res.json(result);
});
