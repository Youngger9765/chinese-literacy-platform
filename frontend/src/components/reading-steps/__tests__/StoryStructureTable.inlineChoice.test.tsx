import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// L0011「結果」的真實形狀，逐字取自 /api/stories/20011/structure 消毒後的回應。
const structure = {
  layout: 'worksheet_table',
  title: '贏得喝采的輸家',
  worksheet_rows: [
    {
      kind: 'section_block',
      section: '事例',
      items: [
        {
          label: '結果',
          // ⚠️ 刻意保留 worksheet_rows 這條「未清洗」的舊值（含 "第N個空格" 說明行、
          // 括號式空格），驗證前端一定要讀 `rows[].value`（已清洗），不是這個。
          value: '(單選，請打勾)\n結果，小戴（　）球賽，\n卻（　）全國人民的尊敬。\n第一個空格：①贏了 ②輸了\n第二個空格：①贏得 ②失去',
        },
      ],
    },
  ],
  rows: [
    {
      label: '事例',
      value: '',
      interactive_type: 'display',
      sub_rows: [
        {
          label: '結果',
          value: '【 單選，請打勾 】\n結果，小戴【　　　】球賽，\n卻【　　　】全國人民的尊敬。',
          interactive_type: 'inline_choice',
          blanks: [
            { options: ['贏了', '輸了'] },
            { options: ['贏得', '失去'] },
          ],
        },
      ],
    },
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

describe('StoryStructureTable — inline_choice (#2776, L0011 "結果")', () => {
  it('keeps the sentence visible and renders two separate 2-option pickers, not one flat 4-option list', async () => {
    mockFetchSuccess(structure);
    render(<StoryStructureTable storyId="lesson-20011" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('結果')).toBeTruthy());

    // ⚠️ #2776 — 修好之前這句話整個從畫面消失，只剩 4 個孤立的勾選框。
    expect(screen.getByText(/結果，小戴/)).toBeTruthy();
    expect(screen.getByText(/全國人民的尊敬/)).toBeTruthy();

    // 兩組各 2 個選項按鈕，不是一組 4 個。
    expect(screen.getByText('贏了')).toBeTruthy();
    expect(screen.getByText('輸了')).toBeTruthy();
    expect(screen.getByText('贏得')).toBeTruthy();
    expect(screen.getByText('失去')).toBeTruthy();

    // 分母 = 2（兩個空格各一題），不是 1（合併成一組 checkbox）。
    expect(screen.getByText(/已填 0 \/ 2 題/)).toBeTruthy();
  });

  it('counts each blank once selected and submits row/sub_row/blank_index/selected_option', async () => {
    mockFetchSuccess(structure);
    render(<StoryStructureTable storyId="lesson-20011" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('結果')).toBeTruthy());

    fireEvent.click(screen.getByText('輸了'));
    await waitFor(() => expect(screen.getByText(/已填 1 \/ 2 題/)).toBeTruthy());

    fireEvent.click(screen.getByText('贏得'));
    await waitFor(() => expect(screen.getByText(/已填 2 \/ 2 題/)).toBeTruthy());

    const gradeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [], score: 100 }),
    });
    vi.stubGlobal('fetch', gradeFetch);
    fireEvent.click(screen.getByRole('button', { name: /提交答案/ }));

    await waitFor(() => expect(gradeFetch).toHaveBeenCalled());
    const body = JSON.parse((gradeFetch.mock.calls[0][1] as RequestInit).body as string);
    const items = body.answers.filter(
      (a: { row_index: number; sub_row_index?: number }) => a.row_index === 0 && a.sub_row_index === 0,
    );
    expect(items).toHaveLength(2);
    const byBlank = Object.fromEntries(items.map((it: { blank_index: number; selected_option: number }) => [it.blank_index, it.selected_option]));
    expect(byBlank[0]).toBe(1); // 輸了 = index 1
    expect(byBlank[1]).toBe(0); // 贏得 = index 0
  });
});
