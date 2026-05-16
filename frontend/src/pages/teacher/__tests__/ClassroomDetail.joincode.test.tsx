/**
 * Tests for ClassroomDetail join_code UI — Issue #1643
 * Verifies:
 *  1. join_code is rendered prominently in monospace
 *  2. 複製代碼 button triggers clipboard.writeText
 *  3. 重生代碼 button shows confirm dialog before calling API
 *  4. After confirm, regenerateClassroomCode is called and UI updates
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClassroomDetail from '../ClassroomDetail';
import * as classroomApi from '../../../services/classroomApi';

// --- Mocks ---

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1, role: 'teacher' } }),
}));

// Mock all classroomApi calls we depend on
vi.mock('../../../services/classroomApi', () => ({
  getClassroomDetail: vi.fn(),
  updateClassroom: vi.fn(),
  addStudent: vi.fn(),
  removeStudent: vi.fn(),
  exportClassroomReport: vi.fn(),
  regenerateClassroomCode: vi.fn(),
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ClassroomApiError';
      this.status = status;
    }
  },
}));

// Stub child tabs to avoid deep render
vi.mock('../StudentProgressTab', () => ({ default: () => <div data-testid="student-progress-tab" /> }));
vi.mock('../TextManagementTab', () => ({ default: () => <div data-testid="text-management-tab" /> }));
vi.mock('../StudentListTab', () => ({ default: () => <div data-testid="student-list-tab" /> }));
vi.mock('../ClassroomAnalytics', () => ({ default: () => <div data-testid="classroom-analytics" /> }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => <div data-testid="cross-text-analytics" /> }));
vi.mock('../../components/teacher/AtRiskStudents', () => ({ default: () => <div data-testid="at-risk-students" /> }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => <div data-testid="error-heatmap-tab" /> }));
vi.mock('../CoTeachingTab', () => ({ default: () => <div data-testid="co-teaching-tab" /> }));

const MOCK_CLASSROOM = {
  id: 42,
  name: '三年甲班',
  school_id: 1,
  teacher_id: 1,
  grade: 3,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  student_count: 5,
  students: [],
  join_code: 'ABC123',
  school_name: '測試國小',
};

function renderDetail() {
  return render(<ClassroomDetail classroomId={42} onBack={vi.fn()} />);
}

describe('ClassroomDetail — join_code UI (#1643)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: getClassroomDetail resolves with join_code
    vi.mocked(classroomApi.getClassroomDetail).mockResolvedValue(MOCK_CLASSROOM);

    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. renders join_code prominently in the classroom info card', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });
    // Should be in a monospace or code-like element
    const codeEl = screen.getByText('ABC123');
    expect(codeEl.tagName.toLowerCase()).toMatch(/^(code|span|p|div)$/);
  });

  it('2. 複製代碼 button calls clipboard.writeText with the join_code', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    const copyBtn = screen.getByRole('button', { name: /複製代碼/i });
    await userEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC123');
  });

  it('3. 重生代碼 button shows a confirm dialog before calling the API', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    const regenBtn = screen.getByRole('button', { name: /重生代碼/i });
    await userEvent.click(regenBtn);

    // Confirm dialog should appear
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // API must NOT be called yet
    expect(classroomApi.regenerateClassroomCode).not.toHaveBeenCalled();
  });

  it('4. cancelling the confirm dialog does not call regenerateClassroomCode', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /重生代碼/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Cancel
    await userEvent.click(screen.getByRole('button', { name: /取消/i }));
    expect(classroomApi.regenerateClassroomCode).not.toHaveBeenCalled();

    // Dialog should disappear
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('5. confirming the dialog calls regenerateClassroomCode and updates displayed code', async () => {
    vi.mocked(classroomApi.regenerateClassroomCode).mockResolvedValue({ join_code: 'XYZ789' });
    // After regen, re-fetch returns the updated classroom
    vi.mocked(classroomApi.getClassroomDetail)
      .mockResolvedValueOnce(MOCK_CLASSROOM)         // initial load
      .mockResolvedValueOnce({ ...MOCK_CLASSROOM, join_code: 'XYZ789' }); // after regen

    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /重生代碼/i }));
    await userEvent.click(screen.getByRole('button', { name: /確定/i }));

    await waitFor(() => {
      expect(classroomApi.regenerateClassroomCode).toHaveBeenCalledWith('test-token', 42);
    });

    // UI updates with new code
    await waitFor(() => {
      expect(screen.getByText('XYZ789')).toBeInTheDocument();
    });
  });

  it('6. renders help text below the join_code', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });

    expect(screen.getByText(/把此代碼給學生/i)).toBeInTheDocument();
  });

  it('7. classroom with null join_code still renders the section (no code yet)', async () => {
    vi.mocked(classroomApi.getClassroomDetail).mockResolvedValue({
      ...MOCK_CLASSROOM,
      join_code: null,
    });

    renderDetail();
    await waitFor(() => {
      expect(screen.queryByText('三年甲班')).toBeInTheDocument();
    });

    // The section header should still appear
    expect(screen.getByText(/加入代碼/i)).toBeInTheDocument();
    // Show a placeholder or "—" for null code
    expect(screen.getByText(/—|尚未產生/i)).toBeInTheDocument();
  });
});
