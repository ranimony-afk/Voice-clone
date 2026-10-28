/**
 * Voice model export is unavailable until the application has genuine trained
 * model artifacts and verified provenance. VoiceProfile metadata and its
 * deterministic placeholder vectors are not model weights.
 */

import type { VoiceProfile } from '../../server/engine/types.ts';

export interface ModelExportMetadata {
  filename?: string;
  durationSeconds?: number;
  snrDb?: number;
  clippingRatio?: number;
  similarityScore?: number;
  auditHash?: string;
}

export class VoiceModelExportUnavailableError extends Error {
  constructor() {
    super('Voice model export is unavailable: genuine trained model weights and verified artifact provenance are not available.');
    this.name = 'VoiceModelExportUnavailableError';
  }
}

function rejectSyntheticExport(): never {
  throw new VoiceModelExportUnavailableError();
}

/** @deprecated No real speaker embedding is available to export. */
export function getOrGenerateEmbedding(_voice: VoiceProfile): number[] {
  return rejectSyntheticExport();
}

/** @deprecated Synthetic placeholders must not be serialized as model artifacts. */
export function generateVoiceModelJson(_voice: VoiceProfile, _metadata?: ModelExportMetadata): string {
  return rejectSyntheticExport();
}

/** @deprecated Synthetic placeholders must not be serialized as model artifacts. */
export function generateVoiceModelBin(_voice: VoiceProfile, _metadata?: ModelExportMetadata): ArrayBuffer {
  return rejectSyntheticExport();
}

/** @deprecated No model artifact exists to download. */
export function triggerFileDownload(_blob: Blob, _fileName: string): void {
  rejectSyntheticExport();
}

/** @deprecated Export remains disabled until genuine weights and provenance exist. */
export function exportVoiceModel(
  _voice: VoiceProfile,
  _format: 'json' | 'bin' | 'both',
  _metadata?: ModelExportMetadata,
): { jsonFileName?: string; binFileName?: string } {
  return rejectSyntheticExport();
}
