import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import StoryStructureTable from '../StoryStructureTable';

const simpleRows = [
  { label: '主角', value: '小明' },
  { label: '主題', value: '友情的重要性' },
];

const groupedRows = [
  {
    label: '事例',
    value: '',
    sub_rows: [
      { label: '背景', value: '小明轉學到新學校' },
      { label: '經過', value: '遇到熱心同學阿偉' },
      { label: '結果', value: '兩人成為好朋友' },
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
    render(<StoryStructureTable storyId="lesson-01" />);
    await waitFor(() => expect(screen.getByText('主角')).toBeTruthy());
    expect(screen.getByText('小明')).toBeTruthy();
    expect(screen.getByText('主題')).toBeTruthy();
    expect(screen.getByText('友情的重要性')).toBeTruthy();
  });

  it('renders grouped rows with sub_rows', async () => {
    mockFetchSuccess({ rows: groupedRows });
    render(<StoryStructureTable storyId="lesson-01" />);
    await waitFor(() => expect(screen.getByText('事例')).toBeTruthy());
    expect(screen.getByText('背景')).toBeTruthy();
    expect(screen.getByText('小明轉學到新學校')).toBeTruthy();
    expect(screen.getByText('經過')).toBeTruthy();
    expect(screen.getByText('結果')).toBeTruthy();
  });

  it('shows 文章重點表 header title', async () => {
    mockFetchSuccess({ rows: simpleRows });
    render(<StoryStructureTable storyId="lesson-01" />);
    await waitFor(() => expect(screen.getByText(/文章重點表/)).toBeTruthy());
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
