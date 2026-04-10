/**
 * phaseConfig.ts -- maps ACTIVE_STEPS into 3 learning phases.
 *
 * Phases auto-distribute steps from ACTIVE_STEPS so the grouping adapts
 * when steps are added, removed, or reordered in stepConfig.ts.
 *
 * Phase colors use per-phase gradient themes (emerald, blue, orange)
 * instead of a single accent color.
 */

import { ACTIVE_STEPS, type StepConfig } from './stepConfig';

export interface PhaseColors {
  /** Gradient CSS for expanded header bar */
  gradient: string;
  /** Left stripe color (4px) */
  stripe: string;
  /** Accent text color */
  text: string;
  /** Light background tint */
  bg: string;
  /** Progress bar fill */
  bar: string;
  /** Badge background */
  badge: string;
  /** Ring / border accent */
  ring: string;
}

export interface PhaseDefinition {
  /** Unique phase key */
  id: string;
  /** Display label (includes emoji) */
  label: string;
  /** Icon emoji for the phase */
  icon: string;
  /** Short description shown under the label */
  description: string;
  /** Per-phase color theme */
  colors: PhaseColors;
  /** Explicit step IDs -- leave empty for auto-distribution */
  stepIds: string[];
}

/**
 * Phase definitions. stepIds are populated at runtime by distributeSteps()
 * when left empty. To pin specific steps to a phase, fill stepIds manually.
 */
const PHASE_TEMPLATES: readonly PhaseDefinition[] = [
  {
    id: 'explore',
    label: '認識課文',
    icon: '\u{1F4D6}',
    description: '讀懂這篇文章',
    colors: {
      gradient: 'bg-gradient-to-r from-emerald-500 to-emerald-600',
      stripe: 'bg-emerald-500',
      text: 'text-emerald-700',
      bg: 'bg-emerald-50',
      bar: 'bg-emerald-500',
      badge: 'bg-emerald-100 text-emerald-700',
      ring: 'ring-emerald-200',
    },
    stepIds: [],
  },
  {
    id: 'practice',
    label: '字詞練功',
    icon: '\u{270F}\u{FE0F}',
    description: '掌握生字詞彙',
    colors: {
      gradient: 'bg-gradient-to-r from-blue-500 to-indigo-500',
      stripe: 'bg-blue-500',
      text: 'text-blue-700',
      bg: 'bg-blue-50',
      bar: 'bg-blue-500',
      badge: 'bg-blue-100 text-blue-700',
      ring: 'ring-blue-200',
    },
    stepIds: [],
  },
  {
    id: 'challenge',
    label: '挑戰闖關',
    icon: '\u{1F3AF}',
    description: '證明你會了',
    colors: {
      gradient: 'bg-gradient-to-r from-orange-500 to-red-500',
      stripe: 'bg-orange-500',
      text: 'text-orange-700',
      bg: 'bg-orange-50',
      bar: 'bg-orange-500',
      badge: 'bg-orange-100 text-orange-700',
      ring: 'ring-orange-200',
    },
    stepIds: [],
  },
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
