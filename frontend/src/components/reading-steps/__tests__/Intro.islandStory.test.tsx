/**
 * 喝采島故事模式：一次一關。課程簡介不能出現「點擊可快速跳轉」的步驟清單，
 * 也不能有「返回圖書館」——那會把學生從島上帶走。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({ zhuyinActive: false, processZhuyin: (t: string) => t }),
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('../../../services/omoApi', () => ({
  getPriorOmoUploadByLesson: vi.fn().mockResolvedValue({ has_prior_upload: false }),
  getOmoImageSignedUrl: vi.fn(),
}));
vi.mock('../../../hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn() }));
vi.mock('../../../config/stepConfig', () => ({
  resolveActiveSteps: () => [
    { id: 'full-text-annotate', label: '做記號' },
    { id: 'paragraph-reading', label: '逐段朗讀' },
  ],
}));

import Intro from '../Intro';
import type { Story } from '../../../types';

const story = {
  id: 'L01',
  title: '測試課文',
  level: '3',
  content: ['段落一'],
  thumbnail: '/t.jpg',
  category: 'Fable',
  filename: 'L01.yml',
  vocabulary: [],
  intro: { author: '作者', background: '背景' },
} as unknown as Story;

describe('Intro in island story mode', () => {
  it('hides the step quick-jump chips and the back-to-library link', () => {
    render(<Intro story={story} onStartReading={vi.fn()} storyMode />);
    expect(screen.queryByRole('button', { name: /跳轉到第/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '返回圖書館' })).toBeNull();
    expect(screen.getByRole('button', { name: /開始學習/ })).toBeTruthy();
  });

  it('positive control: normal mode still shows both', () => {
    render(<Intro story={story} onStartReading={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /跳轉到第/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '返回圖書館' })).toBeTruthy();
  });

  /**
   * #3780 P0-3（playtest 2026-10-26）：故事模式下「開始學習」孩子不知道
   * 這代表「點亮燈塔」，跟島上的視覺語言脫節。`IntroPage.tsx` 在故事模式
   * 會傳 `storyModeCtaLabel`，這支測試鎖「傳了就要用，沒傳就是舊行為」。
   */
  it('shows the lighthouse-lit-up CTA when storyModeCtaLabel is given in story mode', () => {
    render(<Intro story={story} onStartReading={vi.fn()} storyMode storyModeCtaLabel="讀完了，點亮燈塔" />);
    expect(screen.getByRole('button', { name: '讀完了，點亮燈塔' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^開始學習/ })).toBeNull();
  });

  it('does not use storyModeCtaLabel outside of story mode even if a caller passes one by mistake', () => {
    render(<Intro story={story} onStartReading={vi.fn()} onBack={vi.fn()} storyModeCtaLabel="讀完了，點亮燈塔" />);
    expect(screen.getByRole('button', { name: /開始學習/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '讀完了，點亮燈塔' })).toBeNull();
  });
});
