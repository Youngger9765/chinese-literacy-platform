/**
 * GameResultActions — #3771 (game-academy audit r2, P0-2): 團體擂台與課堂
 * 搶答的結算/提前結束畫面「零個互動元素，無法離開」, 只能按瀏覽器上一頁.
 * PK 結算頁 (PkResultScreen.tsx) 早就有「再戰一場/換對手/返回」——這是把
 * 那個模式抽出來的最小共用版本（兩個按鈕：再玩一場 + 回遊戲區），套進還沒
 * 跟上的兩個玩法，不動 PK 自己已經在用的三按鈕版本。
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GameResultActions from '../GameResultActions';

describe('GameResultActions', () => {
  it('renders both buttons with the given labels and calls the right handler on click', () => {
    const onReplay = vi.fn();
    const onBackToHub = vi.fn();
    render(
      <GameResultActions
        onReplay={onReplay}
        replayLabel="再玩一場"
        onBackToHub={onBackToHub}
        backLabel="回遊戲區"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '再玩一場' }));
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(onBackToHub).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '回遊戲區' }));
    expect(onBackToHub).toHaveBeenCalledTimes(1);
  });

  it('omitting onReplay renders only the back button (课堂搶答 has no "再玩一場" of its own — the teacher starts a new round)', () => {
    const onBackToHub = vi.fn();
    render(<GameResultActions onBackToHub={onBackToHub} />);

    expect(screen.queryByRole('button', { name: /再玩/ })).toBeNull();
    expect(screen.getByRole('button', { name: '回遊戲區' })).toBeTruthy();
  });

  it('defaults the labels to 再玩一場 / 回遊戲區 when not given', () => {
    render(<GameResultActions onReplay={() => {}} onBackToHub={() => {}} />);
    expect(screen.getByRole('button', { name: '再玩一場' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '回遊戲區' })).toBeTruthy();
  });
});
