/**
 * WorldMap — Super Mario World-style gamified learning path.
 *
 * Auto-distributes ACTIVE_STEPS into 3 themed worlds:
 *   World 1: Explore Forest (emerald)
 *   World 2: Word Castle (amber)
 *   World 3: Challenge Volcano (red/orange)
 *
 * Each step renders as a raised circular node connected by dotted paths
 * that zigzag left-to-right. Completed nodes show checkmarks + stars,
 * the current node bounces, and locked nodes are dimmed.
 */

import React, { useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorldMapStep {
  id: string;
  label: string;
}

interface WorldMapProps {
  steps: WorldMapStep[];
  completedSteps: Set<string>;
  currentStepId: string;
  onStepClick: (id: string) => void;
}

// ── World theme definitions ────────────────────────────────────────────────

interface WorldTheme {
  name: string;
  bg: string;
  accent: string;         // Tailwind color class prefix
  accentBg: string;       // filled node bg
  accentBorder: string;   // border color
  accentText: string;     // number text
  pathDoneColor: string;  // CSS hex color for completed path stroke
  glowColor: string;      // CSS rgb for glow
  nodeGlow: string;       // completed node glow shadow
}

const WORLD_THEMES: WorldTheme[] = [
  {
    name: '探索森林',
    bg: 'from-emerald-100 via-green-50 to-emerald-100',
    accent: 'emerald',
    accentBg: 'bg-emerald-500',
    accentBorder: 'border-emerald-500',
    accentText: 'text-emerald-600',
    pathDoneColor: '#34D399',
    glowColor: '16 185 129',
    nodeGlow: 'shadow-[0_0_8px_rgba(16,185,129,0.3)]',
  },
  {
    name: '字詞城堡',
    bg: 'from-amber-100 via-yellow-50 to-amber-100',
    accent: 'amber',
    accentBg: 'bg-amber-500',
    accentBorder: 'border-amber-500',
    accentText: 'text-amber-600',
    pathDoneColor: '#FBBF24',
    glowColor: '245 158 11',
    nodeGlow: 'shadow-[0_0_8px_rgba(245,158,11,0.3)]',
  },
  {
    name: '挑戰火山',
    bg: 'from-red-100 via-orange-50 to-red-100',
    accent: 'red',
    accentBg: 'bg-red-500',
    accentBorder: 'border-red-500',
    accentText: 'text-red-600',
    pathDoneColor: '#F87171',
    glowColor: '239 68 68',
    nodeGlow: 'shadow-[0_0_8px_rgba(239,68,68,0.3)]',
  },
];

// ── Zigzag position pattern (8 positions, Duolingo-style) ──────────────────

/** X-offset percentages for zigzag pattern (repeating). */
const ZIGZAG_X = [50, 30, 15, 30, 50, 70, 85, 70];

function getZigzagX(index: number): number {
  return ZIGZAG_X[index % ZIGZAG_X.length];
}

// ── Decorative SVG elements ────────────────────────────────────────────────

const TreeSVG: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="20" height="28" viewBox="0 0 20 28" fill="none" aria-hidden="true">
    <polygon points="10,2 2,18 18,18" fill="currentColor" opacity="0.6" />
    <polygon points="10,8 4,22 16,22" fill="currentColor" opacity="0.4" />
    <rect x="8" y="22" width="4" height="6" fill="currentColor" opacity="0.3" />
  </svg>
);

const CastleSVG: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="22" height="28" viewBox="0 0 22 28" fill="none" aria-hidden="true">
    <rect x="3" y="10" width="16" height="18" fill="currentColor" opacity="0.3" />
    <rect x="1" y="8" width="6" height="4" fill="currentColor" opacity="0.4" />
    <rect x="15" y="8" width="6" height="4" fill="currentColor" opacity="0.4" />
    <polygon points="4,8 4,2 2,2 2,8" fill="currentColor" opacity="0.5" />
    <polygon points="18,8 18,2 20,2 20,8" fill="currentColor" opacity="0.5" />
    <polygon points="11,4 8,10 14,10" fill="currentColor" opacity="0.5" />
    <rect x="9" y="20" width="4" height="8" fill="currentColor" opacity="0.2" />
  </svg>
);

