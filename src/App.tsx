/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { ArchitectureView } from './components/ArchitectureView.tsx';
import { PhoneticLabView } from './components/PhoneticLabView.tsx';
import { TTSStudioView } from './components/TTSStudioView.tsx';
import { VoiceCloningLabView } from './components/VoiceCloningLabView.tsx';
import { ApiReferenceView } from './components/ApiReferenceView.tsx';
import { MusicStudioView } from './components/MusicStudioView.tsx';
import { ImageStudioView } from './components/ImageStudioView.tsx';
import { VideoStudioView } from './components/VideoStudioView.tsx';
import { LiveConversationView } from './components/LiveConversationView.tsx';
import { VoiceStudioSuiteView } from './components/VoiceStudioSuiteView.tsx';
import { BillingDashboard } from './components/BillingDashboard.tsx';
import { MediaTranscribeTranslateView } from './components/MediaTranscribeTranslateView.tsx';
import { ShotcutEditorView } from './components/ShotcutEditorView.tsx';
import VisualStudioView from './components/VisualStudioView.tsx';
import { DEFAULT_VOICES } from '../server/data/voices.ts';
import { VoiceProfile } from '../server/engine/types.ts';
import { Shield, CheckCircle2 } from 'lucide-react';

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
        {activeTab === 'visual' && <VisualStudioView />}
        {activeTab === 'billing' && <BillingDashboard />}
      </main>

      {/* Bottom Compliance & System Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/90 py-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span className="font-medium text-slate-400">VoiceForge prototype · neural inference and media features require deployment validation</span>
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1 text-slate-400">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              <span>Signed provenance metadata only · no in-audio watermark claim</span>
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
