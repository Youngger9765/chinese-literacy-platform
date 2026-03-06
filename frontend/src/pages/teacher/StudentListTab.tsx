import React from 'react';
import type { ClassroomDetailResponse, StudentInClassroomResponse } from '../../services/classroomApi';

interface StudentListTabProps {
  classroom: ClassroomDetailResponse;
  studentIdInput: string;
  setStudentIdInput: (v: string) => void;
  isAddingStudent: boolean;
  addStudentError: string;
  setAddStudentError: (v: string) => void;
  onAddStudent: (e: React.FormEvent) => void;
  removingStudentId: number | null;
  onRemoveStudent: (s: StudentInClassroomResponse) => void;
  setRemovingStudentId: (id: number | null) => void;
  formatDate: (d: string) => string;
}

const StudentListTab: React.FC<StudentListTabProps> = ({
  classroom,
  studentIdInput,
  setStudentIdInput,
  isAddingStudent,
  addStudentError,
  setAddStudentError,
  onAddStudent,
  removingStudentId,
  onRemoveStudent,
  setRemovingStudentId,
  formatDate,
}) => (
  <>
    {/* Add student form */}
    <div className="p-5 border-b border-gray-100">
      <form onSubmit={onAddStudent} className="flex gap-3 items-end">
        <div className="flex-1">
          <label htmlFor="add-student-id" className="block text-sm font-medium text-gray-700 mb-1">
            新增學生
          </label>
          <input
            id="add-student-id"
            type="text"
            value={studentIdInput}
            onChange={(e) => {
              setStudentIdInput(e.target.value);
              setAddStudentError('');
            }}
            placeholder="輸入學生編號"
            className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
          />
        </div>
        <button
          type="submit"
          disabled={isAddingStudent || !studentIdInput.trim()}
          className="h-10 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 rounded-lg font-medium text-sm transition-colors shrink-0"
        >
          {isAddingStudent ? '新增中...' : '新增'}
        </button>
      </form>
      <p className="text-xs text-gray-400 mt-1">學生可在個人資料頁面查看自己的編號</p>
      {addStudentError && (
        <p className="text-red-600 text-sm mt-2">{addStudentError}</p>
      )}
    </div>

    {classroom.students.length === 0 ? (
      <div className="p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-accent-bg rounded-xl mb-3">
          <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700 mb-1">尚無學生</p>
        <p className="text-xs text-gray-500">使用上方表單新增學生至班級</p>
      </div>
    ) : (
      <div className="divide-y divide-gray-100">
        {classroom.students.map((s) => (
          <div key={s.id} className="px-5 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">{s.name}</p>
              <p className="text-xs text-gray-500">{s.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 hidden sm:inline">{formatDate(s.enrolled_at)}</span>
              {removingStudentId === s.id ? (
                <div className="flex gap-2">
                  <button onClick={() => onRemoveStudent(s)} className="text-xs text-red-600 font-medium hover:text-red-800 transition-colors cursor-pointer">確認移除</button>
                  <button onClick={() => setRemovingStudentId(null)} className="text-xs text-gray-500 hover:text-gray-700 transition-colors cursor-pointer">取消</button>
                </div>
              ) : (
                <button onClick={() => onRemoveStudent(s)} className="text-xs text-gray-400 hover:text-red-600 transition-colors cursor-pointer">移除</button>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </>
);

export default StudentListTab;
