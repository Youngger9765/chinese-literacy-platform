import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { PlusIcon, SchoolIcon } from '../../components/icons';
import {
  getOrganization,
  updateOrganization,
  OrganizationDetailResponse,
  OrganizationApiError,
} from '../../services/organizationApi';
import {
  createSchool,
  SchoolApiError,
} from '../../services/schoolApi';

interface OrgDetailPanelProps {
  organizationId: string;
  onSchoolCreated?: () => void;
  onSelectSchool?: (schoolId: number) => void;
}

const OrgDetailPanel: React.FC<OrgDetailPanelProps> = ({ organizationId, onSchoolCreated, onSelectSchool }) => {
  const { token } = useAuth();
  const [org, setOrg] = useState<OrganizationDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Toggle active loading
  const [isTogglingActive, setIsTogglingActive] = useState(false);

  // Create school state
  const [isCreatingSchool, setIsCreatingSchool] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newSchoolAddress, setNewSchoolAddress] = useState('');
  const [newSchoolPhone, setNewSchoolPhone] = useState('');
  const [isSubmittingSchool, setIsSubmittingSchool] = useState(false);
  const [createSchoolError, setCreateSchoolError] = useState('');

  const loadOrg = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getOrganization(token, organizationId);
      setOrg(data);
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setError(err.message);
      } else {
        setError('無法載入機構資料');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, organizationId]);

  useEffect(() => {
    setIsEditing(false);
    loadOrg();
  }, [loadOrg]);

  const startEditing = () => {
    if (!org) return;
    setEditName(org.name);
    setEditDisplayName(org.display_name || '');
    setEditError('');
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !org || !editName.trim()) return;

    setIsSaving(true);
    setEditError('');
    try {
      await updateOrganization(token, org.id, {
        name: editName.trim(),
        display_name: editDisplayName.trim() || undefined,
      });
      setIsEditing(false);
      await loadOrg();
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setEditError(err.message);
      } else {
        setEditError('更新失敗');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!token || !org) return;
    const name = org.display_name || org.name;
    const confirmed = org.is_active
      ? window.confirm(`確定要停用「${name}」嗎？停用後將無法使用。`)
      : window.confirm(`確定要啟用「${name}」嗎？`);
    if (!confirmed) return;
    setIsTogglingActive(true);
    try {
      await updateOrganization(token, org.id, {
        is_active: !org.is_active,
      });
      await loadOrg();
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setError(err.message);
      } else {
        setError('更新狀態失敗');
      }
    } finally {
      setIsTogglingActive(false);
    }
  };

  const resetSchoolForm = () => {
    setIsCreatingSchool(false);
    setNewSchoolName('');
    setNewSchoolAddress('');
    setNewSchoolPhone('');
    setCreateSchoolError('');
  };

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newSchoolName.trim()) return;

    setIsSubmittingSchool(true);
    setCreateSchoolError('');
    try {
      await createSchool(token, {
        name: newSchoolName.trim(),
        organization_id: organizationId,
        address: newSchoolAddress.trim() || undefined,
        phone: newSchoolPhone.trim() || undefined,
      });
      resetSchoolForm();
      await loadOrg();
      onSchoolCreated?.();
    } catch (err) {
      if (err instanceof SchoolApiError) {
        setCreateSchoolError(err.message);
      } else {
        setCreateSchoolError('建立學校失敗');
      }
    } finally {
      setIsSubmittingSchool(false);
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
          </div>
        </div>
      </div>
    );
  }

  if (error && !org) {
    return (
      <div className="p-6 sm:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button onClick={loadOrg} className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer">
              重試
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!org) return null;

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

        {/* Org info card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {isEditing ? (
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <h2 className="text-base font-bold text-gray-900">編輯機構</h2>
              {editError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {editError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-org-name" className="block text-sm font-medium text-gray-700 mb-1">
                    機構代碼 <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="edit-org-name"
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                    autoFocus
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-org-display" className="block text-sm font-medium text-gray-700 mb-1">
                    顯示名稱
                  </label>
                  <input
                    id="edit-org-display"
                    type="text"
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    placeholder="自訂顯示名稱"
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
                  {org.display_name || org.name}
                </h2>
                {org.display_name && (
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{org.name}</p>
                )}
                <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-gray-500">
                  <span className={org.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                    {org.is_active ? '使用中' : '已停用'}
                  </span>
                  <span>{org.school_count} 所學校</span>
                  <span>{formatDate(org.created_at)}</span>
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
                    org.is_active
                      ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  {isTogglingActive ? '更新中...' : org.is_active ? '停用' : '啟用'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Schools in this org */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">所屬學校</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{org.schools.length} 所</span>
              {!isCreatingSchool && (
                <button
                  onClick={() => setIsCreatingSchool(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  新增學校
                </button>
              )}
            </div>
          </div>

          {/* Create school inline form */}
          {isCreatingSchool && (
            <div className="p-5 border-b border-gray-100 bg-gray-50/50">
              <form onSubmit={handleCreateSchool} className="space-y-4">
                <h4 className="text-sm font-bold text-gray-900">新增學校</h4>
                {createSchoolError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                    {createSchoolError}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="new-school-name" className="block text-sm font-medium text-gray-700 mb-1">
                      學校名稱 <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="new-school-name"
                      type="text"
                      value={newSchoolName}
                      onChange={(e) => setNewSchoolName(e.target.value)}
                      required
                      autoFocus
                      placeholder="例：大安國小"
                      className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-school-phone" className="block text-sm font-medium text-gray-700 mb-1">
                      電話
                    </label>
                    <input
                      id="new-school-phone"
                      type="text"
                      value={newSchoolPhone}
                      onChange={(e) => setNewSchoolPhone(e.target.value)}
                      placeholder="例：02-2345-6789"
                      className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="new-school-address" className="block text-sm font-medium text-gray-700 mb-1">
                      地址
                    </label>
                    <input
                      id="new-school-address"
                      type="text"
                      value={newSchoolAddress}
                      onChange={(e) => setNewSchoolAddress(e.target.value)}
                      placeholder="例：台北市大安區信義路四段1號"
                      className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                    />
                  </div>
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={resetSchoolForm}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingSchool || !newSchoolName.trim()}
                    className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
                  >
                    {isSubmittingSchool ? '建立中...' : '建立學校'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {org.schools.length === 0 && !isCreatingSchool ? (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-accent-bg rounded-xl mb-3">
                <SchoolIcon className="w-6 h-6 text-accent" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">尚無所屬學校</p>
              <p className="text-xs text-gray-500">點擊上方「新增學校」按鈕建立</p>
            </div>
          ) : org.schools.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {org.schools.map((school) => (
                <div
                  key={school.id}
                  onClick={() => onSelectSchool?.(school.id)}
                  className={`px-5 py-3 flex items-center justify-between ${onSelectSchool ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                >
                  <div>
                    <p className={`text-sm font-medium ${onSelectSchool ? 'text-accent hover:underline' : 'text-gray-900'}`}>
                      {school.display_name || school.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {school.address && (
                        <p className="text-xs text-gray-500 truncate max-w-xs">{school.address}</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs ${school.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {school.is_active ? '使用中' : '已停用'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default OrgDetailPanel;
