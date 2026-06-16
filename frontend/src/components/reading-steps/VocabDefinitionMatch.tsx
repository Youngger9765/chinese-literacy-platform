/**
 * VocabDefinitionMatch — Step Component for 語詞定義配對
 *
 * 支援兩種互動模式 (#697, restored #728):
 *   - 選擇題 (Multiple Choice) — DEFAULT
 *   - 拖拉配對 (Drag & Drop)
 *
 * Flow:
 *   matching → summary (score + per-question) → retry wrong / retry all / finish
 *
 * No hints during answering (#710): wrong answer silently recorded, immediately advance.
 *
 * Refactored (#1846): thin orchestrator — logic in vocabDefinitionMatchLogic.ts,
 * UI in VocabDefinitionMatchSummary/StageStatus/MCQ/DragDrop.tsx
 *
 * Props: { story, onFinish, zhuyinActive? }
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import { Story, VocabItem } from '../../types';
import { scopedStepStorageKey, isToolboxMode } from '../../services/learningStorageScope';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import {
  shuffle,
  mergePersistedProgress,
  selectRetryIndices,
  InteractionMode,
  Phase,
  AnswerRecord,
  PersistedProgress,
} from './vocabDefinitionMatchLogic';
import { SummaryScreen } from './VocabDefinitionMatchSummary';
import { StageStatus } from './VocabDefinitionMatchStageStatus';
import { MultipleChoiceMode } from './VocabDefinitionMatchMCQ';
import { DragDropMode } from './VocabDefinitionMatchDragDrop';

/* ------------------------------------------------------------------ */
/*  Public types                                                        */
/* ------------------------------------------------------------------ */

export interface VocabDefinitionMatchResult {
  matchedCount: number;
  totalCount: number;
}

export interface VocabDefinitionMatchProps {
  story: Story;
  onFinish: (result: VocabDefinitionMatchResult) => void;
  zhuyinActive?: boolean;
  initialProgress?: Record<string, unknown>;
  onProgressChange?: (stepData: Record<string, unknown>, immediate?: boolean) => void;
}

/* ------------------------------------------------------------------ */
/*  Shared sub-component                                                */
/* ------------------------------------------------------------------ */

function NoDataFallback({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-surface">
      <div className="text-center space-y-4 p-8">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">dictionary</span>
        <p className="text-on-surface-variant">本課尚無語詞定義資料</p>
        <button onClick={onFinish} className="btn-immersive">
          繼續下一步 <span className="material-symbols-outlined text-lg ml-1">arrow_forward</span>
        </button>
      </div>
    </div>
  );
}

