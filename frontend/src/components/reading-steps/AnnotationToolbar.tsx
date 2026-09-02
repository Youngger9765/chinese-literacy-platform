/**
 * AnnotationToolbar.tsx
 *
 * Floating selection toolbar that appears above selected text.
 * Lets the user apply 'unknown' or 'important' annotation types.
 *
 * Extracted from ReadingAnnotation.tsx as part of #1855 refactor.
 */
import React from 'react';
import { AnnotationType } from './annotationReducer';

export const TYPE_CONFIG: Record<
  AnnotationType,
  { label: string; icon: string; className: string; activeClass: string }
> = {
  unknown: {
    label: '不懂',
    icon: '❓',
    // Bottom red line drawn via inset box-shadow so it tracks the inline-box edge
    // (always straight), unaffected by letter-spacing, ruby baselines, or PUA
    // variation selectors that can make text-decoration: underline look tilted.
    className: 'shadow-[inset_0_-3px_0_0_#ef4444]',
    activeClass: 'bg-red-100 border-red-400 text-red-800',
  },
  important: {
    label: '重要',
    icon: '💛',
    className: 'bg-yellow-200',
    activeClass: 'bg-yellow-300 border-yellow-500 text-yellow-900',
  },
};

/**
 * Style for a 編者標 pre-mark (#3026) — deliberately NOT one of TYPE_CONFIG's
 * two entries. A pre-mark's underlying `type` is `'important'` (重點生詞 is
 * semantically "important vocabulary"), but it must stay visually
 * distinguishable from a mark the STUDENT chose as 💛 重要 themselves (BDD:
 * 「與新套用的預標在視覺上可分辨」) — a sky-blue background + a pin icon,
 * never the toolbar's own yellow. There is no toolbar button for this style:
 * a student never chooses to create a 編者標 mark, only a teacher/editor
 * pipeline produces one (see editorPreMarks.ts), so it is not part of
 * `TYPE_CONFIG`'s Object.entries() iteration that builds the toolbar UI.
 */
export const EDITOR_PREMARK_STYLE = {
  label: '重點生詞',
  icon: '📌',
  className: 'bg-sky-100 shadow-[inset_0_-2px_0_0_#0284c7]',
};

interface AnnotationToolbarProps {
  x: number;
  y: number;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  onApply: (type: AnnotationType) => void;
  onCancel: () => void;
}

const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  x,
  y,
  toolbarRef,
  onApply,
  onCancel,
}) => {
  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="標記選取文字"
      className="absolute z-50 flex items-center gap-2 bg-surface-container-lowest rounded-2xl shadow-editorial px-3 py-2.5 -translate-x-1/2 -translate-y-full"
      style={{ left: x, top: y }}
    >
      {(
        Object.entries(TYPE_CONFIG) as Array<
          [AnnotationType, (typeof TYPE_CONFIG)[AnnotationType]]
        >
      ).map(([type, cfg]) => (
        <button
          key={type}
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            onApply(type);
          }}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all min-h-[48px] active:scale-95 ${cfg.activeClass}`}
        >
          <span aria-hidden="true">{cfg.icon}</span>
          {cfg.label}
        </button>
      ))}
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          window.getSelection()?.removeAllRanges();
          onCancel();
        }}
        className="ml-1 px-3 py-2.5 rounded-xl text-base text-on-surface-variant hover:bg-surface-container-high transition-all min-h-[48px]"
        aria-label="取消"
      >
        ✕
      </button>
    </div>
  );
};

export default AnnotationToolbar;
