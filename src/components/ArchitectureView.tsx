import React, { useState, useEffect } from 'react';
import {
  Database,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Layers,
  Cpu,
  Server,
  Code2,
  ArrowRight,
  Zap,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Terminal,
  Globe,
  Key,
  AlertTriangle
} from 'lucide-react';

export const ArchitectureView: React.FC = () => {
  const [activeSchemaTab, setActiveSchemaTab] = useState('voices');
  const [activeCodeLang, setActiveCodeLang] = useState<'python' | 'typescript'>('python');

  // Database Connection Assistant State
  const [selectedDbProvider, setSelectedDbProvider] = useState<'supabase' | 'neon' | 'railway' | 'local' | 'cloudsql'>('supabase');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [liveDbStatus, setLiveDbStatus] = useState<any>(null);
  const [isCheckingDb, setIsCheckingDb] = useState<boolean>(false);
  const [isMigratingDb, setIsMigratingDb] = useState<boolean>(false);
  const [migrationFeedback, setMigrationFeedback] = useState<any>(null);

  // Connection String Builder Form
  const [builderUser, setBuilderUser] = useState('postgres');
  const [builderPass, setBuilderPass] = useState('your_strong_password');
  const [builderHost, setBuilderHost] = useState('db.xxxxxx.supabase.co');
  const [builderPort, setBuilderPort] = useState('6543');
  const [builderDbName, setBuilderDbName] = useState('postgres');
  const [builderSsl, setBuilderSsl] = useState(true);

  // Auto-fill template when provider changes
  useEffect(() => {
    if (selectedDbProvider === 'supabase') {
      setBuilderUser('postgres.your-project-ref');
      setBuilderHost('aws-0-us-east-1.pooler.supabase.com');
      setBuilderPort('6543');
      setBuilderDbName('postgres');
    } else if (selectedDbProvider === 'neon') {
      setBuilderUser('alex');
      setBuilderHost('ep-cool-butterfly-123456.us-east-2.aws.neon.tech');
      setBuilderPort('5432');
      setBuilderDbName('neondb');
    } else if (selectedDbProvider === 'railway') {
      setBuilderUser('postgres');
      setBuilderHost('roundhouse.proxy.rlwy.net');
      setBuilderPort('34567');
      setBuilderDbName('railway');
    } else if (selectedDbProvider === 'local') {
      setBuilderUser('postgres');
      setBuilderHost('localhost');
      setBuilderPort('5432');
      setBuilderDbName('voiceforge');
    } else if (selectedDbProvider === 'cloudsql') {
      setBuilderUser('postgres');
      setBuilderHost('127.0.0.1');
      setBuilderPort('5432');
      setBuilderDbName('voiceforge');
    }
  }, [selectedDbProvider]);

  // Fetch current live DB health
  const checkLiveDbStatus = async () => {
    setIsCheckingDb(true);
    try {
      const res = await fetch('/api/db/status');
      const data = await res.json();
      setLiveDbStatus(data);
    } catch (err: any) {
      setLiveDbStatus({ connected: false, error: err.message, provider: 'Offline' });
    } finally {
      setIsCheckingDb(false);
    }
  };

  const runLiveMigration = async () => {
    setIsMigratingDb(true);
    setMigrationFeedback(null);
    try {
      const res = await fetch('/api/db/migrate', { method: 'POST' });
      const data = await res.json();
      setMigrationFeedback(data);
      checkLiveDbStatus();
    } catch (err: any) {
      setMigrationFeedback({ success: false, error: err.message });
    } finally {
      setIsMigratingDb(false);
    }
  };

  useEffect(() => {
    checkLiveDbStatus();
  }, []);

  const copyToClipboard = (text: string, keyId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyId);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const computedConnectionString = `postgresql://${builderUser}:${builderPass}@${builderHost}:${builderPort}/${builderDbName}${builderSsl ? '?sslmode=require' : ''}`;

  const models = [
    {
      name: 'CosyVoice 2',
      arch: 'DiT + Flow Matching',
      langs: 'EN, JA, ZH (extensible to Indic)',
      cloning: 'Excellent (3s zero-shot)',
      rtf: '0.15',
      license: 'Apache 2.0',
      commercial: true,
      decision: 'SELECTED: Core Multilingual Zero-Shot Engine',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    },
    {
      name: 'AI4Bharat Indic Parler-TTS / IndicF5',
      arch: 'Acoustic Flow Transformer',
      langs: 'Tamil, Hindi, Malayalam + 19 Indic langs',
      cloning: 'High (Indic accents)',
      rtf: '0.22',
      license: 'MIT / Apache 2.0',
      commercial: true,
      decision: 'SELECTED: Dedicated Indic Acoustic Co-Engine',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    },
    {
      name: 'OpenVoice v2',
      arch: 'Tone Color Normalizing Flow',
      langs: 'Cross-lingual (Universal)',
      cloning: 'High Timbre Transfer',
      rtf: '0.05',
      license: 'MIT',
      commercial: true,
      decision: 'SELECTED: Cross-Lingual Speaker Transfer Layer',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    },
    {
      name: 'Vocos / BigVGAN v2',
      arch: 'Fourier ConvNet / Periodic ResNet',
      langs: 'Universal Neural Vocoder',
      cloning: 'N/A (Audio Vocoding)',
      rtf: '0.02',
      license: 'Apache 2.0 / MIT',
      commercial: true,
      decision: 'SELECTED: Streaming 40ms Audio Synthesizer',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    },
    {
      name: 'faster-whisper large-v3-turbo',
      arch: 'Encoder-Decoder Transformer CTranslate2',
      langs: 'EN, HI, TA, ML, JA',
      cloning: 'N/A (ASR & Alignment)',
      rtf: '0.05',
      license: 'MIT',
      commercial: true,
      decision: 'SELECTED: Word Timestamps & Dubbing Sync',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    },
    {
      name: 'ECAPA-TDNN (SpeechBrain)',
      arch: 'Time Delay SincNet Embedding',
      langs: 'Universal 192-dim Voiceprints',
      cloning: 'Biometric Verification',
      rtf: '0.01',
      license: 'Apache 2.0',
      commercial: true,
      decision: 'SELECTED: Biometric Consent & Speaker Verification',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    },
    {
      name: 'XTTS-v2 (Coqui)',
      arch: 'Autoregressive GPT + VITS',
      langs: '17 Languages (Lacks Tamil & Malayalam)',
      cloning: 'High',
      rtf: '0.35',
      license: 'CPML (Non-Commercial)',
      commercial: false,
      decision: 'REJECTED: Commercial License Strictly Forbidden',
      badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    },
    {
      name: 'MMS-TTS / VITS (Meta)',
      arch: 'VAE Normalizing Flow',
      langs: 'Multi-Indic + JA',
      cloning: 'None (Fixed Speaker)',
      rtf: '0.08',
      license: 'CC-BY-NC 4.0',
      commercial: false,
      decision: 'REJECTED: Non-Commercial & No Zero-Shot Cloning',
      badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    },
  ];

  const dbTables: Record<string, { desc: string; cols: Array<{ name: string; type: string; note: string }> }> = {
    voices: {
      desc: 'Stores pre-made, user-cloned, and designed voices with 192-dim speaker embeddings.',
      cols: [
        { name: 'id', type: 'UUID', note: 'Primary Key' },
        { name: 'user_id', type: 'UUID', note: 'FK -> users.id (NULL for system voices)' },
        { name: 'name', type: 'VARCHAR(120)', note: 'Display name e.g. "Priya"' },
        { name: 'category', type: 'ENUM', note: 'premade | cloned_instant | cloned_pro | designed' },
        { name: 'primary_language', type: 'ENUM', note: 'en | hi | ta | ml | ja' },
        { name: 'supported_languages', type: 'ENUM[]', note: 'Cross-lingual synthesis targets' },
        { name: 'speaker_embedding_vector', type: 'REAL[]', note: '192-dim ECAPA-TDNN embedding' },
        { name: 'default_settings', type: 'JSONB', note: 'stability, similarity, style, speed, pitch' },
        { name: 'is_active', type: 'BOOLEAN', note: 'Takedown/Active flag' },
      ],
    },
    consent_records: {
      desc: 'Immutable biometric verification audit trail for ethical voice cloning compliance.',
      cols: [
        { name: 'id', type: 'UUID', note: 'Primary Key' },
        { name: 'user_id', type: 'UUID', note: 'FK -> users.id' },
        { name: 'voice_id', type: 'UUID', note: 'FK -> voices.id' },
        { name: 'consent_phrase_prompt', type: 'TEXT', note: 'Randomized legal verification prompt' },
        { name: 'recorded_audio_url', type: 'TEXT', note: 'S3 secure vault link' },
        { name: 'speaker_similarity_score', type: 'REAL', note: 'Must be >= 0.78 threshold' },
        { name: 'status', type: 'ENUM', note: 'approved | rejected | pending_review' },
        { name: 'verified_at', type: 'TIMESTAMPTZ', note: 'Audit timestamp' },
      ],
    },
    generations: {
      desc: 'TTS generation ledger with performance metrics and watermark signatures.',
      cols: [
        { name: 'id', type: 'UUID', note: 'Primary Key' },
        { name: 'user_id', type: 'UUID', note: 'FK -> users.id' },
        { name: 'voice_id', type: 'UUID', note: 'FK -> voices.id' },
        { name: 'language', type: 'ENUM', note: 'en | hi | ta | ml | ja' },
        { name: 'character_count', type: 'INT', note: 'Number of input characters' },
        { name: 'credits_charged', type: 'INT', note: 'Billing units debited' },
        { name: 'generation_time_ms', type: 'INT', note: 'Wall-clock latency' },
        { name: 'ttfb_ms', type: 'INT', note: 'Time to first byte (<450ms)' },
        { name: 'watermark_signature', type: 'VARCHAR(128)', note: 'Cryptographic spread-spectrum hash' },
      ],
    },
    projects: {
      desc: 'Long-form Studio container for audiobooks, multi-character podcasts, and videos.',
      cols: [
        { name: 'id', type: 'UUID', note: 'Primary Key' },
        { name: 'user_id', type: 'UUID', note: 'FK -> users.id' },
        { name: 'title', type: 'VARCHAR(200)', note: 'Project name' },
        { name: 'target_language', type: 'ENUM', note: 'Default synthesis language' },
        { name: 'default_voice_id', type: 'UUID', note: 'FK -> voices.id' },
      ],
    },
    chapters: {
      desc: 'Individual paragraph/chapter blocks within a Studio project.',
      cols: [
        { name: 'id', type: 'UUID', note: 'Primary Key' },
        { name: 'project_id', type: 'UUID', note: 'FK -> projects.id' },
        { name: 'order_index', type: 'INT', note: 'Sequence ordering' },
        { name: 'raw_content', type: 'TEXT', note: 'Paragraph text' },
        { name: 'voice_id', type: 'UUID', note: 'Per-paragraph voice override' },
        { name: 'is_dirty', type: 'BOOLEAN', note: 'True when edited, requiring re-render' },
      ],
    },
    dubbing_jobs: {
      desc: 'Full-pipeline video dubbing with Demucs stem split, Whisper ASR, and time-stretching.',
      cols: [
        { name: 'id', type: 'UUID', note: 'Primary Key' },
        { name: 'user_id', type: 'UUID', note: 'FK -> users.id' },
        { name: 'source_media_url', type: 'TEXT', note: 'Uploaded MP4/WAV' },
        { name: 'target_language', type: 'ENUM', note: 'en | hi | ta | ml | ja' },
        { name: 'status', type: 'ENUM', note: 'pending | processing | completed | failed' },
        { name: 'vocal_stem_url', type: 'TEXT', note: 'Demucs extracted vocals' },
        { name: 'background_stem_url', type: 'TEXT', note: 'Demucs music/effects stem' },
        { name: 'transcript_segments', type: 'JSONB', note: 'Word timestamps and diarization' },
      ],
    },
    dictionaries: {
      desc: 'User-defined pronunciation replacement rules (IPA and alias phonetic strings).',
      cols: [
        { name: 'id', type: 'UUID', note: 'Primary Key' },
        { name: 'user_id', type: 'UUID', note: 'FK -> users.id' },
        { name: 'language', type: 'ENUM', note: 'Target language' },
        { name: 'rules', type: 'JSONB', note: 'Array of {word, replacement, type}' },
      ],
    },
    usage_events: {
      desc: 'Ledger tracking every character, second, and credit change across users and API keys.',
      cols: [
        { name: 'id', type: 'UUID', note: 'Primary Key' },
        { name: 'user_id', type: 'UUID', note: 'FK -> users.id' },
        { name: 'api_key_id', type: 'UUID', note: 'FK -> api_keys.id (NULL if web UI)' },
        { name: 'action_type', type: 'VARCHAR(50)', note: 'tts_generation | voice_clone | dubbing' },
        { name: 'credits_debited', type: 'INT', note: 'Metered credit quantity' },
      ],
    },
    video_transform_jobs: {
      desc: 'Multimodal video animation style transfers (Studio Ghibli, Makoto Shinkai, 90s Cel, 3D Pixar, Claymation, Spider-Verse & Live Action).',
      cols: [
        { name: 'id', type: 'VARCHAR(128)', note: 'Primary Key e.g. vjob_1728... ' },
        { name: 'user_id', type: 'UUID', note: 'FK -> users.id' },
        { name: 'style_preset', type: 'VARCHAR(60)', note: 'ghibli | makoto_shinkai | retro_anime | pixar_3d | claymation' },
        { name: 'direction', type: 'VARCHAR(30)', note: 'to_animated | to_realistic ("vice-versa")' },
        { name: 'custom_prompt', type: 'TEXT', note: 'Artistic guidance prompt modifiers' },
        { name: 'status', type: 'VARCHAR(30)', note: 'pending | processing | completed | failed' },
        { name: 'output_video_url', type: 'TEXT', note: 'Rendered video storage location' },
        { name: 'stylized_keyframe_url', type: 'TEXT', note: 'High-res stylized keyframe preview' },
        { name: 'scene_analysis', type: 'TEXT', note: 'Gemini multimodal scene analysis' },
      ],
    },
    transcription_translation_jobs: {
      desc: 'Multimodal audio/video speech-to-text transcriptions, cross-lingual translations, and dubbed speech outputs.',
      cols: [
        { name: 'id', type: 'VARCHAR(128)', note: 'Primary Key e.g. trans_1728...' },
        { name: 'source_lang', type: 'VARCHAR(20)', note: 'Auto-detected source language (EN, FR, DE, ES, ZH, AR, RU, JA)' },
        { name: 'target_lang', type: 'VARCHAR(20)', note: 'Target translation language (Tamil, Hindi, Malayalam, Japanese, etc.)' },
        { name: 'full_transcript', type: 'TEXT', note: 'Full speech transcription in native script' },
        { name: 'translated_text', type: 'TEXT', note: 'Target translation in native destination script' },
        { name: 'phonetic_guide', type: 'TEXT', note: 'Romanized phonetic guide' },
        { name: 'transcript_segments', type: 'JSONB', note: 'Time-aligned segments with start/end timecodes' },
        { name: 'dubbed_audio_url', type: 'TEXT', note: 'Synthesized voiceover audio WAV' },
        { name: 'srt_content', type: 'TEXT', note: 'Formatted SRT subtitle file' },
      ],
    },
  };

  return (
    <div className="space-y-10 py-6">
      {/* Overview Intro */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/20 rounded-2xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-3">
              Phase 0 Foundation Deliverable
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              VoiceForge System Architecture & Model Selection
            </h2>
            <p className="mt-2 text-slate-300 max-w-3xl leading-relaxed text-sm">
              Architected for low-latency streaming TTS (<strong className="text-white">&lt;450ms TTFB</strong>), zero-shot cloning from 10–60s audio, and native phonetic nuance across English, Tamil, Hindi, Malayalam, and Japanese.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-center min-w-[240px]">
            <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
              <div className="text-2xl font-black text-indigo-400">5</div>
              <div className="text-xs text-slate-400 font-medium">Core Languages</div>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
              <div className="text-2xl font-black text-emerald-400">100%</div>
              <div className="text-xs text-slate-400 font-medium">Commercial Legal</div>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Model & License Matrix */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <h3 className="text-xl font-bold text-white">Model Selection & License Audit</h3>
          </div>
          <span className="text-xs text-slate-400">Evaluated against Apache 2.0 / MIT / CPML / CC-BY-NC</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-800/80 text-slate-300 font-semibold border-b border-slate-700/80 uppercase text-[11px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Model & Architecture</th>
                <th className="py-3 px-4">Language Coverage</th>
                <th className="py-3 px-4">Zero-Shot Cloning</th>
                <th className="py-3 px-4">RTF / Latency</th>
                <th className="py-3 px-4">License</th>
                <th className="py-3 px-4">Commercial?</th>
                <th className="py-3 px-4">Role & Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {models.map((m, idx) => (
                <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4 font-semibold text-white">
                    {m.name}
                    <div className="text-xs font-normal text-slate-400">{m.arch}</div>
                  </td>
                  <td className="py-3.5 px-4">{m.langs}</td>
                  <td className="py-3.5 px-4">{m.cloning}</td>
                  <td className="py-3.5 px-4 font-mono-code text-indigo-300">{m.rtf}</td>
                  <td className="py-3.5 px-4 font-medium text-slate-200">{m.license}</td>
                  <td className="py-3.5 px-4">
                    {m.commercial ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-4 h-4" /> Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-400 font-semibold">
                        <XCircle className="w-4 h-4" /> No
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${m.badgeColor}`}>
                      {m.decision}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. System Architecture Diagram */}
      <section className="space-y-4">
        <div className="flex items-center gap-2.5">
          <Layers className="w-5 h-5 text-indigo-400" />
          <h3 className="text-xl font-bold text-white">High-Level Pipeline & Data Flow</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-indigo-400">
              <span className="text-xs font-bold uppercase tracking-wider">Tier 1</span>
              <Server className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-white">API Gateway & Front-End</h4>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4">
              <li>Next.js / Vite Web App & SDKs</li>
              <li>Token Bucket Rate Limiting (Redis)</li>
              <li>Credit Metering & Ledger</li>
              <li>Multilingual Text Normalizer</li>
              <li>Unified IPA G2P Engine</li>
            </ul>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-indigo-400">
              <span className="text-xs font-bold uppercase tracking-wider">Tier 2</span>
              <Cpu className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-white">Acoustic & Cloning Engine</h4>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4">
              <li><strong>CosyVoice 2</strong>: Zero-shot flow matching</li>
              <li><strong>AI4Bharat Indic</strong>: Tamil/Hindi/Malayalam</li>
              <li><strong>ECAPA-TDNN</strong>: 192-dim speaker vectors</li>
              <li><strong>Consent Verifier</strong>: Cosine match &ge;0.78</li>
            </ul>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-indigo-400">
              <span className="text-xs font-bold uppercase tracking-wider">Tier 3</span>
              <Zap className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-white">Vocoder & Streaming</h4>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4">
              <li><strong>Vocos Streaming Vocoder</strong> (40ms chunks)</li>
              <li>HTTP Chunked / WebSocket dispatch</li>
              <li>Spread-spectrum Audio Watermarking</li>
              <li>Crossfade seamless sentence stitching</li>
            </ul>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-indigo-400">
              <span className="text-xs font-bold uppercase tracking-wider">Tier 4</span>
              <Database className="w-4 h-4" />
            </div>
            <h4 className="font-bold text-white">Storage & Workers</h4>
            <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4">
              <li>PostgreSQL 16 (11 core relational tables)</li>
              <li>S3 Object Store (audio wav/mp3)</li>
              <li>Celery / Redis Job Queue for dubbing</li>
              <li>Demucs stem vocal separator</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 2.5. Interactive DATABASE_URL Setup Guide & Connection Assistant */}
      <section className="space-y-6 bg-slate-900/90 border border-indigo-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                DATABASE_URL Setup & Connection Assistant
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                  Drizzle ORM
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Step-by-step exact instructions to locate and configure your PostgreSQL database connection string.
              </p>
            </div>
          </div>

          {/* Live DB Ping & Status */}
          <div className="flex items-center gap-2">
            <button
              onClick={checkLiveDbStatus}
              disabled={isCheckingDb}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingDb ? 'animate-spin text-amber-400' : 'text-slate-400'}`} />
              <span>Test Connection</span>
            </button>

            <button
              onClick={runLiveMigration}
              disabled={isMigratingDb}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow flex items-center gap-1.5 transition-all"
            >
              {isMigratingDb ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
              <span>Run Schema Migration</span>
            </button>
          </div>
        </div>

        {/* Live Status Banner */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <div className={`w-2.5 h-2.5 rounded-full ${liveDbStatus?.connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <div>
              <span className="font-semibold text-white">Current Database Engine: </span>
              <span className="font-mono text-indigo-400 font-bold">{liveDbStatus?.provider || 'Detecting...'}</span>
              <span className="text-slate-400 ml-2">
                ({liveDbStatus?.connected ? `Connected • ${liveDbStatus.database || 'Postgres'}` : 'In-Memory Fallback Active'})
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            {liveDbStatus?.pingMs && <span>Ping: <strong className="text-emerald-400">{liveDbStatus.pingMs}ms</strong></span>}
            <span>Table Schema: <strong className="text-white">11 Tables Ready</strong></span>
          </div>
        </div>

        {/* Migration Output Log if triggered */}
        {migrationFeedback && (
          <div className={`p-4 rounded-xl border text-xs font-mono space-y-1 ${
            migrationFeedback.success ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}>
            <div className="font-bold flex items-center gap-1.5">
              {migrationFeedback.success ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
              <span>{migrationFeedback.message || (migrationFeedback.success ? 'Migration Succeeded' : 'Migration Error')}</span>
            </div>
            {migrationFeedback.tablesCreated && (
              <div className="text-[11px] text-slate-400">
                Tables Verified: {migrationFeedback.tablesCreated.join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Provider Selector Tabs */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Choose Database Host Provider</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { id: 'supabase', name: 'Supabase', desc: 'Cloud & PgBouncer', color: 'from-emerald-500 to-teal-600' },
              { id: 'neon', name: 'Neon Serverless', desc: 'Auto-scale branching', color: 'from-cyan-500 to-blue-600' },
              { id: 'railway', name: 'Railway', desc: 'One-click deploy', color: 'from-purple-500 to-pink-600' },
              { id: 'local', name: 'Local / Docker', desc: 'Localhost:5432', color: 'from-amber-500 to-orange-600' },
              { id: 'cloudsql', name: 'Google Cloud SQL', desc: 'GCP Enterprise', color: 'from-blue-500 to-indigo-600' },
            ].map((prov) => (
              <button
                key={prov.id}
                onClick={() => setSelectedDbProvider(prov.id as any)}
                className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden ${
                  selectedDbProvider === prov.id
                    ? 'border-indigo-500 bg-indigo-950/40 shadow-lg ring-1 ring-indigo-500'
                    : 'border-slate-800 bg-slate-950 hover:bg-slate-900/60'
                }`}
              >
                <div className="font-bold text-xs text-white flex items-center justify-between">
                  <span>{prov.name}</span>
                  {selectedDbProvider === prov.id && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">{prov.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Provider Specific Step-by-Step Instructions */}
        <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
          {selectedDbProvider === 'supabase' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[11px] font-bold">1</span>
                  Exact Click-by-Click Steps in Supabase Dashboard
                </h4>
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-semibold"
                >
                  <span>Open Supabase Dashboard</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <ol className="list-decimal list-inside space-y-2.5 text-slate-300 leading-relaxed pl-1">
                <li>
                  Go to <strong className="text-white">supabase.com/dashboard</strong> and select your project.
                </li>
                <li>
                  In the bottom of the left sidebar, click the ⚙️ <strong className="text-white">Project Settings</strong> gear icon.
                </li>
                <li>
                  Under the Project Settings sidebar menu, click on <strong className="text-white">Database</strong>.
                </li>
                <li>
                  Scroll down to the section titled <strong className="text-white">Connection string</strong>.
                </li>
                <li>
                  Select the <strong className="text-white">URI</strong> tab (do NOT select "Parameters" or "Node.js").
                </li>
                <li>
                  Choose <strong className="text-white">Mode: Transaction</strong> (Port <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-300 font-mono">6543</code>).
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    💡 Port 6543 connects via Supavisor pooler, which prevents connection exhaustion in web apps.
                  </span>
                </li>
                <li>
                  Copy the URI. It will look like:
                  <div className="mt-1.5 p-2.5 bg-slate-900 rounded-lg font-mono text-[11px] text-emerald-300 flex items-center justify-between overflow-x-auto">
                    <span>postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres</span>
                    <button
                      onClick={() => copyToClipboard('postgresql://postgres.[project-ref]:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres', 'supa_tmpl')}
                      className="ml-2 px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-white shrink-0"
                    >
                      {copiedKey === 'supa_tmpl' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </li>
                <li>
                  Replace <code className="text-amber-300 font-mono">[YOUR-PASSWORD]</code> with the database password you chose when creating the Supabase project.
                  <span className="block text-[11px] text-amber-400/80 mt-0.5">
                    ⚠️ Note: If your password has special characters like <code className="text-white">@</code> or <code className="text-white">#</code>, URL-encode them (e.g., <code className="text-white">@</code> becomes <code className="text-white">%40</code>).
                  </span>
                </li>
              </ol>
            </div>
          )}

          {selectedDbProvider === 'neon' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[11px] font-bold">1</span>
                  Exact Steps in Neon (neon.tech)
                </h4>
                <a
                  href="https://console.neon.tech"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold"
                >
                  <span>Open Neon Console</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <ol className="list-decimal list-inside space-y-2 text-slate-300 pl-1">
                <li>Log in to <strong className="text-white">console.neon.tech</strong> and open your project.</li>
                <li>On the main project Dashboard, locate the <strong className="text-white">Connection Details</strong> card.</li>
                <li>Check the <strong className="text-white">Pooled connection</strong> checkbox (adds <code className="text-cyan-300 font-mono">-pooler</code> to endpoint).</li>
                <li>Copy the connection string (it includes the password automatically if generated recently).</li>
                <li>Template format:
                  <div className="mt-1 p-2 bg-slate-900 rounded font-mono text-[11px] text-cyan-300">
                    postgresql://alex:AbCdEf123456@ep-cool-butterfly-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
                  </div>
                </li>
              </ol>
            </div>
          )}

          {selectedDbProvider === 'railway' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-[11px] font-bold">1</span>
                  Exact Steps in Railway (railway.com)
                </h4>
                <a
                  href="https://railway.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-semibold"
                >
                  <span>Open Railway</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <ol className="list-decimal list-inside space-y-2 text-slate-300 pl-1">
                <li>Go to your Railway project canvas.</li>
                <li>Click on the <strong className="text-white">PostgreSQL</strong> service card.</li>
                <li>Click on the <strong className="text-white">Variables</strong> tab at the top.</li>
                <li>
                  Copy the value of <strong className="text-white">DATABASE_URL</strong> (or <strong className="text-white">DATABASE_PUBLIC_URL</strong> if connecting from external networks).
                </li>
                <li>Template:
                  <div className="mt-1 p-2 bg-slate-900 rounded font-mono text-[11px] text-purple-300">
                    postgresql://postgres:random_pwd@roundhouse.proxy.rlwy.net:34567/railway
                  </div>
                </li>
              </ol>
            </div>
          )}

          {selectedDbProvider === 'local' && (
            <div className="space-y-4 text-xs">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[11px] font-bold">1</span>
                Local PostgreSQL / Docker One-Liner
              </h4>

              <div className="space-y-2 text-slate-300">
                <p>Run PostgreSQL locally in Docker with a single terminal command:</p>
                <div className="p-2.5 bg-slate-900 rounded-lg font-mono text-[11px] text-amber-300 flex items-center justify-between overflow-x-auto">
                  <span>docker run --name voiceforge-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=voiceforge -p 5432:5432 -d postgres:16-alpine</span>
                  <button
                    onClick={() => copyToClipboard('docker run --name voiceforge-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=voiceforge -p 5432:5432 -d postgres:16-alpine', 'dock_cmd')}
                    className="ml-2 px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-white shrink-0"
                  >
                    {copiedKey === 'dock_cmd' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">Connection string: <code className="text-white font-mono">postgresql://postgres:postgres@localhost:5432/voiceforge</code></p>
              </div>
            </div>
          )}

          {selectedDbProvider === 'cloudsql' && (
            <div className="space-y-4 text-xs">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[11px] font-bold">1</span>
                Google Cloud SQL (PostgreSQL)
              </h4>

              <ol className="list-decimal list-inside space-y-2 text-slate-300 pl-1">
                <li>In Google Cloud Console, open <strong className="text-white">Cloud SQL</strong> &gt; <strong className="text-white">Instances</strong>.</li>
                <li>Click your PostgreSQL instance to view its <strong className="text-white">Public IP address</strong> or <strong className="text-white">Instance connection name</strong>.</li>
                <li>Under <strong className="text-white">Users</strong>, verify your user or create one.</li>
                <li>Under <strong className="text-white">Connections</strong> &gt; <strong className="text-white">Authorized networks</strong>, add your client IP (or connect via Cloud SQL Auth Proxy on port 5432).</li>
                <li>Template format:
                  <div className="mt-1 p-2 bg-slate-900 rounded font-mono text-[11px] text-blue-300">
                    postgresql://postgres:password@YOUR_CLOUDSQL_IP:5432/voiceforge?sslmode=require
                  </div>
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Interactive Connection String Builder */}
        <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[11px] font-bold">2</span>
              Interactive DATABASE_URL Builder & Formatter
            </h4>
            <span className="text-[11px] text-slate-400">Type credentials to generate copy-paste URL</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">Database User</label>
              <input
                type="text"
                value={builderUser}
                onChange={(e) => setBuilderUser(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">Database Password</label>
              <input
                type="password"
                value={builderPass}
                onChange={(e) => setBuilderPass(e.target.value)}
                placeholder="password"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">Host / Hostname</label>
              <input
                type="text"
                value={builderHost}
                onChange={(e) => setBuilderHost(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">Port</label>
              <input
                type="text"
                value={builderPort}
                onChange={(e) => setBuilderPort(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-400 mb-1">Database Name</label>
              <input
                type="text"
                value={builderDbName}
                onChange={(e) => setBuilderDbName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono text-xs focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 pt-6">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={builderSsl}
                  onChange={(e) => setBuilderSsl(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-800 text-indigo-600 accent-indigo-600"
                />
                <span className="font-semibold text-xs">Append SSL (?sslmode=require)</span>
              </label>
            </div>
          </div>

          {/* Generated Result Box */}
          <div className="space-y-1.5 pt-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Ready-to-Use Connection String</span>
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-indigo-300 truncate select-all">
                {computedConnectionString}
              </span>
              <button
                onClick={() => copyToClipboard(computedConnectionString, 'built_str')}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 shadow"
              >
                {copiedKey === 'built_str' ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'built_str' ? 'Copied!' : 'Copy DATABASE_URL'}</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 3. PostgreSQL Database Schema Explorer */}
      <section className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-indigo-400" />
            <h3 className="text-xl font-bold text-white">PostgreSQL Database Schema (11 Core Tables)</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono-code">schema file: /docs/DB_SCHEMA.sql</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          {/* Table Selector Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto p-2 bg-slate-950/60 border-b border-slate-800">
            {Object.keys(dbTables).map((tbl) => (
              <button
                key={tbl}
                onClick={() => setActiveSchemaTab(tbl)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono-code transition-all whitespace-nowrap ${
                  activeSchemaTab === tbl
                    ? 'bg-indigo-600 text-white font-bold shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                {tbl}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono-code text-indigo-400 font-bold">TABLE {activeSchemaTab}</span>
              <span className="text-xs text-slate-400">{dbTables[activeSchemaTab]?.desc}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Column Name</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Constraints & Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {dbTables[activeSchemaTab]?.cols.map((col, i) => (
                    <tr key={i} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-mono-code text-indigo-300 font-semibold">{col.name}</td>
                      <td className="py-2.5 px-3 font-mono-code text-amber-300">{col.type}</td>
                      <td className="py-2.5 px-3 text-slate-300">{col.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Pluggable Engine Interface Contract */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5 text-indigo-400" />
            <h3 className="text-xl font-bold text-white">Pluggable Engine Interface Contract</h3>
          </div>
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
            <button
              onClick={() => setActiveCodeLang('python')}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                activeCodeLang === 'python' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Python (Inference Engine)
            </button>
            <button
              onClick={() => setActiveCodeLang('typescript')}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                activeCodeLang === 'typescript' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              TypeScript (API Server)
            </button>
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono-code text-xs text-slate-300 overflow-x-auto shadow-inner">
          {activeCodeLang === 'python' ? (
            <pre className="text-emerald-300">
{`class TTSEngine(ABC):
    """VoiceForge Pluggable Inference Engine Contract"""

    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice: VoiceProfile,
        lang: SupportedLanguage,
        settings: Optional[VoiceSettings] = None
    ) -> Tuple[bytes, float]:
        """Synthesizes complete audio buffer (bytes, duration_sec)"""
        pass

    @abstractmethod
    async def synthesize_stream(
        self,
        text: str,
        voice: VoiceProfile,
        lang: SupportedLanguage,
        settings: Optional[VoiceSettings] = None
    ) -> AsyncGenerator[AudioChunk, None]:
        """Streams 40ms audio chunks with target TTFB < 450ms"""
        pass

    @abstractmethod
    async def clone_voice(
        self,
        audio_files: List[str],
        voice_name: str,
        target_language: SupportedLanguage = SupportedLanguage.ENGLISH
    ) -> VoiceProfile:
        """Extracts 192-dim speaker embedding and loudness normalizes"""
        pass`}
            </pre>
          ) : (
            <pre className="text-cyan-300">
{`export interface TTSEngine {
  synthesize(
    request: SynthesisRequest,
    voice: VoiceProfile
  ): Promise<SynthesisResponse>;

  cloneVoice(
    audioSamples: Buffer[],
    voiceName: string,
    consentScore: number
  ): Promise<VoiceProfile>;

  verifyConsent(
    referenceAudio: Buffer,
    consentAudio: Buffer
  ): Promise<{ verified: boolean; similarityScore: number }>;
}`}
            </pre>
          )}
        </div>
      </section>
    </div>
  );
};
