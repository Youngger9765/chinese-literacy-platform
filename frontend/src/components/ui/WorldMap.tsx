/**
 * WorldMap — gamified world-map learning path with 3 themed worlds.
 *
 * Divides ACTIVE_STEPS dynamically into 3 worlds:
 *   World 1: 探索森林 (green)  — first third of steps
 *   World 2: 字詞城堡 (amber)  — middle third of steps
 *   World 3: 挑戰火山 (red)    — final third of steps
 *
 * Node states:
 *   completed — lit up with checkmark + star badge
 *   current   — bouncing animation, pulsing ring
 *   locked    — grayscale, lock icon (shown but not clickable)
 *
 * Pure Tailwind CSS + inline SVG. No external packages.
 * Touch targets: 52px diameter nodes (student spec >= 48px).
 * Respects prefers-reduced-motion for all CSS animations.
 */

import React, { useMemo } from 'react';

export interface WorldMapStep {
  id: string;
  label: string;
}

interface WorldMapProps {
  steps: WorldMapStep[];
  completedSteps: Set<string>;
  currentStepId: string | null;
  onStepClick: (id: string) => void;
}

// ---------------------------------------------------------------------------
// World theme definitions
// ---------------------------------------------------------------------------

interface WorldDef {
  name: string;
  subtitle: string;
  icon: string;
  gradientClass: string;
  completedFill: string;
  currentFill: string;
  pulseColor: string;
  pathDoneColor: string;
  bannerColor: string;
}

const WORLDS: WorldDef[] = [
  {
    name: '世界一',
    subtitle: '探索森林',
    icon: '🌲',
    gradientClass: 'from-emerald-50 to-green-100',
    completedFill: '#16a34a',
    currentFill: '#15803d',
    pulseColor: '#4ade80',
    pathDoneColor: '#22c55e',
    bannerColor: '#14532d',
  },
  {
    name: '世界二',
    subtitle: '字詞城堡',
    icon: '🏰',
    gradientClass: 'from-amber-50 to-yellow-100',
    completedFill: '#d97706',
    currentFill: '#b45309',
    pulseColor: '#fbbf24',
    pathDoneColor: '#f59e0b',
    bannerColor: '#78350f',
  },
  {
    name: '世界三',
    subtitle: '挑戰火山',
    icon: '🌋',
    gradientClass: 'from-red-50 to-orange-100',
    completedFill: '#dc2626',
    currentFill: '#b91c1c',
    pulseColor: '#f87171',
    pathDoneColor: '#ef4444',
    bannerColor: '#7f1d1d',
  },
];

// ---------------------------------------------------------------------------
// SVG layout constants
// ---------------------------------------------------------------------------

const NODE_R = 26;         // 52px diameter — exceeds 48px touch target
const NODE_R_CUR = 30;     // 60px for current step
const SVG_W = 280;
const CX = SVG_W / 2;     // horizontal center
const ROW_H = 100;         // vertical distance between nodes
const ZIGZAG = 68;         // horizontal offset for zigzag

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NodeDef extends WorldMapStep {
  x: number;
  y: number;
  localIdx: number;
  globalIdx: number;
}

