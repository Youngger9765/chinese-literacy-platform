/**
 * Tests for SchoolDetailPanel refactor (Issue #1849)
 *
 * TDD contract:
 *  1. load school/classrooms/members populates info, classroom list, teacher list
 *  2. edit save trims optional fields + reloads detail
 *  3. regenerate/copy join code updates visible code + clipboard state
 *  4. teacher search excludes already-assigned school teachers
 *
 * Tests are written against the public behaviour observable from SchoolDetailPanel's
 * rendered output — they are agnostic to whether the internals are a monolith or
 * decomposed into sub-components.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

// --- Module mocks --------------------------------------------------------

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

const mockGetSchool = vi.fn();
const mockUpdateSchool = vi.fn();
const mockListSchoolClassrooms = vi.fn();
const mockListSchoolMembers = vi.fn();
const mockRegenerateSchoolCode = vi.fn();

vi.mock('../../../services/schoolApi', () => ({
  getSchool: (...args: unknown[]) => mockGetSchool(...args),
  updateSchool: (...args: unknown[]) => mockUpdateSchool(...args),
  listSchoolClassrooms: (...args: unknown[]) => mockListSchoolClassrooms(...args),
  listSchoolMembers: (...args: unknown[]) => mockListSchoolMembers(...args),
  regenerateSchoolCode: (...args: unknown[]) => mockRegenerateSchoolCode(...args),
  SchoolApiError: class SchoolApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'SchoolApiError';
      this.status = status;
    }
  },
}));

const mockCreateClassroomAdmin = vi.fn();
vi.mock('../../../services/classroomApi', () => ({
  createClassroomAdmin: (...args: unknown[]) => mockCreateClassroomAdmin(...args),
  ClassroomApiError: class ClassroomApiError extends Error {
    constructor(message: string) { super(message); this.name = 'ClassroomApiError'; }
  },
}));

const mockAssignRole = vi.fn();
vi.mock('../../../services/roleApi', () => ({
  assignRole: (...args: unknown[]) => mockAssignRole(...args),
  RoleApiError: class RoleApiError extends Error {
    constructor(message: string) { super(message); this.name = 'RoleApiError'; }
  },
}));

const mockListUsers = vi.fn();
vi.mock('../../../services/userApi', () => ({
  listUsers: (...args: unknown[]) => mockListUsers(...args),
}));

// SemesterPanel is not under test — stub it out
vi.mock('../SemesterPanel', () => ({
  default: () => <div data-testid="semester-panel">Semester Panel</div>,
}));

// --- Fixtures -----------------------------------------------------------

const SCHOOL = {
  id: 42,
  name: 'test-school-slug',
  display_name: '測試小學',
  organization_id: 'org-1',
  address: '台北市中正區',
  phone: '02-1234-5678',
  is_active: true,
  created_at: '2024-01-15T00:00:00Z',
};

const CLASSROOMS = [
  { id: 1, name: '五年一班', grade: 5, is_active: true, teacher_id: 10, teacher_name: '王老師', student_count: 30, created_at: '2024-02-01T00:00:00Z' },
  { id: 2, name: '五年二班', grade: 5, is_active: false, teacher_id: 11, teacher_name: '李老師', student_count: 28, created_at: '2024-02-01T00:00:00Z' },
];

const MEMBERS = [
  { user_id: 10, name: '王老師', email: 'wang@school.edu', role_name: 'teacher', role_display_name: '教師' },
  { user_id: 11, name: '李老師', email: 'li@school.edu', role_name: 'school_admin', role_display_name: '學校管理員' },
];

// --- Helpers ------------------------------------------------------------

async function renderPanel(schoolId = 42, onSelectClassroom?: (id: number) => void) {
  // Dynamic import to pick up mocks correctly
  const { default: SchoolDetailPanel } = await import('../SchoolDetailPanel');
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<SchoolDetailPanel schoolId={schoolId} onSelectClassroom={onSelectClassroom} />);
  });
  return result;
}

// ========================================================================

describe('SchoolDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSchool.mockResolvedValue(SCHOOL);
    mockListSchoolClassrooms.mockResolvedValue(CLASSROOMS);
    mockListSchoolMembers.mockResolvedValue(MEMBERS);
    mockListUsers.mockResolvedValue({ items: [], total: 0 });
    // Clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Test 1: Loading populates school info, classroom list, teacher list
  // -----------------------------------------------------------------------
  describe('load school/classrooms/members populates info, classroom list, teacher list', () => {
    it('shows school display name after data loads', async () => {
      await renderPanel();
      await waitFor(() => {
        expect(screen.getByText('測試小學')).toBeTruthy();
      });
    });

    it('shows school slug (name) as secondary label', async () => {
      await renderPanel();
      await waitFor(() => {
        expect(screen.getByText('test-school-slug')).toBeTruthy();
      });
    });

    it('renders classroom names in the classroom list', async () => {
      await renderPanel();
      await waitFor(() => {
        expect(screen.getAllByText('五年一班').length).toBeGreaterThan(0);
        expect(screen.getAllByText('五年二班').length).toBeGreaterThan(0);
      });
    });

    it('renders teacher names in the teacher section', async () => {
      await renderPanel();
      await waitFor(() => {
        expect(screen.getAllByText('王老師').length).toBeGreaterThan(0);
        expect(screen.getAllByText('李老師').length).toBeGreaterThan(0);
      });
    });

    it('calls getSchool, listSchoolClassrooms, and listSchoolMembers on mount', async () => {
      await renderPanel();
      await waitFor(() => {
        expect(mockGetSchool).toHaveBeenCalledWith('test-token', 42);
        expect(mockListSchoolClassrooms).toHaveBeenCalledWith('test-token', 42);
        expect(mockListSchoolMembers).toHaveBeenCalledWith('test-token', 42);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: Edit save trims optional fields + reloads detail
  // -----------------------------------------------------------------------
  describe('edit save trims optional fields + reloads detail', () => {
    it('enters edit mode and calls updateSchool with trimmed values', async () => {
      mockUpdateSchool.mockResolvedValue(undefined);

      await renderPanel();
      await waitFor(() => screen.getByText('測試小學'));

      // Find and click the "編輯" button in the school info section
      const editButtons = screen.getAllByRole('button', { name: '編輯' });
      await act(async () => {
        fireEvent.click(editButtons[0]);
      });

      // Clear the address field and type value with surrounding spaces
      const addressInput = screen.getByDisplayValue('台北市中正區') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(addressInput, { target: { value: '  新地址  ' } });
      });

      // Clear the phone field — empty optional field should become undefined
      const phoneInput = screen.getByDisplayValue('02-1234-5678') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(phoneInput, { target: { value: '' } });
      });

      // Submit the form via the 儲存 button
      const saveButton = screen.getByRole('button', { name: '儲存' });
      await act(async () => {
        fireEvent.click(saveButton);
      });

      await waitFor(() => {
        expect(mockUpdateSchool).toHaveBeenCalledWith(
          'test-token',
          42,
          expect.objectContaining({
            address: '新地址',   // trimmed
            phone: undefined,    // empty → undefined
          }),
        );
      });

      // After save, getSchool should be called again (detail reload)
      expect(mockGetSchool.mock.calls.length).toBeGreaterThan(1);
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: Regenerate / copy join code updates visible code + clipboard state
  // -----------------------------------------------------------------------
  describe('regenerate/copy join code updates visible code + clipboard state', () => {
    it('shows the join code after regenerating and marks it copied on click', async () => {
      const NEW_CODE = 'XYZ789';
      mockRegenerateSchoolCode.mockResolvedValue({ join_code: NEW_CODE });

      await renderPanel();
      await waitFor(() => screen.getByText('測試小學'));

      // Initially there is no join code displayed — click "產生代碼"
      const generateButton = screen.getByRole('button', { name: '產生代碼' });
      await act(async () => {
        fireEvent.click(generateButton);
      });

      await waitFor(() => {
        expect(screen.getByText(NEW_CODE)).toBeTruthy();
        expect(mockRegenerateSchoolCode).toHaveBeenCalledWith('test-token', 42);
      });

      // Now "複製" button should appear
      const copyButton = screen.getByRole('button', { name: '複製' });
      await act(async () => {
        fireEvent.click(copyButton);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '已複製' })).toBeTruthy();
      });
    });

    it('overwrites visible code when regenerating a second time', async () => {
      mockRegenerateSchoolCode
        .mockResolvedValueOnce({ join_code: 'FIRST1' })
        .mockResolvedValueOnce({ join_code: 'SECOND2' });

      await renderPanel();
      await waitFor(() => screen.getByText('測試小學'));

      // First generation
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '產生代碼' }));
      });
      await waitFor(() => screen.getByText('FIRST1'));

      // Second generation — "重新產生" button appears after first code is set
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '重新產生' }));
      });
      await waitFor(() => {
        expect(screen.getByText('SECOND2')).toBeTruthy();
        expect(screen.queryByText('FIRST1')).toBeNull();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: Teacher search excludes already-assigned school teachers
  //
  // The existing implementation uses a manual 300ms setTimeout for debounce.
  // We call the search by typing text with length >= 2, then wait (with real
  // timers) for the API call to resolve and results to appear.
  // -----------------------------------------------------------------------
  describe('teacher search excludes already-assigned school teachers', () => {
    it('filters out members already assigned to the school from search results', async () => {
      const ALL_USERS = [
        { id: 10, name: '王老師', email: 'wang@school.edu' },   // already assigned (user_id 10)
        { id: 99, name: '新老師', email: 'new@school.edu' },    // not yet assigned
      ];
      mockListUsers.mockResolvedValue({ items: ALL_USERS, total: 2 });

      await renderPanel();
      await waitFor(() => screen.getByText('測試小學'));

      // Open teacher search panel
      const assignButton = screen.getByRole('button', { name: '指派教師' });
      await act(async () => {
        fireEvent.click(assignButton);
      });

      // Type at least 2 characters to trigger search
      const searchInput = screen.getByPlaceholderText('輸入姓名或 email 搜尋...');
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: '老師' } });
      });

      // Wait for debounce (300ms) and API call
      await waitFor(() => {
        expect(mockListUsers).toHaveBeenCalled();
      }, { timeout: 2000 });

      // Wait for results to render
      await waitFor(() => {
        // 新老師 (id 99) is not assigned → should appear with a 指派 button
        expect(screen.getByRole('button', { name: '指派' })).toBeTruthy();
      }, { timeout: 2000 });

      // 王老師 (id 10) is already a member → must NOT have a 指派 button
      // (they appear in the teacher table but NOT in search results)
      const assignButtons = screen.getAllByRole('button', { name: '指派' });
      expect(assignButtons.length).toBe(1); // only 新老師 should be assignable
    }, 10000);
  });
});
