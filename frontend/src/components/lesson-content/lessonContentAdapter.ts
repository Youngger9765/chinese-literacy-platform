/**
 * lessonContentAdapter.ts — the ONLY place that touches the legacy `Story` shape to
 * produce a zod `Lesson` for the Phase-2 renderer. Dev/QA harness (Gap G0-B): until the
 * backend serves a real `lesson_content` block payload, this best-effort assembles a
 * Lesson from the fields a Story already carries (content / paragraphs / images / tables
 * / multipleChoice / fillInBlank). Because the feature flag is OFF by default, this only
 * ever runs in QA/tests.
 *
 * Contract: `storyToLesson(story)` returns `{ lesson, gaps }`. `lesson` is null when the
 * assembled object fails `LessonSchema.safeParse` (fail-loud, never a half-valid Lesson);
 * `gaps[]` honestly records every legacy field the adapter could not faithfully map
 * (null-answer MCQ, missing grid, missing lesson_code, etc.) — gaps are NOT faked into
 * passes.
 *
 * Key normalizations:
 *   - letter → index for MCQ / fill-in-blank choice answers (Gap G3): 'A'→0, 'B'→1…
 *   - LessonTable (legacy rows+section) → schema TableBlock fast path (rowSections +
 *     sectionLabelCol). Merged `grid` cannot be reconstructed from Story (Gap G2) → gap.
 *   - INTERLEAVE + ANCHOR (段-圖對照): blocks are emitted in original passage order —
 *     each figure/table is inserted right after the FIRST paragraph that references it
 *     (matched on 圖N `figure_label` / 表N title prefix, the same signal PairedReading
 *     #2085/#2194 uses), not stacked at the end. Each exercise anchors to the media its
 *     OWN text references (圖N/表N), falling back to the first paragraph only when it
 *     references none. Together these let a real graphic-text Story resolve to the
 *     'paired' layout (an exercise anchoring media over interleaved blocks).
 */
import {
  LessonSchema,
  type Lesson,
} from '../../schema/lessonContent';
import type { Story, MultipleChoiceItem, LessonTable } from '../../types';
import { letterToIndex } from './lessonGrading';

type StoryImage = NonNullable<Story['images']>[number];

interface AdapterResult {
  lesson: Lesson | null;
  gaps: string[];
}

/** Resolve the passage paragraphs a Story exposes (paragraphs preferred, then content). */
function resolveParagraphs(story: Story): string[] {
  if (Array.isArray(story.paragraphs) && story.paragraphs.length > 0) return story.paragraphs;
  if (Array.isArray(story.content) && story.content.length > 0) return story.content;
  return [];
}

// ── 段-圖/表 對照訊號 (ported from ComprehensionLayout, the legacy source of truth) ──
// The reliable signal for "which paragraph goes with which media" is the inline 圖N/表N
// reference in the passage text (matched to media by `figure_label` / 表N title prefix),
// NOT array order — mirrors PairedReading (#2085/#2194). We port these regex helpers here
// so the adapter can (a) INTERLEAVE media right after the paragraph that first references
// them, and (b) ANCHOR each exercise to the media its own text references.

