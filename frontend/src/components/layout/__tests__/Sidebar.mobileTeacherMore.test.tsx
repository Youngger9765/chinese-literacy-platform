/**
 * #3425: 手機版（390）教師端找不到「登出」與通知鈴。
 *
 * Root cause: MobileTabBar's "☰ 更多" button only renders when
 * `moreItems.length > 0 || hasMultipleViews`. A plain teacher (one
 * workspace view) only has 3 primary items (班級管理/作業管理/使用說明)
 * and no extraItems, so moreItems was empty -- the button, and everything
 * inside its drawer (登出 was already there but unreachable, 隱私政策,
 * the notification bell), never appeared.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { name: '李老師', roles: ['teacher'] },
    logout: vi.fn(),
  }),
}));

vi.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeView: 'teacher',
    setActiveView: vi.fn(),
    availableViews: ['teacher'],
    hasMultipleViews: false,
  }),
}));

vi.mock('../../../contexts/LearningNavContext', () => ({
  useLearningNav: () => ({ selectedStory: null }),
}));

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({ zhuyinMode: 'off', zhuyinReady: true, setZhuyinMode: vi.fn() }),
}));

vi.mock('../../../services/authApi', () => ({
  hasRole: () => true,
}));

vi.mock('../../teacher/NotificationBell', () => ({
  default: () => <div data-testid="notification-bell">通知鈴</div>,
}));

vi.mock('../../ui/ZhuyinToggle', () => ({
  default: () => <div data-testid="zhuyin-toggle" />,
}));

import Sidebar from '../Sidebar';

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={['/teacher']}>
      <Sidebar pendingAssignmentCount={0} />
    </MemoryRouter>,
  );
}

describe('Sidebar mobile — teacher gets a 更多 button (#3425)', () => {
  it('shows the 更多 button for a single-view teacher (previously hidden)', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: '更多選項' })).toBeInTheDocument();
  });

  // 桌面版的 aside（hidden md:flex）在 jsdom 裡仍會渲染出 DOM，只是靠 CSS 隱藏；
  // 底下三個斷言都把查詢範圍限定在手機版「更多」抽屜（role="dialog"）裡，
  // 避免跟桌面版重複的 登出/隱私政策/通知鈴 撞名。

  it('opening 更多 reveals 登出', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '更多選項' }));
    const drawer = screen.getByRole('dialog', { name: '更多導覽選項' });
    expect(within(drawer).getByRole('button', { name: '登出' })).toBeInTheDocument();
  });

  it('opening 更多 reveals 隱私政策', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '更多選項' }));
    const drawer = screen.getByRole('dialog', { name: '更多導覽選項' });
    expect(within(drawer).getByRole('button', { name: '隱私政策' })).toBeInTheDocument();
  });

  it('opening 更多 reveals the notification center', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '更多選項' }));
    const drawer = screen.getByRole('dialog', { name: '更多導覽選項' });
    expect(within(drawer).getByTestId('notification-bell')).toBeInTheDocument();
  });
});
