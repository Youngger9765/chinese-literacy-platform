/**
 * CollapsibleRefPanel — accordion-style collapsible panel for reference material
 * (圖文對照 / 紙本表格) in the right column of ComprehensionLayout.
 *
 * Design notes (issue #1697):
 *   - Default collapsed: saves space for the exercise (重點表 / strategy / MCQ)
 *   - Click header → toggle expand; smooth max-height transition
 *   - Body content (image strip, TableDisplay) renders only when expanded so
 *     ZoomableImage modals + table HTML stay performant even on lessons with
 *     2+ collapsibles stacked.
 *   - Mirrors the editorial card styling used elsewhere in the comprehension
 *     UI so the right column reads as one cohesive surface.
 */
import React, { useState } from 'react';

interface CollapsibleRefPanelProps {
  /** Material Symbols icon name shown in the header. */
  icon: string;
  /** Header label, e.g. "圖文對照". */
  label: string;
  /** Optional count badge, e.g. "1 張" / "2 張". */
  count?: string | number;
  /** Whether to start expanded. Defaults to false (collapsed). */
  defaultOpen?: boolean;
  /** Panel body — rendered only while expanded. */
  children: React.ReactNode;
}

const CollapsibleRefPanel: React.FC<CollapsibleRefPanelProps> = ({
  icon,
  label,
  count,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  return (
    <div className="bg-surface-container-lowest rounded-2xl shadow-editorial overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-surface-container-low transition-colors text-left"
      >
        <span className="material-symbols-outlined text-accent text-lg">{icon}</span>
        <span className="font-headline font-bold text-on-surface text-xs uppercase tracking-wider">
          {label}
        </span>
        {count !== undefined && (
          <span className="text-xs text-on-surface-variant ml-1">{count}</span>
        )}
        <span
          className={`material-symbols-outlined text-on-surface-variant text-lg ml-auto transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          expand_more
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-surface-container-high">
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleRefPanel;
