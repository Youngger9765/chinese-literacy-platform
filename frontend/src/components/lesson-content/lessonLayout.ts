/**
 * lessonLayout.ts — the ONE place the "一般課文 vs 圖文課文" split lives now.
 *
 * The core Phase-2 thesis: there is NO second code path for graphic-text lessons.
 * The renderer always walks `lesson.blocks` once, in order. The only difference is
 * a pure layout HINT computed here:
 *
 *   'single-column-flow' (DEFAULT) — blocks stack top-to-bottom; figures/tables/
 *      parallel_passage render inline where they sit; exercises follow. Covers the
 *      dominant real shape (G5 / G6 / wen).
 *   'paired' — the one structural nicety for 圖文表整合 (G7-L30): a pre-pass groups a
 *      paragraph with the figure/table it ANCHORS (or that immediately follows it) into
 *      a two-column row (text left, figure/table right). Exercises stay full-width below.
 *
 * Grouping is driven by anchors + block adjacency (robust), NOT ComprehensionLayout's
 * fragile `parseFigureRefs`/`parseTableRefs` regex. Flipping the hint to 'single' still
 * renders a graphic-text lesson correctly (just stacked) — proving convergence.
 *
 * Pure module — no React. All render-path derivation is done here so the renderer can
 * memoize it with no mutation (#2194 StrictMode-safe).
 */
import type { Block, Lesson } from '../../schema/lessonContent';

export type LessonLayout = 'single-column-flow' | 'paired';

/** Media blocks that can pair with a paragraph in the right column of a 'paired' row. */
const MEDIA_TYPES = new Set<Block['type']>(['figure', 'table']);

/**
 * resolveLayout — decide the layout hint from the lesson's block topology.
 *
 * Heuristic (mirrors the real corpus): a lesson is 'paired' when it interleaves
 * figures/tables with paragraphs AND at least one exercise anchors a media block —
 * i.e. the 圖文表整合 shape (G7-L30). Everything else is single-column-flow.
 */
export function resolveLayout(lesson: Lesson): LessonLayout {
  const blocks = lesson.blocks;
  const hasParagraph = blocks.some((b) => b.type === 'paragraph');
  const mediaCount = blocks.filter((b) => MEDIA_TYPES.has(b.type)).length;
  if (!hasParagraph || mediaCount === 0) return 'single-column-flow';

  const mediaIds = new Set(
    blocks.filter((b) => MEDIA_TYPES.has(b.type)).map((b) => b.id),
  );
  const anchorsMedia = blocks.some(
    (b) =>
      b.type === 'exercise' &&
      (b.anchors ?? []).some((a) => mediaIds.has(a.blockId)),
  );

  // Two or more media blocks interleaved with paragraphs, referenced by an exercise
  // anchor → the graphic-text integration case. A lone decorative figure stays flow.
  return anchorsMedia && mediaCount >= 2 ? 'paired' : 'single-column-flow';
}

// ── paired-row grouping ─────────────────────────────────────────────────────────

/** A row in a 'paired' layout: a text (paragraph) block + its paired media blocks. */
export interface PairedRow {
  kind: 'paired';
  text: Block; // a paragraph block
  media: Block[]; // figure/table blocks paired to it (may be empty)
}

/** A full-width item in a 'paired' layout (exercises, unpaired blocks, leftovers). */
export interface FullWidthItem {
  kind: 'full';
  block: Block;
}

export type LayoutItem = PairedRow | FullWidthItem;

/**
 * groupPairedBlocks — pre-pass that builds the render item list for a 'paired' lesson.
 *
 * Pairing rules (anchors first, adjacency second), each media block used AT MOST ONCE:
 *   1. For each paragraph, pull in media blocks that an exercise anchors to THIS
 *      paragraph AND whose block sits adjacent — no, simpler + robust: pull in media
 *      blocks that immediately FOLLOW this paragraph in block order (adjacency), which
 *      matches how the corpus is authored (p1 → fig-1, p2 → table-1, p3 → table-2).
 *   2. A media block already consumed by an earlier paragraph is not repeated
 *      (mirrors PairedReading #2194 "show each figure once").
 *   3. Exercises and any leftover blocks render full-width, in original order.
 *
 * Everything is derived in one pass with no external mutation so the caller can wrap
 * it in useMemo safely.
 */
export function groupPairedBlocks(blocks: Block[]): LayoutItem[] {
  const items: LayoutItem[] = [];
  const consumed = new Set<string>();

  blocks.forEach((block, idx) => {
    if (consumed.has(block.id)) return;

    if (block.type === 'paragraph') {
      // Collect consecutive media blocks immediately following this paragraph.
      const media: Block[] = [];
      let j = idx + 1;
      while (j < blocks.length && MEDIA_TYPES.has(blocks[j].type)) {
        if (!consumed.has(blocks[j].id)) {
          media.push(blocks[j]);
          consumed.add(blocks[j].id);
        }
        j += 1;
      }
      items.push({ kind: 'paired', text: block, media });
      consumed.add(block.id);
      return;
    }

    // Non-paragraph, non-consumed block (exercise, leading figure, parallel_passage…).
    items.push({ kind: 'full', block });
    consumed.add(block.id);
  });

  return items;
}
