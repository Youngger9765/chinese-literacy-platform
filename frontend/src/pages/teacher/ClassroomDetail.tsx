/**
 * ClassroomDetail — Issue #1943, re-laid out for #3367
 *
 * Orchestrator: owns all state + data-fetching.
 * Renders via:
 *   - ClassSwitcher        (切換班級，停在同一個分頁)
 *   - ClassroomHeaderCard  (班級資訊 + 加入代碼 panel)
 *   - 學生名單              (原本是獨立分頁，依現場回饋放進班級頁首，可收合)
 *   - ClassroomTabs        (tab bar + tab content delegation)
 *
 * 目前分頁與點開的作業記在網址（?tab= / ?assignment=），切班、重新整理、分享連結都不會跑掉。
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomDetail,
  updateClassroom,
  addStudent,
  removeStudent,
  exportClassroomReport,
  regenerateClassroomCode,
  ClassroomDetailResponse,
  StudentInClassroomResponse,
  ClassroomApiError,
} from '../../services/classroomApi';
import ClassroomHeaderCard from './ClassroomHeaderCard';
import ClassroomTabs, { TabKey, resolveTabKey } from './ClassroomTabs';
import StudentListTab from './StudentListTab';
import ClassSwitcher from './panel/ClassSwitcher';

interface ClassroomDetailProps {
  classroomId: number;
  onBack: () => void;
}

const ClassroomDetail: React.FC<ClassroomDetailProps> = ({ classroomId, onBack }) => {
  const { token, user } = useAuth();
  const [classroom, setClassroom] = useState<ClassroomDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTabKey(searchParams.get('tab'));
  const assignmentParam = searchParams.get('assignment');
  const selectedAssignmentId = assignmentParam ? Number(assignmentParam) || null : null;
  // Collapsed by default so the class page opens on content, not the roster (#3376).
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const studentParam = searchParams.get('student');
  const selectedStudentId = studentParam ? Number(studentParam) || null : null;

  const updateParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };
  const setActiveTab = (tab: TabKey) =>
    updateParams({
      tab,
      assignment: tab === 'assignments' ? searchParams.get('assignment') : null,
      student: tab === 'students' ? searchParams.get('student') : null,
    });
  const setSelectedStudent = (id: number | null) =>
    updateParams({ tab: 'students', assignment: null, student: id === null ? null : String(id) });
  const setSelectedAssignment = (id: number | null) =>
    updateParams({ tab: 'assignments', assignment: id === null ? null : String(id) });
  const switchClassroom = (id: number) => navigate(`/teacher/classroom/${id}?tab=${activeTab}`);

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

  // Export CSV
  const [isExporting, setIsExporting] = useState(false);

  // Remove confirmation
  const [removingStudentId, setRemovingStudentId] = useState<number | null>(null);

  // Join code state
  const [isCopied, setIsCopied] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

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

  const handleExportCsv = () => {
    if (!token || isExporting) return;
    setIsExporting(true);
    exportClassroomReport(token, classroomId);
    // Reset after a short delay to re-enable the button
    setTimeout(() => setIsExporting(false), 2000);
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

  const handleCopyJoinCode = async () => {
    if (!classroom?.join_code) return;
    try {
      await navigator.clipboard.writeText(classroom.join_code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // clipboard API unavailable (non-HTTPS dev env)
      setIsCopied(false);
    }
  };

  const handleRegenerateCode = async () => {
    if (!token || !classroom) return;
    setIsRegenerating(true);
    setShowRegenConfirm(false);
    try {
      await regenerateClassroomCode(token, classroom.id);
      await loadClassroom();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('重新產生代碼失敗');
      }
    } finally {
      setIsRegenerating(false);
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
          <div className="bg-white rounded-2xl shadow-card p-6 space-y-4">
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BackButton />
          <ClassSwitcher currentId={classroomId} onSwitch={switchClassroom} />
        </div>

        {/* Inline error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline cursor-pointer">關閉</button>
          </div>
        )}

        <ClassroomHeaderCard
          classroom={classroom}
          isEditing={isEditing}
          editName={editName}
          editGrade={editGrade}
          isSaving={isSaving}
          editError={editError}
          onStartEditing={startEditing}
          onCancelEditing={() => setIsEditing(false)}
          onEditNameChange={setEditName}
          onEditGradeChange={setEditGrade}
          onSaveEdit={handleSaveEdit}
          isTogglingActive={isTogglingActive}
          onToggleActive={handleToggleActive}
          isExporting={isExporting}
          onExportCsv={handleExportCsv}
          isCopied={isCopied}
          showRegenConfirm={showRegenConfirm}
          isRegenerating={isRegenerating}
          onCopyJoinCode={handleCopyJoinCode}
          onShowRegenConfirm={() => setShowRegenConfirm(true)}
          onHideRegenConfirm={() => setShowRegenConfirm(false)}
          onRegenerateCode={handleRegenerateCode}
          formatDate={formatDate}
        />

        <section className="bg-white rounded-2xl shadow-card" aria-label="學生名單">
          <button
            type="button"
            onClick={() => setIsRosterOpen((v) => !v)}
            aria-expanded={isRosterOpen}
            className="w-full flex items-center justify-between px-6 py-4 text-left cursor-pointer"
          >
            <span className="text-lg font-semibold text-gray-900">
              學生名單（{classroom.students.length} 人）
            </span>
            <span className="text-sm text-gray-500">{isRosterOpen ? '收合 ▲' : '展開 ▼'}</span>
          </button>
          {isRosterOpen && (
            <div className="border-t border-gray-100">
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
            </div>
          )}
        </section>

        <ClassroomTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          classroomId={classroomId}
          ownerId={classroom.teacher_id}
          selectedAssignmentId={selectedAssignmentId}
          onSelectAssignment={setSelectedAssignment}
          selectedStudentId={selectedStudentId}
          onSelectStudent={setSelectedStudent}
        />
      </div>
    </div>
  );
};

export default ClassroomDetail;
