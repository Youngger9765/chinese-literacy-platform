/**
 * AdminTreeActions
 *
 * Bottom fixed management links and top "+ new org" action buttons.
 * Extracted from AdminTreeSidebar (Issue #1950).
 */
import React from 'react';
import { ShieldIcon, UsersIcon } from '../../../components/icons';
import { StoriesIcon, TtsAuditIcon, StructureLabIcon } from './AdminTreeIcons';
import { READING_TESTSET_URL, type TreeNodeSelection } from '../AdminTreeSidebar';

// ── Types ─────────────────────────────────────────────────────────────────

interface AdminTreeActionsProps {
  selectedNode: TreeNodeSelection | null;
  onSelectNode: (node: TreeNodeSelection) => void;
}

// ── Helper ────────────────────────────────────────────────────────────────

function isSelected(selectedNode: TreeNodeSelection | null, type: TreeNodeSelection['type'], id: string | number): boolean {
  return selectedNode?.type === type && selectedNode?.id === id;
}

// ── AdminTreeActions ──────────────────────────────────────────────────────

const AdminTreeActions: React.FC<AdminTreeActionsProps> = ({ selectedNode, onSelectNode }) => {
  return (
    <div className="border-t border-gray-100 shrink-0">
      {/* Stories */}
      <button
        onClick={() => onSelectNode({ type: 'stories', id: 'stories' })}
        className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
          isSelected(selectedNode, 'stories', 'stories')
            ? 'bg-emerald-50 text-emerald-700'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        }`}
      >
        <StoriesIcon className={isSelected(selectedNode, 'stories', 'stories') ? 'text-emerald-500' : ''} />
        <span className={`text-sm ${isSelected(selectedNode, 'stories', 'stories') ? 'font-semibold' : ''}`}>
          課文管理
        </span>
      </button>


      {/* Story Structure Lab */}
      <button
        onClick={() => onSelectNode({ type: 'story_structure_lab', id: 'story_structure_lab' })}
        className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
          isSelected(selectedNode, 'story_structure_lab', 'story_structure_lab')
            ? 'bg-sky-50 text-sky-700'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        }`}
      >
        <StructureLabIcon className={isSelected(selectedNode, 'story_structure_lab', 'story_structure_lab') ? 'text-sky-500' : ''} />
        <span className={`text-sm ${isSelected(selectedNode, 'story_structure_lab', 'story_structure_lab') ? 'font-semibold' : ''}`}>
          文章重點表 Lab
        </span>
      </button>

      {/* TTS Audit */}
      <button
        onClick={() => onSelectNode({ type: 'tts_audit', id: 'tts_audit' })}
        className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
          isSelected(selectedNode, 'tts_audit', 'tts_audit')
            ? 'bg-violet-50 text-violet-700'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        }`}
      >
        <TtsAuditIcon className={`shrink-0 ${isSelected(selectedNode, 'tts_audit', 'tts_audit') ? 'text-violet-500' : ''}`} />
        <span className={`text-sm ${isSelected(selectedNode, 'tts_audit', 'tts_audit') ? 'font-semibold' : ''}`}>
          TTS 句子稽核
        </span>
      </button>

      {/* Lesson Audio */}
      <button
        onClick={() => onSelectNode({ type: 'lesson_audio', id: 'lesson_audio' })}
        className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
          isSelected(selectedNode, 'lesson_audio', 'lesson_audio')
            ? 'bg-cyan-50 text-cyan-700'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        }`}
      >
        <TtsAuditIcon className={`shrink-0 ${isSelected(selectedNode, 'lesson_audio', 'lesson_audio') ? 'text-cyan-500' : ''}`} />
        <span className={`text-sm ${isSelected(selectedNode, 'lesson_audio', 'lesson_audio') ? 'font-semibold' : ''}`}>
          課程音檔總表
        </span>
      </button>

      {/* Keypoints QA */}
      <button
        onClick={() => onSelectNode({ type: 'keypoints_qa', id: 'keypoints_qa' })}
        className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
          isSelected(selectedNode, 'keypoints_qa', 'keypoints_qa')
            ? 'bg-sky-50 text-sky-700'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        }`}
      >
        <span className={`text-sm shrink-0 w-4 text-center ${isSelected(selectedNode, 'keypoints_qa', 'keypoints_qa') ? 'text-sky-500' : ''}`}>表</span>
        <span className={`text-sm ${isSelected(selectedNode, 'keypoints_qa', 'keypoints_qa') ? 'font-semibold' : ''}`}>
          重點表 QA
        </span>
      </button>

      {/* 朗讀測試集 — 外部集成板（新分頁）。同源開啟，admin 的 token 讓 recordings 直接載入 (#2448) */}
      <a
        href={READING_TESTSET_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer text-gray-500 hover:bg-gray-50 hover:text-gray-700"
        title="朗讀測試集 — 錄音收集 + AI 跑分現況（新分頁開啟）"
      >
        <span className="text-sm shrink-0 w-4 text-center" aria-hidden="true">🎙</span>
        <span className="text-sm">朗讀測試集</span>
      </a>

      {/* Roles */}
      <button
        onClick={() => onSelectNode({ type: 'roles', id: 'roles' })}
        className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
          isSelected(selectedNode, 'roles', 'roles')
            ? 'bg-amber-50 text-amber-700'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        }`}
      >
        <ShieldIcon className={isSelected(selectedNode, 'roles', 'roles') ? 'text-amber-500' : ''} />
        <span className={`text-sm ${isSelected(selectedNode, 'roles', 'roles') ? 'font-semibold' : ''}`}>
          角色管理
        </span>
      </button>

      {/* Users */}
      <button
        onClick={() => onSelectNode({ type: 'users', id: 'users' })}
        className={`flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors cursor-pointer ${
          isSelected(selectedNode, 'users', 'users')
            ? 'bg-indigo-50 text-indigo-700'
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
        }`}
      >
        <UsersIcon className={isSelected(selectedNode, 'users', 'users') ? 'text-indigo-500' : ''} />
        <span className={`text-sm ${isSelected(selectedNode, 'users', 'users') ? 'font-semibold' : ''}`}>
          使用者管理
        </span>
      </button>
    </div>
  );
};

export default AdminTreeActions;
