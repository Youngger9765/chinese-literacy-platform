import { describe, expect, it } from 'vitest';
import { initialDraft, invalidScores, parseScore, previewOf, summaryOf, toInput } from '../reviewDraft';
import type { ReviewDetail } from '../../../../services/lessonReviewApi';

const detail = (over: Partial<ReviewDetail> = {}): ReviewDetail => ({
  student_id: 1,
  student_name: '小明',
  story_slug: '6',
  story_title: '課',
  session_id: 1,
  step_progress: null,
  review: {
    sent_at: '2026-11-18T01:00:00Z',
    total_score: 80,
    teacher_name: '李老師',
    steps: {
      'comprehension#a': { returned: true, redone: false, comment: '再想想', score: 60 },
      'spotlight#b': { returned: false, redone: true, comment: null, score: null },
    },
  },
  draft: null,
  ...over,
});

describe('reviewDraft (#4104)', () => {
  it('starts from the sent review; a redone return is no longer ticked', () => {
    const d = initialDraft(detail());
    expect(d.total).toBe('80');
    expect(d.steps['comprehension#a']).toEqual({ returned: true, comment: '再想想', score: '60' });
    expect(d.steps['spotlight#b'].returned).toBe(false);
  });

  it('an unsent draft wins over the sent review', () => {
    const d = initialDraft(
      detail({ draft: { total_score: null, steps: [{ step_key: 'x#1', returned: false, comment: 'hi', score: 90 }] } }),
    );
    expect(d).toEqual({ total: '', steps: { 'x#1': { returned: false, comment: 'hi', score: '90' } } });
  });

  it('scores must be integers 0–100; blank means no score', () => {
    expect(parseScore('')).toBeNull();
    expect(parseScore('100')).toBe(100);
    expect(parseScore('101')).toBeUndefined();
    expect(parseScore('8.5')).toBeUndefined();
    expect(invalidScores({ total: '120', steps: { a: { returned: false, comment: '', score: '-1' } } })).toEqual([
      'a',
      '__total',
    ]);
  });

  it('drops empty steps, trims comments, and builds the student preview + summary', () => {
    const d = {
      total: '88',
      steps: {
        a: { returned: true, comment: '  重做  ', score: '' },
        b: { returned: false, comment: '', score: '90' },
        c: { returned: false, comment: '   ', score: '' },
      },
    };
    expect(toInput(d)).toEqual({
      total_score: 88,
      steps: [
        { step_key: 'a', returned: true, comment: '重做', score: null },
        { step_key: 'b', returned: false, comment: null, score: 90 },
      ],
    });
    expect(previewOf(d, '李老師').steps.a).toEqual({ returned: true, comment: '重做', score: null });
    expect(summaryOf(d, 8)).toMatchObject({ returned: 1, comments: 1, scored: 1, stepCount: 8, average: 90, total: 88 });
  });
});
