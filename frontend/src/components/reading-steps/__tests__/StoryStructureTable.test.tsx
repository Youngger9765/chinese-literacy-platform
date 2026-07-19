import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// StoryStructureTable 內部呼叫 useAuth；測試不掛 AuthProvider，
// 依 repo 慣例（見 src/__smoke__/render-smoke.test.tsx）stub 掉 AuthContext，
// 否則會 throw "useAuth must be used within an AuthProvider"。
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

// 現行 cards layout 需要 interactive_type='display' 才會把 value 當文字渲染；
// 沒標的 cell 會被 renderCellContent 當成 fill_blank 畫成空 input（值不顯示）。
const simpleRows = [
  { label: '主角', value: '小明', interactive_type: 'display' },
  { label: '主題', value: '友情的重要性', interactive_type: 'display' },
];

const groupedRows = [
  {
    label: '事例',
    value: '',
    interactive_type: 'display',
    sub_rows: [
      { label: '背景', value: '小明轉學到新學校', interactive_type: 'display' },
      { label: '經過', value: '遇到熱心同學阿偉', interactive_type: 'display' },
      { label: '結果', value: '兩人成為好朋友', interactive_type: 'display' },
    ],
  },
];

function mockFetchSuccess(data: object) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    })
  );
}

function mockFetchError() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StoryStructureTable', () => {
  it('shows loading spinner while fetching', () => {
    // fetch never resolves during this test
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<StoryStructureTable storyId="lesson-01" />);
    expect(screen.getByText(/正在整理文章重點/)).toBeTruthy();
  });

  it('shows error message on fetch failure', async () => {
    mockFetchError();
    render(<StoryStructureTable storyId="lesson-01" />);
    await waitFor(() =>
      expect(screen.getByText(/無法載入文章重點表/)).toBeTruthy()
    );
  });

  it('renders simple rows (no sub_rows)', async () => {
    mockFetchSuccess({ rows: simpleRows });
    render(<StoryStructureTable storyId="lesson-01" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());
    expect(screen.getByText('小明')).toBeTruthy();
    expect(screen.getByText('主題')).toBeTruthy();
    expect(screen.getByText('友情的重要性')).toBeTruthy();
  });

  it('renders grouped rows with sub_rows', async () => {
    mockFetchSuccess({ rows: groupedRows });
    render(<StoryStructureTable storyId="lesson-01" showCoach={false} />);
    await waitFor(() => expect(screen.getByText('事例')).toBeTruthy());
    expect(screen.getByText('背景')).toBeTruthy();
    expect(screen.getByText('小明轉學到新學校')).toBeTruthy();
    expect(screen.getByText('經過')).toBeTruthy();
    expect(screen.getByText('結果')).toBeTruthy();
  });

  it('shows 文章重點表 header title', async () => {
    mockFetchSuccess({ rows: simpleRows });
    render(<StoryStructureTable storyId="lesson-01" showCoach={false} />);
    await waitFor(() => expect(screen.getByText(/文章重點表/)).toBeTruthy());
  });

  // 迴歸測試（#story-structure-inline-blank-regex）：
  // 共用 /g regex 的 lastIndex 殘留曾讓帶情境句子的 fill_blank cell 被誤判成 0 blank，
  // 掉到 FillBlankCell 只畫光禿空格、丟掉整句情境；多空格列還會少畫一格。
  // 修好後每個子列的情境句子文字都要出現，且空格數量要對。
  it('renders every fill_blank context sentence and correct input count in a section_block', async () => {
    const worksheetStructure = {
      layout: 'worksheet_table',
      title: '文章重點表',
      worksheet_rows: [
        {
          kind: 'section_block',
          section: '問題',
          items: [
            { label: '問題1', value: '食客中有一位會模仿【　　　】的樣子' },
            { label: '問題2', value: '他也想學會【　　　】和【　　　】的本領' },
            { label: '問題3', value: '最後大家都覺得很【　　　】' },
          ],
        },
      ],
      rows: [
        {
          label: '問題',
          value: '',
          interactive_type: 'display',
          sub_rows: [
            {
              label: '問題1',
              value: '食客中有一位會模仿【　　　】的樣子',
              interactive_type: 'fill_blank',
            },
            {
              label: '問題2',
              value: '他也想學會【　　　】和【　　　】的本領',
              interactive_type: 'fill_blank',
            },
            {
              label: '問題3',
              value: '最後大家都覺得很【　　　】',
              interactive_type: 'fill_blank',
            },
          ],
        },
      ],
    };

    mockFetchSuccess(worksheetStructure);
    const { container } = render(
      <StoryStructureTable storyId="lesson-g6-l22" showCoach={false} />
    );

    // 等表格載入
    await waitFor(() => expect(screen.getByText('問題1')).toBeTruthy());

    // 每個子列的「情境句子片段」都要出現在畫面上（bug 時會被 FillBlankCell 丟掉）
    expect(screen.getByText(/食客中有一位會模仿/)).toBeTruthy();
    expect(screen.getByText(/的樣子/)).toBeTruthy();
    expect(screen.getByText(/他也想學會/)).toBeTruthy();
    expect(screen.getByText(/的本領/)).toBeTruthy();
    expect(screen.getByText(/最後大家都覺得很/)).toBeTruthy();

    // 空格總數 = 1 + 2 + 1 = 4；bug 時每列只畫 1 個光禿 input（共 3 個）→ 少畫
    const inputs = container.querySelectorAll('input');
    expect(inputs.length).toBe(4);
  });

  // 迴歸測試（#2193 single-blank key regression）：
  // worksheet_table 的 InlineWorksheetContent 對單空格 cell 用 -b0 key 存答案，
  // 但 tally/submit 用「單空格 → 無 -bN suffix」→ 填了卻算 0 → totalAnswered<totalInteractive
  // → 提交鈕鎖住、送不出。修好後填單空格要算「已填 1/1」且提交鈕解鎖。
  it('counts a filled single-blank cell as answered and enables submit (#2193 key)', async () => {
    const singleBlankStructure = {
      layout: 'worksheet_table',
      title: '文章重點表',
      worksheet_rows: [
        {
          kind: 'section_block',
          section: '解決',
          items: [{ label: '解決1', value: '食客中有一位會模仿【　　　】的樣子' }],
        },
      ],
      rows: [
        {
          label: '解決',
          value: '',
          interactive_type: 'display',
          sub_rows: [
            {
              label: '解決1',
              value: '食客中有一位會模仿【　　　】的樣子',
              interactive_type: 'fill_blank',
            },
          ],
        },
      ],
    };

    mockFetchSuccess(singleBlankStructure);
    const { container } = render(
      <StoryStructureTable storyId="lesson-g6-l22" showCoach={false} />
    );

    await waitFor(() => expect(screen.getByText('解決1')).toBeTruthy());

    const submitBtn = screen.getByRole('button', { name: /提交答案/ }) as HTMLButtonElement;
    // 尚未填 → 鎖住
    expect(submitBtn.disabled).toBe(true);

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '狗' } });

    // 單空格 cell 填了要算「已填 1/1」→ 提交鈕解鎖(bug 時仍鎖住)
    await waitFor(() => expect(submitBtn.disabled).toBe(false));
    const filled = container.textContent?.replace(/\s+/g, '') ?? '';
    expect(filled).toContain('已填1/1題');
  });

  it('re-fetches when storyId prop changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: simpleRows }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<StoryStructureTable storyId="lesson-01" />);
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());

    rerender(<StoryStructureTable storyId="lesson-02" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Second call should use the new storyId
    const secondCallUrl = (fetchMock.mock.calls[1][0] as string);
    expect(secondCallUrl).toContain('lesson-02');
  });
});
