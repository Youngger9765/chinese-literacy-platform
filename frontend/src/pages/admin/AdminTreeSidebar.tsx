import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listOrganizations,
  getOrganization,
  OrganizationResponse,
  OrganizationApiError,
} from '../../services/organizationApi';
import type { SchoolInOrgResponse } from '../../services/organizationApi';

// ── Types ───────────────────────────────────────────────────────────────────

export type TreeNodeSelection =
  | { type: 'org'; id: string }
  | { type: 'school'; id: number }
  | { type: 'classroom'; id: number }
  | { type: 'roles'; id: 'roles' }
  | { type: 'users'; id: 'users' }
  | { type: 'create_org'; id: 'create_org' };

type TreeNodeType = TreeNodeSelection['type'];

interface AdminTreeSidebarProps {
  selectedNode: TreeNodeSelection | null;
  onSelectNode: (node: TreeNodeSelection | null) => void;
  refreshTrigger?: number;
}

interface OrgTreeData {
  schools: SchoolInOrgResponse[];
  isLoading: boolean;
  error: string;
}

// ── Icons (inline SVGs) ─────────────────────────────────────────────────────

const ChevronIcon: React.FC<{ expanded: boolean; className?: string }> = ({ expanded, className = '' }) => (
  <svg
    className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''} ${className}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const BuildingIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
  </svg>
);

const SchoolIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);

const ShieldIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

const UsersIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
  </svg>
);

const CollapseIcon: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    {collapsed ? (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
    ) : (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
    )}
  </svg>
);

// ── Sidebar Component ───────────────────────────────────────────────────────

const PlusIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const AdminTreeSidebar: React.FC<AdminTreeSidebarProps> = ({ selectedNode, onSelectNode, refreshTrigger }) => {
  const { token } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Top-level orgs
  const [orgs, setOrgs] = useState<OrganizationResponse[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  const [orgsError, setOrgsError] = useState('');

  // Expanded state per org (keyed by org id)
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  // Org children data (schools loaded on expand)
  const [orgData, setOrgData] = useState<Record<string, OrgTreeData>>({});

  // ── Load organizations ──────────────────────────────────────────────────

  const loadOrgs = useCallback(async () => {
    if (!token) return;
    setIsLoadingOrgs(true);
    setOrgsError('');
    try {
      const data = await listOrganizations(token);
      setOrgs(data.items);
    } catch (err) {
      if (err instanceof OrganizationApiError) {
        setOrgsError(err.message);
      } else {
        setOrgsError('載入失敗');
      }
    } finally {
      setIsLoadingOrgs(false);
    }
  }, [token]);

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  // Reload orgs and clear cached school data when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger != null && refreshTrigger > 0) {
      setOrgData({});
      loadOrgs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  // ── Expand / collapse org ───────────────────────────────────────────────

  const toggleOrg = useCallback(async (orgId: string) => {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });

    // Fetch schools if not already loaded
    if (!orgData[orgId] && token) {
      setOrgData(prev => ({
        ...prev,
        [orgId]: { schools: [], isLoading: true, error: '' },
      }));
      try {
        const detail = await getOrganization(token, orgId);
        setOrgData(prev => ({
          ...prev,
          [orgId]: { schools: detail.schools, isLoading: false, error: '' },
        }));
      } catch (err) {
        const message = err instanceof OrganizationApiError ? err.message : '載入學校失敗';
        setOrgData(prev => ({
          ...prev,
          [orgId]: { schools: [], isLoading: false, error: message },
        }));
      }
    }
  }, [orgData, token]);

  // ── Selection helpers ───────────────────────────────────────────────────

  const isSelected = (type: TreeNodeType, id: string | number): boolean =>
    selectedNode?.type === type && selectedNode?.id === id;

  // ── Collapsed state (icon-only sidebar) ─────────────────────────────────

  if (isCollapsed) {
    return (
      <div className="w-12 bg-white border-r border-gray-200 flex flex-col items-center py-3 shrink-0">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-1.5 rounded-md hover:bg-gray-100 transition-colors cursor-pointer mb-2"
          title="展開側邊欄"
        >
          <CollapseIcon collapsed={true} />
        </button>

        <button
          onClick={() => onSelectNode({ type: 'create_org', id: 'create_org' })}
          className="p-1.5 rounded-md hover:bg-accent-bg text-gray-400 hover:text-accent transition-colors cursor-pointer mb-3"
          title="新增機構"
        >
          <PlusIcon />
        </button>

        {/* Org icons */}
        {orgs.map((org) => (
          <button
            key={org.id}
            onClick={() => onSelectNode({ type: 'org', id: org.id })}
            className={`p-1.5 rounded-md transition-colors cursor-pointer mb-1 ${
              isSelected('org', org.id)
                ? 'bg-blue-50 text-blue-600'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
            title={org.display_name || org.name}
          >
            <BuildingIcon />
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Roles icon */}
        <button
          onClick={() => onSelectNode({ type: 'roles', id: 'roles' })}
          className={`p-1.5 rounded-md transition-colors cursor-pointer mb-1 ${
            isSelected('roles', 'roles')
              ? 'bg-amber-50 text-amber-600'
              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
          title="角色管理"
        >
          <ShieldIcon />
        </button>

        {/* Users icon */}
        <button
          onClick={() => onSelectNode({ type: 'users', id: 'users' })}
          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
            isSelected('users', 'users')
              ? 'bg-indigo-50 text-indigo-600'
              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
          title="使用者管理"
        >
          <UsersIcon />
        </button>
      </div>
    );
  }

  // ── Full sidebar ────────────────────────────────────────────────────────

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-hidden">
      {/* Sidebar header */}
      <div className="h-11 px-3 flex items-center justify-between border-b border-gray-100 shrink-0">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
          管理架構
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSelectNode({ type: 'create_org', id: 'create_org' })}
            className="p-1 rounded-md hover:bg-accent-bg text-gray-400 hover:text-accent transition-colors cursor-pointer"
            title="新增機構"
          >
            <PlusIcon />
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded-md hover:bg-gray-100 transition-colors cursor-pointer"
            title="收合側邊欄"
          >
            <CollapseIcon collapsed={false} />
          </button>
        </div>
      </div>

      {/* Tree content (scrollable) */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* Loading state */}
        {isLoadingOrgs && (
          <div className="px-3 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5">
                <div className="w-3.5 h-3.5 bg-gray-200 animate-pulse rounded" />
                <div className="h-4 bg-gray-200 animate-pulse rounded flex-1" />
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {orgsError && (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-red-600 mb-1">{orgsError}</p>
            <button
              onClick={loadOrgs}
              className="text-xs text-red-500 underline hover:text-red-700 cursor-pointer"
            >
              重試
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoadingOrgs && !orgsError && orgs.length === 0 && (
          <div className="px-3 py-6 text-center">
            <BuildingIcon className="mx-auto text-gray-300 w-6 h-6 mb-2" />
            <p className="text-xs text-gray-400">尚無機構</p>
          </div>
        )}

        {/* Organization tree nodes */}
        {!isLoadingOrgs && !orgsError && orgs.map((org) => {
          const isExpanded = expandedOrgs.has(org.id);
          const data = orgData[org.id];
          const orgSelected = isSelected('org', org.id);

          return (
            <div key={org.id}>
              {/* Org row */}
              <div
                className={`flex items-center gap-1 px-2 py-1 mx-1 rounded-md group transition-colors ${
                  orgSelected
                    ? 'bg-blue-50 text-blue-700'
                    : 'hover:bg-gray-50'
                }`}
              >
                {/* Chevron toggle */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleOrg(org.id); }}
                  className="p-0.5 rounded hover:bg-gray-200/50 cursor-pointer shrink-0"
                  aria-label={isExpanded ? '收合' : '展開'}
                >
                  <ChevronIcon expanded={isExpanded} />
                </button>

                {/* Org button */}
                <button
                  onClick={() => onSelectNode({ type: 'org', id: org.id })}
                  className="flex items-center gap-1.5 flex-1 min-w-0 py-0.5 cursor-pointer text-left"
                >
                  <BuildingIcon className={orgSelected ? 'text-blue-500' : 'text-gray-400 group-hover:text-gray-500'} />
                  <span className={`text-sm truncate ${
                    orgSelected ? 'font-semibold text-blue-700' : 'text-gray-700'
                  }`}>
                    {org.display_name || org.name}
                  </span>
                  {org.school_count > 0 && (
                    <span className={`text-[10px] ml-auto shrink-0 ${
                      orgSelected ? 'text-blue-400' : 'text-gray-400'
                    }`}>
                      {org.school_count}
                    </span>
                  )}
                </button>
              </div>

              {/* Expanded children: schools */}
              {isExpanded && (
                <div className="ml-4">
                  {/* Loading schools */}
                  {data?.isLoading && (
                    <div className="pl-4 py-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-gray-400">載入中...</span>
                      </div>
                    </div>
                  )}

                  {/* Error loading schools */}
                  {data?.error && (
                    <div className="pl-4 py-1">
                      <span className="text-xs text-red-500">{data.error}</span>
                    </div>
                  )}

                  {/* School nodes */}
                  {data && !data.isLoading && !data.error && data.schools.map((school) => {
                    const schoolSelected = isSelected('school', school.id);

                    return (
                      <button
                        key={school.id}
                        onClick={() => onSelectNode({ type: 'school', id: school.id })}
                        className={`flex items-center gap-1.5 w-full px-2 py-1 mx-1 rounded-md text-left transition-colors cursor-pointer group ${
                          schoolSelected
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <SchoolIcon className={schoolSelected ? 'text-emerald-500' : 'text-gray-400 group-hover:text-gray-500'} />
                        <span className={`text-sm truncate ${
                          schoolSelected ? 'font-semibold text-emerald-700' : 'text-gray-600'
                        }`}>
                          {school.display_name || school.name}
                        </span>
                        {!school.is_active && (
                          <span className="text-[10px] text-gray-400 ml-auto shrink-0">停用</span>
                        )}
                      </button>
                    );
                  })}

                  {/* No schools */}
                  {data && !data.isLoading && !data.error && data.schools.length === 0 && (
                    <div className="pl-4 py-1">
                      <span className="text-xs text-gray-400">無所屬學校</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom fixed: management links */}
      <div className="border-t border-gray-100 shrink-0">
        <button
          onClick={() => onSelectNode({ type: 'roles', id: 'roles' })}
          className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
            isSelected('roles', 'roles')
              ? 'bg-amber-50 text-amber-700'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          <ShieldIcon className={isSelected('roles', 'roles') ? 'text-amber-500' : ''} />
          <span className={`text-sm ${isSelected('roles', 'roles') ? 'font-semibold' : ''}`}>
            角色管理
          </span>
        </button>
        <button
          onClick={() => onSelectNode({ type: 'users', id: 'users' })}
          className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
            isSelected('users', 'users')
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          <UsersIcon className={isSelected('users', 'users') ? 'text-indigo-500' : ''} />
          <span className={`text-sm ${isSelected('users', 'users') ? 'font-semibold' : ''}`}>
            使用者管理
          </span>
        </button>
      </div>
    </div>
  );
};

export default AdminTreeSidebar;
