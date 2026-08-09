import React from 'react';
import ParagraphFeedbackPanel from './ParagraphFeedbackPanel';
import { ParagraphSummaryData } from './paragraphReadingTypes';
import { DiffToken } from '../../../types';

interface ParagraphReadingFeedbackDrawerProps {
  show: boolean;
  onClose: () => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  isSessionActive: boolean;
  isPreparing: boolean;
  streamingUserInput: string;
  rightPanelDiffTokens: DiffToken[] | null;
  targetText: string;
  paragraphSummary: ParagraphSummaryData | null;
  currentLineIndex: number;
  totalLines: number;
  completedCount: number;
  retryCount: number;
  micError: string;
}

/**
 * ParagraphReadingFeedbackDrawer — slide-up drawer showing ParagraphFeedbackPanel.
 * Handles backdrop + close button.
 */
const ParagraphReadingFeedbackDrawer: React.FC<ParagraphReadingFeedbackDrawerProps> = ({
  show,
  onClose,
  scrollRef,
  isSessionActive,
  isPreparing,
  streamingUserInput,
  rightPanelDiffTokens,
  targetText,
  paragraphSummary,
  currentLineIndex,
  totalLines,
  completedCount,
  retryCount,
  micError,
}) => {
  if (!show) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-30" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface-container-lowest rounded-t-3xl shadow-editorial max-h-[60vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-surface-container-lowest px-6 py-4 flex items-center justify-between rounded-t-3xl">
          <span className="font-headline font-bold text-on-surface">朗讀回饋</span>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full hover:bg-surface-container-high flex items-center justify-center transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="px-6 pb-8">
          <ParagraphFeedbackPanel
            width={9999}
            isMobile={true}
            scrollRef={scrollRef as React.RefObject<HTMLDivElement>}
            isSessionActive={isSessionActive}
            isPreparing={isPreparing}
            streamingUserInput={streamingUserInput}
            rightPanelDiffTokens={rightPanelDiffTokens}
            targetText={targetText}
            paragraphSummary={paragraphSummary}
            currentLineIndex={currentLineIndex}
            totalLines={totalLines}
            completedCount={completedCount}
            retryCount={retryCount}
            micError={micError}
          />
        </div>
      </div>
    </>
  );
};

export default ParagraphReadingFeedbackDrawer;
