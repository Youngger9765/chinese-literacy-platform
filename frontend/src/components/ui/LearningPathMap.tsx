/**
 * LearningPathMap -- Duolingo-style winding path showing learning step progress.
 *
 * Renders a vertical snake-like path where nodes zigzag left-right.
 * Completed nodes are green with a checkmark, current node pulses with
 * primary accent color, future nodes are gray and semi-transparent.
 *
 * Props receive step data from ACTIVE_STEPS (stepConfig.ts) -- never hardcoded.
 * If steps grow from 10 to 12 (or shrink), the layout adapts automatically.
 */

import React, { useMemo } from 'react';
import type { StepCategory } from '../../config/stepConfig';
import { STEP_CATEGORY_COLORS } from '../../config/stepConfig';

export interface PathStep {
  id: string;
  label: string;
  category?: StepCategory;
}

interface LearningPathMapProps {
  steps: PathStep[];
  completedSteps: Set<string>;
  currentStepId: string;
  onStepClick: (id: string) => void;
}

// -- Layout constants --------------------------------------------------------

/** Regular node radius (px). Diameter = 48px. */
const NODE_R = 24;
/** Current-step node radius (px). Diameter = 56px. */
const NODE_R_CURRENT = 28;
/** Horizontal padding on each side. */
const PADDING_X = 52;
/** Vertical padding at top and bottom. */
const PADDING_Y = 40;
/** Vertical distance between node centers. */
const ROW_HEIGHT = 100;
/** How far each node shifts left or right from the center axis. */
const ZIGZAG_OFFSET = 68;

type NodeStatus = 'completed' | 'current' | 'future';

function getNodeStatus(
  stepId: string,
  completedSteps: Set<string>,
  currentStepId: string,
): NodeStatus {
  if (completedSteps.has(stepId)) return 'completed';
  if (stepId === currentStepId) return 'current';
  return 'future';
}

/** Resolve the fill hex for a category badge dot. */
function categoryDotFill(badge: string): string {
  if (badge.includes('orange')) return '#f97316';
  if (badge.includes('emerald')) return '#10b981';
  if (badge.includes('blue')) return '#3b82f6';
  return '#5b4fc4'; // default: primary accent
}

/** SVG cubic bezier between two zigzag nodes. */
function curvedPath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

// -- Main component ----------------------------------------------------------

const LearningPathMap: React.FC<LearningPathMapProps> = ({
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
}) => {
  const centerX = PADDING_X + ZIGZAG_OFFSET + NODE_R_CURRENT;

  const nodes = useMemo(() => {
    return steps.map((step, i) => {
      // Even index -> left of center; odd index -> right of center.
      const side = i % 2 === 0 ? -1 : 1;
      const x = centerX + side * ZIGZAG_OFFSET;
      const y = PADDING_Y + NODE_R_CURRENT + i * ROW_HEIGHT;
      return { ...step, x, y, index: i };
    });
  }, [steps, centerX]);

  const svgWidth = PADDING_X * 2 + ZIGZAG_OFFSET * 2 + NODE_R_CURRENT * 2;
  const svgHeight =
    nodes.length > 0
      ? nodes[nodes.length - 1].y + NODE_R_CURRENT + PADDING_Y + 24 // label space
      : 200;

  const currentIndex = nodes.findIndex((n) => n.id === currentStepId);

  return (
    <div className="w-full flex justify-center select-none">
      <div className="w-full max-w-[400px]">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          width="100%"
          height={svgHeight}
          className="block overflow-visible"
          aria-label="Learning path map"
          role="img"
        >
          <defs>
            <style>{`
              @keyframes lpm-pulse {
                0%, 100% { r: ${NODE_R_CURRENT}px; opacity: 0.35; }
                50%       { r: ${NODE_R_CURRENT + 10}px; opacity: 0; }
              }
              .lpm-pulse-ring {
                animation: lpm-pulse 2s ease-in-out infinite;
                transform-box: fill-box;
                transform-origin: center;
              }
            `}</style>
          </defs>

          {/* Connector lines */}
          {nodes.map((node, i) => {
            if (i === 0) return null;
            const prev = nodes[i - 1];
            const pathD = curvedPath(prev.x, prev.y, node.x, node.y);

            // Segment is green when it connects two completed/current nodes.
            const segmentDone =
              i <= currentIndex ||
              (completedSteps.has(prev.id) && completedSteps.has(node.id));

            return (
              <path
                key={`line-${node.id}`}
                d={pathD}
                fill="none"
                stroke={segmentDone ? '#10b981' : '#d1d5db'}
                strokeWidth={segmentDone ? 4 : 3}
                strokeLinecap="round"
                className="transition-colors duration-500"
              />
            );
          })}

          {/* Step nodes */}
          {nodes.map((node) => {
            const status = getNodeStatus(node.id, completedSteps, currentStepId);
            const r = status === 'current' ? NODE_R_CURRENT : NODE_R;
            const categoryColor = node.category
              ? STEP_CATEGORY_COLORS[node.category]
              : null;

            const circleFill =
              status === 'completed'
                ? '#10b981'
                : status === 'current'
                  ? '#5b4fc4'
                  : '#e5e7eb';

            const circleStroke =
              status === 'completed'
                ? '#059669'
                : status === 'current'
                  ? '#4a3fa3'
                  : '#d1d5db';

            return (
              <g
                key={node.id}
                className="cursor-pointer"
                onClick={() => onStepClick(node.id)}
                role="button"
                tabIndex={0}
                aria-label={`${node.label} -- ${
                  status === 'completed'
                    ? '已完成'
                    : status === 'current'
                      ? '進行中'
                      : '尚未開始'
                }`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onStepClick(node.id);
                  }
                }}
              >
                {/* Pulse ring -- current node only */}
                {status === 'current' && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={NODE_R_CURRENT}
                    fill="none"
                    stroke="#5b4fc4"
                    strokeWidth={3}
                    className="lpm-pulse-ring"
                  />
                )}

                {/* Main circle */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  fill={circleFill}
                  stroke={circleStroke}
                  strokeWidth={3}
                  opacity={status === 'future' ? 0.55 : 1}
                  className="transition-all duration-300"
                />

                {/* Checkmark for completed; step number otherwise */}
                {status === 'completed' ? (
                  <path
                    d={`M ${node.x - 8} ${node.y} l 5 5 l 10 -10`}
                    fill="none"
                    stroke="white"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="pointer-events-none"
                  />
                ) : (
                  <text
                    x={node.x}
                    y={node.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={status === 'current' ? 'white' : '#9ca3af'}
                    fontSize={status === 'current' ? 14 : 13}
                    fontWeight={600}
                    className="pointer-events-none"
                  >
                    {node.index + 1}
                  </text>
                )}

                {/* Category dot -- top-right corner of the node */}
                {categoryColor && status !== 'completed' && (
                  <circle
                    cx={node.x + r - 4}
                    cy={node.y - r + 4}
                    r={5}
                    fill={categoryDotFill(categoryColor.badge)}
                    stroke="white"
                    strokeWidth={1.5}
                    opacity={status === 'future' ? 0.45 : 1}
                    className="pointer-events-none"
                  />
                )}

                {/* Step label below the node */}
                <text
                  x={node.x}
                  y={node.y + r + 18}
                  textAnchor="middle"
                  fill={
                    status === 'completed'
                      ? '#059669'
                      : status === 'current'
                        ? '#374151'
                        : '#9ca3af'
                  }
                  fontSize={12}
                  fontWeight={status === 'current' ? 600 : 400}
                  opacity={status === 'future' ? 0.65 : 1}
                  className="pointer-events-none"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default LearningPathMap;
