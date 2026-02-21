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
      } else {
        setError(`「${character}」沒有筆順資料`);
      }
      setLoading(false);
    });

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      cancelAnimationFrame(hintFrameRef.current);
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
          const nextStep = (s + 1) as Step;
          setStep(nextStep);
          setToast(
            nextStep === Step.TOGGLE_OUTLINE
              ? `恭喜筆畫正確！讓我們去掉邊框再練習 ${newLeft} 遍哦！`
              : `恭喜筆畫正確！讓我們再練習 ${newLeft} 次哦！`,
          );
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
  }, [doRender, showHint]);

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
  const canAnimate =
    mode === 'idle' && (step === Step.ANIMATION || isComplete);
  const canPractice =
    mode === 'idle' &&
    ((step >= Step.PRACTICE_1 && step <= Step.PRACTICE_3) ||
      step === Step.PRACTICE_NO_OUTLINE ||
      isComplete);
  const canToggleOutline =
    mode === 'idle' && (step === Step.TOGGLE_OUTLINE || isComplete);

  /* ================================================================ */
  /*  JSX                                                              */
  /* ================================================================ */

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0d1117]">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
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
            className="text-indigo-400 hover:text-indigo-300 font-bold"
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
        {isComplete && onComplete && (
          <button
            onClick={onComplete}
            className="text-indigo-400 hover:text-indigo-300 text-sm font-bold"
          >
            完成 →
          </button>
        )}
      </div>

      {/* Practice progress indicators */}
      {!isComplete && (
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
      <div className="flex gap-6 justify-center">
        <CtrlBtn
          icon={mode === 'animating' ? '⏸' : '▶'}
          label="筆順"
          active={mode === 'animating'}
          glow={step === Step.ANIMATION && mode === 'idle'}
          disabled={mode === 'quizzing' || (!canAnimate && mode !== 'animating')}
          onClick={() => (mode === 'animating' ? stopAnimation() : startAnimation())}
        />
        <CtrlBtn
          icon="✍️"
          label="寫字"
          active={mode === 'quizzing'}
          glow={canPractice && mode !== 'quizzing'}
          disabled={!canPractice && mode !== 'quizzing'}
          onClick={() => {
            if (mode === 'quizzing') {
              setMode('idle');
              r.current.correctPaths = [];
              r.current.completedStrokes = 0;
              m.current.quizStroke = 0;
              doRender();
            } else {
              startQuiz();
            }
          }}
        />
        <CtrlBtn
          icon={showOutline ? '👁' : '👁‍🗨'}
          label="邊框"
          active={!showOutline}
          glow={step === Step.TOGGLE_OUTLINE}
          disabled={!canToggleOutline}
          onClick={() => {
            setShowOutline(prev => !prev);
            if (step === Step.TOGGLE_OUTLINE) setStep(Step.PRACTICE_NO_OUTLINE);
          }}
        />
      </div>

      {/* Step guidance */}
      <StepGuidance step={step} mode={mode} />

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

function CtrlBtn({ icon, label, active, glow, disabled, onClick }: {
  icon: string; label: string; active: boolean; glow: boolean;
  disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex flex-col items-center gap-1 px-5 py-2.5 rounded-xl transition-all',
        disabled ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-800 active:scale-95',
        glow ? 'ring-2 ring-yellow-400/70 bg-slate-800/50' : '',
        active ? 'text-indigo-400' : 'text-slate-400',
      ].join(' ')}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-xs font-bold">{label}</span>
    </button>
  );
}

function StepGuidance({ step, mode }: { step: Step; mode: string }) {
  let text = '';
  if (mode === 'animating') text = '正在播放筆順動畫…';
  else if (mode === 'quizzing') text = '請在格子裡寫出每一筆';
  else {
    switch (step) {
      case Step.ANIMATION: text = '請先按「筆順」觀看筆畫順序'; break;
      case Step.PRACTICE_1:
      case Step.PRACTICE_2:
      case Step.PRACTICE_3: text = '按「寫字」開始練習（有邊框）'; break;
      case Step.TOGGLE_OUTLINE: text = '按「邊框」關閉邊框提示'; break;
      case Step.PRACTICE_NO_OUTLINE: text = '按「寫字」不看邊框再寫一次'; break;
      case Step.COMPLETE: text = '太棒了！你已經學會怎麼寫這個字了'; break;
    }
  }
  return text ? (
    <p className="text-xs text-slate-500 text-center max-w-xs">{text}</p>
  ) : null;
}

export default WriteCharacter;
