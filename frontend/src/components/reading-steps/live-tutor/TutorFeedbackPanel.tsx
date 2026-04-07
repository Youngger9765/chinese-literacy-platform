import React from 'react';
import DiffDisplay from '../../ui/DiffDisplay';
import { DiffToken } from '../../../types';
import { ParagraphSummaryData } from './liveTutorTypes';

interface TutorFeedbackPanelProps {
  width: number;
  isMobile: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  isSessionActive: boolean;
  isPreparing: boolean;
  streamingUserInput: string;
  rightPanelDiffTokens: DiffToken[] | null;
  paragraphSummary: ParagraphSummaryData | null;
  currentLineIndex: number;
  totalLines: number;
  completedCount: number;
  retryCount: number;
  micError: string;
}

const TutorFeedbackPanel: React.FC<TutorFeedbackPanelProps> = ({
  width,
  isMobile,
  scrollRef,
  isSessionActive,
  isPreparing,
  streamingUserInput,
  rightPanelDiffTokens,
  paragraphSummary,
  currentLineIndex,
  totalLines,
  completedCount,
  retryCount,
  micError,
}) => {
  return (
    <div
      className={`bg-gray-50 flex flex-col min-h-0 border-l border-gray-200 ${isMobile ? 'flex-1' : 'flex-shrink-0 h-full'}`}
      style={isMobile ? undefined : { width }}
    >
      {/* Header */}
      <div className="h-9 shrink-0 bg-white border-b border-gray-200 flex items-center px-4 gap-2">
        <span className="text-xs font-bold text-accent-light uppercase tracking-widest">朗讀回饋</span>
        <div className="flex-1" />
        <span className={`text-xs font-bold ${isSessionActive ? 'text-green-500' : isPreparing ? 'text-yellow-500' : 'text-gray-300'}`}>
          {isSessionActive ? '● 聆聽中' : isPreparing ? '● 準備中' : '● 待機'}
        </span>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 custom-scrollbar">

        {/* Progress info */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">朗讀進度</p>
          <p className="text-sm font-bold text-gray-700">
            第 {currentLineIndex + 1} 段 / 共 {totalLines} 段
          </p>
          <p className="text-xs text-gray-500">
            已完成 {completedCount} 段
            {retryCount > 0 && <span className="ml-2 text-amber-500">重試 {retryCount} 次</span>}
          </p>
        </div>

        {/* Live transcript — shown while recording */}
        {isSessionActive && (
          <div className="space-y-1">
            <p className="text-xs font-bold text-accent-light uppercase tracking-widest animate-pulse">即時辨識</p>
            <div className="bg-accent/10 border border-accent/20 rounded-xl px-3 py-2.5 text-sm text-gray-800 leading-relaxed min-h-[2.5rem]">
              {streamingUserInput || <span className="text-gray-400">請開始朗讀…</span>}
            </div>
          </div>
        )}

        {/* Diff result — shown after evaluation completes for current paragraph */}
        {!isSessionActive && rightPanelDiffTokens && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">逐字比對</p>
              {paragraphSummary?.geminiPending && (
                <span className="text-xs text-blue-400 font-bold animate-pulse">AI 精算中…</span>
              )}
            </div>
            <div className="bg-white border border-gray-200 rounded-xl px-3 py-3">
              <DiffDisplay tokens={rightPanelDiffTokens} showLegend className="text-base" />
            </div>
          </div>
        )}

        {/* Idle state — no recording yet */}
        {!isSessionActive && !rightPanelDiffTokens && !paragraphSummary && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-500 leading-relaxed">
              按左側「開始朗讀」後，回饋結果會顯示在這裡
            </p>
          </div>
        )}

      </div>

      {/* Mic error */}
      {micError && (
        <div className="flex-shrink-0 px-4 py-2 bg-rose-50 border-t border-rose-100">
          <span className="text-xs text-rose-500">{micError}</span>
        </div>
      )}
    </div>
  );
};

export default TutorFeedbackPanel;
