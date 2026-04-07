const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';

/**
 * Build a storage scope for learning-step cache keys.
 *
 * - Self-practice: scope = storyId
 * - Assignment:    scope = storyId + assignmentId (isolated per assignment)
 */
export function getLearningStorageScope(storyId: string | number): string {
  const storyKey = String(storyId);

  try {
    const assignmentId = sessionStorage.getItem('activeAssignmentId');
    if (!assignmentId) return storyKey;

    const contextRaw = sessionStorage.getItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY);
    if (contextRaw) {
      const context = JSON.parse(contextRaw) as { storyKey?: string | null };
      if (String(context.storyKey ?? '') !== storyKey) {
        return storyKey;
      }
    }

    return `${storyKey}__a_${assignmentId}`;
  } catch {
    return storyKey;
  }
}

export function scopedStepStorageKey(prefix: string, storyId: string | number): string {
  return `${prefix}${getLearningStorageScope(storyId)}`;
}
