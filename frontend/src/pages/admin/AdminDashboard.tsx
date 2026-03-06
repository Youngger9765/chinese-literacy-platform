import React, { useState, useEffect, useCallback } from 'react';
import AdminTreeSidebar, { TreeNodeSelection } from './AdminTreeSidebar';
import OrgDetailPanel from './OrgDetailPanel';
import SchoolDetailPanel from './SchoolDetailPanel';
import {
  listRoles,
  RoleResponse,
  RoleApiError,
} from '../../services/roleApi';
import { useAuth } from '../../contexts/AuthContext';

// ── Main AdminDashboard ─────────────────────────────────────────────────────

const AdminDashboard: React.FC = () => {
  const [selectedNode, setSelectedNode] = useState<TreeNodeSelection | null>(null);

  return (
    <div className="flex flex-1 overflow-hidden">
      <AdminTreeSidebar
        selectedNode={selectedNode}
        onSelectNode={setSelectedNode}
      />

      <div className="flex-1 overflow-y-auto">
        {!selectedNode && <AdminWelcome />}
        {selectedNode?.type === 'org' && (
          <OrgDetailPanel organizationId={selectedNode.id} />
        )}
        {selectedNode?.type === 'school' && (
          <SchoolDetailPanel schoolId={selectedNode.id} />
        )}
        {selectedNode?.type === 'roles' && <RolesPanel />}
      </div>
    </div>
  );
};

// ── Welcome Panel ───────────────────────────────────────────────────────────

const AdminWelcome: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
    <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-bg rounded-2xl mb-4">
      <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
      </svg>
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
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
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
