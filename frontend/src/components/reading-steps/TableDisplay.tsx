/**
 * TableDisplay — renders 紙本 tables (#1685) for 圖文表整合 lessons.
 *
 * Used by ComprehensionLayout + ReadingAnnotation when the lesson has
 * a `tables` field (currently G7-L28 文章重點表, G7-L30 表一/表二).
 *
 * Behavior:
 *   - Inline thumbnail table card with title + readable summary.
 *   - Click anywhere on the card → fullscreen zoom modal with the
 *     full-resolution HTML table (Esc + backdrop close).
 *   - Modal closing logic + focus trap mirror ZoomableImage (#1504).
 *
 * Why not reuse ZoomableImage? It expects a single <img> src; tables
 * need a real <table> rendered both inline and in the modal. We reuse
 * the focus-trap hook + modal styling instead.
 */
import React, { useEffect, useRef, useState } from 'react';
import { LessonTable } from '../../types';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface TableDisplayProps {
  tables: LessonTable[];
  /** Optional layout: 'strip' (one card per table, horizontal scroll like image strip)
   *  | 'stacked' (vertical list). Default: 'stacked'. */
  layout?: 'stacked' | 'strip';
}

// ── Renderer ────────────────────────────────────────────────────────────────

/** Render a single table as an HTML <table>. Used inline and in the modal. */
const TableBody: React.FC<{ table: LessonTable; compact?: boolean }> = ({ table, compact }) => {
  const hasSectionCol = !!table.section_label_col;
  // Pre-compute rowspans for section-label column (consecutive rows with same section).
  const sectionRowspans: { row: number; rowspan: number; label: string }[] = [];
  if (hasSectionCol) {
    let i = 0;
    while (i < table.rows.length) {
      const section = table.rows[i].section ?? '';
      let j = i + 1;
      while (j < table.rows.length && (table.rows[j].section ?? '') === section) j += 1;
      sectionRowspans.push({ row: i, rowspan: j - i, label: section });
      i = j;
    }
  }
  const sectionStartRows = new Set(sectionRowspans.map((s) => s.row));
  const sectionByRow = new Map(sectionRowspans.map((s) => [s.row, s]));

  const cellPad = compact ? 'px-2 py-1.5' : 'px-3 py-2.5';
  const textSize = compact ? 'text-xs' : 'text-sm md:text-base';

  return (
    <table className={`w-full border-collapse border border-outline-variant rounded-lg overflow-hidden ${textSize}`}>
      <thead>
        <tr className="bg-accent/10">
          {hasSectionCol && (
            <th className={`${cellPad} font-headline font-bold text-on-surface text-center border border-outline-variant`}>
              {table.section_label_col}
            </th>
          )}
          {table.headers.map((h, i) => (
            <th key={i} className={`${cellPad} font-headline font-bold text-on-surface text-center border border-outline-variant`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, rIdx) => {
          const sectionInfo = sectionByRow.get(rIdx);
          return (
            <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container/40'}>
              {hasSectionCol && sectionStartRows.has(rIdx) && sectionInfo && (
                <td
                  rowSpan={sectionInfo.rowspan}
                  className={`${cellPad} font-headline font-bold text-on-surface-variant text-center border border-outline-variant align-middle bg-accent/5`}
                  style={{ writingMode: sectionInfo.label.length <= 3 ? 'vertical-rl' as const : undefined }}
                >
                  {sectionInfo.label}
                </td>
              )}
              {row.cells.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  className={`${cellPad} text-on-surface border border-outline-variant align-top whitespace-pre-line ${cIdx === 0 ? 'font-medium' : ''}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

// ── Single-card with zoom modal ─────────────────────────────────────────────

export const TableCard: React.FC<{ table: LessonTable; compact?: boolean }> = ({ table, compact }) => {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full text-left rounded-2xl border border-outline-variant bg-surface-container-lowest p-3 md:p-4 hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
        aria-label={`放大表格：${table.title}`}
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-accent text-base">table_chart</span>
          <span className="font-headline font-bold text-on-surface text-xs md:text-sm flex-1">{table.title}</span>
          <span className="material-symbols-outlined text-on-surface-variant text-base opacity-60 group-hover:opacity-100">zoom_in</span>
        </div>
        <div className="overflow-x-auto custom-scrollbar pointer-events-none">
          <TableBody table={table} compact={compact ?? true} />
        </div>
        {table.notes && table.notes.length > 0 && (
          <ul className="mt-2 text-[11px] md:text-xs text-on-surface-variant space-y-0.5 pointer-events-none">
            {table.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={table.title}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 md:p-8 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors z-10"
            aria-label="關閉"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          <div
            className="max-w-6xl w-full max-h-full overflow-auto bg-surface-container-lowest rounded-2xl shadow-2xl p-6 md:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-headline font-bold text-on-surface text-base md:text-lg mb-4">{table.title}</h3>
            <TableBody table={table} compact={false} />
            {table.notes && table.notes.length > 0 && (
              <ul className="mt-4 text-xs md:text-sm text-on-surface-variant space-y-1">
                {table.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
};

// ── Container ───────────────────────────────────────────────────────────────

const TableDisplay: React.FC<TableDisplayProps> = ({ tables, layout = 'stacked' }) => {
  if (!tables || tables.length === 0) return null;

  return (
    <div
      data-testid="lesson-tables"
      className={`bg-surface-container-lowest rounded-3xl shadow-editorial p-4 md:p-5 flex flex-col w-full min-h-0 ${layout === 'strip' ? 'flex-[2]' : ''}`}
    >
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <span className="material-symbols-outlined text-accent text-lg">table_view</span>
        <span className="font-headline font-bold text-on-surface text-xs uppercase tracking-wider">
          紙本表格
        </span>
        <span className="text-xs text-on-surface-variant ml-2">{tables.length} 張</span>
        <span className="text-[11px] text-on-surface-variant ml-auto hidden md:inline">點表可放大</span>
      </div>
      <div className={`flex-1 min-h-0 ${layout === 'strip' ? 'overflow-x-auto custom-scrollbar' : 'overflow-y-auto custom-scrollbar'}`}>
        <div className={`${layout === 'strip' ? 'flex gap-3 pr-2' : 'flex flex-col gap-3 pr-2'}`}>
          {tables.map((t) => (
            <div key={t.id} className={layout === 'strip' ? 'shrink-0' : ''} style={layout === 'strip' ? { width: 'clamp(260px, 30vw, 360px)' } : undefined}>
              <TableCard table={t} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TableDisplay;
