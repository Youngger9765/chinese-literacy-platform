/**
 * LearningPathDuolingo — Duolingo-style winding snake path for learning steps.
 *
 * Each step renders as a large circular 3D-depth button arranged in a zigzag
 * pattern, grouped into units separated by colored banner headers.
 *
 * Design reference: https://github.com/bryanjenningz/react-duolingo (learn.tsx)
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { StepConfig, StepCategory } from '../../config/stepConfig';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TileStatus = 'complete' | 'active' | 'locked';

export interface LearningPathStep extends StepConfig {
  /** Runtime status for this step */
  status: TileStatus;
}

export interface UnitConfig {
  title: string;
  emoji: string;
  bgColor: string;
  borderColor: string;
}

export interface LearningPathDuolingoProps {
  /** Steps with runtime status — must already be filtered to enabled only */
  steps: LearningPathStep[];
  /** Called when user clicks "start" on a tile tooltip */
  onStartStep: (step: LearningPathStep) => void;
  /** Optional: override default 3-unit distribution */
  units?: UnitConfig[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 8-position zigzag cycle (px offsets from center) — mirrors react-duolingo */
const ZIGZAG_OFFSETS = [0, -45, -70, -45, 0, 45, 70, 45];

const DEFAULT_UNITS: UnitConfig[] = [
  { title: '認識課文', emoji: '📖', bgColor: 'bg-emerald-500', borderColor: 'border-emerald-600' },
  { title: '字詞練功', emoji: '✏️', bgColor: 'bg-blue-500', borderColor: 'border-blue-600' },
  { title: '挑戰闖關', emoji: '🎯', bgColor: 'bg-red-500', borderColor: 'border-red-600' },
];

const TILE_SIZE = 70; // px

// ---------------------------------------------------------------------------
// SVG Icons (inline, no external deps)
// ---------------------------------------------------------------------------

const CheckIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const StarIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const LockIcon: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 10h-1V7c0-2.76-2.24-5-5-5S7 4.24 7 7v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3-9H9V7c0-1.66 1.34-3 3-3s3 1.34 3 3v3z" />
  </svg>
);

const TrophyIcon: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0011 15.9V19H7v2h10v-2h-4v-3.1a5.01 5.01 0 003.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z" />
  </svg>
);

const TreasureIcon: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 13h18v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6zm8 2v4h2v-4h-2z" fill="#F59E0B" />
    <path d="M1 9h22v4H1V9z" fill="#D97706" />
    <rect x="10" y="7" width="4" height="6" rx="1" fill="#FBBF24" />
    <path d="M5 9V6a7 7 0 0114 0v3" fill="none" stroke="#92400E" strokeWidth="2" />
  </svg>
);

// ---------------------------------------------------------------------------
// Tooltip (popup on active tile click)
// ---------------------------------------------------------------------------

interface TooltipProps {
  step: LearningPathStep;
  anchorRect: DOMRect | null;
  containerRef: React.RefObject<HTMLElement | null>;
  onStart: () => void;
  onClose: () => void;
}

