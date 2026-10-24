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

  it('renders playersCount-1 anonymous peer glyphs, never a classmate name (privacy: backend only gives students a count, not names)', () => {
    render(<LiveQuizWaitingRoom myName="小明" playersCount={4} onLeave={() => {}} />);
    expect(screen.getByText('目前已有 4 人加入')).toBeTruthy();
    // 3 others besides "me" — each is a plain SVG glyph, not a name.
    const peerGlyphs = document.querySelectorAll('svg circle[cx="12"][cy="8"]');
    expect(peerGlyphs.length).toBe(3);
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
});
