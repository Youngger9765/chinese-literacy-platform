/**
 * #3397（第二階段）— ReadingPlayer's existing `size="sm"` variant (shipped by
 * the first pass, #3398) now needs to sit in the top toolbar row next to
 * QR 全文. `compactSpeed` forwards a collapsed TtsSpeedPicker so the row
 * doesn't get pushed into overflow or a second line by the 慢/稍慢/正常 trio.
 *
 * Default (no `compactSpeed`) must stay exactly what #3398 shipped.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReadingPlayer from '../ReadingPlayer';

const handlers = {
  onPlay: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onStop: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('#3397 ReadingPlayer compactSpeed', () => {
  it('default (compactSpeed unset) still shows the full 慢/稍慢/正常 trio', () => {
    render(<ReadingPlayer isPlaying={false} isPaused={false} size="sm" {...handlers} />);
    expect(screen.getByRole('button', { name: '朗讀速度 慢' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '朗讀速度 稍慢' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '朗讀速度 正常' })).toBeTruthy();
  });

  it('compactSpeed collapses the trio into one toggle button', () => {
    render(<ReadingPlayer isPlaying={false} isPaused={false} size="sm" compactSpeed {...handlers} />);
    // play button + one speed toggle = 2, not play + 3 rate buttons = 4
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '朗讀速度' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /朗讀速度 /})).toBeNull();
  });

  it('keeps pause/stop reachable at compactSpeed + sm size while playing', () => {
    render(<ReadingPlayer isPlaying isPaused={false} size="sm" compactSpeed {...handlers} />);
    const pause = screen.getByRole('button', { name: /暫停/ });
    const stop = screen.getByRole('button', { name: /停止/ });
    expect(pause.className).toContain('h-8');
    expect(stop.className).toContain('h-8');
  });

  it('does not affect md size (bare default call sites elsewhere)', () => {
    render(<ReadingPlayer isPlaying={false} isPaused={false} {...handlers} />);
    expect(screen.getByRole('button', { name: '朗讀速度 慢' })).toBeTruthy();
  });
});
