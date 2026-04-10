/**
 * LearningPhases — vertical accordion that groups learning steps into 3 phases.
 *
 * Each phase is a collapsible card showing:
 *   - Icon + label + description + progress count
 *   - Completed phases: green checkmark, collapsed
 *   - Current phase: expanded with step list
 *   - Future phases: lock icon, collapsed, dimmed
 *   - Phase completion triggers a CSS celebration animation
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { LEARNING_PHASES, STEP_TO_PHASE } from '../../config/phaseConfig';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LearningStep {
  id: string;
  label: string;
}

interface LearningPhasesProps {
  steps: LearningStep[];
  completedSteps: Set<string>;
  currentStepId: string;
  onStepClick: (id: string) => void;
}

type PhaseStatus = 'completed' | 'current' | 'future';

// ── Helpers ────────────────────────────────────────────────────────────────

function getPhaseStatus(
  phaseId: string,
  phaseStepIds: string[],
  completedSteps: Set<string>,
  currentStepId: string,
): PhaseStatus {
  const allDone = phaseStepIds.length > 0 && phaseStepIds.every((id) => completedSteps.has(id));
  if (allDone) return 'completed';

  const currentPhaseId = STEP_TO_PHASE[currentStepId];
  if (phaseId === currentPhaseId) return 'current';
  if (phaseStepIds.includes(currentStepId)) return 'current';

  return 'future';
}

function getCompletedCount(phaseStepIds: string[], completedSteps: Set<string>): number {
  return phaseStepIds.filter((id) => completedSteps.has(id)).length;
}

// ── Phase status styling ───────────────────────────────────────────────────

const PHASE_STYLES: Record<PhaseStatus, {
  card: string;
  header: string;
  icon: string;
  label: string;
  description: string;
  progress: string;
  indicator: string;
}> = {
  completed: {
    card: 'border-green-200 bg-green-50/60',
    header: 'cursor-pointer',
    icon: 'text-green-600',
    label: 'text-green-800',
    description: 'text-green-600/70',
    progress: 'text-green-600 font-semibold',
    indicator: 'bg-green-500',
  },
  current: {
    card: 'border-accent/30 bg-white shadow-card ring-1 ring-accent/10',
    header: 'cursor-pointer',
    icon: 'text-accent',
    label: 'text-gray-900',
    description: 'text-gray-500',
    progress: 'text-accent font-semibold',
    indicator: 'bg-accent',
  },
  future: {
    card: 'border-gray-200 bg-gray-50/60 opacity-60',
    header: 'cursor-default',
    icon: 'text-gray-400',
    label: 'text-gray-500',
    description: 'text-gray-400',
    progress: 'text-gray-400',
    indicator: 'bg-gray-300',
  },
};

// ── Step item inside expanded phase ────────────────────────────────────────

interface StepItemProps {
  step: LearningStep;
  isCompleted: boolean;
  isCurrent: boolean;
  isFuture: boolean;
  onClick: () => void;
}

const StepItem: React.FC<StepItemProps> = React.memo(
  ({ step, isCompleted, isCurrent, isFuture, onClick }) => {
    const canClick = isCompleted || isCurrent;
    return (
      <button
        type="button"
        onClick={canClick ? onClick : undefined}
        disabled={isFuture}
        className={[
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left',
          'transition-colors duration-150',
          isCompleted
            ? 'bg-green-50 hover:bg-green-100/80'
            : isCurrent
              ? 'bg-accent-bg ring-1 ring-accent/20'
              : 'bg-gray-50',
          canClick ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
        aria-current={isCurrent ? 'step' : undefined}
      >
        {/* Status indicator */}
        <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold">
          {isCompleted ? (
            <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
          ) : isCurrent ? (
            <span className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            </span>
          ) : (
            <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            </span>
          )}
        </span>

        {/* Step label */}
        <span
          className={[
            'text-sm leading-snug',
            isCompleted
              ? 'text-green-700'
              : isCurrent
                ? 'text-gray-900 font-medium'
                : 'text-gray-400',
          ].join(' ')}
        >
          {step.label}
        </span>
      </button>
    );
  },
);

StepItem.displayName = 'StepItem';

// ── Celebration animation (pure CSS confetti) ──────────────────────────────

const CelebrationBurst: React.FC<{ show: boolean }> = ({ show }) => {
  if (!show) return null;
  return (
    <span className="absolute -top-1 right-3 pointer-events-none" aria-hidden="true">
      <span className="absolute w-2 h-2 rounded-full bg-yellow-400 animate-confetti-drop-1" />
      <span className="absolute w-2 h-2 rounded-full bg-accent animate-confetti-drop-2" />
      <span className="absolute w-2 h-2 rounded-full bg-green-400 animate-confetti-drop-3" />
      <span className="absolute w-5 h-5 text-yellow-500 animate-star-burst">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l2.09 6.26L20.18 9l-5.09 3.74L16.18 19 12 15.27 7.82 19l1.09-6.26L3.82 9l6.09-.74z" />
        </svg>
      </span>
    </span>
  );
};