const CN_NUM_MAP: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 圖一 → 1 … 圖十 → 10; Arabic 圖3 → 3; null if unparseable (#2085). */
function tokenToNumber(token: string): number | null {
  if (CN_NUM_MAP[token] != null) return CN_NUM_MAP[token];
  const n = parseInt(token, 10);
  return Number.isNaN(n) ? null : n;
}

/** Deduped 圖N numbers referenced in `text`, in first-appearance order (#2085). */
function parseFigureRefs(text: string): number[] {
  // Negative lookbehind for compound words ending in 圖 (製圖/地圖/示圖…) — no false hits.
  const re = /(?<!製|地|示|插|底|簡|描|附|草)圖\s*([一二三四五六七八九十]|\d+)/g;
  return dedupeMatches(re, text);
}

/** Deduped 表N numbers referenced in `text`, in first-appearance order (#2194). */
function parseTableRefs(text: string): number[] {
  // Negative lookbehind for compound words ending in 表 (外表/代表/圖表…) — no false hits.
  const re = /(?<!外|代|列|報|示|綜|述|發|圖)表\s*([一二三四五六七八九十]|\d+)/g;
  return dedupeMatches(re, text);
}

function dedupeMatches(re: RegExp, text: string): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = tokenToNumber(m[1]);
    if (n != null && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * figure number → block id, keyed on the REAL `figure_label` baked into the YAML
 * (圖一…), NOT array order — the array is often reversed (#2085). Falls back to
 * (index + 1) for images that lack a label so single-image lessons still resolve.
 * Block ids are `fig-{i+1}` (array position), matching how figure blocks are emitted.
 */
function buildFigureNumToBlockId(images: StoryImage[]): Map<number, string> {
  const map = new Map<number, string>();
  images.forEach((img, idx) => {
    let num: number | null = null;
    if (img.figure_label) {
      const mt = img.figure_label.match(/圖\s*([一二三四五六七八九十]|\d+)/);
      if (mt) num = tokenToNumber(mt[1]);
    }
    if (num == null) num = idx + 1;
    if (!map.has(num)) map.set(num, `fig-${idx + 1}`);
  });
  return map;
}

/**
 * table number → block id, keyed on the 表N prefix embedded in the table title (#2194).
 * Tables WITHOUT a 表N prefix get no key (do NOT assign a fallback), so an untitled
 * 重點表 never accidentally matches a 表一 reference. Block ids are `table-{i+1}`.
 */
function buildTableNumToBlockId(tables: LessonTable[]): Map<number, string> {
  const map = new Map<number, string>();
  tables.forEach((tbl, idx) => {
    const mt = (tbl.title ?? '').match(/表\s*([一二三四五六七八九十]|\d+)/);
    if (!mt) return;
    const num = tokenToNumber(mt[1]);
    if (num != null && !map.has(num)) map.set(num, `table-${idx + 1}`);
  });
  return map;
}

/**
 * Media block ids an exercise references, via 圖N/表N tokens in ITS OWN text
 * (question / options / explanation / sentence), deduped & order-preserving. Empty
 * when the exercise references no figure/table — the caller then falls back to a
 * paragraph anchor. This is the exercise-side twin of the paragraph interleave signal.
 */
function anchorIdsForText(
  text: string,
  figMap: Map<number, string>,
  tblMap: Map<number, string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string | undefined) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  parseFigureRefs(text).forEach((n) => push(figMap.get(n)));
  parseTableRefs(text).forEach((n) => push(tblMap.get(n)));
  return out;
}

/** legacy LessonTable → schema TableBlock (fast path: rows + section column). */
function toLessonTableBlock(
  table: LessonTable,
  id: string,
): Record<string, unknown> {
  const hasSection = !!table.section_label_col && table.rows.some((r) => r.section);
  const block: Record<string, unknown> = {
    id,
    type: 'table',
    label: table.title ?? null,
    title: table.title ?? null,
    headers: table.headers ?? [],
    rows: table.rows.map((r) => r.cells),
    notes: table.notes ?? [],
  };
  if (hasSection) {
    block.sectionLabelCol = table.section_label_col;
    block.rowSections = table.rows.map((r) => r.section ?? '');
  }
  return block;
}

/**
 * storyToLesson — best-effort legacy Story → zod Lesson (dev/QA harness only).
 * Returns null lesson (+ recorded gaps) whenever the result would not satisfy the
 * frozen contract, so the flag-guarded pages fall safely back to the legacy path.
 */
export function storyToLesson(story: Story | null | undefined): AdapterResult {
  const gaps: string[] = [];
  if (!story) return { lesson: null, gaps: ['no story provided'] };

  const lessonCode = story.lesson_code || story.id;
  if (!story.lesson_code) {
    gaps.push('G1: story.lesson_code missing — figure images may not resolve');
  }

  const paragraphs = resolveParagraphs(story);
  if (paragraphs.length === 0) {
    gaps.push('G0: story has no content/paragraphs — cannot build a lesson body');
    return { lesson: null, gaps };
  }

  const images = story.images ?? [];
  const tables = story.tables ?? [];

  // Media lookups (圖N/表N → block id) shared by BOTH the paragraph interleave below
  // and the exercise-anchor derivation further down. Block ids match array position:
  // figures are `fig-{i+1}`, tables are `table-{i+1}`.
  const figMap = buildFigureNumToBlockId(images);
  const tblMap = buildTableNumToBlockId(tables);

  const figureBlockById = new Map<string, Record<string, unknown>>();
  images.forEach((img, i) => {
    figureBlockById.set(`fig-${i + 1}`, {
      id: `fig-${i + 1}`,
      type: 'figure',
      label: img.figure_label ?? null,
      caption: img.caption ?? null,
      asset: img.filename ?? null,
    });
  });

  const tableBlockById = new Map<string, Record<string, unknown>>();
  tables.forEach((table, i) => {
    tableBlockById.set(`table-${i + 1}`, toLessonTableBlock(table, `table-${i + 1}`));
    if (table.section_label_col) {
      gaps.push(`G2: table ${table.id} merged-grid not reconstructable from Story (fast-path only)`);
    }
  });

  const blocks: Record<string, unknown>[] = [];
  const paragraphIds: string[] = [];
  const emittedMedia = new Set<string>();

  // Interleaved passage: for each non-empty paragraph, emit the paragraph then any
  // figure/table it is the FIRST to reference (matched by 圖N/表N, each media once) —
  // restoring the original 段-圖對照 ordering (p1 → fig-1, p2 → table-1, p3 → table-2)
  // instead of stacking all figures/tables at the end. Mirrors PairedReading (#2085/#2194).
  paragraphs.forEach((text, i) => {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return;
    const id = `p${i + 1}`;
    paragraphIds.push(id);
    blocks.push({ id, type: 'paragraph', text: trimmed });

    const mediaIds: string[] = [];
    parseFigureRefs(trimmed).forEach((n) => {
      const bid = figMap.get(n);
      if (bid) mediaIds.push(bid);
    });
    parseTableRefs(trimmed).forEach((n) => {
      const bid = tblMap.get(n);
      if (bid) mediaIds.push(bid);
    });
    mediaIds.forEach((bid) => {
      if (emittedMedia.has(bid)) return;
      const block = figureBlockById.get(bid) ?? tableBlockById.get(bid);
      if (!block) return;
      blocks.push(block);
      emittedMedia.add(bid);
    });
  });

  if (paragraphIds.length === 0) {
    gaps.push('G0: all paragraphs empty after trim');
    return { lesson: null, gaps };
  }

  const firstParaId = paragraphIds[0];

  // Leftover media referenced by NO paragraph → append in array order after the passage
  // (mirrors PairedReading 其他圖表). Preserves fail-safe rendering while keeping the
  // referenced media in their interleaved positions above.
  images.forEach((_img, i) => {
    const bid = `fig-${i + 1}`;
    if (emittedMedia.has(bid)) return;
    blocks.push(figureBlockById.get(bid)!);
    emittedMedia.add(bid);
  });
  tables.forEach((_table, i) => {
    const bid = `table-${i + 1}`;
    if (emittedMedia.has(bid)) return;
    blocks.push(tableBlockById.get(bid)!);
    emittedMedia.add(bid);
  });

  // Anchor an exercise to the media block(s) ITS OWN text references (圖N/表N), so
  // resolveLayout sees an exercise anchoring media and the 圖文表整合 case yields the
  // 'paired' layout. Fall back to the first paragraph only when no media is referenced.
  const anchorsFor = (...texts: (string | null | undefined)[]) => {
    const joined = texts.filter(Boolean).join('\n');
    const mediaIds = anchorIdsForText(joined, figMap, tblMap);
    const ids = mediaIds.length > 0 ? mediaIds : [firstParaId];
    return ids.map((blockId) => ({ blockId }));
  };

  // Reading-comprehension MCQs → exercise blocks. Legacy answer is a LETTER or null.
  (story.multipleChoice ?? []).forEach((mcq: MultipleChoiceItem, i) => {
    const id = `ex-mcq-${i + 1}`;
    const idx = mcq.answer != null ? letterToIndex(mcq.answer) : null;
    const anchors = anchorsFor(mcq.question, ...(mcq.options ?? []), mcq.explanation);
    if (idx == null) {
      // G3: null-answer MCQ — must emit needsReview or violate the answer invariant.
      gaps.push(`G3: MCQ #${i + 1} has no verifiable answer (answer=${JSON.stringify(mcq.answer)})`);
      blocks.push({
        id,
        type: 'exercise',
        question: {
          kind: 'multiple_choice',
          question: mcq.question,
          options: mcq.options,
          explanation: mcq.explanation ?? null,
        },
        answerSpace: 'choice',
        answer: 0,
        grader: 'manual',
        needsReview: true,
        anchors,
      });
      return;
    }
    blocks.push({
      id,
      type: 'exercise',
      question: {
        kind: 'multiple_choice',
        question: mcq.question,
        options: mcq.options,
        explanation: mcq.explanation ?? null,
      },
      answerSpace: 'choice',
      answer: idx,
      grader: 'exact',
      anchors,
    });
  });

  // Fill-in-blank (語詞應用): legacy each item is sentence + letter answer over vocabBank.
  const vocabBank = story.vocabBank;
  (story.fillInBlank ?? []).forEach((item, i) => {
    const id = `ex-fib-${i + 1}`;
    const idx = letterToIndex(item.answer);
    const options = vocabBank ? Object.keys(vocabBank).sort().map((k) => vocabBank[k]) : [];
    if (idx == null || options.length < 2) {
      gaps.push(`G3: fill-in-blank #${i + 1} not verifiable (answer=${JSON.stringify(item.answer)}, options=${options.length})`);
      return;
    }
    blocks.push({
      id,
      type: 'exercise',
      question: {
        kind: 'fill_in_blank',
        sentence: item.sentence,
        vocabBank: vocabBank ?? null,
      },
      answerSpace: 'choice',
      answer: idx,
      grader: 'exact',
      anchors: anchorsFor(item.sentence),
    });
  });

  // Note deliberate non-mappings (honest gaps; not synthesized into passes).
  if (story.strategyExercise) {
    gaps.push('G4: legacy strategyExercise not adapted (correct_order/correct_trait lossy — needs backend block payload)');
  }
  if (story.spotlightV2?.blocks?.length) {
    gaps.push('G0: spotlightV2 blocks not adapted (string answers, no answerSpace/grader invariant)');
  }

  const candidate = {
    id: story.id,
    lessonCode,
    title: story.title ?? null,
    blocks,
  };

  const parsed = LessonSchema.safeParse(candidate);
  if (!parsed.success) {
    gaps.push(`adapter output failed LessonSchema: ${parsed.error.issues.map((x) => x.message).slice(0, 3).join('; ')}`);
    return { lesson: null, gaps };
  }
  return { lesson: parsed.data, gaps };
}
