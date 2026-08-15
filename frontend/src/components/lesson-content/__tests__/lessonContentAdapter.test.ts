/**
 * lessonContentAdapter.test.ts — the live-bridge adapter's 段-圖對照 contract.
 *
 * Guards the fix for the graphic-text bridge bug (spotlight-edd-foundation):
 *   1. A typical 圖文表 Story → storyToLesson yields blocks in INTERLEAVED passage order
 *      (paragraph then the figure/table it references, not all figures/tables stacked at
 *      the end), each exercise ANCHORS the media its text references, resolveLayout → 'paired',
 *      and groupPairedBlocks pairs each paragraph with its own figure/table.
 *   2. A plain 一般課文 Story (no images/tables) → resolveLayout → 'single-column-flow'.
 *   3. Regression guard: the hand-written G7-L30 fixture (which does NOT go through the
 *      adapter — it is parsed straight by LessonSchema) still resolves to 'paired' and
 *      keeps its p1→fig-1 / p2→table-1 / p3→table-2 pairing.
 *
 * The interleave + anchor signal is the inline 圖N/表N reference in the passage/exercise
 * text (matched to media by figure_label / 表N title prefix) — the same signal the legacy
 * ComprehensionLayout PairedReading uses. This test pins that behavior.
 */
import { describe, it, expect } from 'vitest';

import type { Story } from '../../../types';
import { storyToLesson } from '../lessonContentAdapter';
import { resolveLayout, groupPairedBlocks } from '../lessonLayout';
import { loadFixture } from '../../../schema/testHelpers';

/** Minimal valid Story with graphic-text signals (圖一 / 表一 / 表二 refs + media). */
function graphicTextStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'GT-1',
    title: '兩種八哥',
    level: '7',
    content: [],
    thumbnail: '',
    category: 'Science',
    filename: 'gt-1',
    lesson_code: 'GT-1',
    paragraphs: [
      '第一段：從圖一可以看出，這兩種八哥外形十分相似。',
      '第二段：表一比較了牠們在外形與習性上的異同。',
      '第三段：從表二可知，外來種白尾八哥明顯多過原生種。',
    ],
    images: [
      {
        filename: 'images/GT-1/G7-L30-06.png',
        size_bytes: 1,
        image_hash: 'h1',
        content_type: 'image/png',
        caption: '外形圖',
        figure_label: '圖一',
      },
    ],
    tables: [
      { id: 't1', title: '表一 異同比較表', headers: ['項目', '甲', '乙'], rows: [{ cells: ['外形', '黑', '黑'] }] },
      { id: 't2', title: '表二 數量變化表', headers: ['指標', '甲', '乙'], rows: [{ cells: ['數量', '多', '少'] }] },
    ],
    multipleChoice: [
      { question: '1. 根據表一，如何分辨兩種八哥？', options: ['甲', '乙', '丙', '丁'], answer: 'B', explanation: null },
      { question: '2. 需同時整合表一和表二才能判斷的是？', options: ['甲', '乙', '丙', '丁'], answer: 'A', explanation: null },
    ],
    ...overrides,
  } as Story;
}

/** Plain 一般課文 Story: prose + MCQ, no images/tables, no 圖N/表N refs. */
function plainTextStory(): Story {
  return {
    id: 'PT-1',
    title: '普通課文',
    level: '5',
    content: [],
    thumbnail: '',
    category: 'Fable',
    filename: 'pt-1',
    lesson_code: 'PT-1',
    paragraphs: [
      '從前有一隻烏鴉口渴了，四處尋找水喝。',
      '牠找到一個瓶子，裡面有一點點水，但喝不到。',
    ],
    multipleChoice: [
      { question: '烏鴉為什麼找水？', options: ['口渴', '肚子餓', '想玩', '睡覺'], answer: 'A', explanation: null },
    ],
  } as Story;
}

