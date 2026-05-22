/**
 * ClassroomInfoCard — classroom name/grade display + edit form + active toggle.
 * Extracted from ClassroomDetailPanel (Issue #1850).
 */
import React from 'react';
import { ClassroomDetailResponse } from '../../services/classroomApi';

interface ClassroomInfoCardProps {
  classroom: ClassroomDetailResponse;
  isEditing: boolean;
  editName: string;
  editGrade: string;
  isSaving: boolean;
  editError: string;
  isTogglingActive: boolean;
  onEdit: () => void;
  onSaveEdit: (e: React.FormEvent) => void;
  onCancelEdit: () => void;
  onToggleActive: () => void;
  onChangeEditName: (v: string) => void;
  onChangeEditGrade: (v: string) => void;
}

const ClassroomInfoCard: React.FC<ClassroomInfoCardProps> = ({
  classroom,
  isEditing,
  editName,
  editGrade,
  isSaving,
  editError,
  isTogglingActive,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onToggleActive,
  onChangeEditName,
  onChangeEditGrade,
}) => {
  return (
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
              <label htmlFor="edit-classroom-name" className="block text-sm font-medium text-gray-700 mb-1">
                班級名稱 <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-classroom-name"
                type="text"
                value={editName}
                onChange={(e) => onChangeEditName(e.target.value)}
                required
                autoFocus
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label htmlFor="edit-classroom-grade" className="block text-sm font-medium text-gray-700 mb-1">
                年級
              </label>
              <input
                id="edit-classroom-grade"
                type="number"
                min={1}
                max={12}
                value={editGrade}
                onChange={(e) => onChangeEditGrade(e.target.value)}
                placeholder="例：5"
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving || !editName.trim()}
              className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
            >
              {isSaving ? '儲存中...' : '儲存'}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{classroom.name}</h2>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-gray-500">
              {classroom.grade != null && <span>{classroom.grade} 年級</span>}
              <span className={classroom.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                {classroom.is_active ? '使用中' : '已停用'}
              </span>
              <span>{classroom.student_count} 位學生</span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onEdit}
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
          </div>
        </div>
      )}
    </div>
  );
};

export default ClassroomInfoCard;