function buildNodes(steps: WorldMapStep[], globalStart: number): NodeDef[] {
  return steps.map((s, i) => ({
    ...s,
    localIdx: i,
    globalIdx: globalStart + i,
    x: CX + (i % 2 === 0 ? -1 : 1) * ZIGZAG,
    y: 44 + NODE_R_CUR + i * ROW_H,
  }));
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// WorldSection — renders one themed world as SVG
// ---------------------------------------------------------------------------

interface WorldSectionProps {
  world: WorldDef;
  wi: number;
  nodes: NodeDef[];
  completedSteps: Set<string>;
  currentStepId: string | null;
  onStepClick: (id: string) => void;
}

const WorldSection: React.FC<WorldSectionProps> = ({
  world, wi, nodes, completedSteps, currentStepId, onStepClick,
}) => {
  const curIdx = nodes.findIndex((n) => n.id === currentStepId);
  const svgH = nodes.length > 0 ? nodes[nodes.length - 1].y + NODE_R_CUR + 52 : 100;
  const anim = `wm${wi}`;

  return (
    <div className={`rounded-2xl mx-2 overflow-hidden bg-gradient-to-b ${world.gradientClass}`}>
      {/* World banner header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className="text-2xl" role="img" aria-label={world.subtitle}>{world.icon}</span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide"
             style={{ color: world.bannerColor, opacity: 0.55 }}>
            {world.name}
          </p>
          <p className="text-sm font-bold leading-tight" style={{ color: world.bannerColor }}>
            {world.subtitle}
          </p>
        </div>
      </div>

      {/* Path map SVG */}
      <svg
        viewBox={`0 0 ${SVG_W} ${svgH}`}
        width="100%"
        height={svgH}
        className="block"
        aria-label={`${world.subtitle} 關卡地圖`}
      >
        <defs>
          <style>{`
            @keyframes ${anim}-bounce {
              0%, 100% { transform: translateY(0); }
              50%       { transform: translateY(-7px); }
            }
            @keyframes ${anim}-pulse {
              0%, 100% { opacity: 0.4; }
              50%       { opacity: 0; }
            }
            @keyframes ${anim}-glow {
              0%, 100% { filter: drop-shadow(0 0 3px ${world.pulseColor}80); }
              50%       { filter: drop-shadow(0 0 10px ${world.pulseColor}); }
            }
            .${anim}-bounce {
              animation: ${anim}-bounce 1.1s ease-in-out infinite;
              transform-origin: center;
              transform-box: fill-box;
            }
            .${anim}-pulse { animation: ${anim}-pulse 2s ease-in-out infinite; }
            .${anim}-glow  { animation: ${anim}-glow  2s ease-in-out infinite; }
            @media (prefers-reduced-motion: reduce) {
              .${anim}-bounce, .${anim}-pulse, .${anim}-glow { animation: none; }
            }
          `}</style>

          {/* Subtle dot overlay for completed nodes */}
          <pattern id={`${anim}-dots`} x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="0.7" fill="white" opacity="0.35" />
          </pattern>
        </defs>

        {/* Connecting path lines between nodes */}
        {nodes.map((node, i) => {
          if (i === 0) return null;
          const prev = nodes[i - 1];
          const active = completedSteps.has(prev.id) || i <= curIdx;
          return (
            <path
              key={`line-${node.id}`}
              d={curvePath(prev.x, prev.y, node.x, node.y)}
              fill="none"
              stroke={active ? world.pathDoneColor : '#d1d5db'}
              strokeWidth={active ? 4 : 2.5}
              strokeLinecap="round"
              strokeDasharray={active ? undefined : '5 4'}
              className="transition-colors duration-500"
            />
          );
        })}

        {/* Step nodes */}
        {nodes.map((node) => {
          const done = completedSteps.has(node.id);
          const cur  = node.id === currentStepId;
          const locked = !done && !cur;
          const r = cur ? NODE_R_CUR : NODE_R;

          return (
            <g
              key={node.id}
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-label={`步驟 ${node.globalIdx + 1}：${node.label}${
                done ? '（已完成）' : cur ? '（進行中）' : '（尚未解鎖）'
              }`}
              aria-disabled={locked}
              style={{ cursor: locked ? 'not-allowed' : 'pointer' }}
              onClick={() => !locked && onStepClick(node.id)}
              onKeyDown={(e) => {
                if (!locked && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onStepClick(node.id);
                }
              }}
            >
              {/* Expanding pulse ring — current only */}
              {cur && (
                <circle
                  cx={node.x} cy={node.y} r={NODE_R_CUR + 4}
                  fill="none" stroke={world.pulseColor} strokeWidth={2.5}
                  className={`${anim}-pulse`}
                />
              )}

              {/* Glow + bounce wrapper for current node */}
              <g className={cur ? `${anim}-glow` : ''}>
                <g className={cur ? `${anim}-bounce` : ''}>
                  {/* Main circle */}
                  <circle
                    cx={node.x} cy={node.y} r={r}
                    fill={done ? world.completedFill : cur ? world.currentFill : '#e5e7eb'}
                    stroke={done ? world.completedFill : cur ? world.pulseColor : '#9ca3af'}
                    strokeWidth={locked ? 1.5 : 2.5}
                    opacity={locked ? 0.45 : 1}
                    className="transition-all duration-300"
                  />

                  {/* Dot texture for completed nodes */}
                  {done && (
                    <circle cx={node.x} cy={node.y} r={r}
                      fill={`url(#${anim}-dots)`} opacity={0.9}
                    />
                  )}

                  {/* Inner icon */}
                  {done ? (
                    <path
                      d={`M ${node.x - 9} ${node.y + 1} l 6 6 l 12 -12`}
                      fill="none" stroke="white" strokeWidth={2.8}
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                  ) : locked ? (
                    <g opacity={0.45}>
                      <rect x={node.x - 7} y={node.y - 3} width={14} height={10} rx={2}
                        fill="none" stroke="#6b7280" strokeWidth={1.8} />
                      <path d={`M ${node.x - 4} ${node.y - 3} a 4 4 0 0 1 8 0`}
                        fill="none" stroke="#6b7280" strokeWidth={1.8} />
                      <circle cx={node.x} cy={node.y + 2} r={1.5} fill="#6b7280" />
                    </g>
                  ) : (
                    <text x={node.x} y={node.y + 1}
                      textAnchor="middle" dominantBaseline="central"
                      fill="white" fontSize={14} fontWeight={700}
                      className="select-none pointer-events-none"
                    >
                      {node.globalIdx + 1}
                    </text>
                  )}

                  {/* Star badge for completed nodes */}
                  {done && (
                    <text x={node.x + r - 1} y={node.y - r + 2}
                      textAnchor="middle" dominantBaseline="central" fontSize={11}
                      className="select-none pointer-events-none"
                    >
                      ⭐
                    </text>
                  )}
                </g>
              </g>

              {/* Step label below node */}
              <text
                x={node.x} y={node.y + r + 17}
                textAnchor="middle"
                fill={done ? world.completedFill : cur ? world.bannerColor : '#9ca3af'}
                fontSize={11} fontWeight={cur ? 700 : done ? 600 : 400}
                opacity={locked ? 0.45 : 1}
                className="select-none pointer-events-none"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Gate divider between worlds
// ---------------------------------------------------------------------------

const WorldGate: React.FC<{ world: WorldDef; isUnlocked: boolean }> = ({
  world, isUnlocked,
}) => (
  <div className={`flex items-center justify-center gap-2 py-2.5 px-4 mx-4 my-1 rounded-xl border-2 transition-all duration-300 ${
    isUnlocked
      ? 'border-gray-300 bg-white/70'
      : 'border-gray-200 bg-gray-50/80 opacity-55'
  }`}>
    <span className="text-xl">{world.icon}</span>
    <div className="text-center flex-1">
      <p className="text-[11px] font-bold text-gray-700">
        {world.name}：{world.subtitle}
      </p>
      <p className="text-[9px] text-gray-400 mt-0.5">
        {isUnlocked ? '大門已開啟' : '完成上一關解鎖'}
      </p>
    </div>
    <span className="text-base">{isUnlocked ? '🔓' : '🔒'}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Main WorldMap component
// ---------------------------------------------------------------------------

const WorldMap: React.FC<WorldMapProps> = ({
  steps, completedSteps, currentStepId, onStepClick,
}) => {
  /** Dynamically split steps into 3 roughly-equal worlds */
  const worldSteps = useMemo(() => {
    const n = steps.length;
    const w1 = Math.ceil(n / 3);
    const w2 = Math.ceil((n * 2) / 3);
    return [steps.slice(0, w1), steps.slice(w1, w2), steps.slice(w2)];
  }, [steps]);

  /** Global step-number start for each world */
  const worldStarts = useMemo(
    () => [0, worldSteps[0].length, worldSteps[0].length + worldSteps[1].length],
    [worldSteps],
  );

  /** A world is unlocked when the previous world is fully completed */
  const worldUnlocked = useMemo(() => {
    const w0 = worldSteps[0].every((s) => completedSteps.has(s.id));
    const w1 = worldSteps[1].every((s) => completedSteps.has(s.id));
    return [true, w0, w0 && w1];
  }, [worldSteps, completedSteps]);

  const allDone = steps.length > 0 && steps.every((s) => completedSteps.has(s.id));

  return (
    <div className="w-full space-y-0 pb-4">
      {/* Section header */}
      <div className="text-center py-3 px-4">
        <p className="text-sm font-bold text-gray-700">學習旅程地圖</p>
        <p className="text-[11px] text-gray-400 mt-0.5">完成每個關卡，解鎖下一個世界</p>
      </div>

      {worldSteps.map((wSteps, wi) => {
        if (wSteps.length === 0) return null;
        const world = WORLDS[wi];
        const nodes = buildNodes(wSteps, worldStarts[wi]);
        const unlocked = worldUnlocked[wi];

        return (
          <div key={`world-${wi}`}>
            {/* Gate divider before worlds 2 and 3 */}
            {wi > 0 && (
              <WorldGate world={world} isUnlocked={unlocked} />
            )}

            {/* World section — dimmed and non-interactive when locked */}
            <div
              className={`transition-opacity duration-300 ${
                unlocked ? 'opacity-100' : 'opacity-50 pointer-events-none'
              }`}
              aria-hidden={!unlocked}
            >
              <WorldSection
                world={world}
                wi={wi}
                nodes={nodes}
                completedSteps={completedSteps}
                currentStepId={currentStepId}
                onStepClick={onStepClick}
              />
            </div>
          </div>
        );
      })}

      {/* All-complete celebration banner */}
      {allDone && (
        <div className="text-center py-4 mx-4 mt-2 rounded-2xl bg-gradient-to-br from-amber-100 to-yellow-200 border-2 border-amber-300">
          <p className="text-2xl mb-1">🎉</p>
          <p className="text-sm font-bold text-amber-800">全部通關！</p>
          <p className="text-[11px] text-amber-600 mt-0.5">你是國語文大冒險家！</p>
        </div>
      )}
    </div>
  );
};

export default WorldMap;
