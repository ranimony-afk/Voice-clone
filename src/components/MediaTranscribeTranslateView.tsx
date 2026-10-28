import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  Languages,
  Volume2,
  Upload,
  Video,
  FileAudio,
  Play,
  Pause,
  Download,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  ArrowRight,
  Globe2,
  Clock,
  Mic,
  Sliders,
  UserCheck,
  ShieldCheck,
  CheckCircle2,
  Wand2,
  Layers,
  Square,
  FileSpreadsheet,
  RotateCcw,
  Database,
} from 'lucide-react';
import { SupportedLanguage, VoiceProfile } from '../../server/engine/types.ts';

interface MediaTranscribeTranslateViewProps {
  voices: VoiceProfile[];
}

interface Segment {
  start: number;
  end: number;
  text: string;
  translated?: string;
  speaker?: string;
}

interface TargetLanguageOption {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  flag: string;
}

const TARGET_LANGUAGES: TargetLanguageOption[] = [
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', flag: '🇮🇳' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', flag: '🇮🇳' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
];

const PRESET_SAMPLES = [
  {
    id: 'sample_fr',
    title: 'French Speech (Français)',
    flag: '🇫🇷',
    type: 'audio',
    lang: 'fr',
    langName: 'French (Français)',
    text: 'Bienvenue sur VoiceForge. Nous démontrons aujourd’hui le clonage vocal instantané et la synthèse vocale neuronale multilingue.',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_de',
    title: 'German Audio (Deutsch)',
    flag: '🇩🇪',
    type: 'audio',
    lang: 'de',
    langName: 'German (Deutsch)',
    text: 'Willkommen bei VoiceForge. Heute demonstrieren wir sofortiges Stimmenklonen und hochpräzise neuronale Sprachsynthese über mehrere Sprachen hinweg.',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_es',
    title: 'Spanish Speech (Español)',
    flag: '🇪🇸',
    type: 'audio',
    lang: 'es',
    langName: 'Spanish (Español)',
    text: 'Bienvenidos a VoiceForge. Hoy demostramos la clonación instantánea de voz y la síntesis neuronal en múltiples idiomas.',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_zh',
    title: 'Mandarin Chinese (中文)',
    flag: '🇨🇳',
    type: 'audio',
    lang: 'zh',
    langName: 'Mandarin Chinese (中文)',
    text: '欢迎使用 VoiceForge。今天我们展示即时零样本声音克隆，以及跨多种语言的高保真神经语音合成。',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_ar',
    title: 'Arabic Speech (العربية)',
    flag: '🇸🇦',
    type: 'audio',
    lang: 'ar',
    langName: 'Arabic (العربية)',
    text: 'مرحبًا بكم في VoiceForge. نستعرض اليوم استنساخ الصوت الفوري والتركيب الصوتي العصبي عبر لغات متعددة.',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_ru',
    title: 'Russian Speech (Русский)',
    flag: '🇷🇺',
    type: 'audio',
    lang: 'ru',
    langName: 'Russian (Русский)',
    text: 'Добро пожаловать в VoiceForge. Сегодня мы демонстрируем мгновенное клонирование голоса и нейронный синтез речи на разных языках.',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_ja',
    title: 'Japanese Announcement (日本語)',
    flag: '🇯🇵',
    type: 'audio',
    lang: 'ja',
    langName: 'Japanese (日本語)',
    text: 'VoiceForgeへようこそ。音声サンプルのクローン作成と、多言語への自然な音声合成をご体験ください。',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_ta',
    title: 'Tamil Speech (தமிழ்)',
    flag: '🇮🇳',
    type: 'audio',
    lang: 'ta',
    langName: 'Tamil (தமிழ்)',
    text: 'வாய்ஸ்போர்ஜ் தளத்திற்கு தங்களை அன்புடன் வரவேற்கிறோம். உங்களின் தனித்துவமான குரலை உடனுக்குடன் குளோனிங் செய்து எந்த மொழியிலும் பேச வைக்கலாம்.',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_hi',
    title: 'Hindi Podcast (हिन्दी)',
    flag: '🇮🇳',
    type: 'audio',
    lang: 'hi',
    langName: 'Hindi (हिन्दी)',
    text: 'वॉइसफोर्ज में आपका हार्दिक स्वागत है। हम आपकी आवाज़ को सेकंडों में क्लोन करके किसी भी भाषा में सहजता से प्रस्तुत कर सकते हैं।',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_ml',
    title: 'Malayalam Address (മലയാളം)',
    flag: '🇮🇳',
    type: 'audio',
    lang: 'ml',
    langName: 'Malayalam (മലയാളം)',
    text: 'വോയ്സ്ഫോർജിലേക്ക് എല്ലാവർക്കും സ്വാഗതം. നിങ്ങളുടെ സ്വന്തം ശബ്ദം ക്ലോൺ ചെയ്ത് വിവിധ ഭാഷകളിൽ സംസാരിക്കാൻ സാധിക്കും.',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_en',
    title: 'English Keynote (English)',
    flag: '🇬🇧',
    type: 'audio',
    lang: 'en',
    langName: 'English (US)',
    text: 'Welcome to VoiceForge. Today we demonstrate instant zero-shot voice cloning and cross-lingual neural speech synthesis across multiple languages.',
    url: 'https://actions.google.com/sounds/v1/speech/greeting.ogg',
  },
  {
    id: 'sample_video',
    title: 'Foreign Speech Video Clip (MP4)',
    flag: '🎥',
    type: 'video',
    lang: 'en',
    langName: 'Video Audio Track',
    text: 'This video demonstrates automated speech recognition, instant multilingual translation, and cloned voice dubbing.',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  },
];

