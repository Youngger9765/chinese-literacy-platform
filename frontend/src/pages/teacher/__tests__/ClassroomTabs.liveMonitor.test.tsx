/**
 * ClassroomTabs — 課堂即時 tab reachability (Issue #3025).
 *
 * A backend endpoint with no reachable entry point is a FAIL even if the
 * page itself renders correctly (see git-issue-pr-flow QA discipline) — so
 * this locks the actual navigation wiring, not just that LiveMonitorTab
 * renders in isolation:
 *  - the tab button exists in the 日常管理 (daily-management) group, since
 *    this is a during-class tool, not a post-hoc analysis tool
 *  - clicking it fires onTabChange('live')
 *  - activeTab === 'live' renders LiveMonitorTab with the right classroomId
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClassroomTabs from '../ClassroomTabs';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

vi.mock('../StudentProgressTab', () => ({ default: () => <div>StudentProgress</div> }));
vi.mock('../TextManagementTab', () => ({ default: () => <div>TextManagement</div> }));
vi.mock('../StudentListTab', () => ({ default: () => <div>StudentList</div> }));
vi.mock('../ClassroomAnalytics', () => ({ default: () => <div>Analytics</div> }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => <div>CrossText</div> }));
vi.mock('../../../components/teacher/AtRiskStudents', () => ({ default: () => <div>AtRisk</div> }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => <div>ErrorHeatmap</div> }));
vi.mock('../CoTeachingTab', () => ({ default: () => <div>CoTeaching</div> }));
vi.mock('../LiveMonitorTab', () => ({
  default: ({ classroomId }: { classroomId: number }) => <div>LiveMonitor:{classroomId}</div>,
}));

const mockClassroom: ClassroomDetailResponse = {
  id: 42,
  name: '五年一班',
  grade: 5,
  teacher_id: 1,
  is_active: true,
  join_code: 'ABC123',
  created_at: '2026-01-01T00:00:00Z',
  students: [],
};

const defaultProps = {
  activeTab: 'progress' as const,
  onTabChange: vi.fn(),
  classroomId: 42,
  classroom: mockClassroom,
  studentListProps: {
    token: 'test-token',
    studentIdInput: '',
    setStudentIdInput: vi.fn(),
    isAddingStudent: false,
    addStudentError: '',
    setAddStudentError: vi.fn(),
    onAddStudent: vi.fn(),
    removingStudentId: null,
    onRemoveStudent: vi.fn(),
    setRemovingStudentId: vi.fn(),
    formatDate: (s: string) => s,
    onStudentsImported: vi.fn(),
  },
};

describe('ClassroomTabs — 課堂即時 reachability (#3025)', () => {
  it('places 課堂即時 in the 日常管理 (daily-management) group, not 進階分析', () => {
    render(<ClassroomTabs {...defaultProps} />);
    const coreGroup = screen.getByRole('group', { name: '日常管理' });
    expect(within(coreGroup).getByText('課堂即時')).toBeInTheDocument();

    const analysisGroup = screen.getByRole('group', { name: '進階分析' });
    expect(within(analysisGroup).queryByText('課堂即時')).not.toBeInTheDocument();
  });

  it('clicking 課堂即時 calls onTabChange("live")', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<ClassroomTabs {...defaultProps} onTabChange={onTabChange} />);
    await user.click(screen.getByText('課堂即時'));
    expect(onTabChange).toHaveBeenCalledWith('live');
  });

  it('renders LiveMonitorTab with this classroom id when activeTab is "live"', () => {
    render(<ClassroomTabs {...defaultProps} activeTab="live" />);
    expect(screen.getByText('LiveMonitor:42')).toBeInTheDocument();
  });
});
