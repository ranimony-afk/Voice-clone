/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Header } from './components/Header.tsx';
import { TTSStudioView } from './components/TTSStudioView.tsx';
import { DEFAULT_VOICES } from '../server/data/voices.ts';
import { VoiceProfile } from '../server/engine/types.ts';
import { Shield, CheckCircle2, RefreshCw } from 'lucide-react';

// Lazy-loaded auxiliary studio views for code-splitting and bundle performance
const VoiceCloningLabView = lazy(() => import('./components/VoiceCloningLabView.tsx').then(m => ({ default: m.VoiceCloningLabView })));
const ArchitectureView = lazy(() => import('./components/ArchitectureView.tsx').then(m => ({ default: m.ArchitectureView })));
const PhoneticLabView = lazy(() => import('./components/PhoneticLabView.tsx').then(m => ({ default: m.PhoneticLabView })));
const ApiReferenceView = lazy(() => import('./components/ApiReferenceView.tsx').then(m => ({ default: m.ApiReferenceView })));
const MusicStudioView = lazy(() => import('./components/MusicStudioView.tsx').then(m => ({ default: m.MusicStudioView })));
const ImageStudioView = lazy(() => import('./components/ImageStudioView.tsx').then(m => ({ default: m.ImageStudioView })));
const VideoStudioView = lazy(() => import('./components/VideoStudioView.tsx').then(m => ({ default: m.VideoStudioView })));
const LiveConversationView = lazy(() => import('./components/LiveConversationView.tsx').then(m => ({ default: m.LiveConversationView })));
const VoiceStudioSuiteView = lazy(() => import('./components/VoiceStudioSuiteView.tsx').then(m => ({ default: m.VoiceStudioSuiteView })));
const BillingDashboard = lazy(() => import('./components/BillingDashboard.tsx').then(m => ({ default: m.BillingDashboard })));
const MediaTranscribeTranslateView = lazy(() => import('./components/MediaTranscribeTranslateView.tsx').then(m => ({ default: m.MediaTranscribeTranslateView })));
const ShotcutEditorView = lazy(() => import('./components/ShotcutEditorView.tsx').then(m => ({ default: m.ShotcutEditorView })));

const LoadingSpinner = () => (
  <div className="flex items-center justify-center p-12 text-slate-400 gap-3">
    <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
    <span className="text-sm">Loading studio module...</span>
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('tts');
  const [voices, setVoices] = useState<VoiceProfile[]>(DEFAULT_VOICES);

  // Fetch registered voices from server
  useEffect(() => {
    fetch('/api/voices')
      .then((res) => res.json())
      .then((data) => {
        if (data.voices && Array.isArray(data.voices)) {
          setVoices(data.voices);
        }
      })
      .catch((err) => {
        console.warn('Using local fallback voice catalog:', err);
      });
  }, []);

  const handleVoiceCreated = (newVoice: VoiceProfile) => {
    setVoices((prev) => [newVoice, ...prev]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        voiceCount={voices.length}
      />

      {/* Main Content Area */}
      <main className={`flex-1 w-full ${activeTab === 'shotcut' ? 'max-w-none px-0 pb-0' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16'}`}>
        <Suspense fallback={<LoadingSpinner />}>
          {activeTab === 'shotcut' && <ShotcutEditorView />}
          {activeTab === 'tts' && <TTSStudioView voices={voices} />}
          {activeTab === 'cloning' && (
            <VoiceCloningLabView
              onVoiceCreated={handleVoiceCreated}
              voices={voices}
              onOpenTts={() => setActiveTab('tts')}
            />
          )}
          {activeTab === 'transcribe' && (
            <MediaTranscribeTranslateView voices={voices} />
          )}
          {activeTab === 'voicestudio' && (
            <VoiceStudioSuiteView voices={voices} onVoiceDesigned={handleVoiceCreated} />
          )}
          {activeTab === 'music' && <MusicStudioView />}
          {activeTab === 'images' && <ImageStudioView />}
          {activeTab === 'videos' && <VideoStudioView />}
          {activeTab === 'live' && <LiveConversationView />}
          {activeTab === 'phonetics' && <PhoneticLabView />}
          {activeTab === 'arch' && <ArchitectureView />}
          {activeTab === 'api' && <ApiReferenceView />}
          {activeTab === 'billing' && <BillingDashboard />}
        </Suspense>
      </main>

      {/* Bottom Compliance & System Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/90 py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="font-medium text-slate-400">VoiceForge Studio v2.0 (Multilingual OmniVoice, Visual Studio & C2PA Provenance)</span>
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1 text-slate-400">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              <span>Cryptographic Provenance Signed (HMAC-SHA256)</span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-slate-400">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Commercial License Compliant</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
