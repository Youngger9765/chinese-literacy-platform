/**
 * EditSection — collapsible section with view/edit toggle and save/cancel.
 *
 * When isEditing=false the section header shows an "編輯" button.
 * When isEditing=true the footer renders save + cancel buttons.
 *
 * The parent manages the edit state; this component is purely presentational.
 *
 * Usage:
 *   <EditSection
 *     title="基本資料"
 *     isEditing={isEditing}
 *     onEdit={() => setIsEditing(true)}
 *     onSave={handleSave}
 *     onCancel={() => setIsEditing(false)}
 *     isSaving={isSaving}
 *     error={saveError}
 *   >
 *     {isEditing ? <EditForm /> : <ReadView />}
 *   </EditSection>
 */
import React from 'react';

export interface EditSectionProps {
  /** Section heading. */
  title: string;
  /** Controlled editing state. */
  isEditing: boolean;
  /** Called when user clicks "編輯". */
  onEdit: () => void;
  /** Called when user clicks "儲存". */
  onSave: () => void;
  /** Called when user clicks "取消". */
  onCancel: () => void;
  /** When true, the save button shows a spinner and is disabled. */
  isSaving?: boolean;
  /** Non-empty string shows an error message above the action row. */
  error?: string;
  /** Whether to show the Edit button (e.g. hide when permissions absent). */
  canEdit?: boolean;
  children: React.ReactNode;
  /** Extra className on the outer wrapper. */
  className?: string;
}

const EditSection: React.FC<EditSectionProps> = ({
  title,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  isSaving = false,
  error,
  canEdit = true,
  children,
  className = '',
}) => {
  return (
    <section
      className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {!isEditing && canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            編輯
          </button>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="px-4 py-4">{children}</div>

      {/* ── Footer (edit mode only) ────────────────────────────────────── */}
      {isEditing && (
        <div className="border-t border-gray-100 px-4 py-3">
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isSaving && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              儲存
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default EditSection;
