/**
 * #4161 AI 派發 + #4163 學習入口：兩張入口卡、2 課擇 1、推薦理由、再派一組
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 't', user: { id: 7, roles: [{ role_name: 'student' }] } }),
}));
const recApi = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../../../../services/progressApi', () => ({
  getStoryRecommendations: (...a: unknown[]) => recApi.fn(...a),
}));

import LearningEntryCards from '../LearningEntryCards';
import DispatchPicker from '../DispatchPicker';

const rec = (n: number, reason = `理由${n}`) => ({
  story_slug: `S${n}`, title: `課${n}`, grade: 4, genre: '記敘文', difficulty_match_score: 100 - n, reason,
});
const six = { recommendations: [1, 2, 3, 4, 5, 6].map((n) => rec(n)), total: 6 };
const Where = () => <div data-testid="where">{useLocation().pathname}</div>;
const renderIn = (ui: React.ReactElement) => render(<MemoryRouter>{ui}<Where /></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); recApi.fn.mockResolvedValue(six); });

describe('LearningEntryCards', () => {
  it('同時出現「AI 派發」與「自主練習」兩張卡，各有說明與主按鈕', () => {
    renderIn(<LearningEntryCards />);
    expect(within(screen.getByTestId('entry-ai')).getByRole('button', { name: '讓 AI 派一課' })).toBeTruthy();
    expect(within(screen.getByTestId('entry-self')).getByRole('button', { name: '自己挑課' })).toBeTruthy();
    expect(screen.getByTestId('entry-ai').textContent).toContain('2 課');
  });

  it('按「自己挑課」進圖書館', () => {
    renderIn(<LearningEntryCards />);
    fireEvent.click(screen.getByRole('button', { name: '自己挑課' }));
    expect(screen.getByTestId('where').textContent).toBe('/library');
  });

  it('已經在圖書館時，「自己挑課」改用傳入的動作，不跳頁', () => {
    const pick = vi.fn();
    renderIn(<LearningEntryCards onPickSelf={pick} />);
    fireEvent.click(screen.getByRole('button', { name: '自己挑課' }));
    expect(pick).toHaveBeenCalled();
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('老師作業提醒列：有未完成作業才出現，點了去作業頁，且在兩張卡上方', () => {
    const { unmount } = renderIn(<LearningEntryCards pendingAssignments={2} />);
    const bar = screen.getByTestId('assignment-reminder');
    expect(bar.textContent).toContain('2');
    expect(bar.compareDocumentPosition(screen.getByTestId('entry-ai')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(bar);
    expect(screen.getByTestId('where').textContent).toBe('/assignments');
    unmount();
    renderIn(<LearningEntryCards pendingAssignments={0} />);
    expect(screen.queryByTestId('assignment-reminder')).toBeNull();
  });

  it('按「讓 AI 派一課」才去要推薦，出現 2 張卡', async () => {
    renderIn(<LearningEntryCards />);
    expect(recApi.fn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '讓 AI 派一課' }));
    expect(await screen.findAllByTestId('dispatch-card')).toHaveLength(2);
  });
});

describe('DispatchPicker', () => {
  it('每次 2 張卡，每張都有課名與一句推薦理由', async () => {
    renderIn(<DispatchPicker />);
    const cards = await screen.findAllByTestId('dispatch-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('課1');
    expect(within(cards[0]).getByTestId('dispatch-reason').textContent).toContain('理由1');
    expect(within(cards[1]).getByTestId('dispatch-reason').textContent).toContain('理由2');
  });

  it('沒有推薦理由時補一句預設的，不留空', async () => {
    recApi.fn.mockResolvedValue({ recommendations: [rec(1, ''), rec(2, '')], total: 2 });
    renderIn(<DispatchPicker />);
    const reasons = await screen.findAllByTestId('dispatch-reason');
    expect(reasons.every((r) => r.textContent!.length > 8)).toBe(true);
  });

  it('再派一組：出現新的 2 張（不重複）', async () => {
    renderIn(<DispatchPicker />);
    await screen.findAllByTestId('dispatch-card');
    fireEvent.click(screen.getByRole('button', { name: '再派一組' }));
    await waitFor(() => expect(screen.getAllByTestId('dispatch-card')[0].textContent).toContain('課3'));
    expect(screen.getAllByTestId('dispatch-card')[1].textContent).toContain('課4');
  });

  it('轉完一輪後再按，會接著換到第二組，不會永遠停在第一組（審查擋合併）', async () => {
    recApi.fn.mockResolvedValue({ recommendations: [1, 2, 3, 4, 5].map((n) => rec(n)), total: 5 });
    renderIn(<DispatchPicker />);
    const titles = () => screen.getAllByTestId('dispatch-card').map((c) => c.querySelector('h4')!.textContent);
    await screen.findAllByTestId('dispatch-card');
    const seen: string[] = [titles().join(',')];
    // 5 課每次 2 張：課1課2 → 課3課4 → 課5 → 回到課1課2 → 要換成課3課4
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: '再派一組' }));
      await waitFor(() => expect(titles().join(',')).not.toBe(seen[seen.length - 1]));
      seen.push(titles().join(','));
    }
    expect(seen).toEqual(['課1,課2', '課3,課4', '課5', '課1,課2', '課3,課4']);
  });

  it('年級是文字的課（文言文）照樣派得出來，卡片寫「文言文」，數字年級寫「第 4 級」', async () => {
    recApi.fn.mockResolvedValue({ recommendations: [{ ...rec(1), grade: '文言文' }, rec(2)], total: 2 });
    renderIn(<DispatchPicker />);
    const cards = await screen.findAllByTestId('dispatch-card');
    expect(cards[0].textContent).toContain('文言文');
    expect(cards[1].textContent).toContain('第 4 級');
  });

  it('派完一輪會從頭再來，不會變空白', async () => {
    recApi.fn.mockResolvedValue({ recommendations: [rec(1), rec(2)], total: 2 });
    renderIn(<DispatchPicker />);
    await screen.findAllByTestId('dispatch-card');
    fireEvent.click(screen.getByRole('button', { name: '再派一組' }));
    await waitFor(() => expect(screen.getAllByTestId('dispatch-card')).toHaveLength(2));
  });

  it('報告頁用法：先只有「再派一組」按鈕，按了才要推薦，而且不含剛做完的這一課', async () => {
    renderIn(<DispatchPicker excludeSlug="S1" autoStart={false} />);
    expect(recApi.fn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '再派一組' }));
    const cards = await screen.findAllByTestId('dispatch-card');
    expect(cards.map((c) => c.textContent).join('')).not.toContain('課1');
    expect(cards[0].textContent).toContain('課2');
  });

  it('選一張卡進入該課的課程簡介', async () => {
    renderIn(<DispatchPicker />);
    const cards = await screen.findAllByTestId('dispatch-card');
    fireEvent.click(within(cards[1]).getByRole('button', { name: '選這課開始' }));
    expect(screen.getByTestId('where').textContent).toBe('/learn/S2/lesson-intro');
  });

  it('選卡時記下「這一課是從 AI 派發進來的」，讓建立學習紀錄時能標記（#4161）', async () => {
    sessionStorage.clear();
    renderIn(<DispatchPicker />);
    const cards = await screen.findAllByTestId('dispatch-card');
    expect(sessionStorage.getItem('lingoleap_entry_source')).toBeNull(); // 還沒選之前沒有標記
    fireEvent.click(within(cards[1]).getByRole('button', { name: '選這課開始' }));
    // 標記的是選的那一課（S2），不是另一張（S1）
    const stored = JSON.parse(sessionStorage.getItem('lingoleap_entry_source')!);
    expect(stored).toMatchObject({ storyId: 'S2', source: 'ai_dispatch' });
  });

  it('新帳號沒有紀錄時後端依年級回推薦，照樣是 2 張卡不是空白', async () => {
    recApi.fn.mockResolvedValue({ recommendations: [rec(1, '難度符合你目前的程度（4 年級）'), rec(2, '難度略高，適合挑戰')], total: 2 });
    renderIn(<DispatchPicker />);
    expect(await screen.findAllByTestId('dispatch-card')).toHaveLength(2);
  });

  it('推薦完全派不出來：說明並引導去圖書館，不留空白', async () => {
    recApi.fn.mockResolvedValue({ recommendations: [], total: 0 });
    renderIn(<DispatchPicker />);
    expect(await screen.findByText(/去圖書館自己挑/)).toBeTruthy();
  });

  it('讀取失敗：顯示可再試的訊息，按了會重抓', async () => {
    recApi.fn.mockRejectedValueOnce(new Error('x'));
    renderIn(<DispatchPicker />);
    fireEvent.click(await screen.findByRole('button', { name: '再試一次' }));
    expect(await screen.findAllByTestId('dispatch-card')).toHaveLength(2);
  });
});
