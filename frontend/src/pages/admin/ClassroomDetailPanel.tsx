import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { PlusIcon, ChevronRightIcon } from '../../components/icons';
import {
  getClassroomDetail,
  updateClassroom,
  addStudent,
  removeStudent,
  regenerateClassroomCode,
  searchStudentsForClassroom,
  batchCreateStudents,
  ClassroomDetailResponse,
  ClassroomApiError,
  StudentSearchResult,
  BatchStudentInput,
  BatchCreateResult,
} from '../../services/classroomApi';
import { seedDemoStudents, AdminSeedApiError } from '../../services/adminSeedApi';
import ClassroomInfoCard from './ClassroomInfoCard';
import ClassroomJoinCodeSection from './ClassroomJoinCodeSection';
import StudentSearchSection from './StudentSearchSection';
import BatchCreateStudentsPanel from './BatchCreateStudentsPanel';
import { parseBatchInput, downloadCredentialsCsv } from './classroomUtils';

interface ClassroomDetailPanelProps {
  classroomId: number;
  onBackToSchool?: (schoolId: number) => void;
}

const ClassroomDetailPanel: React.FC<ClassroomDetailPanelProps> = ({ classroomId, onBackToSchool }) => {
  const { token } = useAuth();
  const [classroom, setClassroom] = useState<ClassroomDetailResponse | null>(null);
  const [schoolName, setSchoolName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editGrade, setEditGrade] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Toggle active
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  // Join code
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [isRegeneratingCode, setIsRegeneratingCode] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Student search
  const [showStudentSearch, setShowStudentSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StudentSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingStudentId, setAddingStudentId] = useState<number | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Remove student
  const [removingStudentId, setRemovingStudentId] = useState<number | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);

  // Batch create
  const [showBatchCreate, setShowBatchCreate] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [batchPreview, setBatchPreview] = useState<BatchStudentInput[]>([]);
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchCreateResult | null>(null);
  const [batchError, setBatchError] = useState('');

  // Demo seed (Issue #989)
  const [isSeedingDemo, setIsSeedingDemo] = useState(false);

  const loadClassroom = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getClassroomDetail(token, classroomId);
      setClassroom(data);
      setJoinCode(data.join_code ?? null);
      setSchoolName(data.school_name || '');
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

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // --- Edit handlers ---

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
      const data: { name?: string; grade?: number } = {};
      if (editName.trim() !== classroom.name) data.name = editName.trim();
      const gradeVal = editGrade.trim() ? parseInt(editGrade, 10) : undefined;
      if (gradeVal !== classroom.grade) data.grade = gradeVal;

      await updateClassroom(token, classroomId, data);
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

  // --- Toggle active ---

  const handleToggleActive = async () => {
    if (!token || !classroom) return;
    setIsTogglingActive(true);
    try {
      await updateClassroom(token, classroomId, { is_active: !classroom.is_active });
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

  // --- Join code ---

  const handleCopyCode = async () => {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      setError('複製失敗，請手動複製');
    }
  };

  const handleRegenerateCode = async () => {
    if (!token) return;
    setIsRegeneratingCode(true);
    try {
      const result = await regenerateClassroomCode(token, classroomId);
      setJoinCode(result.join_code);
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('產生加入代碼失敗');
      }
    } finally {
      setIsRegeneratingCode(false);
    }
  };

  // --- Student search ---

  const handleSearchStudents = useCallback(async (query: string) => {
    if (!token || !query.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchStudentsForClassroom(token, classroomId, query.trim());
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [token, classroomId]);

  const handleSearchInputChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (value.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => handleSearchStudents(value), 300);
    } else {
      setSearchResults([]);
    }
  };

  const handleAddStudent = async (studentId: number) => {
    if (!token) return;
    setAddingStudentId(studentId);
    try {
      await addStudent(token, classroomId, studentId);
      setSearchResults((prev) => prev.filter((s) => s.id !== studentId));
      await loadClassroom();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('新增學生失敗');
      }
    } finally {
      setAddingStudentId(null);
    }
  };

  // --- Remove student ---

  const handleRemoveStudent = async (studentId: number) => {
    if (!token) return;
    setRemovingStudentId(studentId);
    try {
      await removeStudent(token, classroomId, studentId);
      setConfirmRemoveId(null);
      await loadClassroom();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('移除學生失敗');
      }
    } finally {
      setRemovingStudentId(null);
    }
  };

  // --- Batch create ---

  const handleBatchInputChange = (value: string) => {
    setBatchInput(value);
    setBatchPreview(parseBatchInput(value));
  };

  const handleSubmitBatch = async () => {
    if (!token || batchPreview.length === 0) return;
    setIsSubmittingBatch(true);
    setBatchError('');
    try {
      const result = await batchCreateStudents(token, classroomId, batchPreview);
      setBatchResult(result);
      setBatchInput('');
      setBatchPreview([]);
      await loadClassroom();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setBatchError(err.message);
      } else {
        setBatchError('批量建立失敗');
      }
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  const handleDownloadCredentials = () => {
    if (!batchResult || !classroom) return;
    downloadCredentialsCsv(batchResult, classroom.name, classroomId);
  };

  // --- Demo seed handler (Issue #989) ---

  const handleSeedDemo = async () => {
    if (!token) return;
    const countStr = window.prompt('要建立幾個 demo 學生？(預設 3, 最多 10)', '3');
    if (countStr === null) return;
    const count = Math.min(10, Math.max(1, parseInt(countStr, 10) || 3));
    setIsSeedingDemo(true);
    try {
      const result = await seedDemoStudents(token, { classroom_id: classroomId, count });
      window.alert(
        `Demo 學生建立完成！\n` +
        `建立 ${result.students_created} 位學生，${result.sessions_created} 個已完成學習紀錄\n` +
        `帳號格式：demo01@testdata.lingoleap.dev\n密碼：test1234`
      );
      await loadClassroom();
    } catch (err) {
      if (err instanceof AdminSeedApiError) {
        window.alert(`建立失敗：${err.message}`);
      } else {
        window.alert('建立失敗，請稍後再試');
      }
    } finally {
      setIsSeedingDemo(false);
    }
  };

  // --- Render ---

  if (isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-card p-6 space-y-4">
            <div className="h-6 bg-gray-200 animate-pulse rounded w-1/3" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !classroom) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button onClick={loadClassroom} className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer">
              重試
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!classroom) return null;

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Breadcrumb / back navigation */}
        {onBackToSchool && classroom.school_id && (
          <nav className="flex items-center gap-1.5 text-sm">
            <button
              onClick={() => onBackToSchool(classroom.school_id)}
              className="text-accent hover:text-accent-hover transition-colors cursor-pointer"
            >
              {schoolName || '學校'}
            </button>
            <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-gray-700 font-medium">{classroom.name}</span>
          </nav>
        )}

        {/* Inline error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline cursor-pointer">關閉</button>
          </div>
        )}

        {/* Classroom info card */}
        <ClassroomInfoCard
          classroom={classroom}
          isEditing={isEditing}
          editName={editName}
          editGrade={editGrade}
          isSaving={isSaving}
          editError={editError}
          isTogglingActive={isTogglingActive}
          onEdit={startEditing}
          onSaveEdit={handleSaveEdit}
          onCancelEdit={() => setIsEditing(false)}
          onToggleActive={handleToggleActive}
          onChangeEditName={setEditName}
          onChangeEditGrade={setEditGrade}
        />

        {/* Join code section */}
        <ClassroomJoinCodeSection
          joinCode={joinCode}
          codeCopied={codeCopied}
          isRegeneratingCode={isRegeneratingCode}
          onCopyCode={handleCopyCode}
          onRegenerateCode={handleRegenerateCode}
        />

        {/* Student list */}
        <div className="bg-white rounded-2xl shadow-card">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">學生名單</h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{(classroom.students?.length ?? 0)} 位</span>
              {!showStudentSearch && !showBatchCreate && (
                <>
                  <button
                    onClick={() => { setShowStudentSearch(true); setShowBatchCreate(false); }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    新增學生
                  </button>
                  <button
                    onClick={() => { setShowBatchCreate(true); setShowStudentSearch(false); setBatchResult(null); }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
                    </svg>
                    批量建立學生
                  </button>
                  {/* Demo seed button — Issue #989 */}
                  <button
                    onClick={handleSeedDemo}
                    disabled={isSeedingDemo}
                    title="建立 demo 學生帳號並附帶完成的學習紀錄（僅限管理員）"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSeedingDemo ? '建立中...' : '[Demo] 建立測試學生'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Student search panel */}
          {showStudentSearch && (
            <StudentSearchSection
              searchQuery={searchQuery}
              searchResults={searchResults}
              isSearching={isSearching}
              addingStudentId={addingStudentId}
              onSearchInputChange={handleSearchInputChange}
              onAddStudent={handleAddStudent}
              onClose={() => { setShowStudentSearch(false); setSearchQuery(''); setSearchResults([]); }}
            />
          )}

          {/* Batch create panel */}
          {showBatchCreate && (
            <BatchCreateStudentsPanel
              batchInput={batchInput}
              batchPreview={batchPreview}
              isSubmittingBatch={isSubmittingBatch}
              batchResult={batchResult}
              batchError={batchError}
              onBatchInputChange={handleBatchInputChange}
              onSubmitBatch={handleSubmitBatch}
              onDownloadCredentials={handleDownloadCredentials}
              onContinue={() => setBatchResult(null)}
              onClose={() => { setShowBatchCreate(false); setBatchInput(''); setBatchPreview([]); setBatchError(''); setBatchResult(null); }}
            />
          )}

          {/* Student list rows */}
          {(classroom.students?.length ?? 0) === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">尚無學生</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {(classroom.students ?? []).map((student) => (
                <div key={student.id} className="px-5 py-3 flex items-center justify-between group">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{student.name}</p>
                    <p className="text-xs text-gray-500">{student.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">
                      {new Date(student.enrolled_at).toLocaleDateString('zh-TW')}
                    </span>
                    {confirmRemoveId === student.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRemoveStudent(student.id)}
                          disabled={removingStudentId === student.id}
                          className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {removingStudentId === student.id ? '移除中...' : '確認移除'}
                        </button>
                        <button
                          onClick={() => setConfirmRemoveId(null)}
                          className="px-2 py-0.5 rounded text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemoveId(student.id)}
                        className="px-2 py-0.5 rounded text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      >
                        移除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClassroomDetailPanel;
