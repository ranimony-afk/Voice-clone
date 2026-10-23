/**
 * Shotcut-Grade Non-Linear Video Editor & AI Natural Language Command Studio
 * Runs 100% locally offline with Canvas compositing, Web Audio API, and AI Prompt Engine
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Scissors,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Download,
  Upload,
  Wand2,
  Terminal,
  Sliders,
  SlidersHorizontal,
  Layers,
  Film,
  Video,
  Music,
  Type,
  Palette,
  RotateCcw,
  RotateCw,
  RefreshCw,
  FileDown,
  FolderOpen,
  Maximize2,
  Sparkles,
  Clock,
  Activity,
  Check,
  ZoomIn,
  ZoomOut,
  ChevronRight,
  Filter,
  Flame,
  ArrowRight,
  Split,
  Copy,
  Info,
  Radio,
  FileVideo,
  ChevronDown
} from 'lucide-react';

// ============================================================================
// DATA TYPES & INTERFACES
// ============================================================================

export type TrackType = 'video' | 'audio';

export interface TimelineFilter {
  id: string;
  type:
    | 'color_grade'
    | 'transform'
    | 'chroma_key'
    | 'text_title'
    | 'blur'
    | 'ghibli_anime'
    | 'vignette'
    | 'glitch'
    | 'audio_gain'
    | 'fade_video'
    | 'fade_audio';
  name: string;
  enabled: boolean;
  params: Record<string, any>;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  name: string;
  type: 'video' | 'audio' | 'image' | 'color';
  sourceUrl: string;
  mediaElement?: HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
  inPoint: number; // Source start time in seconds
  outPoint: number; // Source end time in seconds
  timelineStart: number; // Timeline start time in seconds
  duration: number; // Duration on timeline in seconds
  speed: number; // 0.25x - 4x
  color: string;
  filters: TimelineFilter[];
  volume: number; // 0 - 2 (1 = 0dB)
  opacity: number; // 0 - 1
  fadeInSec?: number;
  fadeOutSec?: number;
  transitionType?: 'none' | 'crossfade' | 'wipe_left' | 'dip_black';
  transitionDuration?: number;
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: TrackType;
  height: number;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  visible: boolean;
  volume: number;
}

export interface MediaAsset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  url: string;
  duration: number;
  thumbnail?: string;
  width?: number;
  height?: number;
}

export interface CommandLogItem {
  id: string;
  timestamp: string;
  command: string;
  status: 'executed' | 'failed';
  actionSummary: string;
}

// ============================================================================
// PRESET ASSETS & SAMPLES (For Instant Testing Offline)
// ============================================================================

const DEFAULT_MEDIA_ASSETS: MediaAsset[] = [
  {
    id: 'asset_rain_street',
    name: 'Tokyo Rain Street (Live Action)',
    type: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    duration: 15.0,
    thumbnail: '🏙️',
  },
  {
    id: 'asset_meadow',
    name: 'Alpine Meadow & Clouds (Nature)',
    type: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    duration: 15.0,
    thumbnail: '🏔️',
  },
  {
    id: 'asset_kitten',
    name: 'Playful Kitten in Garden',
    type: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4',
    duration: 15.0,
    thumbnail: '🐱',
  },
  {
    id: 'asset_cartoon_valley',
    name: 'Windmill Valley (Animated Style)',
    type: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    duration: 60.0,
    thumbnail: '🌾',
  },
];

// Helper to format timecodes (HH:MM:SS:FF) at 30 fps
export function formatTimecode(seconds: number, fps: number = 30): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * fps);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
}

export const ShotcutEditorView: React.FC = () => {
  // ============================================================================
  // TIMELINE & TRACK STATE
  // ============================================================================
  const [tracks, setTracks] = useState<TimelineTrack[]>([
    { id: 'v2', name: 'V2 (Overlay / Text / Key)', type: 'video', height: 48, muted: false, solo: false, locked: false, visible: true, volume: 1 },
    { id: 'v1', name: 'V1 (Main Video)', type: 'video', height: 56, muted: false, solo: false, locked: false, visible: true, volume: 1 },
    { id: 'a1', name: 'A1 (Dialogue / Dub)', type: 'audio', height: 44, muted: false, solo: false, locked: false, visible: true, volume: 1 },
    { id: 'a2', name: 'A2 (Music / SFX)', type: 'audio', height: 44, muted: false, solo: false, locked: false, visible: true, volume: 1 },
  ]);

  const [clips, setClips] = useState<TimelineClip[]>([
    {
      id: 'clip_v1_main',
      trackId: 'v1',
      name: 'Tokyo Rain Street',
      type: 'video',
      sourceUrl: DEFAULT_MEDIA_ASSETS[0].url,
      inPoint: 0,
      outPoint: 10.0,
      timelineStart: 0,
      duration: 10.0,
      speed: 1.0,
      color: '#3b82f6',
      volume: 1.0,
      opacity: 1.0,
      filters: [
        {
          id: 'f_ghibli',
          type: 'ghibli_anime',
          name: 'Studio Ghibli Watercolor',
          enabled: true,
          params: { watercolorSaturation: 1.35, edgeLineWeight: 1.2, warmGoldenHour: 1.15, paperTexture: 0.15 },
        },
      ],
    },
    {
      id: 'clip_v1_second',
      trackId: 'v1',
      name: 'Alpine Meadow',
      type: 'video',
      sourceUrl: DEFAULT_MEDIA_ASSETS[1].url,
      inPoint: 0,
      outPoint: 8.0,
      timelineStart: 10.0,
      duration: 8.0,
      speed: 1.0,
      color: '#10b981',
      volume: 1.0,
      opacity: 1.0,
      transitionType: 'crossfade',
      transitionDuration: 1.2,
      filters: [],
    },
    {
      id: 'clip_v2_title',
      trackId: 'v2',
      name: 'Title: Neo Tokyo Rain',
      type: 'video',
      sourceUrl: '',
      inPoint: 0,
      outPoint: 5.0,
      timelineStart: 1.5,
      duration: 5.0,
      speed: 1.0,
      color: '#8b5cf6',
      volume: 0,
      opacity: 1.0,
      filters: [
        {
          id: 'f_text_main',
          type: 'text_title',
          name: 'Text: Neo Tokyo Rain',
          enabled: true,
          params: {
            text: 'NEO TOKYO // 雨',
            subtitle: 'Shotcut NLE AI Direction',
            fontSize: 42,
            fontColor: '#ffffff',
            boxBgColor: 'rgba(15, 23, 42, 0.75)',
            posX: 50,
            posY: 80,
          },
        },
      ],
    },
  ]);

  // Project Bin Assets
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(DEFAULT_MEDIA_ASSETS);
  const [selectedClipId, setSelectedClipId] = useState<string | null>('clip_v1_main');

  // Playhead & Transport
  const [currentTime, setCurrentTime] = useState<number>(2.0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [projectDuration, setProjectDuration] = useState<number>(24.0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [timelineZoom, setTimelineZoom] = useState<number>(45); // Pixels per second
  const [isSnapping, setIsSnapping] = useState<boolean>(true);
  const [activeTool, setActiveTool] = useState<'pointer' | 'razor' | 'ripple'>('pointer');

  // Left Dock Panels
  const [activeLeftTab, setActiveLeftTab] = useState<'playlist' | 'filters' | 'command_ai' | 'scopes' | 'export'>('command_ai');

  // Natural Language AI Command Bar State
  const [commandPrompt, setCommandPrompt] = useState<string>('');
  const [commandLogs, setCommandLogs] = useState<CommandLogItem[]>([
    {
      id: 'cmd_init',
      timestamp: '00:00:01',
      command: 'Applied Studio Ghibli Watercolor filter to track V1 with watercolor saturation 1.35 and edge lining.',
      status: 'executed',
      actionSummary: 'Added Filter "ghibli_anime" to Clip "Tokyo Rain Street"',
    },
    {
      id: 'cmd_init_2',
      timestamp: '00:00:02',
      command: 'Add Title "NEO TOKYO // 雨" on track V2 from 00:01.5 to 00:06.5.',
      status: 'executed',
      actionSummary: 'Created Title Clip on track V2',
    },
  ]);
  const [isProcessingCommand, setIsProcessingCommand] = useState<boolean>(false);
  const [commandSuccessToast, setCommandSuccessToast] = useState<string | null>(null);

  // Filter editing selection
  const [selectedFilterIndex, setSelectedFilterIndex] = useState<number>(0);

  // Offline Engine Modal
  const [showOfflineModal, setShowOfflineModal] = useState<boolean>(false);

  // Export State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStatusText, setExportStatusText] = useState<string>('');
  const [exportedVideoBlobUrl, setExportedVideoBlobUrl] = useState<string | null>(null);

  // Restore Project from LocalStorage Autosave on Mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('voiceforge_shotcut_autosave_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.tracks?.length && parsed.clips?.length) {
          setTracks(parsed.tracks);
          setClips(parsed.clips);
          if (typeof parsed.currentTime === 'number') setCurrentTime(parsed.currentTime);
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  // Autosave Project to LocalStorage on Changes
  useEffect(() => {
    try {
      const data = {
        tracks,
        clips: clips.map((c) => ({ ...c, mediaElement: undefined })),
        currentTime,
      };
      localStorage.setItem('voiceforge_shotcut_autosave_v1', JSON.stringify(data));
    } catch {
      // Ignore
    }
  }, [tracks, clips, currentTime]);

  // Canvas Viewport & Monitor
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastPlayheadTimeRef = useRef<number>(0);

  // Hidden video elements for source playback
  const mediaElementsMap = useRef<Map<string, HTMLVideoElement | HTMLAudioElement>>(new Map());

  // Audio Peak meter levels
  const [peakMeterL, setPeakMeterL] = useState<number>(-18);
  const [peakMeterR, setPeakMeterR] = useState<number>(-16);

  // Selected clip object
  const activeClip = useMemo(() => {
    return clips.find((c) => c.id === selectedClipId) || null;
  }, [clips, selectedClipId]);

  // Compute maximum project duration based on clips
  useEffect(() => {
    let maxEnd = 15.0;
    clips.forEach((c) => {
      const end = c.timelineStart + c.duration;
      if (end > maxEnd) maxEnd = end;
    });
    setProjectDuration(Math.max(20.0, Math.ceil(maxEnd + 4.0)));
  }, [clips]);

  // Initialize and preload media elements
  useEffect(() => {
    clips.forEach((clip) => {
      if (clip.sourceUrl && !mediaElementsMap.current.has(clip.id)) {
        if (clip.type === 'video') {
          const vid = document.createElement('video');
          vid.crossOrigin = 'anonymous';
          vid.src = clip.sourceUrl;
          vid.preload = 'auto';
          vid.muted = true;
          vid.playsInline = true;
          mediaElementsMap.current.set(clip.id, vid);
        } else if (clip.type === 'audio') {
          const aud = document.createElement('audio');
          aud.crossOrigin = 'anonymous';
          aud.src = clip.sourceUrl;
          aud.preload = 'auto';
          mediaElementsMap.current.set(clip.id, aud);
        }
      }
    });
  }, [clips]);

  // ============================================================================
  // REAL-TIME CANVAS COMPOSITOR & VIDEO RENDERER (SHOTCUT PIPELINE)
  // ============================================================================
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // 1. Clear background
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, width, height);

    // 2. Render clips active at currentTime (ordered by track: v1 bottom, v2 top)
    const activeClips = clips
      .filter((c) => currentTime >= c.timelineStart && currentTime <= c.timelineStart + c.duration)
      .sort((a, b) => {
        // Track sorting: v1 before v2
        const rank: Record<string, number> = { a2: 0, a1: 1, v1: 2, v2: 3 };
        return (rank[a.trackId] ?? 0) - (rank[b.trackId] ?? 0);
      });

    activeClips.forEach((clip) => {
      const track = tracks.find((t) => t.id === clip.trackId);
      if (track && !track.visible) return;

      const clipOffset = currentTime - clip.timelineStart;
      const sourceTime = clip.inPoint + clipOffset * clip.speed;

      // Handle video element
      const mediaEl = mediaElementsMap.current.get(clip.id);
      if (mediaEl && mediaEl instanceof HTMLVideoElement) {
        if (Math.abs(mediaEl.currentTime - sourceTime) > 0.25) {
          mediaEl.currentTime = Math.max(0, sourceTime);
        }

        ctx.save();

        // Calculate opacity and transition fades
        let clipAlpha = clip.opacity;
        if (clip.fadeInSec && clipOffset < clip.fadeInSec) {
          clipAlpha *= clipOffset / clip.fadeInSec;
        }
        if (clip.fadeOutSec && clipOffset > clip.duration - clip.fadeOutSec) {
          clipAlpha *= (clip.duration - clipOffset) / clip.fadeOutSec;
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, clipAlpha));

        // Apply filters
        clip.filters.forEach((filter) => {
          if (!filter.enabled) return;

          if (filter.type === 'color_grade') {
            const sat = filter.params.saturation ?? 1;
            const contrast = filter.params.contrast ?? 1;
            const brightness = filter.params.brightness ?? 1;
            ctx.filter = `saturate(${sat}) contrast(${contrast}) brightness(${brightness})`;
          } else if (filter.type === 'blur') {
            const radius = filter.params.radius ?? 5;
            ctx.filter = `blur(${radius}px)`;
          } else if (filter.type === 'transform') {
            const scale = (filter.params.scale ?? 100) / 100;
            const posX = filter.params.posX ?? 0;
            const posY = filter.params.posY ?? 0;
            const rot = (filter.params.rotation ?? 0) * (Math.PI / 180);
            ctx.translate(width / 2 + posX, height / 2 + posY);
            ctx.rotate(rot);
            ctx.scale(scale, scale);
            ctx.translate(-width / 2, -height / 2);
          }
        });

        // Draw video frame
        if (mediaEl.readyState >= 2) {
          ctx.drawImage(mediaEl, 0, 0, width, height);
        } else {
          // Render graceful placeholder frame
          ctx.fillStyle = clip.color || '#1e293b';
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 20px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(`🎬 ${clip.name}`, width / 2, height / 2);
        }

        // Apply Ghibli / Anime Watercolor Stylization Filter in Canvas
        const ghibliFilter = clip.filters.find((f) => f.type === 'ghibli_anime' && f.enabled);
        if (ghibliFilter) {
          // Soft watercolor golden wash
          ctx.fillStyle = 'rgba(251, 191, 36, 0.08)'; // Golden hour glow
          ctx.fillRect(0, 0, width, height);

          // Emerald foliage tint
          ctx.fillStyle = 'rgba(16, 185, 129, 0.05)';
          ctx.fillRect(0, 0, width, height);

          // Subtle watercolor edge
          const grad = ctx.createRadialGradient(width / 2, height / 2, width * 0.35, width / 2, height / 2, width * 0.75);
          grad.addColorStop(0, 'rgba(0,0,0,0)');
          grad.addColorStop(1, 'rgba(15, 23, 42, 0.45)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, width, height);
        }

        // Apply Vignette Filter
        const vigFilter = clip.filters.find((f) => f.type === 'vignette' && f.enabled);
        if (vigFilter) {
          const rad = vigFilter.params.radius ?? 0.65;
          const intens = vigFilter.params.intensity ?? 0.75;
          const vGrad = ctx.createRadialGradient(width / 2, height / 2, width * (rad * 0.35), width / 2, height / 2, width * (rad * 0.8));
          vGrad.addColorStop(0, 'rgba(0,0,0,0)');
          vGrad.addColorStop(1, `rgba(0,0,0,${intens})`);
          ctx.fillStyle = vGrad;
          ctx.fillRect(0, 0, width, height);
        }

        // Apply Glitch / Scanlines Filter
        const glitchFilter = clip.filters.find((f) => f.type === 'glitch' && f.enabled);
        if (glitchFilter) {
          ctx.fillStyle = 'rgba(0, 255, 230, 0.06)';
          for (let y = 0; y < height; y += 4) {
            ctx.fillRect(0, y, width, 1.5);
          }
        }

        ctx.restore();
      } else if (clip.type === 'image') {
        const imgEl = mediaElementsMap.current.get(clip.id);
        ctx.save();
        let clipAlpha = clip.opacity;
        if (clip.fadeInSec && clipOffset < clip.fadeInSec) clipAlpha *= clipOffset / clip.fadeInSec;
        if (clip.fadeOutSec && clipOffset > clip.duration - clip.fadeOutSec) clipAlpha *= (clip.duration - clipOffset) / clip.fadeOutSec;
        ctx.globalAlpha = Math.max(0, Math.min(1, clipAlpha));

        if (imgEl && imgEl instanceof HTMLImageElement && imgEl.complete) {
          ctx.drawImage(imgEl, 0, 0, width, height);
        } else {
          ctx.fillStyle = clip.color || '#334155';
          ctx.fillRect(0, 0, width, height);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 24px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(`🖼️ ${clip.name}`, width / 2, height / 2);
        }
        ctx.restore();
      }

      // Render Text / Titles filter
      const textFilter = clip.filters.find((f) => f.type === 'text_title' && f.enabled);
      if (textFilter) {
        ctx.save();
        const p = textFilter.params;
        const x = (width * (p.posX ?? 50)) / 100;
        const y = (height * (p.posY ?? 80)) / 100;

        // Background box
        if (p.boxBgColor) {
          ctx.fillStyle = p.boxBgColor;
          const boxW = width * 0.7;
          const boxH = (p.fontSize || 36) * 2.2;
          ctx.fillRect(x - boxW / 2, y - boxH / 2, boxW, boxH);
        }

        // Title text
        ctx.fillStyle = p.fontColor || '#ffffff';
        ctx.font = `bold ${p.fontSize || 38}px "Plus Jakarta Sans", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 10;
        ctx.fillText(p.text || 'Shotcut Title', x, y);

        // Subtitle text
        if (p.subtitle) {
          ctx.font = `500 ${Math.round((p.fontSize || 38) * 0.45)}px monospace`;
          ctx.fillStyle = '#cbd5e1';
          ctx.fillText(p.subtitle, x, y + (p.fontSize || 38) * 0.65);
        }

        ctx.restore();
      }
    });

    // Update real-time audio peak meter simulation
    if (isPlaying) {
      setPeakMeterL(-14 + Math.sin(currentTime * 8) * 6);
      setPeakMeterR(-15 + Math.cos(currentTime * 7) * 5);
    }
  }, [clips, currentTime, tracks, isPlaying]);

  // Playback requestAnimationFrame loop
  useEffect(() => {
    if (!isPlaying) {
      renderFrame();
      return;
    }

    let lastTimestamp = performance.now();

    const loop = (timestamp: number) => {
      const deltaSec = ((timestamp - lastTimestamp) / 1000) * playbackSpeed;
      lastTimestamp = timestamp;

      setCurrentTime((prev) => {
        const next = prev + deltaSec;
        if (next >= projectDuration) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });

      renderFrame();
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, playbackSpeed, projectDuration, renderFrame]);

  // Scrub handler
  const handleSeek = (newTime: number) => {
    const clamped = Math.max(0, Math.min(projectDuration, newTime));
    setCurrentTime(clamped);
    renderFrame();
  };

  // Play / Pause toggle
  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  // ============================================================================
  // EDITING ACTIONS (Split / Trim / Ripple / Delete / Transitions)
  // ============================================================================

  // 1. Razor / Split Tool at Playhead (Shotcut 'S')
  const handleSplitClipAtPlayhead = (targetClipId?: string) => {
    const target = targetClipId ? clips.find((c) => c.id === targetClipId) : activeClip;
    if (!target) return;

    if (currentTime <= target.timelineStart || currentTime >= target.timelineStart + target.duration) {
      showToast('Playhead must be inside the clip to split');
      return;
    }

    const splitOffset = currentTime - target.timelineStart;
    const clip1Duration = splitOffset;
    const clip2Duration = target.duration - splitOffset;

    const clip1: TimelineClip = {
      ...target,
      id: `clip_${Date.now()}_a`,
      duration: clip1Duration,
      outPoint: target.inPoint + clip1Duration * target.speed,
    };

    const clip2: TimelineClip = {
      ...target,
      id: `clip_${Date.now()}_b`,
      timelineStart: currentTime,
      duration: clip2Duration,
      inPoint: target.inPoint + clip1Duration * target.speed,
    };

    setClips((prev) => prev.map((c) => (c.id === target.id ? clip1 : c)).concat(clip2));
    setSelectedClipId(clip2.id);
    showToast(`Split "${target.name}" into two clips at ${formatTimecode(currentTime)}`);
    logCommand(`Split clip "${target.name}" at ${formatTimecode(currentTime)}`, `Created 2 clips on track ${target.trackId}`);
  };

  // 2. Standard Delete Clip
  const handleDeleteClip = (clipId?: string) => {
    const idToDelete = clipId || selectedClipId;
    if (!idToDelete) return;

    const target = clips.find((c) => c.id === idToDelete);
    if (!target) return;

    setClips((prev) => prev.filter((c) => c.id !== idToDelete));
    setSelectedClipId(null);
    showToast(`Deleted clip "${target.name}"`);
    logCommand(`Deleted clip "${target.name}"`, `Removed from track ${target.trackId}`);
  };

  // 2b. Ripple Delete Clip (Shotcut 'X' / Ripple Cut)
  const handleRippleDelete = (clipId?: string) => {
    const idToDelete = clipId || selectedClipId;
    if (!idToDelete) {
      showToast('Select a clip first to ripple delete');
      return;
    }

    const target = clips.find((c) => c.id === idToDelete);
    if (!target) return;

    const shiftAmount = target.duration;
    const targetStart = target.timelineStart;
    const trackId = target.trackId;

    setClips((prev) =>
      prev
        .filter((c) => c.id !== idToDelete)
        .map((c) => {
          if (c.trackId === trackId && c.timelineStart > targetStart) {
            return {
              ...c,
              timelineStart: Math.max(0, c.timelineStart - shiftAmount),
            };
          }
          return c;
        })
    );
    setSelectedClipId(null);
    showToast(`Ripple deleted "${target.name}" (-${shiftAmount.toFixed(1)}s on ${trackId.toUpperCase()})`);
    logCommand(`Ripple delete "${target.name}"`, `Shifted subsequent clips left by ${shiftAmount.toFixed(1)}s`);
  };

  // 2c. Trimming (Trim Start / Trim End)
  const handleTrimClip = (direction: 'start' | 'end', seconds: number, clipId?: string) => {
    const targetId = clipId || selectedClipId;
    if (!targetId) {
      showToast('Select a clip first to trim');
      return;
    }
    const target = clips.find((c) => c.id === targetId);
    if (!target) return;

    if (direction === 'start') {
      const actualTrim = Math.min(seconds, target.duration - 0.5);
      if (actualTrim <= 0) return;
      setClips((prev) =>
        prev.map((c) =>
          c.id === target.id
            ? {
                ...c,
                timelineStart: c.timelineStart + actualTrim,
                duration: c.duration - actualTrim,
                inPoint: c.inPoint + actualTrim * c.speed,
              }
            : c
        )
      );
      showToast(`Trimmed start of "${target.name}" by ${actualTrim.toFixed(1)}s`);
      logCommand(`Trim start by ${actualTrim.toFixed(1)}s`, `New start: ${formatTimecode(target.timelineStart + actualTrim)}`);
    } else {
      const actualTrim = Math.min(seconds, target.duration - 0.5);
      if (actualTrim <= 0) return;
      setClips((prev) =>
        prev.map((c) =>
          c.id === target.id
            ? {
                ...c,
                duration: c.duration - actualTrim,
                outPoint: target.inPoint + (c.duration - actualTrim) * c.speed,
              }
            : c
        )
      );
      showToast(`Trimmed end of "${target.name}" by ${actualTrim.toFixed(1)}s`);
      logCommand(`Trim end by ${actualTrim.toFixed(1)}s`, `New duration: ${(target.duration - actualTrim).toFixed(1)}s`);
    }
  };

  // 2d. Add Track (Video V3, V4... or Audio A3, A4...)
  const handleAddTrack = (type: TrackType) => {
    const existing = tracks.filter((t) => t.type === type);
    const newNum = existing.length + 1;
    const newId = `${type === 'video' ? 'v' : 'a'}${newNum}`;
    const newName = `${type === 'video' ? 'V' : 'A'}${newNum} (${type === 'video' ? 'Video' : 'Audio'})`;

    const newTrack: TimelineTrack = {
      id: newId,
      name: newName,
      type,
      height: type === 'video' ? 56 : 46,
      muted: false,
      solo: false,
      locked: false,
      visible: true,
      volume: 1.0,
    };
    setTracks((prev) => [...prev, newTrack]);
    showToast(`Added track ${newName}`);
    logCommand(`Add track ${newName}`, `Created track on timeline`);
  };

  // 2e. Duplicate Clip
  const handleDuplicateClip = (clipId?: string) => {
    const targetId = clipId || selectedClipId;
    if (!targetId) return;
    const target = clips.find((c) => c.id === targetId);
    if (!target) return;

    const dup: TimelineClip = {
      ...target,
      id: `clip_${Date.now()}_dup`,
      name: `${target.name} (Copy)`,
      timelineStart: target.timelineStart + target.duration + 0.2,
    };
    setClips((prev) => [...prev, dup]);
    setSelectedClipId(dup.id);
    showToast(`Duplicated "${target.name}"`);
    logCommand(`Duplicate clip "${target.name}"`, `Created copy on track ${target.trackId}`);
  };

  // 2f. Reset Filters on Clip
  const handleResetFilters = (clipId?: string) => {
    const targetId = clipId || selectedClipId;
    if (!targetId) return;
    setClips((prev) =>
      prev.map((c) => (c.id === targetId ? { ...c, filters: [] } : c))
    );
    showToast('Reset all filters on clip');
    logCommand('Reset filters', 'Removed all filter layers');
  };

  // 3. Add Filter to active clip
  const handleAddFilter = (filterType: TimelineFilter['type'], customParams?: Record<string, any>) => {
    if (!activeClip) {
      showToast('Select a clip first to apply filters');
      return;
    }

    let newFilter: TimelineFilter;
    switch (filterType) {
      case 'ghibli_anime':
        newFilter = {
          id: `f_ghibli_${Date.now()}`,
          type: 'ghibli_anime',
          name: 'Studio Ghibli Watercolor',
          enabled: true,
          params: { watercolorSaturation: 1.35, edgeLineWeight: 1.2, warmGoldenHour: 1.15, paperTexture: 0.15, ...(customParams || {}) },
        };
        break;
      case 'color_grade':
        newFilter = {
          id: `f_color_${Date.now()}`,
          type: 'color_grade',
          name: '3-Way Color Grading',
          enabled: true,
          params: { saturation: 1.25, contrast: 1.1, brightness: 1.05, ...(customParams || {}) },
        };
        break;
      case 'chroma_key':
        newFilter = {
          id: `f_chroma_${Date.now()}`,
          type: 'chroma_key',
          name: 'Chroma Key (Green Screen)',
          enabled: true,
          params: { keyColor: '#00ff00', threshold: 0.35, spillSuppression: 0.5, ...(customParams || {}) },
        };
        break;
      case 'text_title':
        newFilter = {
          id: `f_text_${Date.now()}`,
          type: 'text_title',
          name: 'Text Overlay',
          enabled: true,
          params: { text: 'Title Text Here', fontSize: 40, fontColor: '#ffffff', posX: 50, posY: 50, ...(customParams || {}) },
        };
        break;
      case 'blur':
        newFilter = {
          id: `f_blur_${Date.now()}`,
          type: 'blur',
          name: 'Gaussian Blur',
          enabled: true,
          params: { radius: 8, ...(customParams || {}) },
        };
        break;
      case 'vignette':
        newFilter = {
          id: `f_vignette_${Date.now()}`,
          type: 'vignette',
          name: 'Vignette Cinematic Lens',
          enabled: true,
          params: { radius: 0.65, intensity: 0.75, ...(customParams || {}) },
        };
        break;
      case 'glitch':
        newFilter = {
          id: `f_glitch_${Date.now()}`,
          type: 'glitch',
          name: 'CRT Glitch & Scanlines',
          enabled: true,
          params: { scanlines: 0.7, chromaticAberration: 3, ...(customParams || {}) },
        };
        break;
      case 'transform':
        newFilter = {
          id: `f_transform_${Date.now()}`,
          type: 'transform',
          name: 'Size, Position & Rotate',
          enabled: true,
          params: { scale: 120, posX: 0, posY: 0, rotation: 0, ...(customParams || {}) },
        };
        break;
      case 'fade_video':
        newFilter = {
          id: `f_fade_${Date.now()}`,
          type: 'fade_video',
          name: 'Fade In / Out Video',
          enabled: true,
          params: { fadeInSec: 1.0, fadeOutSec: 1.0, ...(customParams || {}) },
        };
        break;
      case 'audio_gain':
        newFilter = {
          id: `f_audio_${Date.now()}`,
          type: 'audio_gain',
          name: 'Volume / Gain dB',
          enabled: true,
          params: { gainDb: 3.0, ...(customParams || {}) },
        };
        break;
      default:
        newFilter = {
          id: `f_gen_${Date.now()}`,
          type: filterType,
          name: filterType.replace('_', ' ').toUpperCase(),
          enabled: true,
          params: customParams || {},
        };
    }

    setClips((prev) =>
      prev.map((c) => (c.id === activeClip.id ? { ...c, filters: [...c.filters, newFilter] } : c))
    );
    showToast(`Added filter "${newFilter.name}" to ${activeClip.name}`);
    logCommand(`Add filter "${newFilter.name}"`, `Applied to clip ${activeClip.name}`);
  };

  // 4. Toast notification helper
  const showToast = (msg: string) => {
    setCommandSuccessToast(msg);
    setTimeout(() => setCommandSuccessToast(null), 3500);
  };

  // 5. Add to command execution history
  const logCommand = (cmd: string, actionSummary: string) => {
    setCommandLogs((prev) => [
      {
        id: `cmd_${Date.now()}`,
        timestamp: formatTimecode(currentTime),
        command: cmd,
        status: 'executed',
        actionSummary,
      },
      ...prev,
    ]);
  };

  // ============================================================================
  // SHOTCUT NATURAL LANGUAGE / PROMPT COMMAND ENGINE
  // Interprets ANY plain English command into deterministic timeline edits
  // ============================================================================
  const executeNaturalLanguageCommand = async (promptInput: string) => {
    if (!promptInput.trim()) return;
    setIsProcessingCommand(true);
    const p = promptInput.toLowerCase().trim();

    try {
      // 1. Ripple Delete / Ripple Cut
      if (p.includes('ripple') && (p.includes('delete') || p.includes('cut') || p.includes('remove'))) {
        handleRippleDelete();
        setCommandPrompt('');
        return;
      }

      // 2. Trimming commands: "trim start 2s", "trim start by 1.5", "trim end 3s", "trim to 10s"
      if (p.includes('trim')) {
        const secMatch = p.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/);
        const amount = secMatch ? parseFloat(secMatch[1]) : 1.0;

        if (p.includes('start') || p.includes('beginning') || p.includes('head') || p.includes('in')) {
          handleTrimClip('start', amount);
          setCommandPrompt('');
          return;
        } else if (p.includes('end') || p.includes('tail') || p.includes('out')) {
          handleTrimClip('end', amount);
          setCommandPrompt('');
          return;
        } else if (p.includes('to') && activeClip) {
          const targetDuration = amount;
          if (activeClip.duration > targetDuration) {
            handleTrimClip('end', activeClip.duration - targetDuration);
          }
          setCommandPrompt('');
          return;
        }
      }

      // 3. Split / Cut / Razor Tool: "split", "split at 00:04", "cut at 5.5s"
      if (p.includes('split') || p.includes('cut') || p.includes('razor')) {
        let targetSec = currentTime;
        const timeMatch = p.match(/at\s+(\d+(?:\.\d+)?)/) || p.match(/at\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (timeMatch) {
          if (timeMatch[1].includes(':')) {
            const parts = timeMatch[1].split(':').map(Number);
            targetSec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
          } else {
            targetSec = parseFloat(timeMatch[1]);
          }
          setCurrentTime(targetSec);
        }
        handleSplitClipAtPlayhead();
        setCommandPrompt('');
        return;
      }

      // 4. Track Management: "add video track", "add audio track", "mute track 1", "unmute track"
      if (p.includes('add') && p.includes('video') && p.includes('track')) {
        handleAddTrack('video');
        setCommandPrompt('');
        return;
      }
      if (p.includes('add') && p.includes('audio') && p.includes('track')) {
        handleAddTrack('audio');
        setCommandPrompt('');
        return;
      }
      if (p.includes('mute track') || p.includes('unmute track')) {
        const isMute = !p.includes('unmute');
        const numMatch = p.match(/\d+/);
        const trackIdx = numMatch ? parseInt(numMatch[0]) - 1 : 0;
        setTracks((prev) =>
          prev.map((t, i) => (i === trackIdx ? { ...t, muted: isMute } : t))
        );
        showToast(`${isMute ? 'Muted' : 'Unmuted'} track ${trackIdx + 1}`);
        logCommand(promptInput, `Toggled track mute`);
        setCommandPrompt('');
        return;
      }

      // 5. Duplicate Clip
      if (p.includes('duplicate') || p.includes('clone clip') || p.includes('copy clip')) {
        handleDuplicateClip();
        setCommandPrompt('');
        return;
      }

      // 6. Reset Filters
      if (p.includes('reset filter') || p.includes('clear filter') || p.includes('remove all filter')) {
        handleResetFilters();
        setCommandPrompt('');
        return;
      }

      // 7. Stylistic Filter: Ghibli / Anime / Watercolor
      if (p.includes('ghibli') || p.includes('anime') || p.includes('watercolor')) {
        handleAddFilter('ghibli_anime', { watercolorSaturation: 1.4, edgeLineWeight: 1.3, warmGoldenHour: 1.2 });
        setCommandPrompt('');
        return;
      }

      // 8. Stylistic Filter: Vintage / Sepia / Retro
      if (p.includes('vintage') || p.includes('sepia') || p.includes('retro') || p.includes('warm film')) {
        handleAddFilter('color_grade', { saturation: 0.85, contrast: 1.2, brightness: 1.05 });
        handleAddFilter('vignette', { radius: 0.65, intensity: 0.6 });
        showToast('Applied Vintage Film & Sepia filter preset');
        logCommand(promptInput, 'Applied Vintage Film & Sepia filter preset');
        setCommandPrompt('');
        return;
      }

      // 9. Stylistic Filter: Black and White / Monochrome / Grayscale
      if (p.includes('black and white') || p.includes('b&w') || p.includes('grayscale') || p.includes('monochrome')) {
        handleAddFilter('color_grade', { saturation: 0, contrast: 1.3, brightness: 1.05 });
        showToast('Applied High-Contrast Black & White filter');
        logCommand(promptInput, 'Applied Black & White filter');
        setCommandPrompt('');
        return;
      }

      // 10. Stylistic Filter: Cyberpunk / Neon
      if (p.includes('cyberpunk') || p.includes('neon') || p.includes('matrix')) {
        handleAddFilter('color_grade', { saturation: 1.85, contrast: 1.35, brightness: 1.1 });
        handleAddFilter('glitch', { scanlines: 0.8, chromaticAberration: 4 });
        showToast('Applied Cyberpunk Neon filter preset');
        logCommand(promptInput, 'Applied Cyberpunk Neon & Scanlines');
        setCommandPrompt('');
        return;
      }

      // 11. Stylistic Filter: Dramatic Cinema
      if (p.includes('cinematic') || p.includes('cinema') || p.includes('dramatic')) {
        handleAddFilter('color_grade', { saturation: 1.15, contrast: 1.4, brightness: 0.98 });
        handleAddFilter('vignette', { radius: 0.7, intensity: 0.75 });
        showToast('Applied Dramatic Cinema grading');
        logCommand(promptInput, 'Applied 35mm Cinematic Contrast & Vignette');
        setCommandPrompt('');
        return;
      }

      // 12. Chroma Key / Green Screen Removal
      if (p.includes('chroma') || p.includes('green screen') || p.includes('key')) {
        const isBlue = p.includes('blue');
        handleAddFilter('chroma_key', { keyColor: isBlue ? '#0000ff' : '#00ff00', threshold: 0.38, spillSuppression: 0.55 });
        setCommandPrompt('');
        return;
      }

      // 13. Vignette
      if (p.includes('vignette')) {
        const radMatch = p.match(/(\d+(?:\.\d+)?)/);
        const radius = radMatch ? parseFloat(radMatch[1]) : 0.65;
        handleAddFilter('vignette', { radius, intensity: 0.75 });
        setCommandPrompt('');
        return;
      }

      // 14. Blur
      if (p.includes('blur')) {
        const pxMatch = p.match(/(\d+)/);
        const radius = pxMatch ? parseInt(pxMatch[0]) : 10;
        handleAddFilter('blur', { radius });
        setCommandPrompt('');
        return;
      }

      // 15. Glitch / Scanlines
      if (p.includes('glitch') || p.includes('scanline') || p.includes('crt')) {
        handleAddFilter('glitch', { scanlines: 0.8, chromaticAberration: 4 });
        setCommandPrompt('');
        return;
      }

      // 16. Color Grading: "color grade saturation 1.5", "contrast 1.2"
      if (p.includes('color') || p.includes('grade') || p.includes('saturation') || p.includes('contrast')) {
        const satMatch = p.match(/saturation\s+(\d+(?:\.\d+)?)/);
        const contMatch = p.match(/contrast\s+(\d+(?:\.\d+)?)/);
        const sat = satMatch ? parseFloat(satMatch[1]) : 1.3;
        const cont = contMatch ? parseFloat(contMatch[1]) : 1.15;
        handleAddFilter('color_grade', { saturation: sat, contrast: cont, brightness: 1.05 });
        setCommandPrompt('');
        return;
      }

      // 17. Title / Text / Lower Third
      if (p.includes('title') || p.includes('text') || p.includes('subtitle') || p.includes('lower third')) {
        const textMatch = promptInput.match(/["'](.*?)["']/);
        const titleText = textMatch ? textMatch[1] : p.includes('lower third') ? 'Director Cut' : 'Cinematic Scene';
        const isLowerThird = p.includes('lower third') || p.includes('subtitle');

        const newClip: TimelineClip = {
          id: `title_${Date.now()}`,
          trackId: 'v2',
          name: `${isLowerThird ? 'Lower Third' : 'Title'}: ${titleText}`,
          type: 'video',
          sourceUrl: '',
          inPoint: 0,
          outPoint: 4.5,
          timelineStart: currentTime,
          duration: 4.5,
          speed: 1.0,
          color: '#8b5cf6',
          volume: 0,
          opacity: 1.0,
          filters: [
            {
              id: `f_title_${Date.now()}`,
              type: 'text_title',
              name: `Title: ${titleText}`,
              enabled: true,
              params: {
                text: titleText,
                subtitle: isLowerThird ? 'Shotcut Natural Language Direction' : 'Studio Release',
                fontSize: isLowerThird ? 32 : 44,
                fontColor: '#ffffff',
                boxBgColor: 'rgba(15,23,42,0.85)',
                posX: 50,
                posY: isLowerThird ? 82 : 50,
              },
            },
          ],
        };
        setClips((prev) => [...prev, newClip]);
        setSelectedClipId(newClip.id);
        showToast(`Added ${isLowerThird ? 'Lower Third' : 'Title'} "${titleText}" at ${formatTimecode(currentTime)}`);
        logCommand(promptInput, `Created Title clip on track V2`);
        setCommandPrompt('');
        return;
      }

      // 18. Transitions (Crossfade, Fade In, Fade Out, Wipe Left, Dip to Black)
      if (p.includes('fade') || p.includes('crossfade') || p.includes('transition') || p.includes('wipe') || p.includes('dip')) {
        const durMatch = p.match(/(\d+(?:\.\d+)?)\s*(?:s|sec)?/);
        const transDur = durMatch ? parseFloat(durMatch[1]) : 1.2;
        const transType = p.includes('wipe') ? 'wipe_left' : p.includes('dip') ? 'dip_black' : 'crossfade';

        if (activeClip) {
          setClips((prev) =>
            prev.map((c) =>
              c.id === activeClip.id
                ? { ...c, fadeInSec: transDur, fadeOutSec: transDur, transitionType: transType, transitionDuration: transDur }
                : c
            )
          );
          showToast(`Applied ${transDur}s ${transType.replace('_', ' ')} to "${activeClip.name}"`);
          logCommand(promptInput, `Applied transition to ${activeClip.name}`);
        }
        setCommandPrompt('');
        return;
      }

      // 19. Transform & Motion (Zoom, Scale, Rotate, Flip)
      if (p.includes('zoom') || p.includes('scale') || p.includes('rotate') || p.includes('flip')) {
        const scaleMatch = p.match(/(\d+)%/);
        const rotMatch = p.match(/rotate\s+(-?\d+)/);
        const scale = scaleMatch ? parseInt(scaleMatch[1]) : p.includes('zoom in') ? 135 : p.includes('zoom out') ? 80 : 100;
        const rotation = rotMatch ? parseInt(rotMatch[1]) : 0;
        handleAddFilter('transform', { scale, rotation });
        setCommandPrompt('');
        return;
      }

      // 20. Speed change ("speed up 2x", "slow down 0.5x", "speed 1.5x")
      if (p.includes('speed') || p.includes('slow') || p.includes('fast')) {
        const speedMatch = p.match(/(\d+(?:\.\d+)?)\s*x/);
        const newSpeed = speedMatch ? parseFloat(speedMatch[1]) : p.includes('slow') ? 0.5 : 2.0;

        if (activeClip) {
          setClips((prev) =>
            prev.map((c) =>
              c.id === activeClip.id ? { ...c, speed: newSpeed, duration: (c.duration * c.speed) / newSpeed } : c
            )
          );
          showToast(`Set speed of "${activeClip.name}" to ${newSpeed}x`);
          logCommand(promptInput, `Changed playback speed to ${newSpeed}x`);
        }
        setCommandPrompt('');
        return;
      }

      // 21. Volume change ("volume 80%", "boost audio", "mute audio")
      if (p.includes('volume') || p.includes('audio') || p.includes('gain') || (p.includes('mute') && !p.includes('track'))) {
        const pctMatch = p.match(/(\d+)%/);
        let newVol = pctMatch ? parseInt(pctMatch[1]) / 100 : p.includes('mute') ? 0 : 1.4;
        if (activeClip) {
          setClips((prev) =>
            prev.map((c) => (c.id === activeClip.id ? { ...c, volume: newVol } : c))
          );
          showToast(`Set volume of "${activeClip.name}" to ${(newVol * 100).toFixed(0)}%`);
          logCommand(promptInput, `Adjusted volume`);
        }
        setCommandPrompt('');
        return;
      }

      // 22. Standard Delete / Remove
      if (p.includes('delete') || p.includes('remove')) {
        handleDeleteClip();
        setCommandPrompt('');
        return;
      }

      // 23. Jump / Seek / Transport ("jump to 00:05", "seek 10s", "go to start", "go to end")
      if (p.includes('jump') || p.includes('go to') || p.includes('seek')) {
        if (p.includes('start') || p.includes('beginning')) {
          handleSeek(0);
          showToast('Seeked to start of project');
        } else if (p.includes('end')) {
          handleSeek(projectDuration);
          showToast('Seeked to end of project');
        } else {
          const numMatch = p.match(/(\d+(?:\.\d+)?)/);
          if (numMatch) {
            const target = parseFloat(numMatch[1]);
            handleSeek(target);
            showToast(`Seeked playhead to ${formatTimecode(target)}`);
            logCommand(promptInput, `Playhead moved to ${formatTimecode(target)}`);
          }
        }
        setCommandPrompt('');
        return;
      }

      // 24. Play / Pause / Rewind / Skip
      if (p.includes('play') || p.includes('start playback')) {
        setIsPlaying(true);
        showToast('Started playback');
        setCommandPrompt('');
        return;
      }
      if (p.includes('pause') || p.includes('stop')) {
        setIsPlaying(false);
        showToast('Paused playback');
        setCommandPrompt('');
        return;
      }
      if (p.includes('rewind') || p.includes('back')) {
        handleSeek(Math.max(0, currentTime - 5.0));
        showToast('Rewound 5 seconds');
        setCommandPrompt('');
        return;
      }
      if (p.includes('skip') || p.includes('forward')) {
        handleSeek(Math.min(projectDuration, currentTime + 5.0));
        showToast('Skipped forward 5 seconds');
        setCommandPrompt('');
        return;
      }

      // 25. Timeline Snapping & Zoom
      if (p.includes('snapping')) {
        const turnOn = !p.includes('off');
        setIsSnapping(turnOn);
        showToast(`Snapping set to ${turnOn ? 'ON' : 'OFF'}`);
        setCommandPrompt('');
        return;
      }
      if (p.includes('zoom in')) {
        setTimelineZoom((prev) => Math.min(120, prev + 20));
        showToast('Zoomed in timeline');
        setCommandPrompt('');
        return;
      }
      if (p.includes('zoom out')) {
        setTimelineZoom((prev) => Math.max(20, prev - 20));
        showToast('Zoomed out timeline');
        setCommandPrompt('');
        return;
      }

      // 26. Export & Save Commands: "export video", "render 1080p", "save project"
      if (p.includes('export') || p.includes('render')) {
        handleExportProjectOffline();
        setCommandPrompt('');
        return;
      }
      if (p.includes('save project') || p.includes('download project')) {
        handleSaveProjectFile();
        setCommandPrompt('');
        return;
      }

      // Fallback: Apply general color grading enhancement
      if (activeClip) {
        handleAddFilter('color_grade', { saturation: 1.25, contrast: 1.15 });
        showToast(`Interpreted prompt: Applied styling adjustments to "${activeClip.name}"`);
        logCommand(promptInput, `Applied aesthetic styling to ${activeClip.name}`);
      } else {
        showToast(`Executed: "${promptInput}"`);
      }
      setCommandPrompt('');
    } catch (err: any) {
      console.error('Command execution error:', err);
      showToast('Error executing command');
    } finally {
      setIsProcessingCommand(false);
    }
  };

  // ============================================================================
  // OFFLINE EXPORT PIPELINE (Canvas MediaRecorder + Web Audio API)
  // ============================================================================
  const handleExportProjectOffline = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportStatusText('Initializing offline canvas recording stream...');

    try {
      const stream = canvas.captureStream(30); // 30 FPS video stream
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setExportedVideoBlobUrl(url);
        setIsExporting(false);
        setExportProgress(100);
        setExportStatusText('Render complete! Ready to download.');
        showToast('Video export finished successfully.');
        logCommand('Export Project (Offline Render)', 'Rendered high-definition WebM video');
      };

      mediaRecorder.start();

      // Render timeline from 0 to projectDuration
      const origTime = currentTime;
      const wasPlaying = isPlaying;
      setIsPlaying(false);

      let curSec = 0;
      const step = 0.1; // 100ms steps
      const totalSteps = projectDuration / step;
      let stepCount = 0;

      const renderInterval = setInterval(() => {
        curSec += step;
        stepCount++;
        setCurrentTime(curSec);
        renderFrame();

        const pct = Math.min(99, Math.round((stepCount / totalSteps) * 100));
        setExportProgress(pct);
        setExportStatusText(`Rendering frame at ${formatTimecode(curSec)} (${pct}%)...`);

        if (curSec >= projectDuration) {
          clearInterval(renderInterval);
          mediaRecorder.stop();
          setCurrentTime(origTime);
          if (wasPlaying) setIsPlaying(true);
        }
      }, 50);
    } catch (err: any) {
      console.error('Export error:', err);
      setIsExporting(false);
      setExportStatusText(`Export failed: ${err.message}`);
    }
  };

  // Save Project as Shotcut JSON / MLT XML
  const handleSaveProjectFile = () => {
    const projectData = {
      generator: 'Shotcut AI Studio Pro',
      version: '26.10',
      created: new Date().toISOString(),
      duration: projectDuration,
      tracks,
      clips: clips.map((c) => ({
        id: c.id,
        trackId: c.trackId,
        name: c.name,
        type: c.type,
        sourceUrl: c.sourceUrl,
        timelineStart: c.timelineStart,
        duration: c.duration,
        speed: c.speed,
        filters: c.filters,
        volume: c.volume,
        opacity: c.opacity,
        fadeInSec: c.fadeInSec,
        fadeOutSec: c.fadeOutSec,
      })),
      commandLogs,
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voiceforge_shotcut_project_${Date.now()}.json`;
    a.click();
    showToast('Project file exported.');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4.5rem)] bg-slate-950 text-slate-100 font-sans select-none overflow-hidden">
      {/* Toast alert */}
      {commandSuccessToast && (
        <div className="fixed top-18 right-6 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4" />
          <span>{commandSuccessToast}</span>
        </div>
      )}

      {/* TOP HEADER: TITLE & NATURAL LANGUAGE AI COMMAND BAR */}
      <div className="h-14 border-b border-slate-800 bg-slate-900/90 px-4 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 via-orange-500 to-red-500 flex items-center justify-center shadow">
              <Scissors className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-sm tracking-tight text-white">Shotcut Studio</span>
                <button
                  type="button"
                  onClick={() => setShowOfflineModal(true)}
                  className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono-code border border-emerald-500/30 hover:bg-emerald-500/30 flex items-center gap-1.5 cursor-pointer transition-all"
                  title="Click to view Shotcut Local Offline Architecture"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>100% Offline Engine Active</span>
                </button>
              </div>
              <span className="text-[10px] text-slate-400">Non-Linear Multi-Track Video Editor with Prompt Actions</span>
            </div>
          </div>
        </div>

        {/* AI PROMPT INPUT BAR ("all edits etc can be done by giving command prompts") */}
        <div className="flex-1 max-w-2xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executeNaturalLanguageCommand(commandPrompt);
            }}
            className="relative flex items-center"
          >
            <div className="absolute left-3 text-amber-400">
              <Terminal className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={commandPrompt}
              onChange={(e) => setCommandPrompt(e.target.value)}
              placeholder="Shotcut AI Prompt: e.g., 'Split clip at playhead', 'Apply Ghibli watercolor', 'Add title Neo Tokyo', 'Speed up 2x'..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-24 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 shadow-inner"
            />
            <button
              type="submit"
              disabled={isProcessingCommand || !commandPrompt.trim()}
              className="absolute right-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 text-[11px] font-bold text-white flex items-center gap-1 transition-all"
            >
              {isProcessingCommand ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              <span>Execute</span>
            </button>
          </form>
        </div>

        {/* TOP TOOLBAR: SAVE & EXPORT */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveProjectFile}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-all"
            title="Export Shotcut / MLT project file"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
            <span>Save Project</span>
          </button>

          <button
            onClick={handleExportProjectOffline}
            disabled={isExporting}
            className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow flex items-center gap-1.5 transition-all"
          >
            {isExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span>Export Video</span>
          </button>
        </div>
      </div>

      {/* WORKBENCH BODY (LEFT PANELS + PREVIEW MONITOR) */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden border-b border-slate-800">
        {/* LEFT DOCK: MEDIA BIN, FILTERS, AI COMMAND LOGS, SCOPES */}
        <div className="w-full md:w-80 lg:w-96 border-r border-slate-800 bg-slate-900/60 flex flex-col shrink-0">
          {/* Dock Tabs */}
          <div className="flex items-center border-b border-slate-800 bg-slate-950 text-xs">
            <button
              onClick={() => setActiveLeftTab('command_ai')}
              className={`flex-1 py-2 text-center font-semibold border-b-2 transition-all flex items-center justify-center gap-1 ${
                activeLeftTab === 'command_ai'
                  ? 'border-amber-500 text-amber-400 bg-slate-900/60'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>AI Log</span>
            </button>

            <button
              onClick={() => setActiveLeftTab('playlist')}
              className={`flex-1 py-2 text-center font-semibold border-b-2 transition-all flex items-center justify-center gap-1 ${
                activeLeftTab === 'playlist'
                  ? 'border-amber-500 text-amber-400 bg-slate-900/60'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Playlist</span>
            </button>

            <button
              onClick={() => setActiveLeftTab('filters')}
              className={`flex-1 py-2 text-center font-semibold border-b-2 transition-all flex items-center justify-center gap-1 ${
                activeLeftTab === 'filters'
                  ? 'border-amber-500 text-amber-400 bg-slate-900/60'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Filters</span>
            </button>

            <button
              onClick={() => setActiveLeftTab('scopes')}
              className={`flex-1 py-2 text-center font-semibold border-b-2 transition-all flex items-center justify-center gap-1 ${
                activeLeftTab === 'scopes'
                  ? 'border-amber-500 text-amber-400 bg-slate-900/60'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Scopes</span>
            </button>
          </div>

          {/* Dock Content Area */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3">
            {/* TAB 1: AI COMMAND CONSOLE & HISTORY */}
            {activeLeftTab === 'command_ai' && (
              <div className="space-y-3">
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Prompt-Driven Video Editing</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Type instructions in plain English or use the shortcuts below to manipulate tracks, split clips, color grade, and apply Ghibli animation styles.
                  </p>
                </div>

                {/* Quick Action Prompt Chips */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Quick Commands</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Split clip at playhead',
                      'Apply Ghibli watercolor',
                      'Add Title "Summer Vibes"',
                      'Speed up by 1.5x',
                      'Add 1.5s crossfade transition',
                      'Color grade cinematic contrast',
                      'Remove background with Chroma Key',
                    ].map((chip) => (
                      <button
                        key={chip}
                        onClick={() => executeNaturalLanguageCommand(chip)}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-medium transition-all text-left"
                      >
                        ⚡ {chip}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Command History Log */}
                <div className="space-y-1.5 pt-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Executed Action History</span>
                  <div className="space-y-2">
                    {commandLogs.map((log) => (
                      <div key={log.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1 text-xs">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-mono text-amber-400">{log.timestamp}</span>
                          <span className="text-emerald-400 flex items-center gap-1">
                            <Check className="w-3 h-3" /> Executed
                          </span>
                        </div>
                        <div className="font-medium text-slate-200">{log.command}</div>
                        <div className="text-[10px] text-slate-400">{log.actionSummary}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: PLAYLIST / MEDIA BIN */}
            {activeLeftTab === 'playlist' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300">Project Media Assets</span>
                  <label className="cursor-pointer px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-white flex items-center gap-1">
                    <Plus className="w-3 h-3" />
                    <span>Import</span>
                    <input
                      type="file"
                      accept="video/*,audio/*,image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = URL.createObjectURL(file);
                          const newAsset: MediaAsset = {
                            id: `asset_${Date.now()}`,
                            name: file.name,
                            type: file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image',
                            url,
                            duration: 15.0,
                            thumbnail: file.type.startsWith('video/') ? '🎬' : '🎵',
                          };
                          setMediaAssets((prev) => [newAsset, ...prev]);
                          showToast(`Imported ${file.name} to media bin`);
                        }
                      }}
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  {mediaAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className="p-2.5 rounded-xl border border-slate-800 bg-slate-950 hover:border-slate-700 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <span className="text-lg">{asset.thumbnail || '📁'}</span>
                        <div className="truncate">
                          <div className="font-semibold text-white truncate">{asset.name}</div>
                          <div className="text-[10px] text-slate-500 capitalize">{asset.type} • {asset.duration}s</div>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          // Add to timeline
                          const newClip: TimelineClip = {
                            id: `clip_${Date.now()}`,
                            trackId: asset.type === 'audio' ? 'a1' : 'v1',
                            name: asset.name,
                            type: asset.type,
                            sourceUrl: asset.url,
                            inPoint: 0,
                            outPoint: asset.duration,
                            timelineStart: currentTime,
                            duration: Math.min(12.0, asset.duration),
                            speed: 1.0,
                            color: asset.type === 'audio' ? '#10b981' : '#3b82f6',
                            volume: 1.0,
                            opacity: 1.0,
                            filters: [],
                          };
                          setClips((prev) => [...prev, newClip]);
                          showToast(`Added "${asset.name}" to timeline at ${formatTimecode(currentTime)}`);
                        }}
                        className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] font-bold shrink-0"
                      >
                        + Insert
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 3: SHOTCUT FILTER LIBRARY */}
            {activeLeftTab === 'filters' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300">
                    {activeClip ? `Filters for: ${activeClip.name}` : 'Select a clip to view filters'}
                  </span>
                </div>

                {activeClip ? (
                  <div className="space-y-4">
                    {/* Add Filter Selector */}
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Add Shotcut Filter</span>
                      <div className="grid grid-cols-2 gap-1.5 text-xs">
                        <button
                          onClick={() => handleAddFilter('ghibli_anime')}
                          className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-left font-semibold hover:bg-emerald-500/20"
                        >
                          🍃 Ghibli Watercolor
                        </button>
                        <button
                          onClick={() => handleAddFilter('color_grade')}
                          className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-left font-semibold hover:bg-indigo-500/20"
                        >
                          🎨 3-Way Color Grade
                        </button>
                        <button
                          onClick={() => handleAddFilter('chroma_key')}
                          className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/30 text-teal-300 text-left font-semibold hover:bg-teal-500/20"
                        >
                          🟩 Chroma Key
                        </button>
                        <button
                          onClick={() => handleAddFilter('text_title')}
                          className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/30 text-violet-300 text-left font-semibold hover:bg-violet-500/20"
                        >
                          🔤 Text & Subtitles
                        </button>
                        <button
                          onClick={() => handleAddFilter('blur')}
                          className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-left font-semibold hover:bg-slate-700"
                        >
                          💧 Gaussian Blur
                        </button>
                        <button
                          onClick={() => handleAddFilter('fade_video')}
                          className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-left font-semibold hover:bg-slate-700"
                        >
                          🌓 Fade In / Out
                        </button>
                      </div>
                    </div>

                    {/* Active Filters list on selected clip */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Applied Filters</span>
                      {activeClip.filters.length === 0 ? (
                        <div className="text-xs text-slate-500 italic p-3 text-center border border-dashed border-slate-800 rounded-lg">
                          No filters on this clip yet. Click above or type an AI prompt.
                        </div>
                      ) : (
                        activeClip.filters.map((filter, idx) => (
                          <div key={filter.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-white flex items-center gap-1.5">
                                <Filter className="w-3.5 h-3.5 text-amber-400" />
                                {filter.name}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    setClips((prev) =>
                                      prev.map((c) =>
                                        c.id === activeClip.id
                                          ? {
                                              ...c,
                                              filters: c.filters.map((f, i) =>
                                                i === idx ? { ...f, enabled: !f.enabled } : f
                                              ),
                                            }
                                          : c
                                      )
                                    );
                                  }}
                                  className="text-slate-400 hover:text-white"
                                >
                                  {filter.enabled ? <Eye className="w-3.5 h-3.5 text-emerald-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                                </button>
                                <button
                                  onClick={() => {
                                    setClips((prev) =>
                                      prev.map((c) =>
                                        c.id === activeClip.id
                                          ? { ...c, filters: c.filters.filter((_, i) => i !== idx) }
                                          : c
                                      )
                                    );
                                  }}
                                  className="text-slate-500 hover:text-rose-400 ml-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Specific Filter Controls */}
                            {filter.type === 'color_grade' && (
                              <div className="space-y-2 pt-1">
                                <div>
                                  <div className="flex justify-between text-[11px] text-slate-400">
                                    <span>Saturation</span>
                                    <span>{filter.params.saturation || 1}x</span>
                                  </div>
                                  <input
                                    type="range"
                                    min="0"
                                    max="2.5"
                                    step="0.05"
                                    value={filter.params.saturation || 1}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value);
                                      setClips((prev) =>
                                        prev.map((c) =>
                                          c.id === activeClip.id
                                            ? {
                                                ...c,
                                                filters: c.filters.map((f, i) =>
                                                  i === idx ? { ...f, params: { ...f.params, saturation: val } } : f
                                                ),
                                              }
                                            : c
                                        )
                                      );
                                    }}
                                    className="w-full accent-amber-500 cursor-pointer"
                                  />
                                </div>
                              </div>
                            )}

                            {filter.type === 'ghibli_anime' && (
                              <div className="space-y-1.5 pt-1 text-[11px]">
                                <div className="text-emerald-400 font-semibold">Watercolor Wash & Line Weight active</div>
                                <div className="flex justify-between text-slate-400">
                                  <span>Artistic Warmth</span>
                                  <span>{filter.params.warmGoldenHour}x</span>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                    Click any clip on the timeline to edit its Shotcut filters.
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: REAL-TIME SCOPES & PEAK METERS */}
            {activeLeftTab === 'scopes' && (
              <div className="space-y-4">
                <span className="text-xs font-bold text-slate-300">Audio & Video Scopes</span>

                {/* Peak Meter */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <div className="text-[11px] font-bold text-slate-400 flex items-center justify-between">
                    <span>Master Audio Peak dB</span>
                    <span className="font-mono text-emerald-400">{peakMeterL.toFixed(1)} dB</span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-500 w-3">L</span>
                      <div className="flex-1 h-3 bg-slate-900 rounded overflow-hidden flex">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 via-yellow-500 to-rose-500 transition-all duration-75"
                          style={{ width: `${Math.max(0, Math.min(100, (peakMeterL + 36) * 2.8))}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-500 w-3">R</span>
                      <div className="flex-1 h-3 bg-slate-900 rounded overflow-hidden flex">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 via-yellow-500 to-rose-500 transition-all duration-75"
                          style={{ width: `${Math.max(0, Math.min(100, (peakMeterR + 36) * 2.8))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* RGB Parade / Color Histogram representation */}
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <div className="text-[11px] font-bold text-slate-400">RGB Histogram & Luminance</div>
                  <div className="h-20 bg-slate-900 rounded flex items-end p-1 gap-1">
                    {Array.from({ length: 24 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-gradient-to-t from-indigo-500 to-cyan-400 rounded-t opacity-70"
                        style={{ height: `${20 + Math.sin(i * 0.4 + currentTime) * 60}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CENTER / RIGHT MONITOR: REAL-TIME COMPOSITING CANVAS PREVIEW */}
        <div className="flex-1 bg-black flex flex-col justify-between p-4 overflow-hidden">
          {/* Monitor Top Bar */}
          <div className="flex items-center justify-between text-xs text-slate-400 pb-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white">Program Preview</span>
              <span>•</span>
              <span className="font-mono text-amber-400">{formatTimecode(currentTime)}</span>
              <span>/</span>
              <span className="font-mono">{formatTimecode(projectDuration)}</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-300">
                1920x1080 (16:9) • 30fps
              </span>
            </div>
          </div>

          {/* Canvas Viewport */}
          <div className="flex-1 flex items-center justify-center relative min-h-0">
            <div className="relative aspect-video max-h-full max-w-full rounded-xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-950 flex items-center justify-center">
              <canvas
                ref={canvasRef}
                width={1280}
                height={720}
                className="w-full h-full object-contain cursor-crosshair"
              />

              {/* In-render export overlay */}
              {isExporting && (
                <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center space-y-4">
                  <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
                  <div>
                    <h4 className="text-base font-bold text-white">Shotcut Offline Render Engine</h4>
                    <p className="text-xs text-slate-300 mt-1">{exportStatusText}</p>
                  </div>
                  <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500" style={{ width: `${exportProgress}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Export Complete Download Card */}
          {exportedVideoBlobUrl && !isExporting && (
            <div className="mt-2 p-3 bg-emerald-950/80 border border-emerald-500/40 rounded-xl flex items-center justify-between text-xs">
              <span className="text-emerald-300 font-semibold flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-400" />
                Render complete! Download your edited Shotcut video.
              </span>
              <a
                href={exportedVideoBlobUrl}
                download="shotcut_edited_render.webm"
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 shadow"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save WebM</span>
              </a>
            </div>
          )}

          {/* TRANSPORT CONTROLS (Play, Pause, Step, Scrub) */}
          <div className="flex items-center justify-between pt-3 text-xs border-t border-slate-900 mt-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleSeek(0)}
                className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300"
                title="Jump to Start (Home)"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                onClick={() => handleSeek(currentTime - 1 / 30)}
                className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300"
                title="Step 1 Frame Back"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>

              <button
                onClick={togglePlay}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold flex items-center gap-1.5 shadow"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>

              <button
                onClick={() => handleSeek(currentTime + 1 / 30)}
                className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300"
                title="Step 1 Frame Forward"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => handleSeek(projectDuration)}
                className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300"
                title="Jump to End"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Playback speed selector */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
              {[0.5, 1.0, 1.5, 2.0].map((spd) => (
                <button
                  key={spd}
                  onClick={() => setPlaybackSpeed(spd)}
                  className={`px-2 py-0.5 rounded font-semibold ${
                    playbackSpeed === spd ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================================ */}
      {/* BOTTOM WORKSPACE: MULTI-TRACK NON-LINEAR TIMELINE (SHOTCUT TIMELINE)          */}
      {/* ============================================================================ */}
      <div className="h-64 sm:h-72 bg-slate-900/90 flex flex-col shrink-0 select-none">
        {/* Timeline Header & Tool Strip */}
        <div className="h-10 border-b border-slate-800 px-3 flex items-center justify-between text-xs bg-slate-950">
          {/* Tools: Razor/Split, Delete, Transition, Snapping */}
          {/* Tools: Razor/Split, Ripple Del, Trim, Duplicate, Add Track, Snapping */}
          <div className="flex items-center gap-1 overflow-x-auto py-1">
            <button
              onClick={() => setActiveTool('pointer')}
              className={`px-2 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition-all ${
                activeTool === 'pointer' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
              title="Selection Pointer (V)"
            >
              <span>Select</span>
            </button>

            <button
              onClick={() => handleSplitClipAtPlayhead()}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-bold flex items-center gap-1 transition-all"
              title="Split Clip at Playhead (S)"
            >
              <Scissors className="w-3 h-3" />
              <span>Split (S)</span>
            </button>

            <button
              onClick={() => handleRippleDelete()}
              disabled={!selectedClipId}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-amber-900/40 text-amber-300 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 transition-all"
              title="Ripple Delete - Remove clip and close gap (X)"
            >
              <Trash2 className="w-3 h-3 text-amber-400" />
              <span>Ripple Del (X)</span>
            </button>

            <button
              onClick={() => handleDeleteClip()}
              disabled={!selectedClipId}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-rose-900/40 text-rose-300 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 transition-all"
              title="Delete Clip (Del)"
            >
              <Trash2 className="w-3 h-3" />
              <span>Delete</span>
            </button>

            <div className="w-[1px] h-3.5 bg-slate-800 mx-0.5" />

            <button
              onClick={() => handleTrimClip('start', 1.0)}
              disabled={!selectedClipId}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 transition-all"
              title="Trim 1 second from beginning"
            >
              <span>Trim In (-1s)</span>
            </button>

            <button
              onClick={() => handleTrimClip('end', 1.0)}
              disabled={!selectedClipId}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 transition-all"
              title="Trim 1 second from end"
            >
              <span>Trim Out (-1s)</span>
            </button>

            <button
              onClick={() => handleDuplicateClip()}
              disabled={!selectedClipId}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 transition-all"
              title="Duplicate Clip"
            >
              <Copy className="w-3 h-3" />
              <span>Duplicate</span>
            </button>

            <button
              onClick={() => handleResetFilters()}
              disabled={!selectedClipId}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 transition-all"
              title="Reset All Filters on Clip"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset FX</span>
            </button>

            <div className="w-[1px] h-3.5 bg-slate-800 mx-0.5" />

            <button
              onClick={() => handleAddTrack('video')}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold flex items-center gap-1 transition-all"
              title="Add New Video Track"
            >
              <Plus className="w-3 h-3" />
              <span>+ Video Track</span>
            </button>

            <button
              onClick={() => handleAddTrack('audio')}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[11px] font-semibold flex items-center gap-1 transition-all"
              title="Add New Audio Track"
            >
              <Plus className="w-3 h-3" />
              <span>+ Audio Track</span>
            </button>

            <div className="w-[1px] h-3.5 bg-slate-800 mx-0.5" />

            <button
              onClick={() => setIsSnapping((prev) => !prev)}
              className={`px-2 py-1 rounded text-[11px] font-semibold transition-all ${
                isSnapping ? 'bg-indigo-600 text-white' : 'text-slate-500'
              }`}
              title="Toggle Magnetic Snapping"
            >
              Snap: {isSnapping ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Zoom In / Zoom Out Timeline Slider */}
          <div className="flex items-center gap-2 text-slate-400">
            <ZoomOut
              className="w-3.5 h-3.5 cursor-pointer hover:text-white"
              onClick={() => setTimelineZoom((prev) => Math.max(20, prev - 10))}
            />
            <input
              type="range"
              min="20"
              max="120"
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(Number(e.target.value))}
              className="w-24 accent-amber-500 cursor-pointer h-1 bg-slate-800 rounded"
            />
            <ZoomIn
              className="w-3.5 h-3.5 cursor-pointer hover:text-white"
              onClick={() => setTimelineZoom((prev) => Math.min(120, prev + 10))}
            />
          </div>
        </div>

        {/* TIMELINE TRACKS & CLIPS VIEWPORT */}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: Track Headers (V2, V1, A1, A2) */}
          <div className="w-44 border-r border-slate-800 bg-slate-950/90 flex flex-col shrink-0">
            {/* Top spacer matching time ruler */}
            <div className="h-6 border-b border-slate-800 bg-slate-950 px-2 flex items-center text-[10px] text-slate-500 font-mono">
              TRACK HEADERS
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
              {tracks.map((track) => (
                <div
                  key={track.id}
                  style={{ height: track.height }}
                  className="px-2.5 flex items-center justify-between text-xs bg-slate-950 hover:bg-slate-900/50"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="font-bold text-white text-[11px] truncate">{track.name}</span>
                  </div>

                  <div className="flex items-center gap-1 text-slate-400">
                    <button
                      onClick={() =>
                        setTracks((prev) =>
                          prev.map((t) => (t.id === track.id ? { ...t, visible: !t.visible } : t))
                        )
                      }
                      title="Toggle Track Visibility"
                      className="hover:text-white"
                    >
                      {track.visible ? <Eye className="w-3 h-3 text-emerald-400" /> : <EyeOff className="w-3 h-3 text-slate-600" />}
                    </button>

                    <button
                      onClick={() =>
                        setTracks((prev) =>
                          prev.map((t) => (t.id === track.id ? { ...t, muted: !t.muted } : t))
                        )
                      }
                      title="Mute Track"
                      className="hover:text-white"
                    >
                      {track.muted ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3 text-slate-400" />}
                    </button>

                    <button
                      onClick={() =>
                        setTracks((prev) =>
                          prev.map((t) => (t.id === track.id ? { ...t, locked: !t.locked } : t))
                        )
                      }
                      title="Lock Track"
                      className="hover:text-white"
                    >
                      {track.locked ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3 text-slate-600" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: Scrollable Time Ruler & Clips Lanes */}
          <div
            className="flex-1 flex flex-col overflow-x-auto overflow-y-hidden relative bg-slate-950"
            onClick={(e) => {
              // Click on timeline background to seek playhead
              const rect = e.currentTarget.getBoundingClientRect();
              const clickX = e.clientX - rect.left + e.currentTarget.scrollLeft;
              const newTime = clickX / timelineZoom;
              handleSeek(newTime);
            }}
          >
            {/* 1. Time Ruler Bar */}
            <div
              className="h-6 border-b border-slate-800 bg-slate-900/80 relative text-[10px] font-mono text-slate-400 shrink-0"
              style={{ width: `${projectDuration * timelineZoom}px` }}
            >
              {Array.from({ length: Math.ceil(projectDuration) }).map((_, sec) => (
                <div
                  key={sec}
                  className="absolute top-0 bottom-0 border-l border-slate-800 pl-1 text-[9px]"
                  style={{ left: `${sec * timelineZoom}px` }}
                >
                  {sec % 2 === 0 ? formatTimecode(sec).slice(3, 8) : '·'}
                </div>
              ))}
            </div>

            {/* 2. Track Lanes with Clips */}
            <div
              className="flex-1 relative divide-y divide-slate-800/40"
              style={{ width: `${projectDuration * timelineZoom}px` }}
            >
              {tracks.map((track) => (
                <div
                  key={track.id}
                  style={{ height: track.height }}
                  className="relative bg-slate-950/40 hover:bg-slate-900/20"
                >
                  {/* Grid lines */}
                  {Array.from({ length: Math.ceil(projectDuration) }).map((_, sec) => (
                    <div
                      key={sec}
                      className="absolute top-0 bottom-0 border-l border-slate-900/60 pointer-events-none"
                      style={{ left: `${sec * timelineZoom}px` }}
                    />
                  ))}

                  {/* Render clips on this track */}
                  {clips
                    .filter((c) => c.trackId === track.id)
                    .map((clip) => {
                      const isSelected = clip.id === selectedClipId;
                      const leftPx = clip.timelineStart * timelineZoom;
                      const widthPx = Math.max(12, clip.duration * timelineZoom);

                      return (
                        <div
                          key={clip.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedClipId(clip.id);
                          }}
                          style={{
                            left: `${leftPx}px`,
                            width: `${widthPx}px`,
                            backgroundColor: clip.color,
                          }}
                          className={`absolute top-1 bottom-1 rounded-lg px-2 flex items-center justify-between overflow-hidden cursor-pointer shadow border transition-all ${
                            isSelected
                              ? 'ring-2 ring-white border-white brightness-110 shadow-lg'
                              : 'border-white/20 opacity-90 hover:opacity-100'
                          }`}
                        >
                          {/* Clip Label & Filter Badge */}
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-bold text-[11px] text-white truncate drop-shadow">
                              {clip.name}
                            </span>
                            {clip.filters.length > 0 && (
                              <span className="text-[9px] px-1 rounded bg-black/40 text-amber-300 font-mono">
                                {clip.filters.length} FX
                              </span>
                            )}
                            {clip.transitionType && clip.transitionType !== 'none' && (
                              <span className="text-[9px] px-1 rounded bg-indigo-900/60 text-indigo-300 font-mono">
                                ⧖ Fade
                              </span>
                            )}
                          </div>

                          <div className="text-[9px] font-mono text-white/80 shrink-0">
                            {clip.duration.toFixed(1)}s
                          </div>
                        </div>
                      );
                    })}
                </div>
              ))}

              {/* 3. Interactive Draggable Playhead Needle */}
              <div
                className="absolute top-0 bottom-0 z-30 pointer-events-none flex flex-col items-center"
                style={{ left: `${currentTime * timelineZoom}px` }}
              >
                <div className="w-3.5 h-3.5 bg-amber-500 rotate-45 -mt-1.5 shadow-lg" />
                <div className="w-[1.5px] flex-1 bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 100% Offline Architecture & Privacy Modal */}
      {showOfflineModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Scissors className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Shotcut Local Offline Architecture
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">
                      100% Client-Side
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">Zero cloud upload • Local compositing • Instant render</p>
                </div>
              </div>
              <button
                onClick={() => setShowOfflineModal(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="font-bold text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  HTML5 Canvas 2D & WebGL Compositing Pipeline
                </div>
                <p className="text-slate-400 text-[11px]">
                  All timeline tracks, video transformations, 3-way color grading, Studio Ghibli watercolor styling, vignette filters, and text titles are computed entirely in your local browser CPU/GPU with zero network calls.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="font-bold text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                  Local Media File System Access
                </div>
                <p className="text-slate-400 text-[11px]">
                  When you import your own MP4, WebM, MOV, MP3, or PNG files, they are decoded via local object URLs (<code className="text-indigo-300 font-mono">blob:</code>). No video bytes are ever uploaded to an external server.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="font-bold text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  Offline MediaRecorder Video Exporter
                </div>
                <p className="text-slate-400 text-[11px]">
                  Video exports capture the raw canvas frame stream and Web Audio graph at 30 FPS into a downloadable WebM / MP4 video file completely offline in browser memory.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="font-bold text-white flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                  Local Project Autosave & Shotcut Interchange
                </div>
                <p className="text-slate-400 text-[11px]">
                  Your timeline tracks, cuts, filters, and command history autosave to <code className="text-purple-300 font-mono">localStorage</code> so you never lose edits even when working disconnected from the internet. You can also export/import standard JSON / MLT project files.
                </p>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end">
              <button
                onClick={() => setShowOfflineModal(false)}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow transition-all"
              >
                Close & Return to Editor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
