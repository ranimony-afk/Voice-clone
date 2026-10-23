import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AudioWatermarker } from '../../server/engine/audio/watermark.ts';

// Helper to create synthetic 16-bit Mono WAV
function createTestWav(): Buffer {
  const sampleRate = 24000;
  const totalSamples = 24000; // 1.0s
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < totalSamples; i++) {
    const sample = Math.floor(0.5 * Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 32767);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

describe('AudioWatermarker Security & Provenance Tests', () => {
  test('Signs generation and returns HMAC signature and manifest', () => {
    const rawWav = createTestWav();
    const result = AudioWatermarker.signGeneration({
      generationId: 'gen_test_001',
      userId: 'usr_sarah',
      voiceId: 'vf_sarah_en',
      audioBuffer: rawWav,
      sampleRate: 24000,
      durationSeconds: 1.0,
    });

    assert.ok(result.signature.length === 64, 'HMAC-SHA256 signature must be 64 hex chars');
    assert.equal(result.manifest.generationId, 'gen_test_001');
    assert.equal(result.manifest.userId, 'usr_sarah');
    assert.ok(result.manifest.audioContentHash.length === 64);
    assert.ok(result.audioWithMetadata.length > rawWav.length, 'Must embed vfpr provenance metadata chunk');
  });

  test('SECURITY: Arbitrary 32-character strings are rejected', () => {
    const arbitraryHex = 'deadbeefcafebabe12345678abcdef01';
    const legacyResult = AudioWatermarker.verifyWatermark(arbitraryHex);
    assert.equal(legacyResult.isValid, false, 'Arbitrary unauthenticated string must be rejected');
  });

  test('Authentic un-tampered audio verifies successfully', () => {
    const rawWav = createTestWav();
    const signed = AudioWatermarker.signGeneration({
      generationId: 'gen_test_002',
      userId: 'usr_priya',
      voiceId: 'vf_priya_ta',
      audioBuffer: rawWav,
      sampleRate: 24000,
      durationSeconds: 1.0,
    });

    const verifyResult = AudioWatermarker.verifyAudioProvenance(signed.audioWithMetadata);
    assert.equal(verifyResult.isValid, true);
    assert.equal(verifyResult.tamperDetected, false);
    assert.equal(verifyResult.manifest?.generationId, 'gen_test_002');
    assert.equal(verifyResult.manifest?.voiceId, 'vf_priya_ta');
  });

  test('SECURITY: Audio sample modification is detected as tampering (content hash mismatch)', () => {
    const rawWav = createTestWav();
    const signed = AudioWatermarker.signGeneration({
      generationId: 'gen_test_003',
      userId: 'usr_tamper',
      voiceId: 'vf_aarav_hi',
      audioBuffer: rawWav,
      sampleRate: 24000,
      durationSeconds: 1.0,
    });

    // Tamper with one audio sample byte inside the data chunk (e.g. byte offset 100)
    const tamperedAudio = Buffer.from(signed.audioWithMetadata);
    tamperedAudio[100] = tamperedAudio[100] ^ 0xff;

    const verifyResult = AudioWatermarker.verifyAudioProvenance(tamperedAudio);
    assert.equal(verifyResult.isValid, false, 'Tampered audio must fail verification');
    assert.equal(verifyResult.tamperDetected, true, 'Tamper alert must be triggered');
    assert.match(verifyResult.details, /content hash mismatch/i);
  });
});
