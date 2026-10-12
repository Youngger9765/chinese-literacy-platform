import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  listMyClassrooms,
  createClassroom,
  listJunyiImportableClasses,
  batchCreateStudents,
  ClassroomResponse,
  ClassroomApiError,
  BatchCreateResult,
} from '../../services/classroomApi';
import { parseRoster } from './panel/AddStudentsPanel';
import SchoolSwitcher from '../../components/teacher/SchoolSwitcher';
import { Skeleton, SkeletonText } from '../../components/ui/Skeleton';
import LoadingIndicator from '../../components/ui/LoadingIndicator';
import { useToast } from '../../components/ui/Toast';
import JunyiClassImportSection from './JunyiClassImportSection';

interface TeacherDashboardProps {
  onSelectClassroom: (
    classroomId: number,
    justCreated?: ClassroomResponse,
    createdStudents?: BatchCreateResult,
  ) => void;
}

const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ onSelectClassroom }) => {
  const { token, user } = useAuth();
  const { activeSchoolId: teacherSchoolId, hasMultipleSchools } = useWorkspace();
  const location = useLocation();
  // Fix #1545: detect intent:'reports' navigation from TeacherHome quick-action
  const isReportsIntent = (location.state as { intent?: string } | null)?.intent === 'reports';
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Search & sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'grade' | 'students'>('name');

  // Create form state
  const { toast, showToast } = useToast();

  // Create form state
  // The class page's left column has a 建立班級 button that lands here with
  // intent 'create' (Junyi-parity layout), so open the form straight away.
  const [showCreateForm, setShowCreateForm] = useState(
    (location.state as { intent?: string } | null)?.intent === 'create',
  );
  // Junyi-parity: one question in the 建立班級 dialog — how do students join?
  //   create: 幫學生建立帳號（貼名單或填人數）／ join: 學生已有帳號（建好後給班級代碼）／ junyi: 匯入均一班級
  const [creationMethod, setCreationMethod] = useState<'create' | 'join' | 'junyi'>('create');
  const [rosterText, setRosterText] = useState('');
  const [newName, setNewName] = useState('');
  const [newGrade, setNewGrade] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Issue #3406: the "匯入均一班級學生" toggle must stay hidden until we know
  // the feature is actually available — otherwise a teacher on an env where
  // JUNYI_CLASS_IMPORT_ENABLED is off clicks it and sees an empty panel
  // (JunyiClassImportSection 404s and renders null).
  // null = unknown/probing (toggle hidden, no flash), true = available,
  // false = confirmed off (list endpoint 404s).
  const [junyiImportAvailable, setJunyiImportAvailable] = useState<boolean | null>(null);

  /**
   * When the teacher is in multiple schools, filter classrooms to the
   * currently-selected school. Single-school teachers see all classrooms.
   */
  const visibleClassrooms = useMemo(() => {
    const base = hasMultipleSchools && teacherSchoolId != null
      ? classrooms.filter((cr) => cr.school_id === teacherSchoolId)
      : classrooms;
    return base
      .filter((cr) => !searchQuery || cr.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'grade') return (a.grade ?? 99) - (b.grade ?? 99);
        if (sortBy === 'students') return b.student_count - a.student_count;
        return a.name.localeCompare(b.name, 'zh-TW');
      });
  }, [classrooms, searchQuery, sortBy, hasMultipleSchools, teacherSchoolId]);

  const loadClassrooms = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listMyClassrooms(token);
      setClassrooms(data.items);
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('無法載入班級列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  // Issue #3406: probe the Junyi import feature exactly once per dialog
  // open, before rendering the toggle. Reset to "unknown" on close so a
  // stale availability result never leaks into the next open.
  useEffect(() => {
    if (!showCreateForm) {
      setJunyiImportAvailable(null);
      return;
    }
    if (!token || teacherSchoolId == null) return;

    let cancelled = false;
    (async () => {
      try {
        await listJunyiImportableClasses(token, teacherSchoolId);
        if (!cancelled) setJunyiImportAvailable(true);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ClassroomApiError && err.status === 404) {
          // Feature flag off on this env — keep the toggle hidden.
          setJunyiImportAvailable(false);
        } else {
          // Any other error (401/500/network) isn't what this probe is
          // for — don't hide a feature that's actually enabled. The real
          // fetch inside JunyiClassImportSection will surface it properly.
          setJunyiImportAvailable(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showCreateForm, token, teacherSchoolId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newName.trim()) return;

    setIsCreating(true);
    setCreateError('');
    try {
      if (!teacherSchoolId) {
        setCreateError('尚未指派學校，請聯繫管理員');
        setIsCreating(false);
        return;
      }
      const grade = newGrade ? parseInt(newGrade, 10) : undefined;
      const created = await createClassroom(token, {
        name: newName.trim(),
        school_id: teacherSchoolId,
        grade,
      });
      setClassrooms((prev) => [...prev, created]);
      // Students typed into the dialog are created right away, so one 建立
      // gives a class with accounts. Their passwords come back only once, so
      // the result travels to the class page, which opens on it.
      const roster = creationMethod === 'create' ? parseRoster(rosterText, 1) : [];
      let createdStudents: BatchCreateResult | undefined;
      if (roster.length > 0) {
        try {
          createdStudents = await batchCreateStudents(token, created.id, roster);
        } catch {
          showToast('班級已建立，但學生帳號沒有建成功，請在班級頁按「新增學生」再試一次', 'error');
        }
      }
      showToast(`班級「${created.name}」建立成功！`, 'success');
      setNewName('');
      setNewGrade('');
      setRosterText('');
      setShowCreateForm(false);
      // 均一模式 (#3378): a new class goes straight to "add students".
      // #3411: pass the classroom we already have so ClassroomDetail can
      // render it immediately instead of depending on a fresh GET that
      // raced with the navigation and sometimes lost (bounced back to the
      // list before the detail page had anything to show).
      onSelectClassroom(created.id, created, createdStudents);
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setCreateError(err.message);
      } else {
        setCreateError('建立班級失敗');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const ClassroomCardSkeleton = () => (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <Skeleton className="h-5 w-2/3 rounded mb-3" />
      <SkeletonText lines={3} lineClassName="h-4 rounded" />
    </div>
  );

  // Count used in the subtitle: visible after school filter, before text search
  const schoolFilteredCount = hasMultipleSchools && teacherSchoolId != null
    ? classrooms.filter((cr) => cr.school_id === teacherSchoolId).length
    : classrooms.length;

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      {toast}
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {isReportsIntent ? '查看學習報告' : '班級管理'}
            </h1>
            {isLoading ? (
              <Skeleton className="mt-2 h-4 w-28 rounded" />
            ) : (
              <p className="text-sm text-gray-500 mt-1">共 {schoolFilteredCount} 個班級</p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* School switcher — only shown when teacher belongs to multiple schools */}
            <SchoolSwitcher />
            <button
              onClick={() => setShowCreateForm(true)}
              className="bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors whitespace-nowrap"
            >
              建立班級
            </button>
          </div>
        </div>

        {/* Fix #1545: Reports intent banner — shown when navigating from "查看報告" quick-action */}
        {isReportsIntent && (
          <div
            data-testid="reports-intent-banner"
            className="flex items-start gap-3 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3"
            role="status"
          >
            <span className="text-xl shrink-0" aria-hidden="true">📊</span>
            <div>
              <p className="text-sm font-semibold text-purple-800">選擇班級以查看報告</p>
              <p className="text-xs text-purple-600 mt-0.5">點擊下方班級卡片，即可進入該班級的學習報告</p>
            </div>
          </div>
        )}

        {/* Search & sort */}
        {!isLoading && classrooms.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋班級名稱..."
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'grade' | 'students')}
              className="h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            >
              <option value="name">依名稱排序</option>
              <option value="grade">依年級排序</option>
              <option value="students">依人數排序</option>
            </select>
          </div>
        )}

        {/* Create dialog — Junyi-parity: centred modal, one question about students */}
        {/* Portalled to <body>: an animated (transformed) ancestor otherwise turns
            `fixed inset-0` into "inset of that ancestor" and the top strip stays undimmed. */}
        {showCreateForm && createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-classroom-title"
            className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-3 sm:p-6 overflow-y-auto"
          >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-auto p-5 sm:p-7">
            <h2 id="create-classroom-title" className="text-xl font-bold text-gray-900 mb-5">建立新班級</h2>

            {createError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
                {createError}
              </div>
            )}

            {creationMethod !== 'junyi' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div>
                  <label htmlFor="classroom-name" className="block text-sm font-medium text-gray-700 mb-1">
                    班級名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="classroom-name"
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="例：五年甲班"
                    required
                    autoFocus
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-base focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="classroom-grade" className="block text-sm font-medium text-gray-700 mb-1">
                    年級
                  </label>
                  <select
                    id="classroom-grade"
                    value={newGrade}
                    onChange={(e) => setNewGrade(e.target.value)}
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-base focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  >
                    <option value="">未指定</option>
                    <optgroup label="國小">
                      {[1, 2, 3, 4, 5, 6].map((g) => (
                        <option key={g} value={g}>{g} 年級</option>
                      ))}
                    </optgroup>
                    <optgroup label="國中">
                      {[7, 8, 9].map((g) => (
                        <option key={g} value={g}>{g} 年級</option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>
            )}

            {/* The Junyi option (#3406) only renders once the probe confirmed the
                feature is available on this env, so it never opens an empty panel. */}
            <fieldset className="mb-5">
              <legend className="text-base text-gray-700 mb-2">請選擇加入學生的方式</legend>
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="creation-method"
                    checked={creationMethod === 'create'}
                    onChange={() => setCreationMethod('create')}
                    className="mt-1 w-5 h-5 accent-accent"
                  />
                  <span className="text-base text-gray-900">還沒有帳號：幫學生建立帳號</span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="creation-method"
                    checked={creationMethod === 'join'}
                    onChange={() => setCreationMethod('join')}
                    className="mt-1 w-5 h-5 accent-accent"
                  />
                  <span className="text-base text-gray-900">學生已有帳號（含均一帳號）：建好後給學生班級代碼加入</span>
                </label>
                {junyiImportAvailable === true && (
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="creation-method"
                      checked={creationMethod === 'junyi'}
                      onChange={() => setCreationMethod('junyi')}
                      className="mt-1 w-5 h-5 accent-accent"
                    />
                    <span className="text-base text-gray-900">匯入均一班級學生：直接帶入我在均一的班級與學生</span>
                  </label>
                )}
              </div>
            </fieldset>

            {creationMethod === 'junyi' && junyiImportAvailable === true ? (
              teacherSchoolId != null ? (
                <JunyiClassImportSection
                  token={token!}
                  schoolId={teacherSchoolId}
                  onImported={() => {
                    setShowCreateForm(false);
                    setCreationMethod('create');
                    showToast('均一班級匯入完成', 'success');
                    loadClassrooms();
                  }}
                />
              ) : (
                <p className="text-sm text-gray-500">尚未指派學校，請聯繫管理員</p>
              )
            ) : (
              <form onSubmit={handleCreate} className="space-y-4">
                {creationMethod === 'create' && (
                  <div className="space-y-2">
                    <label htmlFor="create-roster" className="block text-base font-semibold text-gray-800">
                      幫學生建立帳號與密碼
                    </label>
                    <p className="text-sm text-gray-600">
                      一行一位學生，可以寫「座號 姓名」或只寫姓名；也可以只填人數（例如 28）。可以先空著，之後在班級頁按「新增學生」
                    </p>
                    <textarea
                      id="create-roster"
                      value={rosterText}
                      onChange={(e) => setRosterText(e.target.value)}
                      rows={5}
                      placeholder={'1 王小明\n2 林雨萱\n3 陳柏宇'}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-base focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent"
                    />
                  </div>
                )}
                {creationMethod === 'join' && (
                  <p className="text-base text-gray-700 bg-sky-50 rounded-lg px-4 py-3">
                    建好後，班級頁上方會有「班級代碼」，學生登入後在首頁「加入班級」輸入就會加入
                  </p>
                )}
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false);
                      setCreateError('');
                      setNewName('');
                      setNewGrade('');
                      setRosterText('');
                    }}
                    className="h-11 px-5 rounded-lg border border-gray-300 text-gray-700 text-base font-medium hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating || !newName.trim()}
                    className="h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 rounded-lg font-medium text-base transition-colors"
                  >
                    {isCreating
                      ? '建立中...'
                      : creationMethod === 'create' && parseRoster(rosterText, 1).length > 0
                        ? `建立班級和 ${parseRoster(rosterText, 1).length} 個學生帳號`
                        : '確定建立班級'}
                  </button>
                </div>
              </form>
            )}
          </div>
          </div>,
          document.body,
        )}

        {/* Error state */}
        {error && (
          <div className="text-center py-6 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button
              onClick={loadClassrooms}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800"
            >
              重試
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-6">
            <LoadingIndicator />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <ClassroomCardSkeleton key={i} />
              ))}
            </div>
          </div>
        )}

        {/* No search results */}
        {!isLoading && !error && visibleClassrooms.length === 0 && classrooms.length > 0 && searchQuery && (
          <div className="text-center py-8 text-sm text-gray-500">
            找不到符合「{searchQuery}」的班級
          </div>
        )}

        {/* No classrooms in selected school (multi-school, no text query) */}
        {!isLoading && !error && visibleClassrooms.length === 0 && classrooms.length > 0 && !searchQuery && hasMultipleSchools && (
          <div className="text-center py-8 text-sm text-gray-500">
            此學校目前沒有班級
          </div>
        )}

        {/* Classroom grid */}
        {!isLoading && !error && visibleClassrooms.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleClassrooms.map((cr) => {
              const isCoTeacher = user?.id != null && cr.teacher_id !== user.id;
              return (
                <button
                  key={cr.id}
                  onClick={() => onSelectClassroom(cr.id)}
                  className="bg-white rounded-2xl shadow-card p-5 text-left hover:shadow-md transition-all group cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-bold text-gray-900 group-hover:text-accent transition-colors">
                      {cr.name}
                    </h3>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {isCoTeacher && (
                        <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200">
                          協同教師
                        </span>
                      )}
                      {!cr.is_active && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          已停用
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5 text-sm text-gray-500">
                    {cr.grade != null && (
                      <p>{cr.grade} 年級</p>
                    )}
                    <p>{cr.student_count} 位學生</p>
                    <p className="text-xs">{formatDate(cr.created_at)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Empty state — no classrooms at all */}
        {!isLoading && !error && classrooms.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-bg rounded-2xl mb-4">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">尚未建立班級</h3>
            <p className="text-sm text-gray-500 mb-4">建立你的第一個班級，開始管理學生</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
            >
              建立班級
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherDashboard;
