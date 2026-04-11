/**
 * IsometricTown — CSS-only isometric 3D town view for learning path.
 *
 * Each building represents a learning step. Three themed districts:
 * - 探索森林區 (steps 1-3): green tint + CSS trees
 * - 字詞城堡區 (steps 4-6): amber tint + flag decorations
 * - 挑戰火山區 (steps 7-10): red/orange tint + flame animations
 *
 * Pure CSS transforms, no canvas/WebGL/external libs.
 */
import { useMemo } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface IsometricTownProps {
  steps: { id: string; label: string }[];
  completedSteps: Set<string>;
  currentStepId: string;
  onStepClick: (stepId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  District theming                                                   */
/* ------------------------------------------------------------------ */

interface DistrictTheme {
  name: string;
  wallColor: string;
  wallSide: string;
  roofColor: string;
  roofCompleted: string;
  glowColor: string;
}

const DISTRICTS: DistrictTheme[] = [
  {
    name: '探索森林區',
    wallColor: '#b6d7a8',
    wallSide: '#93c47d',
    roofColor: '#38761d',
    roofCompleted: '#27ae60',
    glowColor: 'rgba(39,174,96,0.4)',
  },
  {
    name: '字詞城堡區',
    wallColor: '#f9e4a7',
    wallSide: '#e8c96d',
    roofColor: '#bf8f00',
    roofCompleted: '#f39c12',
    glowColor: 'rgba(243,156,18,0.4)',
  },
  {
    name: '挑戰火山區',
    wallColor: '#f4cccc',
    wallSide: '#e6a1a1',
    roofColor: '#cc0000',
    roofCompleted: '#e74c3c',
    glowColor: 'rgba(231,76,60,0.4)',
  },
];

/* ------------------------------------------------------------------ */
/*  Layout: building positions on the isometric grid                   */
/* ------------------------------------------------------------------ */

interface BuildingLayout {
  x: number;
  y: number;
  height: number; // building height multiplier
}

/**
 * 2-row winding street layout. Coordinates are in grid units (1 unit = 110px).
 * Heights vary to give visual interest.
 */
const BUILDING_LAYOUTS: BuildingLayout[] = [
  // Row 1 (top) — steps 1-5
  { x: 0, y: 0, height: 1.0 },
  { x: 1.2, y: 0, height: 1.3 },
  { x: 2.4, y: 0, height: 1.1 },
  { x: 3.6, y: 0, height: 1.4 },
  { x: 4.8, y: 0, height: 1.2 },
  // Row 2 (bottom) — steps 6-10
  { x: 0.3, y: 1.3, height: 1.5 },
  { x: 1.5, y: 1.3, height: 1.1 },
  { x: 2.7, y: 1.3, height: 1.6 },
  { x: 3.9, y: 1.3, height: 1.2 },
  { x: 5.1, y: 1.3, height: 1.0 },
];

/* ------------------------------------------------------------------ */
/*  CSS keyframes (injected once)                                      */
/* ------------------------------------------------------------------ */

const KEYFRAMES = `
@keyframes iso-bounce {
  0%, 100% { transform: translateZ(0px); }
  50% { transform: translateZ(14px); }
}
@keyframes iso-glow-pulse {
  0%, 100% { box-shadow: 0 0 8px 2px var(--glow-color); }
  50% { box-shadow: 0 0 18px 6px var(--glow-color); }
}
@keyframes iso-cloud-drift {
  0% { transform: translateX(-120px) translateY(0); opacity: 0.15; }
  20% { opacity: 0.25; }
  80% { opacity: 0.25; }
  100% { transform: translateX(700px) translateY(40px); opacity: 0.1; }
}
@keyframes iso-flame {
  0%, 100% { transform: scaleY(1) translateY(0); opacity: 0.8; }
  25% { transform: scaleY(1.3) translateY(-2px); opacity: 1; }
  50% { transform: scaleY(0.9) translateY(1px); opacity: 0.7; }
  75% { transform: scaleY(1.2) translateY(-1px); opacity: 0.9; }
}
@keyframes iso-flag-wave {
  0%, 100% { transform: skewY(0deg); }
  50% { transform: skewY(5deg); }
}
`;

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function CssTree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `scale(${scale})`,
        transformOrigin: 'bottom center',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      {/* Trunk */}
      <div
        style={{
          width: 6,
          height: 14,
          background: '#8B5E3C',
          margin: '0 auto',
          borderRadius: 1,
        }}
      />
      {/* Canopy layers */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '14px solid transparent',
          borderRight: '14px solid transparent',
          borderBottom: '20px solid #2d8a4e',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 18,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '11px solid transparent',
          borderRight: '11px solid transparent',
          borderBottom: '16px solid #34a853',
        }}
      />
    </div>
  );
}

