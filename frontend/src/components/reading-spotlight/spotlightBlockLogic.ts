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

/**
 * @param optionKeys the option map's own keys, when it had any. Exam questions are
 *   keyed by letter — (A)(B)(C)(D) — and `answer` is that letter, so without the keys
 *   the string branch below compares 'A' against the whole Chinese option text and
 *   nothing can ever match.
 */
export function resolveSingleCorrect(
  options: string[],
  answer: string | number | null | undefined,
  selectedIdx: number,
  optionKeys?: string[],
): boolean {
  if (answer === null || answer === undefined) return false;
  // `answer` counts from ①, `selectedIdx` from 0 — the worksheets write 1, 2, 3
  // and every one of the 312 numeric answers in the extracted library is 1-based
  // (none is 0, none exceeds its option count).
  if (typeof answer === 'number') return selectedIdx + 1 === answer;
  // A letter (or any other key) names a position in the option map.
  if (optionKeys?.length) {
    const want = answer.trim().toUpperCase();
    const keyIdx = optionKeys.findIndex(k => String(k).trim().toUpperCase() === want);
    if (keyIdx !== -1) return selectedIdx === keyIdx;
  }
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
    case 'fill_table': {
      // `fill_table` 有兩種，而**只有一種畫得出「我做完了」的控制項**：
      //   沒有 rows ＝ 指路牌（「文章重點表請在…步驟填寫」），它有一顆「知道了」
      //               會把這個 key 設成 true —— 那種要按過才算數。
      //   有 rows   ＝ 表格就住在聚光燈裡，fall through 到 `table` 分支純繪製，
      //               畫面上沒有輸入框、也沒有按鈕能設這個值。
      // 以前兩種都要求 `val === true`，於是帶 rows 的那種**永遠不可能為真**，
      // 而 `countVisibleSegments` 會在它所在的那一段停住 ——
      // 後面每一段都永遠不顯示。L0087 的聚光燈有六節，學生只看得到三節
      // （第四節「小試身手」、第五節、第六節自我檢核全部到不了）。
      const hasRows = Array.isArray((block as { rows?: unknown[] }).rows)
        && ((block as { rows?: unknown[] }).rows as unknown[]).length > 0;
      return hasRows ? true : val === true;
    }
    default:
      return false;
  }
}

/**
 * `sub_block`（巢狀小題，例如「◎ 小試身手」「◎推論小偵探」）本身不在
 * `INTERACTIVE_BLOCK_TYPES` 裡，所以它整組都被當成「不用回答的 context」——
 * 不只是沒被算進完成度，而是**完全沒有任何程式碼路徑會去檢查它**。
 *
 * 真環境重現（L0016《這是什麼「意思」？》，#3682 追查 #3559 的延伸）：
 * 這一課唯一一節的頂層 block 只有 `concept_box` / `guide` / 兩個 `sub_block`，
 * 一個 `single` / `multi` / `free_text` 頂層 block 都沒有 —— `checkCompletion`
 * 要檢查的清單永遠是空陣列，`[].every(...)` 永遠為真，**但沒有任何呼叫點會去
 * 呼叫它**（`renderSubBlockOptions` 的「確認」鈕只設 feedback，從不觸發完成度
 * 檢查）。結果是：不管學生怎麼答，「下一關」永遠鎖死，跟內容對不對無關。
 *
 * 這兩個函式把 sub_block 的巢狀 items 攤平成跟渲染端同一組 key
 * （`${parentKey}-${i}`，見 `renderSubBlock` 的遞迴），只收「真的要回答」的項目：
 * - `single` / `multi` 要帶 `answer` 才算 —— 沒有 `answer` 的選項畫出來本來就是
 *   唯讀參考文字（`renderSubBlockOptions` 的第一個分支），不该要求回答。
 * - `free_text` 一律算（巢狀的開放式問答沒有「不用答」這個狀態）。
 * - `passage` 是參考短文，一律跳過。
 */
const NESTED_ANSWERABLE_TYPES = new Set(['single', 'multi', 'free_text']);

export interface SubBlockAnswerSlot {
  item: Record<string, unknown>;
  key: string;
}

function isNestedItemAnswerable(item: Record<string, unknown>): boolean {
  const type = item.type;
  if (type === 'free_text') return true;
  if (type === 'single' || type === 'multi') {
    return item.answer !== undefined && item.answer !== null;
  }
  return false;
}

export function collectSubBlockAnswerSlots(
  items: unknown[] | undefined,
  parentKey: string,
): SubBlockAnswerSlot[] {
  const out: SubBlockAnswerSlot[] = [];
  (items ?? []).forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null) return;
    const item = raw as Record<string, unknown> & { items?: unknown[] };
    const key = `${parentKey}-${i}`;
    if (isNestedItemAnswerable(item)) {
      out.push({ item, key });
    }
    if (Array.isArray(item.items)) {
      out.push(...collectSubBlockAnswerSlots(item.items, key));
    }
  });
  return out;
}

/** 整個 sub_block 有沒有答完——沒有任何需要回答的巢狀項目（純參考文字）視為已完成。 */
export function isSubBlockAnswered(
  block: { items?: unknown[] },
  state: Record<string, unknown>,
  key: string,
): boolean {
  const slots = collectSubBlockAnswerSlots(block.items, `${key}-s`);
  return slots.every(({ item, key: slotKey }) =>
    isBlockAnswered(item as unknown as SpotlightBlock, state, slotKey),
  );
}

/** 頂層 block 算不算「這一段需要互動」——補上 `sub_block`，否則它整組被當 context。 */
export function isTopBlockInteractive(type: string): boolean {
  return isInteractiveBlock(type) || type === 'sub_block';
}

/** 頂層 block 答完了沒——`sub_block` 改用遞迴檢查，其餘沿用既有 `isBlockAnswered`。 */
export function isTopBlockAnswered(
  block: SpotlightBlock,
  state: Record<string, unknown>,
  key: string,
): boolean {
  if (block.type === 'sub_block') {
    return isSubBlockAnswered(block as { items?: unknown[] }, state, key);
  }
  return isBlockAnswered(block, state, key);
}

export function isSegmentComplete(
  segment: SpotlightBlock[],
  segmentIdx: number,
  state: Record<string, unknown>,
): boolean {
  const interactive = segment
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => isTopBlockInteractive(b.type));

  if (interactive.length === 0) return true;

  return interactive.every(({ b, i }) =>
    isTopBlockAnswered(b, state, blockStateKey(segmentIdx, i)),
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
  story: {
    lesson_code?: string;
    grade_code?: string;
    worksheet_pdf_url?: string;
    images?: { filename: string }[];
  } | null | undefined,
  lessonId?: string | number,
  imageFilename?: string,
): string {
  if (story?.lesson_code) return story.lesson_code;
  if (story?.grade_code) return story.grade_code;
  if (story?.worksheet_pdf_url) {
    const m = /\/worksheets\/([^/]+)\.pdf$/i.exec(story.worksheet_pdf_url);
    if (m?.[1]) return m[1];
  }
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
