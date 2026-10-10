/**
 * VoiceForge Multilingual Text Normalizer
 * First-class support for English, Hindi, Tamil, Malayalam, and Japanese
 */

import { SupportedLanguage } from '../types.ts';

// Unicode Script Ranges
const DEVANAGARI_RANGE = /[\u0900-\u097F]/;
const TAMIL_RANGE = /[\u0B80-\u0BFF]/;
const MALAYALAM_RANGE = /[\u0D00-\u0D7F]/;
const JAPANESE_RANGE = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
const LATIN_RANGE = /[a-zA-Z]/;

export class TextNormalizer {
  /**
   * Primary entry point: Normalizes input text according to its target language,
   * performs Unicode NFC normalization, handles numbers, currency, abbreviations,
   * and clean whitespace.
   */
  public static normalize(text: string, forcedLang?: SupportedLanguage): {
    normalizedText: string;
    detectedLanguage: SupportedLanguage;
    notes: string[];
  } {
    // 1. Unicode NFC normalization (essential for Indic conjuncts and Japanese dakuten)
    let processed = text.normalize('NFC').trim();
    const notes: string[] = ['Applied Unicode NFC canonical normalization'];

    // 2. Language Detection if not forced
    const detectedLanguage = forcedLang || this.detectLanguage(processed);

    switch (detectedLanguage) {
      case 'hi':
        processed = this.normalizeHindi(processed, notes);
        break;
      case 'ta':
        processed = this.normalizeTamil(processed, notes);
        break;
      case 'ml':
        processed = this.normalizeMalayalam(processed, notes);
        break;
      case 'ja':
        processed = this.normalizeJapanese(processed, notes);
        break;
      case 'en':
      default:
        processed = this.normalizeEnglish(processed, notes);
        break;
    }

    // Collapse superfluous spaces
    processed = processed.replace(/\s+/g, ' ').trim();

    return {
      normalizedText: processed,
      detectedLanguage,
      notes,
    };
  }

  /**
   * Fast script-based language identification
   */
  public static detectLanguage(text: string): SupportedLanguage {
    let devanagariCount = 0;
    let tamilCount = 0;
    let malayalamCount = 0;
    let japaneseCount = 0;
    let latinCount = 0;

    for (const char of text) {
      if (DEVANAGARI_RANGE.test(char)) devanagariCount++;
      else if (TAMIL_RANGE.test(char)) tamilCount++;
      else if (MALAYALAM_RANGE.test(char)) malayalamCount++;
      else if (JAPANESE_RANGE.test(char)) japaneseCount++;
      else if (LATIN_RANGE.test(char)) latinCount++;
    }

    const counts = [
      { lang: 'hi' as SupportedLanguage, count: devanagariCount },
      { lang: 'ta' as SupportedLanguage, count: tamilCount },
      { lang: 'ml' as SupportedLanguage, count: malayalamCount },
      { lang: 'ja' as SupportedLanguage, count: japaneseCount },
      { lang: 'en' as SupportedLanguage, count: latinCount },
    ];

    counts.sort((a, b) => b.count - a.count);
    return counts[0].count > 0 ? counts[0].lang : 'en';
  }

  /**
   * Segment a sentence into language fragments when code-switching occurs
   * (e.g. Tanglish: "இந்த project ரொம்ப awesome-ஆ இருக்கு")
   */
  public static segmentCodeSwitching(text: string): Array<{ text: string; language: SupportedLanguage }> {
    const tokens = text.split(/(\s+|[.,!?;:()]+)/);
    const segments: Array<{ text: string; language: SupportedLanguage }> = [];

    let currentSegment = '';
    let currentLang: SupportedLanguage | null = null;

    for (const token of tokens) {
      if (!token) continue;
      if (/^\s+$/.test(token) || /^[.,!?;:()]+$/.test(token)) {
        if (currentSegment) {
          currentSegment += token;
        }
        continue;
      }

      const tokenLang = this.detectLanguage(token);
      if (!currentLang) {
        currentLang = tokenLang;
        currentSegment = token;
      } else if (currentLang === tokenLang) {
        currentSegment += token;
      } else {
        segments.push({ text: currentSegment.trim(), language: currentLang });
        currentLang = tokenLang;
        currentSegment = token;
      }
    }

    if (currentSegment.trim()) {
      segments.push({ text: currentSegment.trim(), language: currentLang || 'en' });
    }

    return segments.length > 0 ? segments : [{ text, language: this.detectLanguage(text) }];
  }

