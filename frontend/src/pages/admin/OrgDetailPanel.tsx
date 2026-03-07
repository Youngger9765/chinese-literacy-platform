import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { PlusIcon, SchoolIcon } from '../../components/icons';
import {
  getOrganization,
  updateOrganization,
  getPointsLogs,
  OrganizationDetailResponse,
  PointsLogResponse,
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

const LOGS_PAGE_SIZE = 10;

const OrgDetailPanel: React.FC<OrgDetailPanelProps> = ({ organizationId, onSchoolCreated, onSelectSchool }) => {
  const { token } = useAuth();
  const [org, setOrg] = useState<OrganizationDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTaxId, setEditTaxId] = useState('');
  const [editContactEmail, setEditContactEmail] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
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

  // Points logs state
  const [logs, setLogs] = useState<PointsLogResponse[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsOffset, setLogsOffset] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);

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

  const loadLogs = useCallback(async (offset: number) => {
    if (!token) return;
    setLogsLoading(true);
    try {
      const data = await getPointsLogs(token, organizationId, { limit: LOGS_PAGE_SIZE, offset });
      if (offset === 0) {
        setLogs(data.items);
      } else {
        setLogs((prev) => [...prev, ...data.items]);
      }
      setLogsTotal(data.total);
      setLogsOffset(offset);
    } catch {
      // silently ignore log load errors
    } finally {
      setLogsLoading(false);
    }
  }, [token, organizationId]);

  useEffect(() => {
    setIsEditing(false);
    setLogs([]);
    setLogsOffset(0);
    loadOrg();
    loadLogs(0);
  }, [loadOrg, loadLogs]);

  const startEditing = () => {
    if (!org) return;
    setEditName(org.name);
    setEditDisplayName(org.display_name || '');
    setEditDescription(org.description || '');
    setEditTaxId(org.tax_id || '');
    setEditContactEmail(org.contact_email || '');
    setEditContactPhone(org.contact_phone || '');
    setEditAddress(org.address || '');
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
        description: editDescription.trim() || undefined,
        tax_id: editTaxId.trim() || undefined,
        contact_email: editContactEmail.trim() || undefined,
        contact_phone: editContactPhone.trim() || undefined,
        address: editAddress.trim() || undefined,
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

  const formatDateTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

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

  const remainingPoints = org.total_points != null ? org.total_points - org.used_points : null;
  const usagePercent = org.total_points != null && org.total_points > 0
    ? Math.min(100, Math.round((org.used_points / org.total_points) * 100))
    : 0;

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
                <div>
                  <label htmlFor="edit-org-tax-id" className="block text-sm font-medium text-gray-700 mb-1">
                    統一編號
                  </label>
                  <input
                    id="edit-org-tax-id"
                    type="text"
                    value={editTaxId}
                    onChange={(e) => setEditTaxId(e.target.value)}
                    placeholder="例：12345678"
                    maxLength={20}
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-org-email" className="block text-sm font-medium text-gray-700 mb-1">
                    聯絡信箱
                  </label>
                  <input
                    id="edit-org-email"
                    type="email"
                    value={editContactEmail}
                    onChange={(e) => setEditContactEmail(e.target.value)}
                    placeholder="contact@example.com"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="edit-org-phone" className="block text-sm font-medium text-gray-700 mb-1">
                    聯絡電話
                  </label>
                  <input
                    id="edit-org-phone"
                    type="text"
                    value={editContactPhone}
                    onChange={(e) => setEditContactPhone(e.target.value)}
                    placeholder="例：02-1234-5678"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="edit-org-address" className="block text-sm font-medium text-gray-700 mb-1">
                    地址
                  </label>
                  <input
                    id="edit-org-address"
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    placeholder="例：台北市中正區重慶南路一段122號"
                    className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="edit-org-description" className="block text-sm font-medium text-gray-700 mb-1">
                    備註說明
                  </label>
                  <textarea
                    id="edit-org-description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={3}
                    placeholder="機構簡介或備註"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors resize-none"
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

        {/* Business info card */}
        {!isEditing && (org.description || org.tax_id || org.contact_email || org.contact_phone || org.address) && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="font-bold text-gray-900 mb-4">商業資訊</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {org.tax_id && (
                <>
                  <dt className="text-gray-500">統一編號</dt>
                  <dd className="text-gray-900 font-mono">{org.tax_id}</dd>
                </>
              )}
              {org.contact_email && (
                <>
                  <dt className="text-gray-500">聯絡信箱</dt>
                  <dd className="text-gray-900">{org.contact_email}</dd>
                </>
              )}
              {org.contact_phone && (
                <>
                  <dt className="text-gray-500">聯絡電話</dt>
                  <dd className="text-gray-900">{org.contact_phone}</dd>
                </>
              )}
              {org.address && (
                <>
                  <dt className="text-gray-500">地址</dt>
                  <dd className="text-gray-900 sm:col-span-1">{org.address}</dd>
                </>
              )}
              {org.description && (
                <>
                  <dt className="text-gray-500 sm:col-span-2 mt-1">備註說明</dt>
                  <dd className="text-gray-700 sm:col-span-2 whitespace-pre-wrap">{org.description}</dd>
                </>
              )}
            </dl>
          </div>
        )}


        {/* Points section — only show if total_points is set */}
        {org.total_points != null && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="font-bold text-gray-900 mb-4">點數使用狀況</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{org.total_points.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">總點數</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-amber-600">{org.used_points.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">已使用</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold ${(remainingPoints ?? 0) <= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {(remainingPoints ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-gray-500 mt-1">剩餘</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all ${usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1 text-right">{usagePercent}% 已使用</p>
            {/* Subscription period */}
            {(org.subscription_start_date || org.subscription_end_date) && (
              <div className="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-500">
                <span className="font-medium text-gray-700">授權期間：</span>
                {org.subscription_start_date ? formatDate(org.subscription_start_date) : '—'}
                {' ~ '}
                {org.subscription_end_date ? formatDate(org.subscription_end_date) : '—'}
              </div>
            )}
          </div>
        )}

        {/* Points log section */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-5 border-b border-gray-100">
            <h3 className="font-bold text-gray-900">點數使用紀錄</h3>
            <p className="text-xs text-gray-500 mt-0.5">共 {logsTotal} 筆</p>
          </div>
          {logs.length === 0 && !logsLoading ? (
            <div className="p-8 text-center text-sm text-gray-400">尚無使用紀錄</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">使用者</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-gray-500">點數</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">功能類型</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">說明</th>
                      <th className="text-left px-5 py-3 text-xs font-medium text-gray-500">時間</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50/50">
                        <td className="px-5 py-3 text-gray-700">
                          {log.user_name ?? <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right text-amber-700 font-medium">
                          -{log.points_used}
                        </td>
                        <td className="px-5 py-3">
                          <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">
                            {log.feature_type}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-500 max-w-xs truncate">
                          {log.description ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3 text-gray-400 whitespace-nowrap">
                          {formatDateTime(log.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Load more */}
              {logs.length < logsTotal && (
                <div className="p-4 text-center border-t border-gray-100">
                  <button
                    onClick={() => loadLogs(logsOffset + LOGS_PAGE_SIZE)}
                    disabled={logsLoading}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {logsLoading ? '載入中...' : '載入更多'}
                  </button>
                </div>
              )}
            </>
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
