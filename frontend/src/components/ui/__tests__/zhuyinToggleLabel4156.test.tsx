/**
 * #4156 —— 注音切換要讓第一次看到的人知道它控制什麼：
 * 有「注音」標籤，三格是完整詞「不顯示／難字／全部」。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ZhuyinToggle from '../ZhuyinToggle';

describe('#4156 注音切換標籤', () => {
  it('⭐ 看得到「注音」標籤與三個完整詞的選項', () => {
    render(<ZhuyinToggle mode="none" ready onModeChange={() => {}} />);
    expect(screen.getByText('注音')).toBeTruthy();
    expect(screen.getByRole('button', { name: '關閉注音' }).textContent).toBe('不顯示');
    expect(screen.getByRole('button', { name: '只標你唸錯過的字' }).textContent).toBe('難字');
    expect(screen.getByRole('button', { name: '顯示全文注音' }).textContent).toBe('全部');
  });

  it('⛔ 點選項仍會回傳對應模式（沒因改字弄壞）', async () => {
    const onMode = vi.fn();
    render(<ZhuyinToggle mode="none" ready onModeChange={onMode} />);
    await userEvent.click(screen.getByRole('button', { name: '顯示全文注音' }));
    expect(onMode).toHaveBeenCalledWith('all');
    await userEvent.click(screen.getByRole('button', { name: '只標你唸錯過的字' }));
    expect(onMode).toHaveBeenCalledWith('difficult');
  });
});
