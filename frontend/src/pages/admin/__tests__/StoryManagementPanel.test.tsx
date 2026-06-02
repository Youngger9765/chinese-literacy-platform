/**
 * TDD tests for StoryManagementPanel refactor (Issue #1851)
 *
 * These tests document the BEHAVIOUR before refactoring so the same tests
 * must pass after extraction of storyFormMapper.ts + sub-components.
 *
 * Test scope (from issue acceptance criteria):
 *   1. formToCreateRequest trims fields + splits non-empty paragraphs
 *   2. Edit modal preserves lesson_number + only sends paragraphs when provided
 *   3. 409 create error renders duplicate lesson message
 *   4. Filters call list API with search + grade params
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StoryManagementPanel from '../StoryManagementPanel';

// ── Auth mock ──────────────────────────────────────────────────────────────
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

// ── API mocks ──────────────────────────────────────────────────────────────
const mockListAdminStories = vi.fn();
const mockCreateStory = vi.fn();
const mockUpdateStory = vi.fn();
const mockDeleteStory = vi.fn();

vi.mock('../../../services/adminStoryApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/adminStoryApi')>(
    '../../../services/adminStoryApi',
  );
  return {
    ...actual,
    listAdminStories: (...args: unknown[]) => mockListAdminStories(...args),
    createStory: (...args: unknown[]) => mockCreateStory(...args),
    updateStory: (...args: unknown[]) => mockUpdateStory(...args),
    deleteStory: (...args: unknown[]) => mockDeleteStory(...args),
  };
});

// ── Fixtures ───────────────────────────────────────────────────────────────
const BASE_STORY = {
  lesson_number: 58,
  title: '第一百碗麵',
  grade: 5,
  grade_code: 'G5-10',
  genre: '記敘文',
  text_type: '單',
  paragraph_count: 4,
  char_count: 320,
  reading_strategy: '掌握段落大意',
  source_file: 'G5-10-L58.docx',
};

const EMPTY_LIST = { stories: [], total: 0 };
const ONE_STORY_LIST = { stories: [BASE_STORY], total: 1 };

// ── Helpers ────────────────────────────────────────────────────────────────

function renderPanel() {
  return render(<StoryManagementPanel />);
}

/** Open the create modal and wait for form to appear */
async function openCreateModal() {
  // Wait for initial load to complete (loading state gone)
  await waitFor(() => {
    const btn = screen.getByText('新增課文');
    expect(btn).toBeTruthy();
  });
  fireEvent.click(screen.getByText('新增課文'));
  // Wait for modal heading to be present
  await waitFor(() => screen.getByText('新增課文', { selector: 'h3' }));
}

/** Get the paragraphs textarea (the only <textarea> in the form) */
function getParagraphsTextarea(): HTMLTextAreaElement {
  return document.querySelector('textarea')!;
}