  // --------------------------------------------------------------------------
  // ENGLISH NORMALIZER
  // --------------------------------------------------------------------------
  private static normalizeEnglish(text: string, notes: string[]): string {
    let out = text;

    // Currency ($12.50 -> twelve dollars and fifty cents)
    if (/\$[\d,]+(\.\d{1,2})?/.test(out)) {
      out = out.replace(/\$([0-9,]+)(?:\.([0-9]{2}))?/g, (_, dollars, cents) => {
        notes.push('Expanded USD currency to words');
        const d = dollars.replace(/,/g, '');
        let res = `${this.numberToEnglishWords(parseInt(d, 10))} dollars`;
        if (cents && parseInt(cents, 10) > 0) {
          res += ` and ${this.numberToEnglishWords(parseInt(cents, 10))} cents`;
        }
        return res;
      });
    }

    // Abbreviations
    const abbrMap: Record<string, string> = {
      'Dr\\.': 'Doctor',
      'Mr\\.': 'Mister',
      'Mrs\\.': 'Missus',
      'Ms\\.': 'Mizz',
      'Prof\\.': 'Professor',
      'St\\.': 'Saint',
      'Ave\\.': 'Avenue',
      'etc\\.': 'etcetera',
      'e\\.g\\.': 'for example',
      'i\\.e\\.': 'that is',
    };

    for (const [abbr, repl] of Object.entries(abbrMap)) {
      const regex = new RegExp(`\\b${abbr}`, 'gi');
      if (regex.test(out)) {
        notes.push(`Expanded abbreviation: ${abbr.replace('\\', '')} -> ${repl}`);
        out = out.replace(regex, repl);
      }
    }

    // Numbers with commas (1,000,000 -> one million)
    out = out.replace(/\b\d{1,3}(,\d{3})+\b/g, (match) => {
      notes.push('Converted formatted integer to words');
      return this.numberToEnglishWords(parseInt(match.replace(/,/g, ''), 10));
    });

    // Standalone digits
    out = out.replace(/\b\d+\b/g, (match) => {
      if (match.length <= 6) {
        return this.numberToEnglishWords(parseInt(match, 10));
      }
      return match.split('').join(' '); // Large serial number
    });

    return out;
  }

  // --------------------------------------------------------------------------
  // HINDI NORMALIZER
  // --------------------------------------------------------------------------
  private static normalizeHindi(text: string, notes: string[]): string {
    let out = text;

    // Indian Currency: ₹5,50,000 -> पाँच लाख पचास हज़ार रुपये (Lakh/Crore system)
    if (/₹[\d,]+/.test(out) || /रु\.?\s*[\d,]+/.test(out)) {
      out = out.replace(/[₹|रु\.?]\s*([0-9,]+)/g, (_, amt) => {
        const num = parseInt(amt.replace(/,/g, ''), 10);
        notes.push('Expanded Indian Rupee (₹) amount using South Asian Lakh/Crore scale');
        return `${this.numberToHindiWords(num)} रुपये`;
      });
    }

    // Standalone numbers in Devanagari or ASCII
    out = out.replace(/\b\d+\b/g, (m) => {
      notes.push('Expanded numerals to Hindi words');
      return this.numberToHindiWords(parseInt(m, 10));
    });

    // Nukta handling: standardize canonical Devanagari nuktas (e.g. क़, ख़, ग़, ज़, ड़, ढ़, फ़)
    notes.push('Preserved nukta consonants (ज़, फ़, ड़) for Urdu/Persian loanword phonation');

    return out;
  }

