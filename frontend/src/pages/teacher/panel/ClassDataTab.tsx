import React, { useEffect, useState } from 'react';
import AtRiskStudents from '../../../components/teacher/AtRiskStudents';
import ClassroomAnalytics from '../ClassroomAnalytics';
import CrossTextAnalytics from '../CrossTextAnalytics';
import ErrorHeatmapTab from '../ErrorHeatmapTab';
import StudentProgressTab from '../StudentProgressTab';
import TodayOverviewTab from './TodayOverviewTab';
import StudentsPanel from './StudentsPanel';

type DataView = 'today' | 'students' | 'at-risk' | 'error-heatmap' | 'analytics' | 'learning';

interface ClassDataTabProps {
  classroomId: number;
  selectedStudentId: number | null;
  onSelectStudent: (id: number | null) => void;
  onSelectAssignment: (id: number | null) => void;
  initialView?: string;
  onViewChange?: (view: string) => void;
}

const DATA_VIEWS: { key: DataView; label: string }[] = [
  { key: 'today', label: '今日總覽' },
  { key: 'students', label: '學生總表' },
  { key: 'at-risk', label: '早期介入' },
  { key: 'error-heatmap', label: '錯字總表' },
  { key: 'analytics', label: '學習分析' },
  { key: 'learning', label: '詳細學習紀錄' },
];

const ClassDataTab: React.FC<ClassDataTabProps> = ({
  classroomId,
  selectedStudentId,
  onSelectStudent,
  onSelectAssignment,
  initialView,
  onViewChange,
}) => {
  const [view, setView] = useState<DataView>((initialView as DataView | undefined) ?? 'today');
  const changeView = (nextView: DataView) => {
    setView(nextView);
    onViewChange?.(nextView);
  };

  useEffect(() => {
    if (selectedStudentId !== null && view !== 'students') {
      setView('students');
      onViewChange?.('students');
    }
  }, [selectedStudentId, view, onViewChange]);

  const renderContent = () => {
    switch (view) {
      case 'today':
        return (
          <TodayOverviewTab
            classroomId={classroomId}
            onOpenAssignment={onSelectAssignment}
            onOpenAtRisk={() => changeView('at-risk')}
          />
        );
      case 'students':
        return (
          <StudentsPanel
            classroomId={classroomId}
            selectedStudentId={selectedStudentId}
            onSelectStudent={onSelectStudent}
          />
        );
      case 'at-risk':
        return <AtRiskStudents classroomId={classroomId} />;
      case 'error-heatmap':
        return <ErrorHeatmapTab classroomId={classroomId} />;
      case 'analytics':
        return (
          <div className="divide-y divide-gray-100">
            <ClassroomAnalytics classroomId={classroomId} />
            <CrossTextAnalytics classroomId={classroomId} />
          </div>
        );
      case 'learning':
        return <StudentProgressTab classroomId={classroomId} />;
    }
  };

  return (
    <div className="flex flex-col sm:flex-row">
      <nav
        aria-label="班級數據項目"
        className="flex sm:w-48 sm:shrink-0 gap-2 overflow-x-auto border-b sm:border-b-0 sm:border-r border-gray-200 p-4 sm:flex-col"
      >
        {DATA_VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-current={view === item.key ? 'page' : undefined}
            onClick={() => changeView(item.key)}
            className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
              view === item.key ? 'bg-accent-bg text-accent font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{renderContent()}</div>
    </div>
  );
};

export type { ClassDataTabProps, DataView };
export default ClassDataTab;
