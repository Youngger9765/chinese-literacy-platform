import { describe, it, expect } from 'vitest';
import type { SpotlightBlock } from '../../../types';
import {
  countVisibleSegments,
  fingerprintBlocks,
  isInteractiveBlock,
  isSegmentStartBlock,
  resolveSingleCorrect,
  segmentBlocks,
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

  it('resolveSingleCorrect handles numeric answer', () => {
    expect(resolveSingleCorrect(['A', 'B'], 1, 1)).toBe(true);
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

  it('knows interactive block types', () => {
    expect(isInteractiveBlock('single')).toBe(true);
    expect(isInteractiveBlock('guide')).toBe(false);
  });
});