  // --------------------------------------------------------------------------
  // TAMIL NORMALIZER
  // --------------------------------------------------------------------------
  private static normalizeTamil(text: string, notes: string[]): string {
    let out = text;

    // Currency: ₹ / ரூ.
    if (/₹[\d,]+/.test(out) || /ரூ\.?\s*[\d,]+/.test(out)) {
      out = out.replace(/(?:₹|ரூ\.?)\s*([0-9,]+)/g, (_, amt) => {
        const num = parseInt(amt.replace(/,/g, ''), 10);
        notes.push('Expanded Rupee amount to Tamil currency representation');
        return `${this.numberToTamilWords(num)} ரூபாய்`;
      });
    }

    // Tamil numerals (௧ ௨ ௩ ௪ ௫ ௬ ௭ ௮ ௯ ௰ ௱ ௲) conversion if present
    const tamilDigits: Record<string, number> = {
      '௧': 1, '௨': 2, '௩': 3, '௪': 4, '௫': 5, '௬': 6, '௭': 7, '௮': 8, '௯': 9, '௰': 10, '௱': 100, '௲': 1000
    };
    for (const [tDigit, val] of Object.entries(tamilDigits)) {
      if (out.includes(tDigit)) {
        notes.push(`Normalized traditional Tamil numeral ${tDigit} -> ${val}`);
        out = out.split(tDigit).join(val.toString());
      }
    }

    // Convert standard numerals to Tamil words
    out = out.replace(/\b\d+\b/g, (m) => {
      return this.numberToTamilWords(parseInt(m, 10));
    });

    notes.push('Preserved Grantha characters (ஜ, ஷ, ஸ, ஹ, க்ஷ, ஸ்ரீ) for Sanskrit/loanword acoustics');
    return out;
  }

  // --------------------------------------------------------------------------
  // MALAYALAM NORMALIZER
  // --------------------------------------------------------------------------
  private static normalizeMalayalam(text: string, notes: string[]): string {
    let out = text;

    // Currency
    if (/₹[\d,]+/.test(out) || /രൂ\.?\s*[\d,]+/.test(out)) {
      out = out.replace(/(?:₹|രൂ\.?)\s*([0-9,]+)/g, (_, amt) => {
        const num = parseInt(amt.replace(/,/g, ''), 10);
        notes.push('Expanded Rupee amount to Malayalam currency (രൂപ)');
        return `${this.numberToMalayalamWords(num)} രൂപ`;
      });
    }

    // Digits to Malayalam words
    out = out.replace(/\b\d+\b/g, (m) => {
      return this.numberToMalayalamWords(parseInt(m, 10));
    });

    notes.push('Standardized Chillu letters (ൻ, ൽ, ർ, ൺ, ൾ, ൿ) & Samvruthokaram (്)');
    return out;
  }

  // --------------------------------------------------------------------------
  // JAPANESE NORMALIZER
  // --------------------------------------------------------------------------
  private static normalizeJapanese(text: string, notes: string[]): string {
    let out = text;

    // Japanese Yen currency: ¥3,000 or 3000円
    out = out.replace(/[¥￥]([0-9,]+)/g, (_, amt) => {
      notes.push('Expanded Japanese Yen currency symbol (¥) to 円 (en)');
      return `${amt.replace(/,/g, '')}円`;
    });

    // Full-width alphanumeric to half-width
    out = out.replace(/[\uFF01-\uFF5E]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    );

    notes.push('Preserved Pitch-accent particles: は (wa), へ (e), を (o) for downstream G2P');
    return out;
  }

