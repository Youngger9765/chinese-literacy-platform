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

  const handleAllDone = useCallback((answers: AnswerRecord[]) => {
    if (mode === 'multiple-choice') {
      setMcAnswers(answers);
      startStage('drag-drop', allIndices);
      return;
    }
    setDragDropAnswers(answers);
    setPhase('summary');
  }, [mode, startStage, allIndices]);

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
              mcDone={mcAnswers.length > 0}
              dragDropDone={dragDropAnswers.length > 0}
            />

            {mode === 'multiple-choice' && (
              <MultipleChoiceMode
                vocab={vocab}
                activeDefIndices={activeDefIndices}
                onAllDone={handleAllDone}
              />
            )}
            {mode === 'drag-drop' && (
              <DragDropMode
                vocab={vocab}
                activeDefIndices={activeDefIndices}
                shuffledWords={shuffledWords.current}
                onAllDone={handleAllDone}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default VocabDefinitionMatch;
