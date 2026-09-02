/**
 * editorPreMarks.ts — 編者標 (#3026): editor-supplied pre-marks for
 * 讀全文-做記號, one of four teaching-context sources a teacher can pick
 * (不先標 / 老師標 / 編者標 / 學生自己標 — see the issue's field feedback,
 * quoted in full in the PRD). 不先標 and 學生自己標 are the SAME existing
 * behaviour (a blank canvas the student marks themselves) and needed no new
 * code. 老師標 is a full new data model + teacher UI, explicitly out of
 * scope here (PRD open question 3) — the `AnnotationSource` union in
 * annotationReducer.ts is written so it can be added later without another
 * reshape. This file is only 編者標.
 *
 * DATA SOURCE (locked in, not re-derived here — see PRD §4 "追加" section for
 * the full trail of a wrong number that got corrected twice before landing
 * on this one): `story.vocabulary` — `{word, definition}[]`, populated
 * server-side by `_vocabulary_from()` in
 * `backend/app/services/lesson_indexes.py` from
 * `backend/data/lessons/<uid>/v3/vocab_definitions.<slug>.yml`'s `items[]`.
 * 154/179 lessons have this data (measured 2026-09-02); the other 25 are
 * classical-text lessons with no vocab_definitions concept at all, and for
 * those `story.vocabulary` is null/undefined — this module then returns []
 * and FullTextAnnotate renders exactly as it does today: no error, no
 * empty-state message, nothing for the student to notice as different.
 *
 * This is deliberately a PURE, CLIENT-SIDE computation — no new backend
 * field, no migration, no new API surface. `story.vocabulary` already ships
 * to the frontend today (used by FullTextAnnotate's zhuyin-difficult-word
 * highlighting); the only genuinely new piece is resolving each vocab word
 * to a position in the article text, which is what `computeEditorPreMarks`
 * does.
 *
 * TWO DECISIONS FROM THE PRD, ENCODED HERE, NOT RE-LITIGATED:
 *   - A term matching 2+ times in the article (8.9% of terms, per the PRD's
 *     real-data measurement) is marked at EVERY occurrence, not just the
 *     first — a student learning 「孟嘗君」 benefits from seeing it marked
 *     everywhere it appears.
 *   - A term with no verbatim substring match anywhere (~1% of terms) is
 *     silently skipped — not an error, not shown to the student. (A content
 *     QA pass over `content_known_gaps.yaml`-style tracking is a separate,
 *     already-existing content-QA concern, not this UI feature's job.)
 *
 * COORDINATE SYSTEM: offsets are computed against `stripPUASelectors(text)`
 * for each paragraph — the exact same raw-character coordinate space
 * AnnotatedParagraph.tsx already slices STUDENT annotations against (see
 * annotationOffsets.ts). Lesson YAML source text can embed BpmfIansui PUA
 * variation-selector surrogate pairs directly in the text regardless of
 * whether zhuyin is currently on (e.g. 「著󠇣頭緒」) — stripping before
 * matching means a mark computed here lands in the SAME coordinate space
 * AnnotatedParagraph already knows how to render, including inside 'difficult'
 * zhuyin mode (that path re-derives its own per-run font flags via
 * `difficultFlagsByRawIndex` against the very same stripped-text length, so
 * an Annotation object with correct raw offsets "just works" there with zero
 * new PUA-handling code needed in this file).
 */
import { Annotation } from './annotationReducer';
import { stripPUASelectors } from './annotationOffsets';

export interface VocabTerm {
  word?: string | null;
}

interface RawMatch {
  paragraphIndex: number;
  charStart: number;
  charEnd: number;
}

/** Deterministic id: same input always produces the same id, so a student's
 *  per-session dismissal (tracked by id, see FullTextAnnotate.tsx) survives
 *  re-renders and re-computation of the same pre-mark set. */
function editorMarkId(paragraphIndex: number, charStart: number, charEnd: number): string {
  return `editor-${paragraphIndex}-${charStart}-${charEnd}`;
}

/** All non-overlapping occurrences of `term` in `text`, left to right. */
function findAllOccurrences(text: string, term: string): Array<[number, number]> {
  if (!term) return [];
  const out: Array<[number, number]> = [];
  let from = 0;
  while (from <= text.length) {
    const idx = text.indexOf(term, from);
    if (idx === -1) break;
    out.push([idx, idx + term.length]);
    from = idx + term.length; // advance past this match — a term never self-overlaps
  }
  return out;
}