const FlameSVG: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} width="16" height="24" viewBox="0 0 16 24" fill="none" aria-hidden="true">
    <path
      d="M8 2C8 2 2 10 2 15C2 19 5 22 8 22C11 22 14 19 14 15C14 10 8 2 8 2Z"
      fill="currentColor"
      opacity="0.4"
    />
    <path
      d="M8 10C8 10 5 14 5 16.5C5 18.5 6.5 20 8 20C9.5 20 11 18.5 11 16.5C11 14 8 10 8 10Z"
      fill="currentColor"
      opacity="0.6"
    />
  </svg>
);

/** Scatter positions for decorative elements (percent-based, seeded). */
const DECOR_POSITIONS = [
  { left: '5%', top: '15%' },
  { left: '88%', top: '25%' },
  { left: '8%', top: '55%' },
  { left: '92%', top: '45%' },
  { left: '12%', top: '80%' },
  { left: '85%', top: '75%' },
];

const WorldDecorations: React.FC<{ worldIndex: number }> = ({ worldIndex }) => {
  const DecorComponent = worldIndex === 0 ? TreeSVG : worldIndex === 1 ? CastleSVG : FlameSVG;
  const colorClass =
    worldIndex === 0
      ? 'text-emerald-500'
      : worldIndex === 1
        ? 'text-amber-500'
        : 'text-red-400';

  return (
    <>
      {DECOR_POSITIONS.map((pos, i) => (
        <div
          key={i}
          className={`absolute pointer-events-none ${colorClass}`}
          style={{ left: pos.left, top: pos.top, opacity: 0.15 + (i % 3) * 0.05 }}
        >
          <DecorComponent />
        </div>
      ))}
    </>
  );
};

// ── Lock icon ──────────────────────────────────────────────────────────────

const LockIcon: React.FC = () => (
  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
    />
  </svg>
);

// ── Checkmark icon ─────────────────────────────────────────────────────────

const CheckIcon: React.FC = () => (
  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

// ── Three golden stars ─────────────────────────────────────────────────────

const GoldenStars: React.FC = () => (
  <div className="flex gap-0.5 justify-center mt-1" aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <svg key={i} className="w-3 h-3 text-yellow-400" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l2.09 6.26L20.18 9l-5.09 3.74L16.18 19 12 15.27 7.82 19l1.09-6.26L3.82 9l6.09-.74z" />
      </svg>
    ))}
  </div>
);

// ── Trophy SVG ─────────────────────────────────────────────────────────────

const TrophySVG: React.FC = () => (
  <div className="flex flex-col items-center gap-2">
    <div className="relative">
      <svg className="w-16 h-16 text-yellow-400 drop-shadow-lg" viewBox="0 0 64 64" fill="currentColor">
        {/* Cup body */}
        <path d="M16 8h32v4H16z" opacity="0.8" />
        <path d="M18 12h28l-4 24H22z" />
        {/* Handles */}
        <path d="M16 14h-4a4 4 0 000 8h4v-8z" opacity="0.7" />
        <path d="M48 14h4a4 4 0 010 8h-4v-8z" opacity="0.7" />
        {/* Base */}
        <rect x="26" y="36" width="12" height="8" rx="1" opacity="0.8" />
        <rect x="20" y="44" width="24" height="4" rx="2" opacity="0.6" />
        {/* Star on cup */}
        <path d="M32 18l1.5 4.5H38l-3.6 2.7 1.4 4.3L32 26.8l-3.8 2.7 1.4-4.3L26 22.5h4.5z" fill="white" opacity="0.5" />
      </svg>
      {/* Sparkles */}
      <span className="absolute -top-1 -right-1 w-3 h-3 text-yellow-300 animate-sparkle" style={{ animationDelay: '0s' }}>
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1 4 4 1-4 1-1 4-1-4-4-1 4-1z" /></svg>
      </span>
      <span className="absolute -top-2 left-0 w-2.5 h-2.5 text-yellow-200 animate-sparkle" style={{ animationDelay: '0.5s' }}>
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1 4 4 1-4 1-1 4-1-4-4-1 4-1z" /></svg>
      </span>
      <span className="absolute bottom-2 -left-2 w-2 h-2 text-amber-300 animate-sparkle" style={{ animationDelay: '1s' }}>
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1 4 4 1-4 1-1 4-1-4-4-1 4-1z" /></svg>
      </span>
    </div>
    <span className="text-sm font-bold text-yellow-600">完成!</span>
  </div>
);

