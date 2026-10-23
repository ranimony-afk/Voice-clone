import React, { useState, useRef } from 'react';
import { Music, Play, Pause, Download, Sparkles, Wand2, RefreshCw, Radio } from 'lucide-react';

export const MusicStudioView: React.FC = () => {
  const [prompt, setPrompt] = useState('Cinematic South Asian orchestral overture with grand strings, mridangam percussion, and emotional flute melody');
  const [modelType, setModelType] = useState<'clip' | 'pro'>('clip');
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string>('lyria-3-clip-preview');

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const presets = [
    {
      title: 'Tamil Cinema Orchestral',
      prompt: 'Grand cinematic Tamil soundtrack with soaring violins, veena flourishes, and dynamic mridangam rhythm',
      type: 'clip' as const,
    },
    {
      title: 'Tokyo Cyberpunk Synthwave',
      prompt: 'Upbeat neon retro-synthwave with driving 80s bassline, shamisen arpeggio accents, and futuristic drums',
      type: 'clip' as const,
    },
    {
      title: 'Kerala Backwaters Meditation',
      prompt: 'Gentle ambient morning raga with bamboo flute, soothing water ripples, and soft acoustic drone',
      type: 'clip' as const,
    },
    {
      title: 'Full-Length Cinematic Suite (Lyria Pro)',
      prompt: 'Full orchestral score evolving from intimate acoustic cello into a triumphant brass crescendo with choral textures',
      type: 'pro' as const,
    },
  ];

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setIsPlaying(false);

    try {
      const res = await fetch('/api/music/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          modelType,
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
        const blob = new Blob([byteArray], { type: data.mimeType || 'audio/wav' });
        const url = URL.createObjectURL(blob);

        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(url);
        setLyrics(data.lyrics || null);
        setActiveModel(data.model || 'lyria-3-clip-preview');

        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
          }
        }, 100);
      }
    } catch (err) {
      console.error('Music generation failed:', err);
    } finally {
      setGenerating(false);
    }
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

  return (
    <div className="space-y-8 py-6">
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Intro Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-pink-500/10 border border-pink-500/20 text-pink-400">
            <Music className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">AI Music Generation Studio</h2>
            <p className="text-xs text-slate-400 font-mono-code">
              Powered by <strong>lyria-3-clip-preview</strong> (clips up to 30s) & <strong>lyria-3-pro-preview</strong> (full tracks)
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-300 max-w-3xl leading-relaxed mt-2">
          Generate original background scores, cinematic audio tracks, and musical beds tailored for voiceovers, dubbing, and video projects.
        </p>
      </div>

      {/* Presets Gallery */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-pink-400" />
          <span>Curated Soundtrack Prompts</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {presets.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => {
                setPrompt(preset.prompt);
                setModelType(preset.type);
              }}
              className="p-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-pink-500/40 text-left transition-all group"
            >
              <div className="font-semibold text-sm text-white group-hover:text-pink-300 transition-colors">
                {preset.title}
              </div>
              <div className="text-xs text-slate-400 mt-1 line-clamp-2">{preset.prompt}</div>
              <div className="mt-2 text-[10px] uppercase font-mono-code px-2 py-0.5 rounded bg-slate-800 text-pink-400 inline-block">
                {preset.type === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Studio Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-white">Musical Description & Instruments Prompt</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Model Duration:</span>
              <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setModelType('clip')}
                  className={`px-3 py-1 rounded-md font-medium transition-all ${
                    modelType === 'clip' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Short Clip (30s) • Lyria Clip
                </button>
                <button
                  type="button"
                  onClick={() => setModelType('pro')}
                  className={`px-3 py-1 rounded-md font-medium transition-all ${
                    modelType === 'pro' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Full Track • Lyria Pro
                </button>
              </div>
            </div>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-pink-500 text-sm leading-relaxed"
            placeholder="Describe the genre, tempo, instruments, mood, and progression..."
          />

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-slate-500 font-mono-code">
              Model target: {modelType === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview'}
            </span>

            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-pink-600/30 transition-all"
            >
              {generating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing Track with Lyria...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  <span>Generate Music</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Audio Output Player */}
        {audioUrl && (
          <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-pink-400" />
                Rendered Audio Track (Generated with {activeModel})
              </span>
              <span className="font-mono-code text-pink-400 uppercase">Stereo Master 24kHz</span>
            </div>

            {/* Visualizer bars */}
            <div className="flex items-center gap-1.5 h-14 py-2 px-2 bg-slate-900 rounded-lg">
              {Array.from({ length: 42 }).map((_, i) => {
                const height = 20 + Math.sin(i * 0.5) * 40 + Math.cos(i * 0.9) * 30;
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-full transition-all duration-100"
                    style={{
                      height: `${Math.max(15, Math.min(100, height))}%`,
                      backgroundColor: isPlaying ? '#ec4899' : '#475569',
                    }}
                  />
                );
              })}
            </div>

            {lyrics && (
              <div className="text-xs text-slate-300 italic p-3 bg-slate-900/60 rounded-lg border border-slate-800/80">
                {lyrics}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={togglePlay}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold text-xs shadow transition-all"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>{isPlaying ? 'Pause Playback' : 'Play Soundtrack'}</span>
              </button>

              <a
                href={audioUrl}
                download="lyria_track.wav"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download WAV Track</span>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
