import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 同 StoryStructureTable.test.tsx 慣例：stub AuthContext。
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    mustChangePassword: false,
    loginPassword: null,
    needsTermsAcceptance: false,
    hasClassroom: true,
    teacherGatingEnforced: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    clearMustChangePassword: vi.fn(),
    refreshUser: vi.fn(),
    acceptTerms: vi.fn(),
    loginWithGoogle: vi.fn(),
    loginWithJunyi: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import StoryStructureTable from '../StoryStructureTable';

// Same fixture shape as StoryStructureTable.singleBlankDenominator.test.tsx:
// one single-blank field (主角) + one two-blank field (球風) → 3 blanks total.
const worksheetStructure = {
  layout: 'worksheet_table',
  title: '文章重點表',
  worksheet_rows: [
    { kind: 'pair', label: '主角', value: '【　　　】' },
    { kind: 'pair', label: '球風', value: '追求【　　　】和【　　　】的角度。' },
  ],
  rows: [
    { label: '主角', value: '【　　　】', interactive_type: 'fill_blank' },
    { label: '球風', value: '追求【　　　】和【　　　】的角度。', interactive_type: 'fill_blank' },
  ],
};

function mockFetchSuccess(data: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StoryStructureTable — progress persistence (#2833)', () => {
  it('restores every previously-filled blank from initialProgress on mount, not just one', async () => {
    mockFetchSuccess(worksheetStructure);
    const { container } = render(
      <StoryStructureTable
        storyId="lesson-2833"
        showCoach={false}
        initialProgress={{
          answers: { '0-b0': '戴資穎', '1-b0': '邊角球', '1-b1': '難以預測' },
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());

    // Quantity assertion (not "at least one restored"): all 3 blanks must be
    // both counted AND actually rendered with the restored text.
    await waitFor(() => expect(screen.getByText(/已填 3 \/ 3 題/)).toBeTruthy());

    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input:not([type])',
    );
    expect(inputs.length).toBe(3);
    const values = Array.from(inputs).map((i) => i.value);
    expect(values).toEqual(['戴資穎', '邊角球', '難以預測']);
  });

  it('reports the full accumulated answer set on every change, not just the latest field', async () => {
    mockFetchSuccess(worksheetStructure);
    const onProgressChange = vi.fn();
    const { container } = render(
      <StoryStructureTable
        storyId="lesson-2833b"
        showCoach={false}
        onProgressChange={onProgressChange}
      />,
    );
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());

    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input:not([type])',
    );
    expect(inputs.length).toBe(3);

    const answerCountAtCall = (n: number) => {
      const call = onProgressChange.mock.calls[n];
      const payload = call[0] as { answers?: Record<string, unknown> };
      return Object.keys(payload.answers ?? {}).length;
    };

    fireEvent.change(inputs[0], { target: { value: '戴資穎' } });
    await waitFor(() => expect(answerCountAtCall(onProgressChange.mock.calls.length - 1)).toBe(1));

    fireEvent.change(inputs[1], { target: { value: '邊角球' } });
    await waitFor(() => expect(answerCountAtCall(onProgressChange.mock.calls.length - 1)).toBe(2));

    fireEvent.change(inputs[2], { target: { value: '難以預測' } });
    await waitFor(() => expect(answerCountAtCall(onProgressChange.mock.calls.length - 1)).toBe(3));
  });

  it('still clears answers on a genuine story change (does not disable the existing reset)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(worksheetStructure) });
    vi.stubGlobal('fetch', fetchMock);

    const { container, rerender } = render(
      <StoryStructureTable storyId="lesson-2833-a" showCoach={false} />,
    );
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());

    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input:not([type])',
    );
    fireEvent.change(inputs[0], { target: { value: '戴資穎' } });
    await waitFor(() => expect(screen.getByText(/已填 1 \/ 3 題/)).toBeTruthy());

    rerender(<StoryStructureTable storyId="lesson-2833-b" showCoach={false} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/已填 0 \/ 3 題/)).toBeTruthy());
  });

  it('falls back to ungraded instead of crashing on a malformed restored gradeResult', async () => {
    mockFetchSuccess(worksheetStructure);
    render(
      <StoryStructureTable
        storyId="lesson-2833c"
        showCoach={false}
        initialProgress={{
          answers: { '0-b0': '戴資穎' },
          // Malformed: a null element and one missing every required field.
          // Array.isArray(results) alone would let this through and crash
          // findGradeItem()'s `r.row_index` read the moment submitted=true.
          gradeResult: { results: [null, {}], score: 0 },
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());
    // Still shows the restored answer — only the malformed grade was rejected.
    expect(screen.getByText(/已填 1 \/ 3 題/)).toBeTruthy();
    // Not graded: the submit button must still say "提交答案", not show results.
    expect(screen.getByText('提交答案')).toBeTruthy();
  });

  // #4081：批改失敗的哨兵值 {results: [], score: -1} 以前會被存進 DB；重新整理後
  // 還原回來，又因為「已經有成績」不讓交 —— 永遠卡在「批改失敗，請重新整理後再試」。
  it('a restored grade-failure sentinel does not block submitting again', async () => {
    mockFetchSuccess(worksheetStructure);
    render(
      <StoryStructureTable
        storyId="lesson-4081a"
        showCoach={false}
        initialProgress={{
          answers: { '0-b0': '戴資穎', '1-b0': '邊角球', '1-b1': '難以預測' },
          gradeResult: { results: [], score: -1 },
        }}
      />,
    );
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());
    expect(screen.queryByText(/批改失敗/)).toBeNull();
    expect(screen.getByRole('button', { name: /提交答案/ })).toBeTruthy();
  });

  it('a failed grading is never reported for saving, and can be retried in place', async () => {
    const onProgressChange = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(worksheetStructure) })
      .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ results: [{ correct: true }, { correct: true }, { correct: true }], score: 100 }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <StoryStructureTable
        storyId="lesson-4081b"
        showCoach={false}
        onProgressChange={onProgressChange}
        initialProgress={{ answers: { '0-b0': '戴資穎', '1-b0': '邊角球', '1-b1': '難以預測' } }}
      />,
    );
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /提交答案/ }));
    await waitFor(() => expect(screen.getByText(/批改失敗/)).toBeTruthy());
    for (const [payload] of onProgressChange.mock.calls) {
      const g = (payload as { gradeResult?: { score?: number } | null }).gradeResult;
      expect(g?.score ?? 0).toBeGreaterThanOrEqual(0);
    }
    fireEvent.click(screen.getByRole('button', { name: /再交一次/ }));
    await waitFor(() => expect(screen.queryByText(/批改失敗/)).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
