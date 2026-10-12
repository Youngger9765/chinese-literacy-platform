/**
 * #3424: 390 寬下「班級數據」子分頁列是橫向捲動但沒有提示，「錯字總表」被
 * 切一半、「學習分析」「詳細學習紀錄」在畫面外。補上跟 AssignmentMatrixGrid
 * 一樣的「← 左右滑動看更多 →」提示（只在 <sm 顯示）。
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClassDataTab from './ClassDataTab';

vi.mock('../../../components/teacher/AtRiskStudents', () => ({ default: () => null }));
vi.mock('../ClassroomAnalytics', () => ({ default: () => null }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => null }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => null }));
vi.mock('../StudentProgressTab', () => ({ default: () => null }));
vi.mock('./TodayOverviewTab', () => ({ default: () => null }));
vi.mock('./StudentsPanel', () => ({ default: () => null }));

describe('ClassDataTab — mobile scroll hint for sub-tabs (#3424)', () => {
  it('shows a sm:hidden "左右滑動" hint above the sub-tab nav', () => {
    render(
      <ClassDataTab
        classroomId={9}
        selectedStudentId={null}
        onSelectStudent={vi.fn()}
        onSelectAssignment={vi.fn()}
      />,
    );
    const hint = screen.getByText('← 左右滑動看更多 →');
    expect(hint.className).toMatch(/\bsm:hidden\b/);
  });

  it('the hint appears before the sub-tab nav so it reads as guidance for it', () => {
    const { container } = render(
      <ClassDataTab
        classroomId={9}
        selectedStudentId={null}
        onSelectStudent={vi.fn()}
        onSelectAssignment={vi.fn()}
      />,
    );
    const hint = screen.getByText('← 左右滑動看更多 →');
    const nav = container.querySelector('nav[aria-label="班級數據項目"]');
    expect(nav).not.toBeNull();
    // hint comes before nav in document order
    expect(hint.compareDocumentPosition(nav!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
