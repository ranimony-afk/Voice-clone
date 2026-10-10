import React, { useState } from 'react';
import { Database, ShieldAlert, CheckCircle2, XCircle, Layers, Cpu, Server, Code2, ArrowRight, Zap } from 'lucide-react';

export const ArchitectureView: React.FC = () => {
  const [activeSchemaTab, setActiveSchemaTab] = useState('voices');
  const [activeCodeLang, setActiveCodeLang] = useState<'python' | 'typescript'>('python');

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
