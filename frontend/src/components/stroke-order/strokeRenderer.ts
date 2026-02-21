import { CharacterStrokeData, Point, CANVAS_SIZE, polyLength, dist } from './strokeData';

export interface RenderState {
  data: CharacterStrokeData;
  completedStrokes: number;
  animStroke: number;      // -1 = none
  animProgress: number;
  hintStroke: number;      // -1 = none
  hintProgress: number;
  showOutline: boolean;
  correctPaths: Point[][];
  activeBrush: Point[];
}

const COLORS = {
  bg:      '#0d1117',
  border:  '#4b5563',
  grid:    '#1f2937',
  stroke:  '#e2e8f0',
  outline: 'rgba(255,255,255,0.18)',
  hint:    '#818cf8',
  brush:   '#818cf8',
};

export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  offCanvas: HTMLCanvasElement,
  state: RenderState,
) {
  const {
    data, completedStrokes, animStroke, animProgress,
    hintStroke, hintProgress, showOutline, correctPaths, activeBrush,
  } = state;

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  drawGrid(ctx);

  if (showOutline) {
    for (let i = 0; i < data.nStrokes; i++) {
      strokePath(ctx, data.strokePaths[i], COLORS.outline, 'stroke', 2);
    }
  }

  for (let i = 0; i < completedStrokes && i < data.nStrokes; i++) {
    strokePath(ctx, data.strokePaths[i], COLORS.stroke, 'fill');
  }

  if (animStroke >= 0 && animStroke < data.nStrokes && animProgress > 0) {
    animatedStroke(ctx, offCanvas, data.strokePaths[animStroke], data.medians[animStroke], animProgress, COLORS.stroke);
  }

  if (hintStroke >= 0 && hintStroke < data.nStrokes && hintProgress > 0) {
    animatedStroke(ctx, offCanvas, data.strokePaths[hintStroke], data.medians[hintStroke], hintProgress, COLORS.hint);
  }

  for (const path of correctPaths) {
    if (path.length > 1) brushLine(ctx, path, COLORS.brush, 8);
  }

  if (activeBrush.length > 1) {
    brushLine(ctx, activeBrush, COLORS.brush, 8);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D) {
  const pad = 20;
  const s = CANVAS_SIZE;

  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 3;
  ctx.strokeRect(pad, pad, s - pad * 2, s - pad * 2);

  ctx.save();
  ctx.setLineDash([20, 16]);
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(pad, s / 2);
  ctx.lineTo(s - pad, s / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(s / 2, pad);
  ctx.lineTo(s / 2, s - pad);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(s - pad, s - pad);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(s - pad, pad);
  ctx.lineTo(pad, s - pad);
  ctx.stroke();

  ctx.restore();
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  svgPath: string,
  color: string,
  mode: 'fill' | 'stroke',
  lineWidth = 2,
) {
  ctx.save();
  ctx.transform(1, 0, 0, -1, 0, 900);
  const p = new Path2D(svgPath);
  if (mode === 'fill') {
    ctx.fillStyle = color;
    ctx.fill(p);
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke(p);
  }
  ctx.restore();
}

function animatedStroke(
  mainCtx: CanvasRenderingContext2D,
  offCanvas: HTMLCanvasElement,
  svgPath: string,
  median: Point[],
  progress: number,
  color: string,
) {
  if (median.length === 0) return;

  const offCtx = offCanvas.getContext('2d')!;
  offCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  offCtx.save();
  offCtx.globalCompositeOperation = 'source-over';
  offCtx.transform(1, 0, 0, -1, 0, 900);
  offCtx.fillStyle = color;
  offCtx.fill(new Path2D(svgPath));
  offCtx.restore();

  offCtx.globalCompositeOperation = 'destination-in';
  offCtx.lineWidth = 300;
  offCtx.lineCap = 'round';
  offCtx.lineJoin = 'round';
  offCtx.strokeStyle = '#fff';

  const totalLen = polyLength(median);
  const targetLen = totalLen * Math.min(progress, 1);

  offCtx.beginPath();
  offCtx.moveTo(median[0].x, median[0].y);
  let acc = 0;
  for (let i = 1; i < median.length; i++) {
    const seg = dist(median[i - 1], median[i]);
    if (acc + seg >= targetLen) {
      const f = seg > 0 ? (targetLen - acc) / seg : 0;
      offCtx.lineTo(
        median[i - 1].x + (median[i].x - median[i - 1].x) * f,
        median[i - 1].y + (median[i].y - median[i - 1].y) * f,
      );
      break;
    }
    acc += seg;
    offCtx.lineTo(median[i].x, median[i].y);
  }
  if (progress >= 1) {
    const last = median[median.length - 1];
    offCtx.lineTo(last.x, last.y);
  }
  offCtx.stroke();

  offCtx.globalCompositeOperation = 'source-over';
  mainCtx.drawImage(offCanvas, 0, 0);
}

function brushLine(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  width: number,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}
