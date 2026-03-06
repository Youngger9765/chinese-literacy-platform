import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getSchool,
  updateSchool,
  SchoolResponse,
  SchoolApiError,
} from '../../services/schoolApi';

interface SchoolDetailPanelProps {
  schoolId: number;
}

const SchoolDetailPanel: React.FC<SchoolDetailPanelProps> = ({ schoolId }) => {
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

  useEffect(() => {
    setIsEditing(false);
    loadSchool();
  }, [loadSchool]);

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
      </div>
    </div>
  );
};

export default SchoolDetailPanel;
