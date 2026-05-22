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
import { Step, useWriteCharacterMachine } from './useWriteCharacterMachine';
import { useStrokeCanvasRenderer } from './useStrokeCanvasRenderer';

interface WriteCharacterProps {
  character: string;
  onComplete?: () => void;
  onBack?: () => void;
  embedded?: boolean;
  practiceMode?: 'standard' | 'outlined-once' | 'no-outline-once';
  radicalColorMode?: boolean;
  componentCount?: number;
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
  const isOutlinedOnce = practiceMode === 'outlined-once';
  const isNoOutlineOnce = practiceMode === 'no-outline-once';

  /* ---- Step/mode state (via useWriteCharacterMachine) ---- */
  const [machineState, machineActions] = useWriteCharacterMachine();
  const {
    step, mode, practiceLeft, showOutline, completedStrokesUI,
    toast, toastType, canvasShake,
  } = machineState;
  const {
    setStep, setMode, setPracticeLeft, setShowOutline,
    setCompletedStrokesUI, setToast, setToastType, setCanvasShake,
    resetMachineState,
  } = machineActions;

  /* ---- Data loading state ---- */
  const [data, setData] = useState<CharacterStrokeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /* ---- Canvas refs / rendering (via useStrokeCanvasRenderer) ---- */
  const renderer = useStrokeCanvasRenderer({ radicalColorMode, componentCount });
  const {
    canvasRef, r, m,
    animFrameRef, hintFrameRef,
    loopTimerRef, shakeTimerRef, completionTimerRef,
    isDrawingRef, isAutoLoopingRef, pendingAutoStartRef,
    doRender,
  } = renderer;

  // Animation start timestamps are attached to the renderer's `r` ref
  const animStartRef = (r as any).animStartRef as React.MutableRefObject<number>;
  const hintStartRef = (r as any).hintStartRef as React.MutableRefObject<number>;

  // Sync mirrors every render so async callbacks see latest React state
  m.current.data = data;
  m.current.step = step;
  m.current.mode = mode;
  m.current.practiceLeft = practiceLeft;
  m.current.showOutline = showOutline;

  /* ---- Shared state reset ---- */
  const resetState = useCallback((nStrokes: number) => {
    const result = resetMachineState({ nStrokes, isOutlinedOnce, isNoOutlineOnce });
    r.current = {
      completedStrokes: 0, animStroke: -1, animProgress: 0,
      hintStroke: -1, hintProgress: 0, correctPaths: [], activeBrush: [],
    };
    m.current.showOutline = result.outlineOn;
    m.current.mistakes = new Array(nStrokes).fill(0);
    m.current.quizStroke = 0;
  }, [isOutlinedOnce, isNoOutlineOnce, resetMachineState, r, m]);

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
  }, [character, resetState, isAutoLoopingRef, pendingAutoStartRef, m,
      animFrameRef, hintFrameRef, loopTimerRef, shakeTimerRef, completionTimerRef]);

  /* ---- Re-render when declarative state changes ---- */
  useEffect(() => {
    if (data && mode !== 'animating') doRender();
  }, [data, showOutline, mode, doRender]);

  /* ---- Toast auto-dismiss ---- */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  /* ---- Shake animation ---- */
  const triggerShake = useCallback(() => {
    setCanvasShake(false);
    clearTimeout(shakeTimerRef.current);
    requestAnimationFrame(() => {
      setCanvasShake(true);
      shakeTimerRef.current = setTimeout(() => setCanvasShake(false), 450);
    });
  }, [setCanvasShake, shakeTimerRef]);

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast('');
    setToastType(type);
    requestAnimationFrame(() => {
      setToast(msg);
      setToastType(type);
    });
  }, [setToast, setToastType]);

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
  }, [doRender, setMode, setStep, animFrameRef, hintFrameRef,
      animStartRef, isAutoLoopingRef, loopTimerRef, r, m]);

  const handleRetry = useCallback(() => {
    if (!data) return;
    cancelAnimationFrame(animFrameRef.current);
    cancelAnimationFrame(hintFrameRef.current);
    clearTimeout(loopTimerRef.current);
    resetState(data.nStrokes);
    isAutoLoopingRef.current = true;
    startAnimation();
  }, [data, resetState, startAnimation, animFrameRef, hintFrameRef, loopTimerRef, isAutoLoopingRef]);

  /* ---- Auto-start when data loads ---- */
  const startQuizRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (data && pendingAutoStartRef.current) {
      pendingAutoStartRef.current = false;
      if (isNoOutlineOnce) {
        isAutoLoopingRef.current = false;
        startQuizRef.current();
      } else {
        isAutoLoopingRef.current = true;
        startAnimation();
      }
    }
  }, [data, isNoOutlineOnce, startAnimation, pendingAutoStartRef, isAutoLoopingRef]);

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
  }, [doRender, setMode, setCompletedStrokesUI, animFrameRef, hintFrameRef, r, m]);

  useEffect(() => { startQuizRef.current = startQuiz; }, [startQuiz]);

  const handleBeginPractice = useCallback(() => {
    isAutoLoopingRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
    clearTimeout(loopTimerRef.current);
    r.current.animStroke = -1;
    r.current.animProgress = 0;
    setStep(Step.PRACTICE_1);
    startQuiz();
  }, [startQuiz, setStep, isAutoLoopingRef, animFrameRef, loopTimerRef, r]);

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
  }, [doRender, hintFrameRef, hintStartRef, r, m]);

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
          if (isOutlinedOnce) {
            showToast('恭喜筆畫正確！', 'success');
            clearTimeout(completionTimerRef.current);
            completionTimerRef.current = setTimeout(() => onComplete?.(), 600);
          } else {
            const newLeft = pl - 1;
            setPracticeLeft(newLeft);
            if (s === Step.PRACTICE_3) {
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
  }, [doRender, showHint, startQuiz, triggerShake, showToast,
      isOutlinedOnce, isNoOutlineOnce, onComplete,
      setMode, setCompletedStrokesUI, setPracticeLeft, setShowOutline, setStep,
      completionTimerRef, r, m]);

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
  }, [canvasRef]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (m.current.mode !== 'quizzing') return;
    const pt = toCanvasCoords(e);
    if (!pt) return;
    isDrawingRef.current = true;
    r.current.activeBrush = [pt];
    canvasRef.current?.setPointerCapture(e.pointerId);
  }, [toCanvasCoords, isDrawingRef, r, m, canvasRef]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawingRef.current) return;
    const pt = toCanvasCoords(e);
    if (!pt) return;
    if (pt.x >= 0 && pt.x <= CANVAS_SIZE && pt.y >= 0 && pt.y <= CANVAS_SIZE) {
      r.current.activeBrush.push(pt);
    }
    doRender();
  }, [toCanvasCoords, doRender, isDrawingRef, r]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const points = [...r.current.activeBrush];
    r.current.activeBrush = [];
    doRender();
    if (points.length > 1) handleStrokeDrawn(points);
  }, [doRender, handleStrokeDrawn, isDrawingRef, r]);

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

      {!embedded && <ProgressDots step={step} practiceLeft={practiceLeft} />}

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

      <div
        className={`relative w-full max-w-lg aspect-square ${canvasShake ? 'animate-shake' : ''}`}
      >
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

      {!embedded && (
        <StepGuidance
          step={step}
          mode={mode}
          nStrokes={nStrokes}
          completedStrokes={completedStrokesUI}
        />
      )}

      {toast && <Toast message={toast} type={toastType} />}
    </div>
  );
};

export default WriteCharacter;
