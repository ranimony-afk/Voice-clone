import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TextNormalizer } from '../../server/engine/frontend/normalizer.ts';

describe('TextNormalizer Unit Tests', () => {
  test('Language Detection based on Unicode script ranges', () => {
    assert.equal(TextNormalizer.detectLanguage('Hello, this is English text.'), 'en');
    assert.equal(TextNormalizer.detectLanguage('வணக்கம், இது தமிழ் உரை.'), 'ta');
    assert.equal(TextNormalizer.detectLanguage('नमस्ते, यह हिंदी वाक्य है।'), 'hi');
    assert.equal(TextNormalizer.detectLanguage('നമസ്കാരം, ഇത് മലയാളം വാക്യം ആണ്.'), 'ml');
    assert.equal(TextNormalizer.detectLanguage('こんにちは、これは日本語です。'), 'ja');
  });

  test('Unicode NFC normalization canonical equivalence', () => {
    // Combining character vs precomposed character
    const decomposed = 'e\u0301'; // 'e' + combining acute accent
    const composed = '\u00e9';    // 'é'
    assert.notEqual(decomposed, composed);

    const normDecomposed = TextNormalizer.normalize(decomposed);
    const normComposed = TextNormalizer.normalize(composed);
    assert.equal(normDecomposed.normalizedText, normComposed.normalizedText);
    assert.equal(normDecomposed.normalizedText, composed);
  });

  test('English Number and Currency Expansion', () => {
    const res = TextNormalizer.normalize('The total was $45 at 2:30pm.');
    assert.match(res.normalizedText, /forty-five dollars/i);
    assert.match(res.normalizedText, /two thirty/i);
  });

  test('Hindi Devanagari Number Expansion', () => {
    const res = TextNormalizer.normalize('कीमत ₹500 है।', 'hi');
    assert.match(res.normalizedText, /पाँच सौ/);
    assert.match(res.normalizedText, /रुपये/);
  });

  test('Tamil Number and Currency Expansion', () => {
    const res = TextNormalizer.normalize('விலை ₹150 ஆகும்.', 'ta');
    assert.match(res.normalizedText, /நூறு/);
    assert.match(res.normalizedText, /ரூபாய்/);
  });

  test('Code-Switching Segmentation (Tanglish & Hinglish)', () => {
    const tanglish = 'இந்த project ரொம்ப awesome-ஆ இருக்கு';
    const segments = TextNormalizer.segmentCodeSwitching(tanglish);
    assert.ok(segments.length >= 2, 'Should detect multiple script segments');
    const hasTamil = segments.some((s) => s.language === 'ta');
    const hasEnglish = segments.some((s) => s.language === 'en');
    assert.ok(hasTamil, 'Must detect Tamil segment');
    assert.ok(hasEnglish, 'Must detect Latin/English segment');
  });
});
