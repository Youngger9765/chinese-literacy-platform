/**
 * SchoolDetailPanel — orchestrator for school detail view.
 *
 * Refactored in Issue #1849 to adopt shared primitives:
 *   - EditSection (via SchoolInfoCard)
 *   - AdminTable (via SchoolClassroomsSection + SchoolTeachersSection)
 *   - useDebouncedSearch hook (replaces manual setTimeout ref)
 *
 * Child section components live in ./school-detail/.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import SemesterPanel from './SemesterPanel';
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
import { useDebouncedSearch } from '../../hooks/useDebouncedSearch';
import SchoolInfoCard from './school-detail/SchoolInfoCard';
import SchoolClassroomsSection from './school-detail/SchoolClassroomsSection';
import SchoolJoinCodeSection from './school-detail/SchoolJoinCodeSection';
import SchoolTeachersSection from './school-detail/SchoolTeachersSection';

type SchoolTab = 'detail' | 'semesters';

interface SchoolDetailPanelProps {
  schoolId: number;
  onSelectClassroom?: (classroomId: number) => void;
  onClassroomCreated?: () => void;
}

const SchoolDetailPanel: React.FC<SchoolDetailPanelProps> = ({ schoolId, onSelectClassroom, onClassroomCreated }) => {
  const [activeTab, setActiveTab] = useState<SchoolTab>('detail');
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

  // Toggle active
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  // Classroom list state
  const [classrooms, setClassrooms] = useState<SchoolClassroomResponse[]>([]);
  const [isLoadingClassrooms, setIsLoadingClassrooms] = useState(true);
  const [classroomError, setClassroomError] = useState('');

  // Create classroom form
  const [isCreatingClassroom, setIsCreatingClassroom] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassGrade, setNewClassGrade] = useState('');
  const [newClassTeacherId, setNewClassTeacherId] = useState('');
  const [isSubmittingClassroom, setIsSubmittingClassroom] = useState(false);
  const [createClassroomError, setCreateClassroomError] = useState('');

  // Members (teachers)
  const [allTeacherMembers, setAllTeacherMembers] = useState<SchoolMemberResponse[]>([]);
  const [isLoadingAllTeachers, setIsLoadingAllTeachers] = useState(true);

  // Join code
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Teacher search — useDebouncedSearch replaces manual setTimeout ref
  const [showTeacherSearch, setShowTeacherSearch] = useState(false);
  const { query: teacherSearchQuery, setQuery: setTeacherSearchQuery, debouncedQuery } = useDebouncedSearch({ delay: 300 });
  const [teacherSearchResults, setTeacherSearchResults] = useState<UserListItem[]>([]);
  const [isSearchingTeachers, setIsSearchingTeachers] = useState(false);
  const [assigningUserId, setAssigningUserId] = useState<number | null>(null);

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

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
        setError('載入學校資訊失敗');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, schoolId]);

  const loadClassrooms = useCallback(async () => {
    if (!token) return;
    setIsLoadingClassrooms(true);
    setClassroomError('');
    try {
      const data = await listSchoolClassrooms(token, schoolId);
      setClassrooms(data);
    } catch {
      setClassroomError('載入班級列表失敗');
    } finally {
      setIsLoadingClassrooms(false);
    }
  }, [token, schoolId]);

  const loadSchoolMembers = useCallback(async () => {
    if (!token) return;
    setIsLoadingAllTeachers(true);
    try {
      const data = await listSchoolMembers(token, schoolId);
      setAllTeacherMembers(data);
    } catch {
      // silent failure — teacher list is non-critical
    } finally {
      setIsLoadingAllTeachers(false);
    }
  }, [token, schoolId]);

  useEffect(() => {
    loadSchool();
    loadClassrooms();
    loadSchoolMembers();
  }, [loadSchool, loadClassrooms, loadSchoolMembers]);

  // -----------------------------------------------------------------------
  // Teacher search — useEffect with cancellation replaces setTimeout ref
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.trim().length < 2) {
      setTeacherSearchResults([]);
      return;
    }
    let cancelled = false;
    const search = async () => {
      if (!token) return;
      setIsSearchingTeachers(true);
      try {
        const result = await listUsers(token, { search: debouncedQuery.trim(), limit: 10 });
        if (!cancelled) {
          const existingIds = new Set(allTeacherMembers.map((m) => m.user_id));
          setTeacherSearchResults(result.items.filter((u) => !existingIds.has(u.id)));
        }
      } catch {
        if (!cancelled) setTeacherSearchResults([]);
      } finally {
        if (!cancelled) setIsSearchingTeachers(false);
      }
    };
    search();
    return () => { cancelled = true; };
  }, [debouncedQuery, token, allTeacherMembers]);

  // -----------------------------------------------------------------------
  // Edit school info
  // -----------------------------------------------------------------------

  const handleStartEdit = () => {
    if (!school) return;
    setEditName(school.name);
    setEditDisplayName(school.display_name || '');
    setEditAddress(school.address || '');
    setEditPhone(school.phone || '');
    setEditError('');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditError('');
  };

  const handleSaveEdit = async () => {
    if (!token || !school) return;
    if (!editName.trim()) {
      setEditError('學校名稱不能為空');
      return;
    }
    setIsSaving(true);
    setEditError('');
    try {
      await updateSchool(token, schoolId, {
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
        setEditError('儲存失敗，請重試');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Toggle active
  // -----------------------------------------------------------------------

  const handleToggleActive = async () => {
    if (!token || !school) return;
    setIsTogglingActive(true);
    try {
      await updateSchool(token, schoolId, { is_active: !school.is_active });
      await loadSchool();
    } catch {
      // ignore
    } finally {
      setIsTogglingActive(false);
    }
  };

  // -----------------------------------------------------------------------
  // Create classroom
  // -----------------------------------------------------------------------

  const handleSubmitClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newClassName.trim()) return;
    setIsSubmittingClassroom(true);
    setCreateClassroomError('');
    try {
      await createClassroomAdmin(token, {
        name: newClassName.trim(),
        school_id: schoolId,
        grade: newClassGrade ? parseInt(newClassGrade, 10) : undefined,
        teacher_id: newClassTeacherId ? parseInt(newClassTeacherId, 10) : undefined,
      });
      setNewClassName('');
      setNewClassGrade('');
      setNewClassTeacherId('');
      setIsCreatingClassroom(false);
      await loadClassrooms();
      onClassroomCreated?.();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setCreateClassroomError(err.message);
      } else {
        setCreateClassroomError('建立班級失敗，請重試');
      }
    } finally {
      setIsSubmittingClassroom(false);
    }
  };

  const handleResetClassroomForm = () => {
    setIsCreatingClassroom(false);
    setNewClassName('');
    setNewClassGrade('');
    setNewClassTeacherId('');
    setCreateClassroomError('');
  };

  // -----------------------------------------------------------------------
  // Join code
  // -----------------------------------------------------------------------

  const handleRegenerate = async () => {
    if (!token) return;
    setIsRegenerating(true);
    try {
      const result = await regenerateSchoolCode(token, schoolId);
      setJoinCode(result.join_code);
      setCodeCopied(false);
    } catch {
      // ignore
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleCopyCode = async () => {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  // -----------------------------------------------------------------------
  // Teacher search — UI handlers
  // -----------------------------------------------------------------------

  const handleOpenSearch = () => {
    setShowTeacherSearch(true);
    setTeacherSearchQuery('');
    setTeacherSearchResults([]);
  };

  const handleCloseSearch = () => {
    setShowTeacherSearch(false);
    setTeacherSearchQuery('');
    setTeacherSearchResults([]);
  };

  const handleAssignTeacher = async (userId: number) => {
    if (!token) return;
    setAssigningUserId(userId);
    try {
      await assignRole(token, { user_id: userId, role_name: 'teacher', scope_type: 'school', scope_id: String(schoolId) });
      handleCloseSearch();
      await loadSchoolMembers();
    } catch (err) {
      if (err instanceof RoleApiError) {
        // ignore — could surface toast in future
      }
    } finally {
      setAssigningUserId(null);
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !school) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 text-sm">{error || '學校資料不存在'}</p>
        <button onClick={loadSchool} className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer">
          重試
        </button>
      </div>
    );
  }

  const tabs: { key: SchoolTab; label: string }[] = [
    { key: 'detail', label: '學校詳情' },
    { key: 'semesters', label: '學期管理' },
  ];

  return (
    <div className="space-y-6">
      {/* Tab navigation */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'semesters' ? (
        <SemesterPanel schoolId={schoolId} />
      ) : (
        <>
          {/* School info card */}
          <SchoolInfoCard
            school={school}
            isEditing={isEditing}
            editName={editName}
            editDisplayName={editDisplayName}
            editAddress={editAddress}
            editPhone={editPhone}
            isSaving={isSaving}
            editError={editError}
            isTogglingActive={isTogglingActive}
            onStartEdit={handleStartEdit}
            onCancelEdit={handleCancelEdit}
            onSave={handleSaveEdit}
            onEditName={setEditName}
            onEditDisplayName={setEditDisplayName}
            onEditAddress={setEditAddress}
            onEditPhone={setEditPhone}
            onToggleActive={handleToggleActive}
          />

          {/* Classrooms section */}
          <SchoolClassroomsSection
            classrooms={classrooms}
            isLoadingClassrooms={isLoadingClassrooms}
            classroomError={classroomError}
            onRetryClassrooms={loadClassrooms}
            onSelectClassroom={onSelectClassroom}
            isCreatingClassroom={isCreatingClassroom}
            newClassName={newClassName}
            newClassGrade={newClassGrade}
            newClassTeacherId={newClassTeacherId}
            isSubmittingClassroom={isSubmittingClassroom}
            createClassroomError={createClassroomError}
            isLoadingTeachers={isLoadingAllTeachers}
            teachers={allTeacherMembers}
            onStartCreating={() => setIsCreatingClassroom(true)}
            onResetForm={handleResetClassroomForm}
            onSubmitClassroom={handleSubmitClassroom}
            onNewClassName={setNewClassName}
            onNewClassGrade={setNewClassGrade}
            onNewClassTeacherId={setNewClassTeacherId}
          />

          {/* Join code section */}
          <SchoolJoinCodeSection
            joinCode={joinCode}
            isRegenerating={isRegenerating}
            codeCopied={codeCopied}
            onRegenerate={handleRegenerate}
            onCopy={handleCopyCode}
          />

          {/* Teachers section */}
          <SchoolTeachersSection
            allTeacherMembers={allTeacherMembers}
            isLoadingAllTeachers={isLoadingAllTeachers}
            showTeacherSearch={showTeacherSearch}
            teacherSearchQuery={teacherSearchQuery}
            teacherSearchResults={teacherSearchResults}
            isSearchingTeachers={isSearchingTeachers}
            assigningUserId={assigningUserId}
            onOpenSearch={handleOpenSearch}
            onCloseSearch={handleCloseSearch}
            onSearchQueryChange={setTeacherSearchQuery}
            onAssignTeacher={handleAssignTeacher}
          />
        </>
      )}
    </div>
  );
};

export default SchoolDetailPanel;
