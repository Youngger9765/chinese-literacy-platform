/**
 * exitTicketLocalFallback.ts
 * Pure utility module — local rule-based fallback for ExitTicket.
 *
 * Extracted from ExitTicket.tsx (lines 24-237) to isolate the algorithm
 * and data constants from the React component. No behavior changes.
 *
 * Exports:
 *   - COMMON_PARTICLES  — Set of function words to skip as question targets
 *   - CONFUSABLE_CHARS  — Map of visually/phonetically similar Chinese chars
 *   - LocalQuestion     — Question type for local fallback output
 *   - generateLocalQuestions — Core algorithm (pure function, no React deps)
 */

export interface LocalQuestion {
  id: number;
  question: string;
  correctAnswer: string;
  options: string[];
  /** Always undefined for local questions (no server explanation) */
  explanation?: string;
  source: 'local';
}

interface WrongToken {
  char: string;
  expected: string;
}

/** Shuffle array using Fisher-Yates */
const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const COMMON_PARTICLES = new Set([
  '的', '了', '在', '是', '有', '和', '與', '也', '都', '就',
  '把', '被', '讓', '給', '從', '到', '著', '過', '嗎', '呢', '吧', '啊', '嗎',
]);

/**
 * Map of commonly confused Chinese characters (形近字 / 音近字).
 * When generating distractors, use these as priority options before falling back to story chars.
 */
export const CONFUSABLE_CHARS: Record<string, string[]> = {
  // 形近字 (visually similar)
  '己': ['已', '巳'],
  '已': ['己', '巳'],
  '巳': ['己', '已'],
  '未': ['末', '木'],
  '末': ['未', '木'],
  '大': ['太', '犬', '天'],
  '太': ['大', '犬', '天'],
  '犬': ['大', '太'],
  '日': ['目', '曰'],
  '目': ['日', '曰'],
  '人': ['入', '八'],
  '入': ['人', '八'],
  '土': ['士', '王'],
  '士': ['土', '王'],
  '干': ['千', '于', '幹'],
  '千': ['干', '于'],
  '天': ['夫', '大', '太'],
  '夫': ['天', '大'],
  '刀': ['力', '刃'],
  '力': ['刀', '刃'],
  '田': ['由', '甲', '申'],
  '由': ['田', '甲', '申'],
  '甲': ['田', '由', '申'],
  '白': ['自', '百', '臼'],
  '自': ['白', '百'],
  '百': ['白', '自'],
  '午': ['牛', '干'],
  '牛': ['午', '干'],
  '折': ['拆', '析'],
  '拆': ['折', '析'],
  '買': ['賣', '貿'],
  '賣': ['買', '貿'],
  '同': ['回', '向'],
  '回': ['同', '向'],
  '代': ['伐', '從'],
  '伐': ['代', '從'],
  // 形近字 - 三點水系列
  '晴': ['睛', '情', '清', '請', '精', '青'],
  '睛': ['晴', '情', '清', '青'],
  '情': ['晴', '睛', '清', '請'],
  '清': ['晴', '睛', '情', '請', '青'],
  '請': ['情', '清', '晴'],
  '精': ['晴', '清', '青'],
  '青': ['晴', '清', '精'],
  // 音近字 (phonetically similar)
  '在': ['再', '載', '栽'],
  '再': ['在', '載', '栽'],
  '的': ['得', '地', '底'],
  '得': ['的', '地', '底'],
  '地': ['的', '得', '底'],
  '做': ['作', '坐', '座'],
  '作': ['做', '坐', '座'],
  '坐': ['做', '作', '座'],
  '座': ['做', '作', '坐'],
  '他': ['她', '它', '祂'],
  '她': ['他', '它'],
  '它': ['他', '她'],
  '像': ['象', '向', '相'],
  '象': ['像', '向', '相'],
  '向': ['像', '象', '鄉'],
  '那': ['哪', '娜', '拿'],
  '哪': ['那', '娜'],
  '只': ['指', '紙', '隻', '支'],
  '指': ['只', '紙', '隻'],
  '紙': ['只', '指', '隻'],
  '隻': ['只', '指', '紙'],
  '園': ['圓', '源', '緣', '員', '遠'],
  '圓': ['園', '員', '遠'],
  '員': ['園', '圓', '遠'],
  '源': ['園', '緣', '遠'],
  '緣': ['源', '園', '員'],
  '生': ['聲', '勝', '省', '升'],
  '聲': ['生', '勝', '省'],
  '勝': ['生', '聲', '省'],
  '省': ['生', '聲', '勝'],
  '式': ['試', '是', '事', '市'],
  '試': ['式', '是', '事'],
  '是': ['式', '試', '事'],
  '事': ['式', '試', '是'],
  '市': ['式', '試', '是'],
  '練': ['煉', '鍊', '連'],
  '煉': ['練', '鍊', '連'],
  '鍊': ['練', '煉', '連'],
  '問': ['聞', '文', '閒'],
  '聞': ['問', '文', '閒'],
  '花': ['化', '華', '樺'],
  '化': ['花', '華'],
  '心': ['新', '辛', '欣'],
  '想': ['相', '向', '象'],
  '相': ['想', '象', '向'],
  '原': ['園', '圓', '員', '源'],
  '看': ['著', '觀', '視'],
  '說': ['話', '語', '悅'],
  '話': ['說', '語', '悅'],
  '走': ['足', '奔', '跑'],
  '跑': ['走', '足', '奔'],
  '來': ['回', '去', '到'],
  '去': ['來', '回', '到'],
  '開': ['關', '閉', '闊'],
  '關': ['開', '閉', '闊'],
  '高': ['告', '稿', '膏'],
  '好': ['壞', '妙', '姐'],
  '年': ['午', '牛', '幸'],
  '月': ['目', '日', '用'],
  '山': ['出', '止', '丘'],
  '水': ['木', '永', '氷'],
  '木': ['水', '本', '末'],
  '本': ['木', '末', '未'],
  '手': ['毛', '才', '扌'],
  '上': ['土', '止', '卡'],
  '下': ['上', '卡', '不'],
  '中': ['申', '由', '串'],
  '口': ['日', '目', '回'],
  '子': ['字', '孑', '孓'],
  '字': ['子', '守', '宇'],
};

