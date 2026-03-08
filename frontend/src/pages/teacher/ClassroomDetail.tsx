import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomDetail,
  updateClassroom,
  addStudent,
  removeStudent,
  ClassroomDetailResponse,
  StudentInClassroomResponse,
  ClassroomApiError,
} from '../../services/classroomApi';
import StudentProgressTab from './StudentProgressTab';
import TextManagementTab from './TextManagementTab';
import StudentListTab from './StudentListTab';
import AssignmentTab from './AssignmentTab';
import ClassroomAnalytics from './ClassroomAnalytics';

type TabKey = 'progress' | 'texts' | 'assignments' | 'students' | 'analytics';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'progress', label: '學生進度' },
  { key: 'analytics', label: '學習分析' },
  { key: 'texts', label: '課文管理' },
  { key: 'assignments', label: '作業管理' },
  { key: 'students', label: '學生名單' },
];

interface ClassroomDetailProps {
  classroomId: number;
  onBack: () => void;
}

const ClassroomDetail: React.FC<ClassroomDetailProps> = ({ classroomId, onBack }) => {
  const { token } = useAuth();
  const [classroom, setClassroom] = useState<ClassroomDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('progress');

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Add student state
  const [studentIdInput, setStudentIdInput] = useState('');
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [addStudentError, setAddStudentError] = useState('');

  // Toggle active loading
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  // Remove confirmation
  const [removingStudentId, setRemovingStudentId] = useState<number | null>(null);

  const loadClassroom = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getClassroomDetail(token, classroomId);
      setClassroom(data);
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('無法載入班級資料');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, classroomId]);

  useEffect(() => {
    loadClassroom();
  }, [loadClassroom]);

  const startEditing = () => {
    if (!classroom) return;
    setEditName(classroom.name);
    setEditGrade(classroom.grade != null ? String(classroom.grade) : '');
    setEditError('');
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !classroom || !editName.trim()) return;

    setIsSaving(true);
    setEditError('');
    try {
      const grade = editGrade ? parseInt(editGrade, 10) : undefined;
      await updateClassroom(token, classroom.id, {
        name: editName.trim(),
        grade,
      });
      setIsEditing(false);
      await loadClassroom();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setEditError(err.message);
      } else {
        setEditError('更新失敗');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!token || !classroom) return;
    setIsTogglingActive(true);
    try {
      await updateClassroom(token, classroom.id, {
        is_active: !classroom.is_active,
      });
      await loadClassroom();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('更新狀態失敗');
      }
    } finally {
      setIsTogglingActive(false);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !studentIdInput.trim()) return;

    const studentId = parseInt(studentIdInput.trim(), 10);
    if (isNaN(studentId)) {
      setAddStudentError('請輸入有效的學生 ID');
      return;
    }

    setIsAddingStudent(true);
    setAddStudentError('');
    try {
      await addStudent(token, classroomId, studentId);
      setStudentIdInput('');
      await loadClassroom();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setAddStudentError(err.message);
      } else {
        setAddStudentError('新增學生失敗');
      }
    } finally {
      setIsAddingStudent(false);
    }
  };

  const handleRemoveStudent = async (student: StudentInClassroomResponse) => {
    if (!token) return;

    if (removingStudentId !== student.id) {
      setRemovingStudentId(student.id);
      return;
    }

    try {
      await removeStudent(token, classroomId, student.id);
      setRemovingStudentId(null);
      await loadClassroom();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('移除學生失敗');
      }
      setRemovingStudentId(null);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  const BackButton = () => (
    <button
      onClick={onBack}
      className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 transition-colors cursor-pointer"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      返回班級列表
    </button>
  );

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="h-5 bg-gray-200 animate-pulse rounded w-24 mb-6" />
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <div className="h-6 bg-gray-200 animate-pulse rounded w-1/3" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !classroom) {
    return (
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6"><BackButton /></div>
          <div className="text-center py-12 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button onClick={loadClassroom} className="mt-2 text-sm text-red-600 underline hover:text-red-800">
              重試
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!classroom) return null;

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <BackButton />

        {/* Inline error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline cursor-pointer">關閉</button>
          </div>
        )}

        {/* Classroom info card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {isEditing ? (
            <form onSubmit={handleSaveEdit} className="space-y-4">
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
                    onChange={(e) => setEditName(e.target.value)}
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
                    onChange={(e) => setEditGrade(e.target.value)}
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
                  onClick={() => setIsEditing(false)}
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
                  onClick={startEditing}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  編輯
                </button>
                <button
                  onClick={handleToggleActive}
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

        {/* Tabbed content card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          {/* Tab bar */}
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px" aria-label="Tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                    activeTab === tab.key
                      ? 'border-accent text-accent'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab content */}
          {activeTab === 'progress' && (
            <StudentProgressTab classroomId={classroomId} />
          )}

          {activeTab === 'analytics' && (
            <ClassroomAnalytics classroomId={classroomId} />
          )}

          {activeTab === 'texts' && (
            <TextManagementTab classroomId={classroomId} />
          )}

          {activeTab === 'assignments' && (
            <AssignmentTab classroomId={classroomId} />
          )}

          {activeTab === 'students' && (
            <StudentListTab
              classroom={classroom}
              token={token}
              studentIdInput={studentIdInput}
              setStudentIdInput={setStudentIdInput}
              isAddingStudent={isAddingStudent}
              addStudentError={addStudentError}
              setAddStudentError={setAddStudentError}
              onAddStudent={handleAddStudent}
              removingStudentId={removingStudentId}
              onRemoveStudent={handleRemoveStudent}
              setRemovingStudentId={setRemovingStudentId}
              formatDate={formatDate}
              onStudentsImported={loadClassroom}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ClassroomDetail;
