import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  loadCharacterStrokeData,
  CharacterStrokeData,
  Point,
  isStrokeCorrect,
  getStrokeDuration,
  CANVAS_SIZE,
  HINT_THRESHOLD,
} from './strokeData';
import { renderStrokes, RenderState } from './strokeRenderer';

interface WriteCharacterProps {
  character: string;
  onComplete?: () => void;
  onBack?: () => void;
  /** When true, only renders the canvas + minimal controls (no header/back/progress dots). */
  embedded?: boolean;
  /**
   * Practice flow shape (#1342 / VocabPractice rounds):
   *   - 'standard' (default): animation preview + 3 outlined practices +
   *     1 no-outline practice. The historical 4-trace flow.
   *   - 'outlined-once': skip animation; one outlined practice only;
   *     fire onComplete on success. Used for round-1 仿寫.
   *   - 'no-outline-once': skip animation + outline; one no-outline
   *     practice only; fire onComplete on success. Used for round-2 再生回憶.
   *
   * Named `practiceMode` rather than `mode` to avoid shadowing the internal
   * `mode` state variable ('idle' | 'animating' | 'quizzing').
   */
  practiceMode?: 'standard' | 'outlined-once' | 'no-outline-once';
  /**
   * #1342: colour completed strokes by their component group on the canvas.
   * Once every stroke is done the colours unify into the default ink colour
   * ("合體"). Number of distinct colours is driven by `componentCount` below.
   */
  radicalColorMode?: boolean;
  /**
   * #1529: number of components for this character (from getDecomposition).
   * One colour per component, up to the palette length (5). Defaults to 2
   * (primary radical + body) when omitted, matching the previous behaviour.
   */
  componentCount?: number;
}

enum Step {
  ANIMATION,
  PRACTICE_1,
  PRACTICE_2,
  PRACTICE_3,
  PRACTICE_NO_OUTLINE,
  COMPLETE,
}

/* ================================================================ */
/*  Confetti decoration for completion screen                        */
/* ================================================================ */

function ConfettiParticles() {
  const pieces = [
    { color: 'bg-yellow-400', anim: 'animate-confetti-drop-1', left: '20%', shape: 'rounded-sm w-3 h-3' },
    { color: 'bg-pink-400',   anim: 'animate-confetti-drop-2', left: '50%', shape: 'rounded-full w-2.5 h-2.5' },
    { color: 'bg-sky-400',    anim: 'animate-confetti-drop-3', left: '75%', shape: 'rounded-sm w-2 h-3' },
    { color: 'bg-emerald-400',anim: 'animate-confetti-drop-1', left: '35%', shape: 'rounded-full w-2 h-2' },
    { color: 'bg-violet-400', anim: 'animate-confetti-drop-2', left: '65%', shape: 'rounded-sm w-3 h-2' },
    { color: 'bg-orange-400', anim: 'animate-confetti-drop-3', left: '85%', shape: 'rounded-full w-2.5 h-2.5' },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
      {pieces.map((p, i) => (
        <div
          key={i}
          className={`absolute top-4 ${p.color} ${p.anim} ${p.shape} opacity-0`}
          style={{ left: p.left }}
        />
      ))}
    </div>
  );
}

/* ================================================================ */
/*  Practice progress dots                                           */
/* ================================================================ */

interface ProgressDotsProps {
  step: Step;
  practiceLeft: number;
}

