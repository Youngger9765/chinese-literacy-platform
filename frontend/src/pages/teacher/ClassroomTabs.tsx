/**
 * ClassroomTabs — Issue #1943
 *
 * Renders the tab bar + delegates to the appropriate tab component.
 * All tab components remain unchanged — this is purely a delegation container.
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

type TabKey = 'progress' | 'texts' | 'students' | 'analytics' | 'cross-text' | 'at-risk' | 'error-heatmap' | 'teachers';

export const TABS: { key: TabKey; label: string; group?: 'core' | 'analysis' | 'other' }[] = [
  { key: 'progress', label: '學生進度', group: 'core' },
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

const ClassroomTabs: React.FC<ClassroomTabsProps> = ({
  activeTab,
  onTabChange,
  classroomId,
  classroom,
  studentListProps,
}) => (
  <div className="bg-white rounded-2xl shadow-card">
    {/* Tab bar */}
    <div className="border-b border-gray-200 overflow-x-auto">
      <nav className="flex -mb-px whitespace-nowrap items-center" aria-label="Tabs">
        {TABS.map((tab, i) => {
          const prevGroup = TABS[i - 1]?.group;
          const showDivider = prevGroup && prevGroup !== tab.group;
          return (
            <React.Fragment key={tab.key}>
              {showDivider && (
                <span
                  className="shrink-0 w-px h-5 bg-gray-200 mx-1"
                  aria-hidden="true"
                />
              )}
              <button
                onClick={() => onTabChange(tab.key)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer shrink-0 ${
                  activeTab === tab.key
                    ? 'border-accent text-accent'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            </React.Fragment>
          );
        })}
      </nav>
    </div>

    {/* Tab content */}
    {activeTab === 'progress' && (
      <StudentProgressTab classroomId={classroomId} />
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
