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

// 一個單一空格的欄位（主角），加一個雙空格欄位（球風）當對照組——
// 雙空格欄位在 bug 存在時運作正常，方便看出「只有單一空格欄位壞掉」。
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

describe('StoryStructureTable — single-blank denominator (#2776)', () => {
  it('counts a single-blank field as answered once filled, and reaches the true total', async () => {
    mockFetchSuccess(worksheetStructure);
    const { container } = render(
      <StoryStructureTable storyId="lesson-2776" showCoach={false} />,
    );

    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());

    // Denominator must be 3: 1 blank (主角) + 2 blanks (球風).
    expect(screen.getByText(/已填 0 \/ 3 題/)).toBeTruthy();

    const inputs = container.querySelectorAll('input[type="text"], input:not([type])');
    expect(inputs.length).toBe(3);

    // Fill ONLY the single-blank field (主角, first input).
    fireEvent.change(inputs[0], { target: { value: '戴資穎' } });

    // ⚠️ #2776 — before the fix this stayed at "已填 0 / 3 題" forever: the
    // write key (`0-b0`) and the tally's read key (`0`, no blank suffix)
    // never matched for a field with exactly one blank.
    await waitFor(() => expect(screen.getByText(/已填 1 \/ 3 題/)).toBeTruthy());

    // Fill the remaining two blanks (球風) to reach the true total.
    fireEvent.change(inputs[1], { target: { value: '邊角球' } });
    fireEvent.change(inputs[2], { target: { value: '難以預測' } });
    await waitFor(() => expect(screen.getByText(/已填 3 \/ 3 題/)).toBeTruthy());
  });

  it('submits the typed value for a single-blank field instead of an empty string', async () => {
    mockFetchSuccess(worksheetStructure);
    const { container } = render(
      <StoryStructureTable storyId="lesson-2776" showCoach={false} />,
    );
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());

    const inputs = container.querySelectorAll('input[type="text"], input:not([type])');
    fireEvent.change(inputs[0], { target: { value: '戴資穎' } });
    fireEvent.change(inputs[1], { target: { value: '邊角球' } });
    fireEvent.change(inputs[2], { target: { value: '難以預測' } });
    await waitFor(() => expect(screen.getByText(/已填 3 \/ 3 題/)).toBeTruthy());

    const gradeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [], score: 100 }),
    });
    vi.stubGlobal('fetch', gradeFetch);

    const submitBtn = screen.getByRole('button', { name: /提交答案/ });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(gradeFetch).toHaveBeenCalled());
    const body = JSON.parse((gradeFetch.mock.calls[0][1] as RequestInit).body as string);
    const forRow0 = body.answers.filter((a: { row_index: number }) => a.row_index === 0);

    // ⚠️ #2776 — before the fix, this answer item's `value` was always ''
    // because `pushFillBlankAnswers` read a key that InlineWorksheetContent
    // never wrote to.
    expect(forRow0).toHaveLength(1);
    expect(forRow0[0].value).toBe('戴資穎');
  });
});
