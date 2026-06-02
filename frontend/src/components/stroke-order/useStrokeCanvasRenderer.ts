/**
 * useStrokeCanvasRenderer — issue #1858
 *
 * Owns all imperative canvas state:
 *   - the r-ref (completedStrokes, animStroke, animProgress, hintStroke, hintProgress,
 *     correctPaths, activeBrush)
 *   - animFrameRef / hintFrameRef and their start timestamps
 *   - isDrawingRef, isAutoLoopingRef, pendingAutoStartRef
 *   - loopTimerRef, shakeTimerRef, completionTimerRef
 *   - offCanvasRef
 *   - doRender
 *   - getOffCanvas
 *
 * This hook only mutates refs + triggers rerender via the setters passed in.
 * It does NOT own React state.
 */

import { useRef, useCallback } from 'react';
import {
  CharacterStrokeData,
  Point,
  CANVAS_SIZE,
  getStrokeDuration,
} from './strokeData';
import { renderStrokes, RenderState } from './strokeRenderer';

export interface CanvasRenderConfig {
  radicalColorMode: boolean;
  componentCount: number;
}

/** Mutable render state, kept in a single ref to avoid stale closures. */
export interface RenderRef {
  completedStrokes: number;
  animStroke: number;
  animProgress: number;
  hintStroke: number;
  hintProgress: number;
  correctPaths: Point[][];
  activeBrush: Point[];
}

/** Mutable mirrors of React state for use inside async/imperative callbacks. */
export interface MirrorRef {
  data: CharacterStrokeData | null;
  step: number;
  mode: string;
  practiceLeft: number;
  showOutline: boolean;
  mistakes: number[];
  quizStroke: number;
}

export interface StrokeCanvasRenderer {
  /** The main on-screen canvas ref — pass as `ref` to `<canvas>`. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Mutable render state ref. */
  r: React.MutableRefObject<RenderRef>;
  /** Mutable mirror-state ref (synced by WriteCharacter each render). */
  m: React.MutableRefObject<MirrorRef>;
  /** Animation / timer refs — exposed for cleanup in useEffect. */
  animFrameRef: React.MutableRefObject<number>;
  hintFrameRef: React.MutableRefObject<number>;
  loopTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
  shakeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
  completionTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>;
  isDrawingRef: React.MutableRefObject<boolean>;
  isAutoLoopingRef: React.MutableRefObject<boolean>;
  pendingAutoStartRef: React.MutableRefObject<boolean>;
  /** Get (or lazily create) the off-screen canvas. */
  getOffCanvas: () => HTMLCanvasElement;
  /** Draw the current render state to the main canvas. */
  doRender: () => void;
}

export function useStrokeCanvasRenderer(config: CanvasRenderConfig): StrokeCanvasRenderer {
  const { radicalColorMode, componentCount } = config;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const r = useRef<RenderRef>({
    completedStrokes: 0,
    animStroke: -1,
    animProgress: 0,
    hintStroke: -1,
    hintProgress: 0,
    correctPaths: [],
    activeBrush: [],
  });

  const m = useRef<MirrorRef>({
    data: null,
    step: 0,
    mode: 'idle',
    practiceLeft: 4,
    showOutline: true,
    mistakes: [],
    quizStroke: 0,
  });

  // Animation & drawing refs
  const animFrameRef = useRef(0);
  const animStartRef = useRef(0);
  const hintFrameRef = useRef(0);
  const hintStartRef = useRef(0);
  const isDrawingRef = useRef(false);
  const isAutoLoopingRef = useRef(false);
  const pendingAutoStartRef = useRef(false);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const completionTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Expose start timestamps so animation functions can reference them
  // (they'll be written by the animation loops inside WriteCharacter)
  // We attach them to the renderer so the component can reach them.
  (r as any).animStartRef = animStartRef;
  (r as any).hintStartRef = hintStartRef;

  const getOffCanvas = useCallback((): HTMLCanvasElement => {
    if (!offCanvasRef.current) {
      offCanvasRef.current = document.createElement('canvas');
      offCanvasRef.current.width = CANVAS_SIZE;
      offCanvasRef.current.height = CANVAS_SIZE;
    }
    return offCanvasRef.current;
  }, []);

  const doRender = useCallback(() => {
    const canvas = canvasRef.current;
    const d = m.current.data;
    if (!canvas || !d) return;
    const ctx = canvas.getContext('2d')!;
    const state: RenderState = {
      data: d,
      completedStrokes: r.current.completedStrokes,
      animStroke: r.current.animStroke,
      animProgress: r.current.animProgress,
      hintStroke: r.current.hintStroke,
      hintProgress: r.current.hintProgress,
      showOutline: m.current.showOutline,
      correctPaths: r.current.correctPaths,
      activeBrush: r.current.activeBrush,
      radicalColorMode,
      componentCount,
    };
    renderStrokes(ctx, getOffCanvas(), state);
  }, [getOffCanvas, radicalColorMode, componentCount]);

  return {
    canvasRef,
    r,
    m,
    animFrameRef,
    hintFrameRef,
    loopTimerRef,
    shakeTimerRef,
    completionTimerRef,
    isDrawingRef,
    isAutoLoopingRef,
    pendingAutoStartRef,
    getOffCanvas,
    doRender,
  };
}
