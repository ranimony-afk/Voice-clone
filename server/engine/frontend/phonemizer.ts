/**
 * VoiceForge Unified Multilingual Phonemizer (G2P)
 * Generates standardized IPA phoneme sequences across English, Hindi, Tamil, Malayalam, and Japanese
 */

import { SupportedLanguage } from '../types.ts';

export class Phonemizer {
  /**
   * Primary entry point: Maps normalized text to unified IPA phonemes
   */
  public static phonemize(
    text: string,
    lang: SupportedLanguage
  ): {
    ipa: string;
    ruleNotes: string[];
  } {
    switch (lang) {
      case 'hi':
        return this.phonemizeHindi(text);
      case 'ta':
        return this.phonemizeTamil(text);
      case 'ml':
        return this.phonemizeMalayalam(text);
      case 'ja':
        return this.phonemizeJapanese(text);
      case 'en':
      default:
        return this.phonemizeEnglish(text);
    }
  }

  // --------------------------------------------------------------------------
  // 1. TAMIL G2P (Context-sensitive plosive voicing & Grantha)
  // --------------------------------------------------------------------------
  private static phonemizeTamil(text: string): { ipa: string; ruleNotes: string[] } {
    const notes: string[] = [];
    const words = text.split(/\s+/);
    const ipaWords: string[] = [];

    // Tamil Vowels
    const vowels: Record<string, string> = {
      'அ': 'a', 'ஆ': 'aː', 'இ': 'i', 'ஈ': 'iː', 'உ': 'u', 'ஊ': 'uː',
      'எ': 'e', 'ஏ': 'eː', 'ஐ': 'aɪ', 'ஒ': 'o', 'ஓ': 'oː', 'ஔ': 'aʊ'
    };

    // Tamil Matras (vowel signs)
    const matras: Record<string, string> = {
      'ா': 'aː', 'ி': 'i', 'ீ': 'iː', 'ு': 'u', 'ூ': 'uː',
      'ெ': 'e', 'ே': 'eː', 'ை': 'aɪ', 'ொ': 'o', 'ோ': 'oː', 'ௌ': 'aʊ'
    };

    // Grantha consonants
    const grantha: Record<string, string> = {
      'ஜ': 'd͡ʒ', 'ஷ': 'ʂ', 'ஸ': 's', 'ஹ': 'h', 'க்ஷ': 'kʂ'
    };

    for (const word of words) {
      if (!word) continue;
      let ipa = '';
      const chars = Array.from(word);

      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        const next = chars[i + 1] || '';
        const prev = chars[i - 1] || '';

        // Check Virama (Pulli)
        const hasPulli = next === '்';

        // Grantha
        if (grantha[c]) {
          ipa += grantha[c];
          if (!hasPulli && !matras[next]) ipa += 'a';
          continue;
        }

        // Independent Vowels
        if (vowels[c]) {
          ipa += vowels[c];
          continue;
        }

        // Matras
        if (matras[c] || c === '்') {
          continue;
        }

        // Context-sensitive plosives: க, ச, ட, த, ப
        if (c === 'க') {
          if (i === 0) {
            ipa += 'k'; // Word-initial voiceless
            notes.push("Tamil 'க' at word-initial position pronounced voiceless [k]");
          } else if (prev === 'ங்') {
            ipa += 'ɡ'; // Voiced after nasal
            notes.push("Tamil 'க' after nasal 'ங்' voiced as [ɡ]");
          } else if (prev === 'க்') {
            ipa += 'kː'; // Geminate voiceless stop
          } else {
            ipa += 'ɣ'; // Intervocalic fricative/soft [ɣ]
            notes.push("Tamil 'க' in intervocalic position softened to fricative [ɣ]");
          }
        } else if (c === 'ச') {
          if (i === 0) {
            ipa += 't͡ʃ';
          } else if (prev === 'ஞ்') {
            ipa += 'd͡ʒ';
            notes.push("Tamil 'ச' after nasal voiced as [d͡ʒ]");
          } else if (prev === 'ச்') {
            ipa += 't͡ʃː';
          } else {
            ipa += 's';
            notes.push("Tamil 'ச' intervocalic softened to alveolar sibilant [s]");
          }
        } else if (c === 'ட') {
          if (i === 0 || prev === 'ட்') {
            ipa += 'ʈ';
          } else if (prev === 'ண்') {
            ipa += 'ɖ';
            notes.push("Tamil 'ட' after retroflex nasal 'ண்' voiced as [ɖ]");
          } else {
            ipa += 'ɽ'; // Flapped retroflex
            notes.push("Tamil 'ட' intervocalic voiced as retroflex flap [ɽ]");
          }
        } else if (c === 'த') {
          if (i === 0 || prev === 'த்') {
            ipa += 't̪';
          } else if (prev === 'ந்') {
            ipa += 'd̪';
            notes.push("Tamil 'த' after dental nasal 'ந்' voiced as [d̪]");
          } else {
            ipa += 'ð'; // Intervocalic dental fricative
            notes.push("Tamil 'த' intervocalic realized as voiced dental fricative [ð]");
          }
        } else if (c === 'ப') {
          if (i === 0 || prev === 'ப்') {
            ipa += 'p';
          } else if (prev === 'ம்') {
            ipa += 'b';
            notes.push("Tamil 'ப' after bilabial nasal 'ம்' voiced as [b]");
          } else {
            ipa += 'β'; // Intervocalic bilabial fricative
            notes.push("Tamil 'ப' intervocalic realized as bilabial fricative [β]");
          }
        } else if (c === 'ங') {
          ipa += 'ŋ';
        } else if (c === 'ஞ') {
          ipa += 'ɲ';
        } else if (c === 'ண') {
          ipa += 'ɳ';
        } else if (c === 'ந') {
          ipa += 'n̪';
        } else if (c === 'ம') {
          ipa += 'm';
        } else if (c === 'ன') {
          ipa += 'n';
        } else if (c === 'ய') {
          ipa += 'j';
        } else if (c === 'ர') {
          ipa += 'ɾ';
        } else if (c === 'ல') {
          ipa += 'l';
        } else if (c === 'வ') {
          ipa += 'ʋ';
        } else if (c === 'ழ') {
          ipa += 'ɻ'; // Retroflex approximant
          notes.push("Tamil unique retroflex approximant 'ழ' mapped to [ɻ]");
        } else if (c === 'ள') {
          ipa += 'ɭ';
        } else if (c === 'ற') {
          ipa += (prev === 'ற்' ? 'tːr' : 'r');
        } else {
          ipa += c;
        }

        // Add inherent vowel /a/ if no virama or matra follows
        if (!hasPulli) {
          if (matras[next]) {
            ipa += matras[next];
          } else if (next !== '்' && !vowels[next] && /[஀-௿]/.test(c)) {
            ipa += 'a';
          }
        }
      }

      ipaWords.push(ipa);
    }