function ProgressDots({ step, practiceLeft }: ProgressDotsProps) {
  if (step === Step.ANIMATION || step === Step.COMPLETE) return null;

  // 3 bordered rounds + 1 no-outline round = 4 total
  const dots = [
    { label: '1', filled: practiceLeft < 4, isNoOutline: false },
    { label: '2', filled: practiceLeft < 3, isNoOutline: false },
    { label: '3', filled: practiceLeft < 2, isNoOutline: false },
    { label: '無框', filled: practiceLeft < 1, isNoOutline: true },
  ];

  return (
    <div className="flex items-center gap-2">
      {dots.map((dot, i) => (
        <React.Fragment key={i}>
          {i === 3 && (
            <div className="w-4 h-px bg-surface-container-highest" />
          )}
          <div className="flex flex-col items-center gap-0.5">
            <div
              className={`flex items-center justify-center rounded-full border-2 transition-all duration-300 ${
                dot.isNoOutline ? 'w-7 h-7' : 'w-6 h-6'
              } ${
                dot.filled
                  ? dot.isNoOutline
                    ? 'border-accent bg-accent'
                    : 'border-emerald-500 bg-emerald-500'
                  : 'border-surface-container-highest bg-transparent'
              }`}
            >
              {dot.filled && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className={`text-[9px] ${dot.filled ? 'text-emerald-600' : 'text-on-surface-variant'}`}>
              {dot.label}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ================================================================ */
/*  Step guidance banner                                             */
/* ================================================================ */

interface StepGuidanceProps {
  step: Step;
  mode: string;
  nStrokes: number;
  completedStrokes: number;
}

function StepGuidance({ step, mode, nStrokes, completedStrokes }: StepGuidanceProps) {
  if (step === Step.COMPLETE) return null;

  let icon = '';
  let text = '';
  let subtext = '';
  let colorClass = 'text-on-surface-variant bg-surface-container-low';

  if (step === Step.ANIMATION) {
    icon = '👀';
    text = '觀看筆順動畫';
    subtext = '準備好了就按「開始練習」';
    colorClass = 'text-accent bg-accent/10';
  } else if (mode === 'quizzing') {
    const remaining = nStrokes - completedStrokes;
    const isNoOutline = step === Step.PRACTICE_NO_OUTLINE;
    icon = isNoOutline ? '🧠' : '✏️';
    text = isNoOutline ? '不看框線，憑記憶寫' : '跟著筆順，一筆一筆寫';
    subtext = remaining > 0 ? `還有 ${remaining} 筆` : '最後一筆了！';
    colorClass = isNoOutline
      ? 'text-accent bg-accent/10'
      : 'text-emerald-700 bg-emerald-50';
  } else if (mode === 'idle' && step !== Step.ANIMATION) {
    icon = '✅';
    text = '這一輪寫完了！';
    colorClass = 'text-emerald-700 bg-emerald-50';
  }

  if (!text) return null;

  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm animate-slide-up-fast ${colorClass}`}>
      <span>{icon}</span>
      <span className="font-medium">{text}</span>
      {subtext && <span className="opacity-60 text-xs">{subtext}</span>}
    </div>
  );
}

/* ================================================================ */
/*  Toast notification                                               */
/* ================================================================ */

function Toast({ message, type }: { message: string; type: 'success' | 'error' | 'info' }) {
  const colors = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-tertiary text-white',
    info: 'bg-surface-container-highest text-on-surface',
  };
  return (
    <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl text-sm font-bold z-50 animate-toast-in whitespace-nowrap ${colors[type]}`}>
      {message}
    </div>
  );
}

/* ================================================================ */
/*  Main component                                                   */
/* ================================================================ */

const WriteCharacter: React.FC<WriteCharacterProps> = ({
  character,
  onComplete,
  onBack,
  embedded = false,
  practiceMode = 'standard',
  radicalColorMode = false,
  componentCount = 2,
}) => {
  // #1342 / #1529: derived flags for the simplified single-shot rounds.
  // outlined-once still plays the animation preview (#1529); only the recall
  // round (no-outline-once) skips it.
  const isOutlinedOnce = practiceMode === 'outlined-once';
  const isNoOutlineOnce = practiceMode === 'no-outline-once';
  /* ---- React state (drives UI controls) ---- */
  const [data, setData] = useState<CharacterStrokeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState(Step.ANIMATION);
  const [mode, setMode] = useState<'idle' | 'animating' | 'quizzing'>('idle');
  const [practiceLeft, setPracticeLeft] = useState(4);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');
  const [showOutline, setShowOutline] = useState(true);
  const [canvasShake, setCanvasShake] = useState(false);
  const [completedStrokesUI, setCompletedStrokesUI] = useState(0);

  /* ---- Refs for imperative canvas rendering ---- */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Rendering state (read by the render function, written by animation/quiz/drawing)
  const r = useRef({
    completedStrokes: 0,
    animStroke: -1,
    animProgress: 0,
    hintStroke: -1,
    hintProgress: 0,
    correctPaths: [] as Point[][],
    activeBrush: [] as Point[],
  });

  // Mirrors of React state for async/imperative callbacks
  const m = useRef({
    data: null as CharacterStrokeData | null,
    step: Step.ANIMATION,
    mode: 'idle' as string,
    practiceLeft: 4,
    showOutline: true,
    mistakes: [] as number[],
    quizStroke: 0,
  });
  m.current.data = data;
  m.current.step = step;
  m.current.mode = mode;
  m.current.practiceLeft = practiceLeft;
  m.current.showOutline = showOutline;

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
  // #1342: holds the auto-onComplete timer for single-shot rounds so we can
  // cancel it on character change / unmount, preventing a stale closure from
  // firing onComplete after the parent has already advanced (e.g. the user
  // tapped "跳過第 2 次練習" inside the 600 ms window).
  const completionTimerRef = useRef<ReturnType<typeof setTimeout>>();

  /* ---- Off-screen canvas (created once, reused) ---- */
  const getOffCanvas = useCallback(() => {
    if (!offCanvasRef.current) {
      offCanvasRef.current = document.createElement('canvas');
      offCanvasRef.current.width = CANVAS_SIZE;
      offCanvasRef.current.height = CANVAS_SIZE;
    }
    return offCanvasRef.current;
  }, []);

  /* ---- Render to canvas ---- */
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

  /* ---- Shared state reset (used by both initial load and retry) ---- */
  const resetState = useCallback((nStrokes: number) => {
    // #1342 / #1529 single-shot rounds:
    //   outlined-once → ANIMATION first (preview stroke order), then a single
    //     PRACTICE_1 trace once the student clicks 開始練習. Restored in #1529
    //     so children see the correct stroke order before writing — without
    //     having to wait the full animation out (skip button stays available).
    //   no-outline-once → PRACTICE_NO_OUTLINE, outline hidden, no preview.
    // standard preserves the original animation-led 4-trace flow.
    let initialStep = Step.ANIMATION;
    let outlineOn = true;
    let leftCount = 4;
    if (isOutlinedOnce) {
      initialStep = Step.ANIMATION;
      outlineOn = true;
      leftCount = 1;
    } else if (isNoOutlineOnce) {
      initialStep = Step.PRACTICE_NO_OUTLINE;
      outlineOn = false;
      leftCount = 1;
    }
    setStep(initialStep);
    setMode('idle');
    setPracticeLeft(leftCount);
    setShowOutline(outlineOn);
    setToast('');
    setCompletedStrokesUI(0);
    r.current = {
      completedStrokes: 0, animStroke: -1, animProgress: 0,
      hintStroke: -1, hintProgress: 0, correctPaths: [], activeBrush: [],
    };
    m.current.showOutline = outlineOn;
    m.current.mistakes = new Array(nStrokes).fill(0);
    m.current.quizStroke = 0;
  }, [isOutlinedOnce, isNoOutlineOnce]);

  /* ---- Load character data ---- */
  useEffect(() => {
    setLoading(true);
    setError('');
    resetState(0);
    isAutoLoopingRef.current = false;
    pendingAutoStartRef.current = false;

    loadCharacterStrokeData(character).then(d => {
      if (d) {
        setData(d);
        m.current.mistakes = new Array(d.nStrokes).fill(0);
        pendingAutoStartRef.current = true;
      } else {
        setError(`「${character}」沒有筆順資料`);
      }
      setLoading(false);
    });

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      cancelAnimationFrame(hintFrameRef.current);
      clearTimeout(loopTimerRef.current);
      clearTimeout(shakeTimerRef.current);
      clearTimeout(completionTimerRef.current);
    };
  }, [character, resetState]);

  /* ---- Re-render when declarative state changes ---- */
  useEffect(() => {
    if (data && mode !== 'animating') doRender();
  }, [data, showOutline, mode, doRender]);

  /* ---- Toast auto-dismiss ---- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---- Trigger shake animation ---- */
  const triggerShake = useCallback(() => {
    setCanvasShake(false);
    clearTimeout(shakeTimerRef.current);
    // Use rAF to allow React to clear the class first
    requestAnimationFrame(() => {
      setCanvasShake(true);
      shakeTimerRef.current = setTimeout(() => setCanvasShake(false), 450);
    });
  }, []);

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast('');
    // slight delay to re-trigger animation
    requestAnimationFrame(() => {
      setToast(msg);
      setToastType(type);
    });
  }, []);

  /* ================================================================ */
  /*  Animation                                                        */
  /* ================================================================ */

  const startAnimation = useCallback(() => {
    const d = m.current.data;
    if (!d) return;
    cancelAnimationFrame(animFrameRef.current);
    cancelAnimationFrame(hintFrameRef.current);
    setMode('animating');
    r.current.completedStrokes = 0;
    r.current.animStroke = 0;
    r.current.animProgress = 0;
    r.current.hintStroke = -1;
    animStartRef.current = performance.now();

    const tick = (now: number) => {
      const d2 = m.current.data;
      if (!d2) return;
      const stroke = r.current.animStroke;
      if (stroke < 0 || stroke >= d2.nStrokes) {
        r.current.animStroke = -1;
        r.current.completedStrokes = d2.nStrokes;
        doRender();
        if (isAutoLoopingRef.current) {
          loopTimerRef.current = setTimeout(() => {
            if (isAutoLoopingRef.current) startAnimation();
          }, 800);
          return;
        }
        setMode('idle');
        if (m.current.step === Step.ANIMATION) setStep(Step.PRACTICE_1);
        return;
      }
      const elapsed = now - animStartRef.current;
      const duration = getStrokeDuration(d2.medians[stroke]);
      const progress = Math.min(elapsed / duration, 1);
      r.current.animProgress = progress;
      r.current.completedStrokes = stroke;
      doRender();

      if (progress >= 1) {
        r.current.animStroke = stroke + 1;
        r.current.animProgress = 0;
        animStartRef.current = performance.now();
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, [doRender]);

  const handleRetry = useCallback(() => {
    if (!data) return;
    cancelAnimationFrame(animFrameRef.current);
    cancelAnimationFrame(hintFrameRef.current);
    clearTimeout(loopTimerRef.current);
    resetState(data.nStrokes);
    isAutoLoopingRef.current = true;
    startAnimation();
  }, [data, resetState, startAnimation]);

  /* ---- Auto-start animation loop when data first loads ---- */
  // Forward-ref pattern: startQuiz is defined below; capture its current value
  // through a ref so this effect can call it without a hoisting error.
  const startQuizRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (data && pendingAutoStartRef.current) {
      pendingAutoStartRef.current = false;
      // #1529: only the recall round (no-outline-once) skips the animation.
      // outlined-once now plays the stroke-order preview (with a 開始 button)
      // so children see the correct stroke order before writing.
      if (isNoOutlineOnce) {
        isAutoLoopingRef.current = false;
        startQuizRef.current();
      } else {
        isAutoLoopingRef.current = true;
        startAnimation();
      }
    }
  }, [data, isNoOutlineOnce, startAnimation]);

  /* ================================================================ */
  /*  Quiz (writing practice)                                          */
  /* ================================================================ */

  const startQuiz = useCallback(() => {
    const d = m.current.data;
    if (!d) return;
    cancelAnimationFrame(animFrameRef.current);
    cancelAnimationFrame(hintFrameRef.current);
    setMode('quizzing');
    r.current.completedStrokes = 0;
    r.current.correctPaths = [];
    r.current.animStroke = -1;
    r.current.hintStroke = -1;
    m.current.mistakes = new Array(d.nStrokes).fill(0);
    m.current.quizStroke = 0;
    setCompletedStrokesUI(0);
    doRender();
  }, [doRender]);

  // Keep startQuizRef pointing at the latest startQuiz (#1342 forward-ref).
  useEffect(() => { startQuizRef.current = startQuiz; }, [startQuiz]);

  const handleBeginPractice = useCallback(() => {
    isAutoLoopingRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
    clearTimeout(loopTimerRef.current);
    r.current.animStroke = -1;
    r.current.animProgress = 0;
    setStep(Step.PRACTICE_1);
    startQuiz();
  }, [startQuiz]);

  const showHint = useCallback(() => {
    const d = m.current.data;
    if (!d) return;
    const stroke = m.current.quizStroke;
    if (stroke >= d.nStrokes) return;
    cancelAnimationFrame(hintFrameRef.current);
    hintStartRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - hintStartRef.current;
      const duration = getStrokeDuration(d.medians[stroke], 3);
      const progress = Math.min(elapsed / duration, 1);
      r.current.hintStroke = stroke;
      r.current.hintProgress = progress;
      doRender();
      if (progress < 1) {
        hintFrameRef.current = requestAnimationFrame(tick);
      } else {
        r.current.hintStroke = -1;
        r.current.hintProgress = 0;
        doRender();
      }
    };
    hintFrameRef.current = requestAnimationFrame(tick);
  }, [doRender]);

  const handleStrokeDrawn = useCallback((points: Point[]) => {
    const d = m.current.data;
    if (!d || m.current.mode !== 'quizzing') return;
    const stroke = m.current.quizStroke;
    if (stroke >= d.nStrokes) return;

    if (isStrokeCorrect(points, d.medians[stroke])) {
      r.current.correctPaths = [...r.current.correctPaths, points];
      m.current.quizStroke = stroke + 1;
      r.current.completedStrokes = stroke + 1;
      setCompletedStrokesUI(stroke + 1);
      doRender();

      if (stroke + 1 >= d.nStrokes) {
        setMode('idle');
        const s = m.current.step;
        const pl = m.current.practiceLeft;

        if (s >= Step.PRACTICE_1 && s <= Step.PRACTICE_3) {
          // #1342: outlined-once mode auto-advances to whatever the parent
          // wires onComplete to (round 2 in VocabPractice). The COMPLETE
          // overlay's "下一個字" button was misleading — it actually moves
          // to the same character's round 2, not the next character — so we
          // skip the overlay entirely here. The 600 ms pause lets the
          // student see the radical-coloured strokes merge into one colour
          // (allDone branch in strokeRenderer's colourFor).
          if (isOutlinedOnce) {
            showToast('恭喜筆畫正確！', 'success');
            clearTimeout(completionTimerRef.current);
            completionTimerRef.current = setTimeout(() => onComplete?.(), 600);
          } else {
            const newLeft = pl - 1;
            setPracticeLeft(newLeft);
            if (s === Step.PRACTICE_3) {
              // Auto-advance to no-outline practice
              m.current.showOutline = false;
              setShowOutline(false);
              setStep(Step.PRACTICE_NO_OUTLINE);
              showToast('👏 很棒！現在試著不看邊框，憑記憶寫一次！', 'info');
              startQuiz();
            } else {
              const nextStep = (s + 1) as Step;
              setStep(nextStep);
              showToast(`恭喜筆畫正確！讓我們再練習 ${newLeft} 次哦！`, 'success');
              startQuiz();
            }
          }
        } else if (s === Step.PRACTICE_NO_OUTLINE) {
          // #1342: same auto-advance for no-outline-once (round 2). Standard
          // flow keeps the COMPLETE overlay so users have a "下一個字" CTA
          // when they have finished BOTH rounds (= the whole character is done).
          if (isNoOutlineOnce) {
            showToast('恭喜筆畫正確！這個字完成了！', 'success');
            clearTimeout(completionTimerRef.current);
            completionTimerRef.current = setTimeout(() => onComplete?.(), 600);
          } else {
            setPracticeLeft(pl - 1);
            setStep(Step.COMPLETE);
            showToast('恭喜筆畫正確！寫字練習完成！', 'success');
          }
        } else {
          showToast('恭喜筆畫正確！', 'success');
        }
      }
    } else {
      m.current.mistakes[stroke] = (m.current.mistakes[stroke] || 0) + 1;
      triggerShake();
      if (m.current.mistakes[stroke] >= HINT_THRESHOLD) {
        showHint();
      }
    }
  }, [doRender, showHint, startQuiz, triggerShake, showToast, isOutlinedOnce, isNoOutlineOnce, onComplete]);

  /* ================================================================ */
  /*  Pointer events (drawing)                                         */
  /* ================================================================ */

  const toCanvasCoords = useCallback((e: React.PointerEvent): Point | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (m.current.mode !== 'quizzing') return;
    const pt = toCanvasCoords(e);
    if (!pt) return;
    isDrawingRef.current = true;
    r.current.activeBrush = [pt];
    canvasRef.current?.setPointerCapture(e.pointerId);
  }, [toCanvasCoords]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    const pt = toCanvasCoords(e);
    if (!pt) return;
    if (pt.x >= 0 && pt.x <= CANVAS_SIZE && pt.y >= 0 && pt.y <= CANVAS_SIZE) {
      r.current.activeBrush.push(pt);
    }
    doRender();
  }, [toCanvasCoords, doRender]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const points = [...r.current.activeBrush];
    r.current.activeBrush = [];
    doRender();
    if (points.length > 1) handleStrokeDrawn(points);
  }, [doRender, handleStrokeDrawn]);

  /* ================================================================ */
  /*  Derived values                                                   */
  /* ================================================================ */

  const isComplete = step === Step.COMPLETE;
  const nStrokes = data?.nStrokes ?? 0;

  /* ================================================================ */
  /*  JSX                                                              */
  /* ================================================================ */

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117]">
        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[#0d1117]">
        <p className="text-lg text-slate-400">{error || '載入失敗'}</p>
        {onBack && (
          <button
            onClick={onBack}
            className="text-accent-light hover:text-accent-light font-bold"
          >
            返回
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col items-center ${embedded ? 'gap-3' : 'p-4 gap-4 overflow-auto'}`}>
      {/* Header — hidden in embedded mode */}
      {!embedded && (
        <div className="flex items-center gap-4 w-full max-w-lg">
          {onBack && (
            <button
              onClick={onBack}
              className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
              aria-label="返回"
            >
              <span className="material-symbols-outlined text-2xl">arrow_back</span>
            </button>
          )}
          <div className="flex-1 text-center">
            <h2 className="text-2xl font-bold font-headline text-on-surface">
              寫一寫：<span className="text-accent">{character}</span>
            </h2>
            {nStrokes > 0 && (
              <p className="text-xs text-on-surface-variant mt-0.5">共 {nStrokes} 筆</p>
            )}
          </div>
          {onBack && <div className="w-8" />}
        </div>
      )}

      {/* Progress dots — hidden in embedded mode */}
      {!embedded && <ProgressDots step={step} practiceLeft={practiceLeft} />}

      {/* Stroke progress bar (during quiz) */}
      {mode === 'quizzing' && nStrokes > 0 && (
        <div className={`w-full ${embedded ? '' : 'max-w-lg'}`}>
          <div className="flex justify-between text-[10px] text-on-surface-variant mb-1">
            <span>筆畫進度</span>
            <span>{completedStrokesUI} / {nStrokes}</span>
          </div>
          <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${(completedStrokesUI / nStrokes) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        className={`relative w-full max-w-lg aspect-square ${canvasShake ? 'animate-shake' : ''}`}
      >
        {/* Completion overlay */}
        {isComplete && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/95 rounded-xl z-10 gap-4 p-6 animate-fade-in" style={{ backdropFilter: 'blur(8px)' }}>
            <ConfettiParticles />
            <div className="animate-star-burst text-6xl select-none">🎉</div>
            <p className="text-6xl font-black text-on-surface animate-pop">{character}</p>
            <div className="flex flex-col items-center gap-1">
              <p className="text-xl font-bold text-emerald-600">練習完成！</p>
              <p className="text-xs text-on-surface-variant">很棒，{nStrokes} 筆全部正確</p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-xs mt-2">
              {onComplete && (
                <button
                  onClick={onComplete}
                  className="w-full h-12 rounded-full font-bold text-base text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
                >
                  下一個字
                  <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </button>
              )}
              <button
                onClick={handleRetry}
                className="w-full px-6 py-2.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-full transition-all text-sm"
              >
                再練一次
              </button>
            </div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="w-full h-full rounded-xl shadow-xl"
          style={{ touchAction: 'none', cursor: mode === 'quizzing' ? 'crosshair' : 'default' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>

      {/* Begin practice button (animation phase) */}
      {step === Step.ANIMATION && (
        <button
          onClick={handleBeginPractice}
          className="px-10 py-4 rounded-full font-headline font-bold text-lg text-white shadow-[0_8px_32px_rgba(86,74,191,0.3)] transition-all active:scale-95 animate-pulse flex items-center gap-2"
          style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
        >
          <span className="material-symbols-outlined text-xl">edit</span>
          開始練習
        </button>
      )}

      {/* Step guidance — hidden in embedded mode */}
      {!embedded && (
        <StepGuidance
          step={step}
          mode={mode}
          nStrokes={nStrokes}
          completedStrokes={completedStrokesUI}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} type={toastType} />}
    </div>
  );
};

export default WriteCharacter;
