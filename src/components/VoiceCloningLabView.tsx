import React, { useState, useRef, useEffect } from 'react';
import {
  ShieldCheck,
  Upload,
  Mic,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Volume2,
  FileAudio,
  Flame,
  Sliders,
  Sparkle,
  ExternalLink,
  FileCode,
  Layers,
  FolderDown
} from 'lucide-react';
import { SupportedLanguage, VoiceProfile } from '../../server/engine/types.ts';
import type { AudioQualityReport } from '../../server/engine/types.ts';

function isAudioQualityReport(value: unknown): value is AudioQualityReport {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as Partial<AudioQualityReport>;
  return typeof report.isValid === 'boolean' &&
    [report.snrDb, report.durationSeconds, report.clippingRatio, report.sampleRate]
      .every((metric) => typeof metric === 'number' && Number.isFinite(metric)) &&
    Array.isArray(report.feedback) &&
    report.feedback.every((item) => typeof item === 'string');
}

interface VoiceCloningLabViewProps {
  onVoiceCreated: (newVoice: VoiceProfile) => void;
  voices?: VoiceProfile[];
  onOpenTts?: () => void;
}

export const VoiceCloningLabView: React.FC<VoiceCloningLabViewProps> = ({
  onVoiceCreated,
  voices = [],
  onOpenTts,
}) => {
  const [voiceName, setVoiceName] = useState('My Custom Voice');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [selectedGender, setSelectedGender] = useState<'female' | 'male' | 'neutral'>('female');
  const [primaryLanguage, setPrimaryLanguage] = useState<SupportedLanguage>('en');
  const [analyzingQuality, setAnalyzingQuality] = useState(false);
  const [qualityAnalysisState, setQualityAnalysisState] = useState<'idle' | 'unavailable' | 'error' | 'unverified'>('idle');
  const [qualityAnalysisMessage, setQualityAnalysisMessage] = useState<string | null>(null);

  // Cryptographic Consent & Verification State (Never simulated)
  const [challenge, setChallenge] = useState<{
    challengeId: string;
    nonce: string;
    userId: string;
    voiceName: string;
    requiredPhrase: string;
    issuedAt: number;
    expiresAt: number;
    signature: string;
  } | null>(null);
  const [fetchingChallenge, setFetchingChallenge] = useState(false);
  const [consentAudioBase64, setConsentAudioBase64] = useState<string>('');
  const [consentAudioFileName, setConsentAudioFileName] = useState<string>('');
  const [isRecordingConsent, setIsRecordingConsent] = useState(false);
  const [consentRecordingSeconds, setConsentRecordingSeconds] = useState(0);
  const [verifyingConsent, setVerifyingConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentResult, setConsentResult] = useState<{
    verified: boolean;
    similarityScore: number;
    threshold: number;
    voiceId?: string;
    auditRecord?: {
      recordId: string;
      userId: string;
      voiceId: string;
      challengeId: string;
      referenceAudioHash: string;
      consentAudioHash: string;
      similarityScore: number;
      status: string;
      verifiedAt: string;
      auditSignature: string;
    };
    message?: string;
    errorMessage?: string;
    auditHash?: string;
  } | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revocationSuccess, setRevocationSuccess] = useState<string | null>(null);

  // Cloned voice testing across languages
  const [clonedVoice, setClonedVoice] = useState<VoiceProfile | null>(null);

  // Mic recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Consent audio recording refs
  const consentMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const consentMediaStreamRef = useRef<MediaStream | null>(null);
  const consentAudioChunksRef = useRef<Blob[]>([]);
  const consentRecordTimerRef = useRef<any>(null);
  const consentFileInputRef = useRef<HTMLInputElement | null>(null);
  const sampleGenerationRef = useRef(0);
  const analysisRequestRef = useRef(0);
  const consentRecordingGenerationRef = useRef(0);

  const stopMediaStreamTracks = (stream: MediaStream | null) => {
    if (!stream) return;
    try {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* Best-effort idempotent release. */ }
      });
    } catch { /* Continue cleanup if a stream is already unavailable. */ }
  };

  const stopRecorderAndTracks = (recorder: MediaRecorder | null, stream: MediaStream | null) => {
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* Tracks are released below even if stop throws. */ }
      }
    }
    stopMediaStreamTracks(stream);
  };

  const releaseReferenceRecording = (recorder: MediaRecorder | null, stream: MediaStream | null) => {
    if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
    if (mediaStreamRef.current === stream) mediaStreamRef.current = null;
    stopRecorderAndTracks(recorder, stream);
  };

  const releaseReferenceRecorder = () =>
    releaseReferenceRecording(mediaRecorderRef.current, mediaStreamRef.current);

  const releaseConsentRecording = (recorder: MediaRecorder | null, stream: MediaStream | null) => {
    if (consentMediaRecorderRef.current === recorder) consentMediaRecorderRef.current = null;
    if (consentMediaStreamRef.current === stream) consentMediaStreamRef.current = null;
    stopRecorderAndTracks(recorder, stream);
  };

  const releaseConsentRecorder = () =>
    releaseConsentRecording(consentMediaRecorderRef.current, consentMediaStreamRef.current);

  const invalidateConsentRecording = () => {
    consentRecordingGenerationRef.current += 1;
    if (consentRecordTimerRef.current) clearInterval(consentRecordTimerRef.current);
    consentRecordTimerRef.current = null;
    releaseConsentRecorder();
    setIsRecordingConsent(false);
  };

  const invalidateQualityAnalysis = () => {
    sampleGenerationRef.current += 1;
    analysisRequestRef.current += 1;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    releaseReferenceRecorder();
    invalidateConsentRecording();
    setIsRecording(false);
    setAnalyzingQuality(false);
    setQualityAnalysisState('idle');
    setQualityAnalysisMessage(null);
    return sampleGenerationRef.current;
  };

  const failSampleRead = (sampleGeneration: number) => {
    if (sampleGeneration !== sampleGenerationRef.current) return;
    invalidateQualityAnalysis();
    setQualityAnalysisState('error');
    setQualityAnalysisMessage('The selected audio sample could not be read. No analysis result is available.');
  };

  useEffect(() => {
    return () => {
      sampleGenerationRef.current += 1;
      analysisRequestRef.current += 1;
      consentRecordingGenerationRef.current += 1;
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (consentRecordTimerRef.current) clearInterval(consentRecordTimerRef.current);
      recordTimerRef.current = null;
      consentRecordTimerRef.current = null;
      releaseReferenceRecorder();
      releaseConsentRecorder();
    };
  }, []);

  // Fetch fresh server-issued cryptographic consent challenge
  const fetchConsentChallenge = async () => {
    setFetchingChallenge(true);
    setConsentError(null);
    try {
      const res = await fetch('/api/voices/clone/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceName: voiceName.trim() || 'Custom Voice',
          userId: 'user_active',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to issue challenge');
      }
      setChallenge(data);
    } catch (err: any) {
      console.error('Challenge fetch error:', err);
      setConsentError('Consent verification is unavailable: ' + err.message);
    } finally {
      setFetchingChallenge(false);
    }
  };

  // The API contract has no measurement-provenance fields, so valid-shaped reports
  // are recorded as unverified and their metric values/pass flag are never displayed.
  const analyzeAudioBuffer = async (base64: string, sampleGeneration: number): Promise<void> => {
    const requestId = ++analysisRequestRef.current;
    const isCurrentRequest = () =>
      sampleGeneration === sampleGenerationRef.current && requestId === analysisRequestRef.current;
    if (!isCurrentRequest()) return;

    setAnalyzingQuality(true);
    setQualityAnalysisMessage(null);
    setQualityAnalysisState('idle');
    try {
      const res = await fetch('/api/voices/clone/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: base64 }),
      });
      if (!isCurrentRequest()) return;
      if (res.status === 503) {
        setQualityAnalysisState('unavailable');
        setQualityAnalysisMessage('Audio analysis is unavailable because this route is release-gated. No analysis result was produced.');
        return;
      }
      if (!res.ok) {
        setQualityAnalysisState('error');
        setQualityAnalysisMessage(`Audio analysis request failed (HTTP ${res.status}). No analysis result was accepted.`);
        return;
      }

      const responseBody: unknown = await res.json();
      if (!isCurrentRequest()) return;
      if (!isAudioQualityReport(responseBody)) {
        setQualityAnalysisState('error');
        setQualityAnalysisMessage('Audio analysis returned an invalid response. No measurements are available.');
        return;
      }

      setQualityAnalysisState('unverified');
      setQualityAnalysisMessage('A report was received, but this API contract does not identify which values were measured versus fallback values. Metrics and pass status are hidden; this response cannot authorize enrollment.');
    } catch (err) {
      if (!isCurrentRequest()) return;
      console.error('Audio quality analysis failed:', err);
      setQualityAnalysisState('error');
      setQualityAnalysisMessage('Audio analysis request failed. No analysis result was accepted.');
    } finally {
      if (isCurrentRequest()) setAnalyzingQuality(false);
    }
  };

  // Handle local reference file upload
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sampleGeneration = invalidateQualityAnalysis();
    setUploadedFileName(file.name);
    setAudioBase64(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (sampleGeneration !== sampleGenerationRef.current) return;
      if (typeof reader.result !== 'string') {
        failSampleRead(sampleGeneration);
        return;
      }
      const base64Content = reader.result.split(',')[1] || reader.result;
      setAudioBase64(base64Content);
      void analyzeAudioBuffer(base64Content, sampleGeneration);
    };
    reader.onerror = () => failSampleRead(sampleGeneration);
    reader.readAsDataURL(file);
  };

  // Handle consent file upload (alternative to mic recording)
  const handleConsentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setConsentAudioFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = reader.result as string;
      const base64Content = resultStr.split(',')[1] || resultStr;
      setConsentAudioBase64(base64Content);
      setConsentError(null);
    };
    reader.readAsDataURL(file);
  };

  // Browser Mic Recording for Reference Audio
  const startRecording = async () => {
    const sampleGeneration = invalidateQualityAnalysis();
    setAudioBase64(null);
    setUploadedFileName(null);
    audioChunksRef.current = [];
    let acquiredStream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = stream;
      if (sampleGeneration !== sampleGenerationRef.current) {
        stopMediaStreamTracks(stream);
        return;
      }

      mediaStreamRef.current = stream;
      const activeRecorder = new MediaRecorder(stream);
      recorder = activeRecorder;
      mediaRecorderRef.current = activeRecorder;

      activeRecorder.ondataavailable = (event) => {
        if (sampleGeneration === sampleGenerationRef.current && activeRecorder === mediaRecorderRef.current && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      activeRecorder.onstop = () => {
        releaseReferenceRecording(activeRecorder, stream);
        if (sampleGeneration !== sampleGenerationRef.current) return;
        setIsRecording(false);
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          if (sampleGeneration !== sampleGenerationRef.current) return;
          if (typeof reader.result !== 'string') {
            failSampleRead(sampleGeneration);
            return;
          }
          const base64 = reader.result.split(',')[1] || reader.result;
          setAudioBase64(base64);
          void analyzeAudioBuffer(base64, sampleGeneration);
        };
        reader.onerror = () => failSampleRead(sampleGeneration);
        try {
          reader.readAsDataURL(audioBlob);
          setUploadedFileName(`microphone_recording_${Date.now()}.webm`);
        } catch {
          failSampleRead(sampleGeneration);
        }
      };

      activeRecorder.onerror = () => {
        releaseReferenceRecording(activeRecorder, stream);
        if (sampleGeneration === sampleGenerationRef.current) {
          setIsRecording(false);
          if (recordTimerRef.current) clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
          setQualityAnalysisState('error');
          setQualityAnalysisMessage('Microphone recording failed; no reference sample was analyzed.');
        }
      };

      activeRecorder.start(200);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 60) {
            stopRecording();
            return 60;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      releaseReferenceRecording(recorder, acquiredStream);
      console.warn('Microphone access unavailable:', err);
      if (sampleGeneration === sampleGenerationRef.current) {
        setIsRecording(false);
        setQualityAnalysisState('error');
        setQualityAnalysisMessage('Microphone access or recording is unavailable; no reference sample was recorded.');
      }
    }
  };

  const stopRecording = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordTimerRef.current = null;
    setIsRecording(false);
    const recorder = mediaRecorderRef.current;
    const stream = mediaStreamRef.current;
    if (!recorder) {
      releaseReferenceRecording(null, stream);
      return;
    }
    if (recorder.state === 'inactive') return; // Its queued onstop callback owns finalization.
    try {
      recorder.stop();
    } catch {
      releaseReferenceRecording(recorder, stream);
    }
  };

  // Browser Mic Recording for Consent Audio
  const startConsentRecording = async () => {
    invalidateConsentRecording();
    const consentGeneration = consentRecordingGenerationRef.current;
    consentAudioChunksRef.current = [];
    let acquiredStream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = stream;
      if (consentGeneration !== consentRecordingGenerationRef.current) {
        stopMediaStreamTracks(stream);
        return;
      }

      consentMediaStreamRef.current = stream;
      const activeRecorder = new MediaRecorder(stream);
      recorder = activeRecorder;
      consentMediaRecorderRef.current = activeRecorder;

      activeRecorder.ondataavailable = (event) => {
        if (consentGeneration === consentRecordingGenerationRef.current && activeRecorder === consentMediaRecorderRef.current && event.data.size > 0) {
          consentAudioChunksRef.current.push(event.data);
        }
      };

      activeRecorder.onstop = () => {
        releaseConsentRecording(activeRecorder, stream);
        if (consentGeneration !== consentRecordingGenerationRef.current) return;
        setIsRecordingConsent(false);
        if (consentRecordTimerRef.current) clearInterval(consentRecordTimerRef.current);
        consentRecordTimerRef.current = null;
        const audioBlob = new Blob(consentAudioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          if (consentGeneration !== consentRecordingGenerationRef.current) return;
          if (typeof reader.result !== 'string') {
            setConsentError('The consent audio recording could not be read.');
            return;
          }
          const base64 = reader.result.split(',')[1] || reader.result;
          setConsentAudioBase64(base64);
          setConsentAudioFileName(`live_consent_${Date.now()}.webm`);
          setConsentError(null);
        };
        reader.onerror = () => {
          if (consentGeneration === consentRecordingGenerationRef.current) {
            setConsentError('The consent audio recording could not be read.');
          }
        };
        try {
          reader.readAsDataURL(audioBlob);
        } catch {
          if (consentGeneration === consentRecordingGenerationRef.current) {
            setConsentError('The consent audio recording could not be read.');
          }
        }
      };

      activeRecorder.onerror = () => {
        releaseConsentRecording(activeRecorder, stream);
        if (consentGeneration === consentRecordingGenerationRef.current) {
          setIsRecordingConsent(false);
          if (consentRecordTimerRef.current) clearInterval(consentRecordTimerRef.current);
          consentRecordTimerRef.current = null;
          setConsentError('Consent audio recording failed.');
        }
      };

      activeRecorder.start(200);
      setIsRecordingConsent(true);
      setConsentRecordingSeconds(0);
      consentRecordTimerRef.current = setInterval(() => {
        setConsentRecordingSeconds((prev) => {
          if (prev >= 30) {
            stopConsentRecording();
            return 30;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      releaseConsentRecording(recorder, acquiredStream);
      console.warn('Consent microphone error:', err);
      if (consentGeneration === consentRecordingGenerationRef.current) {
        setIsRecordingConsent(false);
        setConsentError('Consent microphone access or recording is unavailable.');
      }
    }
  };

  const stopConsentRecording = () => {
    if (consentRecordTimerRef.current) clearInterval(consentRecordTimerRef.current);
    consentRecordTimerRef.current = null;
    setIsRecordingConsent(false);
    const recorder = consentMediaRecorderRef.current;
    const stream = consentMediaStreamRef.current;
    if (!recorder) {
      releaseConsentRecording(null, stream);
      return;
    }
    if (recorder.state === 'inactive') return; // Its queued onstop callback owns finalization.
    try {
      recorder.stop();
    } catch {
      releaseConsentRecording(recorder, stream);
    }
  };

  // Retry acoustic analysis without treating its validity flag as consent or enrollment evidence.
  const runQualityCheck = async () => {
    if (!audioBase64) {
      alert('Please upload or record a reference vocal sample first.');
      return;
    }

    await analyzeAudioBuffer(audioBase64, sampleGenerationRef.current);
  };

  // Step 2: Strict cryptographic biometric consent verification & voice enrollment
  const handleVerifyConsentAndClone = async () => {
    if (!challenge) {
      setConsentError('Consent challenge missing or expired. Requesting fresh challenge...');
      await fetchConsentChallenge();
      return;
    }

    if (!audioBase64) {
      setConsentError('Reference voice audio sample is missing.');
      return;
    }

    if (!consentAudioBase64) {
      setConsentError('Live spoken consent audio is required. Please record or upload the spoken authorization phrase.');
      return;
    }

    setVerifyingConsent(true);
    setConsentError(null);

    try {
      const consentRes = await fetch('/api/voices/clone/verify-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge,
          voiceName: voiceName.trim() || 'Custom Voice',
          referenceAudioBase64: audioBase64,
          consentAudioBase64,
          userId: 'user_active',
          gender: selectedGender,
          primaryLanguage,
        }),
      });

      const consentData = await consentRes.json();
      if (!consentRes.ok || !consentData.verified) {
        setConsentError(
          consentData.errorMessage ||
          consentData.error ||
          'Consent verification is unavailable; no biometric assessment was performed.'
        );
        setConsentResult(consentData);
        return;
      }

      setConsentResult(consentData);
      if (consentData.voice) {
        setClonedVoice(consentData.voice);
        onVoiceCreated(consentData.voice);
      }

      setStep(3);
    } catch (err: any) {
      console.error('Consent & clone error:', err);
      setConsentError(err.message || 'Verification failed due to a network or server error.');
    } finally {
      setVerifyingConsent(false);
    }
  };

  // Step 3: Revoke consent & delete cloned profile
  const handleRevokeConsent = async () => {
    if (!clonedVoice) return;
    setIsRevoking(true);
    try {
      const res = await fetch('/api/voices/clone/revoke-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId: clonedVoice.id,
          userId: 'user_active',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRevocationSuccess(data.message);
      }
    } catch (err) {
      console.error('Revocation error:', err);
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="space-y-8 py-6">
      {/* Intro Hero */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h2 className="text-2xl font-bold text-white">Multilingual Voice Cloning Lab</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Profile preview only
              </span>
            </div>
            <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
              This workflow does not produce trained speaker weights. Any generated speaker vector is a deterministic placeholder; model export and offline-inference claims are disabled.
            </p>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-400 shrink-0">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span>Model export disabled</span>
          </div>
        </div>
      </div>

      {/* Stepper Progress */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setStep(1)}
          className={`p-4 rounded-xl border flex items-center gap-3 text-left transition-all cursor-pointer ${
            step === 1 ? 'bg-indigo-600/15 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
          }`}
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
              step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            1
          </div>
          <div>
            <div className="text-xs font-semibold">Step 1</div>
            <div className="text-sm font-bold text-white">Upload Sample & Analysis Status</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStep(2)}
          className={`p-4 rounded-xl border flex items-center gap-3 text-left transition-all cursor-pointer ${
            step === 2 ? 'bg-indigo-600/15 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
          }`}
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
              step >= 2 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            2
          </div>
          <div>
            <div className="text-xs font-semibold">Step 2</div>
            <div className="text-sm font-bold text-white">Consent verification unavailable</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            if (clonedVoice) setStep(3);
          }}
          disabled={!clonedVoice}
          className={`p-4 rounded-xl border flex items-center gap-3 text-left transition-all ${
            step === 3
              ? 'bg-emerald-600/15 border-emerald-500 text-white'
              : clonedVoice
              ? 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 cursor-pointer'
              : 'bg-slate-900/60 border-slate-800/60 text-slate-600 cursor-not-allowed'
          }`}
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
              step >= 3 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            3
          </div>
          <div>
            <div className="text-xs font-semibold">Step 3</div>
            <div className="text-sm font-bold text-white">Profile Preview</div>
          </div>
        </button>
      </div>

      {/* Main Workflow Area */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        {/* Step 1: Upload & Quality */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                <label className="text-xs font-semibold text-slate-300">Vocal Gender / Timbre</label>
                <select
                  value={selectedGender}
                  onChange={(e) => setSelectedGender(e.target.value as any)}
                  className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="female">Female Voice</option>
                  <option value="male">Male Voice</option>
                  <option value="neutral">Neutral Voice</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Primary Sample Language</label>
                <select
                  value={primaryLanguage}
                  onChange={(e) => setPrimaryLanguage(e.target.value as SupportedLanguage)}
                  className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="en">English (US/UK/IN)</option>
                  <option value="ta">Tamil (தமிழ்)</option>
                  <option value="hi">Hindi (हिन्दी)</option>
                  <option value="ml">Malayalam (മലയാളം)</option>
                  <option value="ja">Japanese (日本語)</option>
                </select>
              </div>
            </div>

            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac"
              className="hidden"
            />

            {/* Upload & Mic Box */}
            <div className="border-2 border-dashed border-slate-700/80 hover:border-indigo-500/60 rounded-2xl p-8 text-center space-y-4 bg-slate-950/40 transition-all">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto shadow-inner">
                {isRecording ? <Mic className="w-7 h-7 text-rose-500 animate-pulse" /> : <Upload className="w-7 h-7" />}
              </div>

              <div>
                <div className="text-base font-bold text-white">Upload Your Voice Sample (10–60 Seconds)</div>
                <div className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  Drag and drop or select an audio file (WAV, MP3, M4A, FLAC) or record in real-time. For highest quality, speak naturally in a quiet room.
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 font-medium flex items-center gap-2 shadow cursor-pointer"
                >
                  <FileAudio className="w-4 h-4 text-indigo-400" />
                  <span>Choose Audio File</span>
                </button>

                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`px-5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 transition-all shadow cursor-pointer ${
                    isRecording
                      ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                  <span>{isRecording ? `Stop Recording (${recordingSeconds}s)` : 'Record from Microphone'}</span>
                </button>
              </div>

              {/* Sample selection is not an analysis, consent, or identity result. */}
              <div className="pt-2 text-xs text-slate-400 text-center" role="status">
                {uploadedFileName ? (
                  <>Selected sample: <strong className="text-slate-200">{uploadedFileName}</strong>. Measurement values are not displayed because their provenance cannot be verified.</>
                ) : isRecording ? (
                  'Recording in progress; no sample analysis has completed.'
                ) : (
                  'No sample supplied; no quality analysis has run.'
                )}
              </div>
            </div>

            {analyzingQuality && (
              <div role="status" className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-300">
                Audio analysis is in progress. This does not verify identity, consent, liveness, or cloning.
              </div>
            )}
            {qualityAnalysisState === 'unavailable' && (
              <div role="status" className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
                {qualityAnalysisMessage || 'Audio analysis is unavailable; no measurements were produced.'}
              </div>
            )}
            {qualityAnalysisState === 'error' && (
              <div role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
                {qualityAnalysisMessage || 'Audio analysis failed; no measurements were accepted.'}
              </div>
            )}

            {qualityAnalysisState === 'unverified' && (
              <div role="status" className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
                {qualityAnalysisMessage || 'An analyzer response was received, but the API does not identify measured values separately from fallback values. Numeric metrics, feedback, and pass status are hidden and cannot authorize enrollment.'}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={runQualityCheck}
                disabled={analyzingQuality}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
              >
                <span>Retry analysis (metrics unverified)</span>
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Consent and identity verification unavailable */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong>Verification unavailable:</strong> Voice enrollment is release-gated. This screen does not establish speaker identity, liveness, or consent validity. Any audio or challenge text shown here is not verification evidence.
              </div>
            </div>

            {/* Live Challenge Banner */}
            {challenge ? (
              <div className="p-4 rounded-xl bg-slate-950 border border-indigo-500/40 space-y-3 shadow-inner">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                    <span className="font-semibold text-white">Unverified challenge response:</span>
                    <span className="font-mono text-indigo-400">{challenge.challengeId}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400">
                    <span>Expires: <strong className="text-amber-400">{new Date(challenge.expiresAt).toLocaleTimeString()}</strong></span>
                    <button
                      type="button"
                      onClick={fetchConsentChallenge}
                      disabled={fetchingChallenge}
                      className="text-xs text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                    >
                      {fetchingChallenge ? 'Refreshing...' : 'Refresh Challenge'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-semibold text-slate-300">Challenge text (not verification evidence):</label>
                  <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-indigo-200 font-medium text-sm leading-relaxed select-all">
                    "{challenge.requiredPhrase}"
                  </div>
                  <p className="text-[11px] text-slate-400">This text does not establish identity, liveness, or consent validity.</p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center py-6">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-400 mx-auto mb-2" />
                <span className="text-xs text-slate-400">Checking whether consent verification is available...</span>
              </div>
            )}

            {/* Consent Audio Capture */}
            <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white flex items-center gap-2">
                  <Mic className="w-4 h-4 text-rose-400" />
                  Audio input (not verified)
                </span>
                <span className="text-slate-400">
                  {consentAudioBase64 ? (
                    <span className="text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Audio captured but not validated ({consentAudioFileName})
                    </span>
                  ) : (
                    <span className="text-amber-400 font-medium">No verification is available</span>
                  )}
                </span>
              </div>

              {/* Hidden file input for consent upload */}
              <input
                type="file"
                ref={consentFileInputRef}
                onChange={handleConsentFileChange}
                accept="audio/*,.wav,.webm,.mp3"
                className="hidden"
              />

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={isRecordingConsent ? stopConsentRecording : startConsentRecording}
                  className={`px-4 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 transition-all cursor-pointer shadow ${
                    isRecordingConsent
                      ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
                      : 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40'
                  }`}
                >
                  <Mic className="w-4 h-4" />
                  <span>
                    {isRecordingConsent
                      ? `Recording audio (${consentRecordingSeconds}s) - Click to Stop`
                      : 'Record audio sample (not verified)'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => consentFileInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs text-slate-300 border border-slate-800 font-medium flex items-center gap-2 cursor-pointer shadow"
                >
                  <FileAudio className="w-4 h-4 text-slate-400" />
                  <span>Or upload audio sample (not verified)</span>
                </button>
              </div>
            </div>

            {/* Error Banner */}
            {consentError && (
              <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <div className="leading-relaxed">
                  <strong>Verification unavailable:</strong> {consentError}
                </div>
              </div>
            )}

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">Speaker identity checks unavailable</div>
                  <div className="text-[11px] text-slate-400">No speaker-match score or verified identity is available.</div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleVerifyConsentAndClone}
                disabled={verifyingConsent || !consentAudioBase64 || !challenge}
                className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
              >
                {verifyingConsent ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Requesting unavailable verification...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Verification unavailable</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                ← Back to Upload & Settings
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Non-verified Profile Preview */}
        {step === 3 && clonedVoice && (
          <div className="space-y-6 py-2">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-white flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/30">
                <Sparkles className="w-8 h-8" />
              </div>

              <h3 className="text-2xl font-bold text-white">
                Voice profile preview unavailable
              </h3>
              <p className="text-xs text-slate-300 max-w-lg mx-auto leading-relaxed">
                This non-verified preview does not establish speaker identity, liveness, or consent validity. It contains no verified trained weights and provides no offline inference.
              </p>
            </div>

            <div role="status" className="max-w-2xl mx-auto p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm space-y-3">
              <div>
                <h4 className="font-semibold">Non-verified profile preview</h4>
                <p className="mt-1 text-xs text-amber-100/80">
                  No biometric score, identity, liveness, consent status, trained model weights, or offline capability is asserted here. Model export and cross-lingual synthesis are unavailable.
                </p>
              </div>
              {revocationSuccess ? (
                <p className="text-xs text-rose-300">{revocationSuccess}</p>
              ) : consentResult?.verified === true && clonedVoice ? (
                <button
                  type="button"
                  onClick={handleRevokeConsent}
                  disabled={isRevoking}
                  className="px-3 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[11px] font-medium cursor-pointer transition-all"
                >
                  {isRevoking ? 'Requesting revocation...' : 'Request profile revocation'}
                </button>
              ) : null}
            </div>

            <div role="status" className="p-5 rounded-2xl bg-slate-950 border border-slate-800 text-sm text-slate-300">
              <h4 className="font-semibold text-white">Cross-lingual synthesis unavailable</h4>
              <p className="mt-1 text-xs text-slate-400">
                This preview cannot generate or play cloned-voice audio. No trained speaker model is available.
              </p>
            </div>

            {/* Bottom Navigation Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  invalidateQualityAnalysis();
                  setStep(1);
                  setVoiceName('Another Voice');
                  setAudioBase64(null);
                  setUploadedFileName(null);
                  setClonedVoice(null);
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 font-medium cursor-pointer"
              >
                + Clone Another Voice
              </button>

              {onOpenTts && (
                <span className="text-xs text-slate-400">TTS handoff is unavailable for this non-verified preview.</span>
              )}
            </div>
          </div>
        )}
      </div>


    </div>
  );
};
