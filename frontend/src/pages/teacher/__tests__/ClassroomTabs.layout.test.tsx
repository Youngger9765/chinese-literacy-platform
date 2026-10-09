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
import ClassroomTabs, { TABS, resolveTabKey } from '../ClassroomTabs';

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
};

describe('ClassroomTabs layout (#3367)', () => {
  it('shows the seven task-ordered tabs in one row', () => {
    render(<ClassroomTabs {...props} />);
    const labels = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(labels).toEqual(['今日總覽', '作業', '學生學習紀錄', '早期介入', '錯字總表', '學習分析', '協同教師']);
    expect(TABS).toHaveLength(7);
  });

  it('no longer has a separate 學生名單 / 課文管理 / 課堂即時 tab', () => {
    render(<ClassroomTabs {...props} />);
    for (const gone of ['學生名單', '課文管理', '課堂即時', '跨課文分析']) {
      expect(screen.queryByRole('tab', { name: gone })).not.toBeInTheDocument();
    }
  });

  it.each([
    ['progress', 'learning'],
    ['live', 'overview'],
    ['students', 'overview'],
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
    expect(onTabChange).toHaveBeenCalledWith('assignments');
  });

  it('clicking a tab reports its key', async () => {
    const onTabChange = vi.fn();
    render(<ClassroomTabs {...props} onTabChange={onTabChange} />);
    await userEvent.click(screen.getByRole('tab', { name: '早期介入' }));
    expect(onTabChange).toHaveBeenCalledWith('at-risk');
  });
});