// ── Main component ─────────────────────────────────────────────────────────

const LearningPhases: React.FC<LearningPhasesProps> = ({
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
}) => {
  const stepMap = useMemo(
    () => new Map(steps.map((s) => [s.id, s])),
    [steps],
  );

  const [celebratingPhase, setCelebratingPhase] = useState<string | null>(null);
  const prevCompletedPhasesRef = useRef<Set<string>>(new Set());

  const currentPhaseId = STEP_TO_PHASE[currentStepId] ?? LEARNING_PHASES[0]?.id;
  const [expandedPhaseId, setExpandedPhaseId] = useState<string>(currentPhaseId);

  // Keep expanded phase in sync with current step
  useEffect(() => {
    const newPhaseId = STEP_TO_PHASE[currentStepId];
    if (newPhaseId) {
      setExpandedPhaseId(newPhaseId);
    }
  }, [currentStepId]);

  // Detect newly completed phases for celebration
  useEffect(() => {
    const nowCompleted = new Set<string>();
    for (const phase of LEARNING_PHASES) {
      if (phase.stepIds.length > 0 && phase.stepIds.every((id) => completedSteps.has(id))) {
        nowCompleted.add(phase.id);
      }
    }

    for (const phaseId of nowCompleted) {
      if (!prevCompletedPhasesRef.current.has(phaseId)) {
        setCelebratingPhase(phaseId);
        const timer = setTimeout(() => setCelebratingPhase(null), 1200);
        prevCompletedPhasesRef.current = nowCompleted;
        return () => clearTimeout(timer);
      }
    }

    prevCompletedPhasesRef.current = nowCompleted;
  }, [completedSteps]);

  const handleToggle = useCallback(
    (phaseId: string, status: PhaseStatus) => {
      if (status === 'future') return;
      setExpandedPhaseId((prev) => (prev === phaseId ? '' : phaseId));
    },
    [],
  );

  return (
    <div className="flex flex-col gap-3 w-full" role="navigation" aria-label="學習階段">
      {LEARNING_PHASES.map((phase) => {
        const status = getPhaseStatus(phase.id, phase.stepIds, completedSteps, currentStepId);
        const style = PHASE_STYLES[status];
        const completedCount = getCompletedCount(phase.stepIds, completedSteps);
        const totalCount = phase.stepIds.length;
        const isExpanded = expandedPhaseId === phase.id;
        const isCelebrating = celebratingPhase === phase.id;
        const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

        return (
          <div
            key={phase.id}
            className={`relative rounded-xl border transition-all duration-300 overflow-hidden ${style.card}`}
          >
            <CelebrationBurst show={isCelebrating} />

            {/* Phase header */}
            <div
              role="button"
              tabIndex={status !== 'future' ? 0 : -1}
              aria-expanded={isExpanded}
              aria-controls={`phase-content-${phase.id}`}
              className={`flex items-center gap-3 px-4 py-3.5 select-none ${style.header}`}
              onClick={() => handleToggle(phase.id, status)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleToggle(phase.id, status);
                }
              }}
            >
              {/* Status icon */}
              <span className={`flex-shrink-0 text-xl ${style.icon}`}>
                {status === 'completed' ? (
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : status === 'future' ? (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                ) : (
                  <span className="text-lg leading-none">{phase.label.slice(0, 2)}</span>
                )}
              </span>

              {/* Label + description */}
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold leading-tight ${style.label}`}>
                  {phase.label}
                </div>
                <div className={`text-xs mt-0.5 ${style.description}`}>
                  {phase.description}
                </div>
              </div>

              {/* Progress count + chevron */}
              <div className="flex-shrink-0 flex items-center gap-2">
                <span className={`text-xs tabular-nums ${style.progress}`}>
                  {completedCount}/{totalCount}
                </span>
                {status !== 'future' && (
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="px-4 pb-1">
              <div className="h-1 rounded-full bg-gray-200/60 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${style.indicator}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Expandable step list */}
            <div
              id={`phase-content-${phase.id}`}
              className={[
                'transition-all duration-300 ease-in-out overflow-hidden',
                isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0',
              ].join(' ')}
            >
              <div className="px-4 pb-4 pt-2 flex flex-col gap-1.5">
                {phase.stepIds.map((stepId) => {
                  const step = stepMap.get(stepId);
                  if (!step) return null;

                  const isStepCompleted = completedSteps.has(stepId);
                  const isStepCurrent = stepId === currentStepId;
                  const isStepFuture = !isStepCompleted && !isStepCurrent;

                  return (
                    <StepItem
                      key={stepId}
                      step={step}
                      isCompleted={isStepCompleted}
                      isCurrent={isStepCurrent}
                      isFuture={isStepFuture}
                      onClick={() => onStepClick(stepId)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(LearningPhases);
