import React, { useEffect, useRef, useState } from 'react';
import { Activity, AudioLines, CircleHelp, Orbit, Upload } from 'lucide-react';

type VizMode = 'waveform' | 'spectrum' | 'particles';

/** Original VoiceForge audio-reactive canvas visualizer. It renders only a user-selected local audio
 * file using Web Audio analyser data; it does not use reference-collection media or branding. */
export default function VisualStudioView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef<number>(0);
  const [mode, setMode] = useState<VizMode>('waveform');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !audio) return;
    const draw = () => {
      const { width, height } = canvas;
      ctx.fillStyle = '#080b14'; ctx.fillRect(0, 0, width, height);
      const analyser = analyserRef.current;
      if (analyser) {
        const bins = new Uint8Array(analyser.frequencyBinCount);
        if (mode === 'waveform') {
          analyser.getByteTimeDomainData(bins);
          ctx.beginPath(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#9d8bff';
          for (let i = 0; i < bins.length; i++) {
            const x = i * width / bins.length; const y = bins[i] / 255 * height;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        } else {
          analyser.getByteFrequencyData(bins);
          if (mode === 'spectrum') {
            const count = Math.min(100, bins.length); const gap = 3; const barW = width / count - gap;
            for (let i = 0; i < count; i++) {
              const h = bins[i] / 255 * height * 0.88;
              const grad = ctx.createLinearGradient(0, height - h, 0, height);
              grad.addColorStop(0, '#ff78c4'); grad.addColorStop(1, '#7868ff');
              ctx.fillStyle = grad; ctx.fillRect(i * (barW + gap), height - h, barW, h);
            }
          } else {
            const cx = width / 2, cy = height / 2, radius = Math.min(width, height) * .2;
            for (let i = 0; i < 72; i++) {
              const amp = bins[i * 2] / 255;
              const a = i * Math.PI * 2 / 72;
              const r = radius + amp * radius * 1.7;
              ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + amp * 5, 0, Math.PI * 2);
              ctx.fillStyle = `hsla(${245 + i * 1.4}, 90%, ${60 + amp * 25}%, .9)`; ctx.fill();
            }
            ctx.beginPath(); ctx.arc(cx, cy, radius * .6, 0, Math.PI * 2); ctx.strokeStyle = '#a08bff'; ctx.lineWidth = 2; ctx.stroke();
          }
        }
      } else {
        ctx.fillStyle = '#8990a7'; ctx.font = '15px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('Choose an audio file and press play to see live analysis', width / 2, height / 2);
      }
      frameRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frameRef.current);
  }, [mode]);

  const loadFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) { setError('Select an audio file.'); return; }
    setError(''); setFileName(file.name);
    if (audioRef.current) {
      audioRef.current.src = URL.createObjectURL(file);
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) { setError('Web Audio is unavailable in this browser.'); return; }
      try {
        const audioContext = new AC();
        const source = audioContext.createMediaElementSource(audioRef.current);
        const analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = .82;
        source.connect(analyser); analyser.connect(audioContext.destination);
        ctxRef.current = audioContext; analyserRef.current = analyser;
      } catch { setError('Audio analyzer could not connect. Reload the page and try another file.'); }
    }
  };

  return <section className="mx-auto max-w-6xl space-y-6 p-6 text-white">
    <header><div className="flex items-center gap-2 text-violet-300"><Orbit size={18}/> VOICEFORGE VISUAL STUDIO</div>
      <h1 className="mt-2 text-3xl font-semibold">Audio-reactive canvas</h1>
      <p className="mt-1 text-sm text-slate-400">Original real-time visualizations driven by Web Audio analysis. Audio remains in your browser.</p></header>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 font-medium"><Upload size={16}/> Choose audio
        <input aria-label="Choose audio file" className="sr-only" type="file" accept="audio/*" onChange={e => loadFile(e.target.files?.[0])}/></label>
      <span className="max-w-xs truncate text-sm text-slate-400">{fileName || 'No file selected'}</span>
      <audio ref={audioRef} controls className="h-10" onPlay={() => { void ctxRef.current?.resume(); }}/>
      <div className="ml-auto flex gap-2" role="group" aria-label="Visualization mode">
        {(['waveform','spectrum','particles'] as VizMode[]).map(v => <button key={v} onClick={() => setMode(v)} aria-pressed={mode === v} className={`rounded-lg px-3 py-2 text-sm ${mode === v ? 'bg-violet-500 text-white' : 'bg-slate-800 text-slate-300'}`}>{v}</button>)}
      </div>
    </div>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    <canvas ref={canvasRef} width={1200} height={500} className="h-[min(55vh,500px)] w-full rounded-2xl border border-slate-700 bg-[#080b14]" aria-label={`${mode} visualization`}/>
    <div className="grid gap-3 md:grid-cols-3">{[
      [<AudioLines size={18}/>, 'Waveform', 'Live time-domain amplitude from the selected source.'],
      [<Activity size={18}/>, 'Spectrum', 'Frequency-bin energy rendered as original bars.'],
      [<CircleHelp size={18}/>, 'Particles', 'Frequency-driven radial points; no imported video assets.'],
    ].map(([icon,title,desc]) => <article key={String(title)} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><div className="flex gap-2 text-violet-300">{icon}<b>{title}</b></div><p className="mt-2 text-sm text-slate-400">{desc}</p></article>)}</div>
  </section>;
}
