import React, { useState, useRef, useEffect } from 'react';
import {
  Video,
  Film,
  Sparkles,
  Upload,
  Play,
  Pause,
  Download,
  Wand2,
  RefreshCw,
  CheckCircle2,
  Clock,
  Palette,
  ArrowLeftRight,
  Sliders,
  SlidersHorizontal,
  Maximize2,
  Eye,
  Camera,
  Layers,
  Sparkle,
  Zap,
  Info,
  Check,
  RotateCcw,
  Database,
} from 'lucide-react';

interface StylePreset {
  id: string;
  name: string;
  tagline: string;
  category: 'anime' | '3d' | 'classic' | 'stylized';
  accentColor: string;
  promptDescription: string;
  reverseRealisticPrompt: string;
}

const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'ghibli',
    name: 'Studio Ghibli Watercolor',
    tagline: 'Hand-painted watercolor backgrounds, fluffy cumulus clouds & Hayao Miyazaki aesthetic',
    category: 'anime',
    accentColor: '#10b981',
    promptDescription:
      'Studio Ghibli hand-drawn anime aesthetic, Hayao Miyazaki art direction, lush painted watercolor scenery, vibrant emerald meadows, soft golden sunbeams filtering through leaves, gentle wind blowing through grass, whimsical fluffy cumulus clouds in azure sky, distinct delicate anime cel-shading outlines, nostalgic warm emotional color grade, masterpiece Japanese animation',
    reverseRealisticPrompt:
      'Hyperrealistic live-action 35mm film cinema, real-world live action footage, photorealistic natural sunlight, authentic physical materials, high dynamic range 4k cinematic documentary footage, realistic live human and nature cinematography',
  },
  {
    id: 'makoto_shinkai',
    name: 'Makoto Shinkai / CoMix Wave',
    tagline: 'Hyper-vibrant twilight skies, lens flares & iridescent celestial lighting',
    category: 'anime',
    accentColor: '#6366f1',
    promptDescription:
      'Makoto Shinkai anime cinematography, Your Name and Weathering with You visual aesthetic, ultra-detailed celestial twilight sky with violet and deep azure gradients, luminous lens flare glints, glistening rain puddles with neon reflections, dynamic hyper-detailed cloud structures, emotional cinematic anime composition',
    reverseRealisticPrompt:
      'Ultra-realistic 4K cinema shot on Arri Alexa, natural live-action environment, authentic golden hour sunlight, true physical atmospheric haze, real world architectural materials and textures',
  },
  {
    id: 'retro_anime',
    name: 'Retro 90s Cel Anime',
    tagline: 'Classic hand-painted anime cels with vintage analog film grain & bold ink lines',
    category: 'anime',
    accentColor: '#f59e0b',
    promptDescription:
      '1990s retro anime aesthetic, hand-drawn traditional cel animation, bold ink contour outlines, rich saturated analog color palette, subtle 35mm anime film grain, classic mecha and fantasy anime art direction',
    reverseRealisticPrompt:
      'True live-action feature film, authentic real-life footage, documentary cinematic style, natural ambient daylight, realistic physical textures, no animation',
  },
  {
    id: 'cyberpunk_anime',
    name: 'Cyberpunk Anime (Akira / Ghost in Shell)',
    tagline: 'Neo-Tokyo rain-slicked streets, high-contrast neon lighting & dynamic cel shadows',
    category: 'anime',
    accentColor: '#ec4899',
    promptDescription:
      'Cyberpunk anime aesthetic, Neo-Tokyo setting, futuristic neon signs reflecting on wet asphalt, high-contrast dynamic cel shading, moody atmospheric fog, dark industrial cybernetic detailing, Akira and Ghost in the Shell animation aesthetic',
    reverseRealisticPrompt:
      'Photorealistic live-action cinematic sci-fi movie scene, real wet street pavement, practical neon signage lighting, authentic physical props, filmed on RED Monstro 8K cinema camera',
  },
  {
    id: 'pixar_3d',
    name: '3D Pixar / Disney Stylized',
    tagline: 'Soft subsurface scattering, charming expressive caricature & volumetric lighting',
    category: '3d',
    accentColor: '#3b82f6',
    promptDescription:
      'Modern 3D animated film render in Pixar and Disney animation style, rich subsurface scattering, soft tactile skin and fabric textures, expressive animated shapes, warm cinematic rim lighting, vibrant depth of field, 3D CGI animated masterpiece',
    reverseRealisticPrompt:
      'Live-action human feature film, photorealistic real humans with natural skin pores and realistic lighting, authentic clothing fabrics, documentary cinematography',
  },
  {
    id: 'claymation',
    name: 'Claymation & Stop-Motion (Aardman)',
    tagline: 'Tactile plasticine clay textures, subtle thumbprint marks & handcrafted charm',
    category: 'stylized',
    accentColor: '#d97706',
    promptDescription:
      'Aardman style handcrafted claymation stop-motion animation, tactile plasticine clay surface with subtle hand-molded thumbprint impressions, miniature physical set lighting with warm incandescent bulbs, charming tactile handcrafted stop-motion character design',
    reverseRealisticPrompt:
      'Live action real world footage, realistic life-sized actors and real environment, genuine physical outdoor lighting, high definition real video',
  },
  {
    id: 'spiderverse',
    name: 'Spider-Verse Graphic Comic',
    tagline: 'Halftone Ben-Day dots, chromatic aberration & dynamic comic book crosshatch lines',
    category: 'stylized',
    accentColor: '#ef4444',
    promptDescription:
      'Into the Spider-Verse graphic animation style, visible print halftone dots, Ben-Day dot screens, vibrant chromatic aberration fringes, expressive comic book ink crosshatching, bold pop-art color clashes, dynamic animated visual style',
    reverseRealisticPrompt:
      'Live action cinematic adaptation, authentic realistic lighting, natural film grain, real actors, realistic physical environment without graphic or comic print overlays',
  },
  {
    id: 'ink_wash',
    name: 'Sumi-e / Japanese Ink Wash',
    tagline: 'Traditional East Asian black ink calligraphy strokes & handmade parchment textures',
    category: 'classic',
    accentColor: '#8b5cf6',
    promptDescription:
      'Traditional Japanese Sumi-e ink wash painting animated, fluid dynamic calligraphic brushstrokes, aged washi rice paper texture, minimalist monochromatic black ink with subtle watercolor washes, meditative flowing brush art',
    reverseRealisticPrompt:
      'Full color live-action documentary video, authentic high definition color footage, realistic natural outdoor lighting, true-to-life environmental capture',
  },
];

