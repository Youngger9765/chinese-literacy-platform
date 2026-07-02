/**
 * camelize.test.ts — runtime-safe snake→camel transform used to bridge the backend
 * lesson_content (pydantic snake_case) to the zod LessonSchema (camelCase).
 *
 * The transform is load-bearing for the DARK lesson_content wiring: if it drifts, a
 * perfectly valid backend payload fails safeParse and the page silently falls back to
 * the storyToLesson stopgap. These assertions freeze the exact key-rename behaviour.
 */
import { describe, it, expect } from 'vitest';

import { toCamel, camelizeKeys } from '../camelize';

describe('toCamel (single key segment)', () => {
  it('renames snake_case to camelCase', () => {
    expect(toCamel('lesson_code')).toBe('lessonCode');
    expect(toCamel('answer_space')).toBe('answerSpace');
    expect(toCamel('needs_review')).toBe('needsReview');
    expect(toCamel('block_id')).toBe('blockId');
    expect(toCamel('reference_answer')).toBe('referenceAnswer');
    expect(toCamel('section_label_col')).toBe('sectionLabelCol');
  });

  it('leaves already-camel / single-word keys untouched', () => {
    expect(toCamel('id')).toBe('id');
    expect(toCamel('blocks')).toBe('blocks');
    expect(toCamel('title')).toBe('title');
  });

  it('fires on any _<lowercase-letter>, including after a digit or at the start', () => {
    // Documents the FROZEN behaviour of the shared helper (regex /_([a-z])/g): the
    // underscore+lowercase run is consumed wherever it appears. Real lesson_content keys
    // never start with `_`, so this edge is only a behaviour lock, not a wire concern.
    expect(toCamel('r1_b2')).toBe('r1B2');
    expect(toCamel('_schema')).toBe('Schema');
    // No _<lowercase> run → untouched.
    expect(toCamel('r1b2')).toBe('r1b2');
  });
});

describe('camelizeKeys (recursive)', () => {
  it('camelizes nested object keys, recursing through arrays', () => {
    const snake = {
      lesson_code: 'G6-L22',
      blocks: [
        {
          block_id: 'p1',
          answer_space: 'free_text',
          needs_review: true,
          anchors: [{ block_id: 'p1' }],
        },
      ],
    };
    expect(camelizeKeys(snake)).toEqual({
      lessonCode: 'G6-L22',
      blocks: [
        {
          blockId: 'p1',
          answerSpace: 'free_text',
          needsReview: true,
          anchors: [{ blockId: 'p1' }],
        },
      ],
    });
  });

  it('passes scalars/null/arrays-of-scalars through unchanged', () => {
    expect(camelizeKeys('x')).toBe('x');
    expect(camelizeKeys(42)).toBe(42);
    expect(camelizeKeys(null)).toBe(null);
    expect(camelizeKeys([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('does NOT rewrite string VALUES, only keys', () => {
    // answer_space enum values are snake and must survive verbatim for zod.
    const out = camelizeKeys({ answer_space: 'multi_choice', grader: 'rubric_ai' }) as Record<
      string,
      unknown
    >;
    expect(out.answerSpace).toBe('multi_choice');
    expect(out.grader).toBe('rubric_ai');
  });
});