function StreetLamp({ x, y }: { x: number; y: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      {/* Pole */}
      <div style={{ width: 3, height: 22, background: '#555', margin: '0 auto', borderRadius: 1 }} />
      {/* Lamp */}
      <div
        style={{
          position: 'absolute',
          top: -4,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#fde68a',
          boxShadow: '0 0 8px 3px rgba(253,230,138,0.6)',
        }}
      />
    </div>
  );
}

function CloudShadow({ delay, top }: { delay: number; top: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: 0,
        width: 100,
        height: 40,
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.06)',
        animation: `iso-cloud-drift ${18 + delay * 3}s linear ${delay}s infinite`,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}

function FlameDeco({ x, y }: { x: number; y: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <div
        style={{
          width: 8,
          height: 14,
          borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
          background: 'linear-gradient(to top, #f97316, #fbbf24, #fde68a)',
          animation: 'iso-flame 0.8s ease-in-out infinite',
        }}
      />
    </div>
  );
}

function FlagDeco({ x, y }: { x: number; y: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {/* Pole */}
      <div style={{ width: 2, height: 20, background: '#666' }} />
      {/* Flag */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 2,
          width: 0,
          height: 0,
          borderTop: '6px solid transparent',
          borderBottom: '6px solid transparent',
          borderLeft: '10px solid #e74c3c',
          animation: 'iso-flag-wave 2s ease-in-out infinite',
          transformOrigin: 'left center',
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Building component                                                 */
/* ------------------------------------------------------------------ */

interface BuildingProps {
  step: { id: string; label: string };
  stepIndex: number;
  layout: BuildingLayout;
  district: DistrictTheme;
  state: 'completed' | 'current' | 'locked';
  onClick: () => void;
}

const BUILDING_SIZE = 80;
const GRID_UNIT = 120;

function Building({ step, stepIndex, layout, district, state, onClick }: BuildingProps) {
  const wallH = Math.round(50 * layout.height);
  const isLocked = state === 'locked';
  const isCurrent = state === 'current';
  const isCompleted = state === 'completed';

  const wallFront = isLocked ? '#bbb' : district.wallColor;
  const wallSide = isLocked ? '#a0a0a0' : district.wallSide;
  const roofColor = isLocked ? '#999' : isCompleted ? district.roofCompleted : district.roofColor;

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    left: layout.x * GRID_UNIT,
    top: layout.y * GRID_UNIT,
    width: BUILDING_SIZE,
    height: BUILDING_SIZE,
    transformStyle: 'preserve-3d',
    transition: 'transform 0.3s ease, filter 0.3s ease',
    cursor: isLocked ? 'not-allowed' : 'pointer',
    opacity: isLocked ? 0.55 : 1,
    filter: isLocked ? 'grayscale(0.8)' : 'none',
    animation: isCurrent ? 'iso-bounce 1.5s ease-in-out infinite' : 'none',
    zIndex: 10 - stepIndex,
    // @ts-expect-error -- CSS custom property for glow animation
    '--glow-color': district.glowColor,
  };

  const handleClick = () => {
    if (!isLocked) onClick();
  };

  return (
    <div
      className={!isLocked ? 'iso-building-interactive' : undefined}
      style={containerStyle}
      onClick={handleClick}
      role="button"
      tabIndex={isLocked ? -1 : 0}
      aria-label={`${step.label}${isLocked ? ' (未解鎖)' : isCompleted ? ' (已完成)' : isCurrent ? ' (目前)' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {/* Top face (roof) */}
      <div
        style={{
          position: 'absolute',
          width: BUILDING_SIZE,
          height: BUILDING_SIZE,
          background: roofColor,
          transform: `translateZ(${wallH}px)`,
          borderRadius: 2,
          boxShadow:
            isCompleted && !isLocked
              ? `0 0 12px 3px ${district.glowColor}`
              : 'none',
          animation:
            isCompleted && !isLocked
              ? 'iso-glow-pulse 2s ease-in-out infinite'
              : 'none',
        }}
      >
        {/* Step number on roof */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            fontWeight: 800,
            color: 'rgba(255,255,255,0.85)',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            userSelect: 'none',
          }}
        >
          {isCurrent ? '⭐' : stepIndex + 1}
        </div>
      </div>

      {/* Front face */}
      <div
        style={{
          position: 'absolute',
          width: BUILDING_SIZE,
          height: wallH,
          bottom: 0,
          background: wallFront,
          transform: `rotateX(-90deg) translateZ(${BUILDING_SIZE / 2}px)`,
          transformOrigin: 'bottom',
          borderRadius: '0 0 2px 2px',
        }}
      >
        {/* Step number on front */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            fontSize: 18,
            fontWeight: 700,
            color: isLocked ? '#888' : 'rgba(0,0,0,0.25)',
            userSelect: 'none',
          }}
        >
          {stepIndex + 1}
        </div>
      </div>

      {/* Right side face */}
      <div
        style={{
          position: 'absolute',
          width: wallH,
          height: BUILDING_SIZE,
          right: 0,
          background: wallSide,
          transform: `rotateY(90deg) translateZ(${BUILDING_SIZE / 2}px)`,
          transformOrigin: 'right',
          borderRadius: '2px 0 0 2px',
        }}
      />

      {/* Label floating above */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '100%',
          transform: `translateX(-50%) translateZ(${wallH + 14}px) rotateZ(45deg) rotateX(-60deg)`,
          whiteSpace: 'nowrap',
          fontSize: 11,
          fontWeight: 600,
          color: isLocked ? '#999' : '#333',
          background: isLocked ? 'rgba(200,200,200,0.85)' : 'rgba(255,255,255,0.92)',
          padding: '2px 8px',
          borderRadius: 6,
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {step.label}
      </div>

      {/* Shadow on ground */}
      <div
        style={{
          position: 'absolute',
          width: BUILDING_SIZE + 10,
          height: BUILDING_SIZE + 10,
          left: -5,
          top: -5,
          background: 'rgba(0,0,0,0.1)',
          borderRadius: 4,
          transform: 'translateZ(-1px)',
          transition: 'transform 0.3s, opacity 0.3s',
          zIndex: -1,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function IsometricTown({
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
}: IsometricTownProps) {
  // Clamp to 10 buildings max
  const visibleSteps = useMemo(() => steps.slice(0, 10), [steps]);

  const getState = (stepId: string): 'completed' | 'current' | 'locked' => {
    if (completedSteps.has(stepId)) return 'completed';
    if (stepId === currentStepId) return 'current';
    return 'locked';
  };

  const getDistrict = (index: number): DistrictTheme => {
    if (index < 3) return DISTRICTS[0]; // 探索森林區
    if (index < 6) return DISTRICTS[1]; // 字詞城堡區
    return DISTRICTS[2]; // 挑戰火山區
  };

  // Total grid size for centering
  const gridW = 6.2 * GRID_UNIT;
  const gridH = 2.6 * GRID_UNIT;

  return (
    <>
      {/* Inject keyframes */}
      <style>{KEYFRAMES}{`
        .iso-building-interactive:hover {
          transform: translateZ(10px) !important;
          filter: brightness(1.08) !important;
        }
      `}</style>

      <div className="relative w-full overflow-hidden" style={{ minHeight: 420 }}>
        {/* Isometric container */}
        <div
          style={{
            position: 'relative',
            width: gridW,
            height: gridH,
            margin: '80px auto 60px',
            transform: 'rotateX(60deg) rotateZ(-45deg)',
            transformStyle: 'preserve-3d',
            transformOrigin: 'center center',
          }}
        >
          {/* Ground plane */}
          <div
            style={{
              position: 'absolute',
              inset: -40,
              background:
                'repeating-conic-gradient(rgba(0,0,0,0.03) 0% 25%, transparent 0% 50%) 0 0 / 40px 40px',
              backgroundColor: '#e8e4d4',
              borderRadius: 12,
              transform: 'translateZ(-2px)',
              zIndex: 0,
            }}
          />

          {/* Road strips — horizontal paths */}
          <div
            style={{
              position: 'absolute',
              left: -20,
              top: GRID_UNIT * 0.85,
              width: gridW + 40,
              height: 50,
              background: '#d4cfc0',
              borderRadius: 6,
              transform: 'translateZ(-1px)',
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: -20,
              top: GRID_UNIT * 2.15,
              width: gridW + 40,
              height: 50,
              background: '#d4cfc0',
              borderRadius: 6,
              transform: 'translateZ(-1px)',
              zIndex: 0,
            }}
          />

          {/* District labels */}
          {DISTRICTS.map((d, i) => {
            const xStart = i === 0 ? 0 : i === 1 ? 3 : 6;
            return (
              <div
                key={d.name}
                style={{
                  position: 'absolute',
                  left: xStart * GRID_UNIT * 0.6 - 10,
                  top: -30,
                  fontSize: 10,
                  fontWeight: 700,
                  color: d.roofColor,
                  opacity: 0.7,
                  whiteSpace: 'nowrap',
                  letterSpacing: 2,
                  pointerEvents: 'none',
                  userSelect: 'none',
                  transform: 'rotateZ(45deg) rotateX(-60deg) translateZ(20px)',
                }}
              >
                {d.name}
              </div>
            );
          })}

          {/* Decorative trees (forest district) */}
          <CssTree x={-20} y={-15} scale={0.9} />
          <CssTree x={95} y={-25} scale={0.7} />
          <CssTree x={210} y={-10} scale={1.0} />
          <CssTree x={280} y={140} scale={0.6} />

          {/* Street lamps */}
          <StreetLamp x={55} y={95} />
          <StreetLamp x={175} y={95} />
          <StreetLamp x={295} y={95} />
          <StreetLamp x={415} y={95} />
          <StreetLamp x={535} y={95} />

          {/* Flags (castle district) */}
          <FlagDeco x={370} y={-20} />
          <FlagDeco x={490} y={-15} />
          <FlagDeco x={440} y={140} />

          {/* Flames (volcano district) */}
          <FlameDeco x={620} y={-10} />
          <FlameDeco x={680} y={10} />
          <FlameDeco x={640} y={150} />
          <FlameDeco x={710} y={160} />

          {/* Cloud shadows */}
          <CloudShadow delay={0} top={30} />
          <CloudShadow delay={6} top={160} />
          <CloudShadow delay={12} top={90} />

          {/* Buildings */}
          {visibleSteps.map((step, i) => {
            const layout = BUILDING_LAYOUTS[i] ?? { x: i * 1.2, y: 0, height: 1 };
            return (
              <Building
                key={step.id}
                step={step}
                stepIndex={i}
                layout={layout}
                district={getDistrict(i)}
                state={getState(step.id)}
                onClick={() => onStepClick(step.id)}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
