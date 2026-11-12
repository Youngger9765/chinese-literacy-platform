/**
 * PkHeroBanner — #3761. Locks:
 * (1) all 7 PK_FIGURES render a thumb, each pointing at its own
 *     `story-assets/pk-{slug}/portrait-idle.png` (not `pkFigurePortraitUrl()`,
 *     which would return stale placeholder SVGs for tiers 1-6 — see file
 *     docstring for why).
 * (2) a broken image (a tier whose PNG hasn't landed yet) falls back to an
 *     initial-letter circle instead of showing a broken-image icon.
 * (3) the 3 "怎麼玩" steps all render with their icon + text.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PK_FIGURES } from '../../../data/pkFigures';
import PkHeroBanner from '../PkHeroBanner';

describe('<PkHeroBanner> (#3761)', () => {
  it('renders a portrait thumb for every one of the 7 figures, pointed at the real PNG path', () => {
    render(<PkHeroBanner />);
    for (const figure of PK_FIGURES) {
      const img = document.querySelector(`img[src="/story-assets/pk-${figure.slug}/portrait-idle.png"]`);
      expect(img, `missing thumb for ${figure.slug}`).toBeTruthy();
    }
    expect(document.querySelectorAll('img').length).toBe(PK_FIGURES.length);
  });

  it('falls back to an initial-letter circle (not a broken-image icon) when a figure\'s PNG 404s', () => {
    render(<PkHeroBanner />);
    const firstFigure = PK_FIGURES[0];
    const img = document.querySelector(
      `img[src="/story-assets/pk-${firstFigure.slug}/portrait-idle.png"]`,
    ) as HTMLImageElement;
    expect(img).toBeTruthy();
    fireEvent.error(img);
    // The <img> is replaced by a div showing the figure's first character.
    expect(
      document.querySelector(`img[src="/story-assets/pk-${firstFigure.slug}/portrait-idle.png"]`),
    ).toBeNull();
    expect(screen.getByText(firstFigure.name.charAt(0))).toBeTruthy();
  });

  it('shows all 3 怎麼玩 steps with their text', () => {
    render(<PkHeroBanner />);
    expect(screen.getByText('怎麼玩？')).toBeTruthy();
    expect(screen.getByText('5 題搶答，答得又對又快分數越高')).toBeTruthy();
    expect(screen.getByText('平手時看誰總作答時間比較快')).toBeTruthy();
    expect(screen.getByText('打贏文學家可以解鎖他的人物卡')).toBeTruthy();
  });

  it('shows the PK 對戰 title and subtitle', () => {
    render(<PkHeroBanner />);
    expect(screen.getByRole('heading', { name: 'PK 對戰' })).toBeTruthy();
    expect(screen.getByText('一對一，隨時挑戰同學或文學家')).toBeTruthy();
  });
});
