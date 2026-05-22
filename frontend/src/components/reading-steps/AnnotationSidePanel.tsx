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
      className="hidden md:flex flex-col w-56 shrink-0 border-l border-outline-variant bg-surface-container-low overflow-y-auto"
      aria-label="我的記號清單"
    >
      {/* Panel header */}
      <div className="px-4 pt-5 pb-3">
        <h2 className="font-headline font-bold text-base text-on-surface">我的記號</h2>
        <p className="text-xs text-on-surface-variant mt-0.5">
          共 <strong>{summary.totalMarks}</strong> 個標記
        </p>
      </div>

      <div className="flex-1 px-3 pb-4 space-y-2">
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
