import { useEffect, useRef, useCallback, type JSX } from "react";
import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
  FederatedPointerEvent,
} from "pixi.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PixiLearningPathProps {
  steps: { id: string; label: string }[];
  completedSteps: Set<string>;
  currentStepId: string;
  onStepClick: (stepId: string) => void;
}

interface Particle {
  gfx: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  originX: number;
  originY: number;
  angle?: number; // for orbiting particles
  radius?: number;
  speed?: number;
}

interface NodePosition {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANVAS_HEIGHT = 600;
const NODE_RADIUS = 30;
const PATH_PADDING_X = 100;
const PATH_PADDING_Y = 80;

// Three color regions
const REGION_COLORS = {
  emerald: { base: 0x10b981, light: 0x34d399, dark: 0x059669 },
  amber: { base: 0xf59e0b, light: 0xfbbf24, dark: 0xd97706 },
  coral: { base: 0xef4444, light: 0xf87171, dark: 0xdc2626 },
};

function getRegionColor(index: number) {
  if (index < 3) return REGION_COLORS.emerald;
  if (index < 6) return REGION_COLORS.amber;
  return REGION_COLORS.coral;
}

// Interpolate between two hex colors
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff,
    ag = (a >> 8) & 0xff,
    ab = a & 0xff;
  const br = (b >> 16) & 0xff,
    bg = (b >> 8) & 0xff,
    bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | blue;
}

function getNodeColor(index: number, total: number): number {
  const region = getRegionColor(index);
  const nextRegion = getRegionColor(Math.min(index + 1, total - 1));
  // Smooth transition within region boundaries
  if (index === 2 || index === 5) {
    const t = 0.5;
    return lerpColor(region.base, nextRegion.base, t);
  }
  return region.base;
}

// ---------------------------------------------------------------------------
// Path layout: winding S-curve
// ---------------------------------------------------------------------------

