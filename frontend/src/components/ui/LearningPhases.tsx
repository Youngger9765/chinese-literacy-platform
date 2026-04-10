/**
 * LearningPhases -- vertical accordion that groups learning steps into 3 phases.
 *
 * Visual spec (#1048):
 *   - Each phase is a card with left color stripe, phase-specific gradient theme
 *   - Collapsed completed: green-50 tint, checkmark, "N/N 完成" badge
 *   - Collapsed locked: gray, lock icon, "未解鎖", dimmed
 *   - Expanded active: bold gradient header, animated progress bar, rich step list
 *   - Phase completion: confetti burst + 3 star animation
 *   - Only ONE phase expanded at a time, smooth max-h transition
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { LEARNING_PHASES, STEP_TO_PHASE } from '../../config/phaseConfig';
import type { PhaseDefinition } from '../../config/phaseConfig';

// -- Types -------------------------------------------------------------------

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

// -- Helpers -----------------------------------------------------------------

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

// -- Checkmark SVG -----------------------------------------------------------

const CheckIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

// -- Lock SVG ----------------------------------------------------------------

const LockIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);

// -- Chevron SVG -------------------------------------------------------------

const ChevronIcon: React.FC<{ expanded: boolean; className?: string }> = ({ expanded, className = '' }) => (
  <svg
    className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''} ${className}`}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

// -- Three stars for completion ----------------------------------------------

const ThreeStars: React.FC<{ lit: boolean }> = ({ lit }) => (
  <span className="flex gap-0.5" aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <svg
        key={i}
        className={`w-4 h-4 transition-all duration-500 ${
          lit ? 'text-yellow-400 scale-110' : 'text-gray-300 scale-100'
        }`}
        style={{ transitionDelay: lit ? `${i * 120}ms` : '0ms' }}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M12 2l2.09 6.26L20.18 9l-5.09 3.74L16.18 19 12 15.27 7.82 19l1.09-6.26L3.82 9l6.09-.74z" />
      </svg>
    ))}
  </span>
);

// -- Celebration confetti burst (pure CSS) ------------------------------------

const CelebrationBurst: React.FC<{ show: boolean }> = ({ show }) => {
  if (!show) return null;
  return (
    <span className="absolute -top-1 right-4 pointer-events-none z-10" aria-hidden="true">
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

// -- Golden shimmer keyframes (inline style for phase completion) -------------

const shimmerStyle: React.CSSProperties = {
  background: 'linear-gradient(90deg, transparent 0%, rgba(251,191,36,0.15) 50%, transparent 100%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.2s ease-in-out',
};

// -- Step item inside expanded phase -----------------------------------------

interface StepItemProps {
  step: LearningStep;
  stepIndex: number;
  isCompleted: boolean;
  isCurrent: boolean;
  isFuture: boolean;
  phaseColors: PhaseDefinition['colors'];
  onClick: () => void;
}

const StepItem: React.FC<StepItemProps> = React.memo(
  ({ step, stepIndex, isCompleted, isCurrent, isFuture, phaseColors, onClick }) => {
    const canClick = isCompleted || isCurrent;
    return (
      <button
        type="button"
        onClick={canClick ? onClick : undefined}
        disabled={isFuture}
        className={[
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left min-h-[48px]',
          'transition-colors duration-150',
          isCompleted
            ? 'bg-green-50/80 hover:bg-green-100/80'
            : isCurrent
              ? `bg-white shadow-sm ring-1 ${phaseColors.ring}`
              : 'bg-gray-50/60',
          canClick ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
        aria-current={isCurrent ? 'step' : undefined}
      >
        {/* Status indicator */}
        <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold">
          {isCompleted ? (
            <span className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center">
              <CheckIcon className="w-3.5 h-3.5" />
            </span>
          ) : isCurrent ? (
            <span className={`w-7 h-7 rounded-full ${phaseColors.bar} text-white flex items-center justify-center relative`}>
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className={`absolute inset-0 rounded-full ${phaseColors.bar} opacity-30 animate-ping`} />
            </span>
          ) : (
            <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center text-xs font-semibold">
              {stepIndex + 1}
            </span>
          )}
        </span>

        {/* Step label */}
        <span
          className={[
            'text-sm leading-snug flex-1',
            isCompleted
              ? 'text-green-700 line-through decoration-green-300'
              : isCurrent
                ? 'text-gray-900 font-semibold'
                : 'text-gray-400',
          ].join(' ')}
        >
          {step.label}
        </span>

        {/* Current badge */}
        {isCurrent && (
          <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${phaseColors.badge}`}>
            進行中
          </span>
        )}
      </button>
    );
  },
);

StepItem.displayName = 'StepItem';

// -- Collapsed completed phase -----------------------------------------------

const CollapsedCompletedHeader: React.FC<{
  phase: PhaseDefinition;
  totalCount: number;
  isExpanded: boolean;
  isCelebrating: boolean;
  onToggle: () => void;
}> = ({ phase, totalCount, isExpanded, isCelebrating, onToggle }) => (
  <div
    role="button"
    tabIndex={0}
    aria-expanded={isExpanded}
    aria-controls={`phase-content-${phase.id}`}
    className="flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none"
    onClick={onToggle}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
  >
    {/* Left: green checkmark circle */}
    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center">
      <CheckIcon className="w-4 h-4" />
    </span>

    {/* Center: icon + label + stars */}
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-green-800">
          {phase.icon} {phase.label}
        </span>
        <ThreeStars lit={isCelebrating || true} />
      </div>
      <div className="text-xs text-green-600/70 mt-0.5">{phase.description}</div>
    </div>

    {/* Right: badge + chevron */}
    <span className="flex-shrink-0 flex items-center gap-2">
      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
        {totalCount}/{totalCount} 完成
      </span>
      <ChevronIcon expanded={isExpanded} />
    </span>
  </div>
);

// -- Collapsed locked phase --------------------------------------------------

const CollapsedLockedHeader: React.FC<{ phase: PhaseDefinition }> = ({ phase }) => (
  <div className="flex items-center gap-3 px-4 py-3.5 select-none cursor-default">
    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center">
      <LockIcon className="w-4 h-4" />
    </span>

    <div className="flex-1 min-w-0">
      <div className="text-sm font-semibold text-gray-400">
        {phase.icon} {phase.label}
      </div>
      <div className="text-xs text-gray-400 mt-0.5">{phase.description}</div>
    </div>

    <span className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
      未解鎖
    </span>
  </div>
);

// -- Expanded active phase header --------------------------------------------

const ExpandedActiveHeader: React.FC<{
  phase: PhaseDefinition;
  completedCount: number;
  totalCount: number;
  progressPct: number;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ phase, completedCount, totalCount, progressPct, isExpanded, onToggle }) => (
  <>
    {/* Bold gradient header bar */}
    <div
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-controls={`phase-content-${phase.id}`}
      className={`${phase.colors.gradient} px-4 py-3.5 cursor-pointer select-none`}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl leading-none">{phase.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-white leading-tight">
            {phase.label}
          </div>
          <div className="text-xs text-white/80 mt-0.5">{phase.description}</div>
        </div>
        <span className="flex-shrink-0 flex items-center gap-2">
          <span className="text-sm font-bold text-white tabular-nums">
            {completedCount}/{totalCount}
          </span>
          <ChevronIcon expanded={isExpanded} className="!text-white/70" />
        </span>
      </div>
    </div>

    {/* Animated progress bar below header */}
    <div className="px-4 pt-2 pb-1">
      <div className="h-1.5 rounded-full bg-gray-200/60 overflow-hidden">
        <div
          className={`h-full rounded-full ${phase.colors.bar} transition-all duration-700 ease-out`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  </>
);

// -- Main component ----------------------------------------------------------

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
        const timer = setTimeout(() => setCelebratingPhase(null), 1500);
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
      {/* Inline shimmer keyframe */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      {LEARNING_PHASES.map((phase) => {
        const status = getPhaseStatus(phase.id, phase.stepIds, completedSteps, currentStepId);
        const completedCount = getCompletedCount(phase.stepIds, completedSteps);
        const totalCount = phase.stepIds.length;
        const isExpanded = expandedPhaseId === phase.id;
        const isCelebrating = celebratingPhase === phase.id;
        const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

        // Card wrapper classes
        const cardClasses = [
          'relative rounded-2xl border overflow-hidden transition-all duration-300',
          status === 'completed'
            ? `border-green-200 ${isCelebrating ? '' : 'bg-green-50/60'} shadow-sm`
            : status === 'current'
              ? `border-transparent shadow-sm ring-1 ${phase.colors.ring} bg-white`
              : 'border-gray-200 bg-gray-50/40 opacity-60',
        ].join(' ');

        return (
          <div
            key={phase.id}
            className={cardClasses}
            style={isCelebrating ? shimmerStyle : undefined}
          >
            {/* Left color stripe */}
            <div
              className={`absolute left-0 top-0 bottom-0 w-1 ${
                status === 'completed' ? 'bg-green-500'
                : status === 'current' ? phase.colors.stripe
                : 'bg-gray-300'
              }`}
            />

            <CelebrationBurst show={isCelebrating} />

            {/* Phase header -- different rendering per status */}
            {status === 'completed' && (
              <CollapsedCompletedHeader
                phase={phase}
                totalCount={totalCount}
                isExpanded={isExpanded}
                isCelebrating={isCelebrating}
                onToggle={() => handleToggle(phase.id, status)}
              />
            )}

            {status === 'future' && (
              <CollapsedLockedHeader phase={phase} />
            )}

            {status === 'current' && (
              <ExpandedActiveHeader
                phase={phase}
                completedCount={completedCount}
                totalCount={totalCount}
                progressPct={progressPct}
                isExpanded={isExpanded}
                onToggle={() => handleToggle(phase.id, status)}
              />
            )}

            {/* Expandable step list (completed + current can expand) */}
            {status !== 'future' && (
              <div
                id={`phase-content-${phase.id}`}
                className={[
                  'transition-all duration-300 ease-in-out overflow-hidden',
                  isExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0',
                ].join(' ')}
              >
                <div className="px-4 pb-4 pt-2 flex flex-col gap-1.5">
                  {phase.stepIds.map((stepId, idx) => {
                    const step = stepMap.get(stepId);
                    if (!step) return null;

                    const isStepCompleted = completedSteps.has(stepId);
                    const isStepCurrent = stepId === currentStepId;
                    const isStepFuture = !isStepCompleted && !isStepCurrent;

                    return (
                      <StepItem
                        key={stepId}
                        step={step}
                        stepIndex={idx}
                        isCompleted={isStepCompleted}
                        isCurrent={isStepCurrent}
                        isFuture={isStepFuture}
                        phaseColors={phase.colors}
                        onClick={() => onStepClick(stepId)}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(LearningPhases);
