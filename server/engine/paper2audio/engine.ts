/**
 * Paper2Audio Engine: Conversational Academic Document to Human Voice Synthesizer
 * Features: Natural Language Fillers, Emotional Prosody, Intonation, Paralinguistic Cues,
 * Multi-Speaker Turn-Taking (Male, Female, Child Voices), and Native Language Nuance (EN, TA, HI, ML, JA).
 */

import { GoogleGenAI } from '@google/genai';
import { VoiceForgeSynthesizer } from '../audio/synthesizer.ts';
import { SupportedLanguage } from '../types.ts';

export interface PaperMetadata {
  title: string;
  authors: string[];
  year: string | number;
  field: string;
  abstract: string;
  coreProblem: string;
  methodology: string;
  breakthroughFindings: string[];
  realWorldImpact: string;
  rawText?: string;
}

export type DialogueFormat = 'podcast_duo' | 'lecture' | 'documentary' | 'executive' | 'eli5_child';

export interface VoicePersona {
  id: string;
  name: string;
  role: string;
  gender: 'male' | 'female' | 'child';
  language: 'en' | 'ta' | 'hi' | 'ml' | 'ja';
  age: number;
  pitch: number; // 0.85 (deep male), 1.0 (female), 1.45 (child)
  speed: number;
  description: string;
  avatar: string;
  accent: string;
}

export interface DialogueTurn {
  id: string;
  speakerId: string;
  speakerName: string;
  gender: 'male' | 'female' | 'child';
  avatar: string;
  emotion: 'excited' | 'thoughtful' | 'curious' | 'skeptical' | 'warm' | 'amazed' | 'authoritative';
  tone: string;
  text: string;
  nativeScriptText?: string;
  fillersUsed: string[];
  paralinguistics: string[]; // e.g. ['[pause: 0.3s]', '[chuckle]', '[gasp]']
  startTimeSec: number;
  durationSec: number;
  audioBase64?: string;
}

export interface PaperToAudioProject {
  id: string;
  title: string;
  format: DialogueFormat;
  language: 'en' | 'ta' | 'hi' | 'ml' | 'ja';
  paper: PaperMetadata;
  speakers: VoicePersona[];
  turns: DialogueTurn[];
  fullAudioBase64?: string;
  totalDurationSec: number;
  srtContent?: string;
  createdAt: string;
}

// ============================================================================
// VOICE PERSONAS CATALOG (Male, Female, Child across Languages)
// ============================================================================

