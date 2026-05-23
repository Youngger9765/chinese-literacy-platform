/**
 * TDD tests for HomeStats / InlineXPPill (Issue #1952)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// RED: will fail until HomeStats is created
import { InlineXPPill } from '../HomeStats';
import type { GamificationSummary } from '../../../../services/gamificationApi';

const mockSummary: GamificationSummary = {
  student_id: 1,
  total_xp: 250,
  stories_completed: 5,
  level_info: {
    level: 3,
    title: 'Reader',
    current_level_xp: 50,
    next_level_xp: 100,
    total_xp: 250,
    progress_percent: 50,
  },
  streak: {
    current: 7,
    longest: 10,
    last_activity_date: '2026-05-22',
  },
  badges: [],
  all_badges: [],
};

const mockSummaryNoStreak: GamificationSummary = {
  ...mockSummary,
  streak: { current: 0, longest: 0, last_activity_date: '' },
};

describe('InlineXPPill', () => {
  it('renders level number', () => {
    render(<InlineXPPill summary={mockSummary} onClick={vi.fn()} />);
    expect(screen.getByText('Lv.3')).toBeTruthy();
  });

  it('renders streak count', () => {
    render(<InlineXPPill summary={mockSummary} onClick={vi.fn()} />);
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('shows fire emoji when streak > 0', () => {
    render(<InlineXPPill summary={mockSummary} onClick={vi.fn()} />);
    expect(screen.getByText('🔥')).toBeTruthy();
  });

  it('shows sleep emoji when streak is 0', () => {
    render(<InlineXPPill summary={mockSummaryNoStreak} onClick={vi.fn()} />);
    expect(screen.getByText('💤')).toBeTruthy();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<InlineXPPill summary={mockSummary} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
