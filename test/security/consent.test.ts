import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConsentVerificationEngine } from '../../server/engine/audio/consent.ts';

// Helper to create synthetic 16-bit Mono WAV
function createTestWav(freq: number, durationSec: number = 6.0): Buffer {
  const sampleRate = 24000;
  const totalSamples = Math.floor(sampleRate * durationSec);
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
    const t = i / sampleRate;
    const sample = Math.floor(0.6 * Math.sin(2 * Math.PI * freq * t) * 32767);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

describe('ConsentVerificationEngine Security Tests', () => {
  test('Issues valid HMAC-signed expiring challenge with 5-min TTL', () => {
    const challenge = ConsentVerificationEngine.issueChallenge('usr_test_123', 'Aria Voice');
    assert.ok(challenge.challengeId.startsWith('ch_'));
    assert.ok(challenge.nonce.length >= 32);
    assert.ok(challenge.signature.length === 64);
    assert.ok(challenge.expiresAt > challenge.issuedAt);
    assert.equal(challenge.expiresAt - challenge.issuedAt, 5 * 60 * 1000);
    assert.match(challenge.requiredPhrase, /Aria Voice/);
  });

  test('SECURITY: Forged challenge signature is rejected (fail-closed)', () => {
    const challenge = ConsentVerificationEngine.issueChallenge('usr_test_123', 'Aria Voice');
    // Forge the signature
    const forgedChallenge = {
      ...challenge,
      signature: '0000000000000000000000000000000000000000000000000000000000000000',
    };

    const refAudio = createTestWav(220);
    const consentAudio = createTestWav(225);

    const outcome = ConsentVerificationEngine.verifyEnrollment({
      challenge: forgedChallenge,
      voiceName: 'Aria Voice',
      referenceAudio: refAudio,
      consentAudio,
      userId: 'usr_test_123',
    });

    assert.equal(outcome.verified, false);
    assert.equal(outcome.errorCode, 'CHALLENGE_TAMPERED');
  });

  test('SECURITY: Expired challenge is rejected', () => {
    // Force issuance of an expired challenge with negative TTL
    const expiredChallenge = ConsentVerificationEngine.issueChallenge('usr_test_123', 'Aria Voice', -1000);

    const refAudio = createTestWav(220);
    const consentAudio = createTestWav(225);

    const outcome = ConsentVerificationEngine.verifyEnrollment({
      challenge: expiredChallenge,
      voiceName: 'Aria Voice',
      referenceAudio: refAudio,
      consentAudio,
      userId: 'usr_test_123',
    });

    assert.equal(outcome.verified, false);
    assert.equal(outcome.errorCode, 'CHALLENGE_EXPIRED');
  });

  test('SECURITY: Replay protection prevents reusing the same challenge nonce', () => {
    const challenge = ConsentVerificationEngine.issueChallenge('usr_test_123', 'Aria Voice');
    const refAudio = createTestWav(220);
    const consentAudio = createTestWav(222);

    // First use: passes
    const outcome1 = ConsentVerificationEngine.verifyEnrollment({
      challenge,
      voiceName: 'Aria Voice',
      referenceAudio: refAudio,
      consentAudio,
      userId: 'usr_test_123',
    });
    assert.equal(outcome1.verified, true);

    // Second use with identical challenge: must be rejected as replayed
    const outcome2 = ConsentVerificationEngine.verifyEnrollment({
      challenge,
      voiceName: 'Aria Voice',
      referenceAudio: refAudio,
      consentAudio,
      userId: 'usr_test_123',
    });
    assert.equal(outcome2.verified, false);
    assert.equal(outcome2.errorCode, 'CHALLENGE_REPLAYED');
  });

  test('SECURITY: Replay attack (identical audio uploaded as consent) is rejected', () => {
    const challenge = ConsentVerificationEngine.issueChallenge('usr_test_123', 'Aria Voice');
    const identicalAudio = createTestWav(240);

    const outcome = ConsentVerificationEngine.verifyEnrollment({
      challenge,
      voiceName: 'Aria Voice',
      referenceAudio: identicalAudio,
      consentAudio: identicalAudio, // Spoofed with same audio file
      userId: 'usr_test_123',
    });

    assert.equal(outcome.verified, false);
    assert.equal(outcome.errorCode, 'SPOOFING_IDENTICAL_AUDIO');
  });

  test('Valid enrollment creates immutable signed audit record & supports revocation', () => {
    const challenge = ConsentVerificationEngine.issueChallenge('usr_test_456', 'Elena Voice');
    const refAudio = createTestWav(200);
    const consentAudio = createTestWav(205);

    const outcome = ConsentVerificationEngine.verifyEnrollment({
      challenge,
      voiceName: 'Elena Voice',
      referenceAudio: refAudio,
      consentAudio,
      userId: 'usr_test_456',
    });

    assert.equal(outcome.verified, true);
    assert.ok(outcome.voiceId);
    assert.ok(outcome.auditRecord);
    assert.equal(outcome.auditRecord.status, 'active');
    assert.ok(outcome.auditRecord.auditSignature.length > 0);

    // Check isConsentActive
    assert.equal(ConsentVerificationEngine.isConsentActive(outcome.voiceId), true);

    // Revoke consent
    const revoked = ConsentVerificationEngine.revokeConsent(outcome.voiceId, 'usr_test_456');
    assert.equal(revoked, true);
    assert.equal(ConsentVerificationEngine.isConsentActive(outcome.voiceId), false);

    const updatedRecord = ConsentVerificationEngine.getAuditRecord(outcome.voiceId);
    assert.equal(updatedRecord?.status, 'revoked');
    assert.ok(updatedRecord?.revokedAt);
  });
});
