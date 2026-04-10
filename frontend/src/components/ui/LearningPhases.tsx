/**
 * LearningPhases — 三階段分組學習路徑元件（Issue #1048）
 *
 * 把 ACTIVE_STEPS 動態分成 3 個階段，不 hardcode 步驟數量。
 * 每個階段支援三種視覺狀態：
 *   - completed：綠色 ✓，收合
 *   - active：主色調，展開顯示步驟泡泡
 *   - locked：灰色 🔒，收合
 *
 * 完成整個階段時會顯示 CSS 慶祝動畫（star burst）。
 * Mobile 優先設計：小螢幕只展開當前階段。
 */

import React, { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhaseStep {
  id: string;
  label: string;
}

interface LearningPhasesProps {
  /** All steps in order (pass ACTIVE_STEPS filtered to your session). */
  steps: PhaseStep[];
  /** Set of step IDs that have been completed. */
  completedSteps: Set<string>;
  /** The step the user is currently on (null = not started). */
  currentStepId: string | null;
  /** Called when user clicks a step bubble. */
  onStepClick: (id: string) => void;
  /** Number of phases to split into (default 3). */
  phaseCount?: number;
}

// ─── Phase metadata ───────────────────────────────────────────────────────────

const PHASE_META = [
  {
    icon: '📖',
    label: '認識課文',
    activeColor: 'bg-orange-500',
    activeBg: 'bg-orange-50',
    activeText: 'text-orange-700',
    activeBorder: 'border-orange-200',
    completedColor: 'bg-emerald-500',
    completedBg: 'bg-emerald-50',
    completedText: 'text-emerald-700',
    completedBorder: 'border-emerald-200',
    stepActive: 'bg-orange-100 border-orange-300 text-orange-800',
    stepDone: 'bg-emerald-100 border-emerald-300 text-emerald-800',
    stepPending: 'bg-white border-gray-200 text-gray-500',
  },
  {
    icon: '✏️',
    label: '字詞練功',
    activeColor: 'bg-blue-500',
    activeBg: 'bg-blue-50',
    activeText: 'text-blue-700',
    activeBorder: 'border-blue-200',
    completedColor: 'bg-emerald-500',
    completedBg: 'bg-emerald-50',
    completedText: 'text-emerald-700',
    completedBorder: 'border-emerald-200',
    stepActive: 'bg-blue-100 border-blue-300 text-blue-800',
    stepDone: 'bg-emerald-100 border-emerald-300 text-emerald-800',
    stepPending: 'bg-white border-gray-200 text-gray-500',
  },
  {
    icon: '🎯',
    label: '挑戰闖關',
    activeColor: 'bg-purple-500',
    activeBg: 'bg-purple-50',
    activeText: 'text-purple-700',
    activeBorder: 'border-purple-200',
    completedColor: 'bg-emerald-500',
    completedBg: 'bg-emerald-50',
    completedText: 'text-emerald-700',
    completedBorder: 'border-emerald-200',
    stepActive: 'bg-purple-100 border-purple-300 text-purple-800',
    stepDone: 'bg-emerald-100 border-emerald-300 text-emerald-800',
    stepPending: 'bg-white border-gray-200 text-gray-500',
  },
];

// Fallback for > 3 phases (future-proof)
const FALLBACK_META = {
  icon: '⭐',
  label: '學習階段',
  activeColor: 'bg-gray-500',
  activeBg: 'bg-gray-50',
  activeText: 'text-gray-700',
  activeBorder: 'border-gray-200',
  completedColor: 'bg-emerald-500',
  completedBg: 'bg-emerald-50',
  completedText: 'text-emerald-700',
  completedBorder: 'border-emerald-200',
  stepActive: 'bg-gray-100 border-gray-300 text-gray-800',
  stepDone: 'bg-emerald-100 border-emerald-300 text-emerald-800',
  stepPending: 'bg-white border-gray-200 text-gray-500',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Split steps into N roughly equal groups. */
function splitIntoPhases(steps: PhaseStep[], n: number): PhaseStep[][] {
  if (n <= 0 || steps.length === 0) return [steps];
  const size = Math.ceil(steps.length / n);
  const groups: PhaseStep[][] = [];
  for (let i = 0; i < n; i++) {
    const chunk = steps.slice(i * size, (i + 1) * size);
    if (chunk.length > 0) groups.push(chunk);
  }
  return groups;
}

type PhaseStatus = 'completed' | 'active' | 'locked';

function getPhaseStatus(
  phaseSteps: PhaseStep[],
  completedSteps: Set<string>,
  currentStepId: string | null,
): PhaseStatus {
  const allDone = phaseSteps.every((s) => completedSteps.has(s.id));
  if (allDone) return 'completed';
  const hasActive = phaseSteps.some(
    (s) => s.id === currentStepId || (!completedSteps.has(s.id)),
  );
  const anyStarted = phaseSteps.some(
    (s) => completedSteps.has(s.id) || s.id === currentStepId,
  );
  if (anyStarted || hasActive) return 'active';
  return 'locked';
}

// ─── Confetti / star burst animation ─────────────────────────────────────────

const STAR_COLORS = ['#F59E42', '#5B4FC4', '#22C55E', '#EF4444', '#3B82F6'];

interface StarParticle {
  id: number;
  x: number;
  y: number;
  color: string;
  angle: number;
  size: number;
  duration: number;
}

function generateStars(count = 12): StarParticle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: 40 + Math.random() * 20,  // center ±10%
    y: 50,
    color: STAR_COLORS[i % STAR_COLORS.length],
    angle: (i / count) * 360,
    size: 6 + Math.random() * 6,
    duration: 500 + Math.random() * 400,
  }));
}

