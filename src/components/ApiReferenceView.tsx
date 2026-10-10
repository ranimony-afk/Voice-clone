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
    python: `# VoiceForge Official Python SDK (pip install voiceforge)
from voiceforge import VoiceForgeClient, Language

client = VoiceForgeClient(api_key="vf_live_your_api_key_here")

# 1. Text-to-Speech with Multilingual Tamil & Hindi
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

# 2. Low-latency Streaming TTS (<450ms TTFB)
for chunk in client.tts.synthesize_stream(
    text="Welcome to VoiceForge low-latency neural streaming.",
    voice_id="vf_sarah_en"
):
    stream_audio_to_speakers(chunk.pcm_bytes)

# 3. Instant Voice Cloning with Consent Verification
new_voice = client.voices.clone(
    name="Meera Studio",
    reference_audio_path="meera_sample_30s.wav",
    consent_audio_path="meera_consent_phrase.wav",
    target_languages=[Language.TAMIL, Language.HINDI, Language.ENGLISH]
)
print(f"Cloned voice provisioned: {new_voice.id}")`,

    node: `// VoiceForge Node.js SDK (npm install @voiceforge/sdk)
import { VoiceForgeClient } from '@voiceforge/sdk';
import * as fs from 'fs';

const client = new VoiceForgeClient({
  apiKey: process.env.VOICEFORGE_API_KEY
});

// 1. Synthesize Multilingual Utterance
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
  console.log(\`Generated in \${response.generationTimeMs}ms (Watermark: \${response.watermarkSignature})\`);
}

run();`,

    curl: `# 1. Text-to-Speech Synthesis Endpoint
curl -X POST "http://localhost:3000/api/tts/synthesize" \\
  -H "Authorization: Bearer vf_live_your_key" \\
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

# 3. Audio Watermark Verification
curl -X POST "http://localhost:3000/api/audio/verify-watermark" \\
  -H "Content-Type: application/json" \\
  -d '{
    "signature": "18f8e8b39a3f4c718b5329124a9cb481"
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
          <h2 className="text-2xl font-bold text-white">Developer REST API & SDKs</h2>
        </div>
        <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
          Comprehensive programmatic interface for real-time text-to-speech, streaming websockets, biometric voice cloning, and audio provenance verification.
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
              Python SDK
            </button>
            <button
              onClick={() => setActiveLang('node')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeLang === 'node' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Node.js SDK
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
