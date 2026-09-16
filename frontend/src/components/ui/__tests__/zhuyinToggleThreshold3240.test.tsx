/**
 * #3240 —— 門檻控制的 UI，以及 #3224 之後過期的那句 tooltip。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import ZhuyinToggle from '../ZhuyinToggle';

describe('#3240 難字門檻的 UI', () => {
  it('⭐ 難字模式下看得到門檻，並且按得動', async () => {
    const onT = vi.fn();
    render(
      <ZhuyinToggle mode="difficult" ready onModeChange={() => {}}
        difficultThreshold={2} onThresholdChange={onT} />,
    );
    expect(screen.getByRole('group', { name: '難字門檻' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /提高難字門檻/ }));
    expect(onT).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: /降低難字門檻/ }));
    expect(onT).toHaveBeenCalledWith(1);
  });

  it('⛔ 其他模式下不顯示門檻（常駐只會讓開關變寬）', () => {
    for (const mode of ['none', 'all'] as const) {
      const { unmount } = render(
        <ZhuyinToggle mode={mode} ready onModeChange={() => {}}
          difficultThreshold={2} onThresholdChange={() => {}} />,
      );
      expect(screen.queryByRole('group', { name: '難字門檻' })).toBeNull();
      unmount();
    }
  });

  it('⛔ 沒傳門檻 props 也不會壞（AppShell / Sidebar 兩邊都 render 它）', () => {
    render(<ZhuyinToggle mode="difficult" ready onModeChange={() => {}} />);
    expect(screen.getByRole('group', { name: '注音顯示模式' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: '難字門檻' })).toBeNull();
  });

  it('⛔ 邊界時按鈕 disabled（不會送出越界值）', () => {
    const { unmount } = render(
      <ZhuyinToggle mode="difficult" ready onModeChange={() => {}}
        difficultThreshold={1} onThresholdChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /降低難字門檻/ })).toHaveProperty('disabled', true);
    unmount();
    render(
      <ZhuyinToggle mode="difficult" ready onModeChange={() => {}}
        difficultThreshold={5} onThresholdChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /提高難字門檻/ })).toHaveProperty('disabled', true);
  });

  it('⭐ 難字的說明不再寫「詞彙表」（#3224 之後那句話就不對了）', () => {
    render(<ZhuyinToggle mode="none" ready onModeChange={() => {}} />);
    const btn = screen.getByRole('button', { name: /唸錯過的字/ });
    expect(btn).toBeTruthy();
    expect(screen.queryByRole('button', { name: /詞彙表/ })).toBeNull();
  });
});
