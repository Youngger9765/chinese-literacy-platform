/**
 * StudentProgressCard — "以學生身分預覽" button wiring (Issue #3027).
 *
 * This is the mobile-card half of the reachable entry point (the desktop
 * table row has its own inline button in StudentProgressTab.tsx). Locks:
 *  - clicking 預覽 calls onPreview with the RIGHT student, not onExpand
 *    (the card's whole surface is also a click target that expands the row —
 *    a missing stopPropagation would fire both)
 *  - the loading state disables the button so a slow mint call can't be
 *    double-fired by an impatient click
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StudentProgressCard } from '../StudentProgressCard';
import type { StudentProgress } from '../../../../services/teacherApi';

const student: StudentProgress = {
  student_id: 6,
  student_name: '小美',
  last_session_date: '2026-05-13T00:00:00Z',
  last_text_title: 'L02',
  total_sessions: 2,
  tags: [],
};

describe('StudentProgressCard preview button (#3027)', () => {
  it('calls onPreview with this student, not onExpand, when 預覽 is clicked', () => {
    const onPreview = vi.fn();
    const onExpand = vi.fn();

    render(
      <StudentProgressCard
        student={student}
        isExpanded={false}
        instructionCount={0}
        onExpand={onExpand}
        onTagManager={vi.fn()}
        onInstruction={vi.fn()}
        onPreview={onPreview}
        isPreviewLoading={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /預覽/ }));

    expect(onPreview).toHaveBeenCalledWith(student);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('disables the button while a preview mint is in flight', () => {
    render(
      <StudentProgressCard
        student={student}
        isExpanded={false}
        instructionCount={0}
        onExpand={vi.fn()}
        onTagManager={vi.fn()}
        onInstruction={vi.fn()}
        onPreview={vi.fn()}
        isPreviewLoading
      />
    );

    expect(screen.getByRole('button', { name: /載入中/ })).toBeDisabled();
  });
});
