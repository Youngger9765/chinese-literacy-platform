/**
 * AdminTreeSidebar — orchestrator
 *
 * Thin wrapper that composes:
 *   - useAdminTreeState  (expand/collapse/load state)
 *   - AdminTreeNode      (recursive org → school → classroom tree)
 *   - AdminTreeActions   (bottom management links)
 *
 * Issue #1950 refactor: was 619 LOC, now ~130 LOC.
 */
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { PlusIcon, BuildingIcon, ShieldIcon, UsersIcon } from '../../components/icons';
import { useAdminTreeState } from './hooks/useAdminTreeState';
import AdminTreeNode from './components/AdminTreeNode';
import AdminTreeActions from './components/AdminTreeActions';
import { CollapseIcon, StoriesIcon, TtsAuditIcon } from './components/AdminTreeIcons';

// ── Types ───────────────────────────────────────────────────────────────────

export type TreeNodeSelection =
  | { type: 'org'; id: string }
  | { type: 'school'; id: number }
  | { type: 'classroom'; id: number }
  | { type: 'roles'; id: 'roles' }
  | { type: 'users'; id: 'users' }
  | { type: 'stories'; id: 'stories' }
  | { type: 'tts_audit'; id: 'tts_audit' }
  | { type: 'lesson_audio'; id: 'lesson_audio' }
  | { type: 'story_structure_lab'; id: 'story_structure_lab' }
  | { type: 'keypoints_qa'; id: 'keypoints_qa' }
  | { type: 'create_org'; id: 'create_org' };

type TreeNodeType = TreeNodeSelection['type'];

/** 朗讀測試集集成板（外部靜態頁）— 收合/展開兩處入口共用，避免路徑各硬編一次 (#2448) */
export const READING_TESTSET_URL = '/presentation/reading-pipeline.html#testset';

interface AdminTreeSidebarProps {
  selectedNode: TreeNodeSelection | null;
  onSelectNode: (node: TreeNodeSelection | null) => void;
  refreshTrigger?: number;
}

// ── Sidebar Component ───────────────────────────────────────────────────────

const AdminTreeSidebar: React.FC<AdminTreeSidebarProps> = ({ selectedNode, onSelectNode, refreshTrigger }) => {
  const { token } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const {
    orgs,
    isLoadingOrgs,
    orgsError,
    loadOrgs,
    expandedOrgs,
    toggleOrg,
    orgData,
    expandedSchools,
    toggleSchool,
    schoolData,
  } = useAdminTreeState(token, refreshTrigger);

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
          <StoriesIcon />
        </button>

        {/* TTS Audit icon */}
        <button
          onClick={() => onSelectNode({ type: 'tts_audit', id: 'tts_audit' })}
          className={`p-1.5 rounded-md transition-colors cursor-pointer mb-1 ${
            isSelected('tts_audit', 'tts_audit')
              ? 'bg-violet-50 text-violet-600'
              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
          title="TTS 句子稽核"
        >
          <TtsAuditIcon />
        </button>

        {/* Lesson audio icon */}
        <button
          onClick={() => onSelectNode({ type: 'lesson_audio', id: 'lesson_audio' })}
          className={`p-1.5 rounded-md transition-colors cursor-pointer mb-1 ${
            isSelected('lesson_audio', 'lesson_audio')
              ? 'bg-cyan-50 text-cyan-600'
              : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
          }`}
          title="課程音檔總表"
        >
          <TtsAuditIcon />
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

        {/* 朗讀測試集 — 外部集成板（新分頁），與完整側邊欄入口一致 (#2448) */}
        <a
          href={READING_TESTSET_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="朗讀測試集"
          className="p-1.5 mt-1 rounded-md transition-colors cursor-pointer text-gray-400 hover:bg-gray-100 hover:text-gray-600 flex items-center justify-center"
          title="朗讀測試集（錄音 + AI 跑分現況）"
        >
          <span className="text-sm" aria-hidden="true">🎙</span>
        </a>
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
        {!isLoadingOrgs && !orgsError && orgs.map((org) => (
          <AdminTreeNode
            key={org.id}
            org={org}
            isSelected={isSelected('org', org.id)}
            isExpanded={expandedOrgs.has(org.id)}
            orgData={orgData[org.id]}
            expandedSchools={expandedSchools}
            schoolData={schoolData}
            onToggleOrg={toggleOrg}
            onSelectNode={onSelectNode}
            onToggleSchool={toggleSchool}
            isSchoolSelected={(id) => isSelected('school', id)}
            isClassroomSelected={(id) => isSelected('classroom', id)}
          />
        ))}
      </div>

      {/* Bottom fixed: management links */}
      <AdminTreeActions selectedNode={selectedNode} onSelectNode={onSelectNode} />
    </div>
  );
};

export default AdminTreeSidebar;
