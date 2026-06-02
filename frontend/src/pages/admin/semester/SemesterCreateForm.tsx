/**
 * SemesterCreateForm — inline form for creating a new semester.
 *
 * Owns its own form state; calls onSuccess() after a successful create.
 */
import React, { useState } from 'react';
import { createSemester, SemesterApiError } from '../../../services/semesterApi';
import {
  CreateFormState,
  DEFAULT_CREATE_FORM,
  computeExpires,
} from './semesterTypes';

interface SemesterCreateFormProps {
  token: string;
  schoolId: number;
  onSuccess: () => void;
  onCancel: () => void;
}

const SemesterCreateForm: React.FC<SemesterCreateFormProps> = ({
  token,
  schoolId,
  onSuccess,
  onCancel,
}) => {
  const [form, setForm] = useState<CreateFormState>(DEFAULT_CREATE_FORM);
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) {
      setError('請輸入學期名稱');
      return;
    }
    if (!form.start_date || !form.end_date) {
      setError('請選擇開始和結束日期');
      return;
    }
    if (form.end_date <= form.start_date) {
      setError('結束日期必須晚於開始日期');
      return;
    }

    setIsCreating(true);
    try {
      await createSemester(token, schoolId, {
        name: form.name.trim(),
        start_date: form.start_date,
        end_date: form.end_date,
        grace_days: form.grace_days,
        is_active: form.is_active,
      });
      setForm(DEFAULT_CREATE_FORM);
      onSuccess();
    } catch (err) {
      setError(err instanceof SemesterApiError ? err.message : '建立學期失敗');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 p-4 border border-indigo-200 rounded-xl bg-indigo-50"
    >
      <h3 className="text-sm font-semibold text-indigo-700 mb-3">新增學期</h3>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="col-span-2">
          <label className="block text-xs text-gray-600 mb-1">學期名稱</label>
          <input
            type="text"
            placeholder="例：113學年度上學期"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">開始日期</label>
          <input
            type="date"
            value={form.start_date}
            onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">結束日期</label>
          <input
            type="date"
            value={form.end_date}
            onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">課文過期寬限天數</label>
          <input
            type="number"
            min={0}
            max={365}
            value={form.grace_days}
            onChange={e => setForm(f => ({ ...f, grace_days: Number(e.target.value) }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div className="flex items-end">
          {form.end_date && (
            <p className="text-xs text-gray-500">
              課文將於{' '}
              <span className="font-medium text-indigo-600">
                {computeExpires(form.end_date, form.grace_days)}
              </span>{' '}
              後過期
            </p>
          )}
        </div>
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            立即設為目前學期（會停用其他學期）
          </label>
        </div>
      </div>

      {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

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
          onClick={onCancel}
          className="px-4 py-1.5 bg-white border border-gray-300 text-sm rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
        >
          取消
        </button>
      </div>
    </form>
  );
};

export default SemesterCreateForm;
