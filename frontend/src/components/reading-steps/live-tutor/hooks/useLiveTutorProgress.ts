import { useState, useRef, useMemo, useCallback } from 'react';
import { Story, ReadingAttempt } from '../../../../types';
import { useAuth } from '../../../../contexts/AuthContext';
import { saveReadingHistory } from '../../../../services/readingHistoryApi';
import { extractPracticeChars } from '../../../../utils/liveTutorHelpers';
import { isToolboxMode, scopedStepStorageKey } from '../../../../services/learningStorageScope';
import { LineResult, ParagraphSummaryData } from '../liveTutorTypes';
import { ParagraphStatus } from '../../ParagraphProgress';
import type { TutorStepData } from '../../../../types/stepProgress';

export type ProgressPhase =
  | 'idle'
  | 'active'
  | 'advancing'
  | 'done';

export interface UseLiveTutorProgressReturn {
  // State
  currentLineIndex: number;
  setCurrentLineIndex: (idx: number) => void;
  lineResults: LineResult[];
  setLineResults: React.Dispatch<React.SetStateAction<LineResult[]>>;
  completedParagraphs: Set<number>;
  setCompletedParagraphs: React.Dispatch<React.SetStateAction<Set<number>>>;
  paragraphSummaries: Record<number, ParagraphSummaryData>;
  setParagraphSummaries: React.Dispatch<React.SetStateAction<Record<number, ParagraphSummaryData>>>;
  isAdvancing: boolean;
  celebratingIndex: number | null;
  toolboxComplete: boolean;
  setToolboxComplete: (v: boolean) => void;
  // Refs
  isAdvancingRef: React.MutableRefObject<boolean>;
  savedProgressRef: React.MutableRefObject<ReturnType<typeof loadSavedProgress> | null>;
  // Derived
  lineStatuses: ParagraphStatus[];
  maxUnlockedIndex: number;
  overallMetrics: { accuracy: number; cpm: number } | null;
  // Handlers
  advanceParagraph: (lineIdx: number, allLineResults: LineResult[], stopSession: () => void) => void;
  handleSelectParagraph: (idx: number, stopSession: () => void) => void;
  handleFinish: (stopSession: () => void) => void;
  resetForRetry: () => void;
}

function loadSavedProgress(storageKey: string) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw) as {
      lineResults: LineResult[];
      paragraphSummaries: Record<number, ParagraphSummaryData>;
      completedParagraphs: number[];
      currentLineIndex: number;
    };
  } catch {
    return null;
  }
}

