import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  ArrowRight,
  BookOpen,
  Globe2,
  CheckCircle2,
  RefreshCw,
  Sliders,
  Save,
  Trash2,
  Plus,
  Play,
  Volume2,
  Download,
  Upload,
  Check,
  Edit3,
  Bookmark,
  Layers,
  Search,
  FileCode,
  Tag
} from 'lucide-react';
import { DictionaryEntry, SupportedLanguage, WordPhonemeItem } from '../../server/engine/types.ts';

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
  wordBreakdown?: WordPhonemeItem[];
  linguisticNotes: string[];
}

const IPA_CHIPS = [
  'ə', 'æ', 'ʃ', 't͡ʃ', 'd͡ʒ', 'ŋ', 'ɳ', 'ʈ', 'ɖ', 'ɾ',
  'ː', 'ˈ', 'aː', 'iː', 'uː', 'eː', 'oː', 'ʌ', 'θ', 'ð', 'kʂ'
];

export const PhoneticLabView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'workbench' | 'dictionary'>('workbench');
  const [inputText, setInputText] = useState('கப்பல் கடலில் சென்றது. தங்கம் விலை ₹65,400 ஆக உயர்ந்தது.');
  const [selectedLang, setSelectedLang] = useState<string>('auto');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<AnalysisResponse | null>(null);

  // Dictionary State
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([]);
  const [dictSearch, setDictSearch] = useState<string>('');
  const [filterLang, setFilterLang] = useState<string>('all');

  // Manual Adjuster State
  const [editWord, setEditWord] = useState<string>('');
  const [editIpa, setEditIpa] = useState<string>('');
  const [editLang, setEditLang] = useState<SupportedLanguage | 'all'>('ta');
  const [editAlias, setEditAlias] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [savingOverride, setSavingOverride] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Audio preview for word
  const [previewingAudio, setPreviewingAudio] = useState<boolean>(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

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

  // Fetch dictionary
  const fetchDictionary = async () => {
    try {
      const res = await fetch('/api/dictionary');
      const data = await res.json();
      if (data.dictionary) {
        setDictionary(data.dictionary);
      }
    } catch (err) {
      console.warn('Failed to load dictionary:', err);
    }
  };

  useEffect(() => {
    fetchDictionary();
    runAnalysis(inputText, selectedLang);
  }, []);

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

  const handlePresetSelect = (preset: typeof presets[0]) => {
    setInputText(preset.text);
    setSelectedLang(preset.lang);
    runAnalysis(preset.text, preset.lang);
  };

  // Select a word from the analysis output to adjust in the editor
  const handleSelectWordForAdjustment = (item: WordPhonemeItem) => {
    const cleanWord = item.word.replace(/[.,!?;:()[\]"']/g, '');
    setEditWord(cleanWord);
    setEditIpa(item.ipa);
    setEditLang(item.language);
    const existing = dictionary.find(
      (d) => d.word.toLowerCase() === cleanWord.toLowerCase()
    );
    if (existing) {
      setEditAlias(existing.alias || '');
      setEditNotes(existing.notes || '');
    } else {
      setEditAlias('');
      setEditNotes(`Custom phonetic adjustment for "${cleanWord}"`);
    }
    setSaveSuccessMsg(null);
  };

  // Save word override to personal dictionary
  const handleSaveOverride = async () => {
    if (!editWord.trim() || !editIpa.trim()) return;

    setSavingOverride(true);
    try {
      const res = await fetch('/api/dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: editWord,
          language: editLang,
          ipa: editIpa,
          alias: editAlias,
          notes: editNotes,
        }),
      });
      const data = await res.json();
      if (data.dictionary) {
        setDictionary(data.dictionary);
        setSaveSuccessMsg(`Override for "${editWord}" saved! Re-analyzing sentence...`);
        // Re-analyze text with newly applied dictionary override
        runAnalysis(inputText, selectedLang);
        setTimeout(() => setSaveSuccessMsg(null), 3000);
      }
    } catch (err) {
      console.error('Failed to save override:', err);
    } finally {
      setSavingOverride(false);
    }
  };

  // Delete dictionary entry
  const handleDeleteEntry = async (id: string) => {
    try {
      const res = await fetch(`/api/dictionary/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.dictionary) {
        setDictionary(data.dictionary);
        runAnalysis(inputText, selectedLang);
      }
    } catch (err) {
      console.error('Failed to delete entry:', err);
    }
  };

  // Quick insert IPA symbol into editor
  const handleInsertIpaSymbol = (sym: string) => {
    setEditIpa((prev) => prev + sym);
  };

  // Test word pronunciation using TTS
  const handlePreviewPronunciation = async () => {
    if (!editWord) return;
    setPreviewingAudio(true);
    try {
      const targetLang = editLang === 'all' ? 'en' : editLang;
      const res = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: editWord,
          voiceId: 'vf_priya_ta',
          language: targetLang,
        }),
      });
      const data = await res.json();
      if (data.audioBase64) {
        if (audioPlayerRef.current) audioPlayerRef.current.pause();
        const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
        audioPlayerRef.current = audio;
        audio.play();
      }
    } catch (err) {
      console.error('Preview error:', err);
    } finally {
      setPreviewingAudio(false);
    }
  };

  // Export dictionary as JSON or PLS XML
  const handleExportDictionary = (format: 'json' | 'pls') => {
    let content = '';
    let mimeType = 'application/json';
    let filename = `voiceforge_pronunciation_dictionary_${Date.now()}.${format}`;

    if (format === 'json') {
      content = JSON.stringify(dictionary, null, 2);
    } else {
      // W3C Pronunciation Lexicon Specification (PLS) v1.0
      mimeType = 'application/pls+xml';
      content = `<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0" 
         xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         alphabet="ipa" xml:lang="mul">
${dictionary
  .map(
    (e) => `  <lexeme>
    <grapheme>${e.word}</grapheme>
    <phoneme>${e.ipa}</phoneme>
    ${e.alias ? `<alias>${e.alias}</alias>` : ''}
  </lexeme>`
  )
  .join('\n')}
</lexicon>`;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLanguageLabel = (code: string) => {
    switch (code) {
      case 'ta': return 'Tamil (தமிழ்)';
      case 'hi': return 'Hindi (हिन्दी)';
      case 'ml': return 'Malayalam (മലയാളം)';
      case 'ja': return 'Japanese (日本語)';
      case 'en': return 'English';
      case 'all': return 'Universal (All)';
      default: return code.toUpperCase();
    }
  };

  const filteredDictionary = dictionary.filter((item) => {
    const matchesSearch =
      item.word.toLowerCase().includes(dictSearch.toLowerCase()) ||
      item.ipa.toLowerCase().includes(dictSearch.toLowerCase()) ||
      (item.notes && item.notes.toLowerCase().includes(dictSearch.toLowerCase()));
    const matchesLang = filterLang === 'all' || item.language === filterLang || item.language === 'all';
    return matchesSearch && matchesLang;
  });

  return (
    <div className="space-y-8 py-6">
      {/* Intro Hero */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <h2 className="text-2xl font-bold text-white">Multilingual Text Front-End & Pronunciation Dictionary</h2>
            </div>
            <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
              Inspect G2P phoneme streams, detect code-switching, and manually adjust custom IPA phoneme maps for specific words. Save custom overrides to your personal dictionary for consistent acoustic rendering across <strong>English, Tamil, Hindi, Malayalam, and Japanese</strong>.
            </p>
          </div>

          {/* Sub-view Switcher */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-slate-800 text-xs shrink-0">
            <button
              onClick={() => setActiveTab('workbench')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                activeTab === 'workbench'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Phonetic Lab & Adjuster
            </button>
            <button
              onClick={() => setActiveTab('dictionary')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'dictionary'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
              <span>Dictionary ({dictionary.length})</span>
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'workbench' && (
        <>
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
                  className="text-left p-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-indigo-500/40 transition-all group shadow-sm cursor-pointer"
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

          {/* Interactive Workbench Grid */}
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
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Processing G2P Rules...</span>
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

            {/* Right: Linguistic Output & Word-Level Inspector */}
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
                  {/* Word-Level Phoneme Token Breakdown with Click-to-Edit */}
                  {result.wordBreakdown && result.wordBreakdown.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                        <span>1. Word-by-Word Phoneme Tokens (Click to adjust map):</span>
                        <span className="text-[11px] text-indigo-400">Click word to edit IPA override</span>
                      </div>
                      <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-3 rounded-xl bg-slate-950 border border-slate-800">
                        {result.wordBreakdown.map((item, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSelectWordForAdjustment(item)}
                            className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col gap-0.5 ${
                              item.isOverridden
                                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20'
                                : editWord.toLowerCase() === item.word.toLowerCase()
                                ? 'bg-indigo-600/20 border-indigo-500 text-white'
                                : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-200'
                            }`}
                          >
                            <span className="font-semibold text-xs">{item.word}</span>
                            <span className="font-mono text-[10px] text-indigo-300">
                              /{item.ipa}/
                            </span>
                            {item.isOverridden && (
                              <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-0.5">
                                <Bookmark className="w-2.5 h-2.5" />
                                <span>Dictionary Override</span>
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Standardized Unified IPA Phonemes */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-400">2. Standardized Unified IPA Stream:</div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-emerald-400 font-mono-code leading-relaxed break-words text-xs">
                      {result.unifiedIpa || 'N/A'}
                    </div>
                  </div>

                  {/* Normalized Text */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-400">3. Normalized Script (NFC & Numerals):</div>
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 font-indic font-jp leading-relaxed text-xs">
                      {result.normalizedText}
                    </div>
                  </div>

                  {/* Linguistic Rules Applied */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-400">4. Applied Acoustic & Dictionary Rules:</div>
                    <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                      {result.linguisticNotes.map((note, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                          <span className={note.includes('Dictionary') ? 'text-emerald-300 font-semibold' : ''}>
                            {note}
                          </span>
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

          {/* Manual Phoneme Map Adjuster & Dictionary Save Panel */}
          <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Manual Phoneme Map Adjuster</h3>
                  <p className="text-xs text-slate-400">
                    Fine-tune specific phonetic pronunciations and save them to your personal dictionary
                  </p>
                </div>
              </div>

              {saveSuccessMsg && (
                <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" />
                  <span>{saveSuccessMsg}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Target Word</label>
                <input
                  type="text"
                  value={editWord}
                  onChange={(e) => setEditWord(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. VoiceForge or டாக்டர்"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Language Scope</label>
                <select
                  value={editLang}
                  onChange={(e) => setEditLang(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="all">Universal (All Languages)</option>
                  <option value="ta">Tamil (தமிழ்)</option>
                  <option value="hi">Hindi (हिन्दी)</option>
                  <option value="ml">Malayalam (മലയാളം)</option>
                  <option value="ja">Japanese (日本語)</option>
                  <option value="en">English</option>
                </select>
              </div>

              <div className="lg:col-span-2">
                <label className="text-xs font-semibold text-slate-300 block mb-1">Custom IPA Phonemes</label>
                <input
                  type="text"
                  value={editIpa}
                  onChange={(e) => setEditIpa(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm font-mono text-emerald-400 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. vɔɪs.fɔːrd͡ʒ or ɖaːk.ʈar"
                />
              </div>
            </div>

            {/* Quick IPA Keyboard Chips */}
            <div>
              <div className="text-xs font-semibold text-slate-400 mb-1.5 flex items-center justify-between">
                <span>Quick IPA Symbol Insertion:</span>
                <span className="text-[11px] text-slate-500">Click to append to IPA field</span>
              </div>
              <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                {IPA_CHIPS.map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => handleInsertIpaSymbol(sym)}
                    className="px-2 py-1 rounded bg-slate-900 hover:bg-indigo-600 hover:text-white border border-slate-800 font-mono text-xs text-slate-300 transition-colors cursor-pointer"
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional Alias & Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">
                  Optional Alias / Written Replacement (e.g. for acronyms):
                </label>
                <input
                  type="text"
                  value={editAlias}
                  onChange={(e) => setEditAlias(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Voice Forge or Doctor"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">
                  Lexical Notes / Justification:
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Preserves aspirated retroflex consonant"
                />
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={handlePreviewPronunciation}
                disabled={!editWord || previewingAudio}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 font-medium inline-flex items-center gap-2 cursor-pointer transition-all shadow"
              >
                {previewingAudio ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                )}
                <span>Test Word Pronunciation</span>
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditWord('');
                    setEditIpa('');
                    setEditAlias('');
                    setEditNotes('');
                  }}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Clear Fields
                </button>

                <button
                  type="button"
                  onClick={handleSaveOverride}
                  disabled={!editWord.trim() || !editIpa.trim() || savingOverride}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-indigo-600/30 inline-flex items-center gap-2 cursor-pointer transition-all"
                >
                  {savingOverride ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Save Override to Personal Dictionary</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ==================================================================== */}
      {/* PERSONAL PRONUNCIATION DICTIONARY VIEW                               */}
      {/* ==================================================================== */}
      {activeTab === 'dictionary' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Bookmark className="w-5 h-5 text-indigo-400" />
                Personal Pronunciation Dictionary
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Every saved entry is automatically enforced across the G2P front-end, TTS Studio, and dubbing pipelines.
              </p>
            </div>

            {/* Export & Import Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleExportDictionary('json')}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 font-medium inline-flex items-center gap-1.5 cursor-pointer shadow"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span>Export JSON</span>
              </button>
              <button
                onClick={() => handleExportDictionary('pls')}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 font-medium inline-flex items-center gap-1.5 cursor-pointer shadow"
              >
                <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                <span>Export W3C PLS</span>
              </button>
            </div>
          </div>

          {/* Search & Language Filter */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={dictSearch}
                onChange={(e) => setDictSearch(e.target.value)}
                placeholder="Search words, IPA symbols, or notes..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <select
              value={filterLang}
              onChange={(e) => setFilterLang(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-xs rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 shrink-0 w-full sm:w-auto"
            >
              <option value="all">All Languages</option>
              <option value="ta">Tamil (தமிழ்)</option>
              <option value="hi">Hindi (हिन्दी)</option>
              <option value="ml">Malayalam (മലയാളം)</option>
              <option value="ja">Japanese (日本語)</option>
              <option value="en">English</option>
            </select>
          </div>

          {/* Dictionary Table */}
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Word / Token</th>
                  <th className="py-3 px-4">Language</th>
                  <th className="py-3 px-4">Custom IPA Phonemes</th>
                  <th className="py-3 px-4">Alias / Replacement</th>
                  <th className="py-3 px-4">Lexical Notes</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredDictionary.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No pronunciation dictionary overrides found matching your query.
                    </td>
                  </tr>
                ) : (
                  filteredDictionary.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-900/60 transition-colors">
                      <td className="py-3 px-4 font-bold text-white font-indic font-jp">
                        {entry.word}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] uppercase">
                          {entry.language}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-emerald-400 font-medium">
                        /{entry.ipa}/
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {entry.alias || '—'}
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-[11px] max-w-xs truncate">
                        {entry.notes || '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditWord(entry.word);
                              setEditIpa(entry.ipa);
                              setEditLang(entry.language);
                              setEditAlias(entry.alias || '');
                              setEditNotes(entry.notes || '');
                              setActiveTab('workbench');
                            }}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white transition-all cursor-pointer"
                            title="Edit this entry"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteEntry(entry.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white transition-all cursor-pointer"
                            title="Delete entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
