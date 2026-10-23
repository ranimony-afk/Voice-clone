import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AudioQualityAnalyzer } from '../../server/engine/audio/quality.ts';

// Helper to create synthetic 16-bit Mono WAV buffer
function createSyntheticWav(params: {
  sampleRate: number;
  durationSec: number;
  amplitude: number;
  clipPercentage?: number;
  silence?: boolean;
}): Buffer {
  const { sampleRate, durationSec, amplitude, clipPercentage = 0, silence = false } = params;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // WAV Header
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

  const clipCount = Math.floor(totalSamples * clipPercentage);

  for (let i = 0; i < totalSamples; i++) {
    let sample = 0;
    if (!silence) {
      if (i < clipCount) {
        sample = 32767; // Clipped sample
      } else {
        const t = i / sampleRate;
        // Speech-like tone (220 Hz fundamental)
        sample = Math.floor(amplitude * Math.sin(2 * Math.PI * 220 * t) * 32767);
      }
    }
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

describe('AudioQualityAnalyzer Unit Tests', () => {
  test('Empty buffer is rejected', () => {
    const report = AudioQualityAnalyzer.analyze(Buffer.alloc(0));
    assert.equal(report.isValid, false);
    assert.match(report.feedback[0], /Empty audio file/i);
  });

  test('Corrupt header is rejected', () => {
    const corrupt = Buffer.from('NOT_A_VALID_AUDIO_HEADER_DATA_STREAM');
    const report = AudioQualityAnalyzer.analyze(corrupt);
    assert.equal(report.isValid, false);
    assert.match(report.feedback[0], /Unsupported or corrupted/i);
  });

  test('Short audio sample (< 3.0s) is rejected', () => {
    const shortWav = createSyntheticWav({ sampleRate: 24000, durationSec: 1.5, amplitude: 0.5 });
    const report = AudioQualityAnalyzer.analyze(shortWav);
    assert.equal(report.isValid, false);
    assert.ok(report.feedback.some((f) => f.includes('too short')));
  });

  test('Valid studio-quality WAV passes acoustic check', () => {
    const validWav = createSyntheticWav({ sampleRate: 24000, durationSec: 15.0, amplitude: 0.6 });
    const report = AudioQualityAnalyzer.analyze(validWav);
    assert.equal(report.isValid, true);
    assert.ok(report.durationSeconds >= 14.9 && report.durationSeconds <= 15.1);
    assert.equal(report.sampleRate, 24000);
    assert.ok(report.clippingRatio < 0.005);
    assert.ok(report.snrDb >= 15);
  });

  test('Severely clipped audio (> 2% saturation) is rejected', () => {
    const clippedWav = createSyntheticWav({
      sampleRate: 24000,
      durationSec: 10.0,
      amplitude: 0.8,
      clipPercentage: 0.05, // 5% clipped
    });
    const report = AudioQualityAnalyzer.analyze(clippedWav);
    assert.equal(report.isValid, false);
    assert.ok(report.feedback.some((f) => f.includes('clipping detected')));
  });

  test('Silent audio (mic muted) is rejected for voice enrollment', () => {
    const silentWav = createSyntheticWav({ sampleRate: 24000, durationSec: 10.0, amplitude: 0.0, silence: true });
    const report = AudioQualityAnalyzer.analyze(silentWav);
    assert.equal(report.isValid, false);
    assert.ok(report.feedback.some((f) => f.includes('critically low') || f.includes('silence')));
  });
});
