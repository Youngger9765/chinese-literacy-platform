/**
 * ClassroomTabs — Issue #1943 + #1986, re-laid out for #3367
 *
 * 一排分頁，依老師的任務排，不依資料來源排（設計規格 docs/design/teacher-panel-redesign §2.2）：
 *   今日總覽 / 作業 / 學生學習紀錄 / 早期介入 / 錯字總表 / 學習分析 / 協同教師
 *
 * 舊分頁的去向（舊連結 ?tab=… 仍可用，見 resolveTabKey）：
 *   學生名單 → 班級頁首（ClassroomDetail）
 *   課文管理 → 作業分頁的「自學課文庫」
 *   課堂即時 → 今日總覽的卡片
 *   學生進度 → 學生學習紀錄
 *   跨課文分析 → 學習分析
 */
import React from 'react';
import StudentProgressTab from './StudentProgressTab';
import ClassroomAnalytics from './ClassroomAnalytics';
import CrossTextAnalytics from './CrossTextAnalytics';
import AtRiskStudents from '../../components/teacher/AtRiskStudents';
import ErrorHeatmapTab from './ErrorHeatmapTab';
import CoTeachingTab from './CoTeachingTab';
import TodayOverviewTab from './panel/TodayOverviewTab';
import AssignmentsPanel from './panel/AssignmentsPanel';

type TabKey = 'overview' | 'assignments' | 'learning' | 'at-risk' | 'error-heatmap' | 'analytics' | 'teachers';

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '今日總覽' },
  { key: 'assignments', label: '作業' },
  { key: 'learning', label: '學生學習紀錄' },
  { key: 'at-risk', label: '早期介入' },
  { key: 'error-heatmap', label: '錯字總表' },
  { key: 'analytics', label: '學習分析' },
  { key: 'teachers', label: '協同教師' },
];

/** Old ?tab= values from before #3367, so bookmarks and links keep working. */
const LEGACY_TAB_KEYS: Record<string, TabKey> = {
  progress: 'learning',
  live: 'overview',
  students: 'overview',
  texts: 'assignments',
  'cross-text': 'analytics',
};

export function resolveTabKey(raw: string | null | undefined): TabKey {
  if (!raw) return 'overview';
  if (TABS.some((t) => t.key === raw)) return raw as TabKey;
  return LEGACY_TAB_KEYS[raw] ?? 'overview';
}

interface ClassroomTabsProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  classroomId: number;
  ownerId: number;
  selectedAssignmentId: number | null;
  onSelectAssignment: (id: number | null) => void;
}

const ClassroomTabs: React.FC<ClassroomTabsProps> = ({
  activeTab,
  onTabChange,
  classroomId,
  ownerId,
  selectedAssignmentId,
  onSelectAssignment,
}) => (
  <div className="bg-white rounded-2xl shadow-card">
    <nav className="flex overflow-x-auto border-b border-gray-200 px-2" aria-label="班級分頁" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`px-4 py-3 text-base font-medium border-b-2 -mb-px transition-colors cursor-pointer shrink-0 ${
            activeTab === tab.key
              ? 'border-accent text-accent'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>

    {activeTab === 'overview' && (
      <TodayOverviewTab
        classroomId={classroomId}
        onOpenAssignment={(id) => {
          onSelectAssignment(id);
          onTabChange('assignments');
        }}
        onOpenAtRisk={() => onTabChange('at-risk')}
      />
    )}

    {activeTab === 'assignments' && (
      <AssignmentsPanel
        classroomId={classroomId}
        selectedAssignmentId={selectedAssignmentId}
        onSelectAssignment={onSelectAssignment}
      />
    )}

    {activeTab === 'learning' && (
      <div>
        <p className="px-5 pt-5 text-sm text-gray-500">
          每位學生的所有練習（含自己選的自學課文），點開學生看個人學習曲線、指導紀錄與標籤；老師指派的作業成績看「作業」分頁
        </p>
        <StudentProgressTab classroomId={classroomId} />
      </div>
    )}

    {activeTab === 'at-risk' && <AtRiskStudents classroomId={classroomId} />}

    {activeTab === 'error-heatmap' && <ErrorHeatmapTab classroomId={classroomId} />}

    {activeTab === 'analytics' && (
      <div className="divide-y divide-gray-100">
        <ClassroomAnalytics classroomId={classroomId} />
        <CrossTextAnalytics classroomId={classroomId} />
      </div>
    )}

    {activeTab === 'teachers' && <CoTeachingTab classroomId={classroomId} ownerId={ownerId} />}
  </div>
);

export type { TabKey };
export default ClassroomTabs;
