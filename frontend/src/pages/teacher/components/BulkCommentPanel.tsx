/**
 * BulkCommentPanel — bulk grading UI for all submitted (ungraded) rows.
 * Extracted from AssignmentDetailPanel (Issue #1853).
 */
import React from 'react';

interface Props {
  submittedCount: number;
  bulkComment: string;
  setBulkComment: (v: string) => void;
  isBulkSubmitting: boolean;
  bulkCommentError: string;
  bulkCommentDone: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

const BulkCommentPanel: React.FC<Props> = ({
  submittedCount,
  bulkComment,
  setBulkComment,
  isBulkSubmitting,
  bulkCommentError,
  bulkCommentDone,
  onSubmit,
  onCancel,
}) => (
  <div className="mb-3 p-3 bg-purple-50 border border-purple-100 rounded-lg">
    <p className="text-xs font-medium text-purple-800 mb-2">
      批次評語 — 將對 {submittedCount} 位已提交學生標記為「已批改」
    </p>
    {bulkCommentDone ? (
      <p className="text-xs text-green-700 font-medium">已完成批次批改</p>
    ) : (
      <>
        <textarea
          value={bulkComment}
          onChange={(e) => setBulkComment(e.target.value)}
          placeholder="輸入共同評語（選填）&#10;例：整體表現良好，請繼續加油！"
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-purple-200 text-gray-900 bg-white placeholder-gray-400 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-300 transition-colors resize-none mb-2"
        />
        {bulkCommentError && (
          <p className="text-xs text-red-600 mb-2">{bulkCommentError}</p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-2.5 py-1 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={isBulkSubmitting}
            className="px-2.5 py-1 rounded bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {isBulkSubmitting ? '處理中...' : `確認批改 ${submittedCount} 人`}
          </button>
        </div>
      </>
    )}
  </div>
);

export default BulkCommentPanel;
