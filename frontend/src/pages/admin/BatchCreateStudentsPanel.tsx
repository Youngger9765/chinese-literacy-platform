/**
 * BatchCreateStudentsPanel — textarea input, preview table, results + CSV download.
 * Extracted from ClassroomDetailPanel (Issue #1850).
 */
import React from 'react';
import { BatchStudentInput, BatchCreateResult } from '../../services/classroomApi';

interface BatchCreateStudentsPanelProps {
  batchInput: string;
  batchPreview: BatchStudentInput[];
  isSubmittingBatch: boolean;
  batchResult: BatchCreateResult | null;
  batchError: string;
  onBatchInputChange: (value: string) => void;
  onSubmitBatch: () => void;
  onDownloadCredentials: () => void;
  onContinue: () => void;
  onClose: () => void;
}

const BatchCreateStudentsPanel: React.FC<BatchCreateStudentsPanelProps> = ({
  batchInput,
  batchPreview,
  isSubmittingBatch,
  batchResult,
  batchError,
  onBatchInputChange,
  onSubmitBatch,
  onDownloadCredentials,
  onContinue,
  onClose,
}) => {
  return (
    <div className="p-5 border-b border-gray-100 bg-gray-50/50">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-gray-900">批量建立學生</h4>
        <button
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
        >
          關閉
        </button>
      </div>

      {batchResult ? (
        // Results view
        <div className="space-y-4">
          {batchResult.created.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-green-800">
                  成功建立 {batchResult.created.length} 位學生
                </p>
                <button
                  onClick={onDownloadCredentials}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  下載登入資訊
                </button>
              </div>
              {/* Mobile card view */}
              <div className="md:hidden space-y-2">
                {batchResult.created.map((s) => (
                  <div key={s.user_id} className="bg-green-50 rounded-lg border border-green-200 p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-green-900">{s.name}</span>
                      <span className="text-green-600">座號 {s.seat_number || '-'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-green-500">帳號</span>
                        <p className="text-green-800 font-mono break-all">{s.username}</p>
                      </div>
                      <div>
                        <span className="text-green-500">密碼</span>
                        <p className="text-green-800 font-mono break-all">{s.password}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table view */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-green-200 text-left text-green-700">
                      <th className="pb-1.5 font-medium">姓名</th>
                      <th className="pb-1.5 font-medium">座號</th>
                      <th className="pb-1.5 font-medium">帳號</th>
                      <th className="pb-1.5 font-medium">密碼</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-green-100">
                    {batchResult.created.map((s) => (
                      <tr key={s.user_id}>
                        <td className="py-1.5 text-green-900">{s.name}</td>
                        <td className="py-1.5 text-green-700">{s.seat_number || '-'}</td>
                        <td className="py-1.5 text-green-700 font-mono">{s.username}</td>
                        <td className="py-1.5 text-green-700 font-mono">{s.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {batchResult.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm font-medium text-red-800 mb-2">
                {batchResult.errors.length} 筆錯誤
              </p>
              <ul className="list-disc list-inside text-xs text-red-700 space-y-1">
                {batchResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={onContinue}
            className="text-sm text-accent hover:text-accent-hover cursor-pointer"
          >
            繼續建立
          </button>
        </div>
      ) : (
        // Input form
        <div className="space-y-4">
          <div>
            <label htmlFor="batch-students" className="block text-sm text-gray-600 mb-1">
              每行一位學生，格式：姓名 座號（座號可省略）
            </label>
            <textarea
              id="batch-students"
              value={batchInput}
              onChange={(e) => onBatchInputChange(e.target.value)}
              placeholder={'王小明 1\n李小華 2\n陳大文 3'}
              className="w-full min-h-[120px] px-3 py-2 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors resize-y"
            />
          </div>

          {batchPreview.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">預覽：將建立 {batchPreview.length} 位學生</p>
              {/* Mobile card view */}
              <div className="md:hidden space-y-1.5">
                {batchPreview.map((s, i) => (
                  <div key={i} className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2 text-xs">
                    <span className="text-gray-900 font-medium">{s.name}</span>
                    <span className="text-gray-500">座號 {s.seat_number || '-'}</span>
                  </div>
                ))}
              </div>
              {/* Desktop table view */}
              <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500 bg-gray-50">
                      <th className="px-3 py-1.5 font-medium">姓名</th>
                      <th className="px-3 py-1.5 font-medium">座號</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {batchPreview.map((s, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 text-gray-900">{s.name}</td>
                        <td className="px-3 py-1.5 text-gray-600">{s.seat_number || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {batchError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {batchError}
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={onSubmitBatch}
              disabled={isSubmittingBatch || batchPreview.length === 0}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
            >
              {isSubmittingBatch ? '建立中...' : `建立 ${batchPreview.length} 位學生`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BatchCreateStudentsPanel;
