/**
 * WorldMap — gamified world-map learning path with 3 themed worlds.
 *
 * Divides ACTIVE_STEPS dynamically into 3 worlds:
 *   World 1: 探索森林 (green, reading/intro)
 *   World 2: 字詞城堡 (amber/gold, vocab/practice)
 *   World 3: 挑戰火山 (red/orange, challenge/report)
 *
 * Node states:
 *   completed — lit up with star, bright world color
 *   current   — bouncing animation, pulsing ring
 *   locked    — grayscale, lock icon
 *
 * Pure Tailwind CSS + inline SVG. No external packages.
 * CSS keyframes defined in <style> tag inside defs.
 * Touch targets: minimum 48px (student a11y spec).
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
// World definitions
// ---------------------------------------------------------------------------

interface WorldDef {
  name: string;
  subtitle: string;
  icon: string;
  /** Tailwind gradient classes for the world background banner */
  gradientClass: string;
  /** SVG fill color for completed nodes */
  completedColor: string;
  /** SVG fill color for current node */
  currentColor: string;
  /** SVG fill for current node ring pulse */
  pulseColor: string;
  /** SVG stroke for completed path segments */
  pathCompletedColor: string;
  /** Text color for world banner (hex for SVG compat) */
  bannerTextColor: string;
  /** Background fill for world section (hex) */
  bgFill: string;
  /** Background fill for world section — lighter (hex) */
  bgFillAlt: string;
}

const WORLDS: WorldDef[] = [
  {
    name: '世界一',
    subtitle: '探索森林',
    icon: '🌲',
    gradientClass: 'from-emerald-50 to-green-100',
    completedColor: '#16a34a',   // green-600
    currentColor: '#15803d',     // green-700
    pulseColor: '#4ade80',       // green-400
    pathCompletedColor: '#22c55e', // green-500
    bannerTextColor: '#14532d',  // green-900
    bgFill: '#f0fdf4',           // green-50
    bgFillAlt: '#dcfce7',        // green-100
  },
  {
    name: '世界二',
    subtitle: '字詞城堡',
    icon: '🏰',
    gradientClass: 'from-amber-50 to-yellow-100',
    completedColor: '#d97706',   // amber-600
    currentColor: '#b45309',     // amber-700
    pulseColor: '#fbbf24',       // amber-400
    pathCompletedColor: '#f59e0b', // amber-500
    bannerTextColor: '#78350f',  // amber-900
    bgFill: '#fffbeb',           // amber-50
    bgFillAlt: '#fef3c7',        // amber-100
  },
  {
    name: '世界三',
    subtitle: '挑戰火山',
    icon: '🌋',
    gradientClass: 'from-red-50 to-orange-100',
    completedColor: '#dc2626',   // red-600
    currentColor: '#b91c1c',     // red-700
    pulseColor: '#f87171',       // red-400
    pathCompletedColor: '#ef4444', // red-500
    bannerTextColor: '#7f1d1d',  // red-900
    bgFill: '#fff7f7',
    bgFillAlt: '#fee2e2',        // red-100
  },
];

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_R = 26;          // 52px diameter — touch-friendly
const NODE_R_CURRENT = 30;  // 60px diameter — slightly larger for current
const SVG_WIDTH = 280;
const PADDING_X = 40;
const ROW_HEIGHT = 100;
const ZIGZAG_OFFSET = 70;
const CENTER_X = SVG_WIDTH / 2;

// ---------------------------------------------------------------------------
// Helper: build zigzag node positions
// ---------------------------------------------------------------------------

interface NodePos {
  id: string;
  label: string;
  x: number;
  y: number;
  index: number;
  globalIndex: number;
}

function buildNodes(steps: WorldMapStep[], startGlobalIndex: number): NodePos[] {
  return steps.map((step, i) => {
    const globalIndex = startGlobalIndex + i;
    // Zigzag: even = left side, odd = right side
    const side = i % 2 === 0 ? -1 : 1;
    const x = CENTER_X + side * ZIGZAG_OFFSET;
    const y = 48 + NODE_R_CURRENT + i * ROW_HEIGHT;
    return { ...step, x, y, index: i, globalIndex };
  });
}

