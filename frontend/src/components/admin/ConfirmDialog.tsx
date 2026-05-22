/**
 * ConfirmDialog — modal confirm gate with optional destructive styling.
 *
 * Renders a simple overlay dialog asking the user to confirm an action.
 * The confirm button turns red when variant="destructive".
 *
 * Usage:
 *   <ConfirmDialog
 *     open={showConfirm}
 *     title="停用帳號"
 *     message="確定要停用此帳號嗎？此操作可復原。"
 *     variant="destructive"
 *     onConfirm={handleDeactivate}
 *     onCancel={() => setShowConfirm(false)}
 *     isLoading={isDeactivating}
 *   />
 */
import React, { useEffect, useRef } from 'react';

export type ConfirmDialogVariant = 'default' | 'destructive';

export interface ConfirmDialogProps {
  /** Controls dialog visibility. */
  open: boolean;
  /** Dialog heading. */
  title: string;
  /** Body message or custom React node. */
  message: React.ReactNode;
  /** 'destructive' makes the confirm button red. Defaults to 'default'. */
  variant?: ConfirmDialogVariant;
  /** Label on the confirm button. Defaults to '確認'. */
  confirmLabel?: string;
  /** Label on the cancel button. Defaults to '取消'. */
  cancelLabel?: string;
  /** Called when user confirms. */
  onConfirm: () => void;
  /** Called when user cancels or clicks the backdrop. */
  onCancel: () => void;
  /** When true the confirm button shows a spinner and is disabled. */
  isLoading?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  variant = 'default',
  confirmLabel = '確認',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmCls =
    variant === 'destructive'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-blue-600 hover:bg-blue-700 text-white';

  return (
    /* Backdrop */
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      {/* Dialog panel — stop propagation so clicks inside don't close */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2
          id="confirm-dialog-title"
          className="text-base font-semibold text-gray-900"
        >
          {title}
        </h2>
        <div className="mt-2 text-sm text-gray-600">{message}</div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${confirmCls}`}
          >
            {isLoading && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
