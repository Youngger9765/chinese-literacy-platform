/**
 * TDD tests for ClassroomTabs 2-group layout — Issue #1986
 *
 * Asserts:
 * 1. Two visual group rows exist (日常管理 / 進階分析)
 * 2. Tabs are assigned to correct groups
 * 3. Active tab persists when switching between group rows
 * 4. All 8 tabs are reachable
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClassroomTabs from '../ClassroomTabs';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../StudentProgressTab', () => ({ default: () => <div>StudentProgress</div> }));
vi.mock('../TextManagementTab', () => ({ default: () => <div>TextManagement</div> }));
vi.mock('../StudentListTab', () => ({ default: () => <div>StudentList</div> }));
vi.mock('../ClassroomAnalytics', () => ({ default: () => <div>Analytics</div> }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => <div>CrossText</div> }));
vi.mock('../../../components/teacher/AtRiskStudents', () => ({ default: () => <div>AtRisk</div> }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => <div>ErrorHeatmap</div> }));
vi.mock('../CoTeachingTab', () => ({ default: () => <div>CoTeaching</div> }));

// ── Helpers ────────────────────────────────────────────────────────────────────

const mockClassroom: ClassroomDetailResponse = {
  id: 1,
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
  classroomId: 1,
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ClassroomTabs — 2-group layout (#1986)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders two group label rows: 日常管理 and 進階分析', () => {
    render(<ClassroomTabs {...defaultProps} />);
    expect(screen.getByText('日常管理')).toBeInTheDocument();
    expect(screen.getByText('進階分析')).toBeInTheDocument();
  });

  it('places 日常管理 tabs (學生進度, 學生名單, 課文管理, 協同教師) in the first row', () => {
    render(<ClassroomTabs {...defaultProps} />);
    const coreGroup = screen.getByRole('group', { name: '日常管理' });
    expect(within(coreGroup).getByText('學生進度')).toBeInTheDocument();
    expect(within(coreGroup).getByText('學生名單')).toBeInTheDocument();
    expect(within(coreGroup).getByText('課文管理')).toBeInTheDocument();
    expect(within(coreGroup).getByText('協同教師')).toBeInTheDocument();
  });

  it('places 進階分析 tabs (學習分析, 跨課文分析, 早期介入, 錯字熱力圖) in the second row', () => {
    render(<ClassroomTabs {...defaultProps} />);
    const analysisGroup = screen.getByRole('group', { name: '進階分析' });
    expect(within(analysisGroup).getByText('學習分析')).toBeInTheDocument();
    expect(within(analysisGroup).getByText('跨課文分析')).toBeInTheDocument();
    expect(within(analysisGroup).getByText('早期介入')).toBeInTheDocument();
    expect(within(analysisGroup).getByText('錯字熱力圖')).toBeInTheDocument();
  });

  it('calls onTabChange when clicking a tab in the 日常管理 group', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<ClassroomTabs {...defaultProps} onTabChange={onTabChange} />);
    await user.click(screen.getByText('學生名單'));
    expect(onTabChange).toHaveBeenCalledWith('students');
  });

  it('calls onTabChange when clicking a tab in the 進階分析 group', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<ClassroomTabs {...defaultProps} onTabChange={onTabChange} />);
    await user.click(screen.getByText('跨課文分析'));
    expect(onTabChange).toHaveBeenCalledWith('cross-text');
  });

  it('active tab within 日常管理 group shows accent styling', () => {
    render(<ClassroomTabs {...defaultProps} activeTab="progress" />);
    const activeBtn = screen.getByRole('button', { name: '學生進度' });
    expect(activeBtn.className).toMatch(/border-accent/);
  });

  it('active tab within 進階分析 group shows accent styling', () => {
    render(<ClassroomTabs {...defaultProps} activeTab="analytics" />);
    const activeBtn = screen.getByRole('button', { name: '學習分析' });
    expect(activeBtn.className).toMatch(/border-accent/);
  });

  it('renders correct content panel for active tab', () => {
    render(<ClassroomTabs {...defaultProps} activeTab="cross-text" />);
    expect(screen.getByText('CrossText')).toBeInTheDocument();
  });
});
