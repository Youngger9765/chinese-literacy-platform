/**
 * TDD for AttackAnimation — PRD §0 v2 改版 N: ≤1.5s, respects
 * prefers-reduced-motion (fade only), never blocks the next question
 * (always calls onComplete eventually).
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AttackAnimation from '../AttackAnimation';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

describe('AttackAnimation', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
  });

  it('renders the real attack animation class by default (motion allowed)', () => {
    mockMatchMedia(false);
    render(<AttackAnimation variant="fireball" onComplete={() => {}} />);
    const el = screen.getByTestId('attack-animation');
    expect(el.className).toContain('animate-attack-fireball');
    expect(el.getAttribute('data-reduced-motion')).toBeNull();
  });

  it('falls back to a plain fade when prefers-reduced-motion is set', () => {
    mockMatchMedia(true);
    render(<AttackAnimation variant="tornado" onComplete={() => {}} />);
    const el = screen.getByTestId('attack-animation');
    expect(el.getAttribute('data-reduced-motion')).toBe('true');
    expect(el.className).not.toContain('animate-attack-tornado');
    expect(el.className).toContain('animate-fade-in');
  });

  it('calls onComplete exactly once even if onAnimationEnd never fires (fallback timer)', () => {
    vi.useFakeTimers();
    mockMatchMedia(false);
    const onComplete = vi.fn();
    render(<AttackAnimation variant="meteor" onComplete={onComplete} />);
    vi.advanceTimersByTime(5000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('never blocks: reduced-motion path also eventually calls onComplete', () => {
    vi.useFakeTimers();
    mockMatchMedia(true);
    const onComplete = vi.fn();
    render(<AttackAnimation variant="rock" onComplete={onComplete} />);
    vi.advanceTimersByTime(1000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