function computeNodePositions(
  count: number,
  width: number,
  height: number
): NodePosition[] {
  const positions: NodePosition[] = [];
  const usableW = width - PATH_PADDING_X * 2;
  const usableH = height - PATH_PADDING_Y * 2;
  const rows = 4;
  const rowH = usableH / (rows - 1);

  let row = 0;
  let col = 0;
  let direction = 1; // 1 = left-to-right, -1 = right-to-left
  const nodesPerRow = Math.ceil(count / rows);

  for (let i = 0; i < count; i++) {
    const rowProgress = nodesPerRow > 1 ? col / (nodesPerRow - 1) : 0.5;
    const xNorm = direction === 1 ? rowProgress : 1 - rowProgress;
    const x = PATH_PADDING_X + xNorm * usableW;
    const y = PATH_PADDING_Y + row * rowH;
    positions.push({ x, y });

    col++;
    if (col >= nodesPerRow && i < count - 1) {
      col = 0;
      row++;
      direction *= -1;
    }
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Particle helpers
// ---------------------------------------------------------------------------

function createBurstParticle(
  container: Container,
  x: number,
  y: number,
  color: number
): Particle {
  const gfx = new Graphics();
  const size = 2 + Math.random() * 4;
  gfx.circle(0, 0, size).fill({ color, alpha: 0.9 });
  gfx.position.set(x, y);
  container.addChild(gfx);

  const angle = Math.random() * Math.PI * 2;
  const speed = 1.5 + Math.random() * 3;
  return {
    gfx,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 1,
    maxLife: 1,
    originX: x,
    originY: y,
  };
}

function createOrbitParticle(
  container: Container,
  cx: number,
  cy: number,
  color: number
): Particle {
  const gfx = new Graphics();
  gfx.star(0, 0, 4, 3, 1.5).fill({ color: 0xfde68a, alpha: 0.8 });
  container.addChild(gfx);

  const angle = Math.random() * Math.PI * 2;
  const radius = NODE_RADIUS + 8 + Math.random() * 12;
  gfx.position.set(
    cx + Math.cos(angle) * radius,
    cy + Math.sin(angle) * radius
  );

  return {
    gfx,
    vx: 0,
    vy: 0,
    life: 1,
    maxLife: 1,
    originX: cx,
    originY: cy,
    angle,
    radius,
    speed: 0.8 + Math.random() * 0.6,
    ...(void color, {}), // color used for type consistency
  };
}

function createSparkle(
  container: Container,
  x: number,
  y: number
): Particle {
  const gfx = new Graphics();
  gfx.star(0, 0, 4, 2 + Math.random() * 2, 1).fill({ color: 0xfef3c7, alpha: 0.7 });
  gfx.position.set(
    x + (Math.random() - 0.5) * NODE_RADIUS * 2,
    y + (Math.random() - 0.5) * NODE_RADIUS * 2
  );
  container.addChild(gfx);

  return {
    gfx,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -0.2 - Math.random() * 0.5,
    life: 1,
    maxLife: 1,
    originX: x,
    originY: y,
  };
}

function createFlowParticle(
  container: Container,
  x: number,
  y: number,
  color: number
): Particle {
  const gfx = new Graphics();
  gfx.circle(0, 0, 2).fill({ color, alpha: 0.6 });
  gfx.position.set(x, y);
  container.addChild(gfx);

  return {
    gfx,
    vx: 0,
    vy: 0,
    life: 1,
    maxLife: 1,
    originX: x,
    originY: y,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PixiLearningPath({
  steps,
  completedSteps,
  currentStepId,
  onStepClick,
}: PixiLearningPathProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const stepsRef = useRef(steps);
  const completedRef = useRef(completedSteps);
  const currentRef = useRef(currentStepId);
  const onClickRef = useRef(onStepClick);

  // Keep refs in sync
  stepsRef.current = steps;
  completedRef.current = completedSteps;
  currentRef.current = currentStepId;
  onClickRef.current = onStepClick;

  const destroyApp = useCallback(() => {
    if (appRef.current) {
      appRef.current.destroy(true, { children: true });
      appRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const wrapper = containerRef.current;

    let destroyed = false;
    const particles: Particle[] = [];
    const orbitParticles: Particle[] = [];
    const sparkleParticles: Particle[] = [];
    const flowParticles: Particle[] = [];

    // Tooltip element (DOM overlay for crisp text)
    const tooltip = document.createElement("div");
    tooltip.style.cssText =
      "position:absolute;pointer-events:none;background:rgba(0,0,0,0.8);color:#fff;" +
      "padding:4px 10px;border-radius:6px;font-size:13px;font-family:'Noto Sans TC',sans-serif;" +
      "white-space:nowrap;opacity:0;transition:opacity 0.15s;z-index:10;";
    wrapper.appendChild(tooltip);

    (async () => {
      const app = new Application();
      if (destroyed) return;

      await app.init({
        background: 0x0f172a,
        resizeTo: wrapper,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      appRef.current = app;
      wrapper.appendChild(app.canvas as HTMLCanvasElement);

      const width = app.screen.width;
      const height = app.screen.height;

      // ------- Background gradient layer -------
      const bgLayer = new Graphics();
      app.stage.addChild(bgLayer);

      // ------- Path layer -------
      const pathLayer = new Container();
      app.stage.addChild(pathLayer);

      // ------- Particle layer -------
      const particleLayer = new Container();
      app.stage.addChild(particleLayer);

      // ------- Node layer -------
      const nodeLayer = new Container();
      app.stage.addChild(nodeLayer);

      // ------- Compute positions -------
      const positions = computeNodePositions(steps.length, width, height);

      // ------- Draw curved path -------
      function drawPath() {
        const pathGfx = new Graphics();
        pathLayer.removeChildren();
        pathLayer.addChild(pathGfx);

        for (let i = 0; i < positions.length - 1; i++) {
          const from = positions[i];
          const to = positions[i + 1];
          const isCompleted =
            completedRef.current.has(stepsRef.current[i].id) &&
            completedRef.current.has(stepsRef.current[i + 1].id);

          const color = isCompleted ? getNodeColor(i, steps.length) : 0x334155;
          const alpha = isCompleted ? 0.8 : 0.3;

          // Bezier control points for S-curve
          const midY = (from.y + to.y) / 2;
          const cpx1 = from.x;
          const cpy1 = midY;
          const cpx2 = to.x;
          const cpy2 = midY;

          pathGfx
            .moveTo(from.x, from.y)
            .bezierCurveTo(cpx1, cpy1, cpx2, cpy2, to.x, to.y)
            .stroke({ width: 4, color, alpha });
        }
      }
      drawPath();

      // ------- Draw nodes -------
      const nodeContainers: Container[] = [];

      steps.forEach((step, i) => {
        const pos = positions[i];
        const isCompleted = completedSteps.has(step.id);
        const isCurrent = step.id === currentStepId;
        const isLocked = !isCompleted && !isCurrent;
        const color = isLocked ? 0x475569 : getNodeColor(i, steps.length);

        const nc = new Container();
        nc.position.set(pos.x, pos.y);
        nodeLayer.addChild(nc);
        nodeContainers.push(nc);

        // Shadow
        const shadow = new Graphics();
        shadow.circle(3, 3, NODE_RADIUS + 2).fill({ color: 0x000000, alpha: 0.3 });
        nc.addChild(shadow);

        // Outer glow ring (for current node animation)
        if (isCurrent) {
          const glow = new Graphics();
          glow.circle(0, 0, NODE_RADIUS + 6).fill({ color, alpha: 0.3 });
          glow.label = "glow";
          nc.addChild(glow);
        }

        // Main circle with gradient effect (dark rim → lighter center)
        const darkColor = getRegionColor(i).dark;
        const lightColor = getRegionColor(i).light;

        // Base circle
        const base = new Graphics();
        base.circle(0, 0, NODE_RADIUS).fill({
          color: isLocked ? 0x374151 : darkColor,
        });
        nc.addChild(base);

        // Inner highlight for 3D depth
        const highlight = new Graphics();
        highlight
          .circle(-4, -4, NODE_RADIUS * 0.7)
          .fill({ color: isLocked ? 0x4b5563 : lightColor, alpha: 0.4 });
        nc.addChild(highlight);

        // Step number or icon
        if (isCompleted) {
          // Checkmark
          const check = new Graphics();
          check
            .moveTo(-8, 0)
            .lineTo(-2, 7)
            .lineTo(10, -6)
            .stroke({ width: 3, color: 0xffffff, cap: "round", join: "round" });
          nc.addChild(check);
        } else if (isLocked) {
          // Lock icon
          const lock = new Graphics();
          // Lock body
          lock.roundRect(-6, -2, 12, 10, 2).fill({ color: 0x6b7280 });
          // Lock shackle
          lock
            .moveTo(-4, -2)
            .lineTo(-4, -6)
            .bezierCurveTo(-4, -10, 4, -10, 4, -6)
            .lineTo(4, -2)
            .stroke({ width: 2, color: 0x6b7280, cap: "round" });
          nc.addChild(lock);
        } else {
          // Step number
          const numText = new Text({
            text: String(i + 1),
            style: new TextStyle({
              fontFamily: "'Noto Sans TC', sans-serif",
              fontSize: 18,
              fontWeight: "bold",
              fill: 0xffffff,
            }),
          });
          numText.anchor.set(0.5);
          nc.addChild(numText);
        }

        // Interactivity
        if (!isLocked) {
          nc.eventMode = "static";
          nc.cursor = "pointer";
          nc.hitArea = { contains: (lx: number, ly: number) => lx * lx + ly * ly <= NODE_RADIUS * NODE_RADIUS };

          nc.on("pointerover", () => {
            nc.scale.set(1.12);
            tooltip.textContent = step.label;
            tooltip.style.opacity = "1";
            tooltip.style.left = `${pos.x - tooltip.offsetWidth / 2}px`;
            tooltip.style.top = `${pos.y - NODE_RADIUS - 32}px`;
          });

          nc.on("pointerout", () => {
            nc.scale.set(1);
            tooltip.style.opacity = "0";
          });

          nc.on("pointertap", (_e: FederatedPointerEvent) => {
            onClickRef.current(step.id);
            // Burst particles on click
            const burstColor = getNodeColor(i, stepsRef.current.length);
            for (let p = 0; p < 25; p++) {
              particles.push(
                createBurstParticle(particleLayer, pos.x, pos.y, burstColor)
              );
            }
          });
        }

        // Sparkle particles for completed nodes
        if (isCompleted) {
          for (let s = 0; s < 2; s++) {
            sparkleParticles.push(createSparkle(particleLayer, pos.x, pos.y));
          }
        }

        // Orbit particles for current node
        if (isCurrent) {
          for (let o = 0; o < 4; o++) {
            orbitParticles.push(
              createOrbitParticle(particleLayer, pos.x, pos.y, color)
            );
          }
        }
      });

      // ------- Flow particles along completed path -------
      function spawnFlowParticle() {
        for (let i = 0; i < positions.length - 1; i++) {
          if (
            completedRef.current.has(stepsRef.current[i].id) &&
            completedRef.current.has(stepsRef.current[i + 1].id)
          ) {
            if (Math.random() > 0.97) {
              const from = positions[i];
              const to = positions[i + 1];
              const t = Math.random();
              const x = from.x + (to.x - from.x) * t;
              const y = from.y + (to.y - from.y) * t;
              const color = getNodeColor(i, stepsRef.current.length);
              const fp = createFlowParticle(particleLayer, x, y, color);
              fp.vx = (to.x - from.x) * 0.005;
              fp.vy = (to.y - from.y) * 0.005;
              flowParticles.push(fp);
            }
          }
        }
      }

      // ------- Animation loop -------
      let elapsed = 0;

      app.ticker.add((ticker) => {
        const dt = ticker.deltaTime;
        elapsed += dt * 0.01;

        // Animated background gradient
        const bgShift = (Math.sin(elapsed * 0.5) + 1) / 2;
        const bgColor = lerpColor(0x0f172a, 0x1e1b4b, bgShift * 0.3);
        bgLayer.clear();
        bgLayer.rect(0, 0, width, height).fill({ color: bgColor });

        // Pulse glow on current node
        nodeContainers.forEach((nc, i) => {
          if (stepsRef.current[i]?.id === currentRef.current) {
            const glowChild = nc.children.find(
              (c) => c.label === "glow"
            ) as Graphics | undefined;
            if (glowChild) {
              glowChild.alpha = 0.3 + Math.sin(elapsed * 3) * 0.2;
              glowChild.scale.set(1 + Math.sin(elapsed * 2) * 0.08);
            }
          }
        });

        // Update burst particles
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.gfx.x += p.vx * dt;
          p.gfx.y += p.vy * dt;
          p.vy += 0.03 * dt; // gravity
          p.life -= 0.02 * dt;
          p.gfx.alpha = Math.max(0, p.life);
          p.gfx.scale.set(p.life);
          if (p.life <= 0) {
            particleLayer.removeChild(p.gfx);
            p.gfx.destroy();
            particles.splice(i, 1);
          }
        }

        // Update orbit particles
        for (const op of orbitParticles) {
          if (op.angle !== undefined && op.radius !== undefined && op.speed !== undefined) {
            op.angle += op.speed * 0.02 * dt;
            op.gfx.x = op.originX + Math.cos(op.angle) * op.radius;
            op.gfx.y = op.originY + Math.sin(op.angle) * op.radius;
            op.gfx.alpha = 0.5 + Math.sin(elapsed * 4 + op.angle) * 0.3;
          }
        }

        // Update sparkle particles
        for (let i = sparkleParticles.length - 1; i >= 0; i--) {
          const sp = sparkleParticles[i];
          sp.gfx.x += sp.vx * dt;
          sp.gfx.y += sp.vy * dt;
          sp.life -= 0.008 * dt;
          sp.gfx.alpha = Math.max(0, sp.life * 0.7);
          if (sp.life <= 0) {
            // Respawn
            sp.gfx.x =
              sp.originX + (Math.random() - 0.5) * NODE_RADIUS * 2;
            sp.gfx.y =
              sp.originY + (Math.random() - 0.5) * NODE_RADIUS * 2;
            sp.life = 1;
            sp.vy = -0.2 - Math.random() * 0.5;
            sp.vx = (Math.random() - 0.5) * 0.3;
            sp.gfx.alpha = 0.7;
          }
        }

        // Update flow particles
        for (let i = flowParticles.length - 1; i >= 0; i--) {
          const fp = flowParticles[i];
          fp.gfx.x += fp.vx * dt;
          fp.gfx.y += fp.vy * dt;
          fp.life -= 0.01 * dt;
          fp.gfx.alpha = Math.max(0, fp.life * 0.6);
          if (fp.life <= 0) {
            particleLayer.removeChild(fp.gfx);
            fp.gfx.destroy();
            flowParticles.splice(i, 1);
          }
        }

        // Spawn flow particles
        spawnFlowParticle();
      });
    })();

    return () => {
      destroyed = true;
      tooltip.remove();
      // Clean up particles arrays
      particles.length = 0;
      orbitParticles.length = 0;
      sparkleParticles.length = 0;
      flowParticles.length = 0;
      destroyApp();
    };
    // Intentionally depend on serializable values to rebuild canvas on data change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    steps.map((s) => s.id).join(","),
    [...completedSteps].sort().join(","),
    currentStepId,
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: `${CANVAS_HEIGHT}px`,
        position: "relative",
        borderRadius: 12,
        overflow: "hidden",
      }}
    />
  );
}
