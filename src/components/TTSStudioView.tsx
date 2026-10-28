import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Download, Sliders, Volume2, ShieldCheck, Sparkles, Wand2, RefreshCw } from 'lucide-react';
import { VoiceProfile, VoiceSettings } from '../../server/engine/types.ts';

interface TTSStudioViewProps {
  voices: VoiceProfile[];
}

export const TTSStudioView: React.FC<TTSStudioViewProps> = ({ voices }) => {
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(voices[0]?.id || 'vf_priya_ta');
  const [text, setText] = useState<string>(
    'வணக்கம்! VoiceForge AI குரல் தளத்திற்கு வரவேற்கிறோம். [excited] அதிவேக ஸ்ட்ரீமிங் மற்றும் துல்லியமான குரல் குளோனிங்!'
  );
  const [settings, setSettings] = useState<VoiceSettings>({
    stability: 0.80,
    similarity: 0.88,
    style: 0.25,
    speed: 1.0,
    pitch: 0.0,
    speakerBoost: true,
  });

  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [metaInfo, setMetaInfo] = useState<{
    latencyMs: number; credits: number; watermark: string; phonemes: string; engineUsed: string; isNeural: boolean;
  } | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedVoice = voices.find(v => v.id === selectedVoiceId) || voices[0];

  useEffect(() => {
    if (selectedVoice) setSettings(selectedVoice.defaultSettings);
  }, [selectedVoiceId]);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setGenerating(true); setIsPlaying(false); setGenerationError(null);
    try {
      const res = await fetch('/api/tts/synthesize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId: selectedVoiceId, language: selectedVoice.primaryLanguage, settings }),
      });
      const data = await res.json();
      if (!res.ok || !data.audioBase64) throw new Error(data.error?.message || data.error || `Synthesis failed (${res.status})`);
      const byteCharacters = atob(data.audioBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(url); setAudioDuration(data.durationSeconds); setCurrentTime(0);
      setMetaInfo({ latencyMs: data.generationTimeMs, credits: data.creditsCharged, watermark: data.watermarkSignature, phonemes: data.phonemes, engineUsed: data.engineUsed || 'unknown', isNeural: Boolean(data.isNeural) });
      setTimeout(() => { if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {}); } }, 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Synthesis failed';
      setGenerationError(message); console.error('Synthesis failed:', err);
    } finally { setGenerating(false); }
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const insertTag = (tag: string) => {
    setText(prev => prev + ` ${tag} `);
  };

  const charCount = text.length;
  const estimatedCredits = Math.max(1, Math.ceil(charCount * 1.0));

  return (
    <div className="space-y-8 py-6">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Voice Selection Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-indigo-400" />
            Select Voice Persona ({voices.length} Available)
          </label>
          <span className="text-xs text-slate-400">Cross-lingual synthesis enabled</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {voices.map((voice) => {
            const isSelected = voice.id === selectedVoiceId;
            return (
              <button
                key={voice.id}
                onClick={() => setSelectedVoiceId(voice.id)}
                className={`p-3.5 rounded-xl border text-left transition-all relative overflow-hidden flex flex-col justify-between ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500 shadow-md shadow-indigo-500/20 ring-1 ring-indigo-500/50'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2.5 mb-2">
                    <img
                      src={voice.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'}
                      alt={voice.name}
                      className="w-9 h-9 rounded-full object-cover border border-slate-700 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-white truncate">{voice.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">{voice.accent}</div>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                    {voice.description}
                  </p>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono-code uppercase">
                    {voice.primaryLanguage}
                  </span>
                  <span className={`capitalize font-semibold ${
                    voice.category.includes('clone')
                      ? 'text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20'
                      : 'text-indigo-400'
                  }`}>
                    {voice.category.includes('clone') ? '⭐ Cloned Voice' : voice.category.replace('_', ' ')}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Text Input & Tags (8 cols) */}
        <div className="lg:col-span-8 space-y-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-white">Speech Script & SSML Directives</label>
            {/* Quick Emotion / Pause Tags */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-500 mr-1">Insert tag:</span>
              <button
                type="button"
                onClick={() => insertTag('[whispers]')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700"
              >
                [whispers]
              </button>
              <button
                type="button"
                onClick={() => insertTag('[excited]')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-amber-300 border border-slate-700"
              >
                [excited]
              </button>
              <button
                type="button"
                onClick={() => insertTag('[sad]')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-blue-300 border border-slate-700"
              >
                [sad]
              </button>
              <button
                type="button"
                onClick={() => insertTag('<break time="0.5s"/>')}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono-code text-indigo-300 border border-slate-700"
              >
                &lt;break/&gt;
              </button>
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-indic font-jp text-base leading-relaxed"
            placeholder="Type your script here in Tamil, Hindi, Malayalam, Japanese, or English..."
          />

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span>{charCount} characters</span>
              <span>•</span>
              <span>Est. Credits: <strong className="text-white">{estimatedCredits}</strong></span>
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating || !text.trim()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white font-semibold shadow-lg shadow-indigo-600/30 transition-all text-sm"
            >
              {generating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  <span>Generate Speech</span>
                </>
              )}
            </button>
          </div>

          {/* Audio Player & Waveform Visualizer */}
          {audioUrl && (
            <div className="mt-6 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-white">Rendered Master Audio (24 kHz / 16-bit PCM)</span>
                <span>
                  {currentTime.toFixed(1)}s / {audioDuration.toFixed(1)}s
                </span>
              </div>

              {/* Fake Interactive Waveform Bars */}
              <div className="flex items-center gap-1 h-12 py-2 px-1 bg-slate-900 rounded-lg">
                {Array.from({ length: 48 }).map((_, i) => {
                  const progress = audioDuration > 0 ? currentTime / audioDuration : 0;
                  const barProgress = i / 48;
                  const isActive = barProgress <= progress;
                  const heightPercent = 25 + Math.sin(i * 0.4) * 45 + Math.cos(i * 0.8) * 20;

                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-full transition-all duration-75"
                      style={{
                        height: `${Math.max(15, Math.min(100, heightPercent))}%`,
                        backgroundColor: isActive ? '#6366f1' : '#334155',
                      }}
                    />
                  );
                })}
              </div>

              {/* Player Controls */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow transition-all"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>
                  <span className="text-xs text-slate-300 font-medium">
                    {isPlaying ? 'Playing Audio' : 'Paused'}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {metaInfo && (
                    <div className="text-right text-[11px] text-slate-400">
                      <div>Latency: <strong className="text-indigo-400">{metaInfo.latencyMs}ms</strong></div>
                      <div>Credits: <strong className="text-emerald-400">{metaInfo.credits}</strong></div>
                    </div>
                  )}

                  <a
                    href={audioUrl}
                    download="voiceforge_master.wav"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download WAV</span>
                  </a>
                </div>
              </div>

              {/* Watermark Provenance */}
              {generationError && <div role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">Synthesis unavailable: {generationError}</div>}
              {metaInfo && (
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <div className="flex flex-col gap-1">
                    <div className={`flex items-center gap-1.5 ${metaInfo.isNeural ? 'text-emerald-400' : 'text-amber-300'}`}>
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>{metaInfo.isNeural ? 'Neural inference' : 'DEVELOPMENT-ONLY simulated audio'}: {metaInfo.engineUsed}</span>
                    </div>
                    <div className="text-slate-500">Signed provenance metadata (not an in-audio watermark): <span className="font-mono-code text-slate-300">{metaInfo.watermark}</span></div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Controls & Sliders (4 cols) */}
        <div className="lg:col-span-4 space-y-6 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-2 text-sm font-bold text-white uppercase tracking-wider">
            <Sliders className="w-4 h-4 text-indigo-400" />
            <span>OmniVoice Controls</span>
          </div>

          <div className="space-y-4">
            <p className="text-xs text-slate-400">Only documented OmniVoice parameters are exposed. Stability, similarity, pitch-shift, and speaker-boost controls are not claimed because this engine does not implement them.</p>
            {/* Speed */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Speed Multiplier</span>
                <span className="font-mono-code text-indigo-400">{settings.speed.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={settings.speed}
                onChange={(e) => setSettings({ ...settings, speed: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 cursor-pointer"
              />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};
