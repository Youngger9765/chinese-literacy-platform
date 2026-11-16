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
});
