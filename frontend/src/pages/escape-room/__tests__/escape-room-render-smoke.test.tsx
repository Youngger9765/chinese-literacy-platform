import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: '測試憑證', user: { id: 1, name: '小明' } }),
}));

vi.mock('../../../services/learning/session', () => ({
  fetchMyEnrolledClassrooms: vi.fn(() => Promise.resolve({ classrooms: [], student_grade: 4 })),
}));

vi.mock('../../../components/pk/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

const RUN_STATE = vi.hoisted(() => ({
  run_id: 1,
  status: 'in_progress' as const,
  mist_distance: 50,
  unlocked_chambers: 0,
  teammates: [
    { slug: 'bookworm', frozen: false },
    { slug: 'lantern', frozen: true },
    { slug: 'compass', frozen: false },
  ],
  abilities_used: [],
  current_chamber: {
    chamber_index: 0,
    stem: '哪一個選項最合適？',
    options: [{ key: '甲', text: '第一個答案' }, { key: '乙', text: '第二個答案' }],
    seconds: 30,
    extra_time_ms: 0,
  },
  rescue_question: null,
  gate_question: null,
  story_intro: '翻開《測試故事》，和三位夥伴一起找回被迷霧吞沒的文字',
  mist_message: '迷霧正在遠離',
}));

vi.mock('../../../services/escapeRoomApi', () => ({
  EscapeRoomApiError: class EscapeRoomApiError extends Error {},
  startEscapeRoomRun: vi.fn(() => Promise.resolve({ run_id: 1 })),
  getEscapeRoomRunState: vi.fn(() => Promise.resolve(RUN_STATE)),
  submitEscapeRoomAnswer: vi.fn(() => Promise.resolve(RUN_STATE)),
  submitEscapeRoomGateAnswer: vi.fn(() => Promise.resolve(RUN_STATE)),
  submitEscapeRoomRescue: vi.fn(() => Promise.resolve(RUN_STATE)),
  activateEscapeRoomAbility: vi.fn(() => Promise.resolve(RUN_STATE)),
  getEscapeRoomResult: vi.fn(() => Promise.resolve({ run_id: 1, result: 'escaped', message: '已逃脫', unlocked_skins: [] })),
  getEscapeRoomUnlocks: vi.fn(() => Promise.resolve({ unlocks: [] })),
}));

import AbilityBar from '../../../components/escape-room/AbilityBar';
import ChoiceButtons from '../../../components/escape-room/ChoiceButtons';
import MistBar from '../../../components/escape-room/MistBar';
import TeammateRow from '../../../components/escape-room/TeammateRow';
import StudentEscapeRoomEntry from '../StudentEscapeRoomEntry';
import StudentEscapeRoomRun from '../StudentEscapeRoomRun';
import { getEscapeRoomRunState } from '../../../services/escapeRoomApi';

function renderAt(path: string, routePath: string, Element: React.FC): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path={routePath} element={<Element />} /></Routes>
    </MemoryRouter>,
  );
}

describe('迷城密室 render smoke', () => {
  it('兩個頁面與共享元件都能 mount', () => {
    expect(() => renderAt('/escape-room', '/escape-room', StudentEscapeRoomEntry)).not.toThrow();
    expect(() => renderAt('/escape-room/run/1', '/escape-room/run/:runId', StudentEscapeRoomRun)).not.toThrow();
    expect(() => render(<MistBar distance={2} maxDistance={5} reducedMotion message="文字提示" />)).not.toThrow();
    expect(() => render(<TeammateRow teammates={RUN_STATE.teammates} />)).not.toThrow();
    expect(() => render(<AbilityBar used={[]} disabled={false} onUse={() => {}} />)).not.toThrow();
    expect(() => render(<ChoiceButtons options={RUN_STATE.current_chamber.options} disabled={false} onSelect={() => {}} />)).not.toThrow();
  });
});

describe('迷城密室無障礙', () => {
  it('reduced-motion 將迷霧切換成靜態結構', () => {
    render(<MistBar distance={2} maxDistance={5} reducedMotion message="文字提示" />);
    expect(screen.getByTestId('mist-fill')).toHaveAttribute('data-motion', 'static');
  });

  it('選項與能力卡都是可用鍵盤觸發的原生按鈕', async () => {
    const onSelect = vi.fn();
    const onUse = vi.fn();
    render(
      <>
        <ChoiceButtons options={RUN_STATE.current_chamber.options} disabled={false} onSelect={onSelect} />
        <AbilityBar used={[]} disabled={false} onUse={onUse} />
      </>,
    );
    const user = userEvent.setup();
    const option = screen.getByRole('button', { name: '選項 甲：第一個答案' });
    expect(option.tagName).toBe('BUTTON');
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('甲');
    const ability = screen.getByRole('button', { name: '提示卡，排除一個選項' });
    expect(ability.tagName).toBe('BUTTON');
    fireEvent.click(ability);
    expect(onUse).toHaveBeenCalledWith('hint');
  });

  it('提示卡後只顯示安全 state 提供的一個選項', async () => {
    vi.mocked(getEscapeRoomRunState).mockResolvedValueOnce({
      ...RUN_STATE,
      abilities_used: ['hint'],
      current_chamber: {
        ...RUN_STATE.current_chamber,
        options: [{ key: '乙', text: '第二個答案' }],
      },
    });

    renderAt('/escape-room/run/1', '/escape-room/run/:runId', StudentEscapeRoomRun);

    expect(await screen.findAllByRole('button', { name: /選項/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '選項 乙：第二個答案' })).toBeInTheDocument();
  });
});

describe('迷城密室文案', () => {
  it('主畫面不顯示禁止的英文或懲罰性結局用語', async () => {
    renderAt('/escape-room/run/1', '/escape-room/run/:runId', StudentEscapeRoomRun);
    expect(await screen.findByText('哪一個選項最合適？')).toBeInTheDocument();
    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toMatch(/GAME OVER|失敗|你輸了|Start|Error/);
  });
});