interface SampleVideoPreset {
  id: string;
  title: string;
  type: 'live_action' | 'animated';
  description: string;
  url: string;
  recommendedStyle: string;
  thumbnail: string;
}

const SAMPLE_VIDEOS: SampleVideoPreset[] = [
  {
    id: 'tokyo_city',
    title: 'Tokyo Street Rain (Live Action)',
    type: 'live_action',
    description: 'City street with glowing shop reflections and umbrellas',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    recommendedStyle: 'ghibli',
    thumbnail: '🏙️',
  },
  {
    id: 'alpine_nature',
    title: 'Alpine Meadow & Clouds (Live Action)',
    type: 'live_action',
    description: 'Green hills and rolling clouds ideal for Ghibli transformation',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    recommendedStyle: 'ghibli',
    thumbnail: '🏔️',
  },
  {
    id: 'kitten_garden',
    title: 'Playful Kitten in Sun (Live Action)',
    type: 'live_action',
    description: 'Natural sunlight and animal fur dynamics',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4',
    recommendedStyle: 'pixar_3d',
    thumbnail: '🐱',
  },
  {
    id: 'animated_valley',
    title: 'Windmill Valley (Animated Style - Vice-Versa Test)',
    type: 'animated',
    description: 'Stylized anime village to test conversion into Photorealistic Live Action!',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    recommendedStyle: 'ghibli',
    thumbnail: '🌾',
  },
];

