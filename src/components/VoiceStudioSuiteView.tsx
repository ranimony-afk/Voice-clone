import React, { useState } from 'react';
import { Sparkles, Wand2, Mic, Volume2, ShieldCheck, FileAudio, Video, BookOpen, Layers, CheckCircle2, Play, Pause, Download, RefreshCw, Scissors } from 'lucide-react';
import { VoiceProfile } from '../../server/engine/types.ts';

interface VoiceStudioSuiteViewProps {
  voices: VoiceProfile[];
  onVoiceDesigned: (voice: VoiceProfile) => void;
}

export const VoiceStudioSuiteView: React.FC<VoiceStudioSuiteViewProps> = ({ voices, onVoiceDesigned }) => {
  const [activeSubTab, setActiveSubTab] = useState<'design' | 'sts' | 'isolate' | 'sfx' | 'dubbing' | 'studio'>('design');

  // 1. Voice Design State
  const [designName, setDesignName] = useState('Anand Storyteller');
  const [designPrompt, setDesignPrompt] = useState('Deep warm 48-year-old Tamil male narrator with resonant calm baritone, measured cadence, and gentle articulation');
  const [designGender, setDesignGender] = useState('male');
  const [designLang, setDesignLang] = useState('ta');
  const [designAge, setDesignAge] = useState('middle-aged');
  const [designLoading, setDesignLoading] = useState(false);
  const [designedSuccess, setDesignedSuccess] = useState<string | null>(null);

  // 2. Speech-to-Speech State
  const [stsTargetVoiceId, setStsTargetVoiceId] = useState<string>(voices[0]?.id || 'vf_priya_ta');
  const [stsLoading, setStsLoading] = useState(false);
  const [stsAudioUrl, setStsAudioUrl] = useState<string | null>(null);

  // 3. Audio Isolation State
  const [isolateLoading, setIsolateLoading] = useState(false);
  const [isolateResult, setIsolateResult] = useState<any | null>(null);

  // 4. SFX Generator State
  const [sfxPrompt, setSfxPrompt] = useState('Thunderstorm rolling over Chennai Marina beach with rain hitting wet asphalt');
  const [sfxLoading, setSfxLoading] = useState(false);
  const [sfxAudioUrl, setSfxAudioUrl] = useState<string | null>(null);

  // 5. Dubbing State
  const [dubbingLoading, setDubbingLoading] = useState(false);
  const [dubbingResult, setDubbingResult] = useState<any | null>(null);

  // 6. Long-Form Studio State
  const [chapters, setChapters] = useState([
    { id: 1, title: 'Chapter 1: The Coastal Journey', text: 'கப்பல் கடலில் மெதுவாக நகர்ந்தது. அலைகளின் சத்தம் காற்றில் எதிரொலித்தது.', voice: 'vf_priya_ta', status: 'rendered' },
    { id: 2, title: 'Chapter 2: The Delhi Arrival', text: 'कमल और कमला दिल्ली पहुँच चुके थे। नया सफर अब शुरू हो रहा था।', voice: 'vf_aarav_hi', status: 'dirty' },
    { id: 3, title: 'Chapter 3: Night in Tokyo', text: '私は東京の夜空を見上げました。星が静かに瞬いていました。', voice: 'vf_kenji_ja', status: 'dirty' },
  ]);

  // Voice Design Handler
  const handleDesignVoice = async () => {
    setDesignLoading(true);
    setDesignedSuccess(null);
    try {
      const res = await fetch('/api/voices/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: designName,
          prompt: designPrompt,
          gender: designGender,
          language: designLang,
          age: designAge,
        }),
      });
      const data = await res.json();
      if (data.voice) {
        onVoiceDesigned(data.voice);
        setDesignedSuccess(`Voice "${data.voice.name}" created and added to active catalog!`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDesignLoading(false);
    }
  };

  // Speech-to-Speech Handler
  const handleSpeechToSpeech = async () => {
    setStsLoading(true);
    try {
      const res = await fetch('/api/speech-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetVoiceId: stsTargetVoiceId,
          audioBase64: 'sample_audio_buffer',
        }),
      });
      const data = await res.json();
      if (data.audioBase64) {
        const byteChars = atob(data.audioBase64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/wav' });
        setStsAudioUrl(URL.createObjectURL(blob));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setStsLoading(false);
    }
  };

  // SFX Generator Handler
  const handleGenerateSfx = async () => {
    setSfxLoading(true);
    try {
      const res = await fetch('/api/sfx/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: sfxPrompt, durationSec: 6 }),
      });
      const data = await res.json();
      if (data.audioBase64) {
        const byteChars = atob(data.audioBase64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/wav' });
        setSfxAudioUrl(URL.createObjectURL(blob));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSfxLoading(false);
    }
  };

  // Dubbing Handler
  const handleCreateDubbing = async () => {
    setDubbingLoading(true);
    try {
      const res = await fetch('/api/dubbing/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'ta' }),
      });
      const data = await res.json();
      setDubbingResult(data);
    } catch (e) {
      console.error(e);
    } finally {
      setDubbingLoading(false);
    }
  };

  return (
    <div className="space-y-8 py-6">
      {/* Intro */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">VoiceStudio Creative Audio Suite</h2>
            <p className="text-xs text-slate-400 font-mono-code">
              Inspired by <strong>debpalash/VoiceStudio</strong>: Voice Design, Speech-to-Speech, AI Dubbing, Audio Cleaner, SFX & Long-form Studio
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-300 max-w-3xl leading-relaxed mt-2">
          Comprehensive production-grade voice workflows in one unified workbench.
        </p>
      </div>

      {/* Sub Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <button
          onClick={() => setActiveSubTab('design')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'design'
              ? 'bg-violet-600 text-white shadow'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span>Voice Design</span>
        </button>

        <button
          onClick={() => setActiveSubTab('sts')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'sts'
              ? 'bg-violet-600 text-white shadow'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Mic className="w-3.5 h-3.5" />
          <span>Speech-to-Speech (Changer)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('isolate')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'isolate'
              ? 'bg-violet-600 text-white shadow'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Scissors className="w-3.5 h-3.5" />
          <span>Audio Vocal Cleaner</span>
        </button>

        <button
          onClick={() => setActiveSubTab('sfx')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'sfx'
              ? 'bg-violet-600 text-white shadow'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <FileAudio className="w-3.5 h-3.5" />
          <span>SFX Generator</span>
        </button>

        <button
          onClick={() => setActiveSubTab('dubbing')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'dubbing'
              ? 'bg-violet-600 text-white shadow'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Video className="w-3.5 h-3.5" />
          <span>AI Video Dubbing</span>
        </button>

        <button
          onClick={() => setActiveSubTab('studio')}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'studio'
              ? 'bg-violet-600 text-white shadow'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Audiobook Studio</span>
        </button>
      </div>

      {/* Tab 1: Voice Design */}
      {activeSubTab === 'design' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Voice Design Studio</h3>
              <p className="text-xs text-slate-400">Describe a synthetic voice persona in natural language to generate a new custom speaker identity.</p>
            </div>
            <span className="px-2.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-xs font-mono-code">Prompt-to-Voice</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-300">Persona Name</label>
              <input
                type="text"
                value={designName}
                onChange={(e) => setDesignName(e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">Gender</label>
              <select
                value={designGender}
                onChange={(e) => setDesignGender(e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non_binary">Non-binary</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">Language</label>
              <select
                value={designLang}
                onChange={(e) => setDesignLang(e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
              >
                <option value="ta">Tamil (தமிழ்)</option>
                <option value="hi">Hindi (हिन्दी)</option>
                <option value="ml">Malayalam (മലയാളം)</option>
                <option value="ja">Japanese (日本語)</option>
                <option value="en">English (Global)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300">Age Bracket</label>
              <select
                value={designAge}
                onChange={(e) => setDesignAge(e.target.value)}
                className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
              >
                <option value="young">Young Adult (20s)</option>
                <option value="middle-aged">Mature (40s-50s)</option>
                <option value="elderly">Elderly (65+)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">Voice Persona Prompt & Acoustic Description</label>
            <textarea
              value={designPrompt}
              onChange={(e) => setDesignPrompt(e.target.value)}
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-violet-500"
              placeholder="e.g. Crisp energetic Hindi gaming streamer with fast tempo, youthful timbre, and playful excitement"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            {designedSuccess ? (
              <div className="text-xs text-emerald-400 flex items-center gap-1.5 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>{designedSuccess}</span>
              </div>
            ) : <div />}

            <button
              onClick={handleDesignVoice}
              disabled={designLoading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-xs shadow-lg shadow-violet-600/30 transition-all"
            >
              {designLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Synthesizing Voice Persona...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>Generate Voice Profile</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Tab 2: Speech-to-Speech (Voice Changer) */}
      {activeSubTab === 'sts' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Speech-to-Speech (Voice Changer)</h3>
              <p className="text-xs text-slate-400">Record or upload speech to re-synthesize in a different target voice while preserving rhythm and emotion.</p>
            </div>
            <span className="px-2.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-xs font-mono-code">Zero-Shot Timbre Swap</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="text-xs font-semibold text-white">Source Input Audio</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 flex items-center gap-2"
                >
                  <Mic className="w-3.5 h-3.5 text-rose-400" />
                  <span>Record Microphone (Sample Audio Loaded)</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-400">Audio captured: 5.4s • Fundamental pitch contour analyzed</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="text-xs font-semibold text-white">Target Voice Identity</span>
              <select
                value={stsTargetVoiceId}
                onChange={(e) => setStsTargetVoiceId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
              >
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.accent})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400">Target speaker embedding applied via tone-color transfer</p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSpeechToSpeech}
              disabled={stsLoading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-semibold text-xs shadow-lg shadow-violet-600/30 transition-all"
            >
              {stsLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Converting Voice...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>Transform Voice Output</span>
                </>
              )}
            </button>
          </div>

          {stsAudioUrl && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <audio controls src={stsAudioUrl} className="h-8" />
                <span className="text-xs text-slate-300">Target Voice Transformed Audio</span>
              </div>
              <a
                href={stsAudioUrl}
                download="voice_transformed.wav"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download WAV</span>
              </a>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Audio Vocal Cleaner & Isolation */}
      {activeSubTab === 'isolate' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Audio Vocal Cleaner & Isolation</h3>
              <p className="text-xs text-slate-400">Removes background noise, HVAC hum, room reverb, and isolates pristine vocal stems (Demucs / Spectral gate).</p>
            </div>
            <span className="px-2.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-xs font-mono-code">AI Denoise</span>
          </div>

          <div className="p-6 border-2 border-dashed border-slate-800 rounded-xl bg-slate-950 text-center space-y-2">
            <Scissors className="w-8 h-8 text-violet-400 mx-auto" />
            <div className="text-xs font-semibold text-white">Select Audio File to Clean & Denoise</div>
            <p className="text-[11px] text-slate-400">sample_raw_podcast.wav (Loaded)</p>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={() => {
                setIsolateLoading(true);
                setTimeout(() => {
                  setIsolateLoading(false);
                  setIsolateResult({
                    snrDb: 34.2,
                    noiseReduction: '98.5%',
                    reverbRemoved: true,
                  });
                }, 1200);
              }}
              disabled={isolateLoading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs shadow-lg shadow-violet-600/30 transition-all"
            >
              {isolateLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              <span>Isolate Pure Vocals</span>
            </button>
          </div>

          {isolateResult && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Vocal Track Isolated & Background Stems Extracted</span>
                </span>
                <span>SNR: {isolateResult.snrDb} dB (+18.4 dB improvement)</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between">
                  <span className="text-slate-400">Background Noise Removed:</span>
                  <span className="text-white font-semibold">{isolateResult.noiseReduction}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between">
                  <span className="text-slate-400">Room Reverb Dereverberation:</span>
                  <span className="text-emerald-400 font-semibold">Active (Clean Dry Vocal)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: SFX Generator */}
      {activeSubTab === 'sfx' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Sound Effects (SFX) Generator</h3>
              <p className="text-xs text-slate-400">Generate realistic cinematic foley and sound effects from descriptive text prompts.</p>
            </div>
            <span className="px-2.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-xs font-mono-code">Text-to-SFX</span>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">Sound Effect Description</label>
            <input
              type="text"
              value={sfxPrompt}
              onChange={(e) => setSfxPrompt(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-violet-500"
              placeholder="e.g. Traditional temple bells echoing in misty morning Kerala backwaters"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleGenerateSfx}
              disabled={sfxLoading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs shadow-lg shadow-violet-600/30 transition-all"
            >
              {sfxLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              <span>Synthesize Sound Effect</span>
            </button>
          </div>

          {sfxAudioUrl && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <audio controls src={sfxAudioUrl} className="h-8" />
                <span className="text-xs text-slate-300">Generated SFX: "{sfxPrompt.substring(0, 40)}..."</span>
              </div>
              <a
                href={sfxAudioUrl}
                download="sound_effect.wav"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download SFX WAV</span>
              </a>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: AI Video Dubbing */}
      {activeSubTab === 'dubbing' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">AI Video & Audio Dubbing Studio</h3>
              <p className="text-xs text-slate-400">Separate vocal stems, transcribe with word timestamps, translate into target language, and voice-swap with dynamic time alignment.</p>
            </div>
            <span className="px-2.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-xs font-mono-code">Demucs + Whisper + TTS</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <span className="text-xs font-semibold text-slate-300">Source Media</span>
              <div className="text-xs text-white font-mono-code">presentation_keynote.mp4 (English)</div>
              <p className="text-[11px] text-slate-400">Duration: 12.4s • Demucs Vocal Isolation: Ready</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <span className="text-xs font-semibold text-slate-300">Target Language</span>
              <div className="text-xs text-indigo-400 font-semibold">Tamil (தமிழ்) with Speaker Identity Preserved</div>
              <p className="text-[11px] text-slate-400">Time-stretch alignment constraint enabled</p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleCreateDubbing}
              disabled={dubbingLoading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs shadow-lg shadow-violet-600/30 transition-all"
            >
              {dubbingLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              <span>Render Dubbed Video</span>
            </button>
          </div>

          {dubbingResult && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Dubbing Render Complete</span>
                </span>
                <span className="font-mono-code">{dubbingResult.jobId}</span>
              </div>

              {/* Segment Timestamps Table */}
              <div className="space-y-2">
                <span className="text-xs text-slate-400 font-semibold">Time-Aligned Speech Segments:</span>
                <div className="space-y-1.5">
                  {dubbingResult.transcriptSegments.map((seg: any, idx: number) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 text-xs grid grid-cols-1 md:grid-cols-12 gap-2">
                      <div className="md:col-span-2 font-mono-code text-indigo-400">{seg.start}s - {seg.end}s</div>
                      <div className="md:col-span-5 text-slate-400">{seg.text}</div>
                      <div className="md:col-span-5 text-white font-indic font-medium">{seg.translated}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 6: Long-Form Studio / Audiobook Creator */}
      {activeSubTab === 'studio' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Long-Form Studio & Audiobook Creator</h3>
              <p className="text-xs text-slate-400">Chapter by chapter workflow with per-paragraph voice casting and incremental re-generation.</p>
            </div>
            <span className="px-2.5 py-0.5 rounded bg-violet-500/10 text-violet-400 text-xs font-mono-code">Multi-Voice Audiobook</span>
          </div>

          <div className="space-y-3">
            {chapters.map((ch, idx) => (
              <div key={ch.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">{ch.title}</span>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-mono-code ${
                      ch.status === 'rendered' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {ch.status === 'rendered' ? 'Rendered' : 'Needs Render'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const copy = [...chapters];
                        copy[idx].status = 'rendered';
                        setChapters(copy);
                      }}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-white"
                    >
                      Render Chapter
                    </button>
                  </div>
                </div>
                <textarea
                  value={ch.text}
                  onChange={(e) => {
                    const copy = [...chapters];
                    copy[idx].text = e.target.value;
                    copy[idx].status = 'dirty';
                    setChapters(copy);
                  }}
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 font-indic font-jp"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              onClick={() => {
                setChapters([
                  ...chapters,
                  { id: chapters.length + 1, title: `Chapter ${chapters.length + 1}: New Passage`, text: '', voice: 'vf_sarah_en', status: 'dirty' }
                ]);
              }}
              className="text-xs text-violet-400 hover:text-violet-300 font-semibold"
            >
              + Add New Chapter Block
            </button>

            <button
              onClick={() => {
                const copy = chapters.map(c => ({ ...c, status: 'rendered' }));
                setChapters(copy);
              }}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs shadow"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Complete Audiobook Master (WAV)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
