/**
 * VoiceForge Core Types & Pluggable Engine Contracts
 */

export type SupportedLanguage = 'en' | 'hi' | 'ta' | 'ml' | 'ja';

export type VoiceCategory = 'premade' | 'cloned_instant' | 'cloned_professional' | 'designed';

export type VoiceGender = 'female' | 'male' | 'non_binary';

export interface VoiceSettings {
  stability: number;       // 0.0 to 1.0 (higher = more stable pitch, lower = more dynamic range)
  similarity: number;      // 0.0 to 1.0 (closeness to speaker timbre)
  style: number;           // 0.0 to 1.0 (exaggeration / expressive weight)
  speed: number;           // 0.5 to 2.0x
  pitch: number;           // -12.0 to +12.0 semitones
  speakerBoost: boolean;   // Enhances presence and high-frequency harmonics
}

export interface VoiceProfile {
  id: string;
  name: string;
  category: VoiceCategory;
  gender: VoiceGender;
  primaryLanguage: SupportedLanguage;
  supportedLanguages: SupportedLanguage[];
  accent: string;
  description: string;
  previewAudioUrl?: string;
  speakerEmbedding?: number[]; // 192-dim vector from ECAPA-TDNN
  defaultSettings: VoiceSettings;
  avatarUrl?: string;
}

export interface AudioQualityReport {
  isValid: boolean;
  snrDb: number;
  durationSeconds: number;
  clippingRatio: number;
  sampleRate: number;
  feedback: string[];
}

export interface PhonemizationResult {
  originalText: string;
  normalizedText: string;
  detectedLanguage: SupportedLanguage;
  confidence: number;
  codeSwitchSegments: {
    segmentText: string;
    language: SupportedLanguage;
    ipaPhonemes: string;
  }[];
  unifiedIpa: string;
  linguisticNotes: string[];
}

export interface SynthesisRequest {
  text: string;
  voiceId: string;
  language?: SupportedLanguage;
  settings?: Partial<VoiceSettings>;
  format?: 'wav' | 'mp3';
  sampleRate?: 22050 | 24000 | 44100;
}

export interface SynthesisResponse {
  audioBase64: string;
  format: string;
  sampleRate: number;
  durationSeconds: number;
  characterCount: number;
  creditsCharged: number;
  generationTimeMs: number;
  watermarkSignature: string;
  phonemes: string;
}

export interface ConsentVerificationRequest {
  voiceName: string;
  referenceAudioBase64?: string;
  consentAudioBase64: string;
  consentPhrase: string;
}

export interface ConsentVerificationResponse {
  verified: boolean;
  similarityScore: number; // Cosine similarity [0.0 - 1.0]
  threshold: number;      // 0.78
  voiceId?: string;
  message: string;
  auditHash: string;
}
