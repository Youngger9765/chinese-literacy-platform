import { render, screen, waitFor } from '@testing-library/react';
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

  // #3563 回歸鎖 —— 現場老師回報「文章重點表版面跑掉」。真環境重現
  // （staging，lesson 20016「這是什麼意思」第 6/11 步）：matrix 佈局「配對」
  // 子類的第一欄是整句例句（真實資料見下方 `section`），不是短區段標題，
  // 但舊版一律套 `writingMode: vertical-rl` + 固定窄欄，長句被逐字往下
  // 擠成一條看不懂的直書。
  it('長句 section 標題（真實資料：L0016 配對題）不可以逐字直書擠壓', async () => {
    const longSentence = '1.這訓練量對先發選手來說只是「小意思」。';
    const worksheetStructure = {
      layout: 'worksheet_table',
      title: '這是什麼「意思」？',
      worksheet_rows: [
        {
          kind: 'section_block',
          section: longSentence,
          items: [
            {
              label: '配對',
              value: '①表達歉意或害羞 ②表示對某人有好感',
            },
          ],
        },
      ],
      rows: [
        {
          label: longSentence,
          value: '',
          interactive_type: 'display',
          sub_rows: [
            {
              label: '配對',
              value: '①表達歉意或害羞 ②表示對某人有好感',
              interactive_type: 'checkbox',
              options: ['表達歉意或害羞', '表示對某人有好感'],
            },
          ],
        },
      ],
    };

    mockFetchSuccess(worksheetStructure);
    const { container } = render(
      <StoryStructureTable storyId="lesson-20016" showCoach={false} />
    );

    await waitFor(() => expect(screen.getByText(longSentence)).toBeTruthy());

    // 整句話要原封不動讀得到，不能被拆成逐字
    const sectionCell = screen.getByText(longSentence).closest('td');
    expect(sectionCell).toBeTruthy();
    // 不可以是直書 —— 這正是被回報的「逐字往下堆疊、看不懂」版面
    expect(sectionCell?.style.writingMode).not.toBe('vertical-rl');
  });

  // 對照組：短區段標題（真實資料：全庫 31 課皆 ≤9 字，例如「主角」）
  // 仍要維持直書——這個修復不能讓既有版面跟著壞掉。
  it('短 section 標題（真實資料形狀）維持直書，不受這次修復影響', async () => {
    const worksheetStructure = {
      layout: 'worksheet_table',
      title: '文章重點表',
      worksheet_rows: [
        {
          kind: 'section_block',
          section: '主角',
          items: [{ label: '問題1', value: '小明' }],
        },
      ],
      rows: [
        {
          label: '主角',
          value: '',
          interactive_type: 'display',
          sub_rows: [{ label: '問題1', value: '小明', interactive_type: 'display' }],
        },
      ],
    };

    mockFetchSuccess(worksheetStructure);
    render(<StoryStructureTable storyId="lesson-short" showCoach={false} />);

    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());
    const sectionCell = screen.getByText('主角').closest('td');
    expect(sectionCell?.style.writingMode).toBe('vertical-rl');
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