export const PAPER_VOICE_PERSONAS: Record<string, VoicePersona> = {
  // English (EN)
  marcus_en: {
    id: 'marcus_en',
    name: 'Dr. Marcus Vance',
    role: 'Senior Principal Scientist',
    gender: 'male',
    language: 'en',
    age: 46,
    pitch: 0.88,
    speed: 0.96,
    description: 'Deep resonant baritone, authoritative yet engaging, master of intuitive metaphors.',
    avatar: '👨‍🏫',
    accent: 'US Academic Standard',
  },
  elena_en: {
    id: 'elena_en',
    name: 'Dr. Elena Rostova',
    role: 'Lead AI Investigator & Host',
    gender: 'female',
    language: 'en',
    age: 34,
    pitch: 1.06,
    speed: 1.02,
    description: 'Dynamic, curious, infectious intellectual excitement, asks the questions everyone wonders.',
    avatar: '👩‍🔬',
    accent: 'International English',
  },
  leo_en: {
    id: 'leo_en',
    name: 'Leo (Child)',
    role: 'Curious 8-Year-Old Junior Explorer',
    gender: 'child',
    language: 'en',
    age: 8,
    pitch: 1.48,
    speed: 1.05,
    description: 'Bright, inquisitive child voice, asks delightful questions like "Wait, so the robot has dreams?"',
    avatar: '👦',
    accent: 'American Youth',
  },

  // Tamil (தமிழ் - TA)
  senthil_ta: {
    id: 'senthil_ta',
    name: 'Dr. Senthil Kumar (செந்தில் குமார்)',
    role: 'Tamil Research Fellow',
    gender: 'male',
    language: 'ta',
    age: 40,
    pitch: 0.94,
    speed: 0.98,
    description: 'Articulate, inspiring Tamil orator, blends deep technical accuracy with natural conversational warmth.',
    avatar: '👨‍💼',
    accent: 'Chennai Standard Academic',
  },
  kavitha_ta: {
    id: 'kavitha_ta',
    name: 'Kavitha Sundaram (கவிதா சுந்தரம்)',
    role: 'Science Communicator & Host',
    gender: 'female',
    language: 'ta',
    age: 32,
    pitch: 1.08,
    speed: 1.02,
    description: 'Melodic, enthusiastic Tamil presenter, brings complex ideas to life with everyday village and modern metaphors.',
    avatar: '👩‍🏫',
    accent: 'Coimbatore / Chennai Flow',
  },
  maya_ta: {
    id: 'maya_ta',
    name: 'Maya (மாயா - Child)',
    role: 'Inquisitive 7-Year-Old',
    gender: 'child',
    language: 'ta',
    age: 7,
    pitch: 1.55,
    speed: 1.04,
    description: 'Sweet, playful Tamil child voice, full of wonder and cute questions.',
    avatar: '👧',
    accent: 'Tamil Child Intonation',
  },

  // Hindi (हिन्दी - HI)
  vikram_hi: {
    id: 'vikram_hi',
    name: 'Prof. Vikram Sharma (प्रो. विक्रम शर्मा)',
    role: 'Senior Professor of Computing',
    gender: 'male',
    language: 'hi',
    age: 44,
    pitch: 0.92,
    speed: 0.97,
    description: 'Rich, comforting Hindi/English scholar voice, explains deep mathematical insights effortlessly.',
    avatar: '👨‍🎓',
    accent: 'Delhi Standard Hindi',
  },
  ananya_hi: {
    id: 'ananya_hi',
    name: 'Ananya Verma (अनन्या वर्मा)',
    role: 'Tech Journalist & Co-Host',
    gender: 'female',
    language: 'hi',
    age: 29,
    pitch: 1.09,
    speed: 1.03,
    description: 'Sharp, lively Hindi broadcaster, energetic intonation with natural "मतलब", "अच्छा" fillers.',
    avatar: '👩‍💻',
    accent: 'Modern Conversational Hindi',
  },
  aarav_hi: {
    id: 'aarav_hi',
    name: 'Aarav (आरव - Child)',
    role: 'Tech-Curious 9-Year-Old',
    gender: 'child',
    language: 'hi',
    age: 9,
    pitch: 1.42,
    speed: 1.08,
    description: 'Energetic boy voice, fascinated by computers, rockets, and AI brains.',
    avatar: '👦',
    accent: 'Hindi Child Intonation',
  },

  // Malayalam (മലയാളം - ML)
  madhavan_ml: {
    id: 'madhavan_ml',
    name: 'Dr. Madhavan Pillai (ഡോ. മാധവൻ പിള്ള)',
    role: 'Bioinformatics Scientist',
    gender: 'male',
    language: 'ml',
    age: 48,
    pitch: 0.90,
    speed: 0.95,
    description: 'Calm, authoritative Malayalam scholar, crystal clear articulation and intellectual depth.',
    avatar: '👨‍🏫',
    accent: 'Central Kerala Academic',
  },
  priya_ml: {
    id: 'priya_ml',
    name: 'Dr. Priya Nair (ഡോ. പ്രിയ നായർ)',
    role: 'Lead Researcher & Host',
    gender: 'female',
    language: 'ml',
    age: 35,
    pitch: 1.05,
    speed: 1.0,
    description: 'Melodic, warm Malayalam scientist, engaging storyteller with natural prosodic cadence.',
    avatar: '👩‍🔬',
    accent: 'Kochi / Trivandrum Flow',
  },

  // Japanese (日本語 - JA)
  daisuke_ja: {
    id: 'daisuke_ja',
    name: 'Prof. Daisuke Tanaka (田中 大介教授)',
    role: 'Robotics & Neural Systems Professor',
    gender: 'male',
    language: 'ja',
    age: 52,
    pitch: 0.86,
    speed: 0.95,
    description: 'Measured, polite, rigorous Japanese scholar, speaks with quiet passion and analytical precision.',
    avatar: '👨‍🔬',
    accent: 'Tokyo Standard Japanese',
  },
  aoi_ja: {
    id: 'aoi_ja',
    name: 'Aoi Takahashi (高橋 葵)',
    role: 'Science Broadcaster & Narrator',
    gender: 'female',
    language: 'ja',
    age: 28,
    pitch: 1.14,
    speed: 1.04,
    description: 'Expressive, friendly Japanese presenter, bright vocal timbre with natural "なるほど", "ええと" phrasing.',
    avatar: '👩‍💼',
    accent: 'Tokyo Media Japanese',
  },
  hana_ja: {
    id: 'hana_ja',
    name: 'Hana (花 - Child)',
    role: 'Curious 8-Year-Old Girl',
    gender: 'child',
    language: 'ja',
    age: 8,
    pitch: 1.52,
    speed: 1.02,
    description: 'Gentle, wide-eyed Japanese child voice, reacts with wonder: "すごーい！ほんとに？"',
    avatar: '👧',
    accent: 'Japanese Child Intonation',
  },
};

// ============================================================================
// NATIVE LANGUAGE FILLERS & PROSODY DICTIONARY
// ============================================================================

export const LANGUAGE_NATURAL_FILLERS: Record<string, string[]> = {
  en: ['you know', 'like', 'well...', 'uhm', 'actually', 'I mean', 'so basically', 'right?', 'you see'],
  ta: ['வந்து...', 'அதாவது...', 'இப்போ...', 'தெரியுமா?', 'சரி...', 'பாத்தீங்கன்னா...', 'அப்புறம்...', 'நிஜமாவே...'],
  hi: ['मतलब...', 'यानी कि...', 'अरे...', 'देखो...', 'अच्छा...', 'तो...', 'समझे?', 'सच में...', 'दरअसल...'],
  ml: ['അതായത്...', 'പിന്നെ...', 'നോക്കൂ...', 'ശരി...', 'മനസ്സിലായോ?', 'എന്താണെന്നുവെച്ചാൽ...', 'സത്യത്തിൽ...'],
  ja: ['ええと...', 'あのー...', 'なんか...', 'そうですね...', 'なるほど...', '実は...', 'やっぱり...', 'ほら...'],
};