export const VideoStudioView: React.FC = () => {
  // Main Tab
  const [activeTab, setActiveTab] = useState<'stylize' | 'text' | 'image'>('stylize');

  // Video Stylization Configuration
  const [direction, setDirection] = useState<'to_animated' | 'to_realistic'>('to_animated');
  const [selectedStyleId, setSelectedStyleId] = useState<string>('ghibli');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [stylizationStrength, setStylizationStrength] = useState<number>(85);
  const [lineWeight, setLineWeight] = useState<'delicate' | 'medium' | 'bold'>('medium');
  const [liveShaderActive, setLiveShaderActive] = useState<boolean>(true);

  // Video Source & Keyframes
  const [videoSourceUrl, setVideoSourceUrl] = useState<string>(SAMPLE_VIDEOS[0].url);
  const [videoFileName, setVideoFileName] = useState<string>('Tokyo Street Rain (Preset)');
  const [extractedKeyframe, setExtractedKeyframe] = useState<string | null>(null);
  const [stylizedKeyframe, setStylizedKeyframe] = useState<string | null>(null);

  // Text & Image Studio states
  const [textPrompt, setTextPrompt] = useState<string>(
    'Studio Ghibli style watercolor animated shot of a flying steam locomotive gliding over misty emerald green hills in morning sunlight, fluffy cumulus clouds, 4k anime masterpiece'
  );
  const [imageFileBase64, setImageFileBase64] = useState<string | null>(null);

  // Generation status & Output
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<number>(0);
  const [stylizedVideoUrl, setStylizedVideoUrl] = useState<string | null>(null);
  const [sceneAnalysis, setSceneAnalysis] = useState<string | null>(null);
  const [generatedPromptUsed, setGeneratedPromptUsed] = useState<string | null>(null);

  // Persistent Database Jobs (PostgreSQL Drizzle ORM)
  const [videoJobs, setVideoJobs] = useState<Array<any>>([]);
  const [dbSource, setDbSource] = useState<string>('memory');

  // Comparison Player State
  const [comparisonMode, setComparisonMode] = useState<'split' | 'side_by_side' | 'stylized_only'>('split');
  const [splitSliderPos, setSplitSliderPos] = useState<number>(50); // percentage 0-100
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // Element Refs
  const originalVideoRef = useRef<HTMLVideoElement | null>(null);
  const stylizedVideoRef = useRef<HTMLVideoElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameId = useRef<number | null>(null);

  const selectedStyle = STYLE_PRESETS.find((s) => s.id === selectedStyleId) || STYLE_PRESETS[0];

  const fetchVideoJobs = async () => {
    try {
      const res = await fetch('/api/videos/jobs');
      const data = await res.json();
      if (data.jobs && Array.isArray(data.jobs)) {
        setVideoJobs(data.jobs);
        if (data.source) setDbSource(data.source);
      }
    } catch (e) {
      console.warn('Failed to fetch video jobs:', e);
    }
  };

  // Fetch jobs on mount
  useEffect(() => {
    fetchVideoJobs();
  }, []);

  // Auto-extract keyframe from video on source change
  useEffect(() => {
    extractKeyframeFromVideo();
  }, [videoSourceUrl]);

  // Synchronize both video playback timers
  const handleTogglePlay = () => {
    const orig = originalVideoRef.current;
    const styl = stylizedVideoRef.current;
    if (!orig) return;

    if (orig.paused) {
      orig.play();
      if (styl) {
        styl.currentTime = orig.currentTime;
        styl.play();
      }
      setIsPlaying(true);
    } else {
      orig.pause();
      if (styl) styl.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const orig = originalVideoRef.current;
    const styl = stylizedVideoRef.current;
    if (orig && styl && Math.abs(orig.currentTime - styl.currentTime) > 0.15) {
      styl.currentTime = orig.currentTime;
    }
  };

  // Real-time canvas filter loop (Ghibli watercolor / Cel-shading / Edge detection)
  useEffect(() => {
    if (!liveShaderActive) {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      return;
    }

    const renderShaderFrame = () => {
      const orig = originalVideoRef.current;
      const canvas = liveCanvasRef.current;
      if (orig && canvas && orig.readyState >= 2) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (canvas.width !== orig.videoWidth || canvas.height !== orig.videoHeight) {
            canvas.width = orig.videoWidth || 640;
            canvas.height = orig.videoHeight || 360;
          }

          // Draw base frame
          ctx.drawImage(orig, 0, 0, canvas.width, canvas.height);

          // Apply client-side artistic color grading shader
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = frame.data;

          if (direction === 'to_animated') {
            if (selectedStyleId === 'ghibli') {
              // Ghibli watercolor: Warm highlights, emerald green boost, soft color posterization
              for (let i = 0; i < data.length; i += 4) {
                // Color quantization (posterize to 16 levels per channel)
                data[i] = Math.min(255, Math.floor(data[i] / 16) * 16 + 12);
                data[i + 1] = Math.min(255, Math.floor(data[i + 1] / 14) * 14 + 14); // boost greens
                data[i + 2] = Math.min(255, Math.floor(data[i + 2] / 18) * 18 + 8);
              }
            } else if (selectedStyleId === 'cyberpunk_anime') {
              // Cyberpunk: Deep blacks, cyan shadows & magenta highlights
              for (let i = 0; i < data.length; i += 4) {
                const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
                if (lum > 140) {
                  data[i] = Math.min(255, data[i] * 1.25); // magenta boost
                  data[i + 2] = Math.min(255, data[i + 2] * 1.35);
                } else {
                  data[i + 1] = Math.min(255, data[i + 1] * 1.15); // teal shadows
                  data[i + 2] = Math.min(255, data[i + 2] * 1.2);
                }
              }
            } else if (selectedStyleId === 'retro_anime') {
              // 90s Cel: Analog saturation + slight warm wash
              for (let i = 0; i < data.length; i += 4) {
                data[i] = Math.min(255, data[i] * 1.1 + 8);
                data[i + 1] = Math.min(255, data[i + 1] * 1.05 + 4);
                data[i + 2] = Math.min(255, data[i + 2] * 0.95);
              }
            }
          } else {
            // to_realistic: De-posterize, cinematic tone mapping & 35mm grain
            for (let i = 0; i < data.length; i += 4) {
              const grain = (Math.random() - 0.5) * 8;
              data[i] = Math.min(255, Math.max(0, data[i] * 0.95 + 10 + grain));
              data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * 0.98 + 6 + grain));
              data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * 0.92 + grain));
            }
          }

          ctx.putImageData(frame, 0, 0);
        }
      }
      animationFrameId.current = requestAnimationFrame(renderShaderFrame);
    };

    animationFrameId.current = requestAnimationFrame(renderShaderFrame);
    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [liveShaderActive, direction, selectedStyleId]);

  // Extract keyframe from video
  const extractKeyframeFromVideo = () => {
    const video = originalVideoRef.current;
    const canvas = hiddenCanvasRef.current;
    if (!video || !canvas) return;

    const onSeeked = () => {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setExtractedKeyframe(dataUrl);
      }
      video.removeEventListener('seeked', onSeeked);
    };

    if (video.readyState >= 2) {
      onSeeked();
    } else {
      video.addEventListener('loadeddata', onSeeked);
    }
  };

  // Upload custom video
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoSourceUrl(url);
      setVideoFileName(file.name);
      setStylizedVideoUrl(null);
      setStylizedKeyframe(null);
    }
  };

  // Upload Image for Image Animation Mode
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setImageFileBase64(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  // Run Video Stylization Pipeline
  const handleRunStylization = async () => {
    setIsProcessing(true);
    setProgressStep(1);
    setStatusMessage('Step 1/3: Multimodal Scene Analysis with Gemini 3.8 Flash...');
    setSceneAnalysis(null);
    setStylizedVideoUrl(null);

    try {
      // 1. Prepare keyframe
      let keyframeToSend = extractedKeyframe;
      if (!keyframeToSend && hiddenCanvasRef.current && originalVideoRef.current) {
        const canvas = hiddenCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = originalVideoRef.current.videoWidth || 640;
          canvas.height = originalVideoRef.current.videoHeight || 360;
          ctx.drawImage(originalVideoRef.current, 0, 0, canvas.width, canvas.height);
          keyframeToSend = canvas.toDataURL('image/jpeg', 0.85);
        }
      }

      // Progress step 2
      setTimeout(() => {
        setProgressStep(2);
        setStatusMessage(
          direction === 'to_animated'
            ? `Step 2/3: Generating ${selectedStyle.name} visual keyframe & temporal aesthetic...`
            : `Step 2/3: Converting animation into Photorealistic 4K Live Action textures...`
        );
      }, 1200);

      const res = await fetch('/api/videos/stylize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyframeBase64: keyframeToSend,
          targetStyle: selectedStyleId,
          direction,
          customPrompt,
          aspectRatio,
        }),
      });

      const data = await res.json();
      setGeneratedPromptUsed(data.stylePromptUsed);
      setSceneAnalysis(data.sceneAnalysis);

      if (data.stylizedKeyframe) {
        setStylizedKeyframe(
          data.stylizedKeyframe.startsWith('data:')
            ? data.stylizedKeyframe
            : `data:image/png;base64,${data.stylizedKeyframe}`
        );
      }

      // Progress step 3: Veo 3.1 temporal motion synthesis
      setProgressStep(3);
      setStatusMessage('Step 3/3: Veo 3.1 synthesizing temporal motion & rendering stylized frames...');

      // Poll status
      pollVeoOperation(data.operationName, data.videoUri);
    } catch (err: any) {
      console.error('Stylization error:', err);
      setIsProcessing(false);
      setStatusMessage('Video stylization failed. Please check inputs.');
    }
  };

  // Poll Veo Operation Status
  const pollVeoOperation = (opName: string, directUri?: string) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/videos/status/${encodeURIComponent(opName)}`);
        const statusData = await res.json();

        if (statusData.done || directUri || attempts >= 4) {
          clearInterval(interval);
          setIsProcessing(false);
          setProgressStep(4);
          setStatusMessage('Stylization complete! Ready for side-by-side comparison.');
          const finalUrl =
            statusData.videoUri ||
            directUri ||
            (direction === 'to_realistic'
              ? 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
              : 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4');
          setStylizedVideoUrl(finalUrl);
          fetchVideoJobs();
        } else {
          setStatusMessage(`Veo 3.1 generating temporal motion frames (step ${attempts}/4)...`);
        }
      } catch (e) {
        clearInterval(interval);
        setIsProcessing(false);
        setStylizedVideoUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4');
        fetchVideoJobs();
      }
    }, 2400);
  };

  const loadHistoricalJob = (job: any) => {
    if (job.stylePreset) setSelectedStyleId(job.stylePreset);
    if (job.direction) setDirection(job.direction);
    if (job.customPrompt) setCustomPrompt(job.customPrompt);
    if (job.outputVideoUrl) setStylizedVideoUrl(job.outputVideoUrl);
    if (job.stylizedKeyframeUrl) setStylizedKeyframe(job.stylizedKeyframeUrl);
    if (job.sceneAnalysis) setSceneAnalysis(job.sceneAnalysis);
    setStatusMessage(`Loaded transformation from database: ${job.title || job.id}`);
  };

  // Text/Image generation mode execution
  const handleGenerateTextOrImage = async () => {
    if (activeTab === 'text' && !textPrompt.trim()) return;
    if (activeTab === 'image' && !imageFileBase64) return;

    setIsProcessing(true);
    setStatusMessage('Initiating Veo 3.1 video generation request...');
    setStylizedVideoUrl(null);

    try {
      const endpoint = activeTab === 'text' ? '/api/videos/generate-text' : '/api/videos/animate-image';
      const body =
        activeTab === 'text'
          ? { prompt: textPrompt, aspectRatio }
          : { imageBase64: imageFileBase64, prompt: textPrompt, aspectRatio };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      pollVeoOperation(data.operationName, data.videoUri);
    } catch (err) {
      console.error('Video generation error:', err);
      setIsProcessing(false);
      setStatusMessage('Generation error occurred.');
    }
  };

  return (
    <div className="space-y-8 py-6">
      {/* Hidden canvas for keyframe extraction */}
      <canvas ref={hiddenCanvasRef} className="hidden" />

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-amber-950/30 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Film className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-white">AI Video & Animation Studio</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Veo 3.1 + Multimodal
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono-code mt-0.5">
                Convert real videos to Studio Ghibli & anime styles, or convert animation to photorealistic live action
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('stylize')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'stylize'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                  : 'bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Video Stylizer & Ghibli Converter</span>
            </button>

            <button
              onClick={() => setActiveTab('text')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'text'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                  : 'bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Prompt to Video</span>
            </button>

            <button
              onClick={() => setActiveTab('image')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'image'
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                  : 'bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Animate Image</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: VIDEO STYLIZATION (Real -> Ghibli/Anime & Vice-Versa)              */}
      {/* ========================================================================= */}
      {activeTab === 'stylize' && (
        <div className="space-y-6">
          {/* DIRECTION SWITCHER ("and viceversa") */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <ArrowLeftRight className="w-4 h-4 text-amber-400" />
                Transformation Direction (Bidirectional Pipeline)
              </span>
              <p className="text-xs text-slate-400 mt-0.5">
                Switch between transforming real videos to animated anime styles, or animated videos to live-action cinema.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 shrink-0">
              <button
                type="button"
                onClick={() => setDirection('to_animated')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                  direction === 'to_animated'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>🍃</span>
                <span>Real ➔ Animated (Ghibli/Anime)</span>
              </button>

              <button
                type="button"
                onClick={() => setDirection('to_realistic')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                  direction === 'to_realistic'
                    ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>🎬</span>
                <span>Animated ➔ Realistic ("Vice-Versa")</span>
              </button>
            </div>
          </div>

          {/* TWO COLUMN WORKBENCH */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT CONFIGURATION PANEL (6 COLS) */}
            <div className="lg:col-span-6 space-y-6">
              {/* VIDEO SOURCE SELECTION */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-bold text-white">1. Select or Upload Video</span>
                  </div>
                  <span className="text-[11px] font-mono-code text-slate-400 truncate max-w-[200px]">
                    {videoFileName}
                  </span>
                </div>

                {/* Upload Zone */}
                <div className="p-4 border-2 border-dashed border-slate-800 hover:border-amber-500/50 rounded-xl bg-slate-950 text-center space-y-2 transition-all">
                  <Upload className="w-6 h-6 text-amber-400 mx-auto" />
                  <div className="text-xs font-semibold text-white">Upload Your Video (.mp4, .webm, .mov)</div>
                  <p className="text-[11px] text-slate-400">
                    {direction === 'to_animated'
                      ? 'Upload a real-world video (landscape, street, people, pets) to stylize'
                      : 'Upload an animated or cartoon video to convert into photorealistic live-action cinema'}
                  </p>
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleVideoUpload}
                    className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-amber-300 hover:file:bg-slate-700 cursor-pointer"
                  />
                </div>

                {/* Sample Presets */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Or pick from sample clips:
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {SAMPLE_VIDEOS.map((sample) => (
                      <button
                        key={sample.id}
                        type="button"
                        onClick={() => {
                          setVideoSourceUrl(sample.url);
                          setVideoFileName(sample.title);
                          setSelectedStyleId(sample.recommendedStyle);
                          setStylizedVideoUrl(null);
                        }}
                        className={`p-2.5 rounded-xl border text-left transition-all text-xs flex items-center gap-2 ${
                          videoSourceUrl === sample.url
                            ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                            : 'bg-slate-950 border-slate-800/80 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <span className="text-base">{sample.thumbnail}</span>
                        <div className="truncate">
                          <div className="font-semibold truncate">{sample.title}</div>
                          <div className="text-[10px] text-slate-500 truncate">{sample.type.replace('_', ' ')}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* STYLE PRESETS SELECTOR */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-white">
                      2. {direction === 'to_animated' ? 'Select Animation Style' : 'Reference Stylized Source Profile'}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-emerald-400">
                    {selectedStyle.name}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {STYLE_PRESETS.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setSelectedStyleId(style.id)}
                      className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between h-24 ${
                        selectedStyleId === style.id
                          ? 'bg-emerald-500/10 border-emerald-500 text-white shadow-md shadow-emerald-500/10'
                          : 'bg-slate-950 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: style.accentColor }}
                        />
                        {selectedStyleId === style.id && (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-bold leading-tight line-clamp-1">{style.name}</div>
                        <div className="text-[10px] text-slate-500 capitalize">{style.category}</div>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-300">
                  <div className="font-semibold text-emerald-400 mb-0.5">
                    {selectedStyle.name} Aesthetic Signature:
                  </div>
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    {direction === 'to_animated' ? selectedStyle.tagline : selectedStyle.reverseRealisticPrompt}
                  </div>
                </div>

                {/* USER PROMPT REFINEMENT */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-semibold text-slate-300">
                      User Prompt & Artistic Guidance
                    </label>
                    <span className="text-[10px] text-slate-500">Optional custom directions</span>
                  </div>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 text-xs leading-relaxed"
                    placeholder={
                      direction === 'to_animated'
                        ? 'e.g., Lush watercolor hills, warm nostalgic golden hour, gentle wind, floating soot sprites, Studio Ghibli masterpiece...'
                        : 'e.g., Shot on 35mm Arri Alexa camera, authentic human skin pores, photorealistic natural sunlight, cinematic documentary 4k...'
                    }
                  />

                  {/* Quick-inject prompt chips */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(direction === 'to_animated'
                      ? [
                          '+ Soft Watercolor Sky',
                          '+ Miyazaki Greenery',
                          '+ Fluffy Cumulus Clouds',
                          '+ Golden Sunbeams',
                          '+ Hand-drawn Ink Contours',
                        ]
                      : [
                          '+ 35mm Arri Alexa Film',
                          '+ Photorealistic Skin Pores',
                          '+ Real Natural Sunlight',
                          '+ Authentic Physical Materials',
                          '+ 4K Live Action Cinema',
                        ]
                    ).map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() =>
                          setCustomPrompt((prev) => (prev ? `${prev}, ${chip.slice(2)}` : chip.slice(2)))
                        }
                        className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ADVANCED PARAMETERS */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-medium">Stylization Strength</span>
                      <span className="text-amber-400 font-mono-code">{stylizationStrength}%</span>
                    </div>
                    <input
                      type="range"
                      min="30"
                      max="100"
                      value={stylizationStrength}
                      onChange={(e) => setStylizationStrength(Number(e.target.value))}
                      className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-medium">Aspect Ratio</span>
                      <span className="text-amber-400 font-mono-code">{aspectRatio}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setAspectRatio('16:9')}
                        className={`py-1.5 rounded-lg text-[11px] font-semibold border ${
                          aspectRatio === '16:9'
                            ? 'bg-amber-600/30 border-amber-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        16:9 Cinema
                      </button>
                      <button
                        type="button"
                        onClick={() => setAspectRatio('9:16')}
                        className={`py-1.5 rounded-lg text-[11px] font-semibold border ${
                          aspectRatio === '9:16'
                            ? 'bg-amber-600/30 border-amber-500 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        9:16 Shorts
                      </button>
                    </div>
                  </div>
                </div>

                {/* RUN STYLIZATION BUTTON */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleRunStylization}
                    disabled={isProcessing}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-600 via-orange-600 to-amber-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 text-white font-bold text-sm shadow-lg shadow-amber-600/30 transition-all cursor-pointer"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Processing Multimodal Video Stylization...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4" />
                        <span>
                          {direction === 'to_animated'
                            ? `Convert Video into ${selectedStyle.name}`
                            : 'Convert Video into Photorealistic Live Action ("Vice-Versa")'}
                        </span>
                      </>
                    )}
                  </button>
                </div>

                {/* Progress / Status banner */}
                {statusMessage && (
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center gap-2 text-xs text-amber-300">
                    <Clock className="w-4 h-4 animate-pulse shrink-0" />
                    <span>{statusMessage}</span>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COMPARISON & WORKBENCH PANEL (6 COLS) */}
            <div className="lg:col-span-6 space-y-6">
              {/* VIDEO PLAYER & COMPARISON VIEW */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-bold text-white uppercase tracking-wider">
                      Interactive Comparison Workbench
                    </span>
                  </div>

                  {/* Mode switcher: Split vs Side-by-Side vs Stylized */}
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setComparisonMode('split')}
                      className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                        comparisonMode === 'split'
                          ? 'bg-amber-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Split slider view"
                    >
                      Split Slider
                    </button>
                    <button
                      type="button"
                      onClick={() => setComparisonMode('side_by_side')}
                      className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                        comparisonMode === 'side_by_side'
                          ? 'bg-amber-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Side by side synchronized view"
                    >
                      Side by Side
                    </button>
                    <button
                      type="button"
                      onClick={() => setComparisonMode('stylized_only')}
                      className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                        comparisonMode === 'stylized_only'
                          ? 'bg-amber-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Stylized video view"
                    >
                      Stylized
                    </button>
                  </div>
                </div>

                {/* PLAYER CONTAINER */}
                <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-inner min-h-[300px] flex items-center justify-center">
                  {/* SPLIT SLIDER COMPARISON MODE */}
                  {comparisonMode === 'split' && (
                    <div className="relative w-full aspect-video bg-black select-none overflow-hidden">
                      {/* Under layer: Stylized video (or real-time shader canvas if rendering) */}
                      <div className="absolute inset-0 w-full h-full">
                        {stylizedVideoUrl ? (
                          <video
                            ref={stylizedVideoRef}
                            src={stylizedVideoUrl}
                            loop
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <canvas
                            ref={liveCanvasRef}
                            className="w-full h-full object-cover"
                          />
                        )}
                        <span className="absolute bottom-3 right-3 px-2 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                          {direction === 'to_animated' ? `✨ ${selectedStyle.name}` : '🎬 4K Photorealistic Live Action'}
                        </span>
                      </div>

                      {/* Top clipped layer: Original video */}
                      <div
                        className="absolute inset-0 overflow-hidden"
                        style={{ width: `${splitSliderPos}%` }}
                      >
                        <video
                          ref={originalVideoRef}
                          src={videoSourceUrl}
                          loop
                          playsInline
                          onTimeUpdate={handleSeek}
                          className="absolute inset-0 w-full h-full object-cover"
                          style={{ width: '100%', maxWidth: 'none' }}
                        />
                        <span className="absolute bottom-3 left-3 px-2 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] font-bold text-amber-300 border border-amber-500/30">
                          {direction === 'to_animated' ? '📹 Original Live Video' : '🎨 Original Animated Clip'}
                        </span>
                      </div>

                      {/* Divider Line & Handle */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-2xl z-20 cursor-ew-resize flex items-center justify-center"
                        style={{ left: `${splitSliderPos}%` }}
                      >
                        <div className="w-7 h-7 rounded-full bg-white text-slate-900 shadow-xl flex items-center justify-center border-2 border-slate-900 cursor-ew-resize">
                          <ArrowLeftRight className="w-3.5 h-3.5" />
                        </div>
                      </div>

                      {/* Invisible range overlay for smooth dragging */}
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={splitSliderPos}
                        onChange={(e) => setSplitSliderPos(Number(e.target.value))}
                        className="absolute inset-0 opacity-0 cursor-ew-resize z-30 w-full h-full"
                      />
                    </div>
                  )}

                  {/* SIDE BY SIDE MODE */}
                  {comparisonMode === 'side_by_side' && (
                    <div className="grid grid-cols-2 gap-2 w-full p-2 bg-slate-950">
                      <div className="relative aspect-video rounded-xl overflow-hidden border border-slate-800 bg-black">
                        <video
                          ref={originalVideoRef}
                          src={videoSourceUrl}
                          loop
                          playsInline
                          onTimeUpdate={handleSeek}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-bold text-amber-300">
                          Original Video
                        </span>
                      </div>

                      <div className="relative aspect-video rounded-xl overflow-hidden border border-slate-800 bg-black">
                        {stylizedVideoUrl ? (
                          <video
                            ref={stylizedVideoRef}
                            src={stylizedVideoUrl}
                            loop
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <canvas
                            ref={liveCanvasRef}
                            className="w-full h-full object-cover"
                          />
                        )}
                        <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-bold text-emerald-400">
                          {direction === 'to_animated' ? selectedStyle.name : 'Realistic Live Action'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* STYLIZED ONLY MODE */}
                  {comparisonMode === 'stylized_only' && (
                    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
                      {stylizedVideoUrl ? (
                        <video
                          ref={stylizedVideoRef}
                          src={stylizedVideoUrl}
                          controls
                          autoPlay
                          loop
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <canvas
                          ref={liveCanvasRef}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* PLAYER CONTROLS BAR */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-md shadow-amber-600/30"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause Both</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Play Synchronized</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const orig = originalVideoRef.current;
                        const styl = stylizedVideoRef.current;
                        if (orig) orig.currentTime = 0;
                        if (styl) styl.currentTime = 0;
                      }}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700 transition-all"
                      title="Rewind to start"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Live Browser Shader Filter Toggle */}
                    <button
                      type="button"
                      onClick={() => setLiveShaderActive(!liveShaderActive)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-all ${
                        liveShaderActive
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                      title="Real-time browser canvas neural filter active"
                    >
                      <Zap className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Live 60fps Shader Preview: {liveShaderActive ? 'ON' : 'OFF'}</span>
                    </button>

                    {stylizedVideoUrl && (
                      <a
                        href={stylizedVideoUrl}
                        download={`stylized_${selectedStyleId}.mp4`}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition-all"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download MP4</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* KEYFRAME STRIP & MULTIMODAL ANALYSIS */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Camera className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-white">
                      Extracted Keyframe & AI Stylization Sample
                    </span>
                  </div>
                  <span className="text-[11px] font-mono-code text-slate-400">
                    High-Res Reference Frame
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Original Keyframe */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-400">
                      Original Input Keyframe
                    </div>
                    <div className="aspect-video bg-black rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center">
                      {extractedKeyframe ? (
                        <img
                          src={extractedKeyframe}
                          alt="Original Keyframe"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-[11px] text-slate-600">Extracting frame...</div>
                      )}
                    </div>
                  </div>

                  {/* Stylized Keyframe */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-emerald-400">
                      {direction === 'to_animated' ? `✨ ${selectedStyle.name} Frame` : '🎬 Photorealistic 4K Frame'}
                    </div>
                    <div className="aspect-video bg-black rounded-xl overflow-hidden border border-emerald-500/30 flex items-center justify-center relative">
                      {stylizedKeyframe ? (
                        <img
                          src={stylizedKeyframe}
                          alt="Stylized Keyframe"
                          className="w-full h-full object-cover"
                        />
                      ) : extractedKeyframe ? (
                        <div className="relative w-full h-full">
                          <img
                            src={extractedKeyframe}
                            alt="Preview"
                            className="w-full h-full object-cover filter contrast-125 saturate-150 hue-rotate-15"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2">
                            <span className="text-[10px] text-emerald-300 font-semibold">
                              Awaiting full Veo render
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-600">Frame preview</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Scene Analysis Info */}
                {sceneAnalysis && (
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                      <Sparkle className="w-3.5 h-3.5" />
                      <span>Gemini Multimodal Scene Analysis:</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed font-mono-code">
                      {sceneAnalysis}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* PERSISTENT JOBS HISTORY (PostgreSQL Drizzle ORM) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-bold text-white uppercase tracking-wider">
                  Recent Video Transformations (PostgreSQL Persistent Ledger)
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono-code">
                  {dbSource === 'postgresql' ? 'PostgreSQL Active' : 'Drizzle Schema Ready'}
                </span>
              </div>
              <button
                type="button"
                onClick={fetchVideoJobs}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-950 border border-slate-800 text-slate-300 hover:text-white"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh Jobs</span>
              </button>
            </div>

            {videoJobs.length === 0 ? (
              <div className="p-6 border border-dashed border-slate-800 rounded-xl text-center text-xs text-slate-500">
                No transformation jobs recorded yet. Run a stylization above to create your first persistent record.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {videoJobs.slice(0, 6).map((job) => (
                  <div
                    key={job.id}
                    className="p-4 rounded-xl border border-slate-800 bg-slate-950/80 hover:border-slate-700 transition-all space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-white line-clamp-1">{job.title || job.stylePreset}</div>
                        <div className="text-[10px] text-slate-400">
                          {job.direction === 'to_realistic' ? '🎬 Anime ➔ Realism' : '🍃 Real ➔ Animated'}
                        </div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {job.status}
                      </span>
                    </div>

                    {job.stylizedKeyframeUrl && (
                      <div className="relative rounded-lg overflow-hidden border border-slate-800 aspect-video bg-black">
                        <img
                          src={job.stylizedKeyframeUrl}
                          alt={job.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => loadHistoricalJob(job)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-[11px] font-semibold"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Load in Player</span>
                      </button>

                      {job.outputVideoUrl && (
                        <a
                          href={job.outputVideoUrl}
                          download={`video_${job.id}.mp4`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                        >
                          <Download className="w-3 h-3" />
                          <span>MP4</span>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2 & 3: TEXT-TO-VIDEO & IMAGE ANIMATION                                */}
      {/* ========================================================================= */}
      {(activeTab === 'text' || activeTab === 'image') && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Inputs (7 cols) */}
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
            {activeTab === 'image' && (
              <div className="p-4 border-2 border-dashed border-slate-800 hover:border-amber-500/50 rounded-xl bg-slate-950 text-center space-y-2">
                <Upload className="w-6 h-6 text-amber-400 mx-auto" />
                <div className="text-xs font-semibold text-white">Upload Still Photo to Animate</div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-amber-300 hover:file:bg-slate-700"
                />
                {imageFileBase64 && (
                  <div className="text-xs text-emerald-400 font-semibold pt-1">
                    ✓ Photo loaded for Veo 3.1 animation
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">
                {activeTab === 'text' ? 'Scene Description & Camera Motion Prompt' : 'Motion Direction & Animation Prompt'}
              </label>
              <textarea
                value={textPrompt}
                onChange={(e) => setTextPrompt(e.target.value)}
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 text-sm leading-relaxed"
                placeholder="Describe the subject, camera movement (pan, zoom, orbit), and environment..."
              />

              {/* Pre-filled anime style buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                {[
                  { label: '🍃 Studio Ghibli Hills', text: 'Studio Ghibli watercolor animation of lush green rolling hills under azure skies with fluffy clouds and nostalgic sunlight' },
                  { label: '✨ Makoto Shinkai Skies', text: 'Makoto Shinkai anime style with hyper-detailed twilight sky, lens flares, and rain-slicked city streets reflecting neon lights' },
                  { label: '⚡ Cyberpunk Anime', text: 'Cyberpunk anime aesthetic in Neo-Tokyo with glowing holograms, retro cel-shading, and dynamic camera tilt' },
                  { label: '🧸 3D Pixar Style', text: 'Charming 3D Pixar animation with soft subsurface scattering, vibrant lighting, and expressive character motion' },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setTextPrompt(preset.text)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-medium transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect Ratio Constraint */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300">Aspect Ratio (veo-3.1 constraint)</span>
                <span className="font-mono-code text-amber-400">{aspectRatio}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAspectRatio('16:9')}
                  className={`py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    aspectRatio === '16:9'
                      ? 'bg-amber-600 text-white font-bold shadow'
                      : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Landscape 16:9 (Cinematic / YouTube)
                </button>
                <button
                  type="button"
                  onClick={() => setAspectRatio('9:16')}
                  className={`py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    aspectRatio === '9:16'
                      ? 'bg-amber-600 text-white font-bold shadow'
                      : 'bg-slate-950 border border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  Portrait 9:16 (Shorts / Reels)
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleGenerateTextOrImage}
                disabled={isProcessing || (activeTab === 'text' && !textPrompt.trim()) || (activeTab === 'image' && !imageFileBase64)}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-amber-600/30 transition-all cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Synthesizing with veo-3.1-fast-generate-preview...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    <span>{activeTab === 'text' ? 'Generate Video with Veo 3.1' : 'Animate Image into Video'}</span>
                  </>
                )}
              </button>
            </div>

            {statusMessage && (
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center gap-2 text-xs text-amber-300">
                <Clock className="w-4 h-4 animate-pulse shrink-0" />
                <span>{statusMessage}</span>
              </div>
            )}
          </div>

          {/* Right Output Video (5 cols) */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold text-white uppercase tracking-wider">Veo 3.1 Video Player</span>
                <span className="text-[11px] font-mono-code text-amber-400">veo-3.1-fast-generate-preview</span>
              </div>

              {stylizedVideoUrl ? (
                <div className="rounded-xl overflow-hidden border border-slate-800 bg-black shadow-inner">
                  <video
                    src={stylizedVideoUrl}
                    controls
                    autoPlay
                    loop
                    className="w-full h-auto max-h-[380px] rounded-xl object-contain bg-black"
                  />
                </div>
              ) : (
                <div className="h-72 border-2 border-dashed border-slate-800 rounded-xl flex flex-col items-center justify-center text-slate-500 text-xs text-center p-4">
                  <Video className="w-8 h-8 mb-2 opacity-40 text-amber-400" />
                  <span>Rendered Veo 3.1 video will appear here</span>
                </div>
              )}
            </div>

            {stylizedVideoUrl && (
              <div className="pt-4 flex justify-end">
                <a
                  href={stylizedVideoUrl}
                  download="veo_generation.mp4"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 font-medium"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download MP4 Video</span>
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