export function useLiveTutorProgress(
  story: Story,
  onFinish: (attempt: ReadingAttempt) => void,
  onParagraphComplete?: (completedParagraphIndex: number) => void,
  initialCompletedParagraphs?: Set<number>,
  /** Issue #2530: DB step_data['tutor'] — restore fallback when localStorage is empty
   *  (e.g. cross-session / cleared), so 逐段朗讀紀錄回歸. */
  initialProgress?: TutorStepData,
) {
  const { token } = useAuth();
  const storageKey = scopedStepStorageKey('liveTutor_progress_', story.id);
  const savedProgress = useRef(loadSavedProgress(storageKey));

  const [currentLineIndex, setCurrentLineIndex] = useState<number>(() => {
    const saved = savedProgress.current;
    if (saved) return saved.currentLineIndex ?? 0;
    return initialProgress?.current_line_index ?? 0;
  });

  const [lineResults, setLineResults] = useState<LineResult[]>(
    savedProgress.current?.lineResults ?? initialProgress?.line_results ?? [],
  );

  const [completedParagraphs, setCompletedParagraphs] = useState<Set<number>>(
    savedProgress.current?.completedParagraphs
      ? new Set(savedProgress.current.completedParagraphs)
      : initialProgress?.completed_paragraphs
        ? new Set(initialProgress.completed_paragraphs)
        : initialCompletedParagraphs ?? new Set<number>(),
  );

  const [paragraphSummaries, setParagraphSummaries] = useState<Record<number, ParagraphSummaryData>>(
    savedProgress.current?.paragraphSummaries ?? initialProgress?.paragraph_summaries_data ?? {},
  );

  const [isAdvancing, setIsAdvancing] = useState(false);
  const [celebratingIndex, setCelebratingIndex] = useState<number | null>(null);
  const [toolboxComplete, setToolboxComplete] = useState(false);

  const isAdvancingRef = useRef(false);

  // ── Derived ──────────────────────────────────────────────────────────────
  const lineStatuses = useMemo<ParagraphStatus[]>(() => {
    return story.content.map((_, idx) => {
      if (completedParagraphs.has(idx)) return 'completed';
      if (idx === currentLineIndex) return 'current';
      return 'locked';
    });
  }, [story.content, completedParagraphs, currentLineIndex]);

  const maxUnlockedIndex = useMemo(() => {
    let max = currentLineIndex;
    for (const idx of completedParagraphs) {
      if (idx > max) max = idx;
    }
    return max;
  }, [completedParagraphs, currentLineIndex]);

  const overallMetrics = useMemo(() => {
    if (lineResults.length === 0) return null;
    const avgMatchRate =
      lineResults.reduce((s, r) => s + r.matchRate, 0) / lineResults.length;
    const totalCorrectChars = lineResults.reduce(
      (s, r) =>
        s + r.diffTokens.filter((t) => t.type === 'correct' || t.type === 'forgiven').length,
      0,
    );
    const totalDurationSec = lineResults.reduce((s, r) => s + r.durationMs, 0) / 1000;
    const cpm =
      totalDurationSec > 0
        ? Math.round((totalCorrectChars / totalDurationSec) * 60)
        : 0;
    return { accuracy: Math.round(avgMatchRate * 100), cpm };
  }, [lineResults]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const saveParagraphReading = useCallback(
    (lineIdx: number, result: LineResult) => {
      if (!token) return;
      const durationSec = result.durationMs / 1000;
      if (durationSec <= 0) return;
      saveReadingHistory(
        {
          lesson_id: String(story.id),
          paragraph_index: lineIdx,
          reading_type: 'paragraph',
          cpm: result.cpm,
          accuracy: Math.round(result.matchRate * 100),
          duration_seconds: durationSec,
        },
        token,
      ).catch((err) => console.error('Failed to save paragraph reading history:', err));
    },
    [token, story.id],
  );

  const advanceParagraph = useCallback(
    (lineIdx: number, allLineResults: LineResult[], stopSession: () => void) => {
      const currentResult = allLineResults.find((r) => r.lineIndex === lineIdx);
      if (currentResult) saveParagraphReading(lineIdx, currentResult);

      const isLastLine = lineIdx >= story.content.length - 1;
      if (!isLastLine) {
        if (isAdvancingRef.current) return;
        isAdvancingRef.current = true;
        setIsAdvancing(true);
        stopSession();

        const nextIdx = lineIdx + 1;
        setCompletedParagraphs((prev) => {
          const s = new Set(prev);
          s.add(lineIdx);
          return s;
        });
        onParagraphComplete?.(lineIdx);
        setCelebratingIndex(nextIdx);
        setTimeout(() => setCelebratingIndex(null), 2000);

        setTimeout(() => {
          setCurrentLineIndex(nextIdx);
          isAdvancingRef.current = false;
          setIsAdvancing(false);
        }, 1500);
      } else {
        stopSession();
        setCompletedParagraphs((prev) => {
          const s = new Set(prev);
          s.add(lineIdx);
          return s;
        });
        onParagraphComplete?.(lineIdx);

        setTimeout(() => {
          const avgMatchRate =
            allLineResults.reduce((s, r) => s + r.matchRate, 0) / allLineResults.length;
          const totalCorrectChars = allLineResults.reduce(
            (s, r) =>
              s +
              r.diffTokens.filter((t) => t.type === 'correct' || t.type === 'forgiven').length,
            0,
          );
          const totalDurationSec =
            allLineResults.reduce((s, r) => s + r.durationMs, 0) / 1000;
          const overallCpm =
            totalDurationSec > 0
              ? Math.round((totalCorrectChars / totalDurationSec) * 60)
              : 0;
          if (isToolboxMode()) {
            setToolboxComplete(true);
            return;
          }
          onFinish({
            storyId: story.id,
            accuracy: Math.round(avgMatchRate * 100),
            fluency: overallCpm,
            cpm: overallCpm,
            mispronouncedWords: extractPracticeChars(allLineResults, story.content),
            transcription: allLineResults.map((r) => r.transcript).join(' '),
            timestamp: Date.now(),
            lineBreakdown: allLineResults.map((r) => ({
              lineIndex: r.lineIndex,
              matchRate: r.matchRate,
              cpm: r.cpm,
              transcript: r.transcript,
              diffTokens: r.diffTokens,
            })),
          });
        }, 2000);
      }
    },
    [story, onFinish, onParagraphComplete, saveParagraphReading],
  );

  const handleSelectParagraph = useCallback(
    (idx: number, stopSession: () => void) => {
      stopSession();
      setCurrentLineIndex(idx);
    },
    [],
  );

  const handleFinish = useCallback(
    (stopSession: () => void) => {
      stopSession();
      // Issue #2530: do NOT clear localStorage here. 「觀看總結報告」導航去 report 後
      // 學生常會返回逐段朗讀頁；清掉會讓「朗讀對照／這次成績」在 remount 後全部消失。
      // 只有明確「重練」(resetForRetry) 才清除。
      const avgMatchRate =
        lineResults.length > 0
          ? lineResults.reduce((s, r) => s + r.matchRate, 0) / lineResults.length
          : 0;
      const totalCorrectChars = lineResults.reduce(
        (s, r) =>
          s + r.diffTokens.filter((t) => t.type === 'correct' || t.type === 'forgiven').length,
        0,
      );
      const totalDurationSec = lineResults.reduce((s, r) => s + r.durationMs, 0) / 1000;
      const overallCpm =
        totalDurationSec > 0
          ? Math.round((totalCorrectChars / totalDurationSec) * 60)
          : 0;
      onFinish({
        storyId: story.id,
        accuracy: Math.round(avgMatchRate * 100),
        fluency: overallCpm,
        cpm: overallCpm,
        mispronouncedWords: extractPracticeChars(lineResults, story.content),
        transcription: lineResults.map((r) => r.transcript).join(' '),
        timestamp: Date.now(),
        lineBreakdown: lineResults.map((r) => ({
          lineIndex: r.lineIndex,
          matchRate: r.matchRate,
          cpm: r.cpm,
          transcript: r.transcript,
          diffTokens: r.diffTokens,
        })),
      });
    },
    [story, lineResults, onFinish],
  );

  const resetForRetry = useCallback(() => {
    setToolboxComplete(false);
    setCurrentLineIndex(0);
    setLineResults([]);
    setCelebratingIndex(null);
    setCompletedParagraphs(new Set());
    setParagraphSummaries({});
    try { localStorage.removeItem(storageKey); } catch {}
  }, [storageKey]);

  return {
    // State
    currentLineIndex,
    setCurrentLineIndex,
    lineResults,
    setLineResults,
    completedParagraphs,
    setCompletedParagraphs,
    paragraphSummaries,
    setParagraphSummaries,
    isAdvancing,
    celebratingIndex,
    toolboxComplete,
    setToolboxComplete,
    // Refs
    isAdvancingRef,
    savedProgressRef: savedProgress,
    // Derived
    lineStatuses,
    maxUnlockedIndex,
    overallMetrics,
    // Handlers
    advanceParagraph,
    handleSelectParagraph,
    handleFinish,
    resetForRetry,
  };
}