function StageCompletedPlaceholder({
  title,
  vocab,
  answers,
  otherModeLabel,
  otherDone,
  onGoOther,
  onRetry,
}: {
  title: string;
  vocab: VocabItem[];
  answers: AnswerRecord[];
  otherModeLabel: string;
  otherDone: boolean;
  onGoOther: () => void;
  onRetry: () => void;
}) {
  const correctCount = answers.filter((a) => a.correct).length;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-48 animate-fade-in">
      <div className="text-center mb-8">
        <span className="material-symbols-outlined text-5xl text-emerald-500">check_circle</span>
        <p className="text-lg font-headline font-bold text-on-surface mt-3">{title} 已完成</p>
        <p className="text-sm text-on-surface-variant mt-1">
          答對 {correctCount} / {answers.length} 題
        </p>
      </div>

      <div className="flex flex-col gap-3 mb-6">
        {answers.map((ans, idx) => {
          const item = vocab[ans.defIndex];
          const isCorrect = ans.correct;
          const studentWord =
            ans.answeredWordIdx !== null ? vocab[ans.answeredWordIdx]?.word : '—';

          return (
            <div
              key={`${title}-result-${idx}`}
              className={`rounded-xl border-2 px-4 py-3 flex items-start gap-3 ${
                isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
              }`}
            >
              <span
                className={`mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${
                  isCorrect ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              >
                {isCorrect ? '✓' : '✗'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-500 leading-snug mb-1">{item?.definition}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-gray-500">正確答案：</span>
                  <span className="font-bold text-gray-800">{item?.word}</span>
                  {!isCorrect && (
                    <>
                      <span className="text-gray-400">|</span>
                      <span className="text-gray-500">你的答案：</span>
                      <span className="font-bold text-red-600">{studentWord}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
        style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}
      >
        <div className="max-w-md mx-auto pointer-events-auto flex flex-col gap-2">
          {!otherDone && (
            <button
              type="button"
              onClick={onGoOther}
              className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
            >
              前往{otherModeLabel}
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface-variant bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] transition-all"
          >
            重新做題
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component (thin orchestrator)                                  */
/* ------------------------------------------------------------------ */

const VocabDefinitionMatch: React.FC<VocabDefinitionMatchProps> = ({
  story,
  onFinish,
  initialProgress,
  onProgressChange,
}) => {
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;
  void zh; // used by child components via fontForZhuyin
  const zhuyinFont = fontForZhuyin(zhuyinActive);

  const progressStorageKey = scopedStepStorageKey('vocabDef_progress_', story.id);
  const vocab: VocabItem[] = story.vocabulary ?? [];
  const hasData = vocab.length > 0;
  const allIndices = useMemo(() => vocab.map((_, i) => i), [vocab]);

  const persistedProgress = useMemo<PersistedProgress>(() => {
    try {
      const raw = localStorage.getItem(progressStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as PersistedProgress;
    } catch {
      return {};
    }
  }, [progressStorageKey]);

  const mergedInitialProgress = useMemo<PersistedProgress>(() => {
    const source = initialProgress && typeof initialProgress === 'object'
      ? (initialProgress as PersistedProgress)
      : {};
    return mergePersistedProgress(source, persistedProgress);
  }, [initialProgress, persistedProgress]);

  const [mode, setMode] = useState<InteractionMode>(() => {
    const persistedMode = mergedInitialProgress.mode;
    if (persistedMode === 'multiple-choice' || persistedMode === 'drag-drop') {
      return persistedMode;
    }
    return 'multiple-choice';
  });

  const [phase, setPhase] = useState<Phase>(() => {
    const p = mergedInitialProgress.phase;
    return p === 'matching' || p === 'summary' ? p : 'matching';
  });

  // Which defIndices are active in the current stage
  const [activeDefIndices, setActiveDefIndices] = useState<number[]>(() =>
    Array.isArray(mergedInitialProgress.activeDefIndices)
      ? mergedInitialProgress.activeDefIndices
      : vocab.map((_, i) => i),
  );

  // Stable shuffled word order for drag-drop (regenerated on retry)
  const shuffledWords = useRef<number[]>(shuffle(vocab.map((_, i) => i)));

  const [mcAnswers, setMcAnswers] = useState<AnswerRecord[]>(() =>
    Array.isArray(mergedInitialProgress.mcAnswers)
      ? mergedInitialProgress.mcAnswers
      : [],
  );

  const [dragDropAnswers, setDragDropAnswers] = useState<AnswerRecord[]>(() =>
    Array.isArray(mergedInitialProgress.dragDropAnswers)
      ? mergedInitialProgress.dragDropAnswers
      : [],
  );

  const isStepCompleted =
    phase === 'summary' && mcAnswers.length > 0 && dragDropAnswers.length > 0;

  const buildProgressPayload = useCallback(() => ({
    mode,
    phase,
    activeDefIndices,
    mcAnswers,
    dragDropAnswers,
    completed: isStepCompleted,
  }), [mode, phase, activeDefIndices, mcAnswers, dragDropAnswers, isStepCompleted]);

  // Persist to localStorage so page close / logout / cross-step navigation can restore.
  useEffect(() => {
    try {
      const payload: PersistedProgress = buildProgressPayload();
      localStorage.setItem(progressStorageKey, JSON.stringify(payload));
    } catch {}
  }, [progressStorageKey, buildProgressPayload]);

  // Persist process data so reopen can restore previous learning status.
  useEffect(() => {
    if (!onProgressChange) return;
    onProgressChange(buildProgressPayload(), false);
  }, [onProgressChange, buildProgressPayload]);

  const completionFlushedRef = useRef(false);
  useEffect(() => {
    if (!onProgressChange) return;
    if (!isStepCompleted) {
      completionFlushedRef.current = false;
      return;
    }
    if (completionFlushedRef.current) return;

    onProgressChange(buildProgressPayload(), true);
    completionFlushedRef.current = true;
  }, [onProgressChange, isStepCompleted, buildProgressPayload]);

  const startStage = useCallback((nextMode: InteractionMode, indices: number[]) => {
    setMode(nextMode);
    setPhase('matching');
    setActiveDefIndices(indices);
    shuffledWords.current = shuffle(indices);
  }, []);

  const mcDone = mcAnswers.length > 0;
  const dragDropDone = dragDropAnswers.length > 0;

  const goToSummaryIfBothDone = useCallback(
    (nextMcAnswers: AnswerRecord[], nextDragDropAnswers: AnswerRecord[]) => {
      if (nextMcAnswers.length > 0 && nextDragDropAnswers.length > 0) {
        setPhase('summary');
      }
    },
    [],
  );

  const handleSelectMode = useCallback(
    (nextMode: InteractionMode) => {
      if (nextMode === mode) return;
      setMode(nextMode);
      if (nextMode === 'multiple-choice' && !mcDone) {
        setActiveDefIndices(allIndices);
      }
      if (nextMode === 'drag-drop' && !dragDropDone) {
        setActiveDefIndices(allIndices);
        shuffledWords.current = shuffle(allIndices);
      }
    },
    [mode, mcDone, dragDropDone, allIndices],
  );

  const handleAllDone = useCallback((answers: AnswerRecord[]) => {
    if (mode === 'multiple-choice') {
      setMcAnswers(answers);
      goToSummaryIfBothDone(answers, dragDropAnswers);
      return;
    }
    setDragDropAnswers(answers);
    goToSummaryIfBothDone(mcAnswers, answers);
  }, [mode, mcAnswers, dragDropAnswers, goToSummaryIfBothDone]);

  const handleRetryModeWrong = useCallback((targetMode: InteractionMode) => {
    const sourceAnswers = targetMode === 'multiple-choice' ? mcAnswers : dragDropAnswers;
    const wrongIndices = selectRetryIndices(sourceAnswers);
    if (wrongIndices.length === 0) return;
    startStage(targetMode, wrongIndices);
  }, [mcAnswers, dragDropAnswers, startStage]);

  const handleRetryAll = useCallback(() => {
    setMcAnswers([]);
    setDragDropAnswers([]);
    startStage('multiple-choice', allIndices);
  }, [startStage, allIndices]);

  const handleRetryMc = useCallback(() => {
    setMcAnswers([]);
    startStage('multiple-choice', allIndices);
  }, [startStage, allIndices]);

  const handleRetryDragDrop = useCallback(() => {
    setDragDropAnswers([]);
    startStage('drag-drop', allIndices);
  }, [startStage, allIndices]);

  const handleFinish = useCallback(() => {
    const correctCount =
      mcAnswers.filter((a) => a.correct).length +
      dragDropAnswers.filter((a) => a.correct).length;
    onProgressChange?.(
      buildProgressPayload(),
      true,
    );
    onFinish({ matchedCount: correctCount, totalCount: vocab.length * 2 });
  }, [
    onProgressChange,
    buildProgressPayload,
    onFinish,
    vocab.length,
  ]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface overflow-hidden" style={{ fontFamily: zhuyinFont }}>
      <div className="flex-1 overflow-y-auto min-h-0 py-6">
        {!hasData ? (
          <NoDataFallback onFinish={handleFinish} />
        ) : phase === 'summary' ? (
          <SummaryScreen
            inToolbox={isToolboxMode()}
            vocab={vocab}
            mcAnswers={mcAnswers}
            dragDropAnswers={dragDropAnswers}
            onRetryModeWrong={handleRetryModeWrong}
            onRetryAll={handleRetryAll}
            onFinish={handleFinish}
          />
        ) : (
          <>
            <StageStatus
              current={mode}
              mcDone={mcDone}
              dragDropDone={dragDropDone}
              onSelectMode={handleSelectMode}
            />

            {mode === 'multiple-choice' && (
              mcDone ? (
                <StageCompletedPlaceholder
                  title="選擇題"
                  vocab={vocab}
                  answers={mcAnswers}
                  otherModeLabel="拖拉配對"
                  otherDone={dragDropDone}
                  onGoOther={() => handleSelectMode('drag-drop')}
                  onRetry={handleRetryMc}
                />
              ) : (
                <MultipleChoiceMode
                  vocab={vocab}
                  activeDefIndices={activeDefIndices}
                  onAllDone={handleAllDone}
                />
              )
            )}
            {mode === 'drag-drop' && (
              dragDropDone ? (
                <StageCompletedPlaceholder
                  title="拖拉配對"
                  vocab={vocab}
                  answers={dragDropAnswers}
                  otherModeLabel="選擇題"
                  otherDone={mcDone}
                  onGoOther={() => handleSelectMode('multiple-choice')}
                  onRetry={handleRetryDragDrop}
                />
              ) : (
                <DragDropMode
                  vocab={vocab}
                  activeDefIndices={activeDefIndices}
                  shuffledWords={shuffledWords.current}
                  onAllDone={handleAllDone}
                />
              )
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default VocabDefinitionMatch;
