/**
 * PodiumCeremony — #3630 課堂搶答結束畫面：高質感頒獎台。
 *
 * Spec corrected 2026-10-18 (Young, via issue comment + live coordinator
 * note): the podium DOES show each top-3 finisher's score on their plinth
 * (originally scoped as score-free; superseded). Students never see rank —
 * that rule lives on the student screens, untouched by this component.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, within, act } from '@testing-library/react';
import PodiumCeremony from '../PodiumCeremony';
import { PODIUM_TIMING_MS } from '../usePodiumCeremony';
import { PODIUM_MUTE_KEY } from '../podiumSound';
import type { LiveQuizLeaderboardEntry } from '../../../services/liveQuizApi';

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

const THREE: LiveQuizLeaderboardEntry[] = [
  { player_id: 1, display_name: '小明', total_score: 1800, rank: 1 },
  { player_id: 2, display_name: '小華', total_score: 1400, rank: 2 },
  { player_id: 3, display_name: '小美', total_score: 900, rank: 3 },
];

describe('PodiumCeremony', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
  });

  it('mounts without throwing (render smoke)', () => {
    mockMatchMedia(false);
    expect(() => render(<PodiumCeremony topThree={THREE} />)).not.toThrow();
  });

  it('reveals rank 3, then rank 2, then rank 1 in that order, each showing its name AND score', () => {
    mockMatchMedia(false);
    const { getByTestId, queryByTestId } = render(<PodiumCeremony topThree={THREE} />);

    expect(getByTestId('podium-plinth-3').getAttribute('data-revealed')).toBe('false');
    expect(getByTestId('podium-plinth-2').getAttribute('data-revealed')).toBe('false');
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('false');
    expect(queryByTestId('podium-confetti')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.THIRD);
    });
    expect(getByTestId('podium-plinth-3').getAttribute('data-revealed')).toBe('true');
    expect(within(getByTestId('podium-plinth-3')).getByText('小美')).not.toBeNull();
    expect(within(getByTestId('podium-plinth-3')).getByText('900')).not.toBeNull();
    expect(getByTestId('podium-plinth-2').getAttribute('data-revealed')).toBe('false');
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('false');

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SECOND - PODIUM_TIMING_MS.THIRD);
    });
    expect(getByTestId('podium-plinth-2').getAttribute('data-revealed')).toBe('true');
    expect(within(getByTestId('podium-plinth-2')).getByText('小華')).not.toBeNull();
    expect(within(getByTestId('podium-plinth-2')).getByText('1400')).not.toBeNull();
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('false');
    expect(queryByTestId('podium-confetti')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.FIRST - PODIUM_TIMING_MS.SECOND);
    });
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('true');
    expect(within(getByTestId('podium-plinth-1')).getByText('小明')).not.toBeNull();
    expect(within(getByTestId('podium-plinth-1')).getByText('1800')).not.toBeNull();
    expect(getByTestId('podium-confetti')).not.toBeNull();
  });

  it('handles exactly 2 finishers: only rank-2 and rank-1 plinths exist, no 3rd slot', () => {
    mockMatchMedia(false);
    const { queryByTestId, getByTestId } = render(<PodiumCeremony topThree={THREE.slice(0, 2)} />);
    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect(queryByTestId('podium-plinth-3')).toBeNull();
    expect(getByTestId('podium-plinth-2').getAttribute('data-revealed')).toBe('true');
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('true');
  });

  it('handles exactly 1 finisher: only the champion plinth renders, confetti still fires', () => {
    mockMatchMedia(false);
    const { queryByTestId, getByTestId } = render(<PodiumCeremony topThree={THREE.slice(0, 1)} />);
    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect(queryByTestId('podium-plinth-3')).toBeNull();
    expect(queryByTestId('podium-plinth-2')).toBeNull();
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('true');
    expect(getByTestId('podium-confetti')).not.toBeNull();
  });

  it('handles 0 finishers with an intentional empty-stage message, not an empty podium shell', () => {
    mockMatchMedia(false);
    const { queryByTestId, getByText } = render(<PodiumCeremony topThree={[]} />);
    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect(queryByTestId('podium-plinth-1')).toBeNull();
    expect(queryByTestId('podium-plinth-2')).toBeNull();
    expect(queryByTestId('podium-plinth-3')).toBeNull();
    expect(queryByTestId('podium-confetti')).toBeNull();
    expect(getByText(/沒有.*完成/)).not.toBeNull();
  });

  it('prefers-reduced-motion renders statically: all plinths revealed immediately, no confetti element ever', () => {
    mockMatchMedia(true);
    const { getByTestId, queryByTestId } = render(<PodiumCeremony topThree={THREE} />);

    expect(getByTestId('podium-plinth-3').getAttribute('data-revealed')).toBe('true');
    expect(getByTestId('podium-plinth-2').getAttribute('data-revealed')).toBe('true');
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('true');
    expect(within(getByTestId('podium-plinth-1')).getByText('1800')).not.toBeNull();
    expect(queryByTestId('podium-confetti')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect(queryByTestId('podium-confetti')).toBeNull();
  });

  it('mute toggle persists across remounts, defaulting to unmuted when motion is not reduced', () => {
    mockMatchMedia(false);
    const first = render(<PodiumCeremony topThree={THREE} />);
    const toggle = first.getByTestId('podium-mute-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      toggle.click();
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(PODIUM_MUTE_KEY)).toBe('true');
    first.unmount();

    const second = render(<PodiumCeremony topThree={THREE} />);
    expect(second.getByTestId('podium-mute-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('defaults to muted under prefers-reduced-motion when no preference was ever saved', () => {
    mockMatchMedia(true);
    const { getByTestId } = render(<PodiumCeremony topThree={THREE} />);
    expect(getByTestId('podium-mute-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('never throws across the whole reveal sequence when the browser has no Web Audio support', () => {
    mockMatchMedia(false);
    const original = (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;

    expect(() => {
      render(<PodiumCeremony topThree={THREE} />);
      act(() => {
        vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
      });
    }).not.toThrow();

    (window as unknown as { AudioContext?: unknown }).AudioContext = original;
  });

  it('replay button restarts the reveal sequence from nothing-revealed', () => {
    mockMatchMedia(false);
    const { getByTestId } = render(<PodiumCeremony topThree={THREE} />);
    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('true');

    act(() => {
      getByTestId('podium-replay-button').click();
    });
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('false');
    expect(getByTestId('podium-plinth-3').getAttribute('data-revealed')).toBe('false');

    act(() => {
      vi.advanceTimersByTime(PODIUM_TIMING_MS.SETTLE);
    });
    expect(getByTestId('podium-plinth-1').getAttribute('data-revealed')).toBe('true');
  });
});
