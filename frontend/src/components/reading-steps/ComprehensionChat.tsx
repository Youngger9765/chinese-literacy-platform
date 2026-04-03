/**
 * ComprehensionChat — 課文理解（學習單模式）(#929)
 *
 * 2026-04-03 會議決議：移除 AI 對話 tab，改為左邊課文 + 右邊選擇題的學習單模式
 * AI 功能改為獨立浮動小助手（FloatingAIHelper）
 *
 * Layout:
 *   Desktop: left=scrollable lesson text, right=MCQ/structure tabs
 *   Mobile:  tab switcher between story / MCQ / structure
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Story, ReadingAttempt, ComprehensionResult } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import StoryStructureTable from './StoryStructureTable';
import MultipleChoiceExercise from './MultipleChoiceExercise';
import FloatingAIHelper from './FloatingAIHelper';

interface ComprehensionChatProps {
  story: Story;
  attempt: ReadingAttempt;
  rightPanelWidth: number;
  onPanelWidthChange: (w: number) => void;
  onFinish: (result: ComprehensionResult) => void;
  onBack: () => void;
  dbSessionId?: number;
  initialProgress?: Record<string, unknown>;
  onProgressChange?: (stepData: Record<string, unknown>, immediate?: boolean) => void;
}

// Per-tab completion tracking (adapted from #846)
interface TabCompletion {
  structureVisited: boolean;
  mcqDone: boolean;
}

const ComprehensionChat: React.FC<ComprehensionChatProps> = ({
  story,
  attempt,
  rightPanelWidth,
  onPanelWidthChange,
  onFinish,
  onBack,
  dbSessionId,
  initialProgress,
  onProgressChange,
}) => {
  const completionKey = `comprehension_completion_${story.id}`;

  const loadCompletion = (): TabCompletion => {
    try {
      const raw = localStorage.getItem(completionKey);
      if (!raw) return { structureVisited: false, mcqDone: false };
      return { structureVisited: false, mcqDone: false, ...JSON.parse(raw) };
    } catch { return { structureVisited: false, mcqDone: false }; }
  };

  const persistedTabCompletion = useMemo(() => {
    const raw = initialProgress?.tabCompletion;
    if (!raw || typeof raw !== 'object') return null;
    return raw as TabCompletion;
  }, [initialProgress]);

  const persistedActiveTab = useMemo(() => {
    const raw = initialProgress?.activeTab;
    return raw === 'story' || raw === 'mcq' || raw === 'structure' ? raw : null;
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

  const isMobile = useIsMobile();
  const hasMcq = !!(story.multipleChoice && story.multipleChoice.length > 0);

  // Default to MCQ tab if available, otherwise structure
  const [activeTab, setActiveTab] = useState<'story' | 'mcq' | 'structure'>(
    persistedActiveTab ?? (hasMcq ? 'mcq' : 'structure'),
  );

  const { zhuyinActive, processZhuyin, processLines: zhuyinProcessLines } = useZhuyin();

  // Resizable right panel (desktop)
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(384);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.clientX;
      onPanelWidthChange(Math.max(240, Math.min(600, dragStartWidthRef.current + delta)));
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current || !e.touches.length) return;
      const delta = dragStartXRef.current - e.touches[0].clientX;
      onPanelWidthChange(Math.max(240, Math.min(600, dragStartWidthRef.current + delta)));
    };
    const onEnd = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [onPanelWidthChange]);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = rightPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  const onDividerTouchStart = (e: React.TouchEvent) => {
    if (!e.touches.length) return;
    isDraggingRef.current = true;
    dragStartXRef.current = e.touches[0].clientX;
    dragStartWidthRef.current = rightPanelWidth;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  const zhuyinLines = useMemo(() => {
    if (!zhuyinActive) return null;
    return zhuyinProcessLines(story.content);
  }, [story.content, zhuyinActive, zhuyinProcessLines]);

  // Tab change handler
  const handleTabChange = useCallback((tab: 'story' | 'mcq' | 'structure') => {
    setActiveTab(tab);
    if (tab === 'structure' && !tabCompletion.structureVisited) {
      setTabCompletion(prev => ({ ...prev, structureVisited: true }));
    }
  }, [tabCompletion.structureVisited]);

  // MCQ completion handler
  const handleMcqComplete = useCallback((score: number, total: number) => {
    setTabCompletion(prev => ({ ...prev, mcqDone: true }));
    setMcqScore(score);
    setMcqTotal(total);
  }, []);

  // Redo handlers
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

  // Check if worksheet is complete (MCQ done or no MCQ available)
  const isWorksheetComplete = hasMcq ? tabCompletion.mcqDone : tabCompletion.structureVisited;

  // Persist progress to DB
  useEffect(() => {
    if (!onProgressChange) return;
    onProgressChange(
      {
        tabCompletion,
        activeTab,
        mcqScore,
        mcqTotal,
        isWorksheetComplete,
      },
      false,
    );
  }, [onProgressChange, tabCompletion, activeTab, mcqScore, mcqTotal, isWorksheetComplete]);

  // Persist tab completion to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(completionKey, JSON.stringify(tabCompletion));
    } catch {}
  }, [tabCompletion, completionKey]);

  // Finish handler
  const handleFinish = useCallback(() => {
    onProgressChange?.(
      {
        tabCompletion,
        activeTab,
        mcqScore,
        mcqTotal,
        isWorksheetComplete: true,
      },
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

  // ── Tab bar component ──────────────────────────────────────────────
  const renderTabBar = (includeStory = false) => (
    <div className="flex items-center justify-center gap-1 px-3 py-2 bg-white border-b border-gray-200">
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        {includeStory && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'story'}
            onClick={() => handleTabChange('story')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'story'
                ? 'bg-white text-accent shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            課文
          </button>
        )}
        {hasMcq && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mcq'}
            onClick={() => handleTabChange('mcq')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'mcq'
                ? 'bg-white text-accent shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            選擇題
            {tabCompletion.mcqDone && (
              <span className="text-emerald-500 text-xs leading-none">✓</span>
            )}
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'structure'}
          onClick={() => handleTabChange('structure')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'structure'
              ? 'bg-white text-accent shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          重點表
          {tabCompletion.structureVisited && (
            <span className="text-emerald-500 text-xs leading-none">✓</span>
          )}
        </button>
      </div>
    </div>
  );

  // ── Story panel (desktop left side) ────────────────────────────────
  const renderDesktopStoryPanel = () => (
    <div className="flex-1 flex flex-col bg-amber-50 min-w-0">
      {/* Tab header */}
      <div className="h-9 bg-white border-b border-gray-200 flex items-center px-2 gap-2 shrink-0">
        <div className="h-full px-4 flex items-center bg-amber-50 border-t-2 border-accent border-x border-gray-200 text-xs text-gray-800 gap-2">
          {story.filename}
        </div>
        <div className="flex-1" />
      </div>

      {/* Story content */}
      <div className="flex-1 p-8 lg:p-16 overflow-y-auto custom-scrollbar">
        <div className="max-w-3xl mx-auto space-y-20">
          {story.content.map((line, idx) => (
            <div
              key={idx}
              className="rounded-2xl px-6 py-12 border border-transparent hover:border-gray-200 hover:bg-white/40 transition-all"
            >
              <p className={`text-2xl lg:text-3xl text-gray-900 leading-[3.5rem] lg:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}>
                {zhuyinLines ? zhuyinLines[idx] : line}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div className="h-7 bg-white border-t border-gray-200 flex items-center px-4 text-[10px] text-gray-500 uppercase shrink-0">
        <span>共 {story.content.length} 段 · {story.title}</span>
      </div>
    </div>
  );

  // ── Right panel content (desktop) ──────────────────────────────────
  const renderDesktopRightPanel = () => {
    if (activeTab === 'structure') {
      return (
        <div className="flex-shrink-0 bg-white flex flex-col h-full min-h-0" style={{ width: rightPanelWidth }}>
          <div className="shrink-0 bg-white border-b border-gray-200 flex items-center justify-center gap-2 px-3 py-1.5">
            <span className="text-xs text-gray-500">文章重點表</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar bg-gray-50">
            <StoryStructureTable storyId={story.id} />
            {tabCompletion.structureVisited && (
              <div className="mt-6 text-center">
                <button
                  onClick={handleStructureRedo}
                  className="text-xs text-gray-400 hover:text-gray-600 underline"
                >
                  重新練習
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Default: MCQ panel
    return (
      <div className="flex-shrink-0 bg-white flex flex-col h-full min-h-0" style={{ width: rightPanelWidth }}>
        <div className="shrink-0 bg-white border-b border-gray-200 flex items-center justify-center gap-2 px-3 py-1.5">
          <span className="text-xs text-gray-500">閱讀理解選擇題</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar bg-gray-50">
          {hasMcq ? (
            tabCompletion.mcqDone ? (
              <div className="flex flex-col items-center justify-center p-8 gap-4">
                <div className="text-4xl text-emerald-500">✓</div>
                <p className="text-emerald-700 font-semibold text-sm">選擇題已完成</p>
                <p className="text-gray-500 text-xs">答對 {mcqScore} / {mcqTotal} 題</p>
                <button
                  onClick={handleMcqRedo}
                  className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200 transition-colors"
                >
                  重新練習
                </button>
              </div>
            ) : (
              <MultipleChoiceExercise
                questions={story.multipleChoice!}
                onComplete={handleMcqComplete}
              />
            )
          ) : (
            <div className="flex flex-col items-center justify-center p-8 gap-3 text-gray-400">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">此課文尚未有選擇題</p>
              <p className="text-xs">可以切換到「重點表」查看文章重點</p>
            </div>
          )}
        </div>
        {/* Bottom action bar */}
        {isWorksheetComplete && (
          <div className="shrink-0 bg-white border-t border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={onBack}
                className="px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:text-gray-900 transition-colors"
              >
                ← 上一步
              </button>
              <button
                onClick={handleFinish}
                className="flex-1 py-2.5 rounded-full font-bold text-sm bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                繼續下一步
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="flex flex-col flex-1 h-full bg-amber-50 overflow-hidden relative"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {isMobile ? (
        /* MOBILE: Tab-based layout */
        <>
          {renderTabBar(true)}

          {activeTab === 'story' ? (
            <div className="flex-1 flex flex-col bg-amber-50 min-h-0">
              <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
                <div className="max-w-3xl mx-auto space-y-12">
                  {story.content.map((line, idx) => (
                    <div
                      key={idx}
                      className="rounded-2xl px-4 py-8 border border-transparent hover:border-gray-200 hover:bg-white/40 transition-all"
                    >
                      <p className={`text-2xl text-gray-900 leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}>
                        {zhuyinLines ? zhuyinLines[idx] : line}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              {/* Skip button on story tab for mobile */}
              <div className="shrink-0 bg-white border-t border-gray-200 p-3 flex items-center justify-center gap-3">
                <button
                  onClick={() => handleTabChange(hasMcq ? 'mcq' : 'structure')}
                  className="py-2.5 px-6 rounded-full font-bold text-sm bg-accent hover:bg-accent-hover text-white shadow transition-all active:scale-95"
                >
                  開始作答 →
                </button>
              </div>
            </div>
          ) : activeTab === 'structure' ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                <StoryStructureTable storyId={story.id} />
                {tabCompletion.structureVisited && (
                  <div className="mt-4 text-center">
                    <button
                      onClick={handleStructureRedo}
                      className="text-xs text-gray-400 hover:text-gray-600 underline"
                    >
                      重新練習
                    </button>
                  </div>
                )}
              </div>
              {isWorksheetComplete && (
                <div className="shrink-0 bg-white border-t border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={onBack}
                      className="px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:text-gray-900 transition-colors"
                    >
                      ← 上一步
                    </button>
                    <button
                      onClick={handleFinish}
                      className="flex-1 py-2.5 rounded-full font-bold text-sm bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      繼續下一步
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* MCQ panel */
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                {hasMcq ? (
                  tabCompletion.mcqDone ? (
                    <div className="flex flex-col items-center justify-center p-8 gap-4">
                      <div className="text-4xl text-emerald-500">✓</div>
                      <p className="text-emerald-700 font-semibold text-sm">選擇題已完成</p>
                      <p className="text-gray-500 text-xs">答對 {mcqScore} / {mcqTotal} 題</p>
                      <button
                        onClick={handleMcqRedo}
                        className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200 transition-colors"
                      >
                        重新練習
                      </button>
                    </div>
                  ) : (
                    <MultipleChoiceExercise
                      questions={story.multipleChoice!}
                      onComplete={handleMcqComplete}
                    />
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 gap-3 text-gray-400">
                    <p className="text-sm">此課文尚未有選擇題</p>
                    <p className="text-xs">可以切換到「重點表」查看文章重點</p>
                  </div>
                )}
              </div>
              {isWorksheetComplete && (
                <div className="shrink-0 bg-white border-t border-gray-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={onBack}
                      className="px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:text-gray-900 transition-colors"
                    >
                      ← 上一步
                    </button>
                    <button
                      onClick={handleFinish}
                      className="flex-1 py-2.5 rounded-full font-bold text-sm bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      繼續下一步
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* DESKTOP: dual-pane layout — story left + worksheet right */
        <>
          {/* Tab bar */}
          <div className="shrink-0 z-10">
            {renderTabBar(false)}
          </div>

          {/* Dual-pane area */}
          <div className="flex flex-row flex-1 min-h-0">
            {renderDesktopStoryPanel()}

            {/* Resizable divider */}
            <div
              onMouseDown={onDividerMouseDown}
              onTouchStart={onDividerTouchStart}
              className="w-1 flex-shrink-0 bg-gray-200 hover:bg-accent cursor-col-resize transition-colors"
            />

            {renderDesktopRightPanel()}
          </div>
        </>
      )}

      {/* Floating AI helper — replaces the removed AI dialogue tab */}
      <FloatingAIHelper
        storyTitle={story.title}
        storyText={storyText}
        dbSessionId={dbSessionId}
      />

      {/* Skip/finish button when worksheet not yet complete */}
      {!isWorksheetComplete && !isMobile && (
        <div className="absolute bottom-4 left-4 z-20">
          <button
            onClick={handleFinish}
            className="text-xs text-gray-400 hover:text-gray-600 bg-white/80 backdrop-blur rounded-lg px-3 py-1.5 border border-gray-200 transition-colors"
          >
            跳過此步驟
          </button>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
      `}</style>
    </div>
  );
};

export default ComprehensionChat;