// ── World Gate ─────────────────────────────────────────────────────────────

interface WorldGateProps {
  worldNumber: number;
  worldName: string;
  isUnlocked: boolean;
  theme: WorldTheme;
}

const WorldGate: React.FC<WorldGateProps> = ({ worldNumber, worldName, isUnlocked, theme }) => (
  <div className="relative flex items-center justify-center py-6 px-4">
    {/* Left pillar */}
    <div className={`w-3 h-16 rounded-t-lg ${isUnlocked ? theme.accentBg : 'bg-gray-300'} opacity-60`} />

    {/* Gate banner */}
    <div className="relative flex flex-col items-center mx-4">
      {/* Ornate top border */}
      <div className={`w-40 h-1 rounded-full ${isUnlocked ? theme.accentBg : 'bg-gray-300'} mb-2`} />

      <div className={`
        flex items-center gap-2.5 px-5 py-2.5 rounded-xl border-2
        ${isUnlocked
          ? `${theme.accentBorder} bg-white/90`
          : 'border-gray-300 bg-gray-100/90'
        }
      `}>
        {/* Shield badge */}
        <div className={`
          w-8 h-9 flex items-center justify-center rounded-b-lg rounded-t-md
          ${isUnlocked ? theme.accentBg : 'bg-gray-400'}
          text-white text-sm font-bold
        `}>
          {worldNumber}
        </div>

        <span className={`text-sm font-bold ${isUnlocked ? theme.accentText : 'text-gray-400'}`}>
          {worldName}
        </span>

        {!isUnlocked && (
          <svg className="w-4 h-4 text-gray-400 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        )}
      </div>

      {/* Ornate bottom border */}
      <div className={`w-32 h-0.5 rounded-full ${isUnlocked ? theme.accentBg : 'bg-gray-300'} mt-2 opacity-60`} />
    </div>

    {/* Right pillar */}
    <div className={`w-3 h-16 rounded-t-lg ${isUnlocked ? theme.accentBg : 'bg-gray-300'} opacity-60`} />
  </div>
);

// ── Level Node ─────────────────────────────────────────────────────────────

type NodeStatus = 'completed' | 'current' | 'locked';

interface LevelNodeProps {
  stepIndex: number;
  label: string;
  status: NodeStatus;
  theme: WorldTheme;
  onClick: () => void;
  xPercent: number;
}

const LevelNode: React.FC<LevelNodeProps> = React.memo(({ stepIndex, label, status, theme, onClick, xPercent }) => {
  const canClick = status !== 'locked';

  return (
    <div
      className="absolute flex flex-col items-center"
      style={{
        left: `${xPercent}%`,
        transform: 'translateX(-50%)',
      }}
    >
      {/* The node button */}
      <button
        type="button"
        onClick={canClick ? onClick : undefined}
        disabled={!canClick}
        aria-label={`${label} — ${status === 'completed' ? '已完成' : status === 'current' ? '進行中' : '未解鎖'}`}
        aria-current={status === 'current' ? 'step' : undefined}
        className={[
          'relative w-16 h-16 rounded-full flex items-center justify-center',
          'transition-all duration-150',
          // Completed
          status === 'completed' && [
            theme.accentBg,
            'border-b-[6px]',
            theme.accentBorder,
            theme.nodeGlow,
            'active:translate-y-0.5 active:border-b-4',
          ].join(' '),
          // Current — bounce + glow
          status === 'current' && [
            'bg-white border-[3px]',
            theme.accentBorder,
            'animate-map-bounce',
            'active:translate-y-0.5 active:border-b-4',
          ].join(' '),
          // Locked
          status === 'locked' && 'bg-gray-200 border-b-[6px] border-gray-300 opacity-50 cursor-not-allowed',
        ].filter(Boolean).join(' ')}
        style={
          status === 'current'
            ? { '--tw-glow-color': theme.glowColor } as React.CSSProperties
            : undefined
        }
      >
        {status === 'completed' ? (
          <CheckIcon />
        ) : status === 'current' ? (
          <span className={`text-lg font-bold ${theme.accentText}`}>{stepIndex + 1}</span>
        ) : (
          <LockIcon />
        )}

        {/* Pulse glow ring on current */}
        {status === 'current' && (
          <span
            className="absolute inset-0 rounded-full animate-map-glow"
            style={{ '--tw-glow-color': theme.glowColor } as React.CSSProperties}
            aria-hidden="true"
          />
        )}
      </button>

      {/* Stars below completed nodes */}
      {status === 'completed' && <GoldenStars />}

      {/* Label */}
      <span className={`
        mt-1 text-xs font-medium text-center leading-tight max-w-[80px]
        ${status === 'completed' ? 'text-gray-700' : status === 'current' ? 'text-gray-900 font-semibold' : 'text-gray-400'}
      `}>
        {label}
      </span>
    </div>
  );
});

LevelNode.displayName = 'LevelNode';

// ── Dotted path between nodes ──────────────────────────────────────────────

interface DottedPathProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isCompleted: boolean;
  theme: WorldTheme;
}

const DottedPath: React.FC<DottedPathProps> = ({ fromX, fromY, toX, toY, isCompleted, theme }) => {
  // Compute an SVG path between two points with a slight curve
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const d = `M ${fromX} ${fromY} Q ${midX} ${midY} ${toX} ${toY}`;

  return (
    <path
      d={d}
      fill="none"
      stroke={isCompleted ? theme.pathDoneColor : '#D1D5DB'}
      strokeWidth="3"
      strokeDasharray="8 6"
      strokeLinecap="round"
    />
  );
};

// ── World Section ──────────────────────────────────────────────────────────

interface WorldSectionProps {
  worldIndex: number;
  theme: WorldTheme;
  stepIds: string[];
  allSteps: Map<string, WorldMapStep>;
  completedSteps: Set<string>;
  currentStepId: string;
  globalStepOffset: number;
  onStepClick: (id: string) => void;
}

/** Vertical spacing between nodes in pixels. */
const NODE_SPACING_Y = 110;
/** Top padding inside world section. */
const WORLD_PADDING_TOP = 20;

const WorldSection: React.FC<WorldSectionProps> = ({
  worldIndex,
  theme,
  stepIds,
  allSteps,
  completedSteps,
  currentStepId,
  globalStepOffset,
  onStepClick,
}) => {
  const worldHeight = WORLD_PADDING_TOP + stepIds.length * NODE_SPACING_Y + 40;

  // Pre-compute node positions for SVG paths
  const nodePositions = stepIds.map((_, i) => ({
    x: getZigzagX(i),
    y: WORLD_PADDING_TOP + i * NODE_SPACING_Y + 32, // center of 64px node
  }));

  return (
    <div
      className={`relative bg-gradient-to-b ${theme.bg}`}
      style={{ minHeight: `${worldHeight}px` }}
    >
      {/* Decorative background elements */}
      <WorldDecorations worldIndex={worldIndex} />

      {/* SVG layer for dotted paths — viewBox uses 0-100 X (percent) and pixel Y */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 100 ${worldHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {nodePositions.map((pos, i) => {
          if (i === 0) return null;
          const prev = nodePositions[i - 1];
          const isPathCompleted = completedSteps.has(stepIds[i - 1]);
          return (
            <DottedPath
              key={i}
              fromX={prev.x}
              fromY={prev.y}
              toX={pos.x}
              toY={pos.y}
              isCompleted={isPathCompleted}
              theme={theme}
            />
          );
        })}
      </svg>

      {/* Level nodes */}
      {stepIds.map((stepId, i) => {
        const step = allSteps.get(stepId);
        if (!step) return null;

        const isCompleted = completedSteps.has(stepId);
        const isCurrent = stepId === currentStepId;
        const status: NodeStatus = isCompleted ? 'completed' : isCurrent ? 'current' : 'locked';

        return (
          <div
            key={stepId}
            className="relative"
            style={{ height: i === 0 ? `${WORLD_PADDING_TOP + NODE_SPACING_Y}px` : `${NODE_SPACING_Y}px` }}
          >
            <LevelNode
              stepIndex={globalStepOffset + i}
              label={step.label}
              status={status}
              theme={theme}
              onClick={() => onStepClick(stepId)}
              xPercent={getZigzagX(i)}
            />
          </div>
        );
      })}
    </div>
  );
};

// ── Step distribution into 3 worlds ────────────────────────────────────────

interface WorldDef {
  id: string;
  name: string;
  stepIds: string[];
}

/** Distribute steps roughly equally into 3 worlds. */
function distributeIntoWorlds(steps: WorldMapStep[]): WorldDef[] {
  const names = ['explore', 'practice', 'challenge'];
  const labels = ['探索森林', '字詞城堡', '挑戰火山'];
  const count = 3;
  const baseSize = Math.floor(steps.length / count);
  const remainder = steps.length % count;

  let cursor = 0;
  return names.map((id, i) => {
    const size = baseSize + (i < remainder ? 1 : 0);
    const assigned = steps.slice(cursor, cursor + size).map((s) => s.id);
    cursor += size;
    return { id, name: labels[i], stepIds: assigned };
  });
}

// ── Main WorldMap ──────────────────────────────────────────────────────────

const WorldMap: React.FC<WorldMapProps> = ({
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
}) => {
  const stepMap = useMemo(
    () => new Map(steps.map((s) => [s.id, s])),
    [steps],
  );

  // Distribute steps into 3 worlds
  const worldDefs = useMemo(() => distributeIntoWorlds(steps), [steps]);

  const worlds = useMemo(() => {
    return worldDefs.map((def, i) => ({
      phase: def,
      theme: WORLD_THEMES[i] ?? WORLD_THEMES[0],
    }));
  }, [worldDefs]);

  // Determine which worlds are unlocked
  // A world is unlocked if the previous world is fully completed or if it's the first world
  const worldUnlockStatus = useMemo(() => {
    return worlds.map((w, i) => {
      if (i === 0) return true;
      const prevPhase = worlds[i - 1].phase;
      return prevPhase.stepIds.length > 0 && prevPhase.stepIds.every((id) => completedSteps.has(id));
    });
  }, [worlds, completedSteps]);

  // Check if any step in a world is the current step (world should be unlocked)
  const worldHasCurrent = useMemo(() => {
    return worlds.map((w) => w.phase.stepIds.includes(currentStepId));
  }, [worlds, currentStepId]);

  // A world is accessible if unlocked OR contains the current step
  const worldAccessible = useMemo(() => {
    return worlds.map((_, i) => worldUnlockStatus[i] || worldHasCurrent[i]);
  }, [worldUnlockStatus, worldHasCurrent]);

  // All steps completed?
  const allDone = useMemo(
    () => steps.length > 0 && steps.every((s) => completedSteps.has(s.id)),
    [steps, completedSteps],
  );

  // Track cumulative step offset for global step numbers
  let stepOffset = 0;

  return (
    <div
      className="w-full overflow-y-auto overflow-x-hidden"
      role="navigation"
      aria-label="學習世界地圖"
    >
      <div className="max-w-sm mx-auto">
        {worlds.map((w, worldIdx) => {
          const isAccessible = worldAccessible[worldIdx];
          const currentOffset = stepOffset;
          stepOffset += w.phase.stepIds.length;

          return (
            <React.Fragment key={w.phase.id}>
              {/* World gate (skip for first world) */}
              {worldIdx > 0 && (
                <WorldGate
                  worldNumber={worldIdx + 1}
                  worldName={w.theme.name}
                  isUnlocked={isAccessible}
                  theme={w.theme}
                />
              )}

              {/* First world header */}
              {worldIdx === 0 && (
                <div className="flex items-center justify-center py-4">
                  <div className={`
                    flex items-center gap-2 px-4 py-2 rounded-xl
                    ${w.theme.accentBg} text-white text-sm font-bold shadow-md
                  `}>
                    <span className="w-6 h-6 flex items-center justify-center rounded-md bg-white/20 text-xs font-bold">
                      1
                    </span>
                    {w.theme.name}
                  </div>
                </div>
              )}

              {/* World content */}
              <div className={!isAccessible ? 'opacity-40 pointer-events-none' : undefined}>
                <WorldSection
                  worldIndex={worldIdx}
                  theme={w.theme}
                  stepIds={w.phase.stepIds}
                  allSteps={stepMap}
                  completedSteps={completedSteps}
                  currentStepId={currentStepId}
                  globalStepOffset={currentOffset}
                  onStepClick={onStepClick}
                />
              </div>
            </React.Fragment>
          );
        })}

        {/* Trophy at the end */}
        <div className="flex items-center justify-center py-10">
          <div className={allDone ? 'animate-pop' : 'opacity-30 grayscale'}>
            <TrophySVG />
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(WorldMap);
