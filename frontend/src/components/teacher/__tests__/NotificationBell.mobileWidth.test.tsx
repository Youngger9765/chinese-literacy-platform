/**
 * #3425: the notification bell's dropdown panel is now also rendered inside
 * the teacher mobile "更多" drawer (Sidebar.tsx). Its fixed `w-96` (384px)
 * would overflow a 390px phone screen; `max-w-[calc(100vw-2rem)]` caps it.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NotificationBell from '../NotificationBell';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../../../services/teacherApi', () => ({
  getTeacherNotifications: vi.fn(() => Promise.resolve({ total: 0, unread: 0, items: [] })),
  markAllNotificationsRead: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

describe('NotificationBell — mobile width safety (#3425)', () => {
  it('the panel caps its width to the viewport so it cannot overflow a 390px screen', async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: /通知中心/ }));
    const panel = await waitFor(() => screen.getByText('通知中心').closest('div.absolute')!);
    expect(panel.className).toMatch(/max-w-\[calc\(100vw-2rem\)\]/);
  });
});
