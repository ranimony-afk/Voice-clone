/**
 * Paper2Audio Studio View: Academic Research Paper to Expressive Human Speech
 * Features: Natural Language Fillers, Emotional Intonation, Multi-Speaker Turn-Taking (Male, Female, Child),
 * Real-time Synchronized Waveform Player, and Native Language Nuance (EN, TA, HI, ML, JA).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Volume2,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Download,
  Users,
  Mic,
  MessageSquare,
  FileText,
  Languages,
  Check,
  RefreshCw,
  ChevronRight,
  Flame,
  Award,
  Sliders,
  Smile,
  Baby,
  User,
  Info,
  Clock,
  ExternalLink,
  Upload,
  Copy
} from 'lucide-react';
import {
  PaperMetadata,
  DialogueFormat,
  VoicePersona,
  DialogueTurn,
  PAPER_VOICE_PERSONAS,
  LANGUAGE_NATURAL_FILLERS,
  PRELOADED_PAPERS,
} from '../../server/engine/paper2audio/engine.ts';
import { VoiceProfile } from '../../server/engine/types.ts';

interface Paper2AudioViewProps {
  voices?: VoiceProfile[];
}

export const Paper2AudioView: React.FC<Paper2AudioViewProps> = () => {
  // Input state
  const [inputTab, setInputTab] = useState<'preset' | 'paste' | 'upload'>('preset');
  const [selectedPresetIndex, setSelectedPresetIndex] = useState<number>(0);
  const [customPaperText, setCustomPaperText] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  // Active Paper Data
  const [activePaper, setActivePaper] = useState<PaperMetadata>(PRELOADED_PAPERS[0]);
  const [isParsingPaper, setIsParsingPaper] = useState<boolean>(false);

  // Script & Generation Settings
  const [selectedFormat, setSelectedFormat] = useState<DialogueFormat>('podcast_duo');
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'ta' | 'hi' | 'ml' | 'ja'>('en');
  const [fillersDensity, setFillersDensity] = useState<'subtle' | 'balanced' | 'rich'>('balanced');
  const [selectedSpeakerIds, setSelectedSpeakerIds] = useState<string[]>(['marcus_en', 'elena_en']);

  // Script Generation State
  const [isGeneratingScript, setIsGeneratingScript] = useState<boolean>(false);
  const [dialogueTurns, setDialogueTurns] = useState<DialogueTurn[]>([]);
  const [srtSubtitles, setSrtSubtitles] = useState<string>('');

  // Audio Synthesis & Playback State
  const [isSynthesizingAudio, setIsSynthesizingAudio] = useState<boolean>(false);
  const [fullAudioBase64, setFullAudioBase64] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState<number>(0);
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeTurnRef = useRef<HTMLDivElement | null>(null);

  // Show Toast Helper
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Sync speakers when language changes
  useEffect(() => {
    if (selectedLanguage === 'ta') {
      setSelectedSpeakerIds(['senthil_ta', 'kavitha_ta']);
    } else if (selectedLanguage === 'hi') {
      setSelectedSpeakerIds(['vikram_hi', 'ananya_hi']);
    } else if (selectedLanguage === 'ml') {
      setSelectedSpeakerIds(['madhavan_ml', 'priya_ml']);
    } else if (selectedLanguage === 'ja') {
      setSelectedSpeakerIds(['daisuke_ja', 'aoi_ja']);
    } else {
      setSelectedSpeakerIds(['marcus_en', 'elena_en']);
    }
  }, [selectedLanguage]);

  // Handle Paper Preset Selection
  const handleSelectPreset = (idx: number) => {
    setSelectedPresetIndex(idx);
    setActivePaper(PRELOADED_PAPERS[idx]);
    showToast(`Loaded seminal paper: "${PRELOADED_PAPERS[idx].title}"`);
  };

  // Handle Custom Paper Parsing
  const handleParseCustomPaper = async () => {
    if (!customPaperText.trim()) return;
    setIsParsingPaper(true);
    try {
      const res = await fetch('/api/paper2audio/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: customPaperText }),
      });
      const data = await res.json();
      if (data && data.title) {
        setActivePaper(data);
        showToast(`Parsed paper: "${data.title}"`);
      }
    } catch (err: any) {
      console.error('Parse paper error:', err);
      showToast('Error parsing paper text');
    } finally {
      setIsParsingPaper(false);
    }
  };

  // Handle Script Generation
  const handleGenerateScript = async () => {
    setIsGeneratingScript(true);
    try {
      // Auto-include child voice if ELI5 format selected
      let finalSpeakers = [...selectedSpeakerIds];
      if (selectedFormat === 'eli5_child') {
        const childId = selectedLanguage === 'ta' ? 'maya_ta' : selectedLanguage === 'hi' ? 'aarav_hi' : selectedLanguage === 'ja' ? 'hana_ja' : 'leo_en';
        if (!finalSpeakers.includes(childId)) {
          finalSpeakers = [finalSpeakers[0] || 'marcus_en', childId];
        }
      }

      const res = await fetch('/api/paper2audio/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paper: activePaper,
          format: selectedFormat,
          language: selectedLanguage,
          speakerIds: finalSpeakers,
          fillersDensity,
        }),
      });

      const data = await res.json();
      if (data && Array.isArray(data.turns)) {
        setDialogueTurns(data.turns);
        setSrtSubtitles(data.srtContent || '');
        const maxEnd = data.turns.reduce((acc: number, t: DialogueTurn) => Math.max(acc, t.startTimeSec + t.durationSec), 0);
        setTotalDuration(maxEnd);
        showToast(`Generated conversational script with ${data.turns.length} human-sounding turns!`);
      }
    } catch (err: any) {
      console.error('Generate script error:', err);
      showToast('Failed to generate script');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Handle Audio Synthesis
  const handleSynthesizeAudio = async () => {
    if (dialogueTurns.length === 0) return;
    setIsSynthesizingAudio(true);
    try {
      const res = await fetch('/api/paper2audio/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turns: dialogueTurns,
          language: selectedLanguage,
        }),
      });

      const data = await res.json();
      if (data && data.fullAudioBase64) {
        setFullAudioBase64(data.fullAudioBase64);
        if (data.turnsWithAudio) {
          setDialogueTurns(data.turnsWithAudio);
        }
        setTotalDuration(data.totalDurationSec || totalDuration);

        // Convert base64 to Blob URL for native HTML5 audio playback
        const byteCharacters = atob(data.fullAudioBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        showToast('Synthesized complete multi-speaker conversational audio!');
      }
    } catch (err: any) {
      console.error('Synthesize audio error:', err);
      showToast('Synthesis failed');
    } finally {
      setIsSynthesizingAudio(false);
    }
  };

  // Synchronized Playback Tracker
  useEffect(() => {
    if (!audioRef.current) return;
    const el = audioRef.current;

    const handleTimeUpdate = () => {
      const t = el.currentTime;
      setCurrentPlaybackTime(t);

      // Find active turn
      const current = dialogueTurns.find(
        (turn) => t >= turn.startTimeSec && t <= turn.startTimeSec + turn.durationSec
      );
      if (current && current.id !== activeTurnId) {
        setActiveTurnId(current.id);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentPlaybackTime(0);
      setActiveTurnId(null);
    };

    el.addEventListener('timeupdate', handleTimeUpdate);
    el.addEventListener('ended', handleEnded);

    return () => {
      el.removeEventListener('timeupdate', handleTimeUpdate);
      el.removeEventListener('ended', handleEnded);
    };
  }, [dialogueTurns, activeTurnId]);

  // Play / Pause Toggle
  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  // Seek to specific turn
  const handleSeekTurn = (turn: DialogueTurn) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = turn.startTimeSec;
    setCurrentPlaybackTime(turn.startTimeSec);
    setActiveTurnId(turn.id);
    if (!isPlaying) {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  // Download Audio
  const handleDownloadAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = `paper2audio_${activePaper.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}.wav`;
    a.click();
    showToast('Downloaded paper audio WAV');
  };

  // Download SRT
  const handleDownloadSrt = () => {
    if (!srtSubtitles) return;
    const blob = new Blob([srtSubtitles], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paper2audio_subtitles.srt`;
    a.click();
    showToast('Downloaded SRT subtitle file');
  };

  // Download JSON Script
  const handleDownloadJson = () => {
    const data = {
      paper: activePaper,
      format: selectedFormat,
      language: selectedLanguage,
      speakers: selectedSpeakerIds.map(id => PAPER_VOICE_PERSONAS[id]),
      turns: dialogueTurns,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paper2audio_script.json`;
    a.click();
    showToast('Downloaded full conversational script');
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-8 py-6 font-sans">
      {/* Toast Alert */}
      {toastMsg && (
        <div className="fixed top-20 right-6 z-50 bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl flex items-center gap-2 animate-bounce border border-indigo-400/40">
          <Check className="w-4 h-4 text-emerald-300" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Hidden Audio Element */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}

      {/* 1. HERO HEADER BANNER */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 border border-indigo-500/30 p-6 sm:p-8 shadow-2xl">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Paper2Audio • Conversational Human Speech AI</span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Transform Research Papers into{' '}
              <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-pink-400 bg-clip-text text-transparent">
                Living Human Conversations
              </span>
            </h1>

            <p className="text-sm text-slate-300 leading-relaxed">
              Synthesize academic preprints and dense technical papers into dynamic podcasts and lectures.
              Features naturally used spoken fillers (<code className="text-amber-300 font-mono text-xs">"you know"</code>, <code className="text-emerald-300 font-mono text-xs">"வந்து..."</code>, <code className="text-cyan-300 font-mono text-xs">"मतलब..."</code>), emotional intonation, and multi-speaker turn-taking across Male, Female, and inquisitive Child voices.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-300 flex items-center gap-1.5 font-medium">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Male • Female • Child Voices</span>
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-300 flex items-center gap-1.5 font-medium">
                <Smile className="w-3.5 h-3.5 text-emerald-400" />
                <span>Spoken Fillers & Prosody</span>
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-300 flex items-center gap-1.5 font-medium">
                <Languages className="w-3.5 h-3.5 text-teal-400" />
                <span>EN • தமிழ் • हिन्दी • മലയാളം • 日本語</span>
              </span>
            </div>
          </div>

          <div className="shrink-0 flex flex-col gap-2 bg-slate-950/60 border border-slate-800 p-4 rounded-2xl">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Quick Actions</span>
            <button
              onClick={() => {
                if (dialogueTurns.length === 0) {
                  handleGenerateScript();
                } else if (!audioUrl) {
                  handleSynthesizeAudio();
                } else {
                  togglePlay();
                }
              }}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2 justify-center transition-all"
            >
              <Mic className="w-4 h-4" />
              <span>{dialogueTurns.length === 0 ? 'Generate Audio Script' : !audioUrl ? 'Synthesize Audio' : isPlaying ? 'Pause Audio' : 'Play Audio'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. RESEARCH PAPER INGESTION & STRUCTURAL VIEWER */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="border-b border-slate-800 bg-slate-950 px-5 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Step 1: Choose or Ingest Research Paper</span>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setInputTab('preset')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                inputTab === 'preset' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Seminal Papers (Preset)
            </button>
            <button
              onClick={() => setInputTab('paste')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                inputTab === 'paste' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Paste Text / Abstract
            </button>
            <button
              onClick={() => setInputTab('upload')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                inputTab === 'upload' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Upload PDF
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {inputTab === 'preset' && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-400">Select a breakthrough paper to test human audio synthesis:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {PRELOADED_PAPERS.map((p, idx) => (
                  <button
                    key={p.title}
                    onClick={() => handleSelectPreset(idx)}
                    className={`p-3.5 rounded-xl border text-left transition-all space-y-1.5 relative ${
                      selectedPresetIndex === idx
                        ? 'bg-indigo-950/60 border-indigo-500 shadow-lg ring-1 ring-indigo-500'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>{p.year}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300">{p.field.split('/')[0]}</span>
                    </div>
                    <div className="font-bold text-xs text-white line-clamp-2">{p.title}</div>
                    <div className="text-[11px] text-slate-400 truncate">{p.authors[0]} et al.</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {inputTab === 'paste' && (
            <div className="space-y-3">
              <textarea
                value={customPaperText}
                onChange={(e) => setCustomPaperText(e.target.value)}
                placeholder="Paste the title, abstract, methodology, or full text of any academic paper, scientific report, or article..."
                rows={5}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                onClick={handleParseCustomPaper}
                disabled={isParsingPaper || !customPaperText.trim()}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 transition-all shadow"
              >
                {isParsingPaper ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>Extract Paper Structure & Key Findings</span>
              </button>
            </div>
          )}

          {inputTab === 'upload' && (
            <div className="p-6 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/60 text-center space-y-3">
              <Upload className="w-8 h-8 text-indigo-400 mx-auto" />
              <div>
                <span className="text-xs font-bold text-white block">Upload Research Paper (PDF / TXT / MD)</span>
                <span className="text-[11px] text-slate-400">Drag and drop your file here or click to browse</span>
              </div>
              <label className="inline-block cursor-pointer px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-all border border-slate-700">
                <span>Select Document</span>
                <input
                  type="file"
                  accept=".pdf,.txt,.md,.tex"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setUploadedFileName(file.name);
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const content = ev.target?.result as string;
                        if (content) {
                          setCustomPaperText(content);
                          showToast(`Loaded ${file.name}`);
                          // Auto parse
                          fetch('/api/paper2audio/parse', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content }),
                          })
                            .then((res) => res.json())
                            .then((data) => {
                              if (data && data.title) {
                                setActivePaper(data);
                                showToast(`Extracted paper: "${data.title}"`);
                              }
                            });
                        }
                      };
                      reader.readAsText(file);
                    }
                  }}
                />
              </label>
              {uploadedFileName && <div className="text-xs text-emerald-400 font-mono">Loaded: {uploadedFileName}</div>}
            </div>
          )}

          {/* Extracted Structured Paper Card */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <div>
                <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Active Research Paper</span>
                <h3 className="text-base font-bold text-white mt-0.5">{activePaper.title}</h3>
                <span className="text-slate-400 text-[11px]">
                  {activePaper.authors.join(', ')} • {activePaper.year} • <strong className="text-slate-300">{activePaper.field}</strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
                <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5" /> Core Problem & Bottleneck
                </span>
                <p className="text-slate-300 text-[11px] leading-relaxed">{activePaper.coreProblem}</p>
              </div>

              <div className="space-y-1.5 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80">
                <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5" /> Breakthrough Findings
                </span>
                <ul className="text-slate-300 text-[11px] space-y-1 list-disc pl-4">
                  {activePaper.breakthroughFindings.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. CONVERSATIONAL NUANCE & VOICE PERSONAS CONFIGURATOR */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Sliders className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Step 2: Configure Conversational Nuance, Fillers, Emotion & Cast
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 text-xs">
          {/* Target Language */}
          <div className="space-y-2">
            <label className="font-bold text-slate-300 flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5 text-teal-400" />
              <span>Target Audio Language</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { code: 'en', name: 'English (US/UK)' },
                { code: 'ta', name: 'Tamil (தமிழ்)' },
                { code: 'hi', name: 'Hindi (हिन्दी)' },
                { code: 'ml', name: 'Malayalam (മലയാളം)' },
                { code: 'ja', name: 'Japanese (日本語)' },
              ].map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setSelectedLanguage(lang.code as any)}
                  className={`p-2 rounded-xl border text-left font-semibold transition-all ${
                    selectedLanguage === lang.code
                      ? 'bg-indigo-600 text-white border-indigo-400 shadow'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {lang.name}
                </button>
              ))}
            </div>
          </div>

          {/* Production Format */}
          <div className="space-y-2">
            <label className="font-bold text-slate-300 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>Audio Dialogue Format</span>
            </label>
            <div className="space-y-1.5">
              {[
                { id: 'podcast_duo', name: '🎙️ Academic Duo Podcast', desc: 'Host & Guest conversational banter' },
                { id: 'eli5_child', name: '👶 ELI5 / With Child Voice', desc: 'Child asking intuitive questions' },
                { id: 'lecture', name: '🎓 University Audio Lecture', desc: 'Pedagogical lead scientist talk' },
                { id: 'documentary', name: '📻 Radiolab Documentary', desc: 'Dramatic narrative with wonder' },
                { id: 'executive', name: '⚡ 5-Min Executive Briefing', desc: 'Crisp, high-signal takeaway' },
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => setSelectedFormat(fmt.id as any)}
                  className={`w-full p-2 rounded-xl border text-left transition-all ${
                    selectedFormat === fmt.id
                      ? 'bg-indigo-950/60 border-indigo-500 text-white font-bold ring-1 ring-indigo-500'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="text-xs text-white">{fmt.name}</div>
                  <div className="text-[10px] text-slate-400">{fmt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Naturally Used Fillers & Paralinguistic Density */}
          <div className="space-y-3">
            <label className="font-bold text-slate-300 flex items-center gap-1.5">
              <Smile className="w-3.5 h-3.5 text-amber-400" />
              <span>Native Language Spoken Fillers</span>
            </label>

            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {(['subtle', 'balanced', 'rich'] as const).map((density) => (
                <button
                  key={density}
                  onClick={() => setFillersDensity(density)}
                  className={`flex-1 py-1.5 rounded-lg capitalize font-semibold transition-all text-xs ${
                    fillersDensity === density ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {density}
                </button>
              ))}
            </div>

            {/* Display language fillers preview cloud */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-400">
                Auto-Injected Fillers for {selectedLanguage.toUpperCase()}:
              </span>
              <div className="flex flex-wrap gap-1">
                {(LANGUAGE_NATURAL_FILLERS[selectedLanguage] || LANGUAGE_NATURAL_FILLERS.en).map((f) => (
                  <span
                    key={f}
                    className="text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-300 font-mono"
                  >
                    "{f}"
                  </span>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <span className="font-bold text-slate-300 block">Paralinguistic Acoustic Cues:</span>
              <span>Injects natural breathing pauses <code className="text-indigo-300">[pause: 0.3s]</code>, micro-laughter <code className="text-indigo-300">[chuckle]</code>, and awe bursts <code className="text-indigo-300">[gasp]</code>.</span>
            </div>
          </div>
        </div>

        {/* Multi-Speaker Cast Selector (Male, Female, Child) */}
        <div className="space-y-3 pt-2 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span>Voice Cast Selection (Click to Toggle / Assign Speakers)</span>
            </span>
            <span className="text-[11px] text-slate-400">Male • Female • Child Voices Available</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.values(PAPER_VOICE_PERSONAS)
              .filter((p) => p.language === selectedLanguage || p.language === 'en')
              .map((persona) => {
                const isSelected = selectedSpeakerIds.includes(persona.id);
                return (
                  <button
                    key={persona.id}
                    onClick={() => {
                      if (isSelected) {
                        if (selectedSpeakerIds.length > 1) {
                          setSelectedSpeakerIds((prev) => prev.filter((id) => id !== persona.id));
                        }
                      } else {
                        setSelectedSpeakerIds((prev) => [...prev, persona.id]);
                      }
                    }}
                    className={`p-3 rounded-xl border text-left transition-all space-y-1.5 relative ${
                      isSelected
                        ? 'bg-indigo-950/60 border-indigo-500 ring-1 ring-indigo-500 shadow-lg'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{persona.avatar}</span>
                        <div>
                          <div className="font-bold text-xs text-white">{persona.name}</div>
                          <div className="text-[10px] text-slate-400">{persona.role}</div>
                        </div>
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 pt-1">
                      <span className={`px-1.5 py-0.5 rounded capitalize ${
                        persona.gender === 'child' ? 'bg-amber-500/20 text-amber-300 font-bold' : persona.gender === 'female' ? 'bg-pink-500/20 text-pink-300' : 'bg-blue-500/20 text-blue-300'
                      }`}>
                        {persona.gender} ({persona.age}y)
                      </span>
                      <span>Pitch: {persona.pitch}x</span>
                      <span>Speed: {persona.speed}x</span>
                    </div>

                    <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">{persona.description}</p>
                  </button>
                );
              })}
          </div>
        </div>

        {/* Generate Script Action Button */}
        <div className="pt-2 flex items-center justify-end">
          <button
            onClick={handleGenerateScript}
            disabled={isGeneratingScript}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-bold text-xs shadow-xl flex items-center gap-2 transition-all disabled:opacity-50"
          >
            {isGeneratingScript ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>Generate Conversational Script with Fillers & Emotion</span>
          </button>
        </div>
      </div>

      {/* 4. CONVERSATIONAL DIALOGUE SCRIPT & SYNCHRONIZED PLAYER */}
      {dialogueTurns.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl space-y-0">
          {/* Synchronized Player Bar */}
          <div className="bg-slate-950 border-b border-slate-800 p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  disabled={!audioUrl}
                  className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
                >
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                </button>

                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>{activePaper.title}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
                      {selectedLanguage.toUpperCase()} • {selectedFormat.replace('_', ' ').toUpperCase()}
                    </span>
                  </h4>
                  <div className="text-xs text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                    <span className="text-indigo-400 font-bold">{formatSeconds(currentPlaybackTime)}</span>
                    <span>/</span>
                    <span>{formatSeconds(totalDuration)}</span>
                    <span>•</span>
                    <span>{dialogueTurns.length} Speaker Turns</span>
                  </div>
                </div>
              </div>

              {/* Synthesis & Export Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {!audioUrl ? (
                  <button
                    onClick={handleSynthesizeAudio}
                    disabled={isSynthesizingAudio}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {isSynthesizingAudio ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
                    <span>Synthesize Multi-Speaker Audio</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleDownloadAudio}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Download WAV</span>
                    </button>

                    <button
                      onClick={handleDownloadSrt}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700"
                    >
                      <FileText className="w-3.5 h-3.5 text-teal-400" />
                      <span>SRT Subtitles</span>
                    </button>

                    <button
                      onClick={handleDownloadJson}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 border border-slate-700"
                    >
                      <Copy className="w-3.5 h-3.5 text-purple-400" />
                      <span>Script JSON</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Interactive Progress Scrubber */}
            <div className="space-y-1.5">
              <input
                type="range"
                min="0"
                max={Math.max(1, totalDuration)}
                step="0.1"
                value={currentPlaybackTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setCurrentPlaybackTime(val);
                  if (audioRef.current) audioRef.current.currentTime = val;
                }}
                className="w-full accent-indigo-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />

              {/* Dynamic Waveform Visualizer Simulation */}
              <div className="h-8 bg-slate-900 rounded-lg flex items-center px-2 gap-1 overflow-hidden">
                {Array.from({ length: 48 }).map((_, i) => {
                  const pct = i / 48;
                  const barTime = pct * totalDuration;
                  const isPast = currentPlaybackTime >= barTime;
                  const h = 25 + Math.sin(i * 0.4 + (isPlaying ? currentPlaybackTime * 4 : 0)) * 50;
                  return (
                    <div
                      key={i}
                      style={{ height: `${Math.max(15, h)}%` }}
                      className={`flex-1 rounded-sm transition-all duration-75 ${
                        isPast ? 'bg-gradient-to-t from-indigo-500 to-purple-400' : 'bg-slate-800'
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Dialogue Turns List */}
          <div className="p-5 sm:p-6 space-y-4 max-h-[600px] overflow-y-auto">
            <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
              <span className="font-bold uppercase tracking-wider text-slate-300">
                Interactive Conversational Turns (Click any turn to jump audio)
              </span>
              <span>Total: {dialogueTurns.length} turns</span>
            </div>

            <div className="space-y-3">
              {dialogueTurns.map((turn) => {
                const isActive = activeTurnId === turn.id;
                return (
                  <div
                    key={turn.id}
                    ref={isActive ? activeTurnRef : undefined}
                    onClick={() => handleSeekTurn(turn)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer relative ${
                      isActive
                        ? 'bg-indigo-950/70 border-indigo-500 ring-2 ring-indigo-500/80 shadow-xl'
                        : 'bg-slate-950/80 border-slate-800/80 hover:border-slate-700 hover:bg-slate-950'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 text-xs mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{turn.avatar}</span>
                        <div>
                          <span className="font-bold text-white text-xs mr-2">{turn.speakerName}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize font-mono ${
                            turn.gender === 'child' ? 'bg-amber-500/20 text-amber-300 font-bold' : turn.gender === 'female' ? 'bg-pink-500/20 text-pink-300' : 'bg-blue-500/20 text-blue-300'
                          }`}>
                            {turn.gender}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-indigo-300">
                          {turn.tone}
                        </span>
                        <span>{formatSeconds(turn.startTimeSec)} ({turn.durationSec.toFixed(1)}s)</span>
                      </div>
                    </div>

                    {/* Dialogue Text with Highlighted Paralinguistic Cues and Fillers */}
                    <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-sans">
                      {turn.text}
                    </p>

                    {/* Bottom Metadata Badges */}
                    <div className="flex flex-wrap items-center gap-2 pt-2.5 text-[10px]">
                      {turn.fillersUsed && turn.fillersUsed.length > 0 && (
                        <div className="flex items-center gap-1 text-amber-300">
                          <Smile className="w-3 h-3" />
                          <span>Fillers: {turn.fillersUsed.map(f => `"${f}"`).join(', ')}</span>
                        </div>
                      )}
                      {turn.paralinguistics && turn.paralinguistics.length > 0 && (
                        <div className="flex items-center gap-1 text-indigo-300 ml-auto">
                          <Sparkles className="w-3 h-3" />
                          <span>Prosody: {turn.paralinguistics.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
