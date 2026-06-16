/**
 * Encouragement utility for student wrong-answer recovery flow (Issue #268)
 *
 * Positive, non-shaming messages for elementary school students (ages 9-15).
 * Used when a student answers incorrectly in comprehension chat or reading exercises.
 */

export const ENCOURAGEMENT_MESSAGES = [
  '加油！再想想看',
  '沒關係，我們一起來理解',
  '再想想看，你可以的',
  '慢慢來，你做得很好',
  '思考一下，你一定能想到的',
  '繼續努力，你越來越進步了',
] as const;

/** 生字定義配對答錯時 — 正面鼓勵、不說「答錯」、不承諾會給提示 (#2159) */
export const VOCAB_DEFINITION_ENCOURAGEMENT_MESSAGES = [
  '加油！再想想看',
  '沒關係，慢慢來',
  '思考一下，你一定能想到的',
  '繼續努力，你越來越進步了',
  '再想想看哪個字比較符合',
  '棒棒的嘗試，再選一次看看',
  '你很認真，再想想看',
  '再試試看，你可以的',
] as const;

export function getVocabDefinitionEncouragementMessage(): string {
  const idx = Math.floor(Math.random() * VOCAB_DEFINITION_ENCOURAGEMENT_MESSAGES.length);
  return VOCAB_DEFINITION_ENCOURAGEMENT_MESSAGES[idx];
}

/**
 * Returns a random encouraging phrase for incorrect answers.
 * Cycles through the list to avoid repeating the same phrase.
 */
export function getEncouragementMessage(): string {
  const idx = Math.floor(Math.random() * ENCOURAGEMENT_MESSAGES.length);
  return ENCOURAGEMENT_MESSAGES[idx];
}

/**
 * Issue #1094 — student-facing views hide numeric scores/accuracy/CPM and
 * show encouragement-only messages. Teacher dashboard still shows the numbers.
 */

export function encourageOverall(score: number): string {
  if (score >= 85) return '表現超棒！繼續保持';
  if (score >= 70) return '做得很好，再接再厲';
  if (score >= 50) return '有進步喔，繼續加油';
  return '一步一步來，你做得到';
}

export function encourageAccuracy(percent: number): string {
  if (percent >= 90) return '唸得很清楚！';
  if (percent >= 75) return '唸得不錯，再熟練一些';
  if (percent >= 50) return '有唸出來囉，再試一次會更好';
  return '慢慢來，多練幾次就會更順';
}

export function encourageReadingDone(): string {
  return '唸完囉！';
}

export function encourageQuiz(correct: number, total: number): string {
  if (total === 0) return '繼續加油！';
  const ratio = correct / total;
  if (ratio >= 0.9) return '太棒了，幾乎全對！';
  if (ratio >= 0.7) return '答得不錯，繼續加油';
  if (ratio >= 0.4) return '有答對一些，再想想看';
  return '再試一次，你一定可以';
}
