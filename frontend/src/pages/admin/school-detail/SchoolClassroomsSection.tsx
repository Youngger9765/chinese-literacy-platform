/**
 * SchoolClassroomsSection — classroom list + create-classroom inline form.
 *
 * Extracted from SchoolDetailPanel (Issue #1849).
 * Uses AdminTable primitive for the desktop table view.
 */
import React from 'react';
import { PlusIcon } from '../../../components/icons';
import AdminTable, { ColumnDef } from '../../../components/admin/AdminTable';
import { SchoolClassroomResponse, SchoolMemberResponse } from '../../../services/schoolApi';

export interface SchoolClassroomsSectionProps {
  classrooms: SchoolClassroomResponse[];
  isLoadingClassrooms: boolean;
  classroomError: string;
  onRetryClassrooms: () => void;
  onSelectClassroom?: (id: number) => void;

  /** Create form */
  isCreatingClassroom: boolean;
  newClassName: string;
  newClassGrade: string;
  newClassTeacherId: string;
  isSubmittingClassroom: boolean;
  createClassroomError: string;
  isLoadingTeachers: boolean;
  teachers: SchoolMemberResponse[];

  onStartCreating: () => void;
  onResetForm: () => void;
  onSubmitClassroom: (e: React.FormEvent) => void;
  onNewClassName: (v: string) => void;
  onNewClassGrade: (v: string) => void;
  onNewClassTeacherId: (v: string) => void;
}

const INPUT_CLS =
  'w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors';

const CLASSROOM_COLUMNS: ColumnDef<SchoolClassroomResponse>[] = [
  { key: 'name', header: '班級名稱', render: (c) => <span className="font-medium text-gray-900">{c.name}</span> },
  { key: 'grade', header: '年級', render: (c) => c.grade != null ? `${c.grade} 年級` : '-' },
  { key: 'teacher_name', header: '導師', render: (c) => c.teacher_name || '-' },
  {
    key: 'student_count',
    header: '學生數',
    render: (c) => <span className="block text-center">{c.student_count}</span>,
  },
  {
    key: 'is_active',
    header: '狀態',
    render: (c) => (
      <span className="flex justify-center">
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
            c.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {c.is_active ? '使用中' : '已停用'}
        </span>
      </span>
    ),
  },
];

const SchoolClassroomsSection: React.FC<SchoolClassroomsSectionProps> = ({
  classrooms,
  isLoadingClassrooms,
  classroomError,
  onRetryClassrooms,
  onSelectClassroom,
  isCreatingClassroom,
  newClassName,
  newClassGrade,
  newClassTeacherId,
  isSubmittingClassroom,
  createClassroomError,
  isLoadingTeachers,
  teachers,
  onStartCreating,
  onResetForm,
  onSubmitClassroom,
  onNewClassName,
  onNewClassGrade,
  onNewClassTeacherId,
}) => {
  return (
    <div className="bg-white rounded-2xl shadow-card">
      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-bold text-gray-900">班級列表</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{classrooms.length} 班</span>
          {!isCreatingClassroom && (
            <button
              onClick={onStartCreating}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              新增班級
            </button>
          )}
        </div>
      </div>

      {/* Create classroom inline form */}
      {isCreatingClassroom && (
        <div className="p-5 border-b border-gray-100 bg-gray-50/50">
          <form onSubmit={onSubmitClassroom} className="space-y-4">
            <h4 className="text-sm font-bold text-gray-900">新增班級</h4>
            {createClassroomError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {createClassroomError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="new-class-name" className="block text-sm font-medium text-gray-700 mb-1">
                  班級名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  id="new-class-name"
                  type="text"
                  value={newClassName}
                  onChange={(e) => onNewClassName(e.target.value)}
                  required
                  autoFocus
                  placeholder="例：五年一班"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="new-class-grade" className="block text-sm font-medium text-gray-700 mb-1">
                  年級
                </label>
                <input
                  id="new-class-grade"
                  type="number"
                  min={1}
                  max={12}
                  value={newClassGrade}
                  onChange={(e) => onNewClassGrade(e.target.value)}
                  placeholder="例：5"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label htmlFor="new-class-teacher" className="block text-sm font-medium text-gray-700 mb-1">
                  導師
                </label>
                <select
                  id="new-class-teacher"
                  value={newClassTeacherId}
                  onChange={(e) => onNewClassTeacherId(e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">
                    {isLoadingTeachers ? '載入中...' : '-- 選擇導師 --'}
                  </option>
                  {teachers.map((t) => (
                    <option key={t.user_id} value={String(t.user_id)}>
                      {t.name} ({t.role_display_name})
                    </option>
                  ))}
                </select>
                {!isLoadingTeachers && teachers.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">尚無可選導師，請先指派教師角色</p>
                )}
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onResetForm}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmittingClassroom || !newClassName.trim()}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                {isSubmittingClassroom ? '建立中...' : '建立班級'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="p-5">
        {isLoadingClassrooms ? (
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-2/3" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-3/4" />
          </div>
        ) : classroomError ? (
          <div className="text-center py-6">
            <p className="text-red-600 text-sm">{classroomError}</p>
            <button
              onClick={onRetryClassrooms}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
            >
              重試
            </button>
          </div>
        ) : classrooms.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">尚無班級</p>
        ) : (
          <AdminTable
            columns={CLASSROOM_COLUMNS}
            rows={classrooms}
            rowKey={(c) => c.id}
            onRowClick={onSelectClassroom ? (c) => onSelectClassroom(c.id) : undefined}
            cardTitle={(c) => c.name}
          />
        )}
      </div>
    </div>
  );
};

export default SchoolClassroomsSection;
