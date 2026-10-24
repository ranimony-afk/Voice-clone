import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Download, Sliders, Volume2, ShieldCheck, Sparkles, Wand2, RefreshCw, Cpu, Tag, Check, Mic2 } from 'lucide-react';
import { VoiceProfile, VoiceSettings } from '../../server/engine/types.ts';

interface TTSStudioViewProps {
  voices: VoiceProfile[];
}

const INSTRUCT_PRESETS = [
  { label: 'Deep Documentary', value: 'deep, resonant, calm documentary narrator with low pitch and deliberate cadence' },
  { label: 'Energetic Upbeat', value: 'bright, upbeat, enthusiastic commercial speaker with clear high articulation' },
  { label: 'Gentle Whisper', value: 'soft, intimate, gentle whispering storyteller with warm emotional presence' },
  { label: 'Authoritative News', value: 'neutral, crisp, authoritative news broadcast anchor with clear diction' },
];

export const TTSStudioView: React.FC<TTSStudioViewProps> = ({ voices }) => {
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(voices[0]?.id || 'vf_priya_ta');
  const [text, setText] = useState<string>(
    'வணக்கம்! VoiceForge AI குரல் தளத்திற்கு வரவேற்கிறோம். [excited] அதிவேக ஸ்ட்ரீமிங் மற்றும் துல்லியமான குரல் குளோனிங்!'
  );
  const [instruct, setInstruct] = useState<string>('');
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
    latencyMs: number;
    credits: number;
    watermark: string;
    phonemes: string;
    engineUsed?: string;
    isNeural?: boolean;
  } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const selectedVoice = voices.find(v => v.id === selectedVoiceId) || voices[0];

  useEffect(() => {
    if (selectedVoice) {
      setSettings(selectedVoice.defaultSettings);
      if (selectedVoice.instruct) {
        setInstruct(selectedVoice.instruct);
      }
    }
  }, [selectedVoiceId]);

  // Connect Web Audio API Analyser for Live Waveform Rendering
  const setupAudioContext = useCallback(() => {
    if (!audioRef.current || audioContextRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;

      const source = ctx.createMediaElementSource(audioRef.current);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;
    } catch (e) {
      console.warn('Web Audio API analyser initialisation skipped:', e);
    }
  }, []);

  // Animate live canvas frequency spectrum
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;
    const render = () => {
      if (!running) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (analyserRef.current && isPlaying) {
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        const barWidth = (width / bufferLength) * 2;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height;
          const gradient = ctx.createLinearGradient(0, height, 0, 0);
          gradient.addColorStop(0, '#4f46e5');
          gradient.addColorStop(0.5, '#818cf8');
          gradient.addColorStop(1, '#a855f7');

          ctx.fillStyle = gradient;
          ctx.fillRect(x, height - barHeight, Math.max(1, barWidth - 1), barHeight);
          x += barWidth;
        }
      } else {
        // Idle ambient line
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const midY = height / 2;
        for (let x = 0; x < width; x += 4) {
          const y = midY + Math.sin(x * 0.05 + Date.now() * 0.002) * 3;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      running = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying]);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setGenerating(true);
    setIsPlaying(false);

    try {
      const res = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId: selectedVoiceId,
          language: selectedVoice.primaryLanguage,
          settings,
          instruct: instruct.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.audioBase64) {
        const byteCharacters = atob(data.audioBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(url);
        setAudioDuration(data.durationSeconds);
        setCurrentTime(0);
        setMetaInfo({
          latencyMs: data.generationTimeMs,
          credits: data.creditsCharged,
          watermark: data.watermarkSignature,
          phonemes: data.phonemes,
          engineUsed: data.engineUsed,
          isNeural: data.isNeural,
        });

        // Autoplay
        setTimeout(() => {
          setupAudioContext();
          if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
          }
          if (audioRef.current) {
            audioRef.current.currentTime = 0;
            audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
          }
        }, 100);
      }
    } catch (err) {
      console.error('Synthesis failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    setupAudioContext();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
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
        {/* Left: Text Input & OmniVoice Controls (8 cols) */}
        <div className="lg:col-span-8 space-y-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          {/* OmniVoice Natural Language Prompt Instruction */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-indigo-900/40 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mic2 className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  OmniVoice Voice Design Instruction (Optional)
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono-code">
                  instruct
                </span>
              </div>
              <span className="text-[11px] text-slate-400">Natural language timbre conditioning</span>
            </div>
            <input
              type="text"
              value={instruct}
              onChange={(e) => setInstruct(e.target.value)}
              placeholder="e.g. female, low pitch, warm tone, calm cadence, subtle British accent"
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
            {/* Quick Presets */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[11px] text-slate-500">Presets:</span>
              {INSTRUCT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setInstruct(preset.value)}
                  className={`text-[11px] px-2 py-0.5 rounded-md border transition-all ${
                    instruct === preset.value
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              {instruct && (
                <button
                  type="button"
                  onClick={() => setInstruct('')}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-slate-900 border border-red-900/40 text-red-400 hover:bg-red-950/40"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-white">Speech Script & SSML Directives</label>
            {/* Quick Emotion / Non-verbal Tags */}
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] text-slate-500 mr-1">Insert tag:</span>
              <button
                type="button"
                onClick={() => insertTag('[whispers]')}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 border border-slate-700"
              >
                [whispers]
              </button>
              <button
                type="button"
                onClick={() => insertTag('[excited]')}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-amber-300 border border-slate-700"
              >
                [excited]
              </button>
              <button
                type="button"
                onClick={() => insertTag('[laughter]')}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-emerald-300 border border-slate-700"
              >
                [laughter]
              </button>
              <button
                type="button"
                onClick={() => insertTag('[sigh]')}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-cyan-300 border border-slate-700"
              >
                [sigh]
              </button>
              <button
                type="button"
                onClick={() => insertTag('[gasp]')}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-purple-300 border border-slate-700"
              >
                [gasp]
              </button>
              <button
                type="button"
                onClick={() => insertTag('<break time="0.5s"/>')}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono-code text-indigo-300 border border-slate-700"
              >
                &lt;break/&gt;
              </button>
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-indic font-jp text-base leading-relaxed"
            placeholder="Type your script here in Tamil, Hindi, Malayalam, Japanese, or English..."
          />

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span>{charCount} characters</span>
              <span>•</span>
              <span>Est. Credits: <strong className="text-white">{estimatedCredits}</strong></span>
              <span>•</span>
              <span className="text-slate-500">Engine: <span className="text-indigo-400 font-mono-code">OmniVoice / Harmonic</span></span>
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating || !text.trim()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white font-semibold shadow-lg shadow-indigo-600/30 transition-all text-sm cursor-pointer"
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

          {/* Audio Player & Real-Time Waveform Visualizer */}
          {audioUrl && (
            <div className="mt-6 p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">Master Audio Output</span>
                  {metaInfo?.isNeural ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold">
                      ⚡ Neural OmniVoice
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-mono-code">
                      Harmonic Synthesis Engine
                    </span>
                  )}
                </div>
                <span>
                  {currentTime.toFixed(1)}s / {audioDuration.toFixed(1)}s (24 kHz PCM)
                </span>
              </div>

              {/* Real-time Web Audio Analyser Canvas */}
              <div className="h-16 w-full bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center p-2 border border-slate-800/80">
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={64}
                  className="w-full h-full block"
                />
              </div>

              {/* Player Controls */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow transition-all cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>
                  <div>
                    <div className="text-xs text-slate-200 font-medium">
                      {isPlaying ? 'Playing Audio' : 'Paused'}
                    </div>
                    {metaInfo?.engineUsed && (
                      <div className="text-[10px] text-slate-500 font-mono-code">
                        {metaInfo.engineUsed}
                      </div>
                    )}
                  </div>
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
              {metaInfo && (
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Cryptographic Watermark &amp; Provenance:</span>
                    <span className="font-mono-code text-slate-300">{metaInfo.watermark}</span>
                  </div>
                  <div className="text-slate-500 text-[10px]">
                    HMAC-SHA256 Signed
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
            <span>Acoustic Voice Controls</span>
          </div>

          <div className="space-y-4">
            {/* Stability */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Stability</span>
                <span className="font-mono-code text-indigo-400">{(settings.stability * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.stability}
                onChange={(e) => setSettings({ ...settings, stability: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <p className="text-[11px] text-slate-500">Higher = more monotonic consistency; Lower = wider emotional pitch.</p>
            </div>

            {/* Similarity */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Similarity (Timbre Closeness)</span>
                <span className="font-mono-code text-indigo-400">{(settings.similarity * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.similarity}
                onChange={(e) => setSettings({ ...settings, similarity: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <p className="text-[11px] text-slate-500">Weights the target 192-dim ECAPA speaker embedding.</p>
            </div>

            {/* Style / Expressiveness */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Style / Expressiveness</span>
                <span className="font-mono-code text-indigo-400">{(settings.style * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.style}
                onChange={(e) => setSettings({ ...settings, style: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <p className="text-[11px] text-slate-500">Amplifies dramatic pauses and micro-intonation inflection.</p>
            </div>

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

            {/* Pitch */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Pitch Offset</span>
                <span className="font-mono-code text-indigo-400">{settings.pitch > 0 ? `+${settings.pitch}` : settings.pitch} st</span>
              </div>
              <input
                type="range"
                min="-12"
                max="12"
                step="1"
                value={settings.pitch}
                onChange={(e) => setSettings({ ...settings, pitch: parseInt(e.target.value, 10) })}
                className="w-full accent-indigo-500 cursor-pointer"
              />
              <p className="text-[11px] text-slate-500">-12 to +12 semitones fundamental frequency transpose.</p>
            </div>

            {/* Speaker Boost */}
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-200">Speaker Boost</div>
                <div className="text-[11px] text-slate-500">Boosts high-frequency clarity</div>
              </div>
              <input
                type="checkbox"
                checked={settings.speakerBoost}
                onChange={(e) => setSettings({ ...settings, speakerBoost: e.target.checked })}
                className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
