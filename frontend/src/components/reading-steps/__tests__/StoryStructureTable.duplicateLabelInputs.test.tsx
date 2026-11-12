/**
 * 文章重點表（worksheet_table 版面）兩個不同的填空框，如果恰好落在
 * 「同一個標籤文字」底下，會共用同一格答案 —— 在第一格打字，第二格
 * 立刻顯示一樣的內容，使用者完全沒按過那一格。
 *
 * 2026-10-16 現場老師回報：甲乙丙打進第一格之後，後面的格子也自動出現
 * 「甲乙丙」。真環境重現於 staging L0124〈新奇！「植物肉」你聽過嗎？〉
 * 文章重點表 ——「植物肉的成分」這個標籤在這一課的來源資料裡出現兩次
 * （主要段落一次、補一句的「tail」句子又一次，見
 * `backend/app/services/keypoints_to_structure.py` 的 tail 處理），兩段
 * 各自的第一個空格因此落在同一個 answers key 上。
 *
 * 根因（frontend/src/components/reading-steps/StoryStructureTable.tsx 的
 * `resolveGradeIndex`）：worksheet_rows 的每一列要回推它在 `rows`
 * （評分用陣列）裡對應哪一個 rowIdx，原本用 `rows.findIndex(label 相同)`
 * —— 同一個標籤出現第二次時，`findIndex` 還是回傳**第一次**命中的那個
 * rowIdx，於是兩個其實不同的列被接到了同一個 answers key。
 *
 * 真實資料裡不只有「兩次」：L0084〈長大後，我才讀懂〈夏夜〉〉的
 * 「感受」「原因」標籤各出現三次，三段完全不同段落的空格會一起被接到
 * 同一格——第二個測試案例覆蓋這個 N-way（非僅二選一）情形。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

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

// 簡化重現 L0124 的真實形狀：兩個獨立的 'pair' worksheet 列共用同一個標籤
// 文字「植物肉的成分」——第一列是主要段落（2 個空格），第二列是補一句的
// tail 句子（1 個空格）。`rows`（評分陣列）跟 `worksheet_rows` 的對應關係
// 是 1:1、按順序排列，彼此互不相關，不應該被同名標籤混在一起。
const DUPLICATE_PAIR_LABEL_STRUCTURE = {
  layout: 'worksheet_table',
  title: '文章重點表',
  worksheet_rows: [
    { kind: 'pair', label: '植物肉的演進', value: '中國將【　】製成的素肉。' },
    {
      kind: 'pair',
      label: '植物肉的成分',
      value: '其中添加【　】是為了仿肉類的口感和肉汁。',
    },
    { kind: 'pair', label: '植物肉的成分', value: '→所以需額外添加維生素【　】。' },
  ],
  rows: [
    { label: '植物肉的演進', value: '中國將【　】製成的素肉。', interactive_type: 'fill_blank' },
    {
      label: '植物肉的成分',
      value: '其中添加【　】是為了仿肉類的口感和肉汁。',
      interactive_type: 'fill_blank',
    },
    {
      label: '植物肉的成分',
      value: '→所以需額外添加維生素【　】。',
      interactive_type: 'fill_blank',
    },
  ],
};

// L0084 的真實形狀（直接從 backend/app/services/keypoints_to_structure.py 轉出
// 的 /structure 回應取樣，只刪掉無空格的標題/選擇題列）：「感受」「原因」
// 各是它自己的頂層 row，在三段完全不同的段落（「來了！來了！」／「擬人」／
// 溫馨場景）底下，各自重複出現三次 —— label 文字完全相同、內容完全不同。
const TRIPLE_SECTION_LABEL_STRUCTURE = {
  layout: 'worksheet_table',
  title: '長大後，我才讀懂〈夏夜〉',
  worksheet_rows: [
    {
      kind: 'section_block',
      section: '感受',
      items: [
        { label: '國中時', value: '帶來【　】' },
        { label: '長大後', value: '□①能感受到詩意 ②仍未感受到詩意' },
      ],
    },
    {
      kind: 'section_block',
      section: '原因',
      items: [
        { label: '國中時', value: '「來了！來了！」\n可以【　】，也可以在【　】派上用場' },
        { label: '長大後', value: '①嬉笑的快樂 □②浪漫的詩意' },
      ],
    },
    {
      kind: 'section_block',
      section: '感受',
      items: [
        { label: '國中時', value: '對詩的擬人手法感到【　】' },
        { label: '長大後', value: '□①不解 ②讚嘆' },
      ],
    },
    {
      kind: 'section_block',
      section: '原因',
      items: [
        { label: '國中時', value: '本文作者認為羊隊回家、小河歌唱，都是常見的景象，為什麼老師會說詩中許多句子都有【　】修辭呢？' },
        { label: '長大後', value: '長大後，了解作者成年後還能有貼近【　】的眼光，很不容易。' },
      ],
    },
    {
      kind: 'section_block',
      section: '感受',
      items: [
        { label: '國中時', value: '【　】' },
        { label: '長大後', value: '①感佩 □②失望' },
      ],
    },
  ],
  rows: [
    {
      label: '感受',
      value: '',
      interactive_type: 'display',
      sub_rows: [
        { label: '國中時', value: '帶來【歡樂】', interactive_type: 'fill_blank' },
        { label: '長大後', value: '□①能感受到詩意 ②仍未感受到詩意', interactive_type: 'display' },
      ],
    },
    {
      label: '原因',
      value: '',
      interactive_type: 'display',
      sub_rows: [
        {
          label: '國中時',
          value: '「來了！來了！」\n可以【千變萬化】，也可以在【不同時機】派上用場',
          interactive_type: 'fill_blank',
        },
        { label: '長大後', value: '①嬉笑的快樂 □②浪漫的詩意', interactive_type: 'display' },
      ],
    },
    {
      label: '感受',
      value: '',
      interactive_type: 'display',
      sub_rows: [
        { label: '國中時', value: '對詩的擬人手法感到【困惑】', interactive_type: 'fill_blank' },
        { label: '長大後', value: '□①不解 ②讚嘆', interactive_type: 'display' },
      ],
    },
    {
      label: '原因',
      value: '',
      interactive_type: 'display',
      sub_rows: [
        {
          label: '國中時',
          value: '本文作者認為羊隊回家、小河歌唱，都是常見的景象，為什麼老師會說詩中許多句子都有【擬人】修辭呢？',
          interactive_type: 'fill_blank',
        },
        {
          label: '長大後',
          value: '長大後，了解作者成年後還能有貼近【孩童】的眼光，很不容易。',
          interactive_type: 'fill_blank',
        },
      ],
    },
    {
      label: '感受',
      value: '',
      interactive_type: 'display',
      sub_rows: [
        { label: '國中時', value: '【羨慕】', interactive_type: 'fill_blank' },
        { label: '長大後', value: '①感佩 □②失望', interactive_type: 'display' },
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

describe('StoryStructureTable — worksheet rows with a repeated label stay independent (2026-10-16)', () => {
  it('typing in the first "植物肉的成分" blank does not change the second one', async () => {
    mockFetchSuccess(DUPLICATE_PAIR_LABEL_STRUCTURE);
    const { container } = render(
      <StoryStructureTable storyId="lesson-dup-label" showCoach={false} />,
    );

    await waitFor(() => expect(screen.getByText(/已填 0 \/ 3 題/)).toBeTruthy());

    const inputs = container.querySelectorAll('input[type="text"], input:not([type])');
    expect(inputs.length).toBe(3);
    // inputs[0] = 植物肉的演進 (unrelated control)
    // inputs[1] = 植物肉的成分, first occurrence ("其中添加【　】…")
    // inputs[2] = 植物肉的成分, second occurrence (the tail sentence)
    expect((inputs[2] as HTMLInputElement).value).toBe('');

    fireEvent.change(inputs[1], { target: { value: '甲乙丙' } });

    // The unrelated control (different label) must never move.
    expect((inputs[0] as HTMLInputElement).value).toBe('');
    // ⚠️ Before the fix, resolveGradeIndex() resolved BOTH worksheet rows
    // labelled "植物肉的成分" to the SAME rowIdx (rows.findIndex always
    // returns the FIRST match), so this second input showed "甲乙丙" too
    // even though nobody typed into it.
    await waitFor(() =>
      expect((inputs[2] as HTMLInputElement).value).toBe(''),
    );
  });

  it('submits each duplicate-labelled row under its own row_index, not a shared one', async () => {
    mockFetchSuccess(DUPLICATE_PAIR_LABEL_STRUCTURE);
    const { container } = render(
      <StoryStructureTable storyId="lesson-dup-label" showCoach={false} />,
    );
    await waitFor(() => expect(screen.getByText(/已填 0 \/ 3 題/)).toBeTruthy());

    const inputs = container.querySelectorAll('input[type="text"], input:not([type])');
    fireEvent.change(inputs[0], { target: { value: '豆腐' } });
    fireEvent.change(inputs[1], { target: { value: '植物油' } });
    fireEvent.change(inputs[2], { target: { value: 'B12' } });
    await waitFor(() => expect(screen.getByText(/已填 3 \/ 3 題/)).toBeTruthy());

    const gradeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [], score: 100 }),
    });
    vi.stubGlobal('fetch', gradeFetch);
    fireEvent.click(screen.getByRole('button', { name: /提交答案/ }));
    await waitFor(() => expect(gradeFetch).toHaveBeenCalled());

    const body = JSON.parse((gradeFetch.mock.calls[0][1] as RequestInit).body as string);
    const rowIndices = new Set(body.answers.map((a: { row_index: number }) => a.row_index));
    // Three distinct worksheet rows must submit three distinct row_index values.
    expect(rowIndices.size).toBe(3);
    const byValue = Object.fromEntries(
      body.answers.map((a: { value: string }, i: number) => [i, a.value]),
    );
    expect(Object.values(byValue)).toEqual(['豆腐', '植物油', 'B12']);
  });

  it('a label repeated three times (section_block, L0084 shape) keeps all seven blanks independent', async () => {
    mockFetchSuccess(TRIPLE_SECTION_LABEL_STRUCTURE);
    const { container } = render(
      <StoryStructureTable storyId="lesson-triple-label" showCoach={false} />,
    );
    // 7 blanks total: 感受(1) + 原因(2) + 感受(1) + 原因(2) + 感受(1).
    await waitFor(() => expect(screen.getByText(/已填 0 \/ 7 題/)).toBeTruthy());

    const inputs = container.querySelectorAll('input[type="text"], input:not([type])');
    expect(inputs.length).toBe(7);
    // Document order: [0]感受①國中時 [1]原因①國中時-blank0 [2]原因①國中時-blank1
    //                 [3]感受②國中時 [4]原因②國中時 [5]原因②長大後
    //                 [6]感受③國中時
    // Before the fix, resolveGradeIndex() resolved every "感受" row (and every
    // "原因" row) to the SAME rowIdx -- the FIRST one -- because
    // `rows.findIndex(r => r.label === wsRow.section)` doesn't know it already
    // consumed that label once. The sub_row-local subIdx (0 for 國中時) then
    // makes the three "感受" 國中時 blanks collide on one shared key.
    fireEvent.change(inputs[0], { target: { value: '溫馨' } });
    await waitFor(() => expect((inputs[0] as HTMLInputElement).value).toBe('溫馨'));
    expect((inputs[3] as HTMLInputElement).value).toBe('');
    expect((inputs[6] as HTMLInputElement).value).toBe('');

    fireEvent.change(inputs[1], { target: { value: '甲' } });
    await waitFor(() => expect((inputs[1] as HTMLInputElement).value).toBe('甲'));
    expect((inputs[4] as HTMLInputElement).value).toBe('');

    // Untouched siblings never move either.
    expect((inputs[2] as HTMLInputElement).value).toBe('');
    expect((inputs[5] as HTMLInputElement).value).toBe('');
  });
});
