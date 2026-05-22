/**
 * TDD tests for ClassroomDetailPanel refactor (Issue #1850)
 *
 * Tests document BEHAVIOUR of ClassroomDetailPanel before refactoring so the
 * same tests must pass after extraction of sub-components.
 *
 * Test scope (from issue acceptance criteria):
 *   1. batch input parser maps `name seat_number` lines + ignores blanks
 *   2. add student removes result row + reloads classroom
 *   3. remove student requires confirm state then reloads
 *   4. CSV credentials export includes BOM + expected columns
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ClassroomDetailPanel from '../ClassroomDetailPanel';

// ── Auth mock ──────────────────────────────────────────────────────────────
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

// ── API mocks ──────────────────────────────────────────────────────────────
const mockGetClassroomDetail = vi.fn();
const mockUpdateClassroom = vi.fn();
const mockAddStudent = vi.fn();
const mockRemoveStudent = vi.fn();
const mockRegenerateClassroomCode = vi.fn();
const mockSearchStudentsForClassroom = vi.fn();
const mockBatchCreateStudents = vi.fn();

vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/classroomApi')>(
    '../../../services/classroomApi',
  );
  return {
    ...actual,
    getClassroomDetail: (...args: unknown[]) => mockGetClassroomDetail(...args),
    updateClassroom: (...args: unknown[]) => mockUpdateClassroom(...args),
    addStudent: (...args: unknown[]) => mockAddStudent(...args),
    removeStudent: (...args: unknown[]) => mockRemoveStudent(...args),
    regenerateClassroomCode: (...args: unknown[]) => mockRegenerateClassroomCode(...args),
    searchStudentsForClassroom: (...args: unknown[]) => mockSearchStudentsForClassroom(...args),
    batchCreateStudents: (...args: unknown[]) => mockBatchCreateStudents(...args),
  };
});

vi.mock('../../../services/adminSeedApi', () => ({
  seedDemoStudents: vi.fn(),
  AdminSeedApiError: class AdminSeedApiError extends Error {},
}));

// ── URL mock (jsdom does not implement createObjectURL) ────────────────────
const mockRevokeObjectURL = vi.fn();
beforeEach(() => {
  global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = mockRevokeObjectURL;
});

// ── Fixtures ───────────────────────────────────────────────────────────────
const BASE_CLASSROOM = {
  id: 1,
  name: '五年甲班',
  school_id: 10,
  school_name: '測試國小',
  teacher_id: 5,
  grade: 5,
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  student_count: 2,
  join_code: 'ABC123',
  students: [
    { id: 101, name: '王小明', email: 'wang@test.com', enrolled_at: '2024-02-01T00:00:00Z' },
    { id: 102, name: '李小華', email: 'li@test.com', enrolled_at: '2024-02-02T00:00:00Z' },
  ],
};

const EMPTY_CLASSROOM = {
  ...BASE_CLASSROOM,
  student_count: 0,
  students: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClassroomDetail.mockResolvedValue(BASE_CLASSROOM);
});

// ── Helper ─────────────────────────────────────────────────────────────────
async function renderPanel(
  props: Partial<React.ComponentProps<typeof ClassroomDetailPanel>> = {},
) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<ClassroomDetailPanel classroomId={1} {...props} />);
  });
  return result;
}

// ── Test 1: batch input parser ─────────────────────────────────────────────
describe('batch input parser', () => {
  it('maps "name seat_number" lines to student objects', async () => {
    mockGetClassroomDetail.mockResolvedValue(EMPTY_CLASSROOM);
    await renderPanel();

    // Open batch create panel
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量建立學生/ }));
    });

    const textarea = screen.getByRole('textbox', {}) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '王小明 1\n李小華 2\n陳大文 3' } });
    });

    // Preview should show 3 students
    expect(screen.getByText(/預覽：將建立 3 位學生/)).toBeTruthy();
  });

  it('ignores blank lines in batch input', async () => {
    mockGetClassroomDetail.mockResolvedValue(EMPTY_CLASSROOM);
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量建立學生/ }));
    });

    const textarea = screen.getByRole('textbox', {}) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '王小明 1\n\n   \n李小華 2' } });
    });

    // Only 2 non-blank lines → 2 students in preview
    expect(screen.getByText(/預覽：將建立 2 位學生/)).toBeTruthy();
  });

  it('handles name-only lines (seat_number omitted)', async () => {
    mockGetClassroomDetail.mockResolvedValue(EMPTY_CLASSROOM);
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量建立學生/ }));
    });

    const textarea = screen.getByRole('textbox', {}) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '王小明' } });
    });

    // 1 student, no seat number
    expect(screen.getByText(/預覽：將建立 1 位學生/)).toBeTruthy();
  });
});

// ── Test 2: add student removes result row + reloads classroom ─────────────
describe('add student', () => {
  it('removes the student from search results after adding', async () => {
    mockGetClassroomDetail.mockResolvedValue(EMPTY_CLASSROOM);
    mockSearchStudentsForClassroom.mockResolvedValue([
      { id: 200, name: '張三', email: 'zhang@test.com' },
    ]);
    mockAddStudent.mockResolvedValue({});

    await renderPanel();

    // Open search
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /新增學生/ }));
    });

    // Type search query (≥2 chars triggers debounced search immediately in test)
    const input = screen.getByPlaceholderText(/輸入姓名或 email/);
    await act(async () => {
      fireEvent.change(input, { target: { value: '張三' } });
    });

    // Wait for the search result to appear
    await waitFor(() => {
      expect(screen.getByText('張三')).toBeTruthy();
    });

    // Click add
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '加入' }));
    });

    // Student removed from results
    await waitFor(() => {
      expect(screen.queryByText('張三')).toBeNull();
    });
  });

  it('reloads classroom data after adding a student', async () => {
    mockGetClassroomDetail.mockResolvedValue(EMPTY_CLASSROOM);
    mockSearchStudentsForClassroom.mockResolvedValue([
      { id: 200, name: '張三', email: 'zhang@test.com' },
    ]);
    mockAddStudent.mockResolvedValue({});

    await renderPanel();

    const callsBefore = mockGetClassroomDetail.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /新增學生/ }));
    });

    const input = screen.getByPlaceholderText(/輸入姓名或 email/);
    await act(async () => {
      fireEvent.change(input, { target: { value: '張三' } });
    });

    await waitFor(() => expect(screen.getByText('張三')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '加入' }));
    });

    await waitFor(() => {
      expect(mockGetClassroomDetail.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

// ── Test 3: remove student requires confirm state then reloads ─────────────
describe('remove student', () => {
  it('shows confirm button only after initial remove click (two-step confirm)', async () => {
    await renderPanel();

    // The first "移除" button is an inline text button (opacity-0 group-hover)
    // fireEvent can still click hidden buttons in JSDOM
    const removeBtns = screen.getAllByRole('button', { name: '移除' });
    // Initially no "確認移除" button visible
    expect(screen.queryByRole('button', { name: /確認移除/ })).toBeNull();

    await act(async () => {
      fireEvent.click(removeBtns[0]);
    });

    // Now "確認移除" should appear
    expect(screen.getByRole('button', { name: /確認移除/ })).toBeTruthy();
  });

  it('calls removeStudent and reloads classroom on confirm', async () => {
    mockRemoveStudent.mockResolvedValue({});
    await renderPanel();

    const callsBefore = mockGetClassroomDetail.mock.calls.length;

    // First click — enter confirm state
    const removeBtns = screen.getAllByRole('button', { name: '移除' });
    await act(async () => {
      fireEvent.click(removeBtns[0]);
    });

    // Second click — confirm
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /確認移除/ }));
    });

    expect(mockRemoveStudent).toHaveBeenCalledWith('test-token', 1, 101);
    await waitFor(() => {
      expect(mockGetClassroomDetail.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('cancels confirm state when cancel is clicked', async () => {
    await renderPanel();

    const removeBtns = screen.getAllByRole('button', { name: '移除' });
    await act(async () => {
      fireEvent.click(removeBtns[0]);
    });

    expect(screen.getByRole('button', { name: /確認移除/ })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    expect(screen.queryByRole('button', { name: /確認移除/ })).toBeNull();
  });
});

// ── Test 4: CSV credentials export includes BOM + expected columns ─────────
describe('CSV credentials export', () => {
  it('triggers download with BOM prefix and expected column headers', async () => {
    const BATCH_RESULT = {
      created: [
        { user_id: 301, name: '王小明', seat_number: '1', username: 'wang001', password: 'pass123' },
        { user_id: 302, name: '李小華', seat_number: '2', username: 'li002', password: 'pass456' },
      ],
      errors: [],
    };

    mockGetClassroomDetail.mockResolvedValue(EMPTY_CLASSROOM);
    mockBatchCreateStudents.mockResolvedValue(BATCH_RESULT);

    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量建立學生/ }));
    });

    const textarea = screen.getByRole('textbox', {});
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '王小明 1\n李小華 2' } });
    });

    // Submit batch
    await act(async () => {
      const submitBtn = screen.getByRole('button', { name: /建立 2 位學生/ });
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/成功建立 2 位學生/)).toBeTruthy();
    });

    // Spy on anchor click to capture Blob content
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    });

    // Intercept Blob constructor to check CSV content
    let capturedContent = '';
    const OrigBlob = global.Blob;
    global.Blob = class extends OrigBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        capturedContent = parts.join('');
      }
    } as typeof Blob;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /下載登入資訊/ }));
    });

    // Should include BOM and column headers
    expect(capturedContent).toContain('﻿');
    expect(capturedContent).toContain('姓名,座號,帳號,密碼');
    expect(capturedContent).toContain('王小明,1,wang001,pass123');
    expect(capturedContent).toContain('李小華,2,li002,pass456');

    expect(clickSpy).toHaveBeenCalled();

    createSpy.mockRestore();
    global.Blob = OrigBlob;
  });
});
