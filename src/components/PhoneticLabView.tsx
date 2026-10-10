import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight, BookOpen, Globe2, CheckCircle2, RefreshCw } from 'lucide-react';

interface AnalysisResponse {
  originalText: string;
  normalizedText: string;
  detectedLanguage: string;
  confidence: number;
  codeSwitchSegments: Array<{
    segmentText: string;
    language: string;
    ipaPhonemes: string;
  }>;
  unifiedIpa: string;
  linguisticNotes: string[];
}

export const PhoneticLabView: React.FC = () => {
  const [inputText, setInputText] = useState('கப்பல் கடலில் சென்றது. தங்கம் விலை ₹65,400 ஆக உயர்ந்தது.');
  const [selectedLang, setSelectedLang] = useState<string>('auto');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  const presets = [
    {
      title: 'Tamil: Intervocalic Plosive Voicing & Currency',
      lang: 'ta',
      text: 'கப்பல் கடலில் சென்றது. தங்கம் விலை ₹65,400 ஆக உயர்ந்தது.',
      note: 'Tests [k] initial vs [d]/[ɣ] intervocalic softening and Tamil Rupee representation.',
    },
    {
      title: 'Hindi: Schwa Deletion & Lakh/Crore Currency',
      lang: 'hi',
      text: 'कमल और कमला ने डॉक्टर साहब को ₹5,50,000 का चेक दिया।',
      note: 'Tests terminal schwa drop in "कमल" vs preserved vowel in "कमला", plus Lakh system.',
    },
    {
      title: 'Malayalam: Chillu Letters & Samvruthokaram',
      lang: 'ml',
      text: 'അവൻ കാട്ടിൽ ഒരു പാമ്പിനെ കണ്ടു്. ₹10,000 രൂപ സമ്മാനം ലഭിച്ചു.',
      note: 'Tests chillu letters (ൻ, ൽ) and terminal samvruthokaram half-u vowel (്).',
    },
    {
      title: 'Japanese: Particle Assimilation & Yen',
      lang: 'ja',
      text: '私は東京へ行きます。価格は¥3,000です。',
      note: 'Tests particle は [wa] and へ [e] phonation, plus Yen currency normalization.',
    },
    {
      title: 'English: Homographs, Abbreviations & Currency',
      lang: 'en',
      text: 'Dr. Smith transferred $1,250,500.75 on St. Catherine Ave. at 9:30 AM.',
      note: 'Tests USD spoken expansion, abbreviation expansion (Dr., St.), and date/numbers.',
    },
    {
      title: 'Code-Switching (Tanglish: Tamil + English)',
      lang: 'auto',
      text: 'இந்த project ரொம்ப awesome-ஆ இருக்கு bro, ultra low latency speech synthesis!',
      note: 'Tests mid-sentence language detection and dynamic phonemizer switching.',
    },
    {
      title: 'Code-Switching (Hinglish: Hindi + English)',
      lang: 'auto',
      text: 'यह AI voice platform सच में game changer है, voice cloning try करो!',
      note: 'Tests Devanagari Hindi + Latin English code-switching phoneme alignment.',
    },
  ];

  const runAnalysis = async (textToAnalyze: string, langChoice: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/frontend/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToAnalyze,
          language: langChoice === 'auto' ? undefined : langChoice,
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error('Phonetic analysis error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAnalysis(inputText, selectedLang);
  }, []);

  const handlePresetSelect = (preset: typeof presets[0]) => {
    setInputText(preset.text);
    setSelectedLang(preset.lang);
    runAnalysis(preset.text, preset.lang);
  };

  const getLanguageLabel = (code: string) => {
    switch (code) {
      case 'ta': return 'Tamil (தமிழ்)';
      case 'hi': return 'Hindi (हिन्दी)';
      case 'ml': return 'Malayalam (മലയാളം)';
      case 'ja': return 'Japanese (日本語)';
      case 'en': return 'English';
      default: return code.toUpperCase();
    }
  };

  return (
    <div className="space-y-8 py-6">
      {/* Intro */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-white">Multilingual Text Front-End & G2P Lab</h2>
        </div>
        <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
          Before acoustic modeling, VoiceForge normalizes script, handles language-specific numbers and currency, runs language identification, segments code-switched phrases, and compiles standardized IPA phonemes.
        </p>
      </div>

      {/* Presets Gallery */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          <BookOpen className="w-4 h-4 text-indigo-400" />
          <span>Curated Language Challenge Benchmarks</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {presets.map((p, i) => (
            <button
              key={i}
              onClick={() => handlePresetSelect(p)}
              className="text-left p-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-indigo-500/40 transition-all group shadow-sm"
            >
              <div className="font-semibold text-sm text-white group-hover:text-indigo-300 transition-colors">
                {p.title}
              </div>
              <div className="text-xs text-slate-400 mt-1 line-clamp-1">{p.text}</div>
              <div className="text-[11px] text-indigo-400/90 mt-2 flex items-center gap-1">
                <span>{p.note}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Input Text & Controls */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-white flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-indigo-400" />
              Input Script Text
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Language:</span>
              <select
                value={selectedLang}
                onChange={(e) => {
                  setSelectedLang(e.target.value);
                  runAnalysis(inputText, e.target.value);
                }}
                className="bg-slate-950 border border-slate-800 text-xs rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="auto">Auto Detect Script</option>
                <option value="ta">Tamil (தமிழ்)</option>
                <option value="hi">Hindi (हिन्दी)</option>
                <option value="ml">Malayalam (മലയാളം)</option>
                <option value="ja">Japanese (日本語)</option>
                <option value="en">English (US/UK/IN)</option>
              </select>
            </div>
          </div>

          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-indic font-jp text-base leading-relaxed transition-all"
            placeholder="Type or paste sentences in Tamil, Hindi, Malayalam, Japanese, English, or mixed code-switching..."
          />

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-slate-500">{inputText.length} characters</span>
            <button
              onClick={() => runAnalysis(inputText, selectedLang)}
              disabled={loading || !inputText.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold shadow-lg shadow-indigo-600/30 transition-all"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Processing Rules...</span>
                </>
              ) : (
                <>
                  <span>Analyze Front-End</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right: Linguistic Output */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Linguistic Front-End Results
            </h3>
            {result && (
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-semibold">
                Detected: {getLanguageLabel(result.detectedLanguage)}
              </span>
            )}
          </div>

          {result ? (
            <div className="space-y-4 text-xs sm:text-sm">
              {/* Normalized Text */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-400">1. Normalized Text (NFC + Number/Currency Expansion):</div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-indic font-jp leading-relaxed">
                  {result.normalizedText}
                </div>
              </div>

              {/* Unified IPA Phonemes */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-400">2. Standardized IPA Phoneme Stream:</div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-emerald-400 font-mono-code leading-relaxed break-words">
                  {result.unifiedIpa || 'N/A'}
                </div>
              </div>

              {/* Code-Switching Segments */}
              {result.codeSwitchSegments && result.codeSwitchSegments.length > 1 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-400">3. Code-Switching Boundary Segmentation:</div>
                  <div className="grid grid-cols-1 gap-2 max-h-36 overflow-y-auto pr-1">
                    {result.codeSwitchSegments.map((seg, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs">
                        <span className="font-indic text-slate-200 font-medium">"{seg.segmentText}"</span>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono-code text-[11px]">
                            {seg.language.toUpperCase()}
                          </span>
                          <span className="font-mono-code text-emerald-400 text-[11px]">
                            /{seg.ipaPhonemes}/
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Applied Linguistic Rules */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-400">4. Applied Acoustic & Phonetic Rules:</div>
                <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {result.linguisticNotes.map((note, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
              Run analysis to inspect phonetic transforms
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
