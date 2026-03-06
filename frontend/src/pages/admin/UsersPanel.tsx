import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { listUsers, UserListItem, UserApiError } from '../../services/userApi';
import {
  listRoles,
  assignRole,
  revokeRole,
  getUserRoles,
  RoleResponse,
  UserRoleDetailResponse,
  RoleApiError,
} from '../../services/roleApi';
import {
  listOrganizations,
  OrganizationResponse,
} from '../../services/organizationApi';
import { listSchools, SchoolResponse } from '../../services/schoolApi';

// ── Role badge color mapping ────────────────────────────────────────────────

const ROLE_BADGE_STYLES: Record<string, string> = {
  system_admin: 'bg-red-100 text-red-700',
  org_admin: 'bg-blue-100 text-blue-700',
  org_owner: 'bg-blue-100 text-blue-700',
  teacher: 'bg-green-100 text-green-700',
  principal: 'bg-green-100 text-green-700',
  director: 'bg-green-100 text-green-700',
  student: 'bg-yellow-100 text-yellow-700',
  parent: 'bg-purple-100 text-purple-700',
};

function getRoleBadgeStyle(roleName: string): string {
  return ROLE_BADGE_STYLES[roleName] ?? 'bg-gray-100 text-gray-700';
}

// ── Role display name mapping ───────────────────────────────────────────────

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  system_admin: '系統管理員',
  org_admin: '機構管理員',
  org_owner: '機構擁有者',
  teacher: '教師',
  principal: '校長',
  director: '主任',
  student: '學生',
  parent: '家長',
};

function getRoleDisplayName(roleName: string): string {
  return ROLE_DISPLAY_NAMES[roleName] ?? roleName;
}

// ── Scope type labels ───────────────────────────────────────────────────────

const SCOPE_LEVEL_FOR_ASSIGN: Record<string, string> = {
  global: 'platform',
  organization: 'organization',
  school: 'school',
  classroom: 'classroom',
};

// ── Main UsersPanel ─────────────────────────────────────────────────────────

