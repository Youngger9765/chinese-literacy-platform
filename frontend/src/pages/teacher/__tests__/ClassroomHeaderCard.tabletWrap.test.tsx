/**
 * #3424: at tablet widths (768/1024, squeezed by the global nav + this
 * page's own sidebar both showing at once — see ClassroomDetail.tsx) the
 * name/badges row and the join-code/button row had no `flex-wrap`, so the
 * browser shrank the text boxes instead of wrapping the button group to a
 * new line. That produced mid-word breaks ("RWD審／查-1012") and, because
 * the join-code card has `overflow-hidden`, a clipped "重生代碼" button.
 *
 * jsdom doesn't compute layout, so these are contract tests on the
 * className strings rather than pixel assertions — they fail if the wrap
 * classes regress, which is the thing that actually caused the bug.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const classroom = {
  id: 1,
  name: 'RWD審查-1012',
  school_id: 1,
  teacher_id: 1,
  grade: 4,
  is_active: true,
  created_at: '2026-10-12T00:00:00Z',
  student_count: 5,
  students: [],
  join_code: 'D30SQW',
  school_name: '測試國小',
};

describe('ClassroomHeaderCard — tablet wrap safety (#3424)', () => {
  it('name/badges row wraps instead of squeezing the name box', () => {
    render(<ClassroomHeaderCard {...baseProps} classroom={classroom} />);
    const name = screen.getByText('RWD審查-1012');
    // Junyi-parity header: [name + pencil] and [班級代碼 group] sit in one row that wraps as a whole
    const row = name.closest('div')!.parentElement!;
    expect(row.className).toMatch(/\bflex-wrap\b/);
    expect(name.className).toMatch(/\bbreak-words\b/);
  });

  it('join-code button row wraps instead of being clipped by overflow-hidden', () => {
    // 0 students -> accordion starts expanded, so the button row is visible.
    render(<ClassroomHeaderCard {...baseProps} classroom={{ ...classroom, student_count: 0 }} />);
    const regenBtn = screen.getByRole('button', { name: /重生代碼/i });
    const buttonRow = regenBtn.closest('div')!;
    expect(buttonRow.className).toMatch(/\bflex-wrap\b/);
    expect(regenBtn.className).toMatch(/\bwhitespace-nowrap\b/);
  });
});
