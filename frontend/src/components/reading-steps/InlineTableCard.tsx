/**
 * InlineTableCard — render a single table inline after its caption paragraph.
 *
 * Uses the same TableCard primitive as TableDisplay so click-to-zoom modal,
 * compact styling, and notes rendering stay consistent. The bottom-of-article
 * `TableDisplay` block still renders any tables NOT referenced by a caption
 * row (with its own `data-testid="lesson-tables"` container).
 */
import React from 'react';
import { LessonTable } from '../../types';
import { TableCard } from './TableDisplay';

interface InlineTableCardProps {
  table: LessonTable;
}

const InlineTableCard: React.FC<InlineTableCardProps> = ({ table }) => {
  return (
    <div
      data-testid="inline-table-card"
      className="max-w-3xl mx-auto"
      style={{ WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
    >
      <TableCard table={table} compact />
    </div>
  );
};

export default InlineTableCard;