/**
 * Compute every 編者標 pre-mark for one article.
 *
 * @param paragraphs `story.content` — one raw paragraph string per entry,
 *   possibly carrying embedded PUA selectors (see module doc above).
 * @param vocabulary `story.vocabulary` — null/undefined/empty all mean "no
 *   pre-marks for this lesson", which is a real, expected, non-error state
 *   for 25/179 lessons.
 */
export function computeEditorPreMarks(
  paragraphs: string[],
  vocabulary: VocabTerm[] | null | undefined,
): Annotation[] {
  const terms = (vocabulary ?? [])
    .map((v) => v.word)
    .filter((w): w is string => Boolean(w && w.trim().length > 0));
  if (terms.length === 0 || paragraphs.length === 0) return [];

  const strippedParagraphs = paragraphs.map((p) => stripPUASelectors(p ?? ''));

  const candidates: RawMatch[] = [];
  for (let paragraphIndex = 0; paragraphIndex < strippedParagraphs.length; paragraphIndex++) {
    const text = strippedParagraphs[paragraphIndex];
    for (const term of terms) {
      for (const [charStart, charEnd] of findAllOccurrences(text, term)) {
        candidates.push({ paragraphIndex, charStart, charEnd });
      }
    }
  }

  // Two different vocab terms could (in principle) produce overlapping
  // candidate ranges in the same paragraph (e.g. one term is a substring of
  // another). AnnotatedParagraph's segment builder assumes non-overlapping,
  // charStart-sorted annotations within a paragraph — feeding it an overlap
  // would duplicate rendered characters. Resolve deterministically: sort by
  // paragraph, then start ascending, then length descending (prefer the
  // longer/more-specific term when two candidates start at the same
  // position), then greedily keep only non-overlapping matches.
  candidates.sort((a, b) => {
    if (a.paragraphIndex !== b.paragraphIndex) return a.paragraphIndex - b.paragraphIndex;
    if (a.charStart !== b.charStart) return a.charStart - b.charStart;
    return (b.charEnd - b.charStart) - (a.charEnd - a.charStart);
  });

  const accepted: RawMatch[] = [];
  let currentParagraph = -1;
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.paragraphIndex !== currentParagraph) {
      currentParagraph = candidate.paragraphIndex;
      cursor = 0;
    }
    if (candidate.charStart < cursor) continue; // overlaps an already-accepted match
    accepted.push(candidate);
    cursor = candidate.charEnd;
  }

  return accepted.map((m) => ({
    id: editorMarkId(m.paragraphIndex, m.charStart, m.charEnd),
    paragraphIndex: m.paragraphIndex,
    charStart: m.charStart,
    charEnd: m.charEnd,
    type: 'important',
    source: 'editor',
  }));
}

/**
 * Combine a student's own annotations with the (already-filtered-for-
 * dismissal) editor pre-marks, for RENDERING only.
 *
 * The student's live annotations always win: a pre-mark that overlaps one in
 * the same paragraph is dropped from the combined list rather than rendered
 * alongside it, because AnnotatedParagraph's segment builder assumes
 * non-overlapping ranges within a paragraph (see computeEditorPreMarks doc
 * above) and because a student who has already marked that exact span made
 * a more specific, more recent decision than the pre-mark did.
 *
 * This function's OUTPUT must never be fed back into the annotation
 * reducer, saved to localStorage, or saved to the DB — it exists only to
 * hand AnnotatedParagraph a single list to render. The reducer's own
 * `annotations` state (student-only) remains the source of truth for
 * summary counts, the side panel, undo, clear-all, and persistence.
 */
export function mergeWithStudentAnnotations(
  studentAnnotations: Annotation[],
  preMarks: Annotation[],
): Annotation[] {
  if (preMarks.length === 0) return studentAnnotations;

  const studentByParagraph = new Map<number, Annotation[]>();
  for (const a of studentAnnotations) {
    const list = studentByParagraph.get(a.paragraphIndex) ?? [];
    list.push(a);
    studentByParagraph.set(a.paragraphIndex, list);
  }

  const overlaps = (a: Annotation, b: Annotation) =>
    a.charStart < b.charEnd && b.charStart < a.charEnd;

  const survivingPreMarks = preMarks.filter((mark) => {
    const sameParagraph = studentByParagraph.get(mark.paragraphIndex) ?? [];
    return !sameParagraph.some((student) => overlaps(student, mark));
  });

  return [...studentAnnotations, ...survivingPreMarks];
}
