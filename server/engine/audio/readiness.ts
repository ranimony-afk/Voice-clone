import { canUseLocalFormantStub, type CostPolicyEnvironment } from '../../security/costPolicy.ts';

export type NeuralModelState = 'not_configured' | 'unreachable' | 'unknown' | 'not_loaded' | 'loading' | 'loaded' | 'failed';

export interface NeuralInferenceReadiness {
  worker_configured: boolean;
  worker_reachable: boolean;
  dependencies_ready: boolean | null;
  model_state: NeuralModelState;
  neural_inference_ready: boolean;
  fallback_available: boolean;
  fallback_kind: 'development_formant' | null;
  fallback_is_neural: false;
}

const KNOWN_MODEL_STATES = new Set<NeuralModelState>(['not_loaded', 'loading', 'loaded', 'failed']);

/**
 * Probe only the worker's non-generative readiness endpoint. A configured URL
 * is not evidence that dependencies or weights are loaded. Never expose its
 * URL, raw error text, or credentials in the returned status.
 */
export async function getNeuralInferenceReadiness(
  env: CostPolicyEnvironment = process.env,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<NeuralInferenceReadiness> {
  const workerUrl = env.OMNIVOICE_SERVICE_URL?.trim().replace(/\/+$/, '');
  const fallbackAvailable = canUseLocalFormantStub(env);
  const fallbackKind = fallbackAvailable ? 'development_formant' : null;

  if (!workerUrl) {
    return {
      worker_configured: false,
      worker_reachable: false,
      dependencies_ready: null,
      model_state: 'not_configured',
      neural_inference_ready: false,
      fallback_available: fallbackAvailable,
      fallback_kind: fallbackKind,
      fallback_is_neural: false,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetcher(`${workerUrl}/readyz`, {
      method: 'GET',
      signal: controller.signal,
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const candidate = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const candidateState = candidate.model_state;
    const modelState: NeuralModelState = typeof candidateState === 'string' &&
      KNOWN_MODEL_STATES.has(candidateState as NeuralModelState)
      ? candidateState as NeuralModelState
      : 'unknown';
    const dependenciesReady = typeof candidate.dependencies_ready === 'boolean' ? candidate.dependencies_ready : null;
    const neuralInferenceReady = response.ok && modelState === 'loaded' &&
      dependenciesReady === true && candidate.neural_inference_ready === true;

    return {
      worker_configured: true,
      worker_reachable: true,
      dependencies_ready: dependenciesReady,
      model_state: modelState,
      neural_inference_ready: neuralInferenceReady,
      fallback_available: fallbackAvailable,
      fallback_kind: fallbackKind,
      fallback_is_neural: false,
    };
  } catch {
    return {
      worker_configured: true,
      worker_reachable: false,
      dependencies_ready: null,
      model_state: 'unreachable',
      neural_inference_ready: false,
      fallback_available: fallbackAvailable,
      fallback_kind: fallbackKind,
      fallback_is_neural: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}
