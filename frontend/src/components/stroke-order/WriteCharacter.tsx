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
}

enum Step {
  ANIMATION,
  PRACTICE_1,
  PRACTICE_2,
  PRACTICE_3,
  TOGGLE_OUTLINE,
  PRACTICE_NO_OUTLINE,
  COMPLETE,
}

const WriteCharacter: React.FC<WriteCharacterProps> = ({ character, onComplete, onBack }) => {
  /* ---- React state (drives UI controls) ---- */
  const [data, setData] = useState<CharacterStrokeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState(Step.ANIMATION);
  const [mode, setMode] = useState<'idle' | 'animating' | 'quizzing'>('idle');
  const [practiceLeft, setPracticeLeft] = useState(4);
  const [toast, setToast] = useState('');
  const [showOutline, setShowOutline] = useState(true);

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
    };
    renderStrokes(ctx, getOffCanvas(), state);
  }, [getOffCanvas]);

  /* ---- Load character data ---- */
  useEffect(() => {
    setLoading(true);
    setError('');
    setStep(Step.ANIMATION);
    setMode('idle');
    setPracticeLeft(4);
    setShowOutline(true);
    setToast('');
    isAutoLoopingRef.current = false;
    pendingAutoStartRef.current = false;
    r.current = {
      completedStrokes: 0, animStroke: -1, animProgress: 0,
      hintStroke: -1, hintProgress: 0, correctPaths: [], activeBrush: [],
    };
    m.current.mistakes = [];
    m.current.quizStroke = 0;

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
    };
  }, [character]);

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

  const stopAnimation = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    const d = m.current.data;
    r.current.animStroke = -1;
    r.current.animProgress = 0;
    if (d) r.current.completedStrokes = d.nStrokes;
    doRender();
    setMode('idle');
    if (m.current.step === Step.ANIMATION) setStep(Step.PRACTICE_1);
  }, [doRender]);

  const resetAndLoop = useCallback((d: CharacterStrokeData) => {
    cancelAnimationFrame(animFrameRef.current);
    cancelAnimationFrame(hintFrameRef.current);
    clearTimeout(loopTimerRef.current);
    setStep(Step.ANIMATION);
    setMode('idle');
    setPracticeLeft(4);
    setShowOutline(true);
    setToast('');
    r.current = {
      completedStrokes: 0, animStroke: -1, animProgress: 0,
      hintStroke: -1, hintProgress: 0, correctPaths: [], activeBrush: [],
    };
    m.current.showOutline = true;
    m.current.mistakes = new Array(d.nStrokes).fill(0);
    m.current.quizStroke = 0;
    isAutoLoopingRef.current = true;
    startAnimation();
  }, [startAnimation]);

  const handleRetry = useCallback(() => {
    if (!data) return;
    resetAndLoop(data);
  }, [data, resetAndLoop]);

  /* ---- Auto-start animation loop when data first loads ---- */
  useEffect(() => {
    if (data && pendingAutoStartRef.current) {
      pendingAutoStartRef.current = false;
      isAutoLoopingRef.current = true;
      startAnimation();
    }
  }, [data, startAnimation]);

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
    doRender();
  }, [doRender]);

  const handleBeginPractice = useCallback(() => {
    isAutoLoopingRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
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
      doRender();

      if (stroke + 1 >= d.nStrokes) {
        setMode('idle');
        const s = m.current.step;
        const pl = m.current.practiceLeft;

        if (s >= Step.PRACTICE_1 && s <= Step.PRACTICE_3) {
          const newLeft = pl - 1;
          setPracticeLeft(newLeft);
          if (s === Step.PRACTICE_3) {
            // Auto-skip TOGGLE_OUTLINE — jump straight to no-outline practice
            m.current.showOutline = false;
            setShowOutline(false);
            setStep(Step.PRACTICE_NO_OUTLINE);
            setToast('👏 很棒！現在試著不看邊框，憑記憶寫一次！');
            startQuiz();
          } else {
            const nextStep = (s + 1) as Step;
            setStep(nextStep);
            setToast(`恭喜筆畫正確！讓我們再練習 ${newLeft} 次哦！`);
            startQuiz();
          }
        } else if (s === Step.PRACTICE_NO_OUTLINE) {
          setPracticeLeft(pl - 1);
          setStep(Step.COMPLETE);
          setToast('恭喜筆畫正確！寫字練習完成！');
        } else {
          setToast('恭喜筆畫正確！');
        }
      }
    } else {
      m.current.mistakes[stroke] = (m.current.mistakes[stroke] || 0) + 1;
      if (m.current.mistakes[stroke] >= HINT_THRESHOLD) {
        showHint();
      }
    }
  }, [doRender, showHint, startQuiz]);

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
  /*  Button logic                                                     */
  /* ================================================================ */

  const isComplete = step === Step.COMPLETE;

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
    <div className="flex-1 flex flex-col items-center bg-[#0d1117] p-4 gap-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-4 w-full max-w-lg">
        {onBack && (
          <button
            onClick={onBack}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h2 className="text-2xl font-bold text-white flex-1 text-center">
          寫一寫：{character}
        </h2>
      </div>

      {/* Practice progress indicators */}
      {step !== Step.ANIMATION && !isComplete && (
        <div className="flex gap-1.5 items-center">
          {[4, 3, 2].map(n => (
            <div
              key={n}
              className={`w-5 h-5 rounded-full border-2 transition-all ${
                practiceLeft >= n
                  ? 'border-slate-500 bg-transparent'
                  : 'border-orange-500 bg-orange-500'
              }`}
            />
          ))}
          <div className="w-3" />
          <div
            className={`w-5 h-5 rounded-full border-2 transition-all ${
              practiceLeft >= 1
                ? 'border-slate-500 bg-transparent'
                : 'border-orange-500 bg-orange-500'
            }`}
          />
        </div>
      )}

      {isComplete && (
        <div className="text-emerald-400 font-bold text-sm">練習完成！</div>
      )}

      {/* Canvas */}
      <div className="relative w-full max-w-lg aspect-square">
        {isComplete && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0d1117]/95 rounded-xl z-10 gap-5 p-6">
            <div className="text-6xl">🎉</div>
            <p className="text-5xl font-black text-white">{character}</p>
            <p className="text-xl font-bold text-emerald-400">練習完成！</p>
            {onComplete && (
              <button
                onClick={onComplete}
                className="mt-2 px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 text-base"
              >
                完成，回到練習清單
              </button>
            )}
            <button
              onClick={handleRetry}
              className="px-6 py-2 text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 rounded-xl transition-all text-sm"
            >
              再練一次
            </button>
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

      {/* Controls */}
      {step === Step.ANIMATION && (
        <button
          onClick={handleBeginPractice}
          className="px-10 py-4 bg-accent hover:bg-accent-hover text-white font-black text-lg rounded-2xl shadow-xl transition-all active:scale-95 animate-pulse"
        >
          ✏️ 開始練習
        </button>
      )}

      {/* Step guidance */}
      <StepGuidance mode={mode} />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-emerald-600 text-white rounded-xl shadow-2xl text-sm font-bold z-50 animate-bounce">
          {toast}
        </div>
      )}
    </div>
  );
};

/* ---- Sub-components ---- */

function StepGuidance({ mode }: { mode: string }) {
  let text = '';
  if (mode === 'animating') text = '觀看筆順動畫，按「開始練習」開始書寫';
  else if (mode === 'quizzing') text = '請在格子裡寫出每一筆';
  return text ? (
    <p className="text-xs text-slate-500 text-center max-w-xs">{text}</p>
  ) : null;
}

export default WriteCharacter;
