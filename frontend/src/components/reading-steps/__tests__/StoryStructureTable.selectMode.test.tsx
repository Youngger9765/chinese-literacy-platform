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

describe('StoryStructureTable — checkbox select_mode (#2776)', () => {
  it('a 單選 (select_mode=single) row only ever keeps one option checked', async () => {
    const structure = {
      layout: 'worksheet_table',
      title: '文章重點表',
      worksheet_rows: [
        {
          kind: 'section_block',
          section: '事例',
          items: [{ label: '經過', value: '(單選，請打勾)\n①忠於自己的球風 ②保守地打安全球' }],
        },
      ],
      rows: [
        {
          label: '事例',
          value: '',
          interactive_type: 'display',
          sub_rows: [
            {
              label: '經過',
              value: '在重要比賽仍然選擇：【 單選，請打勾 】\n①忠於自己的球風 ②保守地打安全球',
              interactive_type: 'checkbox',
              options: ['忠於自己的球風', '保守地打安全球'],
              select_mode: 'single',
            },
          ],
        },
      ],
    };
    mockFetchSuccess(structure);
    render(<StoryStructureTable storyId="lesson-2776" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('經過')).toBeTruthy());

    const optionA = screen.getByText('忠於自己的球風').closest('label') as HTMLElement;
    const optionB = screen.getByText('保守地打安全球').closest('label') as HTMLElement;
    const inputA = optionA.querySelector('input') as HTMLInputElement;
    const inputB = optionB.querySelector('input') as HTMLInputElement;

    // 單選：input 的原生型別要是 radio，不是 checkbox
    // （checkbox 允許瀏覽器層級多選，radio 從根本上不允許）。
    expect(inputA.type).toBe('radio');

    fireEvent.click(optionA);
    await waitFor(() => expect(inputA.checked).toBe(true));

    fireEvent.click(optionB);
    // ⚠️ #2776 — 指示語寫「單選」，畫面上卻兩個都能勾。
    // 修好之後點第二個要把第一個換掉，不是疊加。
    await waitFor(() => expect(inputB.checked).toBe(true));
    expect(inputA.checked).toBe(false);
  });

  it('a 多選 (select_mode=multi, or unset) row still allows several options checked', async () => {
    const structure = {
      layout: 'worksheet_table',
      title: '文章重點表',
      worksheet_rows: [
        {
          kind: 'section_block',
          section: '事例',
          items: [{ label: '背景', value: '(多選，請打勾)\n①奧運金牌賽 ②世界大學運動會 ③全國關注的比賽' }],
        },
      ],
      rows: [
        {
          label: '事例',
          value: '',
          interactive_type: 'display',
          sub_rows: [
            {
              label: '背景',
              value: '這個故事發生的情境？【 多選，請打勾 】\n①奧運金牌賽 ②世界大學運動會 ③全國關注的比賽',
              interactive_type: 'checkbox',
              options: ['奧運金牌賽', '世界大學運動會', '全國關注的比賽'],
              select_mode: 'multi',
            },
          ],
        },
      ],
    };
    mockFetchSuccess(structure);
    render(<StoryStructureTable storyId="lesson-2776" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('背景')).toBeTruthy());

    const optionA = screen.getByText('奧運金牌賽').closest('label') as HTMLElement;
    const optionB = screen.getByText('世界大學運動會').closest('label') as HTMLElement;
    const inputA = optionA.querySelector('input') as HTMLInputElement;
    const inputB = optionB.querySelector('input') as HTMLInputElement;
    expect(inputA.type).toBe('checkbox');

    fireEvent.click(optionA);
    fireEvent.click(optionB);
    await waitFor(() => {
      expect(inputA.checked).toBe(true);
      expect(inputB.checked).toBe(true);
    });
  });
});
