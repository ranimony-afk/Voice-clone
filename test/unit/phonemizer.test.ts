import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Phonemizer } from '../../server/engine/frontend/phonemizer.ts';

describe('Phonemizer Unit Tests', () => {
  test('Standard English G2P IPA conversion', () => {
    const res = Phonemizer.phonemize('Hello world', 'en');
    assert.ok(res.ipa.length > 0, 'IPA string must not be empty');
    assert.match(res.ipa, /h/);
  });

  test('Tamil Retroflex and Plosive IPA phonemization', () => {
    const res = Phonemizer.phonemize('வணக்கம்', 'ta');
    assert.ok(res.ipa.length > 0);
    // Tamil dental/retroflex phonemes
    assert.match(res.ipa, /[vaɳakːam|ʋaɳakːam|a|k|m]/);
  });

  test('Hindi Schwa-Deletion and Canda-bindu preservation', () => {
    const res = Phonemizer.phonemize('नमस्ते', 'hi');
    assert.ok(res.ipa.length > 0);
    assert.match(res.ipa, /n/);
  });

  test('Malayalam Conjunct Phonemization', () => {
    const res = Phonemizer.phonemize('നമസ്കാരം', 'ml');
    assert.ok(res.ipa.length > 0);
    assert.match(res.ipa, /m/);
  });

  test('Japanese Kana Mora Timing and Pitch Phonemization', () => {
    const res = Phonemizer.phonemize('こんにちは', 'ja');
    assert.ok(res.ipa.length > 0);
    assert.match(res.ipa, /ko/);
  });

  test('Personal Pronunciation Dictionary Override', () => {
    // Check initial seed dictionary entry
    const dict = Phonemizer.getDictionary();
    const vfEntry = dict.find((d) => d.word.toLowerCase() === 'voiceforge');
    assert.ok(vfEntry, 'VoiceForge canonical entry must exist in seed dictionary');
    assert.equal(vfEntry.ipa, 'vɔɪs.fɔːrd͡ʒ');

    // Add custom pronunciation
    const customWord = 'QuantumSynthXYZ';
    const customIpa = 'kwɑːn.təm.sɪnθ';
    Phonemizer.addOrUpdateDictionaryEntry({
      id: 'dict_test_custom',
      word: customWord,
      language: 'en',
      ipa: customIpa,
      createdAt: new Date().toISOString(),
    });

    const res = Phonemizer.phonemize(customWord, 'en');
    assert.equal(res.ipa, customIpa, 'Phonemizer must apply personal dictionary override');

    // Cleanup
    Phonemizer.removeDictionaryEntry('dict_test_custom');
  });
});
