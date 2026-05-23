/**
 * SemesterList — sortable list of semesters with inline edit support.
 *
 * Renders each semester row with view/edit modes and an activate action.
 */
import React, { useState } from 'react';
import { SemesterResponse, SemesterApiError, updateSemester, activateSemester } from '../../../services/semesterApi';
import { EditFormState, formatDate, computeExpires } from './semesterTypes';
import { CheckCircleIcon, EditIcon } from './semesterIcons';

interface SemesterListProps {
  token: string;
  schoolId: number;
  semesters: SemesterResponse[];
  onReload: () => void;
  onError: (msg: string) => void;
}

const SemesterList: React.FC<SemesterListProps> = ({
  token,
  schoolId,
  semesters,
  onReload,
  onError,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    name: '',
    start_date: '',
    end_date: '',
    grace_days: 7,
  });
  const [editError, setEditError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [activatingId, setActivatingId] = useState<number | null>(null);

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
      onReload();
    } catch (err) {
      setEditError(err instanceof SemesterApiError ? err.message : '儲存失敗');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleActivate = async (semId: number) => {
    setActivatingId(semId);
    try {
      await activateSemester(token, schoolId, semId);
      onReload();
    } catch (err) {
      onError(err instanceof SemesterApiError ? err.message : '啟用學期失敗');
    } finally {
      setActivatingId(null);
    }
  };

  return (
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
                      過期日：
                      <span className="font-medium text-indigo-600">
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
                  <p>
                    課文過期日：
                    <span className="text-orange-600 font-medium">{formatDate(sem.expires_at_date)}</span>
                    （寬限 {sem.grace_days} 天）
                  </p>
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
  );
};

export default SemesterList;