// ══════════════════════════════════════════════════════════════════════════
// 1. formToCreateRequest — trims fields + splits non-empty paragraphs
// ══════════════════════════════════════════════════════════════════════════
describe('formToCreateRequest logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAdminStories.mockResolvedValue(EMPTY_LIST);
    mockCreateStory.mockResolvedValue(BASE_STORY);
  });

  it('trims title and splits paragraphs on newline, filtering blank lines', async () => {
    renderPanel();
    await openCreateModal();

    // Fill lesson_number
    const numInput = screen.getByPlaceholderText('例：58');
    fireEvent.change(numInput, { target: { value: '99' } });

    // Fill title with surrounding whitespace
    const titleInput = screen.getByPlaceholderText('例：第一百碗麵');
    fireEvent.change(titleInput, { target: { value: '  測試標題  ' } });

    // Fill paragraphs: two real paragraphs with surrounding whitespace + blank line
    const textarea = getParagraphsTextarea();
    fireEvent.change(textarea, { target: { value: '  第一段  \n\n  第二段  ' } });

    // Submit the form
    fireEvent.submit(textarea.closest('form')!);

    await waitFor(() => {
      expect(mockCreateStory).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({
          title: '測試標題',               // trimmed
          lesson_number: 99,
          paragraphs: ['第一段', '第二段'], // trimmed + empty filtered
        }),
      );
    });
  });

  it('sends only the single non-blank paragraph when surrounded by empty lines', async () => {
    renderPanel();
    await openCreateModal();

    const numInput = screen.getByPlaceholderText('例：58');
    fireEvent.change(numInput, { target: { value: '10' } });

    const titleInput = screen.getByPlaceholderText('例：第一百碗麵');
    fireEvent.change(titleInput, { target: { value: '任意標題' } });

    const textarea = getParagraphsTextarea();
    // Three surrounding newlines, only one real paragraph
    fireEvent.change(textarea, { target: { value: '\n\n唯一一段\n\n' } });

    fireEvent.submit(textarea.closest('form')!);

    await waitFor(() => {
      expect(mockCreateStory).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ paragraphs: ['唯一一段'] }),
      );
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Edit modal — preserves lesson_number, only sends paragraphs if provided
// ══════════════════════════════════════════════════════════════════════════
describe('edit modal behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAdminStories.mockResolvedValue(ONE_STORY_LIST);
    mockUpdateStory.mockResolvedValue(BASE_STORY);
  });

  it('preserves lesson_number (read-only) when edit modal opens', async () => {
    renderPanel();
    // Wait for edit buttons to appear
    await waitFor(() => expect(screen.getAllByText('編輯').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByText('編輯')[0]);

    // The lesson_number field should be disabled and contain the story's number
    const numInput = screen.getByPlaceholderText('例：58') as HTMLInputElement;
    expect(numInput.value).toBe('58');
    expect(numInput.disabled).toBe(true);
  });

  it('does NOT include paragraphs in update request when textarea is left empty', async () => {
    // When paragraphs textarea is empty in edit mode, the update request
    // should omit the paragraphs field (treated as "no change").
    // Note: the component allows edit submission only when paragraphs is
    // populated. Providing one paragraph then clearing to test omission.
    renderPanel();
    await waitFor(() => expect(screen.getAllByText('編輯').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByText('編輯')[0]);

    // Change the title
    const titleInput = screen.getByDisplayValue('第一百碗麵');
    fireEvent.change(titleInput, { target: { value: '新標題' } });

    // Leave textarea empty — in edit mode, empty paragraphs means "no update"
    const textarea = getParagraphsTextarea();
    expect(textarea.value).toBe('');

    // The form should submit without paragraphs key in update payload.
    // We check by triggering with a minimal paragraph, then verify
    // the update path with empty textarea shows validation message.
    // (Current code: empty paragraphs in edit shows error "至少需要一個段落"
    // but does NOT call updateStory with paragraphs: [])
    fireEvent.submit(textarea.closest('form')!);

    // With empty paragraphs in edit mode, the current code blocks submission
    // and shows validation error — updateStory is NOT called
    await waitFor(() => {
      expect(screen.getByText('至少需要一個段落')).toBeTruthy();
    });
    expect(mockUpdateStory).not.toHaveBeenCalled();
  });

  it('includes paragraphs in update request when textarea is filled', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getAllByText('編輯').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByText('編輯')[0]);

    const textarea = getParagraphsTextarea();
    fireEvent.change(textarea, { target: { value: '更新段落一\n更新段落二' } });

    fireEvent.submit(textarea.closest('form')!);

    await waitFor(() => {
      const callArg = mockUpdateStory.mock.calls[0][2];
      expect(callArg.paragraphs).toEqual(['更新段落一', '更新段落二']);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. 409 error on create → renders duplicate lesson message
// ══════════════════════════════════════════════════════════════════════════
describe('409 create error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAdminStories.mockResolvedValue(EMPTY_LIST);
  });

  it('shows duplicate lesson error message when API returns 409', async () => {
    const { AdminStoryApiError } = await import('../../../services/adminStoryApi');
    mockCreateStory.mockRejectedValue(new AdminStoryApiError(409, 'already exists'));

    renderPanel();
    await openCreateModal();

    const numInput = screen.getByPlaceholderText('例：58');
    fireEvent.change(numInput, { target: { value: '58' } });

    const titleInput = screen.getByPlaceholderText('例：第一百碗麵');
    fireEvent.change(titleInput, { target: { value: '任意課文' } });

    const textarea = getParagraphsTextarea();
    fireEvent.change(textarea, { target: { value: '段落' } });

    fireEvent.submit(textarea.closest('form')!);

    await waitFor(() => {
      // Error message should contain lesson number "58" and "已存在"
      expect(screen.getByText(/58.*已存在/)).toBeTruthy();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. Filters — call list API with search + grade params
// ══════════════════════════════════════════════════════════════════════════
describe('filter behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAdminStories.mockResolvedValue(EMPTY_LIST);
  });

  it('calls listAdminStories with search param when user types in search box', async () => {
    renderPanel();
    // Wait for initial load
    await waitFor(() => expect(mockListAdminStories).toHaveBeenCalled());
    vi.clearAllMocks();
    mockListAdminStories.mockResolvedValue(EMPTY_LIST);

    const searchInput = screen.getByPlaceholderText('搜尋課文標題...');
    fireEvent.change(searchInput, { target: { value: '麵' } });

    await waitFor(() => {
      expect(mockListAdminStories).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ search: '麵' }),
      );
    });
  });

  it('calls listAdminStories with grade param when user selects a grade', async () => {
    renderPanel();
    await waitFor(() => expect(mockListAdminStories).toHaveBeenCalled());
    vi.clearAllMocks();
    mockListAdminStories.mockResolvedValue(EMPTY_LIST);

    const gradeSelect = screen.getByDisplayValue('所有年級');
    fireEvent.change(gradeSelect, { target: { value: '5' } });

    await waitFor(() => {
      expect(mockListAdminStories).toHaveBeenCalledWith(
        'test-token',
        expect.objectContaining({ grade: 5 }),
      );
    });
  });

  it('calls listAdminStories with both search and grade when both are set', async () => {
    renderPanel();
    await waitFor(() => expect(mockListAdminStories).toHaveBeenCalled());
    vi.clearAllMocks();
    mockListAdminStories.mockResolvedValue(EMPTY_LIST);

    fireEvent.change(screen.getByPlaceholderText('搜尋課文標題...'), {
      target: { value: '麵' },
    });
    fireEvent.change(screen.getByDisplayValue('所有年級'), {
      target: { value: '6' },
    });

    await waitFor(() => {
      const calls = mockListAdminStories.mock.calls;
      const lastCall = calls.at(-1)!;
      expect(lastCall[1]).toMatchObject({ search: '麵', grade: 6 });
    });
  });
});
