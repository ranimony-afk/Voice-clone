import React, { useState } from 'react';
import { Terminal, Copy, Check, Code, Zap } from 'lucide-react';

export const ApiReferenceView: React.FC = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const [activeLang, setActiveLang] = useState<'python' | 'node' | 'curl'>('python');

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const codeSnippets = {
    python: `# Illustrative pseudocode only; no supported Python SDK/package is shipped here.
from voiceforge import VoiceForgeClient, Language

# This placeholder API key is not evidence of server-side end-user authentication.
client = VoiceForgeClient(api_key="<example-only>")

# 1. Illustrative TTS example; provider-backed use is release/environment gated.
audio_bytes = client.tts.synthesize(
    text="கப்பல் கடலில் சென்றது. தங்கம் விலை ₹65,400 ஆக உயர்ந்தது.",
    voice_id="vf_priya_ta",
    language=Language.TAMIL,
    stability=0.80,
    speed=1.0,
    format="wav"
)

with open("output.wav", "wb") as f:
    f.write(audio_bytes)

# 2. Streaming example only; no latency or provider availability is guaranteed.
# Live/provider-backed streaming is not generally available.
for chunk in client.tts.synthesize_stream(
    text="Illustrative streaming example.",
    voice_id="vf_sarah_en"
):
    stream_audio_to_speakers(chunk.pcm_bytes)

# 3. Cloning is unavailable: current clone/enrollment routes are release-gated (503).
# No SDK call here provisions a voice or verifies identity, liveness, or consent.`,

    node: `// Illustrative pseudocode only; @voiceforge/sdk is not shipped or supported here.
import { VoiceForgeClient } from '@voiceforge/sdk';
import * as fs from 'fs';

// This example key is not validated by the current API as end-user authentication.
const client = new VoiceForgeClient({ apiKey: '<example-only>' });

// TTS use is gated; provider-backed availability and performance are not guaranteed.
// 1. Illustrative multilingual synthesis example
async function run() {
  const response = await client.tts.synthesize({
    text: 'कमल और कमला ने डॉक्टर साहब को ₹5,50,000 का चेक दिया।',
    voiceId: 'vf_aarav_hi',
    language: 'hi',
    settings: {
      stability: 0.85,
      similarity: 0.90,
      pitch: 0
    }
  });

  fs.writeFileSync('output.wav', Buffer.from(response.audioBase64, 'base64'));
  // If supplied by a deployed service, watermark metadata concerns artifact integrity/provenance only;
  // it does not prove speaker identity or consent. This response is illustrative pseudocode.
}

run();`,

    curl: `# Illustrative request only; the server does not establish end-user auth from a Bearer header.
# TTS may return 503; only an explicit non-production local formant stub is conditionally allowed.
curl -X POST "http://localhost:3000/api/tts/synthesize" \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "Hello world! வணக்கம், நமஸ்காரம், こんにちは!",
    "voiceId": "vf_priya_ta",
    "language": "ta",
    "settings": {
      "stability": 0.8,
      "similarity": 0.88,
      "speed": 1.0,
      "pitch": 0
    }
  }'

# 2. Multilingual Text Front-End Normalization & G2P Analysis
curl -X POST "http://localhost:3000/api/frontend/analyze" \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "இந்த project ரொம்ப awesome-ஆ இருக்கு bro, ₹10,000 prize!",
    "language": "ta"
  }'

# 3. Watermark integrity/provenance check (not proof of speaker identity or consent).
# Replace this placeholder with a valid system-issued signature; this is not a working credential.
curl -X POST "http://localhost:3000/api/audio/verify-watermark" \\
  -H "Content-Type: application/json" \\
  -d '{
    "signature": "<system-issued-signature>"
  }'`,
  };

  return (
    <div className="space-y-8 py-6">
      {/* Intro */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            <Zap className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-white">Illustrative API Examples & Capability Status</h2>
        </div>
        <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
          These examples are illustrative, not supported SDKs or proof of service availability. Clone, enrollment, upload, export, and cross-lingual routes are release-gated (503). Provider-backed TTS and live streaming are not generally available; only a specific non-production local formant TTS stub may be enabled. The shown Bearer/API-key placeholders do not establish end-user authentication. Watermark HMACs concern artifact integrity/provenance, not speaker identity or consent. No offline voice-model export is available.
        </p>
      </div>

      {/* Code Viewer */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-6 py-3 bg-slate-950/80 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveLang('python')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeLang === 'python' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Python example
            </button>
            <button
              onClick={() => setActiveLang('node')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeLang === 'node' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Node.js example
            </button>
            <button
              onClick={() => setActiveLang('curl')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeLang === 'curl' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              cURL (REST)
            </button>
          </div>

          <button
            onClick={() => copyToClipboard(codeSnippets[activeLang], activeLang)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            {copied === activeLang ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>

        <div className="p-6 bg-slate-950 font-mono-code text-xs text-slate-200 overflow-x-auto leading-relaxed">
          <pre>{codeSnippets[activeLang]}</pre>
        </div>
      </div>
    </div>
  );
};
