/**
 * issue #3633 — 遊戲化模式集中成一個「遊戲區」入口 (teacher side).
 *
 * 跨班賽季 (/teacher/league) and 課堂搶答 (/teacher/live) used to be two
 * separate sidebar entries. They collapse into a single 「遊戲區」 entry
 * pointing at /teacher/game-hub, which gathers the per-class switches
 * (reusing <ClassroomPkSettingsPanel>) and links out to the existing pages
 * (see TeacherGameHubPage.test.tsx). The old routes are untouched.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { TeacherSidebar, getTeacherNavItems } from '../TeacherSidebar';

const renderWithRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('getTeacherNavItems — game-hub consolidation (#3633)', () => {
  it('has exactly one 遊戲區 item pointing at /teacher/game-hub', () => {
    const items = getTeacherNavItems();
    const gameHubItems = items.filter((i) => i.label === '遊戲區');
    expect(gameHubItems).toHaveLength(1);
    expect(gameHubItems[0].path).toBe('/teacher/game-hub');
  });

  it('no longer has separate 跨班賽季／課堂搶答 entries', () => {
    const items = getTeacherNavItems();
    expect(items.find((i) => i.label === '跨班賽季')).toBeUndefined();
    expect(items.find((i) => i.label === '課堂搶答')).toBeUndefined();
  });

  it('still has 班級管理／作業管理／使用說明 unchanged', () => {
    const items = getTeacherNavItems();
    expect(items.find((i) => i.label === '班級管理')).toBeDefined();
    expect(items.find((i) => i.label === '作業管理')).toBeDefined();
    expect(items.find((i) => i.label === '使用說明')).toBeDefined();
  });
});

describe('<TeacherSidebar> — renders the single 遊戲區 entry (#3633)', () => {
  it('renders exactly one 遊戲區 button, never the old two', () => {
    renderWithRouter(<TeacherSidebar collapsed={false} onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /遊戲區/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /跨班賽季/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /課堂搶答/ })).toBeNull();
  });
});
