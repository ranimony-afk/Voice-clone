import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VoiceProfile } from '../../server/engine/types.ts';
import {
  VoiceModelExportUnavailableError,
  exportVoiceModel,
  generateVoiceModelBin,
  generateVoiceModelJson,
  getOrGenerateEmbedding,
  triggerFileDownload,
} from '../../src/utils/voiceModelExport.ts';

const voice: VoiceProfile = {
  id: 'fixture_voice',
  name: 'Synthetic Fixture',
  category: 'premade',
  gender: 'female',
  primaryLanguage: 'en',
  supportedLanguages: ['en'],
  accent: 'fixture',
  description: 'Synthetic test fixture',
  defaultSettings: {
    stability: 0.5,
    similarity: 0.5,
    style: 0.5,
    speed: 1,
    pitch: 0,
    speakerBoost: false,
  },
};

test('synthetic voice data cannot be returned or downloaded as a model artifact', () => {
  const operations = [
    () => getOrGenerateEmbedding(voice),
    () => generateVoiceModelJson(voice),
    () => generateVoiceModelBin(voice),
    () => exportVoiceModel(voice, 'both'),
    () => triggerFileDownload(new Blob(['fixture']), 'fixture.bin'),
  ];

  for (const operation of operations) {
    assert.throws(operation, VoiceModelExportUnavailableError);
  }
});
