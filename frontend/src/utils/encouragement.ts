/**
 * Encouragement utility for student wrong-answer recovery flow (Issue #268)
 *
 * Positive, non-shaming messages for elementary school students (ages 9-15).
 * Used when a student answers incorrectly in comprehension chat or reading exercises.
 */

export const ENCOURAGEMENT_MESSAGES = [
  '加油！再想想看',
  '沒關係，我們一起來理解',
  '很好的嘗試！讓我給你一些提示',
  '慢慢來，你做得很好',
  '思考一下，你一定能想到的',
  '繼續努力，你越來越進步了',
] as const;

/**
 * Returns a random encouraging phrase for incorrect answers.
 * Cycles through the list to avoid repeating the same phrase.
 */
export function getEncouragementMessage(): string {
  const idx = Math.floor(Math.random() * ENCOURAGEMENT_MESSAGES.length);
  return ENCOURAGEMENT_MESSAGES[idx];
}
