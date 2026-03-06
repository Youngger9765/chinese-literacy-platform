import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listSchools,
  createSchool,
  SchoolResponse,
  SchoolApiError,
} from '../../services/schoolApi';
import {
  listOrganizations,
  createOrganization,
  OrganizationResponse,
  OrganizationApiError,
} from '../../services/organizationApi';
import {
  listRoles,
  RoleResponse,
  RoleApiError,
} from '../../services/roleApi';

type AdminTab = 'schools' | 'organizations' | 'roles';

interface AdminDashboardProps {
  onSelectSchool: (schoolId: number) => void;
  onSelectOrganization: (organizationId: string) => void;
}

const SCOPE_LEVEL_LABELS: Record<string, string> = {
  global: '全域',
  organization: '機構',
  school: '學校',
  classroom: '班級',
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onSelectSchool, onSelectOrganization }) => {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('organizations');

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">系統管理</h1>
          <p className="text-sm text-gray-500 mt-1">管理機構、學校與角色設定</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {([
            { key: 'organizations' as AdminTab, label: '機構管理' },
            { key: 'schools' as AdminTab, label: '學校管理' },
            { key: 'roles' as AdminTab, label: '角色管理' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                activeTab === key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'schools' && (
          <SchoolsTab token={token} onSelectSchool={onSelectSchool} />
        )}
        {activeTab === 'organizations' && (
          <OrganizationsTab token={token} onSelectOrganization={onSelectOrganization} />
        )}
        {activeTab === 'roles' && (
          <RolesTab token={token} />
        )}
      </div>
    </div>
  );
};

// ─── Schools Tab ────────────────────────────────────────────────

interface SchoolsTabProps {
  token: string | null;
  onSelectSchool: (schoolId: number) => void;
}

const SchoolsTab: React.FC<SchoolsTabProps> = ({ token, onSelectSchool }) => {
  const [schools, setSchools] = useState<SchoolResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadSchools = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listSchools(token);
      setSchools(data.items);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof SchoolApiError) {
        setError(err.message);
      } else {
        setError('無法載入學校列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSchools();
  }, [loadSchools]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newName.trim()) return;

    setIsCreating(true);
    setCreateError('');
    try {
      await createSchool(token, {
        name: newName.trim(),
        address: newAddress.trim() || undefined,
        phone: newPhone.trim() || undefined,
      });
      setNewName('');
      setNewAddress('');
      setNewPhone('');
      setShowCreateForm(false);
      await loadSchools();
    } catch (err) {
      if (err instanceof SchoolApiError) {
        setCreateError(err.message);
      } else {
        setCreateError('建立學校失敗');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {isLoading ? '載入中...' : `共 ${total} 所學校`}
        </p>
        <button
          onClick={() => setShowCreateForm(true)}
          className="bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors cursor-pointer"
        >
          新增學校
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">新增學校</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {createError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="school-name" className="block text-sm font-medium text-gray-700 mb-1">
                  學校名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  id="school-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例：台北市大安國小"
                  required
                  autoFocus
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label htmlFor="school-phone" className="block text-sm font-medium text-gray-700 mb-1">
                  電話
                </label>
                <input
                  id="school-phone"
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="例：02-2345-6789"
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
              </div>
            </div>
            <div>
              <label htmlFor="school-address" className="block text-sm font-medium text-gray-700 mb-1">
                地址
              </label>
              <input
                id="school-address"
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="例：台北市大安區信義路四段1號"
                className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateError('');
                  setNewName('');
                  setNewAddress('');
                  setNewPhone('');
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isCreating || !newName.trim()}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                {isCreating ? '建立中...' : '建立'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="text-center py-6 bg-red-50 rounded-xl border border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={loadSchools}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
          >
            重試
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="h-5 bg-gray-200 animate-pulse rounded w-2/3 mb-3" />
              <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* School cards */}
      {!isLoading && !error && schools.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {schools.map((school) => (
            <button
              key={school.id}
              onClick={() => onSelectSchool(school.id)}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 text-left hover:border-accent hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-bold text-gray-900 group-hover:text-accent transition-colors">
                  {school.display_name || school.name}
                </h3>
                {!school.is_active && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    已停用
                  </span>
                )}
              </div>
              <div className="space-y-1.5 text-sm text-gray-500">
                {school.address && (
                  <p className="truncate">{school.address}</p>
                )}
                {school.phone && (
                  <p>{school.phone}</p>
                )}
                <p className="text-xs">{formatDate(school.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && schools.length === 0 && (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-bg rounded-2xl mb-4">
            <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">尚未建立學校</h3>
          <p className="text-sm text-gray-500 mb-4">建立第一所學校，開始管理教學環境</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors cursor-pointer"
          >
            新增學校
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Organizations Tab ──────────────────────────────────────────

interface OrganizationsTabProps {
  token: string | null;
  onSelectOrganization: (organizationId: string) => void;
}

const OrganizationsTab: React.FC<OrganizationsTabProps> = ({ token, onSelectOrganization }) => {
  const [organizations, setOrganizations] = useState<OrganizationResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadOrganizations = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listOrganizations(token);
      setOrganizations(data.items);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setError(err.message);
      } else {
        setError('無法載入機構列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadOrganizations();
  }, [loadOrganizations]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newName.trim()) return;

    setIsCreating(true);
    setCreateError('');
    try {
      await createOrganization(token, {
        name: newName.trim(),
        display_name: newDisplayName.trim() || undefined,
      });
      setNewName('');
      setNewDisplayName('');
      setShowCreateForm(false);
      await loadOrganizations();
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setCreateError(err.message);
      } else {
        setCreateError('建立機構失敗');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {isLoading ? '載入中...' : `共 ${total} 個機構`}
        </p>
        <button
          onClick={() => setShowCreateForm(true)}
          className="bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors cursor-pointer"
        >
          新增機構
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">新增機構</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {createError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="org-name" className="block text-sm font-medium text-gray-700 mb-1">
                  機構代碼 <span className="text-red-500">*</span>
                </label>
                <input
                  id="org-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例：junyi-academy"
                  required
                  autoFocus
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label htmlFor="org-display-name" className="block text-sm font-medium text-gray-700 mb-1">
                  顯示名稱
                </label>
                <input
                  id="org-display-name"
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="例：均一教育平台"
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateError('');
                  setNewName('');
                  setNewDisplayName('');
                }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isCreating || !newName.trim()}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                {isCreating ? '建立中...' : '建立'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="text-center py-6 bg-red-50 rounded-xl border border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={loadOrganizations}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
          >
            重試
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="h-5 bg-gray-200 animate-pulse rounded w-2/3 mb-3" />
              <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* Organization cards */}
      {!isLoading && !error && organizations.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {organizations.map((org) => (
            <button
              key={org.id}
              onClick={() => onSelectOrganization(org.id)}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 text-left hover:border-accent hover:shadow-md transition-all group cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-bold text-gray-900 group-hover:text-accent transition-colors">
                  {org.display_name || org.name}
                </h3>
                {!org.is_active && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    已停用
                  </span>
                )}
              </div>
              <div className="space-y-1.5 text-sm text-gray-500">
                {org.display_name && (
                  <p className="text-xs text-gray-400 font-mono">{org.name}</p>
                )}
                <p>{org.school_count} 所學校</p>
                <p className="text-xs">{formatDate(org.created_at)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && organizations.length === 0 && (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-bg rounded-2xl mb-4">
            <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">尚未建立機構</h3>
          <p className="text-sm text-gray-500 mb-4">建立第一個機構，統一管理旗下學校</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors cursor-pointer"
          >
            新增機構
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Roles Tab ──────────────────────────────────────────────────

interface RolesTabProps {
  token: string | null;
}

const RolesTab: React.FC<RolesTabProps> = ({ token }) => {
  const [roles, setRoles] = useState<RoleResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRoles = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listRoles(token);
      setRoles(data);
    } catch (err) {
      if (err instanceof RoleApiError) {
        setError(err.message);
      } else {
        setError('無法載入角色列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {isLoading ? '載入中...' : `共 ${roles.length} 個角色`}
        </p>
      </div>

      {/* Error state */}
      {error && (
        <div className="text-center py-6 bg-red-50 rounded-xl border border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={loadRoles}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
          >
            重試
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="h-5 bg-gray-200 animate-pulse rounded w-2/3 mb-3" />
              <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Role cards */}
      {!isLoading && !error && roles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((role) => (
            <div
              key={role.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-5"
            >
              <h3 className="font-bold text-gray-900 mb-2">{role.display_name}</h3>
              <div className="space-y-1.5 text-sm text-gray-500">
                <p className="font-mono text-xs text-gray-400">{role.name}</p>
                <p>
                  <span className="inline-flex items-center bg-accent-bg text-accent text-xs font-medium px-2.5 py-0.5 rounded">
                    {SCOPE_LEVEL_LABELS[role.scope_level] || role.scope_level}
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && roles.length === 0 && (
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-bg rounded-2xl mb-4">
            <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">尚無角色定義</h3>
          <p className="text-sm text-gray-500">系統角色尚未建立</p>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
