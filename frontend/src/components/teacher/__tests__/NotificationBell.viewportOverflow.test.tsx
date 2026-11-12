/**
 * Issue #3985: the bell sits in the sidebar footer, close to the bottom of
 * the viewport on most screen heights. The panel used to always open
 * downward (`top-full`) with a flat `max-h-[80vh]`, which assumed there was
 * always 80% of the viewport free *below* the button. When the button is
 * near the bottom (confirmed on staging: button at y≈790 on a 900px-tall
 * viewport), the panel's own box was the right height but rendered mostly
 * past the bottom of the screen, where the app shell's `overflow-hidden`
 * (no page scroll, by design) clipped it — only ~1 row was ever visible,
 * regardless of how many notifications existed or whether the inner list
 * could itself scroll.
 *
 * This locks two things that must both hold once the button is this close
 * to the bottom: the panel flips to open *upward* (`bottom-full`), and its
 * max-height is bounded by the space that is actually available (not a flat
 * 80vh), so the whole box — header, filters, and some rows — stays inside
 * the visible viewport.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import NotificationBell from '../NotificationBell';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../../../services/teacherApi', () => ({
  getTeacherNotifications: vi.fn(() =>
    Promise.resolve({
      total: 2,
      unread: 2,
      items: [
        { alert_key: 'a1', alert_type: 'inactive', student_name: '學生A', classroom_name: '班A', detail: 'x', is_read: false, classroom_id: 1, student_id: 1 },
        { alert_key: 'a2', alert_type: 'inactive', student_name: '學生B', classroom_name: '班A', detail: 'x', is_read: false, classroom_id: 1, student_id: 2 },
      ],
    }),
  ),
  markAllNotificationsRead: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

describe('NotificationBell — viewport-aware placement (#3985)', () => {
  const originalInnerHeight = window.innerHeight;

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
    vi.restoreAllMocks();
  });

  it('flips the panel upward and bounds its height when the button has little room below it', async () => {
    // Simulate the real staging measurement: 900px-tall viewport, button
    // near the bottom at y=790 (so only ~110px is free below it, well under
    // the 240px threshold the component uses to decide it's "cramped").
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    HTMLElement.prototype.getBoundingClientRect = vi.fn(function (this: HTMLElement) {
      if (this.getAttribute('aria-label')?.includes('通知中心')) {
        return { top: 790, bottom: 814, left: 0, right: 0, width: 0, height: 24, x: 0, y: 790, toJSON() {} } as DOMRect;
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: /通知中心/ }));
    const panel = await waitFor(() => screen.getByText('通知中心').closest('div.absolute')!);

    // Must open upward, not downward — the whole point of the fix.
    expect(panel.className).toMatch(/bottom-full/);
    expect(panel.className).not.toMatch(/top-full/);

    // Must bound itself to the space actually above the button (~774px),
    // not a flat 80vh (720px here) that ignores where the button sits.
    const maxHeight = parseFloat((panel as HTMLElement).style.maxHeight);
    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThanOrEqual(900 * 0.8 + 1);
  });

  it('keeps the normal drop-down when there is plenty of room below the button', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    HTMLElement.prototype.getBoundingClientRect = vi.fn(function (this: HTMLElement) {
      if (this.getAttribute('aria-label')?.includes('通知中心')) {
        return { top: 80, bottom: 104, left: 0, right: 0, width: 0, height: 24, x: 0, y: 80, toJSON() {} } as DOMRect;
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });

    render(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: /通知中心/ }));
    const panel = await waitFor(() => screen.getByText('通知中心').closest('div.absolute')!);

    expect(panel.className).toMatch(/top-full/);
    expect(panel.className).not.toMatch(/bottom-full/);
  });
});