const StarBurst: React.FC<{ visible: boolean }> = ({ visible }) => {
  if (!visible) return null;
  const stars = generateStars(14);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
    >
      {stars.map((s) => (
        <div
          key={s.id}
          className="absolute rounded-full animate-phase-star"
          style={
            {
              width: s.size,
              height: s.size,
              backgroundColor: s.color,
              left: `${s.x}%`,
              top: `${s.y}%`,
              '--star-angle': `${s.angle}deg`,
              '--star-duration': `${s.duration}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};

// ─── Phase card ───────────────────────────────────────────────────────────────

interface PhaseCardProps {
  phaseIndex: number;
  steps: PhaseStep[];
  completedSteps: Set<string>;
  currentStepId: string | null;
  onStepClick: (id: string) => void;
  /** Force open (e.g. on mobile, only active phase is open) */
  forceOpen?: boolean;
}

const PhaseCard: React.FC<PhaseCardProps> = ({
  phaseIndex,
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
  forceOpen,
}) => {
  const meta = PHASE_META[phaseIndex] ?? FALLBACK_META;
  const status = getPhaseStatus(steps, completedSteps, currentStepId);
  const completedCount = steps.filter((s) => completedSteps.has(s.id)).length;

  // Track if this phase JUST became completed so we can show burst animation
  const prevCompletedRef = useRef(status === 'completed');
  const [showBurst, setShowBurst] = useState(false);

  useEffect(() => {
    const justCompleted = !prevCompletedRef.current && status === 'completed';
    prevCompletedRef.current = status === 'completed';
    if (justCompleted) {
      setShowBurst(true);
      const t = setTimeout(() => setShowBurst(false), 900);
      return () => clearTimeout(t);
    }
  }, [status]);

  // Expand/collapse — default: active phase is open, others are closed
  const [isOpen, setIsOpen] = useState(status === 'active');

  // Sync open state when active phase changes (e.g. after completing a phase)
  useEffect(() => {
    if (forceOpen !== undefined) {
      setIsOpen(forceOpen);
    } else {
      setIsOpen(status === 'active');
    }
  }, [status, forceOpen]);

  const isLocked = status === 'locked';
  const isDone = status === 'completed';

  // ── Header colors ──
  const headerBg = isDone
    ? meta.completedBg
    : isLocked
      ? 'bg-gray-50'
      : meta.activeBg;

  const headerBorder = isDone
    ? meta.completedBorder
    : isLocked
      ? 'border-gray-200'
      : meta.activeBorder;

  const headerText = isDone
    ? meta.completedText
    : isLocked
      ? 'text-gray-400'
      : meta.activeText;

  const badgeBg = isDone
    ? meta.completedColor
    : isLocked
      ? 'bg-gray-300'
      : meta.activeColor;

  return (
    <div
      className={`relative rounded-xl border ${headerBorder} overflow-hidden transition-all duration-300`}
    >
      <StarBurst visible={showBurst} />

      {/* ── Phase header ── */}
      <button
        onClick={() => !isLocked && setIsOpen((o) => !o)}
        disabled={isLocked}
        aria-expanded={isOpen}
        className={`w-full flex items-center gap-3 px-4 py-3 ${headerBg} transition-colors ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer hover:brightness-95'}`}
      >
        {/* Badge number */}
        <span
          className={`flex-shrink-0 w-7 h-7 rounded-full ${badgeBg} flex items-center justify-center text-white text-sm font-bold`}
        >
          {isDone ? '✓' : isLocked ? '🔒' : phaseIndex + 1}
        </span>

        {/* Phase icon + label */}
        <span className={`flex-1 text-left font-semibold text-base ${headerText}`}>
          <span className="mr-1.5">{meta.icon}</span>
          {meta.label}
        </span>

        {/* Progress count */}
        <span className={`text-sm font-medium ${headerText} opacity-80`}>
          {completedCount}/{steps.length}
        </span>

        {/* Chevron */}
        {!isLocked && (
          <svg
            className={`w-4 h-4 flex-shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''} ${headerText}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* ── Steps grid (collapsible) ── */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isOpen && !isLocked ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {steps.map((step) => {
            const isDoneStep = completedSteps.has(step.id);
            const isCurrentStep = !isDoneStep && step.id === currentStepId;
            const stepCls = isDoneStep
              ? meta.stepDone
              : isCurrentStep
                ? meta.stepActive
                : meta.stepPending;

            return (
              <button
                key={step.id}
                onClick={() => onStepClick(step.id)}
                title={step.label}
                className={`flex-1 min-w-[72px] max-w-[120px] min-h-[48px] rounded-lg border px-2 py-1.5 flex flex-col items-center justify-center gap-0.5 transition-all duration-150 active:scale-95 ${stepCls} ${isDoneStep ? '' : isCurrentStep ? 'ring-2 ring-offset-1 ring-current' : 'opacity-60 hover:opacity-90'}`}
              >
                {isDoneStep && (
                  <span className="text-xs leading-none">✓</span>
                )}
                {isCurrentStep && (
                  <span className="text-xs leading-none animate-bounce">▶</span>
                )}
                <span className="text-[11px] leading-tight font-medium text-center whitespace-normal break-words">
                  {step.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const LearningPhases: React.FC<LearningPhasesProps> = ({
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
  phaseCount = 3,
}) => {
  const phases = splitIntoPhases(steps, phaseCount);

  return (
    <div className="flex flex-col gap-2 w-full">
      {phases.map((phaseSteps, i) => (
        <PhaseCard
          key={i}
          phaseIndex={i}
          steps={phaseSteps}
          completedSteps={completedSteps}
          currentStepId={currentStepId}
          onStepClick={onStepClick}
        />
      ))}
    </div>
  );
};

export default LearningPhases;
