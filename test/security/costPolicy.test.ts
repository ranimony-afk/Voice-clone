import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseLocalFormantStub,
  createLiveWebSocketUnavailableResponse,
  liveWebSocketDenialReason,
} from '../../server/security/costPolicy.ts';

describe('cost-bearing route policy', () => {
  test('only explicit non-production formant synthesis with no remote worker or paid provider key is allowed', () => {
    const local = { NODE_ENV: 'development', VOICEFORGE_ALLOW_DEV_STUB_ENGINE: 'true' };
    assert.equal(canUseLocalFormantStub(local), true);
    assert.equal(canUseLocalFormantStub({ ...local, OMNIVOICE_SERVICE_URL: 'http://worker.internal' }), false);
    assert.equal(canUseLocalFormantStub({ ...local, GEMINI_API_KEY: 'configured' }), false);
    assert.equal(canUseLocalFormantStub({ ...local, GEMINI_API_KEY: 'MY_GEMINI_API_KEY' }), true);
    assert.equal(canUseLocalFormantStub({ ...local, NODE_ENV: 'production' }), false);
    assert.equal(canUseLocalFormantStub({ NODE_ENV: 'development' }), false);
  });

  test('paid live WebSocket sessions are denied in production or when a Gemini key is present', () => {
    assert.match(liveWebSocketDenialReason({ NODE_ENV: 'production' }) || '', /disabled in production/);
    assert.match(liveWebSocketDenialReason({ NODE_ENV: 'development', GEMINI_API_KEY: 'configured' }) || '', /Paid live-provider/);
    assert.equal(liveWebSocketDenialReason({ NODE_ENV: 'development', GEMINI_API_KEY: 'MY_GEMINI_API_KEY' }), undefined);
    assert.equal(liveWebSocketDenialReason({ NODE_ENV: 'development' }), undefined);

    const response = createLiveWebSocketUnavailableResponse('Paid live-provider disabled.');
    assert.match(response, /^HTTP\/1\.1 503 Service Unavailable\r\n/);
    assert.match(response, /"code":"PAID_FEATURE_DISABLED"/);
    assert.match(response, /Content-Length:/);
  });
});