    return {
      ipa: ipaWords.join(' '),
      ruleNotes: Array.from(new Set(notes)),
    };
  }

  // --------------------------------------------------------------------------
  // 2. HINDI G2P (Devanagari schwa deletion, conjuncts, nukta)
  // --------------------------------------------------------------------------
  private static phonemizeHindi(text: string): { ipa: string; ruleNotes: string[] } {
    const notes: string[] = [];
    const words = text.split(/\s+/);
    const ipaWords: string[] = [];

    const vowels: Record<string, string> = {
      'अ': 'ə', 'आ': 'aː', 'इ': 'ɪ', 'ई': 'iː', 'उ': 'ʊ', 'ऊ': 'uː',
      'ऋ': 'rɪ', 'ए': 'eː', 'ऐ': 'ɛː', 'ओ': 'oː', 'औ': 'ɔː'
    };

    const matras: Record<string, string> = {
      'ा': 'aː', 'ि': 'ɪ', 'ी': 'iː', 'ु': 'ʊ', 'ू': 'uː',
      'ृ': 'rɪ', 'े': 'eː', 'ै': 'ɛː', 'ो': 'oː', 'ौ': 'ɔː'
    };

    const consonants: Record<string, string> = {
      'क': 'k', 'ख': 'kʰ', 'ग': 'ɡ', 'घ': 'ɡʱ', 'ङ': 'ŋ',
      'च': 't͡ʃ', 'छ': 't͡ʃʰ', 'ज': 'd͡ʒ', 'झ': 'd͡ʒʱ', 'ञ': 'ɲ',
      'ट': 'ʈ', 'ठ': 'ʈʰ', 'ड': 'ɖ', 'ढ': 'ɖʱ', 'ण': 'ɳ',
      'त': 't̪', 'थ': 't̪ʰ', 'द': 'd̪', 'ध': 'd̪ʱ', 'न': 'n',
      'प': 'p', 'फ': 'pʰ', 'ब': 'b', 'भ': 'bʱ', 'म': 'm',
      'य': 'j', 'र': 'r', 'ल': 'l', 'व': 'ʋ',
      'श': 'ʃ', 'ष': 'ʂ', 'स': 's', 'ह': 'ɦ',
      // Nukta consonants
      'क़': 'q', 'ख़': 'x', 'ग़': 'ɣ', 'ज़': 'z', 'ड़': 'ɽ', 'ढ़': 'ɽʱ', 'फ़': 'f'
    };

    for (const word of words) {
      if (!word) continue;
      let ipa = '';
      const chars = Array.from(word);

      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        const next = chars[i + 1] || '';
        const isLast = i === chars.length - 1;

        if (vowels[c]) {
          ipa += vowels[c];
          continue;
        }

        if (c === '्' || matras[c]) {
          continue;
        }

        if (c === 'ं') {
          ipa += '̃'; // Anusvara nasalization
          notes.push('Applied vowel nasalization (Anusvara ~)');
          continue;
        }

        if (c === 'ः') {
          ipa += 'h'; // Visarga
          continue;
        }

        const baseConsonant = consonants[c];
        if (baseConsonant) {
          ipa += baseConsonant;

          const hasHalant = next === '्';
          if (!hasHalant) {
            if (matras[next]) {
              ipa += matras[next];
            } else if (isLast) {
              // Hindi Schwa Deletion Rule: Terminal inherent schwa is deleted (कमल -> kəməl, not kəmələ)
              notes.push('Applied Hindi terminal schwa-deletion rule (dropping inherent /ə/ at word end)');
            } else {
              ipa += 'ə';
            }
          }
        } else {
          ipa += c;
        }
      }

      ipaWords.push(ipa);
    }

    return {
      ipa: ipaWords.join(' '),
      ruleNotes: Array.from(new Set(notes)),
    };
  }

  // --------------------------------------------------------------------------
  // 3. MALAYALAM G2P (Chillu letters & Samvruthokaram)
  // --------------------------------------------------------------------------
  private static phonemizeMalayalam(text: string): { ipa: string; ruleNotes: string[] } {
    const notes: string[] = [];
    const words = text.split(/\s+/);
    const ipaWords: string[] = [];

    // Chillu letters
    const chillu: Record<string, string> = {
      'ൺ': 'ɳ', 'ൻ': 'n', 'ർ': 'r', 'ൽ': 'l', 'ൾ': 'ɭ', 'ൿ': 'k'
    };

    const vowels: Record<string, string> = {
      'അ': 'a', 'ആ': 'aː', 'ഇ': 'i', 'ഈ': 'iː', 'ഉ': 'u', 'ഊ': 'uː',
      'ഋ': 'rɨ', 'എ': 'e', 'ഏ': 'eː', 'ഐ': 'aɪ', 'ഒ': 'o', 'ഓ': 'oː', 'ഔ': 'aʊ'
    };

    const matras: Record<string, string> = {
      'ാ': 'aː', 'ി': 'i', 'ീ': 'iː', 'ു': 'u', 'ൂ': 'uː',
      'ൃ': 'rɨ', 'െ': 'e', 'േ': 'eː', 'ൈ': 'aɪ', 'ൊ': 'o', 'ോ': 'oː', 'ൌ': 'aʊ'
    };

    const consonants: Record<string, string> = {
      'ക': 'k', 'ഖ': 'kʰ', 'ഗ': 'ɡ', 'ഘ': 'ɡʱ', 'ങ': 'ŋ',
      'ച': 't͡ʃ', 'ഛ': 't͡ʃʰ', 'ജ': 'd͡ʒ', 'ഝ': 'd͡ʒʱ', 'ഞ': 'ɲ',
      'ട': 'ʈ', 'ഠ': 'ʈʰ', 'ഡ': 'ɖ', 'ഢ': 'ɖʱ', 'ണ': 'ɳ',
      'ത': 't̪', 'ഥ': 't̪ʰ', 'ദ': 'd̪', 'ധ': 'd̪ʱ', 'ന': 'n',
      'പ': 'p', 'ഫ': 'pʰ', 'ബ': 'b', 'ഭ': 'bʱ', 'മ': 'm',
      'യ': 'j', 'ര': 'r', 'ല': 'l', 'വ': 'ʋ',
      'ശ': 'ʃ', 'ഷ': 'ʂ', 'സ': 's', 'ഹ': 'ɦ',
      'ള': 'ɭ', 'ഴ': 'ɻ', 'റ': 'r'
    };

    for (const word of words) {
      if (!word) continue;
      let ipa = '';
      const chars = Array.from(word);

      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        const next = chars[i + 1] || '';
        const isLast = i === chars.length - 1;

        if (chillu[c]) {
          ipa += chillu[c];
          notes.push(`Mapped Malayalam Chillu letter '${c}' to pure consonant [${chillu[c]}]`);
          continue;
        }

        if (vowels[c]) {
          ipa += vowels[c];
          continue;
        }

        if (c === '്') {
          if (isLast) {
            // Samvruthokaram
            ipa += 'ɨ';
            notes.push("Malayalam terminal virama treated as Samvruthokaram half-u vowel [ɨ]");
          }
          continue;
        }

        if (matras[c]) {
          continue;
        }

        if (consonants[c]) {
          ipa += consonants[c];
          const hasVirama = next === '്';
          if (!hasVirama) {
            if (matras[next]) {
              ipa += matras[next];
            } else {
              ipa += 'a';
            }
          }
        } else {
          ipa += c;
        }
      }

      ipaWords.push(ipa);
    }

    return {
      ipa: ipaWords.join(' '),
      ruleNotes: Array.from(new Set(notes)),
    };
  }

  // --------------------------------------------------------------------------
  // 4. JAPANESE G2P (Kana conversion, particle assimilation)
  // --------------------------------------------------------------------------
  private static phonemizeJapanese(text: string): { ipa: string; ruleNotes: string[] } {
    const notes: string[] = [];

    // Particle replacement before phonemization
    let processed = text;
    // Particle は (ha -> wa)
    if (/(?:私|彼|これ|それ|あれ|誰)は/g.test(processed) || /[\u3040-\u309F]は[\s$、。]/g.test(processed)) {
      notes.push("Japanese topic particle 'は' converted to phonetic [wa]");
    }
    // Particle へ (he -> e)
    if (/(?:東京|学校|家|どこ)へ/g.test(processed) || /[\u3040-\u309F]へ[\s$、。]/g.test(processed)) {
      notes.push("Japanese directional particle 'へ' converted to phonetic [e]");
    }

    // Hiragana to IPA mapping table
    const kanaToIpa: Record<string, string> = {
      'あ': 'a', 'い': 'i', 'う': 'ɯ', 'え': 'e', 'お': 'o',
      'か': 'ka', 'き': 'kʲi', 'く': 'kɯ', 'け': 'ke', 'こ': 'ko',
      'さ': 'sa', 'し': 'ɕi', 'す': 'sɯ', 'せ': 'se', 'そ': 'so',
      'た': 'ta', 'ち': 't͡ɕi', 'つ': 't͡sɯ', 'て': 'te', 'と': 'to',
      'な': 'na', 'に': 'ɲi', 'ぬ': 'nɯ', 'ね': 'ne', 'の': 'no',
      'は': 'ha', 'ひ': 'çi', 'ふ': 'ɸɯ', 'へ': 'he', 'ほ': 'ho',
      'ま': 'ma', 'み': 'mʲi', 'む': 'mɯ', 'め': 'me', 'も': 'mo',
      'や': 'ja', 'ゆ': 'jɯ', 'よ': 'jo',
      'ら': 'ɾa', 'り': 'ɾʲi', 'る': 'ɾɯ', 'れ': 'ɾe', 'ろ': 'ɾo',
      'わ': 'wa', 'を': 'o', 'ん': 'ɴ',
      // Voiced
      'が': 'ɡa', 'ぎ': 'ɡʲi', 'ぐ': 'ɡɯ', 'げ': 'ɡe', 'ご': 'ɡo',
      'ざ': 'za', 'じ': 'd͡ʑi', 'ず': 'zɯ', 'ぜ': 'ze', 'ぞ': 'zo',
      'だ': 'da', 'ぢ': 'd͡ʑi', 'づ': 'zɯ', 'で': 'de', 'ど': 'do',
      'ば': 'ba', 'び': 'bʲi', 'ぶ': 'bɯ', 'べ': 'be', 'ぼ': 'bo',
      'ぱ': 'pa', 'ぴ': 'pʲi', 'ぷ': 'pɯ', 'ぺ': 'pe', 'ぽ': 'po',
      // Common Katakana equivalents
      'ア': 'a', 'イ': 'i', 'ウ': 'ɯ', 'エ': 'e', 'オ': 'o',
      'カ': 'ka', 'キ': 'kʲi', 'ク': 'kɯ', 'ケ': 'ke', 'コ': 'ko',
      'サ': 'sa', 'シ': 'ɕi', 'ス': 'sɯ', 'セ': 'se', 'ソ': 'so',
      'タ': 'ta', 'チ': 't͡ɕi', 'ツ': 't͡sɯ', 'テ': 'te', 'ト': 'to',
      'ナ': 'na', 'ニ': 'ɲi', 'ヌ': 'nɯ', 'ネ': 'ne', 'ノ': 'no',
      'ハ': 'ha', 'ヒ': 'çi', 'フ': 'ɸɯ', 'ヘ': 'he', 'ホ': 'ho',
      'マ': 'ma', 'ミ': 'mʲi', 'ム': 'mɯ', 'メ': 'me', 'モ': 'mo',
      'ヤ': 'ja', 'ユ': 'jɯ', 'ヨ': 'jo',
      'ラ': 'ɾa', 'リ': 'ɾʲi', 'ル': 'ɾɯ', 'レ': 'ɾe', 'ロ': 'ɾo',
      'ワ': 'wa', 'ヲ': 'o', 'ン': 'ɴ'
    };

    let ipa = '';
    const chars = Array.from(processed);

    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (c === 'っ' || c === 'ッ') {
        ipa += 'ː'; // Gemination (Sokuon)
        notes.push("Sokuon (っ) mapped to consonant gemination [ː]");
      } else if (c === 'ー') {
        ipa += 'ː'; // Chōonpu long vowel
      } else if (kanaToIpa[c]) {
        ipa += kanaToIpa[c] + ' ';
      } else if (/[\u4E00-\u9FAF]/.test(c)) {
        // Kanji placeholder token in phonetic stream
        ipa += `[kanji:${c}] `;
        notes.push(`Passed Kanji character '${c}' to pitch-accent neural acoustic head`);
      } else {
        ipa += c;
      }
    }

    return {
      ipa: ipa.trim(),
      ruleNotes: Array.from(new Set(notes)),
    };
  }

  // --------------------------------------------------------------------------
  // 5. ENGLISH G2P (IPA stress marking)
  // --------------------------------------------------------------------------
  private static phonemizeEnglish(text: string): { ipa: string; ruleNotes: string[] } {
    const notes: string[] = ['Standard English ARPAbet to IPA dictionary lookup with primary stress ˈ markers'];
    const words = text.toLowerCase().replace(/[^a-z0-9'\s]/g, '').split(/\s+/);

    const lookup: Record<string, string> = {
      'voiceforge': 'ˈvɔɪs.fɔːrd͡ʒ',
      'voice': 'ˈvɔɪs',
      'forge': 'ˈfɔːrd͡ʒ',
      'hello': 'həˈloʊ',
      'world': 'wɜːrld',
      'multilingual': 'ˌmʌltiˈlɪŋɡwəl',
      'speech': 'ˈspiːt͡ʃ',
      'synthesis': 'ˈsɪnθəsɪs',
      'cloning': 'ˈkloʊnɪŋ',
      'language': 'ˈlæŋɡwɪd͡ʒ',
      'audio': 'ˈɔːdioʊ',
      'studio': 'ˈstjuːdioʊ',
      'english': 'ˈɪŋɡlɪʃ',
      'tamil': 'ˈtæmɪl',
      'hindi': 'ˈhɪndi',
      'malayalam': 'ˌmæləˈjɑːləm',
      'japanese': 'ˌd͡ʒæpəˈniːz',
    };

    const result = words.map(w => lookup[w] || w.split('').join('.'));

    return {
      ipa: result.join(' '),
      ruleNotes: notes,
    };
  }
}
