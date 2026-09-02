/**
 * ClassroomTabs — Issue #1943 + Issue #1986
 *
 * Renders a 2-row grouped tab bar:
 *   Row 1 (日常管理): 學生進度 / 學生名單 / 課文管理 / 協同教師
 *   Row 2 (進階分析): 學習分析 / 跨課文分析 / 早期介入 / 錯字熱力圖
 *
 * All tab components remain unchanged — this is purely a presentation change.
 */
import React from 'react';
import { ClassroomDetailResponse } from '../../services/classroomApi';
import StudentProgressTab from './StudentProgressTab';
import TextManagementTab from './TextManagementTab';
import StudentListTab from './StudentListTab';
import ClassroomAnalytics from './ClassroomAnalytics';
import CrossTextAnalytics from './CrossTextAnalytics';
import AtRiskStudents from '../../components/teacher/AtRiskStudents';
import ErrorHeatmapTab from './ErrorHeatmapTab';
import CoTeachingTab from './CoTeachingTab';
import LiveMonitorTab from './LiveMonitorTab';

type TabKey = 'progress' | 'live' | 'texts' | 'students' | 'analytics' | 'cross-text' | 'at-risk' | 'error-heatmap' | 'teachers';

interface TabDef {
  key: TabKey;
  label: string;
}

const CORE_TABS: TabDef[] = [
  { key: 'progress', label: '學生進度' },
  { key: 'live', label: '課堂即時' },
  { key: 'students', label: '學生名單' },
  { key: 'texts', label: '課文管理' },
  { key: 'teachers', label: '協同教師' },
];

const ANALYSIS_TABS: TabDef[] = [
  { key: 'analytics', label: '學習分析' },
  { key: 'cross-text', label: '跨課文分析' },
  { key: 'at-risk', label: '早期介入' },
  { key: 'error-heatmap', label: '錯字熱力圖' },
];

// Backwards-compat export (kept for any external consumers)
export const TABS: { key: TabKey; label: string; group?: 'core' | 'analysis' | 'other' }[] = [
  { key: 'progress', label: '學生進度', group: 'core' },
  { key: 'live', label: '課堂即時', group: 'core' },
  { key: 'students', label: '學生名單', group: 'core' },
  { key: 'texts', label: '課文管理', group: 'core' },
  { key: 'analytics', label: '學習分析', group: 'analysis' },
  { key: 'cross-text', label: '跨課文分析', group: 'analysis' },
  { key: 'at-risk', label: '早期介入', group: 'analysis' },
  { key: 'error-heatmap', label: '錯字熱力圖', group: 'analysis' },
  { key: 'teachers', label: '協同教師', group: 'other' },
];

// Props passed through to StudentListTab
interface StudentListTabPassthroughProps {
  token: string | null;
  studentIdInput: string;
  setStudentIdInput: (v: string) => void;
  isAddingStudent: boolean;
  addStudentError: string;
  setAddStudentError: (v: string) => void;
  onAddStudent: (e: React.FormEvent) => void;
  removingStudentId: number | null;
  onRemoveStudent: (student: { id: number; username: string; full_name?: string }) => void;
  setRemovingStudentId: (id: number | null) => void;
  formatDate: (dateStr: string) => string;
  onStudentsImported: () => void;
}

interface ClassroomTabsProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  classroomId: number;
  classroom: ClassroomDetailResponse;
  studentListProps: StudentListTabPassthroughProps;
}

interface TabRowProps {
  groupLabel: string;
  tabs: TabDef[];
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  hasBorderBottom?: boolean;
}

const TabRow: React.FC<TabRowProps> = ({ groupLabel, tabs, activeTab, onTabChange, hasBorderBottom = true }) => (
  <div
    role="group"
    aria-label={groupLabel}
    className={`flex items-center gap-1 px-4 ${hasBorderBottom ? 'border-b border-gray-200' : 'border-b border-gray-100'}`}
  >
    <span className="text-xs font-medium text-gray-400 pr-2 shrink-0 py-2 select-none">
      {groupLabel}
    </span>
    <span className="w-px h-4 bg-gray-200 shrink-0" aria-hidden="true" />
    <nav className="flex -mb-px" aria-label={groupLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer shrink-0 ${
            activeTab === tab.key
              ? 'border-accent text-accent'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  </div>
);

const ClassroomTabs: React.FC<ClassroomTabsProps> = ({
  activeTab,
  onTabChange,
  classroomId,
  classroom,
  studentListProps,
}) => (
  <div className="bg-white rounded-2xl shadow-card">
    {/* 2-row grouped tab bar */}
    <div className="overflow-x-auto">
      <TabRow
        groupLabel="日常管理"
        tabs={CORE_TABS}
        activeTab={activeTab}
        onTabChange={onTabChange}
        hasBorderBottom={false}
      />
      <TabRow
        groupLabel="進階分析"
        tabs={ANALYSIS_TABS}
        activeTab={activeTab}
        onTabChange={onTabChange}
        hasBorderBottom
      />
    </div>

    {/* Tab content */}
    {activeTab === 'progress' && (
      <StudentProgressTab classroomId={classroomId} />
    )}

    {activeTab === 'live' && (
      <LiveMonitorTab classroomId={classroomId} />
    )}

    {activeTab === 'analytics' && (
      <ClassroomAnalytics classroomId={classroomId} />
    )}

    {activeTab === 'cross-text' && (
      <CrossTextAnalytics classroomId={classroomId} />
    )}

    {activeTab === 'at-risk' && (
      <AtRiskStudents classroomId={classroomId} />
    )}

    {activeTab === 'error-heatmap' && (
      <ErrorHeatmapTab classroomId={classroomId} />
    )}

    {activeTab === 'texts' && (
      <TextManagementTab classroomId={classroomId} />
    )}

    {activeTab === 'students' && (
      <StudentListTab
        classroom={classroom}
        token={studentListProps.token}
        studentIdInput={studentListProps.studentIdInput}
        setStudentIdInput={studentListProps.setStudentIdInput}
        isAddingStudent={studentListProps.isAddingStudent}
        addStudentError={studentListProps.addStudentError}
        setAddStudentError={studentListProps.setAddStudentError}
        onAddStudent={studentListProps.onAddStudent}
        removingStudentId={studentListProps.removingStudentId}
        onRemoveStudent={studentListProps.onRemoveStudent}
        setRemovingStudentId={studentListProps.setRemovingStudentId}
        formatDate={studentListProps.formatDate}
        onStudentsImported={studentListProps.onStudentsImported}
      />
    )}

    {activeTab === 'teachers' && (
      <CoTeachingTab
        classroomId={classroomId}
        ownerId={classroom.teacher_id}
      />
    )}
  </div>
);

export type { TabKey };
export default ClassroomTabs;