const UsersPanel: React.FC = () => {
  const { token } = useAuth();

  // User list state
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;

  // Expanded user (show role details + assignment form)
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load users ──────────────────────────────────────────────────────────

  const loadUsers = useCallback(async (search: string, offset: number) => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listUsers(token, {
        limit: pageSize,
        offset,
        search: search || undefined,
      });
      setUsers(data.items);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof UserApiError) {
        setError(err.message);
      } else {
        setError('無法載入使用者列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Initial load and when page changes
  useEffect(() => {
    loadUsers(searchQuery, page * pageSize);
  }, [loadUsers, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      loadUsers(value, 0);
    }, 300);
  };

  // Toggle expanded user
  const toggleExpand = (userId: number) => {
    setExpandedUserId((prev) => (prev === userId ? null : userId));
  };

  // Refresh a single user's roles after assign/revoke
  const refreshUserInList = useCallback(async () => {
    // Reload the whole list (simpler than patching a single item)
    await loadUsers(searchQuery, page * pageSize);
  }, [loadUsers, searchQuery, page]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-gray-900">使用者管理</h2>
          <p className="text-sm text-gray-500 mt-1">
            {isLoading ? '載入中...' : `共 ${total} 位使用者`}
          </p>
        </div>

        {/* Search bar */}
        <div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="搜尋使用者姓名或 Email..."
            className="w-full h-11 px-4 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-sm"
          />
        </div>

        {/* Error state */}
        {error && (
          <div className="text-center py-6 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button
              onClick={() => loadUsers(searchQuery, page * pageSize)}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
            >
              重試
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 last:border-b-0">
                <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
                <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3" />
                <div className="h-4 bg-gray-200 animate-pulse rounded w-16" />
                <div className="h-4 bg-gray-200 animate-pulse rounded w-12 ml-auto" />
              </div>
            ))}
          </div>
        )}

        {/* User table */}
        {!isLoading && !error && users.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_1.5fr_1fr_80px_100px] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
              <span>姓名</span>
              <span>Email</span>
              <span>角色</span>
              <span>狀態</span>
              <span className="text-right">操作</span>
            </div>

            {/* Table rows */}
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isExpanded={expandedUserId === user.id}
                onToggleExpand={() => toggleExpand(user.id)}
                onRolesChanged={refreshUserInList}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && users.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-bg rounded-2xl mb-4">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">
              {searchQuery ? '找不到符合的使用者' : '尚無使用者'}
            </h3>
            <p className="text-sm text-gray-500">
              {searchQuery ? '請嘗試不同的搜尋條件' : '系統中尚無使用者資料'}
            </p>
          </div>
        )}

        {/* Pagination */}
        {!isLoading && !error && totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              顯示 {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} / {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                上一頁
              </button>
              <span className="text-sm text-gray-500">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                下一頁
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── User Row ────────────────────────────────────────────────────────────────

interface UserRowProps {
  user: UserListItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRolesChanged: () => void;
}

const UserRow: React.FC<UserRowProps> = ({ user, isExpanded, onToggleExpand, onRolesChanged }) => {
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* Main row */}
      <div
        onClick={onToggleExpand}
        className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr_1fr_80px_100px] gap-2 sm:gap-4 px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors items-center"
      >
        {/* Name */}
        <div className="font-medium text-gray-900 text-sm truncate">
          {user.name}
        </div>

        {/* Email */}
        <div className="text-sm text-gray-500 truncate">
          {user.email}
        </div>

        {/* Roles */}
        <div className="flex flex-wrap gap-1">
          {user.roles.length === 0 && (
            <span className="text-xs text-gray-400">無角色</span>
          )}
          {user.roles.map((role, i) => (
            <span
              key={`${role.role_name}-${role.scope_type}-${role.scope_id ?? 'null'}-${i}`}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeStyle(role.role_name)}`}
            >
              {getRoleDisplayName(role.role_name)}
            </span>
          ))}
        </div>

        {/* Status */}
        <div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              user.is_active
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {user.is_active ? '啟用' : '停用'}
          </span>
        </div>

        {/* Actions */}
        <div className="text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="text-xs text-accent hover:text-accent-hover font-medium cursor-pointer"
          >
            {isExpanded ? '收合' : '管理角色'}
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && (
        <UserExpandedPanel user={user} onRolesChanged={onRolesChanged} />
      )}
    </div>
  );
};

// ── Expanded Panel (role details + assignment form) ─────────────────────────

interface UserExpandedPanelProps {
  user: UserListItem;
  onRolesChanged: () => void;
}

const UserExpandedPanel: React.FC<UserExpandedPanelProps> = ({ user, onRolesChanged }) => {
  const { token } = useAuth();

  // User role details (full detail from getUserRoles)
  const [roleDetails, setRoleDetails] = useState<UserRoleDetailResponse[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);
  const [rolesError, setRolesError] = useState('');

  // Assignment form state
  const [showAssignForm, setShowAssignForm] = useState(false);

  // Revoke confirm
  const [revokeConfirmId, setRevokeConfirmId] = useState<number | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  // Load user roles
  const loadRoleDetails = useCallback(async () => {
    if (!token) return;
    setIsLoadingRoles(true);
    setRolesError('');
    try {
      const data = await getUserRoles(token, user.id);
      setRoleDetails(data);
    } catch (err) {
      if (err instanceof RoleApiError) {
        setRolesError(err.message);
      } else {
        setRolesError('無法載入角色資訊');
      }
    } finally {
      setIsLoadingRoles(false);
    }
  }, [token, user.id]);

  useEffect(() => {
    loadRoleDetails();
  }, [loadRoleDetails]);

  // Revoke a role
  const handleRevoke = async (assignmentId: number) => {
    if (!token) return;
    setIsRevoking(true);
    try {
      await revokeRole(token, assignmentId);
      setRevokeConfirmId(null);
      await loadRoleDetails();
      onRolesChanged();
    } catch (err) {
      const msg = err instanceof RoleApiError ? err.message : '撤銷角色失敗';
      setRolesError(msg);
    } finally {
      setIsRevoking(false);
    }
  };

  // After successful assignment
  const handleAssignSuccess = async () => {
    setShowAssignForm(false);
    await loadRoleDetails();
    onRolesChanged();
  };

  return (
    <div className="px-6 pb-5 bg-gray-50 border-t border-gray-100">
      <div className="max-w-2xl space-y-4 pt-4">
        {/* Current roles section */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">目前角色</h4>

          {isLoadingRoles && (
            <div className="flex items-center gap-2 py-2">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-gray-400">載入中...</span>
            </div>
          )}

          {rolesError && (
            <p className="text-xs text-red-600 py-1">{rolesError}</p>
          )}

          {!isLoadingRoles && !rolesError && roleDetails.length === 0 && (
            <p className="text-xs text-gray-400 py-1">此使用者尚無任何角色</p>
          )}

          {!isLoadingRoles && !rolesError && roleDetails.length > 0 && (
            <div className="space-y-2">
              {roleDetails.map((rd) => (
                <div
                  key={rd.id}
                  className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${getRoleBadgeStyle(rd.role_name)}`}
                    >
                      {rd.role_display_name}
                    </span>
                    <span className="text-xs text-gray-400 truncate">
                      {rd.scope_type}
                      {rd.scope_id ? ` / ${rd.scope_id}` : ''}
                    </span>
                    {!rd.is_active && (
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-500">
                        停用
                      </span>
                    )}
                  </div>

                  {/* Revoke button / confirm */}
                  <div className="shrink-0 ml-2">
                    {revokeConfirmId === rd.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRevoke(rd.id)}
                          disabled={isRevoking}
                          className="text-xs text-red-600 hover:text-red-800 font-medium cursor-pointer disabled:opacity-50"
                        >
                          {isRevoking ? '處理中...' : '確認撤銷'}
                        </button>
                        <button
                          onClick={() => setRevokeConfirmId(null)}
                          disabled={isRevoking}
                          className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer disabled:opacity-50"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRevokeConfirmId(rd.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors cursor-pointer"
                        title="撤銷此角色"
                        aria-label={`撤銷 ${rd.role_display_name}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assign role section */}
        {!showAssignForm ? (
          <button
            onClick={() => setShowAssignForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            指派角色
          </button>
        ) : (
          <AssignRoleForm
            userId={user.id}
            onSuccess={handleAssignSuccess}
            onCancel={() => setShowAssignForm(false)}
          />
        )}
      </div>
    </div>
  );
};

// ── Assign Role Form ────────────────────────────────────────────────────────

interface AssignRoleFormProps {
  userId: number;
  onSuccess: () => void;
  onCancel: () => void;
}

const AssignRoleForm: React.FC<AssignRoleFormProps> = ({ userId, onSuccess, onCancel }) => {
  const { token } = useAuth();

  // Available roles
  const [availableRoles, setAvailableRoles] = useState<RoleResponse[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);

  // Scope options
  const [organizations, setOrganizations] = useState<OrganizationResponse[]>([]);
  const [schools, setSchools] = useState<SchoolResponse[]>([]);

  // Form values
  const [selectedRoleName, setSelectedRoleName] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Selected role object
  const selectedRole = availableRoles.find((r) => r.name === selectedRoleName);
  const scopeLevel = selectedRole?.scope_level ?? '';
  const scopeType = SCOPE_LEVEL_FOR_ASSIGN[scopeLevel] ?? 'platform';
  const needsScope = scopeLevel === 'organization' || scopeLevel === 'school';

  // Load available roles on mount
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function load() {
      setIsLoadingRoles(true);
      try {
        const [rolesData, orgsData, schoolsData] = await Promise.all([
          listRoles(token!),
          listOrganizations(token!).then((r) => r.items),
          listSchools(token!).then((r) => r.items),
        ]);
        if (!cancelled) {
          setAvailableRoles(rolesData);
          setOrganizations(orgsData);
          setSchools(schoolsData);
        }
      } catch {
        // Roles are critical, others optional
        if (!cancelled) setFormError('無法載入角色列表');
      } finally {
        if (!cancelled) setIsLoadingRoles(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  // Reset scope when role changes
  useEffect(() => {
    setScopeId('');
  }, [selectedRoleName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedRoleName) return;

    // Validate scope
    if (needsScope && !scopeId) {
      setFormError('請選擇範圍');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      await assignRole(token, {
        user_id: userId,
        role_name: selectedRoleName,
        scope_type: scopeType,
        scope_id: needsScope ? scopeId : undefined,
      });
      onSuccess();
    } catch (err) {
      const msg = err instanceof RoleApiError ? err.message : '指派角色失敗';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoadingRoles) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-gray-400">載入角色選項...</span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h5 className="text-sm font-semibold text-gray-700">指派新角色</h5>

      {formError && (
        <p className="text-xs text-red-600">{formError}</p>
      )}

      {/* Role selector */}
      <div>
        <label htmlFor="assign-role-select" className="block text-xs text-gray-500 mb-1">
          角色
        </label>
        <select
          id="assign-role-select"
          value={selectedRoleName}
          onChange={(e) => setSelectedRoleName(e.target.value)}
          className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
        >
          <option value="">請選擇角色</option>
          {availableRoles.map((role) => (
            <option key={role.id} value={role.name}>
              {role.display_name}
            </option>
          ))}
        </select>
      </div>

      {/* Scope selector (conditional) */}
      {selectedRole && scopeLevel === 'organization' && (
        <div>
          <label htmlFor="assign-scope-org" className="block text-xs text-gray-500 mb-1">
            機構
          </label>
          <select
            id="assign-scope-org"
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          >
            <option value="">請選擇機構</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.display_name || org.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedRole && scopeLevel === 'school' && (
        <div>
          <label htmlFor="assign-scope-school" className="block text-xs text-gray-500 mb-1">
            學校
          </label>
          <select
            id="assign-scope-school"
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          >
            <option value="">請選擇學校</option>
            {schools.map((school) => (
              <option key={school.id} value={String(school.id)}>
                {school.display_name || school.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedRole && scopeLevel === 'global' && (
        <p className="text-xs text-gray-400">此角色為全域角色，不需要選擇範圍</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!selectedRoleName || isSubmitting}
          className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? '指派中...' : '指派'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 cursor-pointer disabled:opacity-50"
        >
          取消
        </button>
      </div>
    </form>
  );
};

export default UsersPanel;
