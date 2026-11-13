import { describe, expect, it } from 'vitest';
import { mergeLoadedStepProgress } from './useStepProgressPersistence';

// Issue #3694, staging recheck: a save that lost a race got 409, the page
// reloaded an older snapshot, and replacing local state with it erased
// keypoints-table#vhkqd that the student had just finished.
describe('mergeLoadedStepProgress', () => {
  const local = {
    current_step: 'spotlight#yqcxe',
    steps_completed: ['full-text-annotate#qeqwt', 'keypoints-table#vhkqd'],
    step_data: { 'keypoints-table#vhkqd': { completed: true } },
  };
  const olderServer = {
    current_step: 'keypoints-table#vhkqd',
    steps_completed: ['full-text-annotate#qeqwt'],
    step_data: { 'full-text-annotate#qeqwt': { completed: true } },
  };

  it('keeps a step the page already completed when the reload predates it', () => {
    const merged = mergeLoadedStepProgress(local, olderServer);
    expect(merged.steps_completed).toEqual(['full-text-annotate#qeqwt', 'keypoints-table#vhkqd']);
    expect(merged.step_data).toEqual({
      'full-text-annotate#qeqwt': { completed: true },
      'keypoints-table#vhkqd': { completed: true },
    });
  });

  it('on the first load (empty page) takes the server progress as is', () => {
    const empty = { current_step: null, steps_completed: [], step_data: {} };
    expect(mergeLoadedStepProgress(empty, olderServer)).toEqual(olderServer);
  });

  // #4028 — "completed in this session" follows the same only-grows rule.
  it('keeps this-session completions from both sides (#4028)', () => {
    const merged = mergeLoadedStepProgress(
      { current_step: null, steps_completed: ['a', 'b'], session_steps_completed: ['b'], step_data: {} },
      { current_step: null, steps_completed: ['a', 'c'], session_steps_completed: ['c'], step_data: {} },
    );
    expect(merged.session_steps_completed?.sort()).toEqual(['b', 'c']);
  });

  it('does not invent the list for a session that never had it (#4028)', () => {
    const merged = mergeLoadedStepProgress(
      { current_step: null, steps_completed: [], step_data: {} },
      { current_step: null, steps_completed: ['a'], step_data: {} },
    );
    expect(merged).not.toHaveProperty('session_steps_completed');
  });
});
