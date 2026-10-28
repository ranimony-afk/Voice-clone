import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AudioWatermarker, WatermarkSigningConfigurationError } from '../../server/engine/audio/watermark.ts';

// Isolated deterministic test-only fixture. Runtime code has no default key.
const TEST_WATERMARK_KEY = Buffer.alloc(32, 0x6a).toString('hex');
const priorWatermarkKey = process.env.VOICEFORGE_WATERMARK_KEY;
before(() => { process.env.VOICEFORGE_WATERMARK_KEY = TEST_WATERMARK_KEY; });
after(() => {
  if (priorWatermarkKey === undefined) delete process.env.VOICEFORGE_WATERMARK_KEY;
  else process.env.VOICEFORGE_WATERMARK_KEY = priorWatermarkKey;
});

// Helper to create synthetic 16-bit Mono WAV
function alterEmbeddedSignature(input: Buffer): Buffer {
  const output = Buffer.from(input);
  let offset = 12;
  while (offset + 8 <= output.length) {
    const chunkId = output.toString('ascii', offset, offset + 4);
    const size = output.readUInt32LE(offset + 4);
    if (chunkId === 'vfpr') {
      const start = offset + 8;
      const manifest = JSON.parse(output.subarray(start, start + size).toString('utf8'));
      manifest.signature = `${manifest.signature[0] === '0' ? '1' : '0'}${manifest.signature.slice(1)}`;
      const changed = Buffer.from(JSON.stringify(manifest), 'utf8');
      assert.equal(changed.length, size);
      changed.copy(output, start);
      return output;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('test WAV did not contain the provenance chunk');
}

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
  test('missing key fails closed for signing and verification', () => {
    const configured = process.env.VOICEFORGE_WATERMARK_KEY;
    delete process.env.VOICEFORGE_WATERMARK_KEY;
    try {
      let caught: unknown;
      try {
        AudioWatermarker.signGeneration({
          generationId: 'gen_no_key', userId: 'usr_test', voiceId: 'voice_test',
          audioBuffer: createTestWav(), sampleRate: 24000, durationSeconds: 1,
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof WatermarkSigningConfigurationError);
      assert.equal((caught as Error).message.includes(TEST_WATERMARK_KEY), false);
    } finally {
      if (configured === undefined) delete process.env.VOICEFORGE_WATERMARK_KEY;
      else process.env.VOICEFORGE_WATERMARK_KEY = configured;
    }
  });

  test('empty, short, whitespace-only, and control-character keys fail closed', () => {
    const configured = process.env.VOICEFORGE_WATERMARK_KEY;
    try {
      for (const invalid of ['', 'short-key', ' '.repeat(40), `${'a'.repeat(32)}${String.fromCharCode(10)}`, `${'a'.repeat(32)}${String.fromCharCode(0x85)}`]) {
        process.env.VOICEFORGE_WATERMARK_KEY = invalid;
        assert.throws(
          () => AudioWatermarker.signGeneration({
            generationId: 'gen_invalid_key', userId: 'usr_test', voiceId: 'voice_test',
            audioBuffer: createTestWav(), sampleRate: 24000, durationSeconds: 1,
          }),
          WatermarkSigningConfigurationError,
        );
      }
    } finally {
      if (configured === undefined) delete process.env.VOICEFORGE_WATERMARK_KEY;
      else process.env.VOICEFORGE_WATERMARK_KEY = configured;
    }
  });

  test('explicit test key signs and validates current-key provenance', () => {
    process.env.VOICEFORGE_WATERMARK_KEY = TEST_WATERMARK_KEY;
    const signed = AudioWatermarker.signGeneration({
      generationId: 'gen_explicit_fixture', userId: 'usr_test', voiceId: 'voice_test',
      audioBuffer: createTestWav(), sampleRate: 24000, durationSeconds: 1,
    });
    assert.equal(signed.manifest.keyId, 'k_prod_2026_v1');
    assert.equal(AudioWatermarker.verifyAudioProvenance(signed.audioWithMetadata).isValid, true);
  });

  test('altered HMAC signature and retired legacy key ID are not authenticated', () => {
    const signed = AudioWatermarker.signGeneration({
      generationId: 'gen_altered_signature', userId: 'usr_test', voiceId: 'voice_test',
      audioBuffer: createTestWav(), sampleRate: 24000, durationSeconds: 1,
    });
    const altered = AudioWatermarker.verifyAudioProvenance(alterEmbeddedSignature(signed.audioWithMetadata));
    assert.equal(altered.isValid, false);
    assert.equal(altered.tamperDetected, true);
    signed.manifest.keyId = 'k_legacy_2025_v0';
    assert.equal(AudioWatermarker.verifyWatermark(signed.signature).isValid, false);
  });

  test('verification reports unavailable configuration without exposing key material', () => {
    const signed = AudioWatermarker.signGeneration({
      generationId: 'gen_verify_no_key', userId: 'usr_test', voiceId: 'voice_test',
      audioBuffer: createTestWav(), sampleRate: 24000, durationSeconds: 1,
    });
    const configured = process.env.VOICEFORGE_WATERMARK_KEY;
    delete process.env.VOICEFORGE_WATERMARK_KEY;
    try {
      const result = AudioWatermarker.verifyAudioProvenance(signed.audioWithMetadata);
      assert.equal(result.isValid, false);
      assert.match(result.details, /configuration is missing or invalid/i);
      assert.equal(result.details.includes(TEST_WATERMARK_KEY), false);
    } finally {
      if (configured === undefined) delete process.env.VOICEFORGE_WATERMARK_KEY;
      else process.env.VOICEFORGE_WATERMARK_KEY = configured;
    }
  });

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
