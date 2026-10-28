import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { apiRouter, voiceModelExportUnavailableHandler } from '../../server/routes/api.ts';
import { DEFAULT_VOICES } from '../../server/data/voices.ts';
import { ConsentVerificationEngine } from '../../server/engine/audio/consent.ts';
import { VoiceForgeSynthesizer } from '../../server/engine/audio/synthesizer.ts';
import { GeminiMultimodalEngine } from '../../server/engine/gemini/multimodal.ts';
import { Paper2AudioEngine } from '../../server/engine/paper2audio/engine.ts';
import { Phonemizer } from '../../server/engine/frontend/phonemizer.ts';
import { memoryStore } from '../../server/db/index.ts';

describe('Express API Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  before((_, done) => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api', apiRouter);

    // Mount the actual production handler separately so its route-level
    // response is testable without changing or bypassing the production gate.
    const exportHandlerTestRouter = express.Router();
    exportHandlerTestRouter.get('/voices/:id/export', voiceModelExportUnavailableHandler);
    app.use('/__test_export_handler', exportHandlerTestRouter);

    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  after((_, done) => {
    server.close(done);
  });

  test('GET /api/health reports process and neural inference readiness separately', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'alive');
    assert.equal(data.process_live, true);
    assert.equal(data.api_ready, true);
    assert.equal(data.model_state, 'not_configured');
    assert.equal(data.dependencies_ready, null);
    assert.equal(data.neural_inference_ready, false);
    assert.equal(data.fallback_is_neural, false);
    assert.ok(Array.isArray(data.supportedLanguages));
  });

  test('GET /api/voices returns default catalogue', async () => {
    const res = await fetch(`${baseUrl}/api/voices`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.voices, DEFAULT_VOICES);
  });

  test('unowned dictionary and custom-voice operations fail closed without mutating shared state', async () => {
    const dictionaryBefore = Phonemizer.getDictionary();
    const voicesMemoryBefore = structuredClone(memoryStore.customVoices);
    const voicesBeforeResponse = await fetch(`${baseUrl}/api/voices`);
    const voicesBefore = await voicesBeforeResponse.json();

    const originalRevokeConsent = ConsentVerificationEngine.revokeConsent;
    let revokeCalls = 0;
    (ConsentVerificationEngine as any).revokeConsent = (...args: [string, string]) => {
      revokeCalls += 1;
      return originalRevokeConsent.apply(ConsentVerificationEngine, args);
    };

    try {
      const requests = [
        fetch(`${baseUrl}/api/dictionary`),
        fetch(`${baseUrl}/api/dictionary`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word: 'owner-scope-test', ipa: 'test' }),
        }),
        fetch(`${baseUrl}/api/dictionary/import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: [{ word: 'owner-scope-test', ipa: 'test' }] }),
        }),
        fetch(`${baseUrl}/api/dictionary/owner-scope-test`, { method: 'DELETE' }),
        fetch(`${baseUrl}/api/voices/design`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Owner Scope Test', prompt: 'A test voice' }),
        }),
        fetch(`${baseUrl}/api/voices/vf_sarah_en`, { method: 'DELETE' }),
      ];

      for (const request of requests) {
        const response = await request;
        assert.equal(response.status, 503);
        const data = await response.json();
        assert.equal(data.error.code, 'OWNER_SCOPED_STORAGE_UNAVAILABLE');
      }

      const revokeResponse = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: 'arbitrary_voice_id', userId: 'arbitrary_user_id' }),
      });
      assert.equal(revokeResponse.status, 503);
      assert.equal((await revokeResponse.json()).error.code, 'CLONING_NOT_RELEASE_READY');
    } finally {
      (ConsentVerificationEngine as any).revokeConsent = originalRevokeConsent;
    }

    assert.equal(revokeCalls, 0);
    assert.deepEqual(memoryStore.customVoices, voicesMemoryBefore);
    const voicesAfterResponse = await fetch(`${baseUrl}/api/voices`);
    assert.deepEqual(await voicesAfterResponse.json(), voicesBefore);
    assert.deepEqual(Phonemizer.getDictionary(), dictionaryBefore);
  });

  test('POST /api/frontend/analyze normalizes text and generates IPA', async () => {
    const res = await fetch(`${baseUrl}/api/frontend/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello VoiceForge world', language: 'en' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.originalText, 'Hello VoiceForge world');
    assert.ok(data.unifiedIpa.length > 0);
  });

  test('voice model export handler denies JSON and BIN before producing an artifact', async () => {
    const formats = ['json', 'bin'];
    const upstreamCalls: string[] = [];
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    const methodTargets: Array<[object, string]> = [
      [VoiceForgeSynthesizer.prototype, 'synthesize'],
      [GeminiMultimodalEngine.prototype, 'generateMusic'],
      [GeminiMultimodalEngine.prototype, 'createOrEditImage'],
      [GeminiMultimodalEngine.prototype, 'generateVideoFromText'],
      [GeminiMultimodalEngine.prototype, 'transcribeMedia'],
      [GeminiMultimodalEngine.prototype, 'translateText'],
      [Paper2AudioEngine.prototype, 'parsePaperText'],
      [Paper2AudioEngine.prototype, 'generateScript'],
      [Paper2AudioEngine.prototype, 'synthesizeDialogueAudio'],
    ];
    const originals = methodTargets.map(([target, method]) => {
      const prototype = target as Record<string, (...args: unknown[]) => unknown>;
      const original = prototype[method];
      prototype[method] = function (..._args: unknown[]) {
        upstreamCalls.push(`${target.constructor.name}.${method}`);
        throw new Error('provider or inference call forbidden by export test');
      };
      return { prototype, method, original };
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error('provider fetch forbidden by export test');
    }) as typeof fetch;

    const requestWithoutFetch = (pathname: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }>((resolve, reject) => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('test HTTP server has no TCP address'));
      const request = http.request({ hostname: '127.0.0.1', port: address.port, path: pathname, method: 'GET' }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode || 0, headers: response.headers, body: JSON.parse(text) });
          } catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      request.end();
    });

    try {
      // This test-only mount registers the exact production handler outside the
      // broad middleware. The handler itself has no serializer/provider inputs.
      const directHandlerResponses = await Promise.all(formats.map((format) =>
        requestWithoutFetch(`/__test_export_handler/voices/vf_sarah_en/export?format=${format}`),
      ));

      for (const response of directHandlerResponses) {
        assert.equal(response.status, 503);
        assert.equal(response.headers['content-disposition'], undefined);
        assert.deepEqual(Object.keys(response.body), ['error']);
        assert.deepEqual(Object.keys(response.body.error).sort(), ['code', 'message']);
        assert.equal(response.body.error.code, 'VOICE_MODEL_EXPORT_UNAVAILABLE');
        assert.equal(response.body.success, undefined);
        assert.equal(response.body.artifact, undefined);
        assert.equal(response.body.speakerEmbedding, undefined);
      }

      // The unchanged production router gate remains covered independently.
      const gatedResponses = await Promise.all(formats.map((format) =>
        requestWithoutFetch(`/api/voices/vf_sarah_en/export?format=${format}`),
      ));
      for (const response of gatedResponses) {
        assert.equal(response.status, 503);
        assert.equal(response.body.error.code, 'CLONING_NOT_RELEASE_READY');
      }
      assert.deepEqual(upstreamCalls, []);
      assert.deepEqual(fetchCalls, []);
    } finally {
      globalThis.fetch = originalFetch;
      for (const { prototype, method, original } of originals) prototype[method] = original;
    }
  });

  test('clone and cross-lingual test routes fail closed until authenticated ownership storage is deployed', async () => {
    const requests = [
      fetch(`${baseUrl}/api/voices/clone/challenge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceName: 'Test Voice 1' }),
      }),
      fetch(`${baseUrl}/api/voices/cross-lingual-test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: 'private_custom_voice', language: 'en' }),
      }),
    ];
    for (const res of await Promise.all(requests)) {
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.error.code, 'CLONING_NOT_RELEASE_READY');
      assert.equal(JSON.stringify(data).includes('VOICEFORGE_CONSENT_SECRET'), false);
      assert.equal(JSON.stringify(data).includes('signature'), false);
    }
  });

  test('consent verification is unavailable while public cloning is gated', async () => {
    const res = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceName: 'Unverified Voice' }),
    });
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.error.code, 'CLONING_NOT_RELEASE_READY');
  });

  test('cost-bearing routes and unverified media/billing return fail-closed 503s', async () => {
    const post = (path: string) => fetch(`${baseUrl}/api${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const [tts, speechToSpeech, parsePaper, scriptPaper, synthPaper, video, billing] = await Promise.all([
      post('/tts/synthesize'),
      post('/speech-to-speech'),
      post('/paper2audio/parse'),
      post('/paper2audio/script'),
      post('/paper2audio/synthesize'),
      post('/videos/generate-text'),
      post('/billing/topup'),
    ]);
    for (const response of [tts, speechToSpeech, parsePaper, scriptPaper, synthPaper]) {
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'PAID_FEATURE_DISABLED');
    }
    assert.equal(video.status, 503);
    assert.equal(billing.status, 503);
    assert.equal((await video.json()).error.code, 'FEATURE_NOT_RELEASE_READY');
    assert.equal((await billing.json()).error.code, 'FEATURE_NOT_RELEASE_READY');
  });

  test('configured paid providers cannot be reached through simulated preview flags', async () => {
    const prior = {
      nodeEnv: process.env.NODE_ENV,
      mediaPreview: process.env.VOICEFORGE_ALLOW_SIMULATED_MEDIA,
      devStub: process.env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE,
      inferenceUrl: process.env.OMNIVOICE_SERVICE_URL,
      geminiKey: process.env.GEMINI_API_KEY,
    };
    process.env.NODE_ENV = 'development';
    process.env.VOICEFORGE_ALLOW_SIMULATED_MEDIA = 'true';
    process.env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE = 'true';
    process.env.OMNIVOICE_SERVICE_URL = 'https://worker.invalid';
    process.env.GEMINI_API_KEY = 'test-only-not-a-credential';
    try {
      const responses = await Promise.all([
        fetch(`${baseUrl}/api/tts/synthesize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        fetch(`${baseUrl}/api/images/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        fetch(`${baseUrl}/api/paper2audio/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      ]);
      assert.deepEqual(responses.map((response) => response.status), [503, 503, 503]);
      assert.deepEqual(await Promise.all(responses.map((response) => response.json())).then((data) => data.map((body) => body.error.code)), [
        'PAID_FEATURE_DISABLED', 'FEATURE_NOT_RELEASE_READY', 'PAID_FEATURE_DISABLED',
      ]);
    } finally {
      if (prior.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior.nodeEnv;
      if (prior.mediaPreview === undefined) delete process.env.VOICEFORGE_ALLOW_SIMULATED_MEDIA; else process.env.VOICEFORGE_ALLOW_SIMULATED_MEDIA = prior.mediaPreview;
      if (prior.devStub === undefined) delete process.env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE; else process.env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE = prior.devStub;
      if (prior.inferenceUrl === undefined) delete process.env.OMNIVOICE_SERVICE_URL; else process.env.OMNIVOICE_SERVICE_URL = prior.inferenceUrl;
      if (prior.geminiKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prior.geminiKey;
    }
  });

  test('denied and simulated media requests never invoke upstream providers or inference workers', async () => {
    const envKeys = [
      'NODE_ENV', 'VOICEFORGE_ALLOW_SIMULATED_MEDIA', 'VOICEFORGE_ALLOW_DEV_STUB_ENGINE',
      'OMNIVOICE_SERVICE_URL', 'GEMINI_API_KEY', 'VOICEFORGE_WORKER_API_KEY',
    ] as const;
    const priorEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    const upstreamCalls: string[] = [];
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    const methodTargets: Array<[object, string]> = [
      [VoiceForgeSynthesizer.prototype, 'synthesize'],
      [GeminiMultimodalEngine.prototype, 'generateMusic'],
      [GeminiMultimodalEngine.prototype, 'createOrEditImage'],
      [GeminiMultimodalEngine.prototype, 'generateVideoFromText'],
      [GeminiMultimodalEngine.prototype, 'animateImageToVideo'],
      [GeminiMultimodalEngine.prototype, 'stylizeVideo'],
      [GeminiMultimodalEngine.prototype, 'getVideosOperation'],
      [GeminiMultimodalEngine.prototype, 'transcribeMedia'],
      [GeminiMultimodalEngine.prototype, 'translateText'],
      [Paper2AudioEngine.prototype, 'parsePaperText'],
      [Paper2AudioEngine.prototype, 'generateScript'],
      [Paper2AudioEngine.prototype, 'synthesizeDialogueAudio'],
    ];
    const originals = methodTargets.map(([target, method]) => {
      const prototype = target as Record<string, (...args: unknown[]) => unknown>;
      const original = prototype[method];
      prototype[method] = function (..._args: unknown[]) {
        upstreamCalls.push(`${target.constructor.name}.${method}`);
        throw new Error('upstream call forbidden by integration test');
      };
      return { prototype, method, original };
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new Error('fetch forbidden by upstream-denial integration test');
    }) as typeof fetch;

    const requestWithoutFetch = (method: string, pathname: string) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('test HTTP server has no TCP address'));
      const request = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path: pathname,
        method,
        headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'content-length': '2' },
      }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => {
          try { resolve({ status: response.statusCode || 0, body: JSON.parse(text) }); }
          catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      if (method !== 'GET') request.end('{}'); else request.end();
    });

    try {
      // This formerly opted into handlers that attempted provider calls and only
      // then returned mock content after the upstream SDK failed.
      process.env.NODE_ENV = 'development';
      process.env.VOICEFORGE_ALLOW_SIMULATED_MEDIA = 'true';
      process.env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE = 'true';
      delete process.env.OMNIVOICE_SERVICE_URL;
      delete process.env.GEMINI_API_KEY;
      delete process.env.VOICEFORGE_WORKER_API_KEY;

      const mediaRequests: Array<[string, string]> = [
        ['POST', '/api/music/generate'], ['POST', '/api/images/generate'],
        ['POST', '/api/videos/generate-text'], ['POST', '/api/videos/animate-image'],
        ['GET', '/api/videos/status/fixture-operation'], ['GET', '/api/videos/styles'],
        ['POST', '/api/videos/stylize'], ['GET', '/api/videos/jobs'],
        ['GET', '/api/videos/jobs/fixture-job'], ['POST', '/api/transcribe'],
        ['POST', '/api/translate'], ['POST', '/api/translate-all'],
        ['POST', '/api/media/transcribe-translate'], ['GET', '/api/media/jobs'],
        ['POST', '/api/audio/isolate'], ['POST', '/api/sfx/generate'],
        ['POST', '/api/dubbing/create'], ['GET', '/api/billing/summary'],
        ['POST', '/api/billing/topup'],
      ];
      for (const [method, pathname] of mediaRequests) {
        const response = await requestWithoutFetch(method, pathname);
        assert.equal(response.status, 503, `${method} ${pathname}`);
        assert.equal(response.body.error.code, 'FEATURE_NOT_RELEASE_READY', pathname);
      }

      // Even with simulated flags enabled, configured upstreams cannot pass the
      // cost-bearing route gate. Calls are monitored at both method and fetch layers.
      process.env.GEMINI_API_KEY = 'integration-test-provider-key';
      process.env.OMNIVOICE_SERVICE_URL = 'http://worker.invalid';
      const paidRequests: Array<[string, string]> = [
        ['POST', '/api/tts/synthesize'], ['POST', '/api/speech-to-speech'],
        ['POST', '/api/paper2audio/parse'], ['POST', '/api/paper2audio/script'],
        ['POST', '/api/paper2audio/synthesize'],
      ];
      for (const [method, pathname] of paidRequests) {
        const response = await requestWithoutFetch(method, pathname);
        assert.equal(response.status, 503, `${method} ${pathname}`);
        assert.equal(response.body.error.code, 'PAID_FEATURE_DISABLED', pathname);
      }

      assert.deepEqual(upstreamCalls, []);
      assert.deepEqual(fetchCalls, []);
    } finally {
      globalThis.fetch = originalFetch;
      for (const { prototype, method, original } of originals) prototype[method] = original;
      for (const key of envKeys) {
        const value = priorEnv[key];
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

  test('TTS returns safe 503 when provenance signing key is unavailable', async () => {
    const oldEnv = {
      nodeEnv: process.env.NODE_ENV,
      devStub: process.env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE,
      inferenceUrl: process.env.OMNIVOICE_SERVICE_URL,
      watermarkKey: process.env.VOICEFORGE_WATERMARK_KEY,
    };
    process.env.NODE_ENV = 'test';
    process.env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE = 'true';
    delete process.env.OMNIVOICE_SERVICE_URL;
    delete process.env.VOICEFORGE_WATERMARK_KEY;
    try {
      const res = await fetch(`${baseUrl}/api/tts/synthesize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'No provenance key test.', voiceId: 'vf_sarah_en', language: 'en' }),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error.code, 'WATERMARK_SIGNING_UNAVAILABLE');
      assert.equal(JSON.stringify(body).includes('VOICEFORGE_WATERMARK_KEY'), false);
      assert.equal(JSON.stringify(body).includes(oldEnv.watermarkKey || 'known-key-marker'), false);
    } finally {
      if (oldEnv.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv.nodeEnv;
      if (oldEnv.devStub === undefined) delete process.env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE; else process.env.VOICEFORGE_ALLOW_DEV_STUB_ENGINE = oldEnv.devStub;
      if (oldEnv.inferenceUrl === undefined) delete process.env.OMNIVOICE_SERVICE_URL; else process.env.OMNIVOICE_SERVICE_URL = oldEnv.inferenceUrl;
      if (oldEnv.watermarkKey === undefined) delete process.env.VOICEFORGE_WATERMARK_KEY; else process.env.VOICEFORGE_WATERMARK_KEY = oldEnv.watermarkKey;
    }
  });

  test('POST /api/tts/synthesize is blocked before inference without cost controls', async () => {
    const res = await fetch(`${baseUrl}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Production synthesis verification test.',
        voiceId: 'vf_sarah_en',
        language: 'en',
      }),
    });
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.error.code, 'PAID_FEATURE_DISABLED');
    assert.equal(data.audioBase64, undefined);
  });

  test('POST /api/audio/verify-watermark rejects arbitrary strings', async () => {
    const res = await fetch(`${baseUrl}/api/audio/verify-watermark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: 'random_unauthenticated_string_val' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isValid, false);
  });
});
