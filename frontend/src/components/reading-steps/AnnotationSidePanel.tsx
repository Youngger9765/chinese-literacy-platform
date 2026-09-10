/**
 * AnnotationSidePanel.tsx
 *
 * Right-side panel listing all annotations in paragraph order.
 * Clicking a list item jumps to the corresponding mark in the article.
 *
 * Extracted from ReadingAnnotation.tsx as part of #1855 refactor.
 */
import React from 'react';
import { Annotation, AnnotationSummary } from './annotationReducer';
import { TYPE_CONFIG } from './AnnotationToolbar';

export interface AnnotationWithText {
  annotation: Annotation;
  text: string;
}

interface AnnotationSidePanelProps {
  summary: AnnotationSummary;
  annotationsForPanel: AnnotationWithText[];
  onJump: (annotationId: string) => void;
}

const AnnotationSidePanel: React.FC<AnnotationSidePanelProps> = ({
  summary,
  annotationsForPanel,
  onJump,
}) => {
  return (
    <aside
      /* 捲動的是下面的清單，不是整個 aside —— 標題要留在原地。 */
      className="hidden md:flex flex-col w-56 shrink-0 border-l border-outline-variant bg-surface-container-low overflow-hidden"
      aria-label="我的記號清單"
    >
      {/* Panel header — 記號變多時「我的記號」跟總數不跟著捲走 */}
      <div className="shrink-0 px-4 pt-5 pb-3 border-b border-outline-variant/40">
        <h2 className="font-headline font-bold text-base text-on-surface">我的記號</h2>
        <p className="text-xs text-on-surface-variant mt-0.5">
          共 <strong>{summary.totalMarks}</strong> 個標記
        </p>
      </div>

      {/*
        底部留白 = 讓開 StepActionBar。沒有它，清單最後一兩個記號會壓在
        「播放全文／完成標記」那條漸層底下，捲到底也看不到。

        pb-48 (192px) 而不是課文區用的 pb-44 (176px)：176 是那兩顆按鈕**排成
        一行**時的高度（bottom-16 64 + pt-6 24 + h-14 56 + pb-8 32）。但
        StepActionBar 的 row layout 是 flex-wrap，平板寬度就已經換成兩行，
        實測整條 180px 高 —— 176 會短 4px。多留一階，換行與不換行都蓋不到。
      */}
      <div
        data-testid="annotation-list-scroll"
        className="flex-1 overflow-y-auto px-3 pt-2 pb-48 space-y-2"
      >
        {annotationsForPanel.length === 0 ? (
          <p className="text-sm text-on-surface-variant/70 px-1 py-2">還沒有標記</p>
        ) : (
          annotationsForPanel.map(({ annotation, text }) => {
            const cfg = TYPE_CONFIG[annotation.type];
            return (
              <button
                key={annotation.id}
                type="button"
                onClick={() => onJump(annotation.id)}
                aria-label={`跳轉到${cfg.label}標記：${text}`}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all hover:brightness-95 active:scale-[0.98] ${cfg.activeClass}`}
              >
                <span aria-hidden="true" className="mr-1">
                  {cfg.icon}
                </span>
                {text}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};

export default AnnotationSidePanel;
