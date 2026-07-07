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
 * Pairing is ANCHORS FIRST, ADJACENCY SECOND, each media block used AT MOST ONCE:
 *   1. Anchors: when an exercise anchors EXACTLY ONE paragraph together with media
 *      block(s), that is an unambiguous EXPLICIT 段-媒體 pairing (the author said "this
 *      one paragraph goes with this figure/table"), so those media attach to that
 *      paragraph's row wherever they sit in block order. A cross-passage exercise that
 *      anchors MANY paragraphs (e.g. an integration 練習 spanning p1..p3) carries no
 *      per-paragraph signal and is intentionally skipped here — it falls through to
 *      rule 2 so the natural interleave order is preserved. Built once, up front.
 *   2. Adjacency (fallback): any still-unpaired media block is attached to the
 *      paragraph it immediately FOLLOWS in block order — matching how the corpus is
 *      authored (p1 → fig-1, p2 → table-1, p3 → table-2), which is exactly the shape
 *      the adapter now emits (interleaved).
 *   3. A media block consumed by rule 1 or 2 is never repeated (mirrors PairedReading
 *      #2194 "show each figure once"). Exercises and any leftover blocks render
 *      full-width, in original order.
 *
 * Everything is derived in one pass (plus one cheap up-front anchor scan) with no
 * external mutation so the caller can wrap it in useMemo safely.
 */
export function groupPairedBlocks(blocks: Block[]): LayoutItem[] {
  const paragraphIds = new Set(
    blocks.filter((b) => b.type === 'paragraph').map((b) => b.id),
  );
  const mediaById = new Map(
    blocks.filter((b) => MEDIA_TYPES.has(b.type)).map((b) => [b.id, b]),
  );

  // ── Rule 1: explicit anchor pairings — only from exercises that anchor a SINGLE
  // paragraph + media (unambiguous local pairing). Multi-paragraph anchor lists carry no
  // per-paragraph signal and are skipped (→ rule 2). First exercise to claim a media wins.
  const anchoredMedia = new Map<string, string[]>();
  const mediaClaimedByAnchor = new Set<string>();
  for (const block of blocks) {
    if (block.type !== 'exercise') continue;
    const anchors = block.anchors ?? [];
    const paras = [...new Set(anchors.map((a) => a.blockId).filter((id) => paragraphIds.has(id)))];
    const media = anchors.map((a) => a.blockId).filter((id) => mediaById.has(id));
    if (paras.length !== 1 || media.length === 0) continue;
    const owner = paras[0];
    const list = anchoredMedia.get(owner) ?? [];
    for (const m of media) {
      if (mediaClaimedByAnchor.has(m)) continue;
      mediaClaimedByAnchor.add(m);
      list.push(m);
    }
    if (list.length > 0) anchoredMedia.set(owner, list);
  }

  const items: LayoutItem[] = [];
  const consumed = new Set<string>();

  blocks.forEach((block, idx) => {
    if (consumed.has(block.id)) return;

    if (block.type === 'paragraph') {
      const media: Block[] = [];
      const take = (b: Block | undefined) => {
        if (b && !consumed.has(b.id)) {
          media.push(b);
          consumed.add(b.id);
        }
      };
      // Rule 1: media explicitly anchored to this paragraph, in anchor order.
      for (const mid of anchoredMedia.get(block.id) ?? []) take(mediaById.get(mid));
      // Rule 2: media that adjacently follow this paragraph and weren't anchor-claimed
      // elsewhere (an anchor pairing for this same paragraph already took them above).
      let j = idx + 1;
      while (j < blocks.length && MEDIA_TYPES.has(blocks[j].type)) {
        if (!mediaClaimedByAnchor.has(blocks[j].id)) take(blocks[j]);
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
