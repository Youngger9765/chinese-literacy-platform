/**
 * RPGAdventureMap — A top-down 2D RPG-style adventure map for the learning path.
 *
 * Inspired by Prodigy Math Game's world map. Students are adventurers exploring
 * three themed regions. Each learning step is a landmark on the map.
 *
 * CSS-only pixel art style — ZERO image assets, ZERO external libraries.
 * Uses emoji decorations + CSS Grid + Tailwind animations.
 */
import React, { useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RPGStep {
  id: string;
  label: string;
}

export interface RPGAdventureMapProps {
  steps: RPGStep[];
  completedSteps: Set<string>;
  currentStepId: string | null;
  onStepClick: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Region definitions
// ---------------------------------------------------------------------------

interface RegionDef {
  name: string;
  emoji: string;
  bgClass: string;
  accentClass: string;
  accentBorder: string;
  accentRing: string;
  completedBg: string;
  decoEmojis: string[];
}

const REGIONS: RegionDef[] = [
  {
    name: '知識森林',
    emoji: '🌲',
    bgClass: 'from-emerald-800/20 via-emerald-700/10 to-emerald-900/20',
    accentClass: 'bg-emerald-500',
    accentBorder: 'border-emerald-500',
    accentRing: 'ring-emerald-400/60',
    completedBg: 'bg-emerald-500',
    decoEmojis: ['🌲', '🌳', '🍃', '🌿', '🍀'],
  },
  {
    name: '智慧城堡',
    emoji: '🏰',
    bgClass: 'from-amber-700/20 via-amber-600/10 to-amber-800/20',
    accentClass: 'bg-amber-500',
    accentBorder: 'border-amber-500',
    accentRing: 'ring-amber-400/60',
    completedBg: 'bg-amber-500',
    decoEmojis: ['🏰', '🗼', '⚔️', '🛡️', '👑'],
  },
  {
    name: '勇氣火山',
    emoji: '🔥',
    bgClass: 'from-red-800/20 via-orange-700/10 to-red-900/20',
    accentClass: 'bg-red-500',
    accentBorder: 'border-red-500',
    accentRing: 'ring-red-400/60',
    completedBg: 'bg-red-500',
    decoEmojis: ['🔥', '⛰️', '🌋', '💎', '✨'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split steps into 3 roughly-equal regions. */
function distributeSteps(steps: RPGStep[]): RPGStep[][] {
  const total = steps.length;
  const regionSize = Math.ceil(total / 3);
  return [
    steps.slice(0, regionSize),
    steps.slice(regionSize, regionSize * 2),
    steps.slice(regionSize * 2),
  ];
}

/** Deterministic pseudo-random from a seed string (for consistent decoration placement). */
function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = (h ^ (h >>> 16)) * 0x45d9f3b;
    h = (h ^ (h >>> 16)) * 0x45d9f3b;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Floating decorative emoji scattered in a region. */
const DecorationLayer: React.FC<{ emojis: string[]; regionIndex: number }> = React.memo(
  ({ emojis, regionIndex }) => {
    const items = useMemo(() => {
      const rng = seededRandom(`region-${regionIndex}-deco`);
      const count = 6 + Math.floor(rng() * 4);
      return Array.from({ length: count }, (_, i) => ({
        key: `deco-${regionIndex}-${i}`,
        emoji: emojis[Math.floor(rng() * emojis.length)],
        left: `${8 + rng() * 84}%`,
        top: `${5 + rng() * 80}%`,
        opacity: 0.15 + rng() * 0.2,
        size: 14 + Math.floor(rng() * 12),
        rotate: Math.floor(rng() * 40) - 20,
      }));
    }, [emojis, regionIndex]);

    return (
      <>
        {items.map((d) => (
          <span
            key={d.key}
            className="absolute pointer-events-none select-none"
            style={{
              left: d.left,
              top: d.top,
              opacity: d.opacity,
              fontSize: `${d.size}px`,
              transform: `rotate(${d.rotate}deg)`,
            }}
            aria-hidden="true"
          >
            {d.emoji}
          </span>
        ))}
      </>
    );
  },
);
DecorationLayer.displayName = 'DecorationLayer';

/** Region gate / divider banner. */
const RegionGate: React.FC<{ region: RegionDef }> = React.memo(({ region }) => (
  <div className="relative flex items-center justify-center py-2 mx-4">
    <div className="absolute inset-x-0 top-1/2 h-px bg-gray-400/30" />
    <span className="relative z-10 px-3 py-1 rounded-full bg-gray-900/70 text-xs font-bold text-white tracking-wider border border-gray-600/50 shadow-md">
      {region.emoji} {region.name} {region.emoji}
    </span>
  </div>
));
RegionGate.displayName = 'RegionGate';

/** Treasure chest milestone marker between regions. */
const TreasureChest: React.FC = React.memo(() => (
  <div className="flex justify-center py-1" aria-hidden="true">
    <span className="text-xl opacity-60" role="img" aria-label="寶箱">
      📦
    </span>
  </div>
));
TreasureChest.displayName = 'TreasureChest';

// ---------------------------------------------------------------------------
// Path segment between two landmarks
// ---------------------------------------------------------------------------

const PathSegment: React.FC<{ completed: boolean }> = React.memo(({ completed }) => (
  <div className="flex justify-center py-0.5" aria-hidden="true">
    <div
      className={`w-1 h-5 rounded-full transition-colors duration-300 ${
        completed ? 'bg-amber-400/80' : 'bg-gray-500/30'
      }`}
    />
  </div>
));
PathSegment.displayName = 'PathSegment';

// ---------------------------------------------------------------------------
// Landmark node
// ---------------------------------------------------------------------------

interface LandmarkProps {
  step: RPGStep;
  region: RegionDef;
  status: 'completed' | 'current' | 'locked';
  stepIndex: number;
  onStepClick: (id: string) => void;
}

const Landmark: React.FC<LandmarkProps> = React.memo(
  ({ step, region, status, stepIndex, onStepClick }) => {
    const isClickable = status !== 'locked';

    const handleClick = () => {
      if (isClickable) onStepClick(step.id);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onStepClick(step.id);
      }
    };

    // Alternate slight left/right offset for winding path feel
    const offsetClass = stepIndex % 2 === 0 ? '-translate-x-3' : 'translate-x-3';

    return (
      <div className={`flex flex-col items-center ${offsetClass} transition-transform`}>
        <div
          role="button"
          tabIndex={isClickable ? 0 : -1}
          aria-label={`${step.label}${status === 'completed' ? ' - 已完成' : status === 'current' ? ' - 目前' : ' - 尚未解鎖'}`}
          aria-disabled={!isClickable}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className={`
            group relative w-14 h-14 rounded-full flex items-center justify-center
            transition-all duration-300
            ${isClickable ? 'cursor-pointer' : 'cursor-default'}
            ${
              status === 'completed'
                ? `${region.completedBg} text-white shadow-lg ring-2 ${region.accentRing} hover:scale-110 hover:shadow-xl`
                : status === 'current'
                  ? `bg-white border-2 ${region.accentBorder} shadow-xl ring-2 ${region.accentRing} animate-bounce-gentle hover:scale-110`
                  : 'bg-gray-600/50 text-gray-400 border border-gray-500/30 opacity-60'
            }
          `}
          title={
            status === 'completed'
              ? `${step.label} — 已完成`
              : status === 'current'
                ? `${step.label} — 前往探索`
                : `${step.label} — 尚未解鎖`
          }
        >
          {/* Inner icon */}
          {status === 'completed' && (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {status === 'current' && <span className="text-lg">🧑‍🎓</span>}
          {status === 'locked' && <span className="text-base">🔒</span>}

          {/* Completed stars */}
          {status === 'completed' && (
            <span
              className="absolute -top-1 -right-1 text-xs"
              aria-hidden="true"
            >
              ⭐
            </span>
          )}

          {/* Tooltip on hover */}
          <div
            className="
              absolute -top-10 left-1/2 -translate-x-1/2
              px-2 py-1 rounded bg-gray-900/90 text-white text-xs whitespace-nowrap
              opacity-0 group-hover:opacity-100 pointer-events-none
              transition-opacity duration-200 z-20
            "
            role="tooltip"
          >
            {status === 'completed' ? `${step.label} ⭐` : status === 'current' ? `${step.label} — 前往探索` : step.label}
          </div>
        </div>

        {/* Step label */}
        <span
          className={`mt-1.5 text-xs font-medium text-center leading-tight max-w-[72px] ${
            status === 'locked' ? 'text-gray-500' : 'text-gray-200'
          }`}
        >
          {step.label}
        </span>
      </div>
    );
  },
);
Landmark.displayName = 'Landmark';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const RPGAdventureMap: React.FC<RPGAdventureMapProps> = ({
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
}) => {
  const regionSteps = useMemo(() => distributeSteps(steps), [steps]);

  /** Determine step status: completed > current > locked (sequential unlocking). */
  const getStatus = (stepId: string): 'completed' | 'current' | 'locked' => {
    if (completedSteps.has(stepId)) return 'completed';
    if (stepId === currentStepId) return 'current';
    // Unlock logic: a step is unlocked if all previous steps are completed
    const idx = steps.findIndex((s) => s.id === stepId);
    const allPreviousCompleted = steps.slice(0, idx).every((s) => completedSteps.has(s.id));
    if (allPreviousCompleted && !currentStepId) return 'current'; // no current = first incomplete
    return 'locked';
  };

  // Track a running index for alternating offsets across all regions
  let globalStepIndex = 0;

  return (
    <div
      className="w-full max-w-sm mx-auto overflow-y-auto overflow-x-hidden"
      style={{ maxHeight: 'calc(100vh - 120px)' }}
      role="navigation"
      aria-label="RPG 冒險地圖學習路徑"
    >
      {/* Map container with dark background */}
      <div className="relative rounded-xl bg-gray-900 border border-gray-700/50 shadow-2xl py-4 px-2">
        {/* Map title */}
        <div className="text-center mb-3">
          <h2 className="text-sm font-bold text-amber-300 tracking-widest uppercase">
            冒險地圖
          </h2>
          <p className="text-[10px] text-gray-500 mt-0.5">完成關卡，探索新領域</p>
        </div>

        {regionSteps.map((stepsInRegion, rIdx) => {
          const region = REGIONS[rIdx];
          if (!region || stepsInRegion.length === 0) return null;

          return (
            <div key={region.name} className="relative mb-2">
              {/* Region gate */}
              <RegionGate region={region} />

              {/* Region background gradient */}
              <div
                className={`relative rounded-lg bg-gradient-to-b ${region.bgClass} py-4 px-2 mx-1`}
              >
                {/* Decorative emoji layer */}
                <DecorationLayer emojis={region.decoEmojis} regionIndex={rIdx} />

                {/* Landmarks + path segments */}
                <div className="relative z-10 flex flex-col items-center gap-0">
                  {stepsInRegion.map((step, sIdx) => {
                    const currentGlobalIdx = globalStepIndex++;
                    const status = getStatus(step.id);
                    const isLast = sIdx === stepsInRegion.length - 1;
                    // Path is "completed" if current step AND previous are completed
                    const nextStep = sIdx < stepsInRegion.length - 1 ? stepsInRegion[sIdx + 1] : null;
                    const pathCompleted =
                      status === 'completed' && nextStep !== null && completedSteps.has(nextStep.id);

                    return (
                      <React.Fragment key={step.id}>
                        <Landmark
                          step={step}
                          region={region}
                          status={status}
                          stepIndex={currentGlobalIdx}
                          onStepClick={onStepClick}
                        />
                        {!isLast && <PathSegment completed={pathCompleted || status === 'completed'} />}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Treasure chest between regions */}
              {rIdx < regionSteps.length - 1 && <TreasureChest />}
            </div>
          );
        })}

        {/* Map footer */}
        <div className="text-center mt-3 pb-1">
          <p className="text-[10px] text-gray-600">
            {completedSteps.size}/{steps.length} 關卡完成
          </p>
        </div>
      </div>
    </div>
  );
};

export default RPGAdventureMap;
