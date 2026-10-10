/**
 * ClassroomTabs — Junyi-style three-tab rework (#3384, "盡量快抄 Junyi 老師班級頁").
 *
 * Replaces the #3367/#3376 four-tabs-plus-更多 layout with Junyi Academy's own
 * naming and grouping:
 *   班級設定 (class settings: header card + roster, passed in via `settingsContent`,
 *             plus co-teaching management rendered here)
 *   指派任務 (assignments: unchanged AssignmentsPanel)
 *   班級數據 (class data: a left-nav list aggregating what used to be 今日總覽/
 *             學生/早期介入/更多)
 *
 * Old ?tab= values must still resolve to one of the three canonical keys so
 * existing bookmarks/links in issues don't 404 or silently reset.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClassroomTabs, { TABS, resolveTabKey } from '../ClassroomTabs';

vi.mock('../CoTeachingTab', () => ({ default: () => <div>CoTeaching</div> }));
vi.mock('../panel/AssignmentsPanel', () => ({
  default: ({ selectedAssignmentId }: { selectedAssignmentId: number | null }) => (
    <div>Assignments:{String(selectedAssignmentId)}</div>
  ),
}));
vi.mock('../panel/ClassDataTab', () => ({
  default: ({ onSelectStudent }: { onSelectStudent: (id: number) => void }) => (
    <div>
      ClassDataTab
      <button onClick={() => onSelectStudent(9)}>open-student-9</button>
    </div>
  ),
}));

const props = {
  activeTab: 'settings' as const,
  onTabChange: vi.fn(),
  classroomId: 42,
  ownerId: 1,
  selectedAssignmentId: null,
  onSelectAssignment: vi.fn(),
  selectedStudentId: null,
  onSelectStudent: vi.fn(),
  settingsContent: <div>SettingsContent</div>,
};

describe('ClassroomTabs — Junyi three-tab layout (#3384)', () => {
  it('shows exactly the three Junyi-named tabs in order', () => {
    render(<ClassroomTabs {...props} />);
    const labels = screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label') ?? t.textContent);
    expect(labels).toEqual(['班級設定', '指派任務', '班級數據']);
    expect(TABS.map((t) => t.key)).toEqual(['settings', 'assignments', 'data']);
  });

  it('班級設定 renders the passed-in settings content plus co-teaching management', () => {
    render(<ClassroomTabs {...props} activeTab="settings" />);
    expect(screen.getByText('SettingsContent')).toBeInTheDocument();
    expect(screen.getByText('CoTeaching')).toBeInTheDocument();
  });

  it('指派任務 renders the assignment matrix panel unchanged', () => {
    render(<ClassroomTabs {...props} activeTab="assignments" selectedAssignmentId={7} />);
    expect(screen.getByText('Assignments:7')).toBeInTheDocument();
  });

  it('班級數據 renders the aggregated data left-nav tab', () => {
    render(<ClassroomTabs {...props} activeTab="data" />);
    expect(screen.getByText('ClassDataTab')).toBeInTheDocument();
  });

  it('clicking a tab reports its key', async () => {
    const onTabChange = vi.fn();
    render(<ClassroomTabs {...props} onTabChange={onTabChange} />);
    await userEvent.click(screen.getByRole('tab', { name: '班級數據' }));
    expect(onTabChange).toHaveBeenCalledWith('data');
  });

  it('selecting a student from 班級數據 bubbles up through onSelectStudent', async () => {
    const onSelectStudent = vi.fn();
    render(<ClassroomTabs {...props} activeTab="data" onSelectStudent={onSelectStudent} />);
    await userEvent.click(screen.getByText('open-student-9'));
    expect(onSelectStudent).toHaveBeenCalledWith(9);
  });

  it.each([
    // Everything that used to be its own tab or 更多 item now lives inside 班級數據.
    ['overview', 'data'],
    ['students', 'data'],
    ['at-risk', 'data'],
    ['error-heatmap', 'data'],
    ['analytics', 'data'],
    ['learning', 'data'],
    // 協同教師 moved under 班級設定.
    ['teachers', 'settings'],
    // 指派任務 keeps its own canonical key.
    ['assignments', 'assignments'],
    // Pre-#3367 legacy values must still resolve somewhere sane.
    ['progress', 'data'],
    ['live', 'data'],
    ['texts', 'assignments'],
    ['cross-text', 'data'],
    [null, 'settings'],
    ['nonsense', 'settings'],
  ])('resolves ?tab=%s to %s', (raw, expected) => {
    expect(resolveTabKey(raw)).toBe(expected);
  });
});
