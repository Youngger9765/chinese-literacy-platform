import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { PlusIcon, BuildingIcon, SchoolIcon, ShieldIcon, UsersIcon } from '../../components/icons';
import {
  listOrganizations,
  getOrganization,
  OrganizationResponse,
  OrganizationApiError,
} from '../../services/organizationApi';
import type { SchoolInOrgResponse } from '../../services/organizationApi';
import {
  listSchoolClassrooms,
  SchoolClassroomResponse,
} from '../../services/schoolApi';

// ── Types ───────────────────────────────────────────────────────────────────

export type TreeNodeSelection =
  | { type: 'org'; id: string }
  | { type: 'school'; id: number }
  | { type: 'classroom'; id: number }
  | { type: 'roles'; id: 'roles' }
  | { type: 'users'; id: 'users' }
  | { type: 'stories'; id: 'stories' }
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

interface SchoolTreeData {
  classrooms: SchoolClassroomResponse[];
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

  // Expanded state per school (keyed by school id)
  const [expandedSchools, setExpandedSchools] = useState<Set<number>>(new Set());

  // School children data (classrooms loaded on expand)
  const [schoolData, setSchoolData] = useState<Record<number, SchoolTreeData>>({});

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
      setSchoolData({});
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

  // ── Expand / collapse school ─────────────────────────────────────────────

  const toggleSchool = useCallback(async (schoolId: number) => {
    setExpandedSchools(prev => {
      const next = new Set(prev);
      if (next.has(schoolId)) {
        next.delete(schoolId);
      } else {
        next.add(schoolId);
      }
      return next;
    });

    // Fetch classrooms if not already loaded
    if (!schoolData[schoolId] && token) {
      setSchoolData(prev => ({
        ...prev,
        [schoolId]: { classrooms: [], isLoading: true, error: '' },
      }));
      try {
        const classrooms = await listSchoolClassrooms(token, schoolId);
        setSchoolData(prev => ({
          ...prev,
          [schoolId]: { classrooms, isLoading: false, error: '' },
        }));
      } catch {
        setSchoolData(prev => ({
          ...prev,
          [schoolId]: { classrooms: [], isLoading: false, error: '載入班級失敗' },
        }));
      }
    }
  }, [schoolData, token]);

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

        {/* Stories icon */}
        <button
          onClick={() => onSelectNode({ type: 'stories', id: 'stories' })}
          className={`p-1.5 rounded-md transition-colors cursor-pointer mb-1 ${
            isSelected('stories', 'stories')
              ? 'bg-emerald-50 text-emerald-600'
              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
          title="課文管理"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </button>

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

                  {/* School nodes (expandable with classrooms) */}
                  {data && !data.isLoading && !data.error && data.schools.map((school) => {
                    const schoolSelected = isSelected('school', school.id);
                    const isSchoolExpanded = expandedSchools.has(school.id);
                    const sData = schoolData[school.id];

                    return (
                      <div key={school.id}>
                        <div
                          className={`flex items-center gap-1 px-2 py-1 mx-1 rounded-md group transition-colors ${
                            schoolSelected
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          {/* Chevron toggle for school */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSchool(school.id); }}
                            className="p-0.5 rounded hover:bg-gray-200/50 cursor-pointer shrink-0"
                            aria-label={isSchoolExpanded ? '收合' : '展開'}
                          >
                            <ChevronIcon expanded={isSchoolExpanded} />
                          </button>

                          {/* School button */}
                          <button
                            onClick={() => onSelectNode({ type: 'school', id: school.id })}
                            className="flex items-center gap-1.5 flex-1 min-w-0 py-0.5 cursor-pointer text-left"
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
                        </div>

                        {/* Expanded children: classrooms */}
                        {isSchoolExpanded && (
                          <div className="ml-4">
                            {/* Loading classrooms */}
                            {sData?.isLoading && (
                              <div className="pl-4 py-1">
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                                  <span className="text-xs text-gray-400">載入中...</span>
                                </div>
                              </div>
                            )}

                            {/* Error loading classrooms */}
                            {sData?.error && (
                              <div className="pl-4 py-1">
                                <span className="text-xs text-red-500">{sData.error}</span>
                              </div>
                            )}

                            {/* Classroom nodes */}
                            {sData && !sData.isLoading && !sData.error && sData.classrooms.map((cls) => {
                              const clsSelected = isSelected('classroom', cls.id);

                              return (
                                <button
                                  key={cls.id}
                                  onClick={() => onSelectNode({ type: 'classroom', id: cls.id })}
                                  className={`flex items-center gap-1.5 w-full pl-6 pr-2 py-0.5 mx-1 rounded-md text-left transition-colors cursor-pointer group ${
                                    clsSelected
                                      ? 'bg-sky-50 text-sky-700'
                                      : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <span className={`text-xs truncate ${
                                    clsSelected ? 'font-semibold text-sky-700' : 'text-gray-500'
                                  }`}>
                                    {cls.name}
                                  </span>
                                  {!cls.is_active && (
                                    <span className="text-[10px] text-gray-400 ml-auto shrink-0">停用</span>
                                  )}
                                </button>
                              );
                            })}

                            {/* No classrooms */}
                            {sData && !sData.isLoading && !sData.error && sData.classrooms.length === 0 && (
                              <div className="pl-6 py-1">
                                <span className="text-xs text-gray-400">無班級</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
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
          onClick={() => onSelectNode({ type: 'stories', id: 'stories' })}
          className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
            isSelected('stories', 'stories')
              ? 'bg-emerald-50 text-emerald-700'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          }`}
        >
          <svg
            className={`w-4 h-4 ${isSelected('stories', 'stories') ? 'text-emerald-500' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          <span className={`text-sm ${isSelected('stories', 'stories') ? 'font-semibold' : ''}`}>
            課文管理
          </span>
        </button>
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