const TileTooltip: React.FC<TooltipProps> = ({ step, anchorRect, containerRef, onStart, onClose }) => {
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!anchorRect || !containerRef.current) return null;

  const containerRect = containerRef.current.getBoundingClientRect();
  const scrollTop = containerRef.current.scrollTop;

  // Position tooltip below the tile, centered
  const top = anchorRect.bottom - containerRect.top + scrollTop + 12;
  const left = anchorRect.left - containerRect.left + anchorRect.width / 2;

  return (
    <div
      ref={tooltipRef}
      className="absolute z-50 animate-slide-up-fast"
      style={{ top, left, transform: 'translateX(-50%)' }}
    >
      {/* Arrow pointing up */}
      <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white rotate-45 border-l border-t border-gray-200" />

      <div className="relative bg-white rounded-2xl shadow-lg border border-gray-200 px-6 py-4 min-w-[180px] text-center">
        <p className="font-bold text-gray-800 text-base mb-3">{step.label}</p>
        <button
          onClick={onStart}
          className="w-full rounded-xl border-b-4 border-green-600 bg-green-500 px-6 py-2.5 font-bold text-white uppercase tracking-wide hover:bg-green-400 active:translate-y-[2px] active:border-b-2 transition-all"
        >
          開始 +10 XP
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Unit Header Banner
// ---------------------------------------------------------------------------

interface UnitHeaderProps {
  unitNumber: number;
  config: UnitConfig;
}

const UnitHeader: React.FC<UnitHeaderProps> = ({ unitNumber, config }) => (
  <div className={`w-full max-w-[320px] ${config.bgColor} rounded-2xl px-6 py-4 flex items-center justify-between my-2`}>
    <div>
      <p className="text-white/80 text-xs font-semibold uppercase tracking-wider">
        單元 {unitNumber}
      </p>
      <h3 className="text-white font-bold text-lg">
        {config.emoji} {config.title}
      </h3>
    </div>
    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
      <span className="text-2xl">{config.emoji}</span>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Treasure Chest (between units)
// ---------------------------------------------------------------------------

const TreasureChest: React.FC = () => (
  <div className="flex items-center justify-center my-4">
    <div className="w-16 h-16 rounded-full bg-amber-100 border-4 border-amber-300 flex items-center justify-center shadow-md">
      <TreasureIcon className="w-9 h-9" />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Single Tile Button
// ---------------------------------------------------------------------------

interface TileProps {
  step: LearningPathStep;
  globalIndex: number;
  isLastInUnit: boolean;
  isSelected: boolean;
  onClick: (step: LearningPathStep, rect: DOMRect) => void;
}

const Tile: React.FC<TileProps> = ({ step, globalIndex, isLastInUnit, isSelected, onClick }) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const offset = ZIGZAG_OFFSETS[globalIndex % ZIGZAG_OFFSETS.length];

  const handleClick = () => {
    if (step.status === 'locked') return;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) onClick(step, rect);
  };

  // Color + icon per status
  let bgClass: string;
  let borderClass: string;
  let icon: React.ReactNode;
  let extraClass = '';

  if (step.status === 'complete') {
    bgClass = 'bg-yellow-400';
    borderClass = 'border-yellow-500';
    icon = isLastInUnit
      ? <TrophyIcon className="w-8 h-8 text-white" />
      : <CheckIcon className="w-8 h-8 text-white" />;
  } else if (step.status === 'active') {
    bgClass = 'bg-green-500';
    borderClass = 'border-green-600';
    icon = isLastInUnit
      ? <TrophyIcon className="w-8 h-8 text-white" />
      : <StarIcon className="w-8 h-8 text-white" />;
    extraClass = 'animate-duo-bounce animate-duo-pulse';
  } else {
    bgClass = 'bg-[#e5e5e5]';
    borderClass = 'border-[#b7b7b7]';
    icon = <LockIcon className="w-7 h-7 text-[#afafaf]" />;
  }

  return (
    <div
      className="relative flex flex-col items-center -mb-1"
      style={{ marginLeft: offset }}
    >
      {/* "Start" label above active tile */}
      {step.status === 'active' && !isSelected && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-xl px-3 py-1 shadow-sm whitespace-nowrap z-10">
          <span className="text-sm font-bold text-green-600">開始</span>
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white border-r border-b border-gray-200 rotate-45" />
        </div>
      )}

      <button
        ref={btnRef}
        onClick={handleClick}
        disabled={step.status === 'locked'}
        aria-label={`${step.label}${step.status === 'locked' ? ' (尚未解鎖)' : step.status === 'complete' ? ' (已完成)' : ' (進行中)'}`}
        className={[
          'relative rounded-full border-b-8 flex items-center justify-center transition-all',
          bgClass,
          borderClass,
          step.status === 'locked' ? 'cursor-not-allowed opacity-80' : 'cursor-pointer hover:brightness-105 active:border-b-4 active:translate-y-[2px]',
          step.status === 'active' ? extraClass : '',
          isSelected ? 'ring-4 ring-green-300 ring-offset-2' : '',
        ].join(' ')}
        style={{ width: TILE_SIZE, height: TILE_SIZE + 8 /* account for border-b-8 depth */ }}
      >
        {icon}
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const LearningPathDuolingo: React.FC<LearningPathDuolingoProps> = ({
  steps,
  onStartStep,
  units = DEFAULT_UNITS,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedStep, setSelectedStep] = useState<LearningPathStep | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null);

  // Distribute steps into units (roughly equal groups)
  const unitGroups = distributeStepsIntoUnits(steps, units.length);

  const handleTileClick = useCallback((step: LearningPathStep, rect: DOMRect) => {
    if (selectedStep?.id === step.id) {
      setSelectedStep(null);
      setTooltipAnchor(null);
    } else {
      setSelectedStep(step);
      setTooltipAnchor(rect);
    }
  }, [selectedStep]);

  const handleCloseTooltip = useCallback(() => {
    setSelectedStep(null);
    setTooltipAnchor(null);
  }, []);

  const handleStartStep = useCallback(() => {
    if (selectedStep) {
      onStartStep(selectedStep);
      setSelectedStep(null);
      setTooltipAnchor(null);
    }
  }, [selectedStep, onStartStep]);

  // Track global index across all units for zigzag continuity
  let globalIndex = 0;

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col items-center py-6 px-4 overflow-y-auto"
      style={{ minHeight: '100%' }}
    >
      {unitGroups.map((unitSteps, unitIdx) => {
        const unitConfig = units[unitIdx] ?? DEFAULT_UNITS[0];
        const unitNumber = unitIdx + 1;

        return (
          <React.Fragment key={`unit-${unitIdx}`}>
            {/* Unit header banner */}
            <UnitHeader unitNumber={unitNumber} config={unitConfig} />

            {/* Tiles for this unit */}
            <div className="flex flex-col items-center gap-4 py-4">
              {unitSteps.map((step, stepIdx) => {
                const currentGlobalIndex = globalIndex;
                globalIndex += 1;
                const isLastInUnit = stepIdx === unitSteps.length - 1;

                return (
                  <Tile
                    key={step.id}
                    step={step}
                    globalIndex={currentGlobalIndex}
                    isLastInUnit={isLastInUnit}
                    isSelected={selectedStep?.id === step.id}
                    onClick={handleTileClick}
                  />
                );
              })}
            </div>

            {/* Treasure chest between units (not after the last one) */}
            {unitIdx < unitGroups.length - 1 && <TreasureChest />}
          </React.Fragment>
        );
      })}

      {/* Tooltip overlay */}
      {selectedStep && (
        <TileTooltip
          step={selectedStep}
          anchorRect={tooltipAnchor}
          containerRef={containerRef}
          onStart={handleStartStep}
          onClose={handleCloseTooltip}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Distribute steps into N roughly equal groups. */
function distributeStepsIntoUnits(steps: LearningPathStep[], numUnits: number): LearningPathStep[][] {
  const groups: LearningPathStep[][] = Array.from({ length: numUnits }, () => []);
  const perUnit = Math.ceil(steps.length / numUnits);

  steps.forEach((step, i) => {
    const unitIdx = Math.min(Math.floor(i / perUnit), numUnits - 1);
    groups[unitIdx].push(step);
  });

  return groups;
}

export default LearningPathDuolingo;
