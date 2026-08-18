import { describe, it, expect } from 'vitest';
import type { SpotlightBlock } from '../../../types';
import {
  countVisibleSegments,
  fingerprintBlocks,
  isInteractiveBlock,
  isSectionHeaderPrompt,
  isSegmentStartBlock,
  resolveSingleCorrect,
  segmentBlocks,
  resolveLessonCode,
  figureLabelFromBlock,
} from '../spotlightBlockLogic';

const G6_L22_SNIPPET: SpotlightBlock[] = [
  { type: 'guide', text: '好故事，大家都愛看。' },
  { type: 'passage', paragraphs: ['孟嘗君連夜逃到函谷關。'], source: 'supplementary' },
  {
    type: 'single',
    prompt: '❶主角是誰？',
    options: ['秦昭王', '孟嘗君'],
    answer: '孟嘗君',
  },
];

describe('spotlightBlockLogic', () => {
  it('treats guide with 練習 as segment start', () => {
    expect(isSegmentStartBlock({ type: 'guide', text: '練習一：第一段 vs 圖一' })).toBe(true);
    expect(isSegmentStartBlock({ type: 'guide', text: '小祕訣：先讀文字' })).toBe(false);
  });

  it('segments on passage boundaries', () => {
    const segs = segmentBlocks(G6_L22_SNIPPET);
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });

  it('resolveSingleCorrect handles string answer', () => {
    expect(resolveSingleCorrect(['秦昭王', '孟嘗君'], '孟嘗君', 1)).toBe(true);
    expect(resolveSingleCorrect(['秦昭王', '孟嘗君'], '孟嘗君', 0)).toBe(false);
  });

  /**
   * A numeric `answer` counts from ①, the option index counts from 0.
   *
   * The old assertion here was `resolveSingleCorrect(['A','B'], 1, 1) === true`,
   * which is the implementation restated rather than a claim about the data: it
   * passes whichever base the function uses. Measured across the 77 extracted
   * lessons, all 312 numeric answers are 1-based — none is 0, none exceeds its
   * option count — so ① must resolve at index 0.
   *
   * While the two were one apart, a two-option question whose answer was ② had
   * no option that could be marked right, and a three-option question marked the
   * option *after* the correct one.
   */
  /**
   * Exam-style questions print (A)(B)(C)(D) and the worksheet's answer line says
   * 「與選項【 A 】相符」, so the option map is keyed by letter and `answer` is that
   * letter. Flattening the map with `Object.values` throws the keys away, which left
   * the string branch comparing 'A' against the full Chinese option text — false in
   * both directions, so all 9 letter-keyed blocks in the library (L0020, L0044,
   * L0070) could never be answered correctly.
   *
   * Passing the keys alongside lets the letter resolve to its position. Renumbering
   * the data to 1,2,3 instead would break the printed answer line, which names the
   * letter.
   */
  it('resolveSingleCorrect resolves a letter answer through the option keys', () => {
    const opts = ['甲的敘述', '乙的敘述', '丙的敘述', '丁的敘述'];
    const keys = ['A', 'B', 'C', 'D'];
    expect(resolveSingleCorrect(opts, 'A', 0, keys)).toBe(true);
    expect(resolveSingleCorrect(opts, 'A', 1, keys)).toBe(false);
    expect(resolveSingleCorrect(opts, 'D', 3, keys)).toBe(true);
    expect(resolveSingleCorrect(opts, 'D', 0, keys)).toBe(false);
    // 大小寫與空白不該影響判定
    expect(resolveSingleCorrect(opts, ' b ', 1, keys)).toBe(true);
    // 沒有 keys 時仍走原本的字面比對，不可回歸
    expect(resolveSingleCorrect(['秦昭王', '孟嘗君'], '孟嘗君', 1)).toBe(true);
  });

  it('resolveSingleCorrect reads a numeric answer as 1-based', () => {
    expect(resolveSingleCorrect(['A', 'B'], 1, 0)).toBe(true);
    expect(resolveSingleCorrect(['A', 'B'], 1, 1)).toBe(false);
    expect(resolveSingleCorrect(['A', 'B'], 2, 1)).toBe(true);
    expect(resolveSingleCorrect(['A', 'B'], 2, 0)).toBe(false);
    expect(resolveSingleCorrect(['A', 'B', 'C'], 3, 2)).toBe(true);
    expect(resolveSingleCorrect(['A', 'B', 'C'], 3, 1)).toBe(false);
  });

  it('progressive reveal unlocks next segment after completion', () => {
    const blocks: SpotlightBlock[] = [
      { type: 'guide', text: '例一' },
      { type: 'free_text', prompt: 'Q1' },
      { type: 'passage', paragraphs: ['p2'], source: 'supplementary' },
      { type: 'free_text', prompt: 'Q2' },
    ];
    const segs = segmentBlocks(blocks);
    expect(countVisibleSegments(segs, {})).toBe(1);
    expect(countVisibleSegments(segs, { '0-1': 'answered' })).toBe(2);
  });

  it('fingerprintBlocks counts guides and passages', () => {
    const fp = fingerprintBlocks(G6_L22_SNIPPET);
    expect(fp.guide_count).toBe(1);
    expect(fp.passage_count).toBe(1);
    expect(fp.block_count).toBe(3);
  });

  it('detects section header prompts', () => {
    expect(isSectionHeaderPrompt('1.讓我們來看課文另一個故事')).toBe(true);
    expect(isSectionHeaderPrompt('❷主角遇到了什麼問題？')).toBe(false);
  });

  it('knows interactive block types', () => {
    expect(isInteractiveBlock('single')).toBe(true);
    expect(isInteractiveBlock('guide')).toBe(false);
  });

  it('resolveLessonCode prefers story.lesson_code then spotlight.lesson', () => {
    expect(
      resolveLessonCode(
        { lesson: 'G7-L29' },
        { lesson_code: 'G7-L29', images: [{ filename: 'images/G7-L29/G7-L29-09.png' }] },
        1109,
      ),
    ).toBe('G7-L29');
    expect(
      resolveLessonCode(
        { lesson: 'G7-L29' },
        { images: [{ filename: 'images/G7-L29/G7-L29-09.png' }] },
        1109,
      ),
    ).toBe('G7-L29');
  });

  it('figureLabelFromBlock maps fig1.png to 圖一', () => {
    expect(figureLabelFromBlock({ asset: 'fig1.png' })).toBe('圖一');
  });
});
