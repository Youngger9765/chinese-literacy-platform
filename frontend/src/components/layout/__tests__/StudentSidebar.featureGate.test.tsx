/**
 * issue #3633 — 遊戲化模式集中成一個「遊戲區」入口 (student side).
 *
 * REWRITE of the #3607 feature-gate test: 我們班／課堂搶答／PK 對戰 used to
 * be three separate, individually-gated sidebar entries. They are now
 * collapsed into a single, ALWAYS-visible 「遊戲區」 entry pointing at
 * `/game-hub` — the per-mode locking (老師尚未開啟 for 跨班賽季/課堂搶答)
 * moved to the hub page's cards (see StudentGameHubPage.test.tsx), so the
 * sidebar itself no longer needs `leagueEnabled`/`liveQuizEnabled` at all.
 *
 * 五人對抗賽 and 迷城密室 never had sidebar entries (迷城密室 is exactly the
 * bug this issue fixes — "有頁面但側欄完全沒有入口") — both only appear as
 * cards inside the hub page, not here.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { StudentSidebar, getStudentNavItems } from '../StudentSidebar';

const renderWithRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('getStudentNavItems — game-hub consolidation (#3633)', () => {
  it('has exactly one 遊戲區 item pointing at /game-hub', () => {
    const items = getStudentNavItems(0);
    const gameHubItems = items.filter((i) => i.label === '遊戲區');
    expect(gameHubItems).toHaveLength(1);
    expect(gameHubItems[0].path).toBe('/game-hub');
  });

  it('no longer has separate 我們班／課堂搶答／PK 對戰 entries', () => {
    const items = getStudentNavItems(0);
    expect(items.find((i) => i.label === '我們班')).toBeUndefined();
    expect(items.find((i) => i.label === '課堂搶答')).toBeUndefined();
    expect(items.find((i) => i.label === 'PK 對戰')).toBeUndefined();
  });

  it('遊戲區 is always present regardless of how many args are passed (no flags needed any more)', () => {
    expect(getStudentNavItems().find((i) => i.label === '遊戲區')).toBeDefined();
    expect(getStudentNavItems(5).find((i) => i.label === '遊戲區')).toBeDefined();
  });
});

describe('<StudentSidebar> — renders the single 遊戲區 entry (#3633)', () => {
  it('renders exactly one 遊戲區 button, never the old three', () => {
    renderWithRouter(<StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /遊戲區/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /我們班/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /課堂搶答/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /PK 對戰/ })).toBeNull();
  });
});
