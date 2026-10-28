# VoiceForge Professional Workstation Design System (VF-DS 2.0)

**Document Version**: 2.0.0  
**Status**: Adopted & Active (Phase 2B)  
**Target Platform**: Full-Stack React 19 + TypeScript + Tailwind CSS  
**Design Intelligence Reference**: `nextlevelbuilder/ui-ux-pro-max-skill` (Revision `d14efff`, MIT License)  
**Domain Archetype**: Professional Creative DAW & Multimodal AI Audio-Production Workstation  

---

## 1. Design Philosophy: The Professional Audio Workstation

VoiceForge is engineered as a **precision audio workstation (DAW)** rather than a generic promotional landing page. High-stakes audio engineering, cross-lingual localization, and zero-shot voice cloning require dense, legible, and deterministic user interfaces.

### Core Tenets
1. **Truth in State**: Every UI element must reflect actual backend capability. If neural diffusion weights are absent, the interface explicitly marks the mode as `[DEMO HARMONIC]` or `[UNAVAILABLE]`. No cosmetic, disconnected indicators.
2. **Dense Ergonomic Layout**: Audio producers need immediate access to script editors, acoustic sliders (stability, similarity, pitch, speed), and real-time spectrum visualizers without excessive vertical scrolling.
3. **Multilingual First-Class Typography**: Indian languages (Tamil, Hindi, Malayalam), Japanese, and English must render with native ligatures, correct line heights, and zero clipping of diacritics.
4. **Dark Studio Palette**: OLED and dark charcoal surfaces reduce visual fatigue during extended listening and editing sessions, while neon accentuation guides focus to transport controls and status changes.
5. **Fail-Closed Accessibility**: Meets WCAG 2.1 AA standards (minimum 4.5:1 text contrast), full keyboard navigation, screen-reader status announcements, and respect for `prefers-reduced-motion`.

---

## 2. Color Palette & Token Architecture

The color system is derived from professional recording console hardware (SSL/Neve/Avid) combined with OLED contrast standards.

### 2.1 Surface & Structural Colors
| Token Name | Hex Value | Tailwind Class | Semantic Usage |
| :--- | :--- | :--- | :--- |
| **`surface-canvas`** | `#080c14` | `bg-slate-950` | Primary application root background |
| **`surface-panel`** | `#0f172a` | `bg-slate-900` | Studio containers, card backgrounds |
| **`surface-subpanel`** | `#0a0f1d` | `bg-slate-950/80` | Inner console sections, waveform trays |
| **`surface-elevated`** | `#1e293b` | `bg-slate-800` | Popovers, active card states, modals |
| **`border-subtle`** | `#1e293b` | `border-slate-800` | Standard component separation |
| **`border-focus`** | `#6366f1` | `border-indigo-500` | Focused interactive elements |

### 2.2 Semantic Accent Colors
| Category | Hex Value | Tailwind Class | Semantic Meaning |
| :--- | :--- | :--- | :--- |
| **Primary Action** | `#4f46e5` → `#7c3aed` | `from-indigo-600 to-violet-600` | Synthesis trigger, primary export actions |
| **Neural Active** | `#10b981` | `text-emerald-400 bg-emerald-500/10` | Genuine OmniVoice neural inference online |
| **Demo / Synthetic** | `#f59e0b` | `text-amber-400 bg-amber-500/10` | Development harmonic formant fallback |
| **Unavailable / Error**| `#ef4444` | `text-red-400 bg-red-500/10` | Fail-closed state, service down, missing weights |
| **Audio Waveform** | `#6366f1` → `#a855f7` | Dynamic Canvas Gradient | Real-time FFT spectrum ribbons |
| **Provenance Watermark**| `#10b981` | `text-emerald-400` | C2PA-style cryptographic HMAC verified |

---

## 3. Typography & Internationalization (i18n)

### 3.1 Font Family Hierarchy
- **Primary Interface**: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif.
- **Indic Script Stack**: `'Noto Sans Tamil'`, `'Noto Sans Devanagari'`, `'Noto Sans Malayalam'`, sans-serif.
- **Japanese Script Stack**: `'Noto Sans JP'`, `'Hiragino Sans'`, Meiryo, sans-serif.
- **Technical & Acoustic Telemetry**: JetBrains Mono, 'Fira Code', ui-monospace, monospace.

