/**
 * ClassroomHeaderCard — Issue #1943 / #1987
 *
 * Renders:
 *  - Classroom name, grade badge, student count, active status (view + edit form)
 *  - Action buttons: 編輯 / 停用啟用 / 匯出CSV
 *  - Join code panel — accordion (collapsed when ≥1 student, expanded for new class)
 */
import React, { useState } from 'react';
import { ClassroomDetailResponse } from '../../services/classroomApi';

interface ClassroomHeaderCardProps {
  classroom: ClassroomDetailResponse;

  // Edit mode
  isEditing: boolean;
  editName: string;
  editGrade: string;
  isSaving: boolean;
  editError: string;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onEditNameChange: (value: string) => void;
  onEditGradeChange: (value: string) => void;
  onSaveEdit: (e: React.FormEvent) => void;

  // Toggle active
  isTogglingActive: boolean;
  onToggleActive: () => void;

  // Export CSV
  isExporting: boolean;
  onExportCsv: () => void;

  // Join code
  isCopied: boolean;
  showRegenConfirm: boolean;
  isRegenerating: boolean;
  onCopyJoinCode: () => void;
  onShowRegenConfirm: () => void;
  onHideRegenConfirm: () => void;
  onRegenerateCode: () => void;

  // Util
  formatDate: (dateStr: string) => string;
}

const ClassroomHeaderCard: React.FC<ClassroomHeaderCardProps> = ({
  classroom,
  isEditing,
  editName,
  editGrade,
  isSaving,
  editError,
  onStartEditing,
  onCancelEditing,
  onEditNameChange,
  onEditGradeChange,
  onSaveEdit,
  isTogglingActive,
  onToggleActive,
  isExporting,
  onExportCsv,
  isCopied,
  showRegenConfirm,
  isRegenerating,
  onCopyJoinCode,
  onShowRegenConfirm,
  onHideRegenConfirm,
  onRegenerateCode,
  formatDate,
}) => {
  // Default: collapsed for established classrooms (≥1 student), expanded for new (0 student)
  const [joinCodeOpen, setJoinCodeOpen] = useState(classroom.student_count === 0);

  return (
    <>
    {/* Classroom info card */}
    <div className="bg-white rounded-2xl shadow-card p-6">
      {isEditing ? (
        <form onSubmit={onSaveEdit} className="space-y-4">
          <h2 className="text-base font-bold text-gray-900">編輯班級</h2>
          {editError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {editError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-name" className="block text-sm font-medium text-gray-700 mb-1">
                班級名稱 <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-name"
                type="text"
                value={editName}
                onChange={(e) => onEditNameChange(e.target.value)}
                required
                className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label htmlFor="edit-grade" className="block text-sm font-medium text-gray-700 mb-1">
                年級
              </label>
              <select
                id="edit-grade"
                value={editGrade}
                onChange={(e) => onEditGradeChange(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              >
                <option value="">未指定</option>
                <optgroup label="國小">
                  {[1,2,3,4,5,6].map((g) => (
                    <option key={g} value={g}>{g} 年級</option>
                  ))}
                </optgroup>
                <optgroup label="國中">
                  {[7,8,9].map((g) => (
                    <option key={g} value={g}>{g} 年級</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onCancelEditing}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving || !editName.trim()}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors"
            >
              {isSaving ? '儲存中...' : '儲存'}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{classroom.name}</h2>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-500">
              {classroom.grade != null && (
                <span className="bg-accent-bg text-accent text-xs font-medium px-2.5 py-0.5 rounded">
                  {classroom.grade} 年級
                </span>
              )}
              <span>{classroom.student_count} 位學生</span>
              <span>{formatDate(classroom.created_at)}</span>
              <span className={classroom.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                {classroom.is_active ? '使用中' : '已停用'}
              </span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onStartEditing}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
            >
              編輯
            </button>
            <button
              onClick={onToggleActive}
              disabled={isTogglingActive}
              className={`px-3 py-1.5 rounded-lg border text-sm transition-colors cursor-pointer ${
                isTogglingActive ? 'opacity-50 cursor-not-allowed' : ''
              } ${
                classroom.is_active
                  ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              {isTogglingActive ? '更新中...' : classroom.is_active ? '停用' : '啟用'}
            </button>
            <button
              onClick={onExportCsv}
              disabled={isExporting}
              className={`px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 text-sm hover:bg-blue-50 transition-colors cursor-pointer ${
                isExporting ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isExporting ? '匯出中...' : '匯出 CSV'}
            </button>
          </div>
        </div>
      )}
    </div>

    {/* Join Code card — accordion */}
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      {/* Accordion header / toggle */}
      <button
        type="button"
        onClick={() => setJoinCodeOpen((prev) => !prev)}
        aria-expanded={joinCodeOpen}
        aria-controls="join-code-panel"
        className="w-full flex items-center justify-between px-6 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          加入代碼
          {classroom.join_code && !joinCodeOpen && (
            <span className="font-mono text-xs font-medium text-accent bg-accent-bg px-2 py-0.5 rounded tracking-wider">
              {classroom.join_code}
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${joinCodeOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Accordion body */}
      <div
        id="join-code-panel"
        aria-hidden={!joinCodeOpen}
        className={`transition-all duration-200 ${joinCodeOpen ? 'block' : 'hidden'}`}
      >
        <div className="px-6 pb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1">
            {classroom.join_code ? (
              <p className="font-mono text-2xl font-bold tracking-widest text-accent select-all">
                {classroom.join_code}
              </p>
            ) : (
              <p className="font-mono text-2xl font-bold tracking-widest text-gray-300">—</p>
            )}
            <p className="text-xs text-gray-400 mt-1.5">
              把此代碼給學生，他們從首頁「加入班級」輸入即可加入
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onCopyJoinCode}
              disabled={!classroom.join_code}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isCopied ? (
                <>
                  <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-emerald-600">已複製</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  複製代碼
                </>
              )}
            </button>
            <button
              onClick={onShowRegenConfirm}
              disabled={isRegenerating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-sm hover:bg-amber-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isRegenerating ? (
                '產生中...'
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  重生代碼
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* Confirm regenerate dialog */}
    {showRegenConfirm && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="regen-dialog-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      >
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
          <h3 id="regen-dialog-title" className="text-base font-bold text-gray-900 mb-2">確認重新產生代碼？</h3>
          <p className="text-sm text-gray-600 mb-6">
            舊代碼將立即失效，學生需重新輸入新代碼才能加入此班級。
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={onHideRegenConfirm}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={onRegenerateCode}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              確定
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
};

export default ClassroomHeaderCard;
