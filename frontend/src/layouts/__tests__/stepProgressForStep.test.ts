/**
 * #4028 — 步驟頁讀得回自己這一輪的進度。
 *
 * #2930 讓寫入帶輪次（`vocab-definition#c9fyn`），步驟頁卻還在讀
 * `step_data['vocab-definition']`：離開一步再回來，詞語理解從第 1/11 題重新開始，
 * DB 裡明明存著 22/22 的完成紀錄（本機實測 session 28 → 29）。
 */
import { describe, expect, it } from 'vitest';
import { stepProgressForStep } from '../stepProgressForStep';

const SINGLE = ['lesson-intro', 'vocab-definition#c9fyn', 'comprehension#rjr3f', 'report'];
const MULTI = ['lesson-intro', 'keypoints-table#6pyvc', 'keypoints-table#6xvh6', 'report'];
const done = { phase: 'summary', completed: true };

const progress = (step_data: Record<string, unknown>) => ({ current_step: null, steps_completed: [], step_data });

describe('stepProgressForStep', () => {
  it('a step page reading its base id gets this round\'s saved data', () => {
    const out = stepProgressForStep(progress({ 'vocab-definition#c9fyn': done }), 'vocab-definition#c9fyn', SINGLE);
    expect(out.step_data['vocab-definition']).toEqual(done);
    // 原本的 key 也還在（KeyPassageReadingPage 直接讀帶輪次的 key）
    expect(out.step_data['vocab-definition#c9fyn']).toEqual(done);
  });

  it('this round wins over an older bare-key copy', () => {
    const out = stepProgressForStep(
      progress({ 'vocab-definition': { phase: 'old' }, 'vocab-definition#c9fyn': done }),
      'vocab-definition#c9fyn',
      SINGLE,
    );
    expect(out.step_data['vocab-definition']).toEqual(done);
  });

  it('a step that appears once still accepts old bare-key data (pre-#2930 sessions, OMO sync)', () => {
    const out = stepProgressForStep(progress({ 'vocab-definition': done }), 'vocab-definition#c9fyn', SINGLE);
    expect(out.step_data['vocab-definition']).toEqual(done);
  });

  it('in a multi-text lesson, round 2 never reads round 1\'s data', () => {
    const out = stepProgressForStep(
      progress({ 'keypoints-table#6pyvc': done }),
      'keypoints-table#6xvh6',
      MULTI,
    );
    expect(out.step_data['keypoints-table']).toBeUndefined();
  });

  it('in a multi-text lesson, a bare key is not borrowed either', () => {
    const out = stepProgressForStep(progress({ 'keypoints-table': done }), 'keypoints-table#6xvh6', MULTI);
    expect(out.step_data['keypoints-table']).toBeUndefined();
  });

  it('a step id without a round is returned untouched (same object)', () => {
    const p = progress({ comprehension: done });
    expect(stepProgressForStep(p, 'comprehension', SINGLE)).toBe(p);
  });

  it('does not mutate the stored state', () => {
    const p = progress({ 'vocab-definition#c9fyn': done });
    stepProgressForStep(p, 'vocab-definition#c9fyn', SINGLE);
    expect(p.step_data).not.toHaveProperty('vocab-definition');
  });
});