// ============================================================================
// SEMINAL PRE-LOADED RESEARCH PAPERS (Instant Testing)
// ============================================================================

export const PRELOADED_PAPERS: PaperMetadata[] = [
  {
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit', 'Llion Jones', 'Aidan N. Gomez', 'Łukasz Kaiser', 'Illia Polosukhin'],
    year: 2017,
    field: 'Artificial Intelligence / Deep Learning',
    abstract: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the Transformer, a model architecture eschewing recurrence and relying entirely on an attention mechanism to draw global dependencies between input and output.',
    coreProblem: 'Recurrent Neural Networks (RNNs and LSTMs) processed text sequentially token-by-token, making parallel GPU training impossible and struggling with long-term context retention.',
    methodology: 'Multi-Head Self-Attention layers combined with Sinusoidal Positional Encodings and Feed-Forward Networks with Residual Connections, eliminating recurrent loops completely.',
    breakthroughFindings: [
      'Trained in a fraction of the time compared to recurrent models while outperforming state-of-the-art BLEU scores on WMT English-to-German and English-to-French.',
      'Allowed massive scale parallelism that directly birthed modern LLMs including GPT, Claude, and Gemini.',
    ],
    realWorldImpact: 'Foundational bedrock of the entire generative AI revolution powering all modern frontier models.',
  },
  {
    title: 'DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning',
    authors: ['DeepSeek-AI Team', 'Daya Guo', 'Dejian Yang', 'Haowei Zhang', 'Jiashi Li', 'et al.'],
    year: 2025,
    field: 'Large Language Models / Reasoning & Reinforcement Learning',
    abstract: 'We introduce DeepSeek-R1-Zero and DeepSeek-R1. DeepSeek-R1-Zero is trained via large-scale reinforcement learning without supervised fine-tuning (SFT) as a preliminary step, demonstrating remarkable emergent reasoning capabilities including self-reflection, re-evaluation, and long thought chains.',
    coreProblem: 'Traditional LLMs required millions of expensive human-curated step-by-step reasoning demonstrations and often hallucinated in complex mathematical and coding tasks.',
    methodology: 'Pure Reinforcement Learning using GRPO (Group Relative Policy Optimization) with rule-based verification rewards (accuracy and format rewards), without human SFT initialization.',
    breakthroughFindings: [
      'DeepSeek-R1-Zero organically developed extended internal thinking chains ("aha moments"), self-correction, and verification strategies without any human instruction.',
      'Achieved parity with proprietary frontier models (OpenAI o1) on AIME, MATH-500, and Codeforces at dramatically reduced training cost.',
    ],
    realWorldImpact: 'Democratized frontier mathematical reasoning capabilities with fully open weights and detailed distillation recipes.',
  },
  {
    title: 'Accurate Structure Prediction of Biomolecular Interactions with AlphaFold 3',
    authors: ['Josh Abramson', 'Jonas Adler', 'Jack Dunger', 'Richard Evans', 'Tim Green', 'John Jumper', 'Demis Hassabis', 'et al.'],
    year: 2024,
    field: 'Computational Biology & Structural Chemistry (Nature)',
    abstract: 'We introduce AlphaFold 3, which predicts the joint 3D structure of complexes formed by proteins, nucleic acids (DNA and RNA), small molecules (ligands), ions, and chemical modifications directly from sequence inputs with atomic accuracy.',
    coreProblem: 'Previous biological models only folded isolated proteins, failing to simulate how proteins interact with DNA, RNA genes, and drug molecules in real cellular environments.',
    methodology: 'A unified Pairformer architecture paired with an SE(3)-equivariant Diffusion Module that directly predicts raw 3D Cartesian coordinates of all heavy atoms simultaneously.',
    breakthroughFindings: [
      'Achieved unprecedented 50%+ accuracy improvement in antibody-antigen binding and drug-target protein interaction prediction over specialized docking physics engines.',
      'Enables rapid computer-aided drug discovery for diseases previously deemed "undruggable".',
    ],
    realWorldImpact: 'Revolutionizes pharmaceutical drug design, vaccine engineering, and synthetic biology worldwide.',
  },
  {
    title: 'IndicTrans2: Towards High-Quality Machine Translation for All 22 Scheduled Indian Languages',
    authors: ['AI4Bharat', 'Jay Gala', 'Pranjal A. Chitale', 'Raghavan Ashok', 'Mitesh M. Khapra', 'et al.'],
    year: 2024,
    field: 'Multilingual NLP & Speech Synthesis for Indic Languages',
    abstract: 'We introduce IndicTrans2, the first open-source sequence-to-sequence model supporting all 22 scheduled Indian languages across 4 major language families (Indo-Aryan, Dravidian, Austroasiatic, Tibeto-Burman) with state-of-the-art human evaluation benchmarks.',
    coreProblem: 'Commercial translation models consistently mangled Dravidian grammar (Tamil, Malayalam) and lacked colloquial idioms, phonetic nuance, and script preservation.',
    methodology: 'Massive bilingual mining, script-unified BPE tokenization, and morphological inflection alignment trained on over 1 billion parallel sentences.',
    breakthroughFindings: [
      'Surpassed Google and commercial models in Tamil, Malayalam, and Hindi BLEU and chrF++ scores.',
      'Preserved cultural metaphors and honorific registers essential for human-sounding voice synthesis and dubbing.',
    ],
    realWorldImpact: 'Powers digital literacy, judicial transcript translations, and regional audio-speech synthesis across India.',
  },
];

