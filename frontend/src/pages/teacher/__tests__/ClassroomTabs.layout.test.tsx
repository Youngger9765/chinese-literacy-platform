/**
 * ClassroomTabs — task-ordered single row (#3367).
 *
 * Replaces the #1986 two-row 日常管理/進階分析 layout. Locks:
 *  - the seven tabs, in the order teachers use them
 *  - old ?tab= keys still land somewhere sensible (bookmarks, links in issues)
 *  - 課堂即時 stays reachable: it moved into 今日總覽 as a card (#3025 rule —
 *    an entry point that disappears is a FAIL even if the view still renders)
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClassroomTabs, { TABS, MORE_TABS, resolveTabKey } from '../ClassroomTabs';

vi.mock('../StudentProgressTab', () => ({ default: () => <div>StudentProgress</div> }));
vi.mock('../ClassroomAnalytics', () => ({ default: () => <div>Analytics</div> }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => <div>CrossText</div> }));
vi.mock('../../../components/teacher/AtRiskStudents', () => ({ default: () => <div>AtRisk</div> }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => <div>ErrorHeatmap</div> }));
vi.mock('../CoTeachingTab', () => ({ default: () => <div>CoTeaching</div> }));
vi.mock('../panel/AssignmentsPanel', () => ({
  default: ({ selectedAssignmentId }: { selectedAssignmentId: number | null }) => (
    <div>Assignments:{String(selectedAssignmentId)}</div>
  ),
}));
vi.mock('../panel/StudentsPanel', () => ({ default: () => <div>StudentsPanel</div> }));
vi.mock('../panel/TodayOverviewTab', () => ({
  default: ({ onOpenAssignment }: { onOpenAssignment: (id: number) => void }) => (
    <button onClick={() => onOpenAssignment(7)}>open-7</button>
  ),
}));

const props = {
  activeTab: 'overview' as const,
  onTabChange: vi.fn(),
  classroomId: 42,
  ownerId: 1,
  selectedAssignmentId: null,
  onSelectAssignment: vi.fn(),
  selectedStudentId: null,
  onSelectStudent: vi.fn(),
};

describe('ClassroomTabs layout (#3367)', () => {
  it('shows four daily tabs plus 更多 (#3376: keep it simple)', () => {
    render(<ClassroomTabs {...props} />);
    const labels = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(labels).toEqual(['今日總覽', '作業', '學生', '早期介入', '更多']);
    expect(TABS).toHaveLength(4);
    expect(MORE_TABS.map((t) => t.label)).toEqual(['錯字總表', '學習分析', '詳細學習紀錄', '協同教師']);
  });

  it('更多 opens the less-used views behind one tab', async () => {
    const onTabChange = vi.fn();
    render(<ClassroomTabs {...props} onTabChange={onTabChange} />);
    await userEvent.click(screen.getByRole('tab', { name: '更多' }));
    expect(onTabChange).toHaveBeenCalledWith('error-heatmap');
  });

  it('a 更多 view keeps 更多 highlighted and shows its sub-menu', () => {
    render(<ClassroomTabs {...props} activeTab="analytics" />);
    expect(screen.getByRole('tab', { name: '更多' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '學習分析' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['progress', 'learning'],
    ['live', 'overview'],
    ['students', 'students'],
    ['texts', 'assignments'],
    ['cross-text', 'analytics'],
    ['at-risk', 'at-risk'],
    [null, 'overview'],
    ['nonsense', 'overview'],
  ])('resolves ?tab=%s to %s', (raw, expected) => {
    expect(resolveTabKey(raw)).toBe(expected);
  });

  it('opening an assignment from 今日總覽 selects it and switches to 作業', async () => {
    const onTabChange = vi.fn();
    const onSelectAssignment = vi.fn();
    render(<ClassroomTabs {...props} onTabChange={onTabChange} onSelectAssignment={onSelectAssignment} />);
    await userEvent.click(screen.getByText('open-7'));
    expect(onSelectAssignment).toHaveBeenCalledWith(7);
    // One URL update only: a second onTabChange rebuilt the URL from stale params
    // and dropped ?assignment= (#3376 audit). onSelectAssignment switches the tab itself.
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('clicking a tab reports its key', async () => {
    const onTabChange = vi.fn();
    render(<ClassroomTabs {...props} onTabChange={onTabChange} />);
    await userEvent.click(screen.getByRole('tab', { name: '早期介入' }));
    expect(onTabChange).toHaveBeenCalledWith('at-risk');
  });
});
