/**
 * OmoUploadPagePreview — single-page thumbnail card in the OMO upload queue.
 *
 * Issue #1974: shows one staged page with:
 *   - thumbnail (object URL from URL.createObjectURL) — or 📄 stub for PDFs (#1976)
 *   - 「第 N 頁」 badge
 *   - ↑ / ↓ reorder buttons (disabled at boundaries)
 *   - ✕ remove button
 *
 * Reorder uses arrow buttons (not drag-and-drop) — primary user is a
 * student on a mobile phone, where touch-drag is finicky; arrow buttons
 * work the same on desktop and mobile with no extra dependencies.
 */
import React from 'react';

interface OmoUploadPagePreviewProps {
  /** Page index (0-based). Display number is pageIndex + 1. */
  pageIndex: number;
  /** Total pages in the queue (for boundary disabling). */
  totalPages: number;
  /** Object URL of the thumbnail (URL.createObjectURL). ``null`` for PDFs. */
  previewUrl: string | null;
  /** Original filename, used in alt + tooltip. */
  fileName: string;
  /** ``true`` when the file is a PDF — renders a 📄 stub instead of `<img>`. */
  isPdf: boolean;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const OmoUploadPagePreview: React.FC<OmoUploadPagePreviewProps> = ({
  pageIndex,
  totalPages,
  previewUrl,
  fileName,
  isPdf,
  onRemove,
  onMoveUp,
  onMoveDown,
}) => {
  const isFirst = pageIndex === 0;
  const isLast = pageIndex === totalPages - 1;

  return (
    <div className="flex items-center gap-3 p-2 bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Thumbnail with page-number overlay */}
      <div className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-gray-50 border border-gray-100">
        {isPdf || !previewUrl ? (
          <div
            className="w-full h-full flex items-center justify-center text-3xl bg-gray-100"
            aria-label={`${fileName} PDF 檔`}
            title={fileName}
          >
            <span aria-hidden="true">📄</span>
          </div>
        ) : (
          <img
            src={previewUrl}
            alt={`${fileName} 預覽`}
            title={fileName}
            className="w-full h-full object-cover"
          />
        )}
        <span
          className="absolute bottom-0 left-0 right-0 bg-black/55 text-white text-[10px] font-semibold text-center py-0.5"
          aria-label={`第 ${pageIndex + 1} 個`}
        >
          {isPdf ? 'PDF' : `第 ${pageIndex + 1} 頁`}
        </span>
      </div>

      {/* Filename + reorder hint */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 truncate">{fileName}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {isFirst && isLast ? '已選 1 個' : `共 ${totalPages} 個，點 ↑↓ 調整順序`}
        </p>
      </div>

      {/* Reorder buttons */}
      <div className="flex flex-col gap-1 shrink-0">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label={`將第 ${pageIndex + 1} 個往上移`}
          className="w-7 h-6 flex items-center justify-center text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          aria-label={`將第 ${pageIndex + 1} 個往下移`}
          className="w-7 h-6 flex items-center justify-center text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ↓
        </button>
      </div>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`移除第 ${pageIndex + 1} 個`}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-red-500 hover:bg-red-50 text-base font-semibold"
      >
        ✕
      </button>
    </div>
  );
};

export default OmoUploadPagePreview;
