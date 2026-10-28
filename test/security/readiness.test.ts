import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getNeuralInferenceReadiness } from '../../server/engine/audio/readiness.ts';

describe('Node neural inference readiness', () => {
  test('an absent worker is not neural-ready and fallback remains explicitly non-neural', async () => {
    const status = await getNeuralInferenceReadiness({
      NODE_ENV: 'development',
      VOICEFORGE_ALLOW_DEV_STUB_ENGINE: 'true',
    });
    assert.equal(status.worker_configured, false);
    assert.equal(status.model_state, 'not_configured');
    assert.equal(status.dependencies_ready, null);
    assert.equal(status.neural_inference_ready, false);
    assert.equal(status.fallback_available, true);
    assert.equal(status.fallback_kind, 'development_formant');
    assert.equal(status.fallback_is_neural, false);
  });

  test('configured URL alone is insufficient: not-loaded and loading worker states stay unready', async () => {
    for (const modelState of ['not_loaded', 'loading'] as const) {
      const status = await getNeuralInferenceReadiness(
        { OMNIVOICE_SERVICE_URL: 'http://worker.test' },
        async () => new Response(JSON.stringify({
          ready: false,
          model_state: modelState,
          dependencies_ready: null,
          neural_inference_ready: false,
        }), { status: 503 }),
      );
      assert.equal(status.worker_reachable, true);
      assert.equal(status.model_state, modelState);
      assert.equal(status.dependencies_ready, null);
      assert.equal(status.neural_inference_ready, false);
    }
  });

  test('only an explicit loaded neural worker response is ready', async () => {
    const status = await getNeuralInferenceReadiness(
      { OMNIVOICE_SERVICE_URL: 'http://worker.test' },
      async () => new Response(JSON.stringify({
        ready: true,
        model_state: 'loaded',
        dependencies_ready: true,
        neural_inference_ready: true,
      }), { status: 200 }),
    );
    assert.equal(status.worker_reachable, true);
    assert.equal(status.model_state, 'loaded');
    assert.equal(status.dependencies_ready, true);
    assert.equal(status.neural_inference_ready, true);
    assert.equal(status.fallback_is_neural, false);
  });

  test('loaded worker responses with missing or contradictory dependencies do not claim neural readiness', async () => {
    for (const dependencies_ready of [null, false]) {
      const status = await getNeuralInferenceReadiness(
        { OMNIVOICE_SERVICE_URL: 'http://worker.test' },
        async () => new Response(JSON.stringify({
          model_state: 'loaded',
          dependencies_ready,
          neural_inference_ready: true,
        }), { status: 200 }),
      );
      assert.equal(status.model_state, 'loaded');
      assert.equal(status.neural_inference_ready, false);
    }
  });

  test('generic ready or failed worker responses do not claim neural readiness', async () => {
    const generic = await getNeuralInferenceReadiness(
      { OMNIVOICE_SERVICE_URL: 'http://worker.test' },
      async () => new Response(JSON.stringify({ ready: true }), { status: 200 }),
    );
    assert.equal(generic.model_state, 'unknown');
    assert.equal(generic.neural_inference_ready, false);

    const failed = await getNeuralInferenceReadiness(
      { OMNIVOICE_SERVICE_URL: 'http://worker.test' },
      async () => new Response(JSON.stringify({ model_state: 'failed', dependencies_ready: false, neural_inference_ready: false }), { status: 503 }),
    );
    assert.equal(failed.model_state, 'failed');
    assert.equal(failed.dependencies_ready, false);
    assert.equal(failed.neural_inference_ready, false);
  });

  test('unreachable worker is reported without leaking raw network errors', async () => {
    const status = await getNeuralInferenceReadiness(
      { OMNIVOICE_SERVICE_URL: 'http://worker.test' },
      async () => { throw new Error('private-host-token'); },
    );
    assert.equal(status.worker_reachable, false);
    assert.equal(status.model_state, 'unreachable');
    assert.equal(JSON.stringify(status).includes('private-host-token'), false);
  });
});
