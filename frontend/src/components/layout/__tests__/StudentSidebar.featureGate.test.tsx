/**
 * issue #3607 — 跨班賽季 (league) and 課堂搶答 (live_quiz) sidebar entries are
 * hidden by default per classroom, same pattern as pk_human's existing
 * StudentPkEntry.tsx "ANY enrolled classroom has it on" logic. These tests
 * cover StudentSidebar's own entry-visibility prop surface directly
 * (getStudentNavItems + <StudentSidebar> render) — the data-fetching that
 * computes these flags lives one level up in Sidebar.tsx and is exercised
 * manually via staging QA (not unit-tested here, consistent with how this
 * file never tested Sidebar.tsx's own data fetching either).
 *
 * PK 對戰 ("/pk") must remain unconditionally visible regardless of the
 * flags — AI PK (挑戰文學家) is never gated by classroom settings
 * (Young 2026-10-16: "AI PK 跟班級無關").
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { StudentSidebar, getStudentNavItems } from '../StudentSidebar';

const renderWithRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('getStudentNavItems — feature flags (#3607)', () => {
  it('hides 我們班 and 課堂搶答 when no flags are passed (default: hidden until known)', () => {
    const items = getStudentNavItems(0);
    expect(items.find((i) => i.label === '我們班')).toBeUndefined();
    expect(items.find((i) => i.label === '課堂搶答')).toBeUndefined();
  });

  it('shows 我們班 only when league=true', () => {
    const items = getStudentNavItems(0, { league: true, liveQuiz: false });
    expect(items.find((i) => i.label === '我們班')).toBeDefined();
    expect(items.find((i) => i.label === '課堂搶答')).toBeUndefined();
  });

  it('shows 課堂搶答 only when liveQuiz=true', () => {
    const items = getStudentNavItems(0, { league: false, liveQuiz: true });
    expect(items.find((i) => i.label === '我們班')).toBeUndefined();
    expect(items.find((i) => i.label === '課堂搶答')).toBeDefined();
  });

  it('shows both when both flags are true', () => {
    const items = getStudentNavItems(0, { league: true, liveQuiz: true });
    expect(items.find((i) => i.label === '我們班')).toBeDefined();
    expect(items.find((i) => i.label === '課堂搶答')).toBeDefined();
  });

  it('PK 對戰 is always present regardless of flags (AI PK is never gated)', () => {
    expect(getStudentNavItems(0).find((i) => i.label === 'PK 對戰')).toBeDefined();
    expect(
      getStudentNavItems(0, { league: true, liveQuiz: true }).find((i) => i.label === 'PK 對戰'),
    ).toBeDefined();
  });
});

describe('<StudentSidebar> — feature flag props render (#3607)', () => {
  it('does not render 我們班/課堂搶答 buttons when both flags default to false', () => {
    renderWithRouter(<StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /我們班/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /課堂搶答/ })).toBeNull();
    // Always-on entries still render.
    expect(screen.getByRole('button', { name: /PK 對戰/ })).toBeTruthy();
  });

  it('renders 我們班 when leagueEnabled=true', () => {
    renderWithRouter(
      <StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={vi.fn()} leagueEnabled />,
    );
    expect(screen.getByRole('button', { name: /我們班/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /課堂搶答/ })).toBeNull();
  });

  it('renders 課堂搶答 when liveQuizEnabled=true', () => {
    renderWithRouter(
      <StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={vi.fn()} liveQuizEnabled />,
    );
    expect(screen.getByRole('button', { name: /課堂搶答/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /我們班/ })).toBeNull();
  });
});
