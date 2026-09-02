/**
 * editorPreMarks.test.ts — 編者標 (#3026) pure-function tests.
 *
 * TDD: written before editorPreMarks.ts exists, so the first run is red
 * (module not found) — see PR body for the red→green evidence.
 *
 * Decisions locked by the PRD (docs/prd/2026-09-hans-feedback-gamification-annotation.md
 * §4) that these tests encode, not re-litigate:
 *   - a term matching 2+ times gets marked at EVERY occurrence
 *   - a term with no verbatim match anywhere is silently skipped
 *   - no vocabulary data at all → no pre-marks, lesson renders as today
 */
import { describe, it, expect } from 'vitest';
import { computeEditorPreMarks, mergeWithStudentAnnotations } from './editorPreMarks';
import type { Annotation } from './annotationReducer';

describe('computeEditorPreMarks', () => {
  it('marks a term that appears exactly once', () => {
    const paragraphs = ['珍古德在森林裡研究黑猩猩。'];
    const marks = computeEditorPreMarks(paragraphs, [{ word: '黑猩猩' }]);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ paragraphIndex: 0, charStart: 9, charEnd: 12, type: 'important', source: 'editor' });
  });

  it('marks EVERY occurrence when a term appears 2+ times (PRD decision, not "first only")', () => {
    const paragraphs = ['孟嘗君是貴族。孟嘗君很有錢。第三次提到孟嘗君時大家都認得他。'];
    const marks = computeEditorPreMarks(paragraphs, [{ word: '孟嘗君' }]);
    expect(marks).toHaveLength(3);
    // all three occurrences actually slice back to the term
    for (const m of marks) {
      expect(paragraphs[0].slice(m.charStart, m.charEnd)).toBe('孟嘗君');
    }
  });

  it('marks occurrences across multiple paragraphs, each with the correct paragraphIndex', () => {
    const paragraphs = ['第一段沒有語詞。', '第二段有震撼彈這個詞。', '第三段也有震撼彈。'];
    const marks = computeEditorPreMarks(paragraphs, [{ word: '震撼彈' }]);
    expect(marks.map((m) => m.paragraphIndex)).toEqual([1, 2]);
  });

  it('silently skips a term with no verbatim match anywhere (~1% of terms per PRD)', () => {
    const paragraphs = ['這段文字完全沒有提到那個詞。'];
    const marks = computeEditorPreMarks(paragraphs, [{ word: '千里迢迢' }]);
    expect(marks).toEqual([]);
  });

  it('returns [] when vocabulary is null/undefined/empty — lesson renders exactly as today', () => {
    const paragraphs = ['隨便一段課文。'];
    expect(computeEditorPreMarks(paragraphs, null)).toEqual([]);
    expect(computeEditorPreMarks(paragraphs, undefined)).toEqual([]);
    expect(computeEditorPreMarks(paragraphs, [])).toEqual([]);
  });

  it('returns [] when there are no paragraphs', () => {
    expect(computeEditorPreMarks([], [{ word: '詞' }])).toEqual([]);
  });

  it('strips embedded PUA variation-selector surrogate pairs before matching, so offsets land on the raw characters', () => {
    // U+DB40 U+DD00 is a real BpmfIansui tone-variant selector some lesson
    // YAML embeds directly in the source text (see annotationOffsets.ts).
    const withPua = `著${String.fromCharCode(0xdb40, 0xdd00)}頭緒`;
    const paragraphs = [withPua];
    const marks = computeEditorPreMarks(paragraphs, [{ word: '頭緒' }]);
    expect(marks).toHaveLength(1);
    // stripPUASelectors(withPua) === '著頭緒' — '頭緒' starts at raw index 1
    expect(marks[0]).toMatchObject({ charStart: 1, charEnd: 3 });
  });

  it('does not double-mark overlapping candidates from two different terms', () => {
    // Contrived: one vocab term is a substring of another. Only the
    // non-overlapping, deterministic result should come out — never both
    // (that would corrupt AnnotatedParagraph's segment builder, which
    // assumes non-overlapping ranges).
    const paragraphs = ['命運共同體是這一課的重點詞。'];
    const marks = computeEditorPreMarks(paragraphs, [{ word: '命運共同體' }, { word: '命運' }]);
    // Whichever wins, ranges must never overlap.
    for (let i = 0; i < marks.length; i++) {
      for (let j = i + 1; j < marks.length; j++) {
        if (marks[i].paragraphIndex !== marks[j].paragraphIndex) continue;
        const overlap = marks[i].charStart < marks[j].charEnd && marks[j].charStart < marks[i].charEnd;
        expect(overlap).toBe(false);
      }
    }
  });

  it('ignores blank/whitespace-only vocabulary entries', () => {
    const paragraphs = ['一段普通的課文。'];
    expect(computeEditorPreMarks(paragraphs, [{ word: '' }, { word: '   ' }])).toEqual([]);
  });

  it('gives every mark a stable, deterministic id across repeated calls', () => {
    const paragraphs = ['震撼彈出現在這裡。'];
    const a = computeEditorPreMarks(paragraphs, [{ word: '震撼彈' }]);
    const b = computeEditorPreMarks(paragraphs, [{ word: '震撼彈' }]);
    expect(a[0].id).toBe(b[0].id);
  });
});

describe('mergeWithStudentAnnotations', () => {
  const student: Annotation = { id: 's1', paragraphIndex: 0, charStart: 2, charEnd: 5, type: 'unknown' };

  it('returns student annotations unchanged when there are no pre-marks', () => {
    expect(mergeWithStudentAnnotations([student], [])).toEqual([student]);
  });

  it('includes a non-overlapping pre-mark alongside the student annotation', () => {
    const preMark: Annotation = { id: 'editor-0-10-13', paragraphIndex: 0, charStart: 10, charEnd: 13, type: 'important', source: 'editor' };
    const merged = mergeWithStudentAnnotations([student], [preMark]);
    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual(student);
    expect(merged).toContainEqual(preMark);
  });

  it('drops a pre-mark that overlaps a student annotation in the same paragraph — the live action wins', () => {
    const overlapping: Annotation = { id: 'editor-0-3-6', paragraphIndex: 0, charStart: 3, charEnd: 6, type: 'important', source: 'editor' };
    const merged = mergeWithStudentAnnotations([student], [overlapping]);
    expect(merged).toEqual([student]);
  });

  it('does not drop a pre-mark that overlaps a student annotation in a DIFFERENT paragraph', () => {
    const otherParagraph: Annotation = { id: 'editor-1-3-6', paragraphIndex: 1, charStart: 3, charEnd: 6, type: 'important', source: 'editor' };
    const merged = mergeWithStudentAnnotations([student], [otherParagraph]);
    expect(merged).toContainEqual(otherParagraph);
  });
});