/** Generate up to 3 multiple-choice questions from wrong + missing tokens (local fallback) */
export const generateLocalQuestions = (
  wrongTokens: WrongToken[],
  missingChars: string[],
  storyContent: string[],
): LocalQuestion[] => {
  if (wrongTokens.length === 0 && missingChars.length === 0) return [];

  const storyChars = new Set<string>();
  for (const paragraph of storyContent) {
    for (const ch of paragraph) {
      if (/[一-鿿]/.test(ch) && !COMMON_PARTICLES.has(ch)) storyChars.add(ch);
    }
  }

  const questions: LocalQuestion[] = [];

  const buildDistractors = (correctAnswer: string, exclude: Set<string>): string[] => {
    const chosen: string[] = [];
    const seen = new Set<string>([correctAnswer, ...exclude]);

    const confusables = CONFUSABLE_CHARS[correctAnswer] ?? [];
    for (const c of shuffle(confusables)) {
      if (!seen.has(c) && chosen.length < 3) { seen.add(c); chosen.push(c); }
    }
    for (const t of wrongTokens) {
      if (!seen.has(t.expected) && chosen.length < 3) { seen.add(t.expected); chosen.push(t.expected); }
    }
    for (const c of shuffle([...storyChars])) {
      if (!seen.has(c) && chosen.length < 3) { seen.add(c); chosen.push(c); }
    }
    while (chosen.length < 3) {
      const fallback = String.fromCharCode(0x4e00 + Math.floor(Math.random() * 200));
      if (!seen.has(fallback)) { seen.add(fallback); chosen.push(fallback); }
    }
    return chosen.slice(0, 3);
  };

  for (const token of shuffle(wrongTokens)) {
    if (questions.length >= 3) break;
    const distractors = buildDistractors(token.expected, new Set([token.char]));
    questions.push({
      id: questions.length + 1,
      question: `你讀成了「${token.char}」，正確的字應該是？`,
      correctAnswer: token.expected,
      options: shuffle([token.expected, ...distractors]),
      source: 'local',
    });
  }

  const usedChars = new Set(questions.map(q => q.correctAnswer));
  for (const ch of shuffle(missingChars)) {
    if (questions.length >= 3) break;
    if (usedChars.has(ch)) continue;
    if (COMMON_PARTICLES.has(ch)) continue;
    usedChars.add(ch);
    const distractors = buildDistractors(ch, new Set());
    questions.push({
      id: questions.length + 1,
      question: `你漏讀了一個字，是下面哪一個？`,
      correctAnswer: ch,
      options: shuffle([ch, ...distractors]),
      source: 'local',
    });
  }

  return questions;
};
