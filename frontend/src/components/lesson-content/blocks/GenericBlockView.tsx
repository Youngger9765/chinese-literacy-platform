/**
 * GenericBlockView — the read-only floor for worksheet content the adapter cannot turn
 * into a typed block yet (options printed in a picture, a 連連看 with no answer key…).
 *
 * Renders the parts in source order: heading / text / read-only option list / table.
 * No inputs and no grading — the block carries no answer by construction (see
 * GenericBlock in backend/app/schemas/lesson_content.py). It exists so a student still
 * sees the whole worksheet when the legacy renderer is gone.
 */
import React from 'react';
import type { Block } from '../../../schema/lessonContent';

type GenericBlock = Block & { type: 'generic' };

interface Props {
  block: GenericBlock;
}

const indent = (depth: number) => (depth > 0 ? { paddingLeft: `${Math.min(depth, 4)}rem` } : undefined);

const GenericBlockView: React.FC<Props> = ({ block }) => (
  <div
    className="rounded-xl border border-gray-200 bg-white p-5 space-y-3"
    data-testid="generic-block"
    data-reason={block.reason ?? undefined}
  >
    {block.parts.map((part, i) => {
      switch (part.kind) {
        case 'heading':
          return (
            <div key={i} style={indent(part.depth)} className="text-base font-semibold text-violet-700 whitespace-pre-wrap">
              {part.text}
            </div>
          );
        case 'text':
          return (
            <p key={i} style={indent(part.depth)} className="text-base text-on-surface leading-relaxed whitespace-pre-wrap">
              {part.text}
            </p>
          );
        case 'options':
          return (
            <ul key={i} style={indent(part.depth)} className="space-y-1.5">
              {part.items.map((item, j) => (
                <li
                  key={j}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-base text-on-surface whitespace-pre-wrap"
                >
                  {item}
                </li>
              ))}
            </ul>
          );
        case 'table':
          return (
            <div key={i} style={indent(part.depth)} className="overflow-x-auto">
              <table className="w-full border-collapse text-base">
                {part.headers.length > 0 && (
                  <thead>
                    <tr className="bg-gray-50 font-medium">
                      {part.headers.map((h, c) => (
                        <th key={c} className="border border-gray-200 px-3 py-2 text-left align-top whitespace-pre-wrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {part.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} className="border border-gray-200 px-3 py-2 align-top whitespace-pre-wrap">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        default:
          return null;
      }
    })}
  </div>
);

export default GenericBlockView;
