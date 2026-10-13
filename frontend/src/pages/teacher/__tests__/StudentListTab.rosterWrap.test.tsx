/**
 * #3424: roster row action labels (家長邀請碼／重設密碼／移除) had no
 * `flex-wrap`/`whitespace-nowrap`, so at tablet widths they wrapped
 * mid-word ("家長邀／請碼"), and 移除 sat 12px from 重設密碼 with no visual
 * separation -- easy to mis-tap on a touch device.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StudentListTab from '../StudentListTab';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/classroomApi')>(
    '../../../services/classroomApi',
  );
  return { ...actual, resetStudentPassword: vi.fn() };
});
vi.mock('../../../services/parentApi', () => ({ generateParentInviteCode: vi.fn() }));
vi.mock('../CsvUploadModal', () => ({ default: () => null }));

const classroom: ClassroomDetailResponse = {
  id: 1,
  name: '測試班',
  school_id: 1,
  teacher_id: 1,
  grade: 4,
  is_active: true,
  created_at: '2026-10-12T00:00:00Z',
  student_count: 1,
  students: [
    { id: 11, name: '王小華', email: 'd30sqw1@student.lingoleap.local', enrolled_at: '2026-10-12T00:00:00Z' },
  ],
};

const baseProps = {
  classroom,
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
  isAddStudentsOpen: false,
  onCloseAddStudents: vi.fn(),
  onOpenAddStudents: vi.fn(),
};

describe('StudentListTab — roster row wrap safety (#3424)', () => {
  it('the actions row wraps instead of squeezing labels mid-word', () => {
    render(<StudentListTab {...baseProps} />);
    const removeBtn = screen.getByRole('button', { name: '移除' });
    // Junyi-parity table: on phones each row is a wrapping flex card, a table row from sm up
    const row = removeBtn.closest('tr')!;
    expect(row.className).toMatch(/\bflex-wrap\b/);
    // Table layout only from lg (1024px): at 768 the six columns squeezed names and
    // accounts into one-character lines and clipped 移除, so tablets get the card rows.
    expect(row.className).toMatch(/\blg:table-row\b/);
    expect(row.className).not.toMatch(/\bsm:table-row\b/);
  });

  it('每個動作標籤都有 whitespace-nowrap，不會斷字', () => {
    render(<StudentListTab {...baseProps} />);
    expect(screen.getByRole('button', { name: '家長邀請碼' }).closest('.whitespace-nowrap')).not.toBeNull();
    expect(screen.getByRole('button', { name: '重設密碼' }).closest('.whitespace-nowrap')).not.toBeNull();
    expect(screen.getByRole('button', { name: '移除' }).className).toMatch(/whitespace-nowrap/);
  });

  it('移除在自己的欄位、跟重設密碼分開，降低誤觸風險', () => {
    render(<StudentListTab {...baseProps} />);
    const removeCell = screen.getByRole('button', { name: '移除' }).closest('td')!;
    const resetCell = screen.getByRole('button', { name: '重設密碼' }).closest('td')!;
    expect(removeCell).not.toBe(resetCell);
    expect(removeCell.className).toMatch(/\bml-auto\b/);
  });

  it('新增學生 form is not inline; it opens in a dialog when asked', () => {
    const { rerender } = render(<StudentListTab {...baseProps} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<StudentListTab {...baseProps} isAddStudentsOpen />);
    expect(screen.getByRole('dialog', { name: '新增學生' })).toBeInTheDocument();
  });
});
