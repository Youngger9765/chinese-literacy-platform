/**
 * ComprehensionChat — 課文理解（學習單模式）(#929)
 *
 * Layout: left=scrollable lesson text card, right=MCQ/structure/strategy tabs
 * AI 功能為獨立浮動小助手（FloatingAIHelper）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Story, ReadingAttempt, ComprehensionResult } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import StoryStructureTable from './StoryStructureTable';
import MultipleChoiceExercise from './MultipleChoiceExercise';
import FloatingAIHelper from './FloatingAIHelper';
import StrategyExercise from './StrategyExercise';
import { scopedStepStorageKey } from '../../services/learningStorageScope';

interface ComprehensionChatProps {
  story: Story;
  attempt: ReadingAttempt;
  onFinish: (result: ComprehensionResult) => void;
  onBack: () => void;
  dbSessionId?: number;
  initialProgress?: Record<string, unknown>;
  onProgressChange?: (stepData: Record<string, unknown>, immediate?: boolean) => void;
}

interface TabCompletion {
  structureVisited: boolean;
  mcqDone: boolean;
  strategyDone: boolean;
}

const ComprehensionChat: React.FC<ComprehensionChatProps> = ({
  story,
  attempt,
  onFinish,
  onBack,
  dbSessionId,
  initialProgress,
  onProgressChange,
}) => {
  const completionKey = scopedStepStorageKey('comprehension_completion_', story.id);

  const loadCompletion = (): TabCompletion => {
    try {
      const raw = localStorage.getItem(completionKey);
      if (!raw) return { structureVisited: false, mcqDone: false, strategyDone: false };
      return { structureVisited: false, mcqDone: false, strategyDone: false, ...JSON.parse(raw) };
    } catch { return { structureVisited: false, mcqDone: false, strategyDone: false }; }
  };

  const persistedTabCompletion = useMemo(() => {
    const raw = initialProgress?.tabCompletion;
    if (!raw || typeof raw !== 'object') return null;
    return raw as TabCompletion;
  }, [initialProgress]);

  const persistedActiveTab = useMemo(() => {
    const raw = initialProgress?.activeTab;
    return raw === 'mcq' || raw === 'structure' || raw === 'strategy' ? raw : null;
  }, [initialProgress]);

  const persistedMcqScore = useMemo(() => {
    const raw = initialProgress?.mcqScore;
    return typeof raw === 'number' ? raw : null;
  }, [initialProgress]);

  const persistedMcqTotal = useMemo(() => {
    const raw = initialProgress?.mcqTotal;
    return typeof raw === 'number' ? raw : null;
  }, [initialProgress]);

  const [tabCompletion, setTabCompletion] = useState<TabCompletion>(
    () => persistedTabCompletion ?? loadCompletion(),
  );
  const [mcqScore, setMcqScore] = useState<number>(persistedMcqScore ?? 0);
  const [mcqTotal, setMcqTotal] = useState<number>(persistedMcqTotal ?? 0);

  const hasMcq = !!(story.multipleChoice && story.multipleChoice.length > 0);
  const hasStrategy = !!story.strategyExercise;

  const [activeTab, setActiveTab] = useState<'mcq' | 'structure' | 'strategy'>(
    persistedActiveTab ?? (hasMcq ? 'mcq' : 'structure'),
  );

  const { zhuyinActive, processLines: zhuyinProcessLines } = useZhuyin();

  const zhuyinLines = useMemo(() => {
    if (!zhuyinActive) return null;
    return zhuyinProcessLines(story.content);
  }, [story.content, zhuyinActive, zhuyinProcessLines]);

  const handleTabChange = useCallback((tab: 'mcq' | 'structure' | 'strategy') => {
    setActiveTab(tab);
    if (tab === 'structure' && !tabCompletion.structureVisited) {
      setTabCompletion(prev => ({ ...prev, structureVisited: true }));
    }
  }, [tabCompletion.structureVisited]);

  const handleMcqComplete = useCallback((score: number, total: number) => {
    setTabCompletion(prev => ({ ...prev, mcqDone: true }));
    setMcqScore(score);
    setMcqTotal(total);
  }, []);

  const handleStructureRedo = useCallback(() => {
    setTabCompletion(prev => ({ ...prev, structureVisited: false }));
    setTimeout(() => {
      setTabCompletion(prev => ({ ...prev, structureVisited: true }));
    }, 0);
  }, []);

  const handleMcqRedo = useCallback(() => {
    setTabCompletion(prev => ({ ...prev, mcqDone: false }));
    setMcqScore(0);
    setMcqTotal(0);
  }, []);

  const handleStrategyComplete = useCallback(() => {
    setTabCompletion(prev => ({ ...prev, strategyDone: true }));
  }, []);

  const isWorksheetComplete = hasMcq ? tabCompletion.mcqDone : tabCompletion.structureVisited;

  // Persist progress to DB
  useEffect(() => {
    if (!onProgressChange) return;
    onProgressChange(
      { tabCompletion, activeTab, mcqScore, mcqTotal, isWorksheetComplete },
      false,
    );
  }, [onProgressChange, tabCompletion, activeTab, mcqScore, mcqTotal, isWorksheetComplete]);

  useEffect(() => {
    try {
      localStorage.setItem(completionKey, JSON.stringify(tabCompletion));
    } catch {}
  }, [tabCompletion, completionKey]);

  const handleFinish = useCallback(() => {
    onProgressChange?.(
      { tabCompletion, activeTab, mcqScore, mcqTotal, isWorksheetComplete: true },
      true,
    );
    onFinish({
      understoodCount: mcqScore,
      requiredCount: mcqTotal || 1,
      isComplete: true,
      conversationLength: 0,
    });
  }, [onProgressChange, tabCompletion, activeTab, mcqScore, mcqTotal, onFinish]);

  const storyText = useMemo(() => story.content.join('\n'), [story.content]);

  // ── Segmented tab control ──────────────────────────────────────────
  const renderTabs = () => (
    <div className="flex bg-surface-container-high rounded-full p-1.5 mb-4">
      {hasMcq && (
        <button
          onClick={() => handleTabChange('mcq')}
          className={`flex-1 px-5 py-3 rounded-full text-sm font-headline font-bold transition-all ${
            activeTab === 'mcq'
              ? 'bg-surface-container-lowest text-accent shadow-sm'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          AI提問
          {tabCompletion.mcqDone && <span className="ml-1.5 text-emerald-500">✓</span>}
        </button>
      )}
      <button
        onClick={() => handleTabChange('structure')}
        className={`flex-1 px-5 py-3 rounded-full text-sm font-headline font-bold transition-all ${
          activeTab === 'structure'
            ? 'bg-surface-container-lowest text-accent shadow-sm'
            : 'text-on-surface-variant hover:text-on-surface'
        }`}
      >
        文章重點表
        {tabCompletion.structureVisited && <span className="ml-1.5 text-emerald-500">✓</span>}
      </button>
      {hasStrategy && (
        <button
          onClick={() => handleTabChange('strategy')}
          className={`flex-1 px-5 py-3 rounded-full text-sm font-headline font-bold transition-all ${
            activeTab === 'strategy'
              ? 'bg-surface-container-lowest text-accent shadow-sm'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          閱讀策略
          {tabCompletion.strategyDone && <span className="ml-1.5 text-emerald-500">✓</span>}
        </button>
      )}
    </div>
  );

  // ── Right panel content ──────────────────────────────────────────
  const renderRightContent = () => {
    if (activeTab === 'structure') {
      return (
        <>
          <StoryStructureTable storyId={story.id} />
          {tabCompletion.structureVisited && (
            <div className="mt-6 text-center">
              <button onClick={handleStructureRedo} className="text-xs text-on-surface-variant hover:text-on-surface underline">
                重新練習
              </button>
            </div>
          )}
        </>
      );
    }

    if (activeTab === 'strategy' && hasStrategy && story.strategyExercise) {
      return (
        <StrategyExercise
          exercise={story.strategyExercise}
          onComplete={handleStrategyComplete}
        />
      );
    }

    // MCQ
    if (hasMcq) {
      if (tabCompletion.mcqDone) {
        return (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-emerald-600">check_circle</span>
            </div>
            <p className="text-emerald-700 font-headline font-bold">選擇題已完成</p>
            <p className="text-sm text-on-surface-variant">答對 {mcqScore} / {mcqTotal} 題</p>
            <button
              onClick={handleMcqRedo}
              className="px-5 py-2.5 rounded-full text-sm font-bold bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest transition-all"
            >
              重新練習
            </button>
          </div>
        );
      }
      return (
        <MultipleChoiceExercise
          questions={story.multipleChoice!}
          onComplete={handleMcqComplete}
        />
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-on-surface-variant">
        <span className="material-symbols-outlined text-5xl opacity-30">quiz</span>
        <p className="text-sm">此課文尚未有選擇題</p>
        <p className="text-xs">可以切換到「文章重點表」查看重點</p>
      </div>
    );
  };

  // ── Progress bar ─────────────────────────────────────────────────
  const completedCount = [tabCompletion.mcqDone, tabCompletion.structureVisited, tabCompletion.strategyDone && hasStrategy].filter(Boolean).length;
  const totalTabs = [hasMcq, true, hasStrategy].filter(Boolean).length;
  const progressPercent = totalTabs > 0 ? Math.round((completedCount / totalTabs) * 100) : 0;

  return (
    <div
      className="flex flex-col flex-1 h-full bg-surface overflow-hidden relative"
    >
      {/* ── Main content area — fills viewport, no page scroll ──── */}
      <div className="flex-1 min-h-0 px-4 md:px-6 py-6 md:py-8">
        <div className="w-full h-full grid grid-cols-1 md:grid-cols-12 gap-6">

          {/* ── Left: Story text card ────────────────────────────── */}
          <div className="md:col-span-7 lg:col-span-7 min-h-0 flex">
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-8 flex flex-col w-full">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <span className="material-symbols-outlined text-accent text-xl">menu_book</span>
                <span className="font-headline font-bold text-on-surface text-sm uppercase tracking-wider">參考課文</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar space-y-6">
                {story.content.map((line, idx) => (
                  <div key={idx} className="flex gap-3 items-start">
                    <span className="text-xs font-headline font-bold text-on-surface-variant/30 pt-1 select-none shrink-0 w-5 text-right">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <p className={`text-lg md:text-xl text-on-surface leading-[2.6rem] md:leading-[3rem] ${zhuyinActive ? 'tracking-[0.3em]' : ''}`}>
                      {zhuyinLines ? zhuyinLines[idx] : line}
                    </p>
                  </div>
                ))}
              </div>
              {/* Reading comprehension progress */}
              <div className="mt-4 pt-4 border-t border-surface-container-high shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-headline font-bold text-on-surface-variant">閱讀理解度</span>
                  <span className="text-xs font-headline font-bold text-accent">{progressPercent}%</span>
                </div>
                <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Right: Exercise panel ─────────────────────────────── */}
          <div className="md:col-span-5 lg:col-span-5 min-h-0 flex flex-col">
            <div className="shrink-0">{renderTabs()}</div>
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-8 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {renderRightContent()}
            </div>
          </div>
        </div>
      </div>

      {/* ── Fixed bottom CTA — shows after MCQ (or structure) is complete ── */}
      {isWorksheetComplete && (
        <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
             style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
          <div className="max-w-md mx-auto pointer-events-auto">
            <button
              onClick={handleFinish}
              className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
            >
              <span>下一關</span>
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating AI helper */}
      <FloatingAIHelper
        storyTitle={story.title}
        storyText={storyText}
        dbSessionId={dbSessionId}
      />

      {/* Skip button when worksheet not yet complete */}
      {/* Background decoration */}
      <div className="fixed top-0 right-0 -z-10 w-96 h-96 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-0 -z-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #b0ada6; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #797770; }
      `}</style>
    </div>
  );
};

export default ComprehensionChat;
