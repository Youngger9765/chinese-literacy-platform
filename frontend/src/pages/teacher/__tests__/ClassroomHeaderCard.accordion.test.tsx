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

describe('ClassroomHeaderCard — join code accordion (#1987)', () => {
  it('1. collapsed by default when classroom has ≥1 student', () => {
    render(<ClassroomHeaderCard {...baseProps} classroom={classroomWithStudents} />);
    // Panel should be hidden (aria-hidden="true")
    const panel = document.getElementById('join-code-panel');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    // Toggle button should be aria-expanded=false
    const toggleBtn = screen.getByRole('button', { name: /加入代碼/i });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('2. expanded by default when classroom has 0 students', () => {
    render(<ClassroomHeaderCard {...baseProps} classroom={classroomNoStudents} />);
    // Join code should be visible
    expect(screen.getByText('LMC2PA')).toBeInTheDocument();
    const codeText = screen.getByText('LMC2PA');
    // Should NOT be hidden
    const hiddenPanel = codeText.closest('[aria-hidden="true"], [hidden]');
    expect(hiddenPanel).toBeNull();
  });

  it('3. clicking the toggle button expands the collapsed panel', () => {
    render(<ClassroomHeaderCard {...baseProps} classroom={classroomWithStudents} />);
    // Find the accordion toggle button for join code
    const toggleBtn = screen.getByRole('button', { name: /加入代碼/i });
    fireEvent.click(toggleBtn);
    // After click, code should be visible
    expect(screen.getByText('LMC2PA')).toBeInTheDocument();
    const codeText = screen.getByText('LMC2PA');
    const hiddenPanel = codeText.closest('[aria-hidden="true"], [hidden]');
    expect(hiddenPanel).toBeNull();
  });

  it('4. clicking toggle again collapses the expanded panel', () => {
    render(<ClassroomHeaderCard {...baseProps} classroom={classroomNoStudents} />);
    // Initially expanded (0 students) → aria-hidden="false"
    const panel = document.getElementById('join-code-panel');
    expect(panel?.getAttribute('aria-hidden')).toBe('false');
    const toggleBtn = screen.getByRole('button', { name: /加入代碼/i });
    fireEvent.click(toggleBtn);
    // After collapse → aria-hidden="true"
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('5. toggle button has correct aria-expanded state', () => {
    render(<ClassroomHeaderCard {...baseProps} classroom={classroomWithStudents} />);
    const toggleBtn = screen.getByRole('button', { name: /加入代碼/i });
    // Initially collapsed → aria-expanded="false"
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggleBtn);
    // After expand → aria-expanded="true"
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('6. copy and regen buttons are accessible when expanded', () => {
    render(<ClassroomHeaderCard {...baseProps} classroom={classroomWithStudents} />);
    const toggleBtn = screen.getByRole('button', { name: /加入代碼/i });
    fireEvent.click(toggleBtn);
    expect(screen.getByRole('button', { name: /複製代碼/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重生代碼/i })).toBeInTheDocument();
  });
});
