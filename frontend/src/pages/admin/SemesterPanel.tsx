/**
 * SemesterPanel — manage semesters for a school.
 *
 * Features:
 * - List all semesters for a school (ordered newest first)
 * - Show active semester badge
 * - Create new semester with name, start/end date, grace_days
 * - Activate a semester (propagates expires_at to ClassroomText rows)
 * - Edit semester name / dates / grace_days
 * - Show expires_at_date (= end_date + grace_days)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listSemesters,
  createSemester,
  updateSemester,
  activateSemester,
  SemesterResponse,
  SemesterApiError,
} from '../../services/semesterApi';

// ── Icons ─────────────────────────────────────────────────────────────────────

const CalendarIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const PlusIcon: React.FC = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const CheckCircleIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const EditIcon: React.FC = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return iso; // already YYYY-MM-DD
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface CreateFormState {
  name: string;
  start_date: string;
  end_date: string;
  grace_days: number;
  is_active: boolean;
}

const DEFAULT_FORM: CreateFormState = {
  name: '',
  start_date: '',
  end_date: '',
  grace_days: 7,
  is_active: false,
};

interface EditFormState {
  name: string;
  start_date: string;
  end_date: string;
  grace_days: number;
}

// ── Main Component ────────────────────────────────────────────────────────────

interface SemesterPanelProps {
  schoolId: number;
}

const SemesterPanel: React.FC<SemesterPanelProps> = ({ schoolId }) => {
  const { token } = useAuth();

  const [semesters, setSemesters] = useState<SemesterResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(DEFAULT_FORM);
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Edit form
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({ name: '', start_date: '', end_date: '', grace_days: 7 });
  const [editError, setEditError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Activate
  const [activatingId, setActivatingId] = useState<number | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listSemesters(token, schoolId);
      setSemesters(data);
    } catch (err) {
      setError(err instanceof SemesterApiError ? err.message : '載入學期失敗');
    } finally {
      setIsLoading(false);
    }
  }, [token, schoolId]);

  useEffect(() => { load(); }, [load]);

  // ── Create ──────────────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setCreateError('');

    if (!createForm.name.trim()) {
      setCreateError('請輸入學期名稱');
      return;
    }
    if (!createForm.start_date || !createForm.end_date) {
      setCreateError('請選擇開始和結束日期');
      return;
    }
    if (createForm.end_date <= createForm.start_date) {
      setCreateError('結束日期必須晚於開始日期');
      return;
    }

    setIsCreating(true);
    try {
      await createSemester(token, schoolId, {
        name: createForm.name.trim(),
        start_date: createForm.start_date,
        end_date: createForm.end_date,
        grace_days: createForm.grace_days,
        is_active: createForm.is_active,
      });
      setCreateForm(DEFAULT_FORM);
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof SemesterApiError ? err.message : '建立學期失敗');
    } finally {
      setIsCreating(false);
    }
  };

  // ── Activate ─────────────────────────────────────────────────────────────────

  const handleActivate = async (semId: number) => {
    if (!token) return;
    setActivatingId(semId);
    try {
      await activateSemester(token, schoolId, semId);
      await load();
    } catch (err) {
      setError(err instanceof SemesterApiError ? err.message : '啟用學期失敗');
    } finally {
      setActivatingId(null);
    }
  };

  // ── Edit ─────────────────────────────────────────────────────────────────────

  const startEdit = (sem: SemesterResponse) => {
    setEditingId(sem.id);
    setEditForm({
      name: sem.name,
      start_date: sem.start_date,
      end_date: sem.end_date,
      grace_days: sem.grace_days,
    });
    setEditError('');
  };

  const handleSaveEdit = async (semId: number) => {
    if (!token) return;
    setEditError('');

    if (!editForm.name.trim()) {
      setEditError('名稱不可空白');
      return;
    }
    if (editForm.end_date <= editForm.start_date) {
      setEditError('結束日期必須晚於開始日期');
      return;
    }

    setIsSavingEdit(true);
    try {
      await updateSemester(token, schoolId, semId, {
        name: editForm.name.trim(),
        start_date: editForm.start_date,
        end_date: editForm.end_date,
        grace_days: editForm.grace_days,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof SemesterApiError ? err.message : '儲存失敗');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // ── Computed expires preview ──────────────────────────────────────────────

  const computeExpires = (end: string, grace: number): string => {
    if (!end) return '';
    const d = new Date(end);
    d.setDate(d.getDate() + grace);
    return d.toISOString().split('T')[0];
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-800">學期管理</h2>
        </div>
        {!showCreate && (
          <button
            onClick={() => { setShowCreate(true); setCreateError(''); setCreateForm(DEFAULT_FORM); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
          >
            <PlusIcon />
            新增學期
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 border border-indigo-200 rounded-xl bg-indigo-50"
        >
          <h3 className="text-sm font-semibold text-indigo-700 mb-3">新增學期</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">學期名稱</label>
              <input
                type="text"
                placeholder="例：113學年度上學期"
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">開始日期</label>
              <input
                type="date"
                value={createForm.start_date}
                onChange={e => setCreateForm(f => ({ ...f, start_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">結束日期</label>
              <input
                type="date"
                value={createForm.end_date}
                onChange={e => setCreateForm(f => ({ ...f, end_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">課文過期寬限天數</label>
              <input
                type="number"
                min={0}
                max={365}
                value={createForm.grace_days}
                onChange={e => setCreateForm(f => ({ ...f, grace_days: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div className="flex items-end">
              {createForm.end_date && (
                <p className="text-xs text-gray-500">
                  課文將於 <span className="font-medium text-indigo-600">{computeExpires(createForm.end_date, createForm.grace_days)}</span> 後過期
                </p>
              )}
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createForm.is_active}
                  onChange={e => setCreateForm(f => ({ ...f, is_active: e.target.checked }))}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                立即設為目前學期（會停用其他學期）
              </label>
            </div>
          </div>
          {createError && (
            <p className="text-red-600 text-xs mb-3">{createError}</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isCreating ? '建立中...' : '建立'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-1.5 bg-white border border-gray-300 text-sm rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            >
              取消
            </button>
          </div>
        </form>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
          載入中...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
          {error}
          <button onClick={load} className="ml-2 underline cursor-pointer">重試</button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && semesters.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <CalendarIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">尚無學期設定</p>
          <p className="text-xs mt-1">點擊「新增學期」開始建立</p>
        </div>
      )}

      {/* Semester list */}
      {!isLoading && semesters.length > 0 && (
        <div className="space-y-3">
          {semesters.map(sem => (
            <div
              key={sem.id}
              className={`border rounded-xl p-4 transition-colors ${
                sem.is_active
                  ? 'border-green-300 bg-green-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              {editingId === sem.id ? (
                /* Edit inline form */
                <div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">學期名稱</label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">開始日期</label>
                      <input
                        type="date"
                        value={editForm.start_date}
                        onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">結束日期</label>
                      <input
                        type="date"
                        value={editForm.end_date}
                        onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">寬限天數</label>
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={editForm.grace_days}
                        onChange={e => setEditForm(f => ({ ...f, grace_days: Number(e.target.value) }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </div>
                    <div className="flex items-end">
                      {editForm.end_date && (
                        <p className="text-xs text-gray-500">
                          過期日：<span className="font-medium text-indigo-600">
                            {computeExpires(editForm.end_date, editForm.grace_days)}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                  {editError && <p className="text-red-600 text-xs mb-2">{editError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(sem.id)}
                      disabled={isSavingEdit}
                      className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                    >
                      {isSavingEdit ? '儲存中...' : '儲存'}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 bg-white border border-gray-300 text-xs rounded-lg hover:bg-gray-50 cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                /* Display row */
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-800 text-sm">{sem.name}</span>
                      {sem.is_active && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                          <CheckCircleIcon className="w-3 h-3" />
                          目前學期
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>學期期間：{formatDate(sem.start_date)} — {formatDate(sem.end_date)}</p>
                      <p>課文過期日：<span className="text-orange-600 font-medium">{formatDate(sem.expires_at_date)}</span>（寬限 {sem.grace_days} 天）</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!sem.is_active && (
                      <button
                        onClick={() => handleActivate(sem.id)}
                        disabled={activatingId === sem.id}
                        className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        {activatingId === sem.id ? '設定中...' : '設為目前學期'}
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(sem)}
                      className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                      title="編輯"
                    >
                      <EditIcon />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Expiry policy note */}
      <div className="mt-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-xs text-amber-700">
          版權保護說明：根據 PRD §742-756，教師上傳的課文在學期結束後加上寬限天數會自動過期。
          過期的課文由系統管理員執行清理作業（Admin &gt; 清理）進行軟刪除。
        </p>
      </div>
    </div>
  );
};

export default SemesterPanel;
