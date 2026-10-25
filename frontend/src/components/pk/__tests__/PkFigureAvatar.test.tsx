/**
 * PkFigureAvatar — #3761 round 4. Shared by PkHeroBanner and
 * PkHistoryPanel's defeat roster (see component docstring for why they
 * were unified). Locks: real image path construction, broken-image
 * fallback, locked/unlocked visual state, and size variants.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import PkFigureAvatar from '../PkFigureAvatar';

describe('<PkFigureAvatar> (#3761 round 4)', () => {
  it('builds the image path directly from slug (not from pkFigures.ts PK_PNG_ART_OVERRIDE or an icon_url prop)', () => {
    render(<PkFigureAvatar slug="du-fu" name="杜甫" />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.src).toContain('/story-assets/pk-du-fu/portrait-idle.png');
    expect(img.alt).toBe('杜甫');
  });

  it('falls back to an initial-letter circle (not a broken-image icon) on image error', () => {
    render(<PkFigureAvatar slug="du-fu" name="杜甫" />);
    const img = document.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('杜');
  });

  it('round 4 contrast fix: the fallback circle has a SOLID background color (not white/20) — visible on light panels, not just dark banners', () => {
    const { container } = render(<PkFigureAvatar slug="du-fu" name="杜甫" />);
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    const fallback = container.firstChild as HTMLElement;
    expect(fallback.className).not.toContain('bg-white');
    expect(fallback.style.backgroundColor).not.toBe('');
    expect(fallback.style.backgroundColor).not.toMatch(/rgba\(255, ?255, ?255/);
  });

  it('round 4: a locked fallback (no photo, not yet beaten) is a plain muted gray, not this figure\'s own color', () => {
    const { container } = render(<PkFigureAvatar slug="du-fu" name="杜甫" locked />);
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    const fallback = container.firstChild as HTMLElement;
    expect(fallback.style.backgroundColor).toBe('rgb(156, 163, 175)'); // #9CA3AF
  });

  it('locked=true grayscales the avatar and labels the alt text "尚未擊敗"', () => {
    render(<PkFigureAvatar slug="du-fu" name="杜甫" locked />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.className).toContain('grayscale');
    expect(img.alt).toBe('杜甫（尚未擊敗）');
  });

  it('locked=false (default) is never grayscaled', () => {
    render(<PkFigureAvatar slug="du-fu" name="杜甫" />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.className).not.toContain('grayscale');
  });

  it('size prop changes the rendered dimensions class', () => {
    const { container: smContainer } = render(<PkFigureAvatar slug="du-fu" name="杜甫" size="sm" />);
    const { container: lgContainer } = render(<PkFigureAvatar slug="du-fu" name="杜甫" size="lg" />);
    expect(smContainer.querySelector('img')?.className).toContain('h-12');
    expect(lgContainer.querySelector('img')?.className).toContain('h-20');
  });
});
