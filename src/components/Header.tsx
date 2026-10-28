import React, { useState, useEffect } from 'react';
import { Volume2, Sparkles, Activity, ShieldCheck, Zap, Music, Image as ImageIcon, Film, Radio, Layers, CreditCard, Languages, Scissors, Loader2, UserX, AlertCircle } from 'lucide-react';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  voiceCount: number;
}

interface UserPrincipal {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: UserPrincipal }
  | { status: 'signed-out' }
  | { status: 'error'; message: string };

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, voiceCount }) => {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let isMounted = true;

    async function loadPrincipal() {
      try {
        let token = localStorage.getItem('voiceforge_token');

        // If no token exists yet in browser session, attempt development sandbox bootstrap (empty body; no identity claims)
        if (!token) {
          const bootstrapRes = await fetch('/api/v1/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (bootstrapRes.ok) {
            const data = await bootstrapRes.json();
            if (data.token && typeof data.token === 'string') {
              token = data.token;
              localStorage.setItem('voiceforge_token', data.token);
            }
          }
        }

        if (!token) {
          if (isMounted) setAuthState({ status: 'signed-out' });
          return;
        }

        const meRes = await fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (meRes.ok) {
          const data = await meRes.json();
          if (isMounted) {
            setAuthState({
              status: 'authenticated',
              user: data.user,
            });
          }
        } else if (meRes.status === 401 || meRes.status === 403) {
          localStorage.removeItem('voiceforge_token');
          if (isMounted) setAuthState({ status: 'signed-out' });
        } else {
          if (isMounted) {
            setAuthState({ status: 'error', message: `Auth error: HTTP ${meRes.status}` });
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setAuthState({ status: 'error', message: err.message || 'Authentication check failed' });
        }
      }
    }

    loadPrincipal();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSignIn = async () => {
    setAuthState({ status: 'loading' });
    try {
      const res = await fetch('/api/v1/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem('voiceforge_token', data.token);
        setAuthState({ status: 'authenticated', user: data.user });
      } else {
        setAuthState({
          status: 'error',
          message: data.error || 'Authentication provider is not configured',
        });
      }
    } catch (e: any) {
      setAuthState({ status: 'error', message: e.message });
    }
  };

  const handleSignOut = async () => {
    const token = localStorage.getItem('voiceforge_token');
    if (token) {
      fetch('/api/v1/auth/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    }
    localStorage.removeItem('voiceforge_token');
    setAuthState({ status: 'signed-out' });
  };
  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 ring-1 ring-white/20">
              <Volume2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                  VoiceForge
                </span>
                <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Multimodal
                </span>
              </div>
              <p className="text-xs text-slate-400">
                AI Voice, Music, Image & Video Studio • EN • தமிழ் • हिन्दी • മലയാളം • 日本語
              </p>
            </div>
          </div>

          {/* Runtime Metrics & Status */}
          <div className="hidden lg:flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-300">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Target RTF: <strong className="text-white">&lt;0.25</strong></span>
              <span className="text-slate-600">|</span>
              <span>TTFB: <strong className="text-white">&lt;450ms</strong></span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Online ({voiceCount} voices)</span>
            </div>

            {authState.status === 'loading' && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span>Authenticating...</span>
              </div>
            )}

            {authState.status === 'authenticated' && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 font-medium"
                title={`Authenticated principal: ${authState.user.email} (${authState.user.id})`}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>
                  {authState.user.fullName}{' '}
                  <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-indigo-600/30 text-indigo-300 border border-indigo-400/20">
                    {authState.user.role}
                  </span>
                </span>
                <button
                  onClick={handleSignOut}
                  className="ml-1 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  title="Sign Out Session"
                >
                  <UserX className="w-3 h-3" />
                </button>
              </div>
            )}

            {authState.status === 'signed-out' && (
              <button
                onClick={handleSignIn}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 transition-all cursor-pointer"
                title="Click to sign in with session token"
              >
                <UserX className="w-3.5 h-3.5 text-slate-400" />
                <span>Signed Out</span>
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-indigo-600/40 text-indigo-200">
                  Sign In
                </span>
              </button>
            )}

            {authState.status === 'error' && (
              <button
                onClick={handleSignIn}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs cursor-pointer"
                title={authState.message}
              >
                <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                <span>Auth Error</span>
                <span className="text-[10px] underline ml-1">Retry</span>
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto py-2 border-t border-slate-800/60 text-xs sm:text-sm">
          <button
            onClick={() => setActiveTab('tts')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'tts'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>TTS Studio</span>
          </button>

          <button
            onClick={() => setActiveTab('cloning')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'cloning'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Voice Cloning & Consent</span>
          </button>

          <button
            onClick={() => setActiveTab('transcribe')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'transcribe'
                ? 'bg-teal-600 text-white shadow-md shadow-teal-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Languages className="w-3.5 h-3.5 text-teal-400" />
            <span>Transcribe & Translate (A/V)</span>
          </button>

          <button
            onClick={() => setActiveTab('voicestudio')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'voicestudio'
                ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-violet-400" />
            <span>VoiceStudio Suite</span>
          </button>

          <button
            onClick={() => setActiveTab('music')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'music'
                ? 'bg-pink-600 text-white shadow-md shadow-pink-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Music className="w-3.5 h-3.5 text-pink-400" />
            <span>Music (Lyria)</span>
          </button>

          <button
            onClick={() => setActiveTab('images')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'images'
                ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
            <span>Images (Nano Banana)</span>
          </button>

          <button
            onClick={() => setActiveTab('shotcut')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'shotcut'
                ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-md shadow-orange-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-bold">Shotcut Studio (AI NLE)</span>
          </button>

          <button
            onClick={() => setActiveTab('videos')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'videos'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Film className="w-3.5 h-3.5 text-amber-400" />
            <span>Videos & Anime (Veo 3.1)</span>
          </button>

          <button
            onClick={() => setActiveTab('live')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'live'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span>Live Voice Agent</span>
          </button>

          <button
            onClick={() => setActiveTab('phonetics')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'phonetics'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Phonetic Lab (G2P)</span>
          </button>

          <button
            onClick={() => setActiveTab('arch')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'arch'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Architecture & DB</span>
          </button>

          <button
            onClick={() => setActiveTab('api')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'api'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>APIs & SDKs</span>
          </button>

          <button
            onClick={() => setActiveTab('billing')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'billing'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Billing & Usage</span>
          </button>
        </div>
      </div>
    </header>
  );
};

