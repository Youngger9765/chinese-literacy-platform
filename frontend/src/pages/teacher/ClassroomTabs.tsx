/**
 * ClassroomTabs — #1943 / #1986, re-laid out for #3367, simplified for #3376
 *
 * 老師每天用的四個分頁＋「更多」（Young 2026-10-10：介面請簡單）：
 *   今日總覽 / 作業 / 學生 / 早期介入 / 更多
 *   更多 → 錯字總表 / 學習分析 / 詳細學習紀錄 / 協同教師
 *
 * 舊連結 ?tab=… 仍可用（resolveTabKey）。
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
import StudentsPanel from './panel/StudentsPanel';

type TabKey =
  | 'overview' | 'assignments' | 'students' | 'at-risk'
  | 'error-heatmap' | 'analytics' | 'learning' | 'teachers';

/** The tabs shown in the bar. 「更多」 stands for every key in MORE_TABS. */
export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '今日總覽' },
  { key: 'assignments', label: '作業' },
  { key: 'students', label: '學生' },
  { key: 'at-risk', label: '早期介入' },
];

export const MORE_TABS: { key: TabKey; label: string }[] = [
  { key: 'error-heatmap', label: '錯字總表' },
  { key: 'analytics', label: '學習分析' },
  { key: 'learning', label: '詳細學習紀錄' },
  { key: 'teachers', label: '協同教師' },
];

const ALL_KEYS = new Set<string>([...TABS, ...MORE_TABS].map((t) => t.key));

/** Old ?tab= values, so bookmarks and links in issues keep working. */
const LEGACY_TAB_KEYS: Record<string, TabKey> = {
  progress: 'learning',
  live: 'overview',
  texts: 'assignments',
  'cross-text': 'analytics',
};

export function resolveTabKey(raw: string | null | undefined): TabKey {
  if (!raw) return 'overview';
  if (ALL_KEYS.has(raw)) return raw as TabKey;
  return LEGACY_TAB_KEYS[raw] ?? 'overview';
}

const isMore = (key: TabKey) => MORE_TABS.some((t) => t.key === key);

interface ClassroomTabsProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  classroomId: number;
  ownerId: number;
  selectedAssignmentId: number | null;
  onSelectAssignment: (id: number | null) => void;
  selectedStudentId: number | null;
  onSelectStudent: (id: number | null) => void;
}

const tabClass = (active: boolean) =>
  `px-3 sm:px-5 py-3 text-[15px] sm:text-base font-medium border-b-2 -mb-px transition-colors cursor-pointer shrink-0 ${
    active ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
  }`;

const ClassroomTabs: React.FC<ClassroomTabsProps> = ({
  activeTab,
  onTabChange,
  classroomId,
  ownerId,
  selectedAssignmentId,
  onSelectAssignment,
  selectedStudentId,
  onSelectStudent,
}) => {
  const openStudent = (id: number) => {
    onSelectStudent(id);
  };

  return (
    <div className="bg-white rounded-2xl shadow-card">
      <nav className="flex overflow-x-auto border-b border-gray-200 px-2" aria-label="班級分頁" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => onTabChange(tab.key)}
            className={tabClass(activeTab === tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={isMore(activeTab)}
          onClick={() => onTabChange(isMore(activeTab) ? activeTab : 'error-heatmap')}
          className={tabClass(isMore(activeTab))}
        >
          更多
        </button>
      </nav>

      {isMore(activeTab) && (
        <div className="flex flex-wrap gap-2 px-5 pt-4" role="group" aria-label="更多">
          {MORE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={activeTab === t.key}
              onClick={() => onTabChange(t.key)}
              className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer ${
                activeTab === t.key ? 'bg-accent text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'overview' && (
        <TodayOverviewTab
          classroomId={classroomId}
          // onSelectAssignment already switches to 作業; a second onTabChange would
          // rebuild the URL from stale params and drop ?assignment= (#3376 audit).
          onOpenAssignment={(id) => onSelectAssignment(id)}
          onOpenAtRisk={() => onTabChange('at-risk')}
        />
      )}

      {activeTab === 'assignments' && (
        <AssignmentsPanel
          classroomId={classroomId}
          selectedAssignmentId={selectedAssignmentId}
          onSelectAssignment={onSelectAssignment}
          onOpenStudent={openStudent}
        />
      )}

      {activeTab === 'students' && (
        <StudentsPanel
          classroomId={classroomId}
          selectedStudentId={selectedStudentId}
          onSelectStudent={onSelectStudent}
        />
      )}

      {activeTab === 'at-risk' && <AtRiskStudents classroomId={classroomId} />}
      {activeTab === 'error-heatmap' && <ErrorHeatmapTab classroomId={classroomId} />}
      {activeTab === 'analytics' && (
        <div className="divide-y divide-gray-100">
          <ClassroomAnalytics classroomId={classroomId} />
          <CrossTextAnalytics classroomId={classroomId} />
        </div>
      )}
      {activeTab === 'learning' && <StudentProgressTab classroomId={classroomId} />}
      {activeTab === 'teachers' && <CoTeachingTab classroomId={classroomId} ownerId={ownerId} />}
    </div>
  );
};

export type { TabKey };
export default ClassroomTabs;
