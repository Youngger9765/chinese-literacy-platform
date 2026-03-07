import React, { useState, useEffect, useCallback } from 'react';
import AdminTreeSidebar, { TreeNodeSelection } from './AdminTreeSidebar';
import OrgDetailPanel from './OrgDetailPanel';
import OrgDashboardPanel from './OrgDashboardPanel';
import SchoolDetailPanel from './SchoolDetailPanel';
import CreateOrgPanel from './CreateOrgPanel';
import ClassroomDetailPanel from './ClassroomDetailPanel';
import UsersPanel from './UsersPanel';
import { BuildingIcon, ShieldIcon } from '../../components/icons';
import {
  listRoles,
  RoleResponse,
  RoleApiError,
} from '../../services/roleApi';
import { useAuth } from '../../contexts/AuthContext';

type OrgTab = 'detail' | 'dashboard';

// ── Main AdminDashboard ─────────────────────────────────────────────────────

const AdminDashboard: React.FC = () => {
  const [selectedNode, setSelectedNode] = useState<TreeNodeSelection | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [orgTab, setOrgTab] = useState<OrgTab>('detail');

  const refreshSidebar = useCallback(() => {
    setSidebarRefreshKey((prev) => prev + 1);
  }, []);

  const handleOrgCreated = useCallback((orgId: string) => {
    refreshSidebar();
    setSelectedNode({ type: 'org', id: orgId });
    setOrgTab('detail');
  }, [refreshSidebar]);

  const handleSelectClassroom = useCallback((classroomId: number) => {
    setSelectedNode({ type: 'classroom', id: classroomId });
  }, []);

  // Reset tab when switching org
  const handleSelectNode = useCallback((node: TreeNodeSelection | null) => {
    setSelectedNode(node);
    if (node?.type !== 'org') return;
    setOrgTab('detail');
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      <AdminTreeSidebar
        selectedNode={selectedNode}
        onSelectNode={handleSelectNode}
        refreshTrigger={sidebarRefreshKey}
      />

      <div className="flex-1 overflow-y-auto">
        {!selectedNode && <AdminWelcome />}
        {selectedNode?.type === 'create_org' && (
          <CreateOrgPanel
            onCreated={handleOrgCreated}
            onCancel={() => setSelectedNode(null)}
          />
        )}
        {selectedNode?.type === 'org' && (
          <div className="flex flex-col h-full">
            {/* Tab bar */}
            <div className="border-b border-gray-200 bg-white px-6 pt-5 shrink-0">
              <nav className="flex gap-1" role="tablist">
                <button
                  role="tab"
                  aria-selected={orgTab === 'detail'}
                  onClick={() => setOrgTab('detail')}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors cursor-pointer ${
                    orgTab === 'detail'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  詳情
                </button>
                <button
                  role="tab"
                  aria-selected={orgTab === 'dashboard'}
                  onClick={() => setOrgTab('dashboard')}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors cursor-pointer ${
                    orgTab === 'dashboard'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  儀表板
                </button>
              </nav>
            </div>
            {orgTab === 'detail' ? (
              <OrgDetailPanel
                organizationId={selectedNode.id}
                onSchoolCreated={refreshSidebar}
                onSelectSchool={(schoolId) => setSelectedNode({ type: 'school', id: schoolId })}
              />
            ) : (
              <OrgDashboardPanel organizationId={selectedNode.id} />
            )}
          </div>
        )}
        {selectedNode?.type === 'school' && (
          <SchoolDetailPanel
            schoolId={selectedNode.id}
            onSelectClassroom={handleSelectClassroom}
            onClassroomCreated={refreshSidebar}
          />
        )}
        {selectedNode?.type === 'classroom' && (
          <ClassroomDetailPanel
            classroomId={selectedNode.id}
            onBackToSchool={(schoolId) => setSelectedNode({ type: 'school', id: schoolId })}
          />
        )}
        {selectedNode?.type === 'roles' && <RolesPanel />}
        {selectedNode?.type === 'users' && <UsersPanel />}
      </div>
    </div>
  );
};

// ── Welcome Panel ───────────────────────────────────────────────────────────

const AdminWelcome: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
    <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-bg rounded-2xl mb-4">
      <BuildingIcon className="w-8 h-8 text-accent" />
    </div>
    <h2 className="text-xl font-bold text-gray-900 mb-2">系統管理</h2>
    <p className="text-sm text-gray-500 max-w-sm">
      從左側樹狀結構選擇機構或學校，查看詳細資料與管理設定
    </p>
  </div>
);

// ── Roles Panel ─────────────────────────────────────────────────────────────

const SCOPE_LEVEL_LABELS: Record<string, string> = {
  global: '全域',
  organization: '機構',
  school: '學校',
  classroom: '班級',
};

const RolesPanel: React.FC = () => {
  const { token } = useAuth();
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
    <div className="p-6 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">角色管理</h2>
          <p className="text-sm text-gray-500 mt-1">
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
              <ShieldIcon className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">尚無角色定義</h3>
            <p className="text-sm text-gray-500">系統角色尚未建立</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