describe('storyToLesson — graphic-text 段-圖對照', () => {
  it('emits blocks in interleaved passage order (paragraph then its figure/table)', () => {
    const { lesson, gaps } = storyToLesson(graphicTextStory());
    expect(lesson, gaps.join('; ')).not.toBeNull();
    const order = lesson!.blocks.map((b) => b.id);
    // p1 → fig-1 → p2 → table-1 → p3 → table-2, then exercises last (NOT all media stacked).
    expect(order).toEqual([
      'p1', 'fig-1', 'p2', 'table-1', 'p3', 'table-2', 'ex-mcq-1', 'ex-mcq-2',
    ]);
  });

  it('anchors each exercise to the media its own text references (not always the first paragraph)', () => {
    const { lesson } = storyToLesson(graphicTextStory());
    const anchorsOf = (id: string) => {
      const b = lesson!.blocks.find((x) => x.id === id);
      if (!b || b.type !== 'exercise') throw new Error(`no exercise ${id}`);
      return (b.anchors ?? []).map((a) => a.blockId);
    };
    // "根據表一" → anchors table-1 only.
    expect(anchorsOf('ex-mcq-1')).toEqual(['table-1']);
    // "整合表一和表二" → anchors both tables.
    expect(anchorsOf('ex-mcq-2')).toEqual(['table-1', 'table-2']);
    // No exercise is left anchored to the first paragraph as a fallback here.
    for (const id of ['ex-mcq-1', 'ex-mcq-2']) {
      expect(anchorsOf(id)).not.toContain('p1');
    }
  });

  it('resolves to the paired layout (exercise anchors media over interleaved blocks)', () => {
    const { lesson } = storyToLesson(graphicTextStory());
    expect(resolveLayout(lesson!)).toBe('paired');
  });

  it('groupPairedBlocks pairs each paragraph with its own figure/table', () => {
    const { lesson } = storyToLesson(graphicTextStory());
    const items = groupPairedBlocks(lesson!.blocks);
    const paired = items
      .filter((it) => it.kind === 'paired')
      .map((it) => (it.kind === 'paired' ? { p: it.text.id, media: it.media.map((m) => m.id) } : null));
    expect(paired).toEqual([
      { p: 'p1', media: ['fig-1'] },
      { p: 'p2', media: ['table-1'] },
      { p: 'p3', media: ['table-2'] },
    ]);
    // Exercises stay full-width, in order.
    const fulls = items.filter((it) => it.kind === 'full').map((it) => (it.kind === 'full' ? it.block.id : ''));
    expect(fulls).toEqual(['ex-mcq-1', 'ex-mcq-2']);
  });

  it('appends media referenced by no paragraph after the passage (leftover, still paired-safe)', () => {
    // Drop the 圖一 reference from p1 so the figure is referenced by nothing.
    const story = graphicTextStory({
      paragraphs: [
        '第一段：這兩種八哥外形十分相似。', // no 圖一 ref
        '第二段：表一比較了牠們在外形與習性上的異同。',
        '第三段：從表二可知，外來種白尾八哥明顯多過原生種。',
      ],
    });
    const { lesson } = storyToLesson(story);
    const order = lesson!.blocks.map((b) => b.id);
    // table-1/table-2 stay interleaved; the unreferenced fig-1 lands after the passage.
    expect(order).toEqual([
      'p1', 'p2', 'table-1', 'p3', 'table-2', 'fig-1', 'ex-mcq-1', 'ex-mcq-2',
    ]);
    // Still a valid graphic-text lesson (exercise anchors a table).
    expect(resolveLayout(lesson!)).toBe('paired');
  });
});

describe('storyToLesson — plain 一般課文', () => {
  it('resolves to single-column-flow (no media to pair)', () => {
    const { lesson, gaps } = storyToLesson(plainTextStory());
    expect(lesson, gaps.join('; ')).not.toBeNull();
    expect(lesson!.blocks.some((b) => b.type === 'figure' || b.type === 'table')).toBe(false);
    expect(resolveLayout(lesson!)).toBe('single-column-flow');
  });
});

describe('regression: hand-written G7-L30 fixture does NOT change (bypasses the adapter)', () => {
  it('still resolves to paired and keeps p→media pairing', () => {
    const lesson = loadFixture('G7-L30.lesson.yml');
    expect(resolveLayout(lesson)).toBe('paired');
    const items = groupPairedBlocks(lesson.blocks);
    const paired = items
      .filter((it) => it.kind === 'paired')
      .map((it) => (it.kind === 'paired' ? { p: it.text.id, media: it.media.map((m) => m.id) } : null));
    // The multi-paragraph ex-spotlight anchor list carries no per-paragraph signal, so
    // pairing stays adjacency-driven: p1→fig-1, p2→table-1, p3→table-2 (unchanged).
    expect(paired).toEqual([
      { p: 'p1', media: ['fig-1'] },
      { p: 'p2', media: ['table-1'] },
      { p: 'p3', media: ['table-2'] },
    ]);
  });
});
