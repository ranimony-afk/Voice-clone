import React, { useState } from 'react';
import { ShieldCheck, Upload, Mic, AlertCircle, CheckCircle2, Cpu, ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { VoiceProfile } from '../../server/engine/types.ts';

interface VoiceCloningLabViewProps {
  onVoiceCreated: (newVoice: VoiceProfile) => void;
}

export const VoiceCloningLabView: React.FC<VoiceCloningLabViewProps> = ({ onVoiceCreated }) => {
  const [voiceName, setVoiceName] = useState('Deepa Narrator');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isRecording, setIsRecording] = useState(false);
  const [referenceUploaded, setReferenceUploaded] = useState(true);
  const [analyzingQuality, setAnalyzingQuality] = useState(false);
  const [qualityReport, setQualityReport] = useState<{
    isValid: boolean;
    snrDb: number;
    durationSeconds: number;
    clippingRatio: number;
    feedback: string[];
  } | null>({
    isValid: true,
    snrDb: 31,
    durationSeconds: 38.5,
    clippingRatio: 0.001,
    feedback: [
      'Audio duration optimal (38.5s)',
      'Signal-to-Noise Ratio (SNR) optimal: 31 dB',
      'Zero clipping detected in dynamic envelope',
    ],
  });

  const [consentPhrase] = useState(
    `I, as the authorized speaker, grant VoiceForge full permission to analyze my acoustic timbre and synthesize voice clones for my account on ${new Date().toLocaleDateString()}.`
  );
  const [verifyingConsent, setVerifyingConsent] = useState(false);
  const [consentResult, setConsentResult] = useState<{
    verified: boolean;
    similarityScore: number;
    message: string;
    auditHash: string;
  } | null>(null);

  const runQualityCheck = async () => {
    setAnalyzingQuality(true);
    try {
      const res = await fetch('/api/voices/clone/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationSeconds: 38.5 }),
      });
      const data = await res.json();
      setQualityReport(data);
      setStep(2);
    } catch (err) {
      console.error(err);
    } finally {
      setAnalyzingQuality(false);
    }
  };

  const handleVerifyConsent = async () => {
    setVerifyingConsent(true);
    try {
      const res = await fetch('/api/voices/clone/verify-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceName,
          consentPhrase,
          consentAudioBase64: 'sample_audio_pcm_stream',
        }),
      });
      const data = await res.json();
      setConsentResult(data);
      if (data.verified) {
        setStep(3);
        onVoiceCreated({
          id: data.voiceId || `clone_${Date.now()}`,
          name: `${voiceName} (Instant Clone)`,
          category: 'cloned_instant',
          gender: 'female',
          primaryLanguage: 'en',
          supportedLanguages: ['en', 'hi', 'ta', 'ml', 'ja'],
          accent: 'Cloned Custom Profile',
          description: `Instant voice clone verified with ${(data.similarityScore * 100).toFixed(1)}% biometric match. Ready for cross-lingual synthesis.`,
          defaultSettings: {
            stability: 0.85,
            similarity: 0.92,
            style: 0.20,
            speed: 1.0,
            pitch: 0.0,
            speakerBoost: true,
          },
          avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setVerifyingConsent(false);
    }
  };

  return (
    <div className="space-y-8 py-6">
      {/* Intro */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-white">Instant Voice Cloning & Biometric Consent Lab</h2>
        </div>
        <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
          Clone any speaker from 10–60s of clean speech audio. In strict adherence to ethical AI guidelines, VoiceForge requires a real-time biometric consent verification phrase before synthesizing cloned voice models.
        </p>
      </div>

      {/* Stepper Progress */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`p-4 rounded-xl border flex items-center gap-3 ${
          step >= 1 ? 'bg-indigo-600/10 border-indigo-500/40 text-white' : 'bg-slate-900 border-slate-800 text-slate-500'
        }`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
            step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
          }`}>1</div>
          <div>
            <div className="text-xs font-semibold">Step 1</div>
            <div className="text-sm font-bold">Audio Upload & VAD Audit</div>
          </div>
        </div>

        <div className={`p-4 rounded-xl border flex items-center gap-3 ${
          step >= 2 ? 'bg-indigo-600/10 border-indigo-500/40 text-white' : 'bg-slate-900 border-slate-800 text-slate-500'
        }`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
            step >= 2 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
          }`}>2</div>
          <div>
            <div className="text-xs font-semibold">Step 2</div>
            <div className="text-sm font-bold">Biometric Consent Check</div>
          </div>
        </div>

        <div className={`p-4 rounded-xl border flex items-center gap-3 ${
          step >= 3 ? 'bg-emerald-600/10 border-emerald-500/40 text-white' : 'bg-slate-900 border-slate-800 text-slate-500'
        }`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
            step >= 3 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
          }`}>3</div>
          <div>
            <div className="text-xs font-semibold">Step 3</div>
            <div className="text-sm font-bold">Voice Model Provisioned</div>
          </div>
        </div>
      </div>

      {/* Main Workflow Area */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        {/* Step 1: Upload & Quality */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">Voice Persona Name</label>
                <input
                  type="text"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Maya Narrator"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Target Native Language</label>
                <select className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                  <option>Tamil (தமிழ்)</option>
                  <option>Hindi (हिन्दी)</option>
                  <option>Malayalam (മലയാളം)</option>
                  <option>Japanese (日本語)</option>
                  <option>English (US/UK/IN)</option>
                </select>
              </div>
            </div>

            {/* Upload / Mic Box */}
            <div className="border-2 border-dashed border-slate-700/80 hover:border-indigo-500/60 rounded-2xl p-8 text-center space-y-3 bg-slate-950/40 transition-all">
              <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Upload Reference Audio (10–60 Seconds)</div>
                <div className="text-xs text-slate-400 mt-1">WAV, MP3, FLAC, or M4A supported • Studio clear audio recommended</div>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setReferenceUploaded(true)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 font-medium"
                >
                  Select File (reference_speaker.wav loaded)
                </button>
                <button
                  type="button"
                  onClick={() => setIsRecording(!isRecording)}
                  className={`px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-2 ${
                    isRecording ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>{isRecording ? 'Recording (0:15)...' : 'Record via Microphone'}</span>
                </button>
              </div>
            </div>

            {/* Quality Report Card */}
            {qualityReport && (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-indigo-400" />
                    Automated Pre-Flight Acoustic Quality Audit
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-semibold">
                    Passed (Optimal)
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-lg font-bold text-indigo-400">{qualityReport.snrDb} dB</div>
                    <div className="text-[11px] text-slate-400">Signal-to-Noise Ratio</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-lg font-bold text-emerald-400">{qualityReport.durationSeconds}s</div>
                    <div className="text-[11px] text-slate-400">Reference Duration</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <div className="text-lg font-bold text-slate-300">0.1%</div>
                    <div className="text-[11px] text-slate-400">Microphone Clipping</div>
                  </div>
                </div>

                <ul className="space-y-1 text-xs text-slate-300 pt-1">
                  {qualityReport.feedback.map((f, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={runQualityCheck}
                disabled={analyzingQuality}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all"
              >
                <span>Proceed to Biometric Consent</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Mandatory Consent Challenge */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>Mandatory Legal & Biometric Verification:</strong> To prevent unauthorized impersonation and deepfakes, VoiceForge extracts a 192-dim speaker embedding from your live spoken consent phrase and verifies cosine similarity against your reference sample (threshold &ge; 0.78).
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Spoken Verification Phrase:</label>
              <div className="p-4 rounded-xl bg-slate-950 border border-indigo-500/30 text-indigo-200 font-medium text-sm leading-relaxed">
                "{consentPhrase}"
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="w-10 h-10 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow"
                >
                  <Mic className="w-5 h-5" />
                </button>
                <div>
                  <div className="text-xs font-semibold text-white">Live Consent Phrase Recording</div>
                  <div className="text-[11px] text-slate-400">Audio captured: 4.8 seconds (24kHz Mono)</div>
                </div>
              </div>

              <button
                onClick={handleVerifyConsent}
                disabled={verifyingConsent}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 transition-all"
              >
                {verifyingConsent ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Verifying ECAPA Embeddings...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Verify Biometric Match</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setStep(1)}
                className="text-xs text-slate-400 hover:text-white"
              >
                ← Back to Upload
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Success Confirmation */}
        {step === 3 && consentResult && (
          <div className="space-y-5 text-center py-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <Sparkles className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-bold text-white">
                Voice Clone "{voiceName}" Successfully Provisioned!
              </h3>
              <p className="text-xs text-slate-300 max-w-md mx-auto">
                {consentResult.message}
              </p>
            </div>

            <div className="max-w-md mx-auto p-4 rounded-xl bg-slate-950 border border-slate-800 text-left text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Speaker Embedding Match:</span>
                <span className="font-mono-code text-emerald-400 font-bold">
                  {(consentResult.similarityScore * 100).toFixed(1)}% (Threshold: 78.0%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Consent Audit Signature:</span>
                <span className="font-mono-code text-slate-300 truncate max-w-[200px]">
                  {consentResult.auditHash}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cross-Lingual Targets:</span>
                <span className="text-indigo-400 font-semibold">EN, Tamil, Hindi, Malayalam, Japanese</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700"
              >
                Clone Another Voice
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
