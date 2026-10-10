# VoiceForge Multilingual Evaluation & Benchmark Specification

## 1. Quality & Performance Metrics Targets

| Metric | Target | Measurement Method | Tooling |
| :--- | :--- | :--- | :--- |
| **UTMOS (Proxy MOS)** | **$\ge$ 4.15 / 5.0** | Deep Learning speech naturalness prediction | UTMOS / NISQA |
| **Speaker Similarity** | **$\ge$ 0.82** (Cosine) | Cosine similarity on 192-dim speaker embeddings | ECAPA-TDNN (SpeechBrain) |
| **ASR Roundtrip (WER/CER)** | **$\le$ 4.2%** | Synthesize text $\to$ Whisper large-v3 transcribe $\to$ CER/WER | jiwer / Levinshtein |
| **Real-Time Factor (RTF)** | **$\le$ 0.25** | $\text{Inference Time} / \text{Audio Duration}$ (Single NVIDIA L4) | PyTorch CUDA Benchmark |
| **Streaming TTFB** | **$\le$ 450 ms** | Time from request receipt to first 40ms audio chunk | k6 load test harness |

---

## 2. Per-Language Evaluation Battery (100 Sentences Matrix)

### English (en-US / en-IN)
- **Number & Currency Normalization**:
  - *"Transfer $1,250,500.75 to account #9042 on 12/24/2026."*
  - *"Dr. Smith drove 45 mph down St. Catherine Ave. at 9:30 AM."*
- **Loanwords & Homographs**:
  - *"I will record a new record in the desert, but do not desert me."*
  - *"The tear in her eye fell when she saw the tear in the manuscript."*

### Hindi (hi-IN) (Devanagari)
- **Schwa Deletion & Loanwords**:
  - *"कमल (kamal) और कमला (kamalaa) ने दिल्ली विश्वविद्यालय में प्रवेश लिया।"* (Verifies terminal schwa deletion in 'kamal' vs preserved long vowel in 'kamalaa')
  - *"डॉक्टर साहब ने ₹5,50,000 (पाँच लाख पचास हज़ार) का बिल दिया।"* (Lakh/Crore Indian currency format)
- **Nukta & Aspirated Consonants**:
  - *"फ़ैसला (faislaa) और कानून (qanoon) के अनुसार ज़िला अदालत ने फ़र्म को राहत दी।"* (Nukta handling: फ़ vs फ, ज़ vs ज)

### Tamil (ta-IN)
- **Context-Sensitive Plosive Voicing (intervocalic & nasal assimilation)**:
  - *"கப்பல் (kappal - initial [k]) கடலில் (kadalil - intervocalic [d]) சென்றது."*
  - *"தங்கம் (thangam - nasal assimilation [ŋg]) விலையானது ₹65,400 ஆக உயர்ந்தது."*
- **Grantha Letters & Tamil Numerals**:
  - *"ஸ்ரீ லக்ஷ்மி ஜெயராம் ௱ (100) மரங்களை நட்டார்."* (Grantha: ஸ்ரீ, க்ஷ, ஜ; Tamil numeral: ௱)

### Malayalam (ml-IN)
- **Chillu Letters & Samvruthokaram**:
  - *"അവൻ (avan - chillu n ൻ) കാട്ടിൽ (kaattil - chillu l ൽ) ഒരു പാമ്പിനെ കണ്ടു് (kandŭ - samvruthokaram)."*
- **Conjuncts & Sanskrit loan compounds**:
  - *"വിദ്യാഭ്യാസ വകുപ്പ് (vidyabhyasa vakupp) പുതിയ ഉത്തരവിറക്കി."* (Heavy consonant conjunct: ദ്യ)

### Japanese (ja-JP)
- **Kanji $\to$ Reading with Context**:
  - *"今日は一日中雨が降っていました。"* (きょうは いちにちじゅう...)
  - *"1日（ついたち）に銀行（ぎんこう）へ行きます。"* (Irregular date counter reading: 1日 = tsuitachi)
- **Particle Voicing & Pitch Accent**:
  - *"私は学校へ行きます。"* (は pronounced [wa], へ pronounced [e])
  - *"橋（はし・LH）と箸（はし・HL）と端（はし・LH）。"* (Pitch accent minimal pairs)
