/**
 * AdminPageShell — shared page wrapper for admin + teacher panels.
 *
 * Handles loading spinner, error banner, empty state, and consistent
 * page title rendering so each panel doesn't repeat this boilerplate.
 *
 * Usage:
 *   <AdminPageShell title="使用者管理" isLoading={isLoading} error={error}>
 *     <MyContent />
 *   </AdminPageShell>
 */
import React from 'react';

export interface AdminPageShellProps {
  /** Page heading displayed in the top bar. */
  title: string;
  /** Optional subtitle rendered below the title. */
  subtitle?: string;
  /** When true, replaces content with a centered spinner. */
  isLoading?: boolean;
  /** Non-empty string triggers an error banner instead of children. */
  error?: string;
  /** When true AND children is absent, shows the emptyMessage. */
  isEmpty?: boolean;
  /** Message shown when isEmpty is true. Defaults to '沒有資料'. */
  emptyMessage?: string;
  /** Optional action buttons rendered in the title bar (e.g. "+ 新增"). */
  headerActions?: React.ReactNode;
  children?: React.ReactNode;
}

const AdminPageShell: React.FC<AdminPageShellProps> = ({
  title,
  subtitle,
  isLoading = false,
  error,
  isEmpty = false,
  emptyMessage = '沒有資料',
  headerActions,
  children,
}) => {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* ── Title bar ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
          )}
        </div>
        {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
      </div>

      {/* ── States ─────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div
          role="status"
          aria-label="載入中"
          className="flex items-center justify-center py-16"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : isEmpty ? (
        <div className="flex items-center justify-center py-16 text-sm text-gray-400">
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </div>
  );
};

export default AdminPageShell;
