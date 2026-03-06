import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
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
import { getSchool, SchoolApiError } from '../../services/schoolApi';

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

  const loadClassroom = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getClassroomDetail(token, classroomId);
      setClassroom(data);
      setJoinCode(data.join_code ?? null);

      // Fetch school name for breadcrumb
      if (data.school_id) {
        try {
          const school = await getSchool(token, data.school_id);
          setSchoolName(school.display_name || school.name);
        } catch (err) {
          if (err instanceof SchoolApiError) {
            setSchoolName('');
          }
        }
      }
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
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = joinCode;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
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

  const parseBatchInput = (input: string): BatchStudentInput[] => {
    return input
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split(/\s+/);
        const name = parts[0];
        const seat_number = parts[1] || undefined;
        return { name, seat_number };
      });
  };

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
    if (!batchResult) return;
    const header = '姓名,座號,帳號,密碼';
    const rows = batchResult.created.map(
      (s) => `${s.name},${s.seat_number},${s.username},${s.password}`
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `班級學生帳號_${classroom?.name || classroomId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Render ---

  if (isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
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
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
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
                  <label htmlFor="edit-classroom-name" className="block text-sm font-medium text-gray-700 mb-1">
                    班級名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="edit-classroom-name"
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
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
                    onChange={(e) => setEditGrade(e.target.value)}
                    placeholder="例：5"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
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

        {/* Join code card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="font-bold text-gray-900 mb-4">加入代碼</h3>
          {joinCode ? (
            <div className="flex items-center gap-3">
              <div className="bg-gray-100 font-mono text-lg tracking-widest px-4 py-2 rounded-lg text-gray-900">
                {joinCode}
              </div>
              <button
                onClick={handleCopyCode}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
                title="複製代碼"
              >
                {codeCopied ? '已複製' : '複製'}
              </button>
              <button
                onClick={handleRegenerateCode}
                disabled={isRegeneratingCode}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRegeneratingCode ? '產生中...' : '重新產生'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">尚無加入代碼</span>
              <button
                onClick={handleRegenerateCode}
                disabled={isRegeneratingCode}
                className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRegeneratingCode ? '產生中...' : '產生代碼'}
              </button>
            </div>
          )}
        </div>

        {/* Student list */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">學生名單</h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{classroom.students.length} 位</span>
              {!showStudentSearch && !showBatchCreate && (
                <>
                  <button
                    onClick={() => { setShowStudentSearch(true); setShowBatchCreate(false); }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
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
                </>
              )}
            </div>
          </div>

          {/* Student search panel */}
          {showStudentSearch && (
            <div className="p-5 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-gray-900">搜尋並新增學生</h4>
                <button
                  onClick={() => { setShowStudentSearch(false); setSearchQuery(''); setSearchResults([]); }}
                  className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
                >
                  關閉
                </button>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                placeholder="輸入姓名或 email 搜尋..."
                autoFocus
                className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
              {isSearching && (
                <div className="flex items-center gap-2 mt-3">
                  <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400">搜尋中...</span>
                </div>
              )}
              {!isSearching && searchResults.length > 0 && (
                <div className="mt-3 divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white overflow-hidden">
                  {searchResults.map((student) => (
                    <div key={student.id} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{student.name}</p>
                        <p className="text-xs text-gray-500">{student.email}</p>
                      </div>
                      <button
                        onClick={() => handleAddStudent(student.id)}
                        disabled={addingStudentId === student.id}
                        className="px-3 py-1 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {addingStudentId === student.id ? '加入中...' : '加入'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!isSearching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <p className="mt-3 text-xs text-gray-400">找不到符合的使用者</p>
              )}
            </div>
          )}

          {/* Batch create panel */}
          {showBatchCreate && (
            <div className="p-5 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-gray-900">批量建立學生</h4>
                <button
                  onClick={() => { setShowBatchCreate(false); setBatchInput(''); setBatchPreview([]); setBatchError(''); setBatchResult(null); }}
                  className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
                >
                  關閉
                </button>
              </div>

              {batchResult ? (
                // Show results after successful creation
                <div className="space-y-4">
                  {batchResult.created.length > 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-medium text-green-800">
                          成功建立 {batchResult.created.length} 位學生
                        </p>
                        <button
                          onClick={handleDownloadCredentials}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors cursor-pointer"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                          </svg>
                          下載登入資訊
                        </button>
                      </div>
                      <div className="overflow-x-auto">
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
                    onClick={() => { setBatchResult(null); }}
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
                      onChange={(e) => handleBatchInputChange(e.target.value)}
                      placeholder={'王小明 1\n李小華 2\n陳大文 3'}
                      className="w-full min-h-[120px] px-3 py-2 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors resize-y"
                    />
                  </div>

                  {batchPreview.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">預覽：將建立 {batchPreview.length} 位學生</p>
                      <div className="overflow-x-auto border border-gray-200 rounded-lg">
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
                      onClick={() => { setShowBatchCreate(false); setBatchInput(''); setBatchPreview([]); setBatchError(''); }}
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSubmitBatch}
                      disabled={isSubmittingBatch || batchPreview.length === 0}
                      className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
                    >
                      {isSubmittingBatch ? '建立中...' : `建立 ${batchPreview.length} 位學生`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Student list rows */}
          {classroom.students.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">尚無學生</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {classroom.students.map((student) => (
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
