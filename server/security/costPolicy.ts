export type CostPolicyEnvironment = {
  NODE_ENV?: string;
  VOICEFORGE_ALLOW_DEV_STUB_ENGINE?: string;
  GEMINI_API_KEY?: string;
  OMNIVOICE_SERVICE_URL?: string;
};

/** The explicit formant fallback is local/non-neural and must never proxy to a worker or paid provider. */
export function canUseLocalFormantStub(env: CostPolicyEnvironment = process.env): boolean {
  return env.NODE_ENV !== 'production' &&
    env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE === 'true' &&
    !env.OMNIVOICE_SERVICE_URL?.trim() &&
    (!env.GEMINI_API_KEY?.trim() || env.GEMINI_API_KEY.trim() === 'MY_GEMINI_API_KEY');
}

/** A live provider session is disabled in production and whenever a paid key is present. */
export function liveWebSocketDenialReason(env: CostPolicyEnvironment = process.env): string | undefined {
  if (env.NODE_ENV === 'production') return 'Live WebSocket sessions are disabled in production until authentication and usage controls are deployed.';
  const key = env.GEMINI_API_KEY?.trim();
  if (key && key !== 'MY_GEMINI_API_KEY') return 'Paid live-provider sessions are disabled until authentication and cost controls are deployed.';
  return undefined;
}

export function createLiveWebSocketUnavailableResponse(reason: string): string {
  const body = JSON.stringify({
    error: { code: 'PAID_FEATURE_DISABLED', message: reason },
  });
  return `HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}
