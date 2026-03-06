import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getSchool,
  updateSchool,
  listSchoolClassrooms,
  listSchoolMembers,
  regenerateSchoolCode,
  SchoolResponse,
  SchoolClassroomResponse,
  SchoolMemberResponse,
  SchoolApiError,
} from '../../services/schoolApi';
import {
  createClassroomAdmin,
  ClassroomApiError,
} from '../../services/classroomApi';
import { assignRole, RoleApiError } from '../../services/roleApi';
import { listUsers, UserListItem } from '../../services/userApi';

interface SchoolDetailPanelProps {
  schoolId: number;
  onSelectClassroom?: (classroomId: number) => void;
  onClassroomCreated?: () => void;
}

const SchoolDetailPanel: React.FC<SchoolDetailPanelProps> = ({ schoolId, onSelectClassroom, onClassroomCreated }) => {
  const { token } = useAuth();
  const [school, setSchool] = useState<SchoolResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Toggle active loading
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  // Classroom list state
  const [classrooms, setClassrooms] = useState<SchoolClassroomResponse[]>([]);
  const [isLoadingClassrooms, setIsLoadingClassrooms] = useState(true);
  const [classroomError, setClassroomError] = useState('');

  // Create classroom state
  const [isCreatingClassroom, setIsCreatingClassroom] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassGrade, setNewClassGrade] = useState('');
  const [newClassTeacherId, setNewClassTeacherId] = useState('');
  const [isSubmittingClassroom, setIsSubmittingClassroom] = useState(false);
  const [createClassroomError, setCreateClassroomError] = useState('');

  // Teacher list for dropdown
  const [teachers, setTeachers] = useState<SchoolMemberResponse[]>([]);
  const [isLoadingTeachers, setIsLoadingTeachers] = useState(false);

  // School join code
  const [schoolJoinCode, setSchoolJoinCode] = useState<string | null>(null);
  const [isRegeneratingCode, setIsRegeneratingCode] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Teacher section (all school members with teacher roles)
  const [allTeacherMembers, setAllTeacherMembers] = useState<SchoolMemberResponse[]>([]);
  const [isLoadingAllTeachers, setIsLoadingAllTeachers] = useState(true);

  // Assign teacher search
  const [showTeacherSearch, setShowTeacherSearch] = useState(false);
  const [teacherSearchQuery, setTeacherSearchQuery] = useState('');
  const [teacherSearchResults, setTeacherSearchResults] = useState<UserListItem[]>([]);
  const [isSearchingTeachers, setIsSearchingTeachers] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState<number | null>(null);
  const teacherSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTeachers = useCallback(async () => {
    if (!token) return;
    setIsLoadingTeachers(true);
    try {
      const members = await listSchoolMembers(token, schoolId);
      // Filter to teachers only
      const teacherMembers = members.filter(
        (m) => m.role_name === 'teacher' || m.role_name === 'school_admin'
      );
      setTeachers(teacherMembers);
    } catch {
      // Silently fail - teacher dropdown will just be empty
      setTeachers([]);
    } finally {
      setIsLoadingTeachers(false);
    }
  }, [token, schoolId]);

  const loadClassrooms = useCallback(async () => {
    if (!token) return;
    setIsLoadingClassrooms(true);
    setClassroomError('');
    try {
      const data = await listSchoolClassrooms(token, schoolId);
      setClassrooms(data);
    } catch (err) {
      if (err instanceof SchoolApiError) {
        setClassroomError(err.message);
      } else {
        setClassroomError('無法載入班級資料');
      }
    } finally {
      setIsLoadingClassrooms(false);
    }
  }, [token, schoolId]);

  const loadSchool = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getSchool(token, schoolId);
      setSchool(data);
    } catch (err) {
      if (err instanceof SchoolApiError) {
        setError(err.message);
      } else {
        setError('無法載入學校資料');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, schoolId]);

  const loadAllTeacherMembers = useCallback(async () => {
    if (!token) return;
    setIsLoadingAllTeachers(true);
    try {
      const members = await listSchoolMembers(token, schoolId);
      const teacherRoles = ['teacher', 'school_admin', 'principal', 'director'];
      setAllTeacherMembers(members.filter((m) => teacherRoles.includes(m.role_name)));
    } catch {
      setAllTeacherMembers([]);
    } finally {
      setIsLoadingAllTeachers(false);
    }
  }, [token, schoolId]);

  useEffect(() => {
    setIsEditing(false);
    loadSchool();
    loadClassrooms();
    loadAllTeacherMembers();
  }, [loadSchool, loadClassrooms, loadAllTeacherMembers]);

  const startEditing = () => {
    if (!school) return;
    setEditName(school.name);
    setEditDisplayName(school.display_name || '');
    setEditAddress(school.address || '');
    setEditPhone(school.phone || '');
    setEditError('');
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !school || !editName.trim()) return;

    setIsSaving(true);
    setEditError('');
    try {
      await updateSchool(token, school.id, {
        name: editName.trim(),
        display_name: editDisplayName.trim() || undefined,
        address: editAddress.trim() || undefined,
        phone: editPhone.trim() || undefined,
      });
      setIsEditing(false);
      await loadSchool();
    } catch (err) {
      if (err instanceof SchoolApiError) {
        setEditError(err.message);
      } else {
        setEditError('更新失敗');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!token || !school) return;
    setIsTogglingActive(true);
    try {
      await updateSchool(token, school.id, {
        is_active: !school.is_active,
      });
      await loadSchool();
    } catch (err) {
      if (err instanceof SchoolApiError) {
        setError(err.message);
      } else {
        setError('更新狀態失敗');
      }
    } finally {
      setIsTogglingActive(false);
    }
  };

  const resetClassroomForm = () => {
    setIsCreatingClassroom(false);
    setNewClassName('');
    setNewClassGrade('');
    setNewClassTeacherId('');
    setCreateClassroomError('');
  };

  const handleStartCreatingClassroom = () => {
    setIsCreatingClassroom(true);
    loadTeachers();
  };

  const handleCreateClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newClassName.trim()) return;

    setIsSubmittingClassroom(true);
    setCreateClassroomError('');
    try {
      const data: { name: string; school_id: number; grade?: number; teacher_id?: number } = {
        name: newClassName.trim(),
        school_id: schoolId,
      };
      if (newClassGrade.trim()) {
        data.grade = parseInt(newClassGrade, 10);
      }
      if (newClassTeacherId) {
        data.teacher_id = parseInt(newClassTeacherId, 10);
      }
      await createClassroomAdmin(token, data);
      resetClassroomForm();
      await loadClassrooms();
      onClassroomCreated?.();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setCreateClassroomError(err.message);
      } else {
        setCreateClassroomError('建立班級失敗');
      }
    } finally {
      setIsSubmittingClassroom(false);
    }
  };

  // --- School join code ---

  const handleCopySchoolCode = async () => {
    if (!schoolJoinCode) return;
    try {
      await navigator.clipboard.writeText(schoolJoinCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = schoolJoinCode;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  };

  const handleRegenerateSchoolCode = async () => {
    if (!token) return;
    setIsRegeneratingCode(true);
    try {
      const result = await regenerateSchoolCode(token, schoolId);
      setSchoolJoinCode(result.join_code);
    } catch (err) {
      if (err instanceof SchoolApiError) {
        setError(err.message);
      } else {
        setError('產生加入代碼失敗');
      }
    } finally {
      setIsRegeneratingCode(false);
    }
  };

  // --- Teacher search / assign ---

  const handleTeacherSearchInputChange = (value: string) => {
    setTeacherSearchQuery(value);
    if (teacherSearchTimeoutRef.current) clearTimeout(teacherSearchTimeoutRef.current);
    if (value.trim().length >= 2) {
      teacherSearchTimeoutRef.current = setTimeout(() => searchTeacherUsers(value), 300);
    } else {
      setTeacherSearchResults([]);
    }
  };

  const searchTeacherUsers = async (query: string) => {
    if (!token) return;
    setIsSearchingTeachers(true);
    try {
      const result = await listUsers(token, { search: query.trim(), limit: 10 });
      // Exclude users already assigned as teachers in this school
      const existingIds = new Set(allTeacherMembers.map((m) => m.user_id));
      setTeacherSearchResults(result.items.filter((u) => !existingIds.has(u.id)));
    } catch {
      setTeacherSearchResults([]);
    } finally {
      setIsSearchingTeachers(false);
    }
  };

  const handleAssignTeacher = async (userId: number) => {
    if (!token) return;
    setAssigningUserId(userId);
    try {
      await assignRole(token, {
        user_id: userId,
        role_name: 'teacher',
        scope_type: 'school',
        scope_id: String(schoolId),
      });
      setTeacherSearchResults((prev) => prev.filter((u) => u.id !== userId));
      await loadAllTeacherMembers();
      // Also refresh the teacher dropdown for classroom creation
      await loadTeachers();
    } catch (err) {
      if (err instanceof RoleApiError) {
        setError(err.message);
      } else {
        setError('指派教師失敗');
      }
    } finally {
      setAssigningUserId(null);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

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

  if (error && !school) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button onClick={loadSchool} className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer">
              重試
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!school) return null;

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Inline error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline cursor-pointer">關閉</button>
          </div>
        )}

        {/* School info card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {isEditing ? (
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <h2 className="text-base font-bold text-gray-900">編輯學校</h2>
              {editError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {editError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-school-name" className="block text-sm font-medium text-gray-700 mb-1">
                    學校名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="edit-school-name"
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                    autoFocus
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-school-display" className="block text-sm font-medium text-gray-700 mb-1">
                    顯示名稱
                  </label>
                  <input
                    id="edit-school-display"
                    type="text"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    placeholder="自訂顯示名稱"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-school-phone" className="block text-sm font-medium text-gray-700 mb-1">
                    電話
                  </label>
                  <input
                    id="edit-school-phone"
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="例：02-2345-6789"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-school-address" className="block text-sm font-medium text-gray-700 mb-1">
                    地址
                  </label>
                  <input
                    id="edit-school-address"
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    placeholder="例：台北市大安區信義路四段1號"
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
                <h2 className="text-xl font-bold text-gray-900">
                  {school.display_name || school.name}
                </h2>
                {school.display_name && (
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{school.name}</p>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-gray-500">
                  <span className={school.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                    {school.is_active ? '使用中' : '已停用'}
                  </span>
                  <span>{formatDate(school.created_at)}</span>
                </div>
                {(school.address || school.phone) && (
                  <div className="mt-4 space-y-2 text-sm text-gray-600">
                    {school.address && (
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                        </svg>
                        <span>{school.address}</span>
                      </div>
                    )}
                    {school.phone && (
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                        </svg>
                        <span>{school.phone}</span>
                      </div>
                    )}
                  </div>
                )}
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
                    school.is_active
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  {isTogglingActive ? '更新中...' : school.is_active ? '停用' : '啟用'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Classroom list */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">班級列表</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{classrooms.length} 班</span>
              {!isCreatingClassroom && (
                <button
                  onClick={handleStartCreatingClassroom}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  新增班級
                </button>
              )}
            </div>
          </div>

          {/* Create classroom inline form */}
          {isCreatingClassroom && (
            <div className="p-5 border-b border-gray-100 bg-gray-50/50">
              <form onSubmit={handleCreateClassroom} className="space-y-4">
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
                      onChange={(e) => setNewClassName(e.target.value)}
                      required
                      autoFocus
                      placeholder="例：五年一班"
                      className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
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
                      onChange={(e) => setNewClassGrade(e.target.value)}
                      placeholder="例：5"
                      className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-class-teacher" className="block text-sm font-medium text-gray-700 mb-1">
                      導師
                    </label>
                    <select
                      id="new-class-teacher"
                      value={newClassTeacherId}
                      onChange={(e) => setNewClassTeacherId(e.target.value)}
                      className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
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
                    onClick={resetClassroomForm}
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
                  onClick={loadClassrooms}
                  className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
                >
                  重試
                </button>
              </div>
            ) : classrooms.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-6">尚無班級</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="pb-2 font-medium">班級名稱</th>
                      <th className="pb-2 font-medium">年級</th>
                      <th className="pb-2 font-medium">導師</th>
                      <th className="pb-2 font-medium text-center">學生數</th>
                      <th className="pb-2 font-medium text-center">狀態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {classrooms.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => onSelectClassroom?.(c.id)}
                        className={`hover:bg-gray-50/50 ${onSelectClassroom ? 'cursor-pointer' : ''}`}
                      >
                        <td className="py-2.5 text-gray-900 font-medium">{c.name}</td>
                        <td className="py-2.5 text-gray-600">{c.grade != null ? `${c.grade} 年級` : '-'}</td>
                        <td className="py-2.5 text-gray-600">{c.teacher_name}</td>
                        <td className="py-2.5 text-gray-600 text-center">{c.student_count}</td>
                        <td className="py-2.5 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              c.is_active
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {c.is_active ? '使用中' : '已停用'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* School join code card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="font-bold text-gray-900 mb-4">學校加入代碼</h3>
          {schoolJoinCode ? (
            <div className="flex items-center gap-3">
              <div className="bg-gray-100 font-mono text-lg tracking-widest px-4 py-2 rounded-lg text-gray-900">
                {schoolJoinCode}
              </div>
              <button
                onClick={handleCopySchoolCode}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition-colors cursor-pointer"
                title="複製代碼"
              >
                {codeCopied ? '已複製' : '複製'}
              </button>
              <button
                onClick={handleRegenerateSchoolCode}
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
                onClick={handleRegenerateSchoolCode}
                disabled={isRegeneratingCode}
                className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRegeneratingCode ? '產生中...' : '產生代碼'}
              </button>
            </div>
          )}
        </div>

        {/* Teacher section */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">教師</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{allTeacherMembers.length} 位</span>
              {!showTeacherSearch && (
                <button
                  onClick={() => setShowTeacherSearch(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  指派教師
                </button>
              )}
            </div>
          </div>

          {/* Teacher search panel */}
          {showTeacherSearch && (
            <div className="p-5 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-gray-900">搜尋使用者並指派為教師</h4>
                <button
                  onClick={() => { setShowTeacherSearch(false); setTeacherSearchQuery(''); setTeacherSearchResults([]); }}
                  className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
                >
                  關閉
                </button>
              </div>
              <input
                type="text"
                value={teacherSearchQuery}
                onChange={(e) => handleTeacherSearchInputChange(e.target.value)}
                placeholder="輸入姓名或 email 搜尋..."
                autoFocus
                className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
              {isSearchingTeachers && (
                <div className="flex items-center gap-2 mt-3">
                  <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400">搜尋中...</span>
                </div>
              )}
              {!isSearchingTeachers && teacherSearchResults.length > 0 && (
                <div className="mt-3 divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white overflow-hidden">
                  {teacherSearchResults.map((user) => (
                    <div key={user.id} className="px-4 py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                      <button
                        onClick={() => handleAssignTeacher(user.id)}
                        disabled={assigningUserId === user.id}
                        className="px-3 py-1 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {assigningUserId === user.id ? '指派中...' : '指派'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!isSearchingTeachers && teacherSearchQuery.trim().length >= 2 && teacherSearchResults.length === 0 && (
                <p className="mt-3 text-xs text-gray-400">找不到符合的使用者</p>
              )}
            </div>
          )}

          <div className="p-5">
            {isLoadingAllTeachers ? (
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 animate-pulse rounded w-2/3" />
                <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
              </div>
            ) : allTeacherMembers.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-6">尚無教師</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-gray-500">
                      <th className="pb-2 font-medium">姓名</th>
                      <th className="pb-2 font-medium">Email</th>
                      <th className="pb-2 font-medium">角色</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {allTeacherMembers.map((m) => (
                      <tr key={m.user_id}>
                        <td className="py-2.5 text-gray-900 font-medium">{m.name}</td>
                        <td className="py-2.5 text-gray-600">{m.email}</td>
                        <td className="py-2.5">
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-accent-bg text-accent">
                            {m.role_display_name}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SchoolDetailPanel;
