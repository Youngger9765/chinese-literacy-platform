/**
 * AdminTable — generic responsive table with card fallback on mobile.
 *
 * On md+ screens: renders a <table>. On small screens: renders each row
 * as a stacked card so the layout doesn't overflow.
 *
 * Usage:
 *   const columns: ColumnDef<User>[] = [
 *     { key: 'name', header: '名稱', render: (row) => row.name },
 *     { key: 'email', header: 'Email' },
 *   ];
 *   <AdminTable columns={columns} rows={users} rowKey={(u) => u.id} />
 */
import React from 'react';

export interface ColumnDef<T> {
  /** Unique column key (used as React key). */
  key: string;
  /** Column header label. */
  header: string;
  /**
   * Optional render function. When omitted the column key is used as a
   * property accessor on the row object (requires T extends Record<string,unknown>).
   */
  render?: (row: T, index: number) => React.ReactNode;
  /** Optional className applied to both <th> and <td> cells for this column. */
  className?: string;
}

export interface AdminTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  /** Returns the unique React key for each row. */
  rowKey: (row: T, index: number) => string | number;
  /** Optional click handler for rows. */
  onRowClick?: (row: T) => void;
  /** Override card heading accessor — shown prominently in mobile card view. */
  cardTitle?: (row: T) => React.ReactNode;
  /** Extra className on the wrapping <div>. */
  className?: string;
}

function getCellValue<T>(row: T, col: ColumnDef<T>, index: number): React.ReactNode {
  if (col.render) return col.render(row, index);
  // Fall back to property access by key
  const value = (row as Record<string, unknown>)[col.key];
  return value !== undefined && value !== null ? String(value) : '—';
}

function AdminTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  cardTitle,
  className = '',
}: AdminTableProps<T>): React.ReactElement {
  const clickable = Boolean(onRowClick);

  return (
    <div className={`w-full ${className}`}>
      {/* ── Desktop table ──────────────────────────────────────────────── */}
      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3 text-left font-medium text-gray-600 ${col.className ?? ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                onClick={clickable ? () => onRowClick!(row) : undefined}
                className={clickable ? 'cursor-pointer hover:bg-blue-50 transition-colors' : ''}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-gray-700 ${col.className ?? ''}`}
                  >
                    {getCellValue(row, col, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row, index) => (
          <div
            key={rowKey(row, index)}
            onClick={clickable ? () => onRowClick!(row) : undefined}
            className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${
              clickable ? 'cursor-pointer hover:bg-blue-50 transition-colors' : ''
            }`}
          >
            {cardTitle && (
              <div className="mb-2 font-medium text-gray-900">{cardTitle(row)}</div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {columns.map((col) => (
                <div key={col.key} className="flex flex-col">
                  <dt className="text-xs text-gray-400">{col.header}</dt>
                  <dd className="text-gray-700">{getCellValue(row, col, index)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AdminTable;