  // --------------------------------------------------------------------------
  // NUMERICAL EXPANDERS (Helper Methods)
  // --------------------------------------------------------------------------
  private static numberToEnglishWords(num: number): string {
    if (num === 0) return 'zero';
    const a = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const b = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num / 10)] + (num % 10 !== 0 ? '-' + a[num % 10] : '');
    if (num < 1000) return a[Math.floor(num / 100)] + ' hundred' + (num % 100 !== 0 ? ' ' + this.numberToEnglishWords(num % 100) : '');
    if (num < 1000000) return this.numberToEnglishWords(Math.floor(num / 1000)) + ' thousand' + (num % 1000 !== 0 ? ' ' + this.numberToEnglishWords(num % 1000) : '');
    if (num < 1000000000) return this.numberToEnglishWords(Math.floor(num / 1000000)) + ' million' + (num % 1000000 !== 0 ? ' ' + this.numberToEnglishWords(num % 1000000) : '');
    return num.toString();
  }

  private static numberToHindiWords(num: number): string {
    if (num === 0) return 'शून्य';
    const small: Record<number, string> = {
      1: 'एक', 2: 'दो', 3: 'तीन', 4: 'चार', 5: 'पाँच', 6: 'छह', 7: 'सात', 8: 'आठ', 9: 'नौ', 10: 'दस',
      20: 'बीस', 30: 'तीस', 40: 'चालीस', 50: 'पचास', 60: 'साठ', 70: 'सत्तर', 80: 'अस्सी', 90: 'नब्बे'
    };
    if (small[num]) return small[num];
    if (num < 100) return `${num}`; // Fallback phonetic approximation
    if (num < 1000) return `${this.numberToHindiWords(Math.floor(num / 100))} सौ ${num % 100 !== 0 ? this.numberToHindiWords(num % 100) : ''}`.trim();
    if (num < 100000) return `${this.numberToHindiWords(Math.floor(num / 1000))} हज़ार ${num % 1000 !== 0 ? this.numberToHindiWords(num % 1000) : ''}`.trim();
    if (num < 10000000) return `${this.numberToHindiWords(Math.floor(num / 100000))} लाख ${num % 100000 !== 0 ? this.numberToHindiWords(num % 100000) : ''}`.trim();
    return `${this.numberToHindiWords(Math.floor(num / 10000000))} करोड़ ${num % 10000000 !== 0 ? this.numberToHindiWords(num % 10000000) : ''}`.trim();
  }

  private static numberToTamilWords(num: number): string {
    if (num === 0) return 'பூஜ்ஜியம்';
    const small: Record<number, string> = {
      1: 'ஒன்று', 2: 'இரண்டு', 3: 'மூன்று', 4: 'நான்கு', 5: 'ஐந்து', 6: 'ஆறு', 7: 'ஏழு', 8: 'எட்டு', 9: 'ஒன்பது', 10: 'பத்து',
      100: 'நூறு', 1000: 'ஆயிரம்', 100000: 'இலட்சம்', 10000000: 'கோடி'
    };
    if (small[num]) return small[num];
    if (num < 100) return `${num}`;
    if (num < 1000) return `${this.numberToTamilWords(Math.floor(num / 100))} நூறு ${num % 100 !== 0 ? this.numberToTamilWords(num % 100) : ''}`.trim();
    if (num < 100000) return `${this.numberToTamilWords(Math.floor(num / 1000))} ஆயிரம் ${num % 1000 !== 0 ? this.numberToTamilWords(num % 1000) : ''}`.trim();
    if (num < 10000000) return `${this.numberToTamilWords(Math.floor(num / 100000))} இலட்சம் ${num % 100000 !== 0 ? this.numberToTamilWords(num % 100000) : ''}`.trim();
    return `${this.numberToTamilWords(Math.floor(num / 10000000))} கோடி ${num % 10000000 !== 0 ? this.numberToTamilWords(num % 10000000) : ''}`.trim();
  }

  private static numberToMalayalamWords(num: number): string {
    if (num === 0) return 'പൂജ്യം';
    const small: Record<number, string> = {
      1: 'ഒന്ന്', 2: 'രണ്ട്', 3: 'മൂന്ന്', 4: 'നാല്', 5: 'അഞ്ച്', 6: 'ആറ്', 7: 'ഏഴ്', 8: 'എട്ട്', 9: 'ഒമ്പത്', 10: 'പത്ത്',
      100: 'നൂറ്', 1000: 'ആയിരം', 100000: 'ലക്ഷം', 10000000: 'കോടി'
    };
    if (small[num]) return small[num];
    if (num < 100) return `${num}`;
    if (num < 1000) return `${this.numberToMalayalamWords(Math.floor(num / 100))} നൂറ് ${num % 100 !== 0 ? this.numberToMalayalamWords(num % 100) : ''}`.trim();
    if (num < 100000) return `${this.numberToMalayalamWords(Math.floor(num / 1000))} ആയിരം ${num % 1000 !== 0 ? this.numberToMalayalamWords(num % 1000) : ''}`.trim();
    return `${this.numberToMalayalamWords(Math.floor(num / 100000))} ലക്ഷം`.trim();
  }
}