/** Build curved SVG path between two points */
function curvedPath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Sub-component: Gate between worlds
// ---------------------------------------------------------------------------

const WorldGate: React.FC<{ world: WorldDef; isUnlocked: boolean }> = ({
  world,
  isUnlocked,
}) => (
  <div
    className={`flex items-center justify-center gap-3 py-3 px-4 mx-4 my-1 rounded-xl border-2 transition-all ${
      isUnlocked
        ? 'border-gray-300 bg-white/70 opacity-90'
        : 'border-gray-200 bg-gray-50/80 opacity-60'
    }`}
  >
    <span className="text-xl">{world.icon}</span>
    <div className="text-center">
      <p className="text-xs font-bold text-gray-700">
        {world.name}：{world.subtitle}
      </p>
      <p className="text-[10px] text-gray-400 mt-0.5">
        {isUnlocked ? '大門已開啟' : '完成上一關解鎖'}
      </p>
    </div>
    <span className="text-lg">{isUnlocked ? '🔓' : '🔒'}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Sub-component: Single world SVG section
// ---------------------------------------------------------------------------

const WorldSection: React.FC<{
  world: WorldDef;
  nodes: NodePos[];
  completedSteps: Set<string>;
  currentStepId: string | null;
  onStepClick: (id: string) => void;
  worldIndex: number;
}> = ({ world, nodes, completedSteps, currentStepId, onStepClick, worldIndex }) => {
  const svgHeight =
    nodes.length > 0
      ? nodes[nodes.length - 1].y + NODE_R_CURRENT + 56
      : 120;

  const currentNodeIndex = nodes.findIndex((n) => n.id === currentStepId);

  return (
    <div className={`rounded-2xl mx-2 mb-1 overflow-hidden bg-gradient-to-b ${world.gradientClass}`}>
      {/* World banner header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className="text-2xl" role="img" aria-label={world.subtitle}>
          {world.icon}
        </span>
        <div>
          <p className="text-[11px] font-semibold" style={{ color: world.bannerTextColor, opacity: 0.6 }}>
            {world.name}
          </p>
          <p className="text-sm font-bold leading-tight" style={{ color: world.bannerTextColor }}>
            {world.subtitle}
          </p>
        </div>
      </div>

      {/* SVG nodes */}
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`}
        width="100%"
        height={svgHeight}
        className="block"
        aria-label={`${world.subtitle} 關卡地圖`}
        role="img"
      >
        <defs>
          <style>{`
            @keyframes wm-bounce-${worldIndex} {
              0%, 100% { transform: translateY(0); }
              50% { transform: translateY(-6px); }
            }
            @keyframes wm-pulse-${worldIndex} {
              0%, 100% { opacity: 0.35; r: ${NODE_R_CURRENT}px; }
              50% { opacity: 0; r: ${NODE_R_CURRENT + 10}px; }
            }
            @keyframes wm-glow-${worldIndex} {
              0%, 100% { filter: drop-shadow(0 0 4px ${world.pulseColor}88); }
              50% { filter: drop-shadow(0 0 12px ${world.pulseColor}); }
            }
            .wm-bounce-${worldIndex} {
              animation: wm-bounce-${worldIndex} 1.2s ease-in-out infinite;
              transform-origin: center;
              transform-box: fill-box;
            }
            .wm-pulse-ring-${worldIndex} {
              animation: wm-pulse-${worldIndex} 2s ease-in-out infinite;
            }
            .wm-glow-${worldIndex} {
              animation: wm-glow-${worldIndex} 2s ease-in-out infinite;
            }
            @media (prefers-reduced-motion: reduce) {
              .wm-bounce-${worldIndex},
              .wm-pulse-ring-${worldIndex},
              .wm-glow-${worldIndex} {
                animation: none;
              }
            }
          `}</style>

          {/* Star pattern for completed nodes */}
          <pattern
            id={`stars-${worldIndex}`}
            x="0"
            y="0"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="4" cy="4" r="0.8" fill="white" opacity="0.4" />
          </pattern>
        </defs>

        {/* Background decorative horizontal band */}
        <rect x="0" y="0" width={SVG_WIDTH} height={svgHeight} fill={world.bgFill} fillOpacity="0" />

        {/* Connecting path lines */}
        {nodes.map((node, i) => {
          if (i === 0) return null;
          const prev = nodes[i - 1];
          const pathD = curvedPath(prev.x, prev.y, node.x, node.y);

          // Segment is completed if previous node is done
          const segmentDone = completedSteps.has(prev.id);
          // Segment is "active" if previous is current or done
          const segmentActive =
            segmentDone ||
            prev.id === currentStepId ||
            i <= currentNodeIndex;

          return (
            <path
              key={`line-${node.id}`}
              d={pathD}
              fill="none"
              stroke={segmentActive ? world.pathCompletedColor : '#d1d5db'}
              strokeWidth={segmentActive ? 4 : 3}
              strokeLinecap="round"
              strokeDasharray={segmentActive ? undefined : '6 4'}
              className="transition-colors duration-500"
            />
          );
        })}

        {/* Step nodes */}
        {nodes.map((node) => {
          const isCompleted = completedSteps.has(node.id);
          const isCurrent = node.id === currentStepId;
          const isLocked = !isCompleted && !isCurrent;
          const r = isCurrent ? NODE_R_CURRENT : NODE_R;

          const nodeFill = isCompleted
            ? world.completedColor
            : isCurrent
              ? world.currentColor
              : '#e5e7eb'; // gray-200

          const nodeStroke = isCompleted
            ? world.completedColor
            : isCurrent
              ? world.pulseColor
              : '#9ca3af'; // gray-400

          return (
            <g
              key={node.id}
              onClick={() => !isLocked && onStepClick(node.id)}
              role="button"
              tabIndex={0}
              aria-label={`步驟 ${node.globalIndex + 1}：${node.label} — ${
                isCompleted ? '已完成' : isCurrent ? '進行中' : '尚未解鎖'
              }`}
              aria-disabled={isLocked}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !isLocked) {
                  e.preventDefault();
                  onStepClick(node.id);
                }
              }}
              style={{ cursor: isLocked ? 'not-allowed' : 'pointer' }}
            >
              {/* Pulse ring for current node */}
              {isCurrent && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={NODE_R_CURRENT}
                  fill="none"
                  stroke={world.pulseColor}
                  strokeWidth={3}
                  className={`wm-pulse-ring-${worldIndex}`}
                />
              )}

              {/* Glow group for current node */}
              <g className={isCurrent ? `wm-glow-${worldIndex}` : ''}>
                {/* Bounce group for current node */}
                <g className={isCurrent ? `wm-bounce-${worldIndex}` : ''}>
                  {/* Main circle */}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r}
                    fill={nodeFill}
                    stroke={nodeStroke}
                    strokeWidth={isLocked ? 2 : 3}
                    opacity={isLocked ? 0.5 : 1}
                    className="transition-all duration-300"
                  />

                  {/* Overlay star pattern for completed */}
                  {isCompleted && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={r}
                      fill={`url(#stars-${worldIndex})`}
                      opacity={0.8}
                    />
                  )}

                  {/* Inner content */}
                  {isCompleted ? (
                    /* Checkmark */
                    <path
                      d={`M ${node.x - 9} ${node.y + 1} l 6 6 l 12 -12`}
                      fill="none"
                      stroke="white"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : isLocked ? (
                    /* Lock icon */
                    <g opacity={0.5}>
                      <rect
                        x={node.x - 7}
                        y={node.y - 3}
                        width={14}
                        height={11}
                        rx={2}
                        fill="none"
                        stroke="#9ca3af"
                        strokeWidth={2}
                      />
                      <path
                        d={`M ${node.x - 4} ${node.y - 3} a 4 4 0 0 1 8 0`}
                        fill="none"
                        stroke="#9ca3af"
                        strokeWidth={2}
                      />
                      <circle cx={node.x} cy={node.y + 3} r={1.5} fill="#9ca3af" />
                    </g>
                  ) : (
                    /* Step number for current */
                    <text
                      x={node.x}
                      y={node.y + 1}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="white"
                      fontSize={14}
                      fontWeight={700}
                      className="select-none pointer-events-none"
                    >
                      {node.globalIndex + 1}
                    </text>
                  )}

                  {/* 3-star badge for completed nodes */}
                  {isCompleted && (
                    <text
                      x={node.x + r - 2}
                      y={node.y - r + 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={12}
                      className="select-none pointer-events-none"
                    >
                      ⭐
                    </text>
                  )}
                </g>
              </g>

              {/* Step label below node */}
              <text
                x={node.x}
                y={node.y + r + 18}
                textAnchor="middle"
                fill={
                  isCompleted
                    ? world.completedColor
                    : isCurrent
                      ? world.bannerTextColor
                      : '#9ca3af'
                }
                fontSize={11}
                fontWeight={isCurrent ? 700 : isCompleted ? 600 : 400}
                opacity={isLocked ? 0.5 : 1}
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
// Main component
// ---------------------------------------------------------------------------

const WorldMap: React.FC<WorldMapProps> = ({
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
}) => {
  /**
   * Dynamically partition steps into 3 worlds.
   * World 1: first third, World 2: middle third, World 3: last third.
   * Handles any step count gracefully.
   */
  const worlds = useMemo(() => {
    const total = steps.length;
    const w1End = Math.ceil(total / 3);
    const w2End = Math.ceil((total * 2) / 3);
    return [
      steps.slice(0, w1End),
      steps.slice(w1End, w2End),
      steps.slice(w2End),
    ];
  }, [steps]);

  /**
   * A world is "unlocked" if all steps in the PREVIOUS world are completed,
   * or if it's the first world.
   */
  const worldUnlocked = useMemo(() => {
    const w1Done = worlds[0].every((s) => completedSteps.has(s.id));
    const w2Done = worlds[1].every((s) => completedSteps.has(s.id));
    return [true, w1Done, w1Done && w2Done];
  }, [worlds, completedSteps]);

  /** Global start index per world for sequential step numbering */
  const worldStartIndices = useMemo(() => {
    return [0, worlds[0].length, worlds[0].length + worlds[1].length];
  }, [worlds]);

  return (
    <div className="w-full space-y-0 pb-4">
      {/* Title */}
      <div className="text-center py-3 px-4">
        <p className="text-sm font-bold text-gray-700">學習旅程地圖</p>
        <p className="text-xs text-gray-400 mt-0.5">完成每個關卡，解鎖下一個世界</p>
      </div>

      {worlds.map((worldSteps, wi) => {
        if (worldSteps.length === 0) return null;
        const world = WORLDS[wi];
        const nodes = buildNodes(worldSteps, worldStartIndices[wi]);
        const isUnlocked = worldUnlocked[wi];

        return (
          <div key={`world-${wi}`}>
            {/* Gate separator before worlds 2 and 3 */}
            {wi > 0 && (
              <WorldGate world={world} isUnlocked={isUnlocked} />
            )}

            {/* World section — dimmed if locked */}
            <div
              className={`transition-opacity duration-300 ${
                isUnlocked ? 'opacity-100' : 'opacity-50 pointer-events-none'
              }`}
              aria-hidden={!isUnlocked}
            >
              <WorldSection
                world={world}
                nodes={nodes}
                completedSteps={completedSteps}
                currentStepId={currentStepId}
                onStepClick={onStepClick}
                worldIndex={wi}
              />
            </div>
          </div>
        );
      })}

      {/* Completion celebration */}
      {steps.length > 0 && steps.every((s) => completedSteps.has(s.id)) && (
        <div className="text-center py-4 mx-4 mt-2 rounded-2xl bg-gradient-to-br from-amber-100 to-yellow-200 border-2 border-amber-300">
          <p className="text-2xl mb-1">🎉</p>
          <p className="text-sm font-bold text-amber-800">全部通關！</p>
          <p className="text-xs text-amber-600 mt-0.5">你是國語文大冒險家！</p>
        </div>
      )}
    </div>
  );
};

export default WorldMap;
