/**
 * ParallelPassageBlockView — two-column 白話/文言 對照 presentation (wen-L2 pp-parallel).
 *
 * Pure presentation — this block carries NO answer by schema design (the 對照 is
 *呈現; judging regresses to a companion fill_in_blank exercise). Renders left/right
 * columns with optional leftLabel/rightLabel headers, per-row notes, and a footnote
 * list. Mobile stacks the columns.
 */
import React from 'react';
import type { Block } from '../../../schema/lessonContent';

type ParallelPassageBlock = Block & { type: 'parallel_passage' };

interface Props {
  block: ParallelPassageBlock;
}

const ParallelPassageBlockView: React.FC<Props> = ({ block }) => (
  <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 md:p-5">
    {block.title ? (
      <div className="font-headline font-bold text-on-surface text-sm mb-3">{block.title}</div>
    ) : null}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-outline-variant/40 rounded-lg overflow-hidden">
      <div className="bg-accent/10 px-3 py-2 text-sm font-bold text-on-surface text-center">
        {block.leftLabel}
      </div>
      <div className="bg-accent/10 px-3 py-2 text-sm font-bold text-on-surface text-center hidden md:block">
        {block.rightLabel}
      </div>
      {block.rows.map((row, i) => (
        <React.Fragment key={i}>
          <div className="bg-surface-container-lowest px-3 py-2.5 text-base text-on-surface whitespace-pre-wrap">
            {row.left}
          </div>
          <div className="bg-surface-container-lowest px-3 py-2.5 text-base text-on-surface whitespace-pre-wrap">
            <span className="md:hidden text-xs font-bold text-on-surface-variant block mb-1">
              {block.rightLabel}
            </span>
            {row.right}
            {row.note ? (
              <span className="block mt-1 text-xs text-on-surface-variant/80">※ {row.note}</span>
            ) : null}
          </div>
        </React.Fragment>
      ))}
    </div>
    {block.notes && block.notes.length > 0 && (
      <ul className="mt-3 text-xs text-on-surface-variant space-y-0.5">
        {block.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    )}
  </div>
);

export default ParallelPassageBlockView;
