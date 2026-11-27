/**
 * 首頁第一屏的兩張大卡（#4159）
 *
 * - ContinueLearningCard：上次進行中的課與第幾關，一鍵回去
 * - StartLessonCard：完全沒有進行中的課、也沒有老師指派時的「選一課開始」，不留空白
 */
import React from 'react';
import type { ResumeInfo } from '../../../utils/resumeInfo';

const cardClass = `
  w-full text-left bg-surface-container-lowest border border-[#E5E0D5] rounded-2xl
  p-5 sm:p-6 flex items-center gap-4 shadow-editorial
  hover:shadow-md hover:border-accent/40 transition-all duration-150
  focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
`;

interface ContinueProps {
  info: ResumeInfo;
  /** 課名；抓不到時顯示課號 */
  title: string | null;
  onContinue: () => void;
}

export const ContinueLearningCard: React.FC<ContinueProps> = ({ info, title, onContinue }) => (
    <div data-testid="continue-card" className={cardClass}>
      <div className="w-16 h-20 shrink-0 rounded-xs bg-linear-to-br from-[#F7B76B] via-[#F59E42] to-[#E8841C] flex items-center justify-center shadow-md" aria-hidden="true">
        <span className="text-2xl">📖</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold tracking-widest text-tertiary-fixed-dim mb-1">接 著 做</div>
        <h2 className="text-xl sm:text-2xl font-bold font-headline text-on-surface leading-tight truncate">
          {title ?? info.storyId}
        </h2>
        <p className="text-sm text-on-surface-variant mt-0.5">
          第 {info.stepNumber} 關 · {info.stepLabel}（共 {info.totalSteps} 關）
        </p>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="shrink-0 bg-accent hover:bg-accent-hover text-white font-bold px-5 py-2.5 rounded-full text-sm transition-colors"
      >
        接著做
      </button>
    </div>
);

interface StartProps {
  classroomName?: string;
  onStart: () => void;
}

export const StartLessonCard: React.FC<StartProps> = ({ classroomName, onStart }) => (
  <div data-testid="start-card" className={cardClass}>
    <div className="w-16 h-20 shrink-0 rounded-xs bg-linear-to-br from-[#F7B76B] via-[#F59E42] to-[#E8841C] flex items-center justify-center shadow-md" aria-hidden="true">
      <span className="text-2xl">📚</span>
    </div>
    <div className="flex-1 min-w-0">
      <h2 className="text-xl sm:text-2xl font-bold font-headline text-on-surface leading-tight">選一課開始</h2>
      <p className="text-sm text-on-surface-variant mt-0.5">
        {classroomName ? `從「${classroomName}」的課文挑一課` : '從課文庫挑一課'}
      </p>
    </div>
    <button
      type="button"
      onClick={onStart}
      className="shrink-0 bg-accent hover:bg-accent-hover text-white font-bold px-5 py-2.5 rounded-full text-sm transition-colors"
    >
      選一課開始
    </button>
  </div>
);
