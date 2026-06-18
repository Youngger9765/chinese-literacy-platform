/**
 * spotlightBlockLogic.ts — pure logic for spotlight v2 block sequences.
 * Shared by BlockSequenceRenderer and regression tests.
 */
import type { SpotlightBlock } from '../../types';

// Re-export for tests — GraphicTextImageStrip owns GCS path logic
import { deriveLessonCodeFromFilename } from '../reading-steps/GraphicTextImageStrip';
export { deriveLessonCodeFromFilename };

const SEGMENT_START_RE =
  /練習[一二三四五六七八九十\d]|例[一二三四五六七八九十\d]|小試身手|步驟[❶①1-9]/;

export const INTERACTIVE_BLOCK_TYPES = new Set([
  'single',
  'multi',
  'free_text',
  'fill_table',
  'highlight',
  'self_check',
  'match',
]);

export function isInteractiveBlock(type: string): boolean {
  return INTERACTIVE_BLOCK_TYPES.has(type);
}

export function isSegmentStartBlock(block: SpotlightBlock): boolean {
  if (block.type === 'passage') return true;
  if (block.type === 'guide') {
    const text = block.text ?? '';
    return SEGMENT_START_RE.test(text);
  }
  return false;
}

/** Section intro lines misclassified as free_text — render as guide, not textarea. */
export function isSectionHeaderPrompt(prompt: string): boolean {
  const t = (prompt ?? '').trim();
  return /^\d+\.\s*(讓我們來看|進階挑戰)/.test(t);
}

export function resolveFreeTextCorrect(
  studentText: string,
  expected: string | null | undefined,
): boolean {
  if (!expected) return true;
  const norm = (s: string) => s.replace(/\s+/g, '').trim();
  const a = norm(studentText);
  const b = norm(expected);
  return a === b || a.includes(b) || b.includes(a);
}

/** Split blocks into teaching segments for progressive reveal. */
export function segmentBlocks(blocks: SpotlightBlock[]): SpotlightBlock[][] {
  if (blocks.length === 0) return [];

  const segments: SpotlightBlock[][] = [];
  let current: SpotlightBlock[] = [];

  for (const block of blocks) {
    if (current.length > 0 && isSegmentStartBlock(block)) {
      segments.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) segments.push(current);

  return segments.length > 0 ? segments : [blocks];
}

export function blockStateKey(segmentIdx: number, blockIdx: number): string {
  return `${segmentIdx}-${blockIdx}`;
}

export function resolveSingleCorrect(
  options: string[],
  answer: string | number | null | undefined,
  selectedIdx: number,
): boolean {
  if (answer === null || answer === undefined) return false;
  if (typeof answer === 'number') return selectedIdx === answer;
  const selected = options[selectedIdx] ?? '';
  const norm = (s: string) => s.replace(/\s+/g, '').trim();
  return norm(selected) === norm(answer) || selected.includes(answer) || answer.includes(selected);
}

export function isBlockAnswered(
  block: SpotlightBlock,
  state: Record<string, unknown>,
  key: string,
): boolean {
  const val = state[key];
  switch (block.type) {
    case 'single':
    case 'multi':
      return typeof val === 'number' || (Array.isArray(val) && val.length > 0);
    case 'free_text':
      return typeof val === 'string' && val.trim().length > 0;
    case 'self_check': {
      const checked = val as boolean[] | undefined;
      const n = block.items?.length ?? 0;
      return !!checked && checked.filter(Boolean).length >= n;
    }
    case 'fill_table':
      return val === true;
    default:
      return false;
  }
}

export function isSegmentComplete(
  segment: SpotlightBlock[],
  segmentIdx: number,
  state: Record<string, unknown>,
): boolean {
  const interactive = segment
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => isInteractiveBlock(b.type));

  if (interactive.length === 0) return true;

  return interactive.every(({ b, i }) =>
    isBlockAnswered(b, state, blockStateKey(segmentIdx, i)),
  );
}

export function countVisibleSegments(
  segments: SpotlightBlock[][],
  state: Record<string, unknown>,
): number {
  if (segments.length === 0) return 0;
  let visible = 1;
  for (let i = 0; i < segments.length - 1; i++) {
    if (!isSegmentComplete(segments[i], i, state)) break;
    visible = i + 2;
  }
  return visible;
}

export function fingerprintBlocks(blocks: SpotlightBlock[]): {
  block_count: number;
  guide_count: number;
  passage_count: number;
  type_sequence: string[];
} {
  return {
    block_count: blocks.length,
    guide_count: blocks.filter((b) => b.type === 'guide').length,
    passage_count: blocks.filter((b) => b.type === 'passage').length,
    type_sequence: blocks.map((b) => b.type),
  };
}

/** Resolve GCS lesson directory (e.g. G7-L29) for figure images. */
export function resolveLessonCode(
  spotlight: { lesson?: string },
  story: { lesson_code?: string; images?: { filename: string }[] } | null | undefined,
  lessonId?: string | number,
  imageFilename?: string,
): string {
  if (story?.lesson_code) return story.lesson_code;
  if (spotlight.lesson) return spotlight.lesson;
  if (typeof lessonId === 'string' && lessonId.includes('-')) return lessonId;
  if (imageFilename) return deriveLessonCodeFromFilename(imageFilename);
  const first = story?.images?.[0]?.filename;
  if (first) return deriveLessonCodeFromFilename(first);
  return '';
}
export function figureLabelFromBlock(block: {
  asset?: string | null;
  bind_paragraph?: string | number | null;
}): string | null {
  const asset = block.asset ?? '';
  const m = /fig(\d+)/i.exec(asset);
  if (m) {
    const n = parseInt(m[1], 10);
    const cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    return n <= 10 ? `圖${cn[n]}` : `圖${n}`;
  }
  const bind = String(block.bind_paragraph ?? '');
  const bm = /圖([一二三四五六七八九十\d])/.exec(bind);
  if (bm) return `圖${bm[1]}`;
  return null;
}
