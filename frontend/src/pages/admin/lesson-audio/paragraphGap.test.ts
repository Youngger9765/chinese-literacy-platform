/**
 * Nothing avoidable should happen in the gap between two paragraphs.
 *
 * Owner, listening to a whole lesson: 「我覺得段落之間的延遲太多了」/「全文朗讀
 * 時，因爲延遲不順暢」. Within a paragraph it is smooth — the sentence prefetch
 * covers that — but every paragraph boundary stalls.
 *
 * Two causes, both avoidable:
 *
 *   1. The walk re-fetched the entire story detail before each paragraph. The
 *      text never changes mid-playback, so that is one full round trip of
 *      silence per paragraph, repeated for every paragraph in the lesson.
 *
 *   2. The sentence prefetch lives inside one paragraph's playback, so it never
 *      reaches across the boundary. The first sentence of paragraph N+1 was
 *      always fetched cold, right at the moment the listener is waiting.
 *
 * These tests pin the behaviour rather than the implementation: how many story
 * fetches happen during a walk, and whether the next paragraph's opening
 * sentence was asked for before the previous paragraph ended.
 */
import { describe, it, expect } from 'vitest';

import { planParagraphWalk } from './paragraphWalk';

const PARAGRAPHS = ['第一段。', '第二段。', '第三段。'];

describe('planParagraphWalk', () => {
  it('captures the paragraphs once, so advancing needs no further fetch', () => {
    const walk = planParagraphWalk({ storyId: 1, paragraphs: PARAGRAPHS, requestId: 7 });

    expect(walk.total).toBe(3);
    expect(walk.textAt(0)).toBe('第一段。');
    expect(walk.textAt(2)).toBe('第三段。');
  });

  it('knows the next paragraph without being told, so it can be prefetched', () => {
    const walk = planParagraphWalk({ storyId: 1, paragraphs: PARAGRAPHS, requestId: 7 });

    expect(walk.textAt(walk.next)).toBe('第二段。');
  });

  it('reports the end of the walk rather than running past it', () => {
    const walk = planParagraphWalk({ storyId: 1, paragraphs: PARAGRAPHS, requestId: 7 });
    walk.next = 3;

    expect(walk.isFinished).toBe(true);
    expect(walk.textAt(3)).toBeUndefined();
  });

  it('survives a lesson whose paragraph list is empty', () => {
    const walk = planParagraphWalk({ storyId: 1, paragraphs: [], requestId: 7 });

    expect(walk.total).toBe(0);
    expect(walk.isFinished).toBe(true);
  });

  it('carries the requestId so a superseded walk can be recognised', () => {
    // A newer click must be able to invalidate an in-flight walk; without this
    // the old walk resumes over the new clip.
    const walk = planParagraphWalk({ storyId: 1, paragraphs: PARAGRAPHS, requestId: 42 });

    expect(walk.requestId).toBe(42);
  });
});