// ============================================================================
// PAPER2AUDIO ENGINE CORE
// ============================================================================

export class Paper2AudioEngine {
  private ai: GoogleGenAI | null = null;
  private synth: VoiceForgeSynthesizer;

  constructor() {
    this.synth = new VoiceForgeSynthesizer();
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
      try {
        this.ai = new GoogleGenAI({ apiKey });
      } catch (err) {
        console.warn('Gemini client initialization notice in Paper2Audio:', err);
      }
    }
  }

  /**
   * 1. Parse Research Paper (Extract Structure, Findings, and Problem)
   */
  public async parsePaperText(paperContent: string): Promise<PaperMetadata> {
    if (!this.ai) {
      return this.fallbackParse(paperContent);
    }

    const prompt = `You are a distinguished research scientist and science communicator.
Analyze the following academic paper or technical document and extract its structured essence:
Text:
"""
${paperContent.slice(0, 15000)}
"""

Return a valid JSON object with:
- "title": string (concise paper title)
- "authors": array of strings (top authors)
- "year": number or string
- "field": string (e.g. "Quantum Computing", "Deep Learning", "Genomics")
- "abstract": string (clear summary)
- "coreProblem": string (what fundamental bottleneck was the author trying to solve?)
- "methodology": string (the core technique, algorithm, or experimental setup)
- "breakthroughFindings": array of 2-3 strings (key empirical results or discoveries)
- "realWorldImpact": string (why this matters for the future)`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text?.trim() || '';
      if (text) {
        const parsed = JSON.parse(text);
        return {
          title: parsed.title || 'Scientific Research Paper',
          authors: Array.isArray(parsed.authors) ? parsed.authors : ['Lead Researchers'],
          year: parsed.year || new Date().getFullYear(),
          field: parsed.field || 'Computer Science & AI',
          abstract: parsed.abstract || paperContent.slice(0, 300),
          coreProblem: parsed.coreProblem || 'Overcoming historical limitations in existing models.',
          methodology: parsed.methodology || 'Novel computational architecture and empirical benchmarking.',
          breakthroughFindings: Array.isArray(parsed.breakthroughFindings) ? parsed.breakthroughFindings : ['Significant improvement over baseline benchmarks.'],
          realWorldImpact: parsed.realWorldImpact || 'Enables more efficient and capable real-world deployment.',
          rawText: paperContent,
        };
      }
    } catch (err: any) {
      console.warn('Paper parsing API notice, using fallback parser:', err.message);
    }

    return this.fallbackParse(paperContent);
  }

  private fallbackParse(text: string): PaperMetadata {
    const firstLines = text.split('\n').filter(l => l.trim().length > 0);
    const title = firstLines[0]?.slice(0, 100) || 'Seminal Research Investigation';

    return {
      title,
      authors: ['Research Team'],
      year: new Date().getFullYear(),
      field: 'Scientific Discovery & Computing',
      abstract: text.slice(0, 400),
      coreProblem: 'Investigating high-dimensional computational efficiency and accuracy.',
      methodology: 'Empirical experimentation, algorithmic formulation, and comparative evaluation.',
      breakthroughFindings: [
        'Demonstrated strong empirical validation across primary experimental tasks.',
        'Established new architectural principles with high statistical confidence.',
      ],
      realWorldImpact: 'Accelerates domain knowledge and practical technological implementations.',
      rawText: text,
    };
  }

  /**
   * 2. Generate Conversational Audio Script with Natural Fillers, Emotion & Intonation
   */
  public async generateScript(params: {
    paper: PaperMetadata;
    format: DialogueFormat;
    language: 'en' | 'ta' | 'hi' | 'ml' | 'ja';
    speakerIds: string[];
    fillersDensity: 'subtle' | 'balanced' | 'rich'; // how many "you know", "like", "வந்து..." to inject
    targetLengthMinutes?: number;
  }): Promise<{ turns: DialogueTurn[]; srtContent: string }> {
    const { paper, format, language, speakerIds, fillersDensity } = params;
    const fillersList = LANGUAGE_NATURAL_FILLERS[language] || LANGUAGE_NATURAL_FILLERS.en;

    // Pick personas
    const selectedSpeakers = speakerIds.map(id => PAPER_VOICE_PERSONAS[id] || PAPER_VOICE_PERSONAS.marcus_en);

    if (this.ai) {
      const prompt = `You are an Emmy-winning science audio producer creating a hyper-realistic, human-sounding audio production of a research paper.
Paper Title: "${paper.title}" (${paper.year})
Field: ${paper.field}
Core Problem: ${paper.coreProblem}
Methodology: ${paper.methodology}
Breakthrough Findings: ${paper.breakthroughFindings.join('; ')}
Real-World Impact: ${paper.realWorldImpact}

Production Format: "${format}"
Target Language: "${language}" (Must write text in the natural native script of ${language}: English for EN, தமிழ் for TA, हिन्दी for HI, മലയാളം for ML, 日本語 for JA).
Fillers Density: "${fillersDensity}"
Available Native Fillers for ${language}: [${fillersList.join(', ')}]

Speaker Cast:
${selectedSpeakers.map(s => `- ID: "${s.id}", Name: "${s.name}", Role: "${s.role}", Gender: "${s.gender}" (Pitch: ${s.pitch}, Speed: ${s.speed})`).join('\n')}

CRITICAL INSTRUCTIONS FOR HUMAN SOUNDING VOICE:
1. Make the dialogue sound 100% human, spontaneous, and spoken (NOT read from a textbook).
2. Inject naturally used verbal fillers naturally at sentence boundaries:
   - For English: "you know", "well...", "like", "actually", "I mean", "right?"
   - For Tamil: "வந்து...", "அதாவது...", "இப்போ...", "தெரியுமா?", "சரி...", "பாத்தீங்கன்னா..."
   - For Hindi: "मतलब...", "यानी कि...", "अरे...", "देखो...", "अच्छा...", "तो...", "समझे?"
   - For Malayalam: "അതായത്...", "പിന്നെ...", "നോക്കൂ...", "ശരി...", "മനസ്സിലായോ?"
   - For Japanese: "ええと...", "あのー...", "なんか...", "そうですね...", "なるほど..."
3. Include paralinguistic cues in square brackets: [pause: 0.3s], [chuckle], [gasp], [mhm], [emphasis], [laugh]
4. If a child voice is included (e.g. Leo, Maya, Aarav, Hana), the child should ask charming, curious questions using vivid everyday analogies ("Wait, so is it like super-glue for atoms?").
5. Create 6 to 10 engaging conversational turns covering the intro hook, core mechanism, mind-blowing result, and conclusion.

Return a JSON array of turn objects:
[
  {
    "speakerId": "speaker id from cast",
    "speakerName": "speaker name",
    "gender": "male" | "female" | "child",
    "emotion": "excited" | "thoughtful" | "curious" | "skeptical" | "warm" | "amazed" | "authoritative",
    "tone": "short descriptor e.g. 'Warmly explaining with an analogy'",
    "text": "spoken dialogue with natural fillers and paralinguistic tags in native script",
    "fillersUsed": ["array of fillers used in this turn"],
    "paralinguistics": ["array of tags like [chuckle], [pause: 0.4s]"]
  }
]`;

      try {
        const response = await this.ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const text = response.text?.trim() || '';
        if (text) {
          const rawTurns = JSON.parse(text);
          if (Array.isArray(rawTurns) && rawTurns.length > 0) {
            let currentSec = 0;
            const turns: DialogueTurn[] = rawTurns.map((rt: any, idx: number) => {
              const speaker = selectedSpeakers.find(s => s.id === rt.speakerId) || selectedSpeakers[idx % selectedSpeakers.length];
              const words = (rt.text || '').split(/\s+/).length;
              // Duration estimate: ~140 words per minute adjusted for speaker speed
              const durSec = Math.max(3.2, Math.round((words / (145 * speaker.speed)) * 60 * 10) / 10);
              const turn: DialogueTurn = {
                id: `turn_${Date.now()}_${idx}`,
                speakerId: speaker.id,
                speakerName: speaker.name,
                gender: speaker.gender,
                avatar: speaker.avatar,
                emotion: rt.emotion || 'thoughtful',
                tone: rt.tone || 'Conversational',
                text: rt.text,
                fillersUsed: Array.isArray(rt.fillersUsed) ? rt.fillersUsed : [],
                paralinguistics: Array.isArray(rt.paralinguistics) ? rt.paralinguistics : ['[pause: 0.3s]'],
                startTimeSec: parseFloat(currentSec.toFixed(1)),
                durationSec: durSec,
              };
              currentSec += durSec + 0.35; // short breath pause between speakers
              return turn;
            });

            const srtContent = this.generateSRT(turns);
            return { turns, srtContent };
          }
        }
      } catch (err: any) {
        console.warn('Script generation notice, using deterministic generative script:', err.message);
      }
    }

    // High quality deterministic fallback script generator tailored to language and paper
    return this.generateFallbackScript(paper, format, language, selectedSpeakers);
  }

  private generateFallbackScript(
    paper: PaperMetadata,
    format: DialogueFormat,
    language: 'en' | 'ta' | 'hi' | 'ml' | 'ja',
    speakers: VoicePersona[]
  ): { turns: DialogueTurn[]; srtContent: string } {
    const s1 = speakers[0] || PAPER_VOICE_PERSONAS.marcus_en;
    const s2 = speakers[1] || PAPER_VOICE_PERSONAS.elena_en;
    const child = speakers.find(s => s.gender === 'child');

    const turnsData: Array<{ speaker: VoicePersona; emotion: DialogueTurn['emotion']; tone: string; text: string; fillers: string[]; para: string[] }> = [];

    if (language === 'ta') {
      turnsData.push({
        speaker: s2,
        emotion: 'excited',
        tone: 'அறிமுக உற்சாகம்',
        text: `வணக்கம்! வந்து... இன்னைக்கு நாம பேசப்போற ஆராய்ச்சி கட்டுரை "${paper.title}"! [pause: 0.3s] இது நிஜமாவே ஒரு மிகப்பெரிய திருப்புமுனை, தெரியுமா?`,
        fillers: ['வந்து...', 'தெரியுமா?'],
        para: ['[pause: 0.3s]'],
      });
      turnsData.push({
        speaker: s1,
        emotion: 'authoritative',
        tone: 'விளக்கமான குரல்',
        text: `ஆமாம்! அதாவது... இதுவரைக்கும் இருந்த பழைய முறைகள்ல என்ன சிக்கல்னா, ${paper.coreProblem} [pause: 0.4s] இப்போ இந்த ஆராய்ச்சியாளர்கள் அதை முற்றிலும் மாத்தி அமைச்சிருக்காங்க.`,
        fillers: ['அதாவது...', 'இப்போ...'],
        para: ['[pause: 0.4s]'],
      });
      if (child) {
        turnsData.push({
          speaker: child,
          emotion: 'curious',
          tone: 'குழந்தையின் வியப்பு',
          text: `அடேங்கப்பா! [gasp] அப்போ கம்ப்யூட்டர் நம்மள மாதிரி தானாவே புரிஞ்சிக்குமா? அது எப்படி பாசிபிள்?`,
          fillers: ['அடேங்கப்பா!'],
          para: ['[gasp]'],
        });
      }
      turnsData.push({
        speaker: s2,
        emotion: 'amazed',
        tone: 'ஆச்சரியத்துடன் விளக்கம்',
        text: `பாத்தீங்கன்னா... ${paper.breakthroughFindings[0] || 'அபாரமான முன்னேற்றம் கிடைச்சிருக்கு'}! [chuckle] இதுனால எதிர்காலத்துல நாம செய்ய முடியாத பல விஷயங்கள் சுலபமாகும்.`,
        fillers: ['பாத்தீங்கன்னா...'],
        para: ['[chuckle]'],
      });
    } else if (language === 'hi') {
      turnsData.push({
        speaker: s2,
        emotion: 'excited',
        tone: 'उत्साही शुरुआत',
        text: `नमस्ते दोस्तों! अरे... आज हम जिस रिसर्च पेपर की बात कर रहे हैं, वो है "${paper.title}"! [pause: 0.3s] सच में, ये विज्ञान की दुनिया में एक बड़ा धमाका है।`,
        fillers: ['अरे...', 'सच में...'],
        para: ['[pause: 0.3s]'],
      });
      turnsData.push({
        speaker: s1,
        emotion: 'thoughtful',
        tone: 'गंभीर विश्लेषण',
        text: `बिल्कुल! मतलब... पहले की सबसे बड़ी चुनौती यह थी कि ${paper.coreProblem} [pause: 0.4s] लेकिन इस पेपर में उन्होंने बिल्कुल नया रास्ता खोज निकाला।`,
        fillers: ['मतलब...', 'देखो...'],
        para: ['[pause: 0.4s]'],
      });
      if (child) {
        turnsData.push({
          speaker: child,
          emotion: 'curious',
          tone: 'मासूम सवाल',
          text: `अरे वाह! [gasp] तो क्या मशीनें अब सचमुच इंसानों की तरह सोच सकती हैं? जैसे जादू?`,
          fillers: ['अरे वाह!'],
          para: ['[gasp]'],
        });
      }
      turnsData.push({
        speaker: s2,
        emotion: 'amazed',
        tone: 'रोमांचक निष्कर्ष',
        text: `यानी कि... ${paper.breakthroughFindings[0] || 'नतीजे बेमिसाल रहे'}! [chuckle] और सबसे अच्छी बात ये है कि यह रियल-वर्ल्ड टेक्नोलॉजी को पूरी तरह बदल देगा।`,
        fillers: ['यानी कि...', 'अच्छा...'],
        para: ['[chuckle]'],
      });
    } else if (language === 'ml') {
      turnsData.push({
        speaker: s2,
        emotion: 'excited',
        tone: 'ഉന്മേഷഭരിതമായ തുടക്കം',
        text: `നമസ്കാരം! അതായത്... ഇന്ന് നമ്മൾ ചർച്ച ചെയ്യുന്നത് ശാസ്ത്രലോകത്തെ വിസ്മയിപ്പിച്ച "${paper.title}" എന്ന റിസർച്ച് പേപ്പറിനെക്കുറിച്ചാണ്. [pause: 0.3s]`,
        fillers: ['അതായത്...', 'ശരി...'],
        para: ['[pause: 0.3s]'],
      });
      turnsData.push({
        speaker: s1,
        emotion: 'authoritative',
        tone: 'ആഴത്തിലുള്ള വിവരണം',
        text: `അതെ, പിന്നെ... ഇതിനുമുമ്പുള്ള സാങ്കേതികവിദ്യകളിൽ ${paper.coreProblem} എന്നതായിരുന്നു പ്രധാന വെല്ലുവിളി. [pause: 0.4s] എന്നാൽ ഇവർ കൊണ്ടുവന്ന രീതി തികച്ചും വിപ്ലവകരമാണ്.`,
        fillers: ['പിന്നെ...', 'നോക്കൂ...'],
        para: ['[pause: 0.4s]'],
      });
      turnsData.push({
        speaker: s2,
        emotion: 'amazed',
        tone: 'പ്രതീക്ഷകൾ പങ്കുവെക്കുന്നു',
        text: `സത്യത്തിൽ... ${paper.breakthroughFindings[0] || 'വലിയൊരു കുതിച്ചുചാട്ടമാണിത്'}! [chuckle] ഇത് ഭാവിയിലെ കൃത്രിമബുദ്ധിയെയും മെഡിസിനെയും അടിമുടി മാറ്റും.`,
        fillers: ['സത്യത്തിൽ...'],
        para: ['[chuckle]'],
      });
    } else if (language === 'ja') {
      turnsData.push({
        speaker: s2,
        emotion: 'excited',
        tone: '明るく導入',
        text: `皆さんこんにちは！ええと...今日ご紹介する論文は世界中で話題沸騰の『${paper.title}』です！[pause: 0.3s]`,
        fillers: ['ええと...', 'あのー...'],
        para: ['[pause: 0.3s]'],
      });
      turnsData.push({
        speaker: s1,
        emotion: 'thoughtful',
        tone: '学術的な解説',
        text: `そうですね。従来の課題だったのは、まさに${paper.coreProblem}という点でした。[pause: 0.4s] しかし今回のアーキテクチャは根本からそれを打破したのです。`,
        fillers: ['そうですね...', 'なるほど...'],
        para: ['[pause: 0.4s]'],
      });
      if (child) {
        turnsData.push({
          speaker: child,
          emotion: 'curious',
          tone: '無邪気な質問',
          text: `すごーい！[gasp] それって、まるでロボットが自分で考えてひらめいたみたい！本当なの？`,
          fillers: ['すごーい！'],
          para: ['[gasp]'],
        });
      }
      turnsData.push({
        speaker: s2,
        emotion: 'amazed',
        tone: '未来展望',
        text: `実は... ${paper.breakthroughFindings[0] || '極めて画期的な精度を叩き出しました'}！[chuckle] これからの実世界への応用が本当に楽しみですね。`,
        fillers: ['実は...', 'やっぱり...'],
        para: ['[chuckle]'],
      });
    } else {
      // English Default
      turnsData.push({
        speaker: s2,
        emotion: 'excited',
        tone: 'Engaging Opening Hook',
        text: `Welcome back everyone! So... you know, today we are breaking down "${paper.title}"—and honestly, this paper blew my mind. [pause: 0.3s]`,
        fillers: ['you know', 'honestly'],
        para: ['[pause: 0.3s]'],
      });
      turnsData.push({
        speaker: s1,
        emotion: 'authoritative',
        tone: 'Professor Contextualizing',
        text: `Right! Because, well... if you look at the fundamental dilemma, ${paper.coreProblem} [pause: 0.4s] And what they engineered here completely sidesteps that bottleneck.`,
        fillers: ['well...', 'Right!'],
        para: ['[pause: 0.4s]'],
      });
      if (child) {
        turnsData.push({
          speaker: child,
          emotion: 'curious',
          tone: 'Child Wonder & Analogy',
          text: `Wait! [gasp] Does that mean the AI can remember things just like human brains do, or is it more like a giant super-library?`,
          fillers: ['Wait!'],
          para: ['[gasp]'],
        });
        turnsData.push({
          speaker: s1,
          emotion: 'warm',
          tone: 'Gentle Mentorship',
          text: `[chuckle] Exactly like a library where every book is instantly connected to every other page, Leo! That is what self-attention is all about.`,
          fillers: ['you see'],
          para: ['[chuckle]'],
        });
      }
      turnsData.push({
        speaker: s2,
        emotion: 'amazed',
        tone: 'Highlighting Results',
        text: `And look at the numbers! ${paper.breakthroughFindings[0] || 'It outperformed previous benchmarks by an astonishing margin'}! [pause: 0.2s] Like, that was previously thought to take another decade.`,
        fillers: ['Like', 'look at'],
        para: ['[pause: 0.2s]'],
      });
      turnsData.push({
        speaker: s1,
        emotion: 'thoughtful',
        tone: 'Forward Looking',
        text: `Indeed. The real takeaway is: ${paper.realWorldImpact} It fundamentally reshapes how we build intelligent systems.`,
        fillers: ['Indeed'],
        para: ['[pause: 0.3s]'],
      });
    }

    let currentSec = 0;
    const turns: DialogueTurn[] = turnsData.map((td, idx) => {
      const words = td.text.split(/\s+/).length;
      const durSec = Math.max(3.5, Math.round((words / (145 * td.speaker.speed)) * 60 * 10) / 10);
      const turn: DialogueTurn = {
        id: `turn_${Date.now()}_${idx}`,
        speakerId: td.speaker.id,
        speakerName: td.speaker.name,
        gender: td.speaker.gender,
        avatar: td.speaker.avatar,
        emotion: td.emotion,
        tone: td.tone,
        text: td.text,
        fillersUsed: td.fillers,
        paralinguistics: td.para,
        startTimeSec: parseFloat(currentSec.toFixed(1)),
        durationSec: durSec,
      };
      currentSec += durSec + 0.4;
      return turn;
    });

    const srtContent = this.generateSRT(turns);
    return { turns, srtContent };
  }

  /**
   * 3. Synthesize Multi-Speaker Dialogue Audio
   * Generates expressive WAV PCM audio for each turn with pitch, speed, and prosody adjustments.
   */
  public async synthesizeDialogueAudio(
    turns: DialogueTurn[],
    language: 'en' | 'ta' | 'hi' | 'ml' | 'ja' = 'en'
  ): Promise<{ turnsWithAudio: DialogueTurn[]; fullAudioBase64: string; totalDurationSec: number }> {
    const sampleRate = 24000;
    const audioBuffers: Buffer[] = [];

    const turnsWithAudio: DialogueTurn[] = [];

    for (const turn of turns) {
      const persona = PAPER_VOICE_PERSONAS[turn.speakerId] || PAPER_VOICE_PERSONAS.marcus_en;
      
      // Clean paralinguistic tags for acoustic synthesizer phonemizer
      const cleanedTextForSpeech = turn.text
        .replace(/\[pause:\s*[\d.]+s?\]/gi, ' ... ')
        .replace(/\[(?:chuckle|gasp|laugh|mhm|emphasis)\]/gi, '');

      // Synthesize turn audio via VoiceForgeSynthesizer with persona pitch/speed overrides
      const synthRes = await this.synth.synthesize(
        {
          voiceId: persona.id,
          text: cleanedTextForSpeech,
          language: language as SupportedLanguage,
          settings: {
            speed: persona.speed,
            pitch: persona.pitch,
            stability: 0.85,
            similarity: 0.9,
            style: 0.8,
            speakerBoost: true,
          },
          sampleRate,
        },
        {
          id: persona.id,
          name: persona.name,
          category: 'premade',
          gender: persona.gender === 'child' ? 'non_binary' : persona.gender,
          primaryLanguage: language as SupportedLanguage,
          supportedLanguages: [language as SupportedLanguage],
          accent: persona.accent,
          description: persona.description,
          defaultSettings: {
            speed: persona.speed,
            pitch: persona.pitch,
            stability: 0.85,
            similarity: 0.9,
            style: 0.8,
            speakerBoost: true,
          },
          avatarUrl: persona.avatar,
        }
      );

      const turnBuffer = Buffer.from(synthRes.audioBase64, 'base64');
      audioBuffers.push(turnBuffer);

      // Add 0.3s silence buffer between turns
      const silenceBytes = Math.round(sampleRate * 0.3 * 2);
      const silenceBuffer = Buffer.alloc(silenceBytes, 0);
      audioBuffers.push(silenceBuffer);

      turnsWithAudio.push({
        ...turn,
        audioBase64: synthRes.audioBase64,
      });
    }

    // Stitch combined audio buffer
    const fullAudioBuffer = this.stitchWavBuffers(audioBuffers, sampleRate);
    const totalDurationSec = fullAudioBuffer.length / (sampleRate * 2);

    return {
      turnsWithAudio,
      fullAudioBase64: fullAudioBuffer.toString('base64'),
      totalDurationSec: parseFloat(totalDurationSec.toFixed(1)),
    };
  }

  /**
   * Helper: Stitches multiple PCM WAV buffers into a single cohesive WAV file
   */
  private stitchWavBuffers(buffers: Buffer[], sampleRate: number): Buffer {
    let rawPcmLength = 0;
    const pcmChunks: Buffer[] = [];

    for (const b of buffers) {
      if (b.length > 44 && b.toString('utf8', 0, 4) === 'RIFF') {
        const pcm = b.subarray(44);
        pcmChunks.push(pcm);
        rawPcmLength += pcm.length;
      } else {
        pcmChunks.push(b);
        rawPcmLength += b.length;
      }
    }

    const header = Buffer.alloc(44);
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + rawPcmLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(rawPcmLength, 40);

    return Buffer.concat([header, ...pcmChunks]);
  }

  /**
   * Generate formatted SRT subtitles for player synchronization
   */
  public generateSRT(turns: DialogueTurn[]): string {
    const formatSrtTime = (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 1000);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    };

    return turns
      .map((t, idx) => {
        const start = formatSrtTime(t.startTimeSec);
        const end = formatSrtTime(t.startTimeSec + t.durationSec);
        return `${idx + 1}\n${start} --> ${end}\n[${t.speakerName}]: ${t.text}\n`;
      })
      .join('\n');
  }
}
