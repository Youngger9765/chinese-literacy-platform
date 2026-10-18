/**
 * ClassroomHeaderCard — Issue #1943 / #1987
 *
 * Renders:
 *  - Classroom name, grade badge, student count, active status (view + edit form)
 *  - Action buttons: 編輯 / 停用啟用 / 匯出CSV
 *  - Join code panel — accordion (collapsed when ≥1 student, expanded for new class)
 *    with a QR button (#3081) for projecting the code so students scan
 *    instead of typing
 */
import React from 'react';
import { ClassroomDetailResponse } from '../../services/classroomApi';
import ClassroomJoinQrButton from '../../components/qr/ClassroomJoinQrButton';

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

  // Delete classroom
  isDeleting: boolean;
  showDeleteConfirm: boolean;
  onShowDeleteConfirm: () => void;
  onHideDeleteConfirm: () => void;
  onDeleteClassroom: () => void;

  // Join code
  isCopied: boolean;
  showRegenConfirm: boolean;
  isRegenerating: boolean;
  onCopyJoinCode: () => void;
  onShowRegenConfirm: () => void;
  onHideRegenConfirm: () => void;
  onRegenerateCode: () => void;

  // Junyi-parity: 新增學生 opens the add-students modal owned by the page
  onAddStudents?: () => void;

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
  isDeleting,
  showDeleteConfirm,
  onShowDeleteConfirm,
  onHideDeleteConfirm,
  onDeleteClassroom,
  isCopied,
  showRegenConfirm,
  isRegenerating,
  onCopyJoinCode,
  onShowRegenConfirm,
  onHideRegenConfirm,
  onRegenerateCode,
  onAddStudents,
  formatDate,
}) => {

  return (
    <>
    {/* Classroom info card */}
    <div>
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
        <div className="space-y-4">
          {/*
           * Junyi-parity header: 班名＋鉛筆 / 班級代碼 on one line, a stat box,
           * and an icon-tile action row on the right. #3424's rule still holds:
           * every group may wrap as a whole, nothing breaks mid-word.
           */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-2xl font-bold text-gray-900 break-words">{classroom.name}</h2>
              <button
                type="button"
                onClick={onStartEditing}
                aria-label="編輯班級名稱與年級"
                title="編輯"
                className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg text-gray-700 whitespace-nowrap">
                班級代碼：
                <span className="font-mono font-bold tracking-wider text-accent select-all">
                  {classroom.join_code ?? '—'}
                </span>
              </span>
              <button
                onClick={onCopyJoinCode}
                disabled={!classroom.join_code}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isCopied ? <span className="text-emerald-600">已複製</span> : '複製代碼'}
              </button>
              <ClassroomJoinQrButton classroomName={classroom.name} joinCode={classroom.join_code} />
              <button
                onClick={onShowRegenConfirm}
                disabled={isRegenerating}
                className="inline-flex items-center px-2.5 py-1 rounded-md border border-amber-300 text-amber-700 text-sm hover:bg-amber-50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isRegenerating ? '產生中...' : '重生代碼'}
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-500">學生登入後在首頁「加入班級」輸入班級代碼，就會加入這個班</p>

          <div className="flex flex-wrap items-stretch justify-between gap-4">
            <div className="grid grid-cols-3 sm:flex items-stretch border border-gray-300 rounded-lg divide-x divide-gray-300 bg-white w-full sm:w-auto">
              <div className="px-3 sm:px-5 py-3 flex flex-col sm:flex-row items-center gap-1 sm:gap-4">
                <span className="text-sm text-gray-500 whitespace-nowrap">班級人數</span>
                <span className="text-3xl font-semibold text-gray-900">{classroom.student_count}<span className="text-base font-normal text-gray-600 ml-1.5">位</span></span>
              </div>
              <div className="px-3 sm:px-5 py-3 flex flex-col sm:flex-row items-center gap-1 sm:gap-4">
                <span className="text-sm text-gray-500 whitespace-nowrap">年級</span>
                <span className="text-xl font-semibold text-gray-900 whitespace-nowrap">
                  {classroom.grade != null ? `${classroom.grade} 年級` : '未指定'}
                </span>
              </div>
              <div className="px-3 sm:px-5 py-3 flex items-center justify-center">
                <span className={`text-base font-medium whitespace-nowrap ${classroom.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {classroom.is_active ? '使用中' : '已停用'}
                </span>
                <span className="sr-only">建立於 {formatDate(classroom.created_at)}</span>
              </div>
            </div>

            <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto" role="group" aria-label="班級操作">
              {onAddStudents && (
                <button
                  type="button"
                  onClick={onAddStudents}
                  className="sm:w-20 h-[72px] flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white shadow-sm hover:bg-accent-bg text-gray-700 cursor-pointer"
                >
                  <span aria-hidden="true" className="w-7 h-7 rounded-full bg-accent text-white text-xl leading-7 text-center">＋</span>
                  <span className="text-xs whitespace-nowrap">新增學生</span>
                </button>
              )}
              <button
                onClick={onExportCsv}
                disabled={isExporting}
                className="sm:w-20 h-[72px] flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white shadow-sm hover:bg-blue-50 text-gray-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="text-xs whitespace-nowrap">{isExporting ? '匯出中...' : '匯出 CSV'}</span>
              </button>
              <button
                onClick={onToggleActive}
                disabled={isTogglingActive}
                className="sm:w-20 h-[72px] flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white shadow-sm hover:bg-gray-50 text-gray-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className={`w-7 h-7 ${classroom.is_active ? 'text-gray-500' : 'text-emerald-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={classroom.is_active ? 'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z' : 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z'} />
                </svg>
                <span className="text-xs whitespace-nowrap">
                  {isTogglingActive ? '更新中...' : classroom.is_active ? '停用' : '啟用'}
                </span>
              </button>
              <button
                onClick={onShowDeleteConfirm}
                disabled={isDeleting}
                className="sm:w-20 h-[72px] flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white shadow-sm hover:bg-red-50 text-gray-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span className="text-xs whitespace-nowrap">{isDeleting ? '解散中...' : '解散班級'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
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

    {showDeleteConfirm && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      >
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
          <h3 id="delete-dialog-title" className="text-base font-bold text-gray-900 mb-2">
            確定要解散「{classroom.name}」嗎？
          </h3>
          <p className="text-sm text-gray-600 mb-6">
            班級內的作業與指派紀錄將一併刪除，且無法復原
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={onHideDeleteConfirm}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={onDeleteClassroom}
              disabled={isDeleting}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              {isDeleting ? '解散中...' : '確定解散'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
};

export default ClassroomHeaderCard;
