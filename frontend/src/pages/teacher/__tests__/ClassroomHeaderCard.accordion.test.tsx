/**
 * Tests for ClassroomHeaderCard join code accordion — Issue #1987
 * Verifies:
 *  1. Join code panel is collapsed by default when classroom has ≥1 student
 *  2. Join code panel is expanded by default when classroom has 0 students
 *  3. Clicking the toggle header expands the collapsed panel
 *  4. Clicking the toggle header collapses the expanded panel
 *  5. Join code content is not visible when collapsed (aria-hidden or hidden)
 *  6. Copy and regen buttons are accessible when expanded
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClassroomHeaderCard from '../ClassroomHeaderCard';

const baseProps = {
  isEditing: false,
  editName: '',
  editGrade: '',
  isSaving: false,
  editError: '',
  onStartEditing: vi.fn(),
  onCancelEditing: vi.fn(),
  onEditNameChange: vi.fn(),
  onEditGradeChange: vi.fn(),
  onSaveEdit: vi.fn(),
  isTogglingActive: false,
  onToggleActive: vi.fn(),
  isExporting: false,
  onExportCsv: vi.fn(),
  isDeleting: false,
  showDeleteConfirm: false,
  onShowDeleteConfirm: vi.fn(),
  onHideDeleteConfirm: vi.fn(),
  onDeleteClassroom: vi.fn(),
  isCopied: false,
  showRegenConfirm: false,
  isRegenerating: false,
  onCopyJoinCode: vi.fn(),
  onShowRegenConfirm: vi.fn(),
  onHideRegenConfirm: vi.fn(),
  onRegenerateCode: vi.fn(),
  formatDate: (s: string) => s,
};

const classroomWithStudents = {
  id: 1,
  name: '三年甲班',
  school_id: 1,
  teacher_id: 1,
  grade: 3,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  student_count: 5,
  students: [],
  join_code: 'LMC2PA',
  school_name: '測試國小',
};

const classroomNoStudents = {
  ...classroomWithStudents,
  student_count: 0,
};

// The 加入代碼 accordion (#1987) was replaced by the Junyi-parity header, where
// 班級代碼 sits in the title row and is always visible — the accordion hid the
// one thing a teacher reads out to the class.
describe('ClassroomHeaderCard — 班級代碼 in the title row (Junyi parity)', () => {
  it.each([
    ['with students', classroomWithStudents],
    ['without students', classroomNoStudents],
  ])('code, copy and regenerate are visible without any toggle (%s)', (_label, c) => {
    render(<ClassroomHeaderCard {...baseProps} classroom={c} />);
    const code = screen.getByText('LMC2PA');
    expect(code.closest('[aria-hidden="true"], [hidden]')).toBeNull();
    expect(screen.getByRole('button', { name: /複製代碼/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重生代碼/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /加入代碼/ })).toBeNull();
  });

  it('copy and regenerate call their handlers', () => {
    const onCopyJoinCode = vi.fn();
    const onShowRegenConfirm = vi.fn();
    render(
      <ClassroomHeaderCard
        {...baseProps}
        classroom={classroomWithStudents}
        onCopyJoinCode={onCopyJoinCode}
        onShowRegenConfirm={onShowRegenConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /複製代碼/ }));
    fireEvent.click(screen.getByRole('button', { name: /重生代碼/ }));
    expect(onCopyJoinCode).toHaveBeenCalledTimes(1);
    expect(onShowRegenConfirm).toHaveBeenCalledTimes(1);
  });

  it('新增學生 tile calls onAddStudents; the pencil starts editing', () => {
    const onAddStudents = vi.fn();
    const onStartEditing = vi.fn();
    render(
      <ClassroomHeaderCard
        {...baseProps}
        classroom={classroomWithStudents}
        onAddStudents={onAddStudents}
        onStartEditing={onStartEditing}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /新增學生/ }));
    fireEvent.click(screen.getByRole('button', { name: /編輯班級名稱/ }));
    expect(onAddStudents).toHaveBeenCalledTimes(1);
    expect(onStartEditing).toHaveBeenCalledTimes(1);
  });
});
