/**
 * LiveQuizWaitingRoom — #3761 (round 3 "遊戲大廳" rebuild). Locks:
 * (1) title + hero image present
 * (2) my name/avatar card shows the real name, not a placeholder
 * (3) the anonymous peer wall renders exactly `playersCount - 1` glyphs
 *     (never a real classmate name — see module docstring on why)
 * (4) solo-join (playersCount === 1) shows the "你是第一位加入的" message
 *     instead of an empty wall
 * (5) 怎麼玩 3 steps render
 * (6) 離開 button calls onLeave
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LiveQuizWaitingRoom from '../LiveQuizWaitingRoom';

describe('<LiveQuizWaitingRoom> (#3761)', () => {
  it('shows the title and hero image', () => {
    render(<LiveQuizWaitingRoom myName="小明" playersCount={1} onLeave={() => {}} />);
    expect(screen.getByRole('heading', { name: '等待老師開始搶答' })).toBeTruthy();
    expect(document.querySelector('img[src="/story-assets/live-quiz-hub/icon.png"]')).toBeTruthy();
  });

  it("shows the student's own name on their card", () => {
    render(<LiveQuizWaitingRoom myName="審查員甲" playersCount={1} onLeave={() => {}} />);
    expect(screen.getByText('審查員甲')).toBeTruthy();
    expect(screen.getByText('你')).toBeTruthy();
  });

  it('renders playersCount-1 anonymous peer avatars, numbered (同學1/同學2/...), never a classmate name (privacy: backend only gives students a count, not names)', () => {
    render(<LiveQuizWaitingRoom myName="小明" playersCount={4} onLeave={() => {}} />);
    expect(screen.getByText('目前已有 4 人加入')).toBeTruthy();
    // 3 others besides "me" — numbered placeholders, never a real name.
    expect(screen.getByText('同學1')).toBeTruthy();
    expect(screen.getByText('同學2')).toBeTruthy();
    expect(screen.getByText('同學3')).toBeTruthy();
    expect(screen.queryByText('同學4')).toBeNull();
  });

  it('#3761 round 4: each anonymous peer gets a distinct cycling color, not one flat gray', () => {
    render(<LiveQuizWaitingRoom myName="小明" playersCount={4} onLeave={() => {}} />);
    const first = screen.getByText('1', { selector: 'div' });
    const second = screen.getByText('2', { selector: 'div' });
    const third = screen.getByText('3', { selector: 'div' });
    const colors = [first, second, third].map((el) => (el as HTMLElement).style.backgroundColor);
    expect(new Set(colors).size).toBe(3);
    colors.forEach((c) => expect(c).not.toBe(''));
  });

  it('solo join (playersCount=1) shows "你是第一位加入的" instead of an empty wall', () => {
    render(<LiveQuizWaitingRoom myName="小明" playersCount={1} onLeave={() => {}} />);
    expect(screen.getByText('你是第一位加入的，等其他同學一起來吧')).toBeTruthy();
  });

  it('playersCount=0 (poll has not caught up yet) shows "還沒有人加入", not "0 人加入"', () => {
    render(<LiveQuizWaitingRoom myName="小明" playersCount={0} onLeave={() => {}} />);
    expect(screen.getByText('還沒有人加入')).toBeTruthy();
  });

  it('renders all 3 怎麼玩 steps', () => {
    render(<LiveQuizWaitingRoom myName="小明" playersCount={1} onLeave={() => {}} />);
    expect(screen.getByText('怎麼玩？')).toBeTruthy();
    expect(screen.getByText('老師開始後，螢幕上會出現題目')).toBeTruthy();
    expect(screen.getByText('答得又對又快，分數越高')).toBeTruthy();
    expect(screen.getByText('答錯或沒答不會倒扣分數')).toBeTruthy();
  });

  it('離開 button calls onLeave', () => {
    const onLeave = vi.fn();
    render(<LiveQuizWaitingRoom myName="小明" playersCount={1} onLeave={onLeave} />);
    fireEvent.click(screen.getByRole('button', { name: /離開/ }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('#3761 round 4 (Young: "桌機請讓大廳卡片填滿可視高度"): the gradient card stretches to fill its flex parent instead of staying only as tall as its own content', () => {
    const { container } = render(<LiveQuizWaitingRoom myName="小明" playersCount={1} onLeave={() => {}} />);
    const card = container.querySelector('[data-testid="lobby-card"]');
    expect(card).toBeTruthy();
    expect(card?.className).toContain('flex-1');
  });

  it('#3761 round 4 (Young: "加上「老師開始後自動進入第一題」的倒數感提示"): shows a hint that the student does not need to tap anything — the first question appears on its own once the teacher starts', () => {
    render(<LiveQuizWaitingRoom myName="小明" playersCount={1} onLeave={() => {}} />);
    expect(screen.getByText(/老師開始後.*自動/)).toBeTruthy();
  });

  it('#3761 round 4 (Young: "把同學牆區放大成多列格狀"): the peer wall is laid out as a grid, not a single wrapping row', () => {
    const { container } = render(<LiveQuizWaitingRoom myName="小明" playersCount={4} onLeave={() => {}} />);
    const wall = container.querySelector('[data-testid="peer-wall"]');
    expect(wall?.className).toContain('grid');
  });
});