interface BatchTranslationItem {
  targetLanguage: string;
  translatedText: string;
  phoneticGuide?: string;
  translatedSegments: Array<{ start: number; end: number; originalText: string; translatedText: string }>;
}

export const MediaTranscribeTranslateView: React.FC<MediaTranscribeTranslateViewProps> = ({ voices }) => {
  // Input Media State
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string>('https://actions.google.com/sounds/v1/speech/greeting.ogg');
  const [mediaType, setMediaType] = useState<'audio' | 'video'>('audio');
  const [mediaBase64, setMediaBase64] = useState<string>('sample_data');
  const [mediaFileName, setMediaFileName] = useState<string>('french_speech_sample.mp3');

  // Microphone Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  // Transcription State
  const [transcribing, setTranscribing] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState<string>('fr');
  const [detectedLanguageName, setDetectedLanguageName] = useState<string>('French (Français)');
  const [confidence, setConfidence] = useState<number>(0.98);
  const [originalTranscript, setOriginalTranscript] = useState<string>(
    'Bienvenue sur VoiceForge. Nous démontrons aujourd’hui le clonage vocal instantané et la synthèse vocale neuronale multilingue.'
  );
  const [segments, setSegments] = useState<Segment[]>([
    { start: 0.0, end: 2.2, text: 'Bienvenue sur VoiceForge.', speaker: 'Speaker 1' },
    {
      start: 2.3,
      end: 6.5,
      text: 'Nous démontrons aujourd’hui le clonage vocal instantané et la synthèse vocale neuronale multilingue.',
      speaker: 'Speaker 1',
    },
  ]);

  // Translation State
  const [targetLanguage, setTargetLanguage] = useState<SupportedLanguage>('ta');
  const [translating, setTranslating] = useState(false);
  const [translatedText, setTranslatedText] = useState<string>(
    'வாய்ஸ்போர்ஜ் தளத்திற்கு தங்களை அன்புடன் வரவேற்கிறோம். உங்களின் தனித்துவமான குரலை குளோனிங் செய்து இயல்பான உச்சரிப்பில் பல மொழிகளில் பேச வைக்க முடியும்.'
  );
  const [phoneticGuide, setPhoneticGuide] = useState<string>(
    'VoiceForge thalathirkku thangalai anbudan varaverkirom. Ungalin thanithuvamana kuralai clone seidhu iyalaana ucharippil pala mozhigalil pesa mudiyum.'
  );

  // Batch Translation to All Above Languages
  const [batchTranslating, setBatchTranslating] = useState(false);
  const [batchTranslations, setBatchTranslations] = useState<Record<string, BatchTranslationItem> | null>(null);
  const [activeBatchTab, setActiveBatchTab] = useState<string>('ta');

  // Synthesis State
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(voices[0]?.id || 'vf_priya_ta');
  const [speed, setSpeed] = useState<number>(1.0);
  const [pitch, setPitch] = useState<number>(0.0);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesizedAudioBase64, setSynthesizedAudioBase64] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(4.2);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedTranslated, setCopiedTranslated] = useState(false);

  // Persistent Media Jobs (PostgreSQL Drizzle ORM)
  const [mediaJobs, setMediaJobs] = useState<Array<any>>([]);
  const [dbSource, setDbSource] = useState<string>('memory');
  const [isProcessingUnified, setIsProcessingUnified] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const fetchMediaJobs = async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('voiceforge_token') : null;
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/media/jobs', { headers });
      const data = await res.json();
      if (data.jobs && Array.isArray(data.jobs)) {
        setMediaJobs(data.jobs);
        if (data.source) setDbSource(data.source);
      }
    } catch (e) {
      console.warn('Failed to fetch media jobs:', e);
    }
  };

  useEffect(() => {
    fetchMediaJobs();
  }, []);

  // Automatically update selected voice if target language changes
  useEffect(() => {
    const matchingVoice = voices.find((v) => v.primaryLanguage === targetLanguage);
    if (matchingVoice) {
      setSelectedVoiceId(matchingVoice.id);
    }
  }, [targetLanguage, voices]);

  // Unified Transcribe, Translate & Dub Pipeline
  const handleUnifiedPipeline = async () => {
    setIsProcessingUnified(true);
    try {
      let b64ToSend = mediaBase64;
      if (!b64ToSend) {
        b64ToSend = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
      }

      const token = typeof window !== 'undefined' ? localStorage.getItem('voiceforge_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/media/transcribe-translate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mediaBase64: b64ToSend,
          mimeType: mediaType === 'video' ? 'video/mp4' : 'audio/mp3',
          targetLanguage,
          sourceLanguageHint: detectedLanguage,
          mediaTitle: mediaFileName || 'Media File',
          dubbingVoiceId: selectedVoiceId,
          synthesizeDub: true,
        }),
      });

      const data = await res.json();
      if (data.fullTranscript) {
        setOriginalTranscript(data.fullTranscript);
        setDetectedLanguage(data.detectedLanguage || 'en');
        setDetectedLanguageName(data.detectedLanguageName || 'Detected Language');
        setConfidence(data.confidence || 0.98);
      }
      if (data.translatedText) {
        setTranslatedText(data.translatedText);
        setPhoneticGuide(data.phoneticGuide || '');
      }
      if (data.segments && Array.isArray(data.segments)) {
        setSegments(data.segments);
      }
      if (data.dubbedAudioUrl) {
        const pureB64 = data.dubbedAudioUrl.replace(/^data:audio\/[a-zA-Z]+;base64,/, '');
        setSynthesizedAudioBase64(pureB64);
        playSynthesizedAudio(pureB64);
      }
      fetchMediaJobs();
    } catch (err) {
      console.error('Unified pipeline error:', err);
    } finally {
      setIsProcessingUnified(false);
    }
  };

  const loadHistoricalJob = (job: any) => {
    if (job.fullTranscript) setOriginalTranscript(job.fullTranscript);
    if (job.sourceLang) setDetectedLanguage(job.sourceLang);
    if (job.sourceLangName) setDetectedLanguageName(job.sourceLangName);
    if (job.targetLang) setTargetLanguage(job.targetLang);
    if (job.translatedText) setTranslatedText(job.translatedText);
    if (job.phoneticGuide) setPhoneticGuide(job.phoneticGuide);
    if (job.translatedSegments) setSegments(job.translatedSegments);
    if (job.dubbedAudioUrl) {
      const pureB64 = job.dubbedAudioUrl.replace(/^data:audio\/[a-zA-Z]+;base64,/, '');
      setSynthesizedAudioBase64(pureB64);
      playSynthesizedAudio(pureB64);
    }
  };

  // File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMediaFile(file);
    setMediaFileName(file.name);
    const isVid = file.type.startsWith('video/');
    setMediaType(isVid ? 'video' : 'audio');

    const objectUrl = URL.createObjectURL(file);
    setMediaUrl(objectUrl);

    const reader = new FileReader();
    reader.onload = () => {
      const b64 = (reader.result as string).split(',')[1] || (reader.result as string);
      setMediaBase64(b64);
    };
    reader.readAsDataURL(file);
  };

  // Microphone Recording Handler
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setMediaUrl(audioUrl);
        setMediaType('audio');
        setMediaFileName(`mic_recording_${Date.now()}.webm`);

        const reader = new FileReader();
        reader.onloadend = () => {
          const b64 = (reader.result as string).split(',')[1];
          setMediaBase64(b64);
        };
        reader.readAsDataURL(audioBlob);

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordingTimerRef.current);
    }
  };

  // Load Preset Sample
  const handleLoadSample = (sample: typeof PRESET_SAMPLES[0]) => {
    setMediaFileName(sample.title);
    setMediaType(sample.type as any);
    setMediaUrl(sample.url);
    setOriginalTranscript(sample.text);
    setDetectedLanguage(sample.lang);
    setDetectedLanguageName(sample.langName);
    setSegments([
      { start: 0.0, end: 3.0, text: sample.text.substring(0, Math.floor(sample.text.length / 2)) },
      { start: 3.1, end: 6.5, text: sample.text.substring(Math.floor(sample.text.length / 2)) },
    ]);
    setBatchTranslations(null);
  };

  // 1. Run Transcription
  const handleTranscribe = async () => {
    setTranscribing(true);
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaBase64,
          mimeType: mediaType === 'video' ? 'video/mp4' : 'audio/mp3',
          languageHint: 'auto',
        }),
      });
      const data = await res.json();
      if (data.fullTranscript) {
        setOriginalTranscript(data.fullTranscript);
        setDetectedLanguage(data.detectedLanguage || 'en');
        setDetectedLanguageName(data.detectedLanguageName || 'Detected Language');
        setConfidence(data.confidence || 0.98);
        if (data.segments && Array.isArray(data.segments)) {
          setSegments(data.segments);
        }
      }
    } catch (err) {
      console.error('Transcription error:', err);
    } finally {
      setTranscribing(false);
    }
  };

  // 2. Run Translation for Single Target Language
  const handleTranslate = async (targetOverride?: SupportedLanguage) => {
    const lang = targetOverride || targetLanguage;
    setTranslating(true);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: originalTranscript,
          sourceLanguage: detectedLanguage,
          targetLanguage: lang,
          segments,
        }),
      });
      const data = await res.json();
      if (data.translatedText) {
        setTranslatedText(data.translatedText);
        setPhoneticGuide(data.phoneticGuide || '');
        if (data.translatedSegments && Array.isArray(data.translatedSegments)) {
          setSegments(
            data.translatedSegments.map((s: any) => ({
              start: s.start,
              end: s.end,
              text: s.originalText || s.text,
              translated: s.translatedText,
            }))
          );
        }
      }
    } catch (err) {
      console.error('Translation error:', err);
    } finally {
      setTranslating(false);
    }
  };

  // 3. Batch Translate into All Above Languages
  const handleTranslateAll = async () => {
    setBatchTranslating(true);
    try {
      const res = await fetch('/api/translate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: originalTranscript,
          sourceLanguage: detectedLanguage,
          segments,
        }),
      });
      const data = await res.json();
      if (data.translations && Array.isArray(data.translations)) {
        const map: Record<string, BatchTranslationItem> = {};
        data.translations.forEach((t: any) => {
          map[t.targetLanguage] = {
            targetLanguage: t.targetLanguage,
            translatedText: t.translatedText,
            phoneticGuide: t.phoneticGuide,
            translatedSegments: t.translatedSegments || [],
          };
        });
        setBatchTranslations(map);
        // Sync current target language display
        if (map[targetLanguage]) {
          setTranslatedText(map[targetLanguage].translatedText);
          setPhoneticGuide(map[targetLanguage].phoneticGuide || '');
        }
      }
    } catch (err) {
      console.error('Batch translation error:', err);
    } finally {
      setBatchTranslating(false);
    }
  };

  // 4. Run Speech Synthesis of Translated Text
  const handleSynthesizeAudio = async (textOverride?: string, langOverride?: SupportedLanguage) => {
    const textToSpeak = textOverride || translatedText;
    const langToUse = langOverride || targetLanguage;

    setSynthesizing(true);
    try {
      const res = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSpeak,
          voiceId: selectedVoiceId,
          language: langToUse,
          settings: { speed, pitch },
          format: 'wav',
        }),
      });
      const data = await res.json();
      if (data.audioBase64) {
        setSynthesizedAudioBase64(data.audioBase64);
        setAudioDuration(data.durationSeconds || 4.2);
        playSynthesizedAudio(data.audioBase64);
      }
    } catch (err) {
      console.error('Synthesis error:', err);
    } finally {
      setSynthesizing(false);
    }
  };

  const playSynthesizedAudio = (b64?: string) => {
    const audioData = b64 || synthesizedAudioBase64;
    if (!audioData) return;

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }

    const audio = new Audio(`data:audio/wav;base64,${audioData}`);
    audioPlayerRef.current = audio;
    setIsPlayingAudio(true);
    audio.play();
    audio.onended = () => setIsPlayingAudio(false);
    audio.onerror = () => setIsPlayingAudio(false);
  };

  const stopSynthesizedAudio = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }
    setIsPlayingAudio(false);
  };

  const handleCopy = (text: string, type: 'original' | 'translated') => {
    navigator.clipboard.writeText(text);
    if (type === 'original') {
      setCopiedOriginal(true);
      setTimeout(() => setCopiedOriginal(false), 2000);
    } else {
      setCopiedTranslated(true);
      setTimeout(() => setCopiedTranslated(false), 2000);
    }
  };

  // Download WAV file
  const handleDownloadAudio = () => {
    if (!synthesizedAudioBase64) return;
    const a = document.createElement('a');
    a.href = `data:audio/wav;base64,${synthesizedAudioBase64}`;
    a.download = `voiceforge_dubbed_${targetLanguage}_${Date.now()}.wav`;
    a.click();
  };

  // Export Transcript / Subtitles
  const handleExportSubtitles = (format: 'srt' | 'txt') => {
    let content = '';
    if (format === 'txt') {
      content = `SOURCE TRANSCRIPT (${detectedLanguageName}):\n${originalTranscript}\n\nTRANSLATION (${targetLanguage.toUpperCase()}):\n${translatedText}\n\nPHONETIC GUIDE:\n${phoneticGuide}`;
    } else {
      // Generate SRT formatted subtitles
      content = segments
        .map((seg, idx) => {
          const startMin = Math.floor(seg.start / 60);
          const startSec = Math.floor(seg.start % 60);
          const startMs = Math.floor((seg.start % 1) * 1000);
          const endMin = Math.floor(seg.end / 60);
          const endSec = Math.floor(seg.end % 60);
          const endMs = Math.floor((seg.end % 1) * 1000);

          const timecode = `00:${String(startMin).padStart(2, '0')}:${String(startSec).padStart(2, '0')},${String(startMs).padStart(3, '0')} --> 00:${String(endMin).padStart(2, '0')}:${String(endSec).padStart(2, '0')},${String(endMs).padStart(3, '0')}`;
          return `${idx + 1}\n${timecode}\n${seg.translated || seg.text}\n`;
        })
        .join('\n');
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `subtitles_${targetLanguage}_${Date.now()}.${format}`;
    a.click();
  };

  return (
    <div className="space-y-8 py-6">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Universal Transcriber & Multilingual Dubbing</h2>
                <span className="text-xs text-indigo-300 font-mono">
                  From ANY Language ➔ Tamil, Hindi, Malayalam, Japanese, English, Spanish, French, German
                </span>
              </div>
            </div>
            <p className="text-sm text-slate-300 max-w-3xl leading-relaxed mt-2">
              Upload any audio or video clip in <strong>any global language</strong>. The system automatically transcribes spoken dialogue in its native script, and translates it into all platform languages with phonetic pronunciation guides and cloned voice dubbing.
            </p>
          </div>

          <div className="flex flex-col gap-1.5 shrink-0 bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs">
            <div className="flex items-center gap-2 text-cyan-400 font-semibold">
              <Globe2 className="w-4 h-4" />
              <span>Universal Source Detection</span>
            </div>
            <span className="text-[11px] text-slate-400">
              100+ Source Languages ➔ 8 Target Languages
            </span>
          </div>
        </div>
      </div>

      {/* Grid: Left Column (Media & ASR) & Right Column (Translation & Dubbing) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ==================================================================== */}
        {/* LEFT COLUMN: 1. UPLOAD MEDIA & TRANSCRIBE IN ORIGINAL SCRIPT        */}
        {/* ==================================================================== */}
        <div className="space-y-6">
          {/* Card 1: Media Upload & Preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xs border border-indigo-500/30">
                  1
                </div>
                <h3 className="text-base font-bold text-white">Upload Audio or Video in Any Language</h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">MP3, WAV, MP4, WebM</span>
            </div>

            {/* Hidden Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.webm,.mov"
              className="hidden"
            />

            {/* Drop / Select Zone & Live Mic Button */}
            <div className="border-2 border-dashed border-slate-800 hover:border-indigo-500/60 rounded-xl p-5 text-center bg-slate-950/60 transition-all space-y-3">
              <div className="flex items-center justify-center gap-3">
                <FileAudio className="w-6 h-6 text-indigo-400" />
                <Video className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Select Any Audio or Video Media</div>
                <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-sm mx-auto">
                  Loaded: <strong className="text-indigo-300">{mediaFileName}</strong>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 font-medium inline-flex items-center gap-2 cursor-pointer shadow transition-all"
                >
                  <Upload className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Upload Local File</span>
                </button>

                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`px-4 py-2 rounded-xl text-xs font-medium inline-flex items-center gap-2 cursor-pointer shadow transition-all ${
                    isRecording
                      ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
                      : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <Square className="w-3.5 h-3.5" />
                      <span>Stop Recording ({recordingSeconds}s)</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5 text-rose-400" />
                      <span>Record Microphone</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Global Language Preset Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-400">
                  Or load foreign speech sample from any language:
                </label>
                <span className="text-[10px] text-slate-500">12 Languages</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PRESET_SAMPLES.map((sample) => (
                  <button
                    key={sample.id}
                    onClick={() => handleLoadSample(sample)}
                    className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300 hover:text-white transition-all cursor-pointer flex items-center gap-2 text-left"
                  >
                    <span className="text-base">{sample.flag}</span>
                    <span className="truncate font-medium">{sample.title.split(' ')[0]} {sample.title.split(' ')[1] || ''}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Media Player Preview */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Input Media Preview</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-indigo-400 font-bold">
                  {mediaType}
                </span>
              </div>
              {mediaType === 'video' ? (
                <video
                  src={mediaUrl}
                  controls
                  className="w-full h-44 rounded-lg bg-black object-cover"
                />
              ) : (
                <audio
                  src={mediaUrl}
                  controls
                  className="w-full h-10 rounded"
                />
              )}
            </div>

            {/* Action Buttons: 1-Click Pipeline & Step-by-Step Transcribe */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                onClick={handleUnifiedPipeline}
                disabled={isProcessingUnified}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-teal-600 via-emerald-600 to-teal-600 hover:from-teal-500 hover:to-emerald-500 text-white font-bold text-xs shadow-lg shadow-teal-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                {isProcessingUnified ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Running Full Multimodal Dub Pipeline...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-emerald-300" />
                    <span>1-Click Transcribe + Translate + Dub</span>
                  </>
                )}
              </button>

              <button
                onClick={handleTranscribe}
                disabled={transcribing}
                className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                {transcribing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Transcribing with Gemini...</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    <span>Step 1: Transcribe Spoken Speech</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card 2: Original Language Transcription Output */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xs border border-indigo-500/30">
                  2
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Original Language Transcription</h3>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span>
                      Detected Language: <strong className="text-indigo-400">{detectedLanguageName} ({detectedLanguage.toUpperCase()})</strong>
                    </span>
                    <span>•</span>
                    <span>Confidence: <strong className="text-emerald-400">{(confidence * 100).toFixed(0)}%</strong></span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleCopy(originalTranscript, 'original')}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                  title="Copy original text"
                >
                  {copiedOriginal ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => handleExportSubtitles('srt')}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer"
                  title="Export SRT Subtitles"
                >
                  <FileSpreadsheet className="w-4 h-4 text-indigo-400" />
                </button>
              </div>
            </div>

            {/* Editable Full Transcript Area */}
            <div>
              <label className="text-xs font-semibold text-slate-400 block mb-1">
                Full Transcript in Original Native Script:
              </label>
              <textarea
                value={originalTranscript}
                onChange={(e) => setOriginalTranscript(e.target.value)}
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500 leading-relaxed font-sans"
              />
            </div>

            {/* Timed Segments Breakdown */}
            {segments.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Timed Sentence Segments (Word Timestamps)</span>
                </div>
                <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
                  {segments.map((seg, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 flex items-start gap-2.5 text-xs"
                    >
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 shrink-0 mt-0.5">
                        {seg.start.toFixed(1)}s - {seg.end.toFixed(1)}s
                      </span>
                      <p className="text-slate-200 leading-normal">{seg.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ==================================================================== */}
        {/* RIGHT COLUMN: 2. MULTILINGUAL TRANSLATION & VOICE DUBBING            */}
        {/* ==================================================================== */}
        <div className="space-y-6">
          {/* Card 3: Multilingual Translation */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-violet-600/20 text-violet-400 flex items-center justify-center font-bold text-xs border border-violet-500/30">
                  3
                </div>
                <h3 className="text-base font-bold text-white">Translate into Target Languages</h3>
              </div>

              {/* BATCH TRANSLATE ALL BUTTON */}
              <button
                type="button"
                onClick={handleTranslateAll}
                disabled={batchTranslating || !originalTranscript}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-bold text-xs shadow-md shadow-violet-600/30 flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
              >
                {batchTranslating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Translating All...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Translate to ALL Above Languages</span>
                  </>
                )}
              </button>
            </div>

            {/* Target Language Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300">Choose Target Language:</label>
                <span className="text-[10px] text-slate-500">8 Supported Languages</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TARGET_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => {
                      setTargetLanguage(lang.code);
                      if (batchTranslations && batchTranslations[lang.code]) {
                        setTranslatedText(batchTranslations[lang.code].translatedText);
                        setPhoneticGuide(batchTranslations[lang.code].phoneticGuide || '');
                      }
                    }}
                    className={`p-2.5 rounded-xl text-xs font-medium border text-left transition-all cursor-pointer ${
                      targetLanguage === lang.code
                        ? 'bg-violet-600 text-white border-violet-500 shadow-md shadow-violet-600/30 font-bold'
                        : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-sm">{lang.flag}</span>
                      <span className="font-bold truncate">{lang.name}</span>
                    </div>
                    <div className="text-[10px] opacity-80 truncate">{lang.nativeName}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Translate Button for Single Language */}
            <button
              onClick={() => handleTranslate()}
              disabled={translating || !originalTranscript}
              className="w-full py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-violet-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              {translating ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Translating into {targetLanguage.toUpperCase()}...</span>
                </>
              ) : (
                <>
                  <Languages className="w-3.5 h-3.5" />
                  <span>
                    Translate from {detectedLanguageName} ➔ {TARGET_LANGUAGES.find((t) => t.code === targetLanguage)?.name} ({targetLanguage.toUpperCase()})
                  </span>
                </>
              )}
            </button>

            {/* Translated Output Box */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-400">
                  Translated Text ({TARGET_LANGUAGES.find((t) => t.code === targetLanguage)?.name} Native Script):
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleCopy(translatedText, 'translated')}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer text-xs flex items-center gap-1"
                  >
                    {copiedTranslated ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>Copy</span>
                  </button>
                  <button
                    onClick={() => handleExportSubtitles('txt')}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all cursor-pointer text-xs flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export</span>
                  </button>
                </div>
              </div>

              <textarea
                value={translatedText}
                onChange={(e) => setTranslatedText(e.target.value)}
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-emerald-300 focus:outline-none focus:border-violet-500 leading-relaxed font-sans"
              />

              {/* Romanized Phonetic Pronunciation Guide */}
              {phoneticGuide && (
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
                  <span className="font-semibold text-violet-400 block mb-0.5">
                    Romanized Phonetic Pronunciation Guide:
                  </span>
                  <p className="text-slate-300 italic font-mono-code leading-relaxed">{phoneticGuide}</p>
                </div>
              )}
            </div>

            {/* BATCH TRANSLATIONS ACCORDION / TABS (IF RUN) */}
            {batchTranslations && (
              <div className="p-4 rounded-xl bg-slate-950/90 border border-violet-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-violet-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Multilingual Matrix Translations (All 8 Core Languages)
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400">Complete ✓</span>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {TARGET_LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        setActiveBatchTab(lang.code);
                        setTargetLanguage(lang.code);
                        if (batchTranslations[lang.code]) {
                          setTranslatedText(batchTranslations[lang.code].translatedText);
                          setPhoneticGuide(batchTranslations[lang.code].phoneticGuide || '');
                        }
                      }}
                      className={`p-1.5 rounded-lg text-[11px] border text-center transition-all ${
                        activeBatchTab === lang.code
                          ? 'bg-violet-600 text-white border-violet-400 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      <span>{lang.flag} {lang.name}</span>
                    </button>
                  ))}
                </div>

                {batchTranslations[activeBatchTab] && (
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-1.5">
                    <div className="font-semibold text-slate-200">
                      {TARGET_LANGUAGES.find((t) => t.code === activeBatchTab)?.name} Translation:
                    </div>
                    <p className="text-emerald-300 leading-relaxed font-sans">
                      {batchTranslations[activeBatchTab].translatedText}
                    </p>
                    {batchTranslations[activeBatchTab].phoneticGuide && (
                      <p className="text-slate-400 italic text-[11px] pt-1 border-t border-slate-800">
                        {batchTranslations[activeBatchTab].phoneticGuide}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card 4: Synthesize Audio with Cloned Voice */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold text-xs border border-emerald-500/30">
                  4
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Synthesize into Speech / Voice Dubbing</h3>
                  <p className="text-[11px] text-slate-400">
                    Dub in {TARGET_LANGUAGES.find((t) => t.code === targetLanguage)?.name} using your cloned voice
                  </p>
                </div>
              </div>
            </div>

            {/* Voice Profile Picker */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Select Speaking Voice:</label>
              <select
                value={selectedVoiceId}
                onChange={(e) => setSelectedVoiceId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} • [{v.category === 'cloned_instant' ? '⭐ YOUR CLONED VOICE' : v.category.toUpperCase()}] ({v.primaryLanguage.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>

            {/* Speed & Pitch Controls */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Speed</span>
                  <span className="font-mono text-white">{speed}x</span>
                </div>
                <input
                  type="range"
                  min="0.75"
                  max="1.5"
                  step="0.05"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Pitch Shift</span>
                  <span className="font-mono text-white">{pitch > 0 ? `+${pitch}` : pitch} st</span>
                </div>
                <input
                  type="range"
                  min="-6"
                  max="6"
                  step="0.5"
                  value={pitch}
                  onChange={(e) => setPitch(parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Synthesize Button */}
            <button
              onClick={() => handleSynthesizeAudio()}
              disabled={synthesizing || !translatedText}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              {synthesizing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing {targetLanguage.toUpperCase()} Speech...</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4" />
                  <span>Synthesize Translated Speech Audio ({targetLanguage.toUpperCase()})</span>
                </>
              )}
            </button>

            {/* Synthesized Audio Player & Download */}
            {synthesizedAudioBase64 && (
              <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Translated Audio Generated ({audioDuration}s)
                  </span>
                  <span className="text-slate-400 font-mono text-[11px]">24kHz WAV • Clean Vocoder</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={isPlayingAudio ? stopSynthesizedAudio : () => playSynthesizedAudio()}
                    className="p-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-2 shadow-md cursor-pointer transition-all"
                  >
                    {isPlayingAudio ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    <span>{isPlayingAudio ? 'Pause' : 'Play Audio'}</span>
                  </button>

                  <button
                    onClick={handleDownloadAudio}
                    className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium text-xs flex items-center gap-2 cursor-pointer transition-all"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download WAV</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PERSISTENT MEDIA JOBS & DUBS (PostgreSQL Drizzle ORM) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-teal-400" />
            <span className="text-sm font-bold text-white uppercase tracking-wider">
              Recent Transcriptions & Dubs (PostgreSQL Persistent Ledger)
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20 font-mono-code">
              {dbSource === 'postgresql' ? 'PostgreSQL Active' : 'Drizzle Schema Ready'}
            </span>
          </div>

          <button
            type="button"
            onClick={fetchMediaJobs}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-950 border border-slate-800 text-slate-300 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh Ledger</span>
          </button>
        </div>

        {mediaJobs.length === 0 ? (
          <div className="p-6 border border-dashed border-slate-800 rounded-xl text-center text-xs text-slate-500">
            No media transcription or dubbing jobs recorded yet. Run a transcription or 1-click dub above to record the first entry.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mediaJobs.slice(0, 6).map((job) => (
              <div
                key={job.id}
                className="p-4 rounded-xl border border-slate-800 bg-slate-950/80 hover:border-slate-700 transition-all space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-white line-clamp-1">{job.mediaTitle || 'Media File'}</div>
                    <div className="text-[10px] text-slate-400">
                      {job.sourceLangName || job.sourceLang?.toUpperCase()} ➔ {job.targetLang?.toUpperCase()}
                    </div>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    {job.status || 'completed'}
                  </span>
                </div>

                <div className="p-2.5 bg-slate-900 rounded-lg text-[11px] text-slate-300 line-clamp-2">
                  {job.translatedText || job.fullTranscript}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => loadHistoricalJob(job)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/30 text-[11px] font-semibold"
                  >
                    <span>Load in Studio</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    {job.dubbedAudioUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          const pureB64 = job.dubbedAudioUrl.replace(/^data:audio\/[a-zA-Z]+;base64,/, '');
                          playSynthesizedAudio(pureB64);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold"
                        title="Play audio dub"
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>Play</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleExportSubtitles('srt')}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                      title="Download SRT Subtitles"
                    >
                      <Download className="w-3 h-3" />
                      <span>SRT</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
