/**
 * phaseConfig.ts — maps ACTIVE_STEPS into 3 learning phases.
 *
 * Phases auto-distribute steps from ACTIVE_STEPS so the grouping adapts
 * when steps are added, removed, or reordered in stepConfig.ts.
 *
 * To override which steps belong to which phase, edit PHASE_TEMPLATES
 * and supply explicit stepIds arrays. When stepIds is empty the phase
 * receives its share of ACTIVE_STEPS via round-robin distribution.
 */

import { ACTIVE_STEPS, type StepConfig } from './stepConfig';

export interface PhaseDefinition {
  /** Unique phase key */
  id: string;
  /** Display label (includes emoji) */
  label: string;
  /** Short description shown under the label */
  description: string;
  /** Explicit step IDs — leave empty for auto-distribution */
  stepIds: string[];
}

/**
 * Phase definitions. stepIds are populated at runtime by distributeSteps()
 * when left empty. To pin specific steps to a phase, fill stepIds manually.
 */
const PHASE_TEMPLATES: readonly PhaseDefinition[] = [
  { id: 'explore', label: '📖 認識課文', description: '讀懂這篇文章', stepIds: [] },
  { id: 'practice', label: '✏️ 字詞練功', description: '掌握生字詞彙', stepIds: [] },
  { id: 'challenge', label: '🎯 挑戰闖關', description: '證明你會了', stepIds: [] },
] as const;

/** Distribute ACTIVE_STEPS roughly equally into 3 phase buckets. */
function distributeSteps(
  templates: readonly PhaseDefinition[],
  steps: readonly StepConfig[],
): PhaseDefinition[] {
  const claimed = new Set(templates.flatMap((t) => t.stepIds));
  const unclaimed = steps.filter((s) => !claimed.has(s.id));

  const phaseCount = templates.length;
  const baseSize = Math.floor(unclaimed.length / phaseCount);
  const remainder = unclaimed.length % phaseCount;

  let cursor = 0;
  return templates.map((template, phaseIdx) => {
    if (template.stepIds.length > 0) {
      return { ...template };
    }
    // Earlier phases get the extra steps when remainder > 0
    const size = baseSize + (phaseIdx < remainder ? 1 : 0);
    const assigned = unclaimed.slice(cursor, cursor + size).map((s) => s.id);
    cursor += size;
    return { ...template, stepIds: assigned };
  });
}

/** Resolved phases with step IDs populated from ACTIVE_STEPS. */
export const LEARNING_PHASES: PhaseDefinition[] = distributeSteps(PHASE_TEMPLATES, ACTIVE_STEPS);

/** Quick lookup: stepId -> phaseId */
export const STEP_TO_PHASE: Record<string, string> = Object.fromEntries(
  LEARNING_PHASES.flatMap((phase) =>
    phase.stepIds.map((stepId) => [stepId, phase.id]),
  ),
);
