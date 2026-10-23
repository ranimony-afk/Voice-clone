import React, { useState } from 'react';
import { Image as ImageIcon, Sparkles, Wand2, Download, Upload, RefreshCw, SlidersHorizontal, Edit3 } from 'lucide-react';

export const ImageStudioView: React.FC = () => {
  const [prompt, setPrompt] = useState('An ethereal South Asian voice artist in a high-tech illuminated soundproof studio, cinematic volumetric lighting, 8k resolution');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3' | '3:4'>('1:1');
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);

  const presets = [
    'Ultra-realistic avatar portrait of a warm Indian narrator with gentle studio rim lighting, 8k octane render',
    'Anime style Japanese voice actress speaking into a vintage gold condenser microphone in a Shinjuku studio',
    'Minimalist modern podcast album artwork with geometric sound waves and violet glow on obsidian background',
    'Sci-fi audio engineer interface displaying holographic waveform spectrograms in futuristic darkroom',
  ];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setExistingImage(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);

    try {
      const res = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          aspectRatio,
          existingImageBase64: mode === 'edit' ? existingImage : undefined,
        }),
      });

      const data = await res.json();
      if (data.imageBase64) {
        const mime = data.mimeType || 'image/png';
        setResultImage(`data:${mime};base64,${data.imageBase64}`);
      }
    } catch (err) {
      console.error('Image generation error:', err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-8 py-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <ImageIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">AI Image Studio (Create & Edit)</h2>
            <p className="text-xs text-slate-400 font-mono-code">
              Powered by <strong>gemini-nano-banana-2.1</strong> (High-Quality 1K/2K resolution image creation & editing)
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-300 max-w-3xl leading-relaxed mt-2">
          Generate voice persona avatars, podcast cover art, or edit existing photos with conversational natural language prompts.
        </p>
      </div>

      {/* Mode switcher: Create vs Edit */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode('create')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            mode === 'create'
              ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Create New Image</span>
        </button>

        <button
          onClick={() => setMode('edit')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            mode === 'edit'
              ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>Edit Existing Photo</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form: 7 cols */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          {mode === 'edit' && (
            <div className="p-4 border-2 border-dashed border-slate-800 hover:border-cyan-500/50 rounded-xl bg-slate-950 text-center space-y-2">
              <Upload className="w-6 h-6 text-cyan-400 mx-auto" />
              <div className="text-xs font-semibold text-white">Upload Base Photo to Edit</div>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-cyan-300 hover:file:bg-slate-700"
              />
              {existingImage && (
                <div className="text-xs text-emerald-400 font-semibold pt-1">
                  ✓ Photo loaded into editing buffer
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">
              {mode === 'create' ? 'Prompt Description' : 'Edit Instruction Prompt'}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 text-sm leading-relaxed"
              placeholder={
                mode === 'create'
                  ? 'Describe the image style, subject, lighting, and composition...'
                  : 'Specify what to change (e.g., "Add neon headphones and dramatic purple rim lighting")...'
              }
            />
          </div>

          {/* Aspect Ratio Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                Aspect Ratio
              </span>
              <span className="font-mono-code text-cyan-400">{aspectRatio}</span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(['1:1', '16:9', '9:16', '4:3', '3:4'] as const).map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setAspectRatio(ratio)}
                  className={`py-2 rounded-xl text-xs font-mono-code transition-all ${
                    aspectRatio === ratio
                      ? 'bg-cyan-600 text-white font-bold shadow'
                      : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Prompts Gallery */}
          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Example Ideas:</span>
            <div className="space-y-1.5">
              {presets.map((preset, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(preset)}
                  className="w-full text-left p-2 rounded-lg bg-slate-950/60 hover:bg-slate-800/60 border border-slate-800/80 text-xs text-slate-300 hover:text-cyan-300 truncate transition-colors"
                >
                  • {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-cyan-600/30 transition-all"
            >
              {generating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Generating with gemini-nano-banana-2.1...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  <span>{mode === 'create' ? 'Create Image' : 'Apply Image Edit'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Output: 5 cols */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-white uppercase tracking-wider">Generated Image Artifact</span>
              <span className="text-[11px] font-mono-code text-cyan-400">gemini-nano-banana-2.1</span>
            </div>

            {resultImage ? (
              <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-950 shadow-inner group relative">
                <img
                  src={resultImage}
                  alt={prompt}
                  className="w-full h-auto object-cover max-h-[460px] mx-auto rounded-xl"
                />
              </div>
            ) : (
              <div className="h-72 border-2 border-dashed border-slate-800 rounded-xl flex flex-col items-center justify-center text-slate-500 text-xs text-center p-4">
                <ImageIcon className="w-8 h-8 mb-2 opacity-40 text-cyan-400" />
                <span>Generated or edited image will appear here in high-resolution</span>
              </div>
            )}
          </div>

          {resultImage && (
            <div className="pt-4 flex justify-end">
              <a
                href={resultImage}
                download="voiceforge_image.png"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Image</span>
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
