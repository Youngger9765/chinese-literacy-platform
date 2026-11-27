/**
 * #4158 找課文：真的把 StoryLibrary 畫出來，打字搜尋
 * 驗收：搜年級找得到、已完成課文搜尋時仍標示已完成、沒結果有建議關鍵字（可點）而不是空白
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 't', user: { id: 1 } }),
}));
const stories = [
  { id: '20011', title: '十秒的背後', grade: '4', genre: '說明文', level: '4', content: [], thumbnail: '', category: 'Daily', filename: '', charCount: 100 },
  { id: '20012', title: '老鷹的飛翔', grade: '5', genre: '記敘文', level: '5', content: [], thumbnail: '', category: 'Daily', filename: '', charCount: 100 },
  { id: '20013', title: '千里馬', grade: '8', genre: '記敘文', level: '8', content: [], thumbnail: '', category: 'Daily', filename: '', charCount: 100 },
];
vi.mock('../../../services/api', () => ({
  fetchStories: vi.fn(async () => ({ stories, grades: ['4', '5', '8'] })),
  fetchStory: vi.fn(),
}));
vi.mock('../../../services/teacherApi', () => ({ getClassroomTexts: vi.fn() }));
vi.mock('../../../services/gamificationApi', () => ({
  getGamificationPoints: vi.fn(async () => ({ level_info: { xp_to_next: 100 } })),
}));
vi.mock('../../../services/progressApi', () => ({
  getLibraryStatus: vi.fn(async () => ({ '20011': 'completed' })),
}));

import StoryLibrary from '../StoryLibrary';

const setup = async () => {
  render(<StoryLibrary onStartReading={vi.fn()} />);
  await screen.findByText('十秒的背後');
  return screen.getByPlaceholderText(/搜尋課文標題、體裁或年級/) as HTMLInputElement;
};
const type = (box: HTMLInputElement, v: string) => fireEvent.change(box, { target: { value: v } });

describe('#4158 找課文', () => {
  beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });

  it('搜「四年級」只剩 4 年級那課', async () => {
    const box = await setup();
    type(box, '四年級');
    expect(screen.getByText('十秒的背後')).toBeTruthy();
    expect(screen.queryByText('老鷹的飛翔')).toBeNull();
    expect(screen.queryByText('千里馬')).toBeNull();
  });

  it('已完成的課搜尋時仍標示已完成，並在結果列數出來', async () => {
    const box = await setup();
    type(box, '十秒');
    await waitFor(() => expect(screen.getAllByText(/已完成/).length).toBeGreaterThan(0));
    expect(screen.getByText(/其中已完成 1 篇/)).toBeTruthy();
  });

  it('沒結果：出現建議關鍵字，點了就搜得到課文', async () => {
    const box = await setup();
    type(box, '不存在的詞');
    const sug = await screen.findByTestId('search-suggestions');
    expect(sug.textContent).toContain('記敘文');
    fireEvent.click(screen.getByRole('button', { name: '記敘文' }));
    expect(box.value).toBe('記敘文');
    expect(screen.getByText('老鷹的飛翔')).toBeTruthy();
    expect(screen.queryByTestId('search-suggestions')).toBeNull();
  });

  it('沒搜尋時（清單有課文）不出現建議', async () => {
    await setup();
    expect(screen.queryByTestId('search-suggestions')).toBeNull();
  });

  it('「只看未讀」開著、搜不到：不能說全部讀完了，要有建議與清除（審查擋合併）', async () => {
    const box = await setup();
    fireEvent.click(await screen.findByRole('button', { name: '只看未讀' }));
    type(box, '不存在的詞');
    expect(screen.queryByText('所有課文都讀完了！')).toBeNull();
    expect(await screen.findByTestId('search-suggestions')).toBeTruthy();
    expect(screen.getByRole('button', { name: '清除篩選條件' })).toBeTruthy();
  });

  it('真的把未讀都讀完時，仍然說讀完了（對照，不是把訊息整個拿掉）', async () => {
    await setup();
    // 只有 20011 已完成；把另外兩課也標成完成，未讀清單才會真的空
    const { getLibraryStatus } = await import('../../../services/progressApi');
    vi.mocked(getLibraryStatus).mockResolvedValue({ '20011': 'completed', '20012': 'completed', '20013': 'completed' } as never);
    cleanup();
    render(<StoryLibrary onStartReading={vi.fn()} />);
    await screen.findByText('十秒的背後');
    fireEvent.click(await screen.findByRole('button', { name: '只看未讀' }));
    expect(await screen.findByText('所有課文都讀完了！')).toBeTruthy();
  });

  it('先選了年級又搜不到，點建議後要真的有結果（點建議要重設年級與只看未讀）', async () => {
    const box = await setup();
    fireEvent.click(screen.getByRole('button', { name: '第 5 級' }));
    type(box, '不存在的詞');
    // 「說明文」只有 4 年級那課；若沒重設年級，選著 5 年級會是 0 篇
    fireEvent.click(await screen.findByRole('button', { name: '說明文' }));
    expect(screen.getByText('十秒的背後')).toBeTruthy();
  });
});