### 3.2 Type Scale & Hierarchy
| Level | Size / Line Height | Tracking | Weight | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Display Header** | `1.5rem (24px) / 1.3` | `-0.02em` | Bold (700) | Studio View Titles (TTS Studio, Visual Studio) |
| **Panel Heading** | `1.125rem (18px) / 1.4` | `-0.01em` | SemiBold (600) | Console sub-headers, voice persona labels |
| **Body / Script** | `0.9375rem (15px) / 1.6` | Normal | Regular (400) | Text script input, SSML prompts |
| **Control Label** | `0.75rem (12px) / 1.2` | `+0.05em` | Bold (700) | Uppercase slider labels (STABILITY, PITCH) |
| **Telemetry Tag** | `0.6875rem (11px) / 1.2` | Monospace | Medium (500) | Sample rate, RTF, latency (ms), HMAC hash |

---

## 4. Workstation Component Standards

### 4.1 Truthful Execution Mode Indicators
The studio must always display the verified backend execution state:
```tsx
{/* NEURAL INFERENCE */}
<div className="bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
  ⚡ MODE: NEURAL INFERENCE • k2-fsa/OmniVoice-v0.2.1
</div>

{/* DEVELOPMENT DEMO HARMONIC */}
<div className="bg-amber-500/10 border-amber-500/30 text-amber-300">
  🧪 MODE: DEVELOPMENT DEMO HARMONIC • development_formant_fallback
</div>

{/* SERVICE UNAVAILABLE */}
<div className="bg-red-500/10 border-red-500/30 text-red-300">
  🚫 MODE: UNAVAILABLE • Neural weights offline
</div>
```

### 4.2 Acoustic Sliders & Knobs
- **Dual Value Indicator**: Every slider displays the percentage or unit value in high-contrast monospace (e.g. `80%`, `+2 st`, `1.25x`).
- **Descriptive Guidance**: A concise subtext explains the acoustic effect (e.g., *"Higher = monotonic stability; Lower = expressive dynamic pitch"*).
- **Engine Parity**: If a parameter (e.g., Style exaggeration) is unsupported in demo formant mode, the UI indicates its status rather than silently ignoring the input.

### 4.3 Audio Transport & Spectrum Canvas
- **Play/Pause Toggle**: High-visibility 40px circular control with distinct active state.
- **Waveform Canvas**: 64px height, 128-bin Web Audio `AnalyserNode` FFT rendering with dual-gradient bars and idle ambient sine sweep when paused.
- **Accurate Time Display**: Monospace `currentTime.toFixed(1)s / duration.toFixed(1)s (24 kHz PCM)`.
- **Signed Provenance Badge**: Displays truncated HMAC-SHA256 signature and cryptographic content hash for tamper verification.

---

## 5. Responsive Breakpoint Matrix

| Breakpoint | Target Screen | Layout Strategy |
| :--- | :--- | :--- |
| **`< 640px` (Mobile)** | 375px – 480px | Single-column stacked. Persona cards collapse into horizontal scroll; sliders dock below script. |
| **`640px – 1023px` (Tablet)** | 768px – 1024px | 2-column persona grid. Script editor full-width; acoustic controls split 50/50. |
| **`>= 1024px` (Desktop)** | 1024px – 1440px | 12-column grid: 8-column script & waveform console + 4-column acoustic rack. |
| **`>= 1440px` (Ultra-Wide)** | 1440px+ | Max width container 1600px, centered with studio margins. |

---

## 6. Accessibility & Keyboard Control Conventions

- **`Space`**: Toggle play/pause for active master audio output.
- **`Escape`**: Dismiss active error alert or modal dialog.
- **`Tab`**: Logical forward progression (Voice Selection -> Script Input -> Insert Tag -> Generate Button -> Transport Controls -> Sliders).
- **`Focus-Visible`**: Distinct `ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-950` on all interactive elements.
- **Screen Reader Announcements**: `aria-live="polite"` regions announce generation start, completion, and failure without visual interruption.
