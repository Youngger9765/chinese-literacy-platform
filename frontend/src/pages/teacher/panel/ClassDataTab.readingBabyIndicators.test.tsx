/**
 * #3780 第三階段：老師從「班級數據」側欄點得到「能力指標」，不是只能直接打網址。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClassDataTab from './ClassDataTab';

vi.mock('../../../components/teacher/AtRiskStudents', () => ({ default: () => null }));
vi.mock('../ClassroomAnalytics', () => ({ default: () => null }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => null }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => null }));
vi.mock('../StudentProgressTab', () => ({ default: () => null }));
vi.mock('./TodayOverviewTab', () => ({ default: () => null }));
vi.mock('./StudentsPanel', () => ({ default: () => null }));
vi.mock('./ReadingBabyIndicatorsPanel', () => ({
  default: ({ classroomId }: { classroomId: number }) => <div data-testid="indicators-panel">{classroomId}</div>,
}));

describe('ClassDataTab — 能力指標 entry (#3780)', () => {
  it('lists 能力指標 in the 班級數據 menu and opens the panel for this classroom', () => {
    const onViewChange = vi.fn();
    render(
      <ClassDataTab
        classroomId={9}
        selectedStudentId={null}
        onSelectStudent={vi.fn()}
        onSelectAssignment={vi.fn()}
        onViewChange={onViewChange}
      />,
    );
    const nav = screen.getByRole('navigation', { name: '班級數據項目' });
    const entry = Array.from(nav.querySelectorAll('button')).find((b) => b.textContent === '能力指標');
    expect(entry).toBeTruthy();
    fireEvent.click(entry!);
    expect(screen.getByTestId('indicators-panel')).toHaveTextContent('9');
    expect(onViewChange).toHaveBeenCalledWith('ability');
  });
});
