/**
 * PkVsScreen — PK gamification MVP (launch-plan, 2026-10-17): the AI
 * opponent now gets a big portrait panel (via the shared PkFigurePortrait
 * component / data/pkFigures.ts art resolution) instead of a small cropped
 * circle avatar, and entrance animation is explicitly gated by
 * prefers-reduced-motion (motionClass) on top of the existing global CSS
 * safety net (index.css), so the two states stay assertable here.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import PkVsScreen from '../PkVsScreen';

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

describe('PkVsScreen', () => {
  afterEach(() => {
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
  });

  it('renders the AI opponent as a big portrait resolved via the shared art-source helper', () => {
    mockMatchMedia(false);
    const { getByAltText } = render(
      <PkVsScreen myName="小明" opponentName="李白" opponentIsAi opponentTier={7} onDone={() => {}} />,
    );
    const img = getByAltText('李白') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/story-assets/pk-li-bai/portrait-idle.png');
  });

  it('applies entrance animation classes by default', () => {
    mockMatchMedia(false);
    const { container } = render(
      <PkVsScreen myName="小明" opponentName="李白" opponentIsAi opponentTier={7} onDone={() => {}} />,
    );
    expect(container.querySelector('.animate-fade-in')).not.toBeNull();
    expect(container.querySelectorAll('.animate-card-in').length).toBe(2);
  });

  it('drops entrance animation classes under prefers-reduced-motion', () => {
    mockMatchMedia(true);
    const { container } = render(
      <PkVsScreen myName="小明" opponentName="李白" opponentIsAi opponentTier={7} onDone={() => {}} />,
    );
    expect(container.querySelector('.animate-fade-in')).toBeNull();
    expect(container.querySelectorAll('.animate-card-in').length).toBe(0);
  });

  it('still falls back to an initials circle for a non-AI opponent with no avatar', () => {
    mockMatchMedia(false);
    const { queryByAltText, getByText } = render(
      <PkVsScreen myName="老王" opponentName="小華" opponentIsAi={false} onDone={() => {}} />,
    );
    expect(queryByAltText('小華')).toBeNull();
    expect(getByText('小')).not.toBeNull(); // initials-avatar fallback
  });
});
