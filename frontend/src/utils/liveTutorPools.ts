/**
 * Canned response pools for LiveTutor paragraph evaluation feedback.
 * Randomly selected to avoid repetition.
 */

export const TIER1_POOL = [
  '唸得很棒！下一段。',
  '真厲害！下一段。',
  '讀得好清楚！下一段。',
  '好棒喔！下一段。',
  '很流利呢！下一段。',
  '讀得很棒！下一段。',
];

export const TIER2_POOL = [
  '唸得不錯！下一段。',
  '很好！下一段。',
  '不錯不錯！下一段。',
  '加油，繼續下一段！',
  '很好！繼續加油！',
  '讀得不錯喔！下一段。',
];

export const TIER3_POOL = [
  '還差一點點，再試一次！',
  '沒關係，再念一遍看看。',
  '加油！再念一次。',
  '再試一次，你可以的！',
  '慢慢來，再唸一遍。',
  '不要急，再讀一次喔。',
  '別灰心，再念一次！',
  '仔細看一看，再念一遍。',
];

export const STREAK_MESSAGES = [
  '', // 0 streak — unused
  '', // 1 streak — just use normal pool
  '', // 2 streak — just use normal pool
  '連續三段都唸對了，好厲害！',
  '連續四段了！你好棒！',
  '五段都對！你是朗讀小達人！',
];

export const LAST_LINE_MESSAGE = '全部唸完了！你好棒，辛苦了！';

export const pick = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];
