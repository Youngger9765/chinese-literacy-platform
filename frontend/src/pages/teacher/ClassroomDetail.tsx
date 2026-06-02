/**
 * ClassroomDetail — Issue #1943
 *
 * Orchestrator: owns all state + data-fetching.
 * Renders via:
 *   - ClassroomHeaderCard  (班級資訊 + 加入代碼 panel)
 *   - ClassroomTabs        (tab bar + tab content delegation)
 */
import React, { useState, useEffect, useCallback } from 'react';
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
import ClassroomTabs, { TabKey } from './ClassroomTabs';

interface ClassroomDetailProps {
  classroomId: number;
  onBack: () => void;
}

const ClassroomDetail: React.FC<ClassroomDetailProps> = ({ classroomId, onBack }) => {
  const { token, user } = useAuth();
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
        <BackButton />

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

        <ClassroomTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          classroomId={classroomId}
          classroom={classroom}
          studentListProps={{
            token,
            studentIdInput,
            setStudentIdInput,
            isAddingStudent,
            addStudentError,
            setAddStudentError,
            onAddStudent: handleAddStudent,
            removingStudentId,
            onRemoveStudent: handleRemoveStudent,
            setRemovingStudentId,
            formatDate,
            onStudentsImported: loadClassroom,
          }}
        />
      </div>
    </div>
  );
};

export default ClassroomDetail;
