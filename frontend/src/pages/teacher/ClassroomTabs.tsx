/**
 * ClassroomTabs — Junyi-style three-tab layout for teacher classrooms (#3384).
 *
 * 班級設定 / 指派任務 / 班級數據
 * 舊連結 ?tab=… 仍可解析到新的三個 canonical keys
 */
import React from 'react';
import CoTeachingTab from './CoTeachingTab';
import AssignmentsPanel from './panel/AssignmentsPanel';
import ClassDataTab, { type DataView as ClassDataView } from './panel/ClassDataTab';

type TabKey = 'settings' | 'assignments' | 'data';

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'settings', label: '班級設定' },
  { key: 'assignments', label: '指派任務' },
  { key: 'data', label: '班級數據' },
];

const ALL_KEYS = new Set<string>(TABS.map((tab) => tab.key));

export const LEGACY_TAB_KEYS: Record<string, TabKey> = {
  overview: 'data',
  students: 'data',
  'at-risk': 'data',
  'error-heatmap': 'data',
  analytics: 'data',
  learning: 'data',
  teachers: 'settings',
  assignments: 'assignments',
  progress: 'data',
  live: 'data',
  texts: 'assignments',
  'cross-text': 'data',
};

export const LEGACY_VIEW_HINTS: Record<string, ClassDataView> = {
  overview: 'today',
  students: 'students',
  'at-risk': 'at-risk',
  'error-heatmap': 'error-heatmap',
  analytics: 'analytics',
  learning: 'learning',
  progress: 'learning',
  live: 'today',
  'cross-text': 'analytics',
};

export function resolveInitialView(raw: string | null | undefined): ClassDataView | null {
  return raw ? LEGACY_VIEW_HINTS[raw] ?? null : null;
}

export function resolveTabKey(raw: string | null | undefined): TabKey {
  if (!raw) return 'settings';
  if (ALL_KEYS.has(raw)) return raw as TabKey;
  return LEGACY_TAB_KEYS[raw] ?? 'settings';
}

interface ClassroomTabsProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  classroomId: number;
  ownerId: number;
  selectedAssignmentId: number | null;
  onSelectAssignment: (id: number | null) => void;
  selectedStudentId: number | null;
  onSelectStudent: (id: number | null) => void;
  initialView?: string | null;
  onViewChange?: (view: string) => void;
  settingsContent: React.ReactNode;
  /** Junyi-parity layout: persistent class column next to the tab content (>= xl). */
  sidebar?: React.ReactNode;
  /** Rendered above the tab content (class switcher on narrow screens, errors). */
  topSlot?: React.ReactNode;
}

// Junyi-parity: three equal full-width cells; the selected one is a solid filled
// block (not an underline) so the current section is obvious from across a room.
const tabClass = (active: boolean) =>
  `flex-1 min-w-0 py-3 sm:py-3.5 text-base sm:text-xl font-medium text-center border-b-4 transition-colors cursor-pointer whitespace-nowrap ${
    active
      ? 'bg-accent text-white border-accent-hover'
      : 'bg-white text-gray-500 border-gray-200 hover:text-gray-800 hover:bg-gray-50'
  }`;

const CoTeachingSection: React.FC<{ classroomId: number; ownerId: number }> = ({ classroomId, ownerId }) => {
  const [isOpen, setIsOpen] = React.useState(true);

  return (
    <section className="rounded-xl border border-gray-200" aria-label="協同教師">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-4 py-3 text-left font-semibold text-gray-800 cursor-pointer"
      >
        協同教師
        <span className="text-sm font-normal text-gray-500">{isOpen ? '收合 ▲' : '展開 ▼'}</span>
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 p-4">
          <CoTeachingTab classroomId={classroomId} ownerId={ownerId} />
        </div>
      )}
    </section>
  );
};

const ClassroomTabs: React.FC<ClassroomTabsProps> = ({
  activeTab,
  onTabChange,
  classroomId,
  ownerId,
  selectedAssignmentId,
  onSelectAssignment,
  selectedStudentId,
  onSelectStudent,
  initialView,
  onViewChange,
  settingsContent,
  sidebar,
  topSlot,
}) => (
  <div className="min-h-full flex flex-col">
    <nav className="flex sticky top-0 z-10 shadow-sm" aria-label="班級分頁" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-label={tab.label}
          aria-selected={activeTab === tab.key}
          onClick={() => onTabChange(tab.key)}
          className={tabClass(activeTab === tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>

    <div className="flex-1 xl:flex xl:items-stretch">
      {sidebar && (
        <aside className="hidden xl:block w-52 shrink-0 bg-white border-r border-gray-200">{sidebar}</aside>
      )}
      <div className="flex-1 min-w-0 p-4 sm:p-6 xl:p-5 space-y-4">
        {topSlot}
        <div className="bg-white rounded-2xl shadow-card max-w-[1200px]">
    {activeTab === 'settings' && (
      <div className="p-5 space-y-5">
        {settingsContent}
        <CoTeachingSection classroomId={classroomId} ownerId={ownerId} />
      </div>
    )}

    {activeTab === 'assignments' && (
      <AssignmentsPanel
        classroomId={classroomId}
        selectedAssignmentId={selectedAssignmentId}
        onSelectAssignment={onSelectAssignment}
        onOpenStudent={onSelectStudent}
      />
    )}

    {activeTab === 'data' && (
      <ClassDataTab
        classroomId={classroomId}
        selectedStudentId={selectedStudentId}
        onSelectStudent={onSelectStudent}
        onSelectAssignment={onSelectAssignment}
        initialView={initialView ?? undefined}
        onViewChange={onViewChange}
      />
    )}
        </div>
      </div>
    </div>
  </div>
);

export type { TabKey };
export default ClassroomTabs;
