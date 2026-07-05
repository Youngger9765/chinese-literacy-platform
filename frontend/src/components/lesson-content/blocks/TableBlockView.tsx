/**
 * TableBlockView — renders a `table` block.
 *
 * Fast path (the common case): the block carries plain `rows` (optionally with a
 * `rowSections` + `sectionLabelCol` vmerged section column). We adapt it to the legacy
 * `LessonTable` shape and delegate to the existing `TableCard` (which renders the shared
 * `TableBody` — already section-col rowspan-aware, TableDisplay.tsx:34-95). No table
 * rendering is re-implemented for this path.
 *
 * Grid path (only when a `grid` overlay with arbitrary colspan/rowspan exists that the
 * section-col fast path cannot express): render a rowspan-aware <table> straight from the
 * grid, following the schema superRefine's carried-column algorithm so spanned cells are
 * emitted exactly once.
 */
import React from 'react';
import type { Block } from '../../../schema/lessonContent';
import type { LessonTable } from '../../../types';
import { TableCard } from '../../reading-steps/TableDisplay';

type TableBlock = Block & { type: 'table' };

interface Props {
  block: TableBlock;
}

/** A grid is "reducible" to the fast path when every cell is 1x1 except section-label
 *  cells that only span rows in the leftmost column. Otherwise we must render the grid. */
function gridNeedsRawRender(block: TableBlock): boolean {
  if (block.grid == null) return false;
  // If we already have the section-col fast-path data, prefer it.
  if (block.rowSections != null && block.sectionLabelCol != null) return false;
  // Any horizontal band (colspan spanning full width) or arbitrary merges → raw render.
  return block.grid.some((row) => row.some((c) => c.colspan > 1 || c.rowspan > 1));
}

/** Adapt a schema TableBlock (fast path) to the legacy LessonTable shape. */
function toLessonTable(block: TableBlock): LessonTable {
  const rows = block.rows.map((cells, i) => ({
    cells,
    section: block.rowSections?.[i],
  }));
  return {
    id: block.id,
    title: block.title ?? block.label ?? '表格',
    headers: block.headers,
    rows,
    section_label_col: block.sectionLabelCol ?? undefined,
    notes: block.notes ?? undefined,
  };
}

/** Rowspan-aware raw grid render (mirrors schema carried-column algorithm). */
const RawGridTable: React.FC<{ block: TableBlock }> = ({ block }) => {
  const grid = block.grid ?? [];
  const hasHeaders = block.headers.length > 0;
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-3 md:p-4">
      {(block.title || block.label) && (
        <div className="font-headline font-bold text-on-surface text-sm mb-2">
          {block.title ?? block.label}
        </div>
      )}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse border border-outline-variant text-sm md:text-base">
          {hasHeaders && (
            <thead>
              <tr className="bg-accent/10">
                {block.sectionLabelCol ? (
                  <th className="px-3 py-2.5 font-bold text-center border border-outline-variant">
                    {block.sectionLabelCol}
                  </th>
                ) : null}
                {block.headers.map((h, i) => (
                  <th key={i} className="px-3 py-2.5 font-bold text-center border border-outline-variant">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {grid.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container/40'}>
                {row.map((cell, ci) => {
                  const Tag = cell.isSectionLabel ? 'th' : 'td';
                  return (
                    <Tag
                      key={ci}
                      colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                      rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                      className={[
                        'px-3 py-2.5 border border-outline-variant align-top whitespace-pre-line',
                        cell.isSectionLabel
                          ? 'font-bold text-center bg-accent/5 align-middle'
                          : 'text-on-surface',
                      ].join(' ')}
                    >
                      {cell.text}
                    </Tag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.notes && block.notes.length > 0 && (
        <ul className="mt-2 text-xs text-on-surface-variant space-y-0.5">
          {block.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

const TableBlockView: React.FC<Props> = ({ block }) => {
  if (gridNeedsRawRender(block)) {
    return <RawGridTable block={block} />;
  }
  return <TableCard table={toLessonTable(block)} />;
};

export default TableBlockView;
