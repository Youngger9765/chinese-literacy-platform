/**
 * TDD tests for WriteCharacter.tsx — issue #1858
 *
 * Acceptance criteria (from issue):
 * 1. outlined-once: starts with animation preview + completes after 1 correct trace
 * 2. no-outline-once: skips animation + hides outline
 * 3. standard: advances 3 outlined practices then 1 no-outline practice
 * 4. missing stroke data: shows character-specific error + no canvas practice
 *
 * Tests must pass BEFORE and AFTER the refactor.
 * Tautology guard: assertions are behavioural, not implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

// ──────────────────────────────────────────────────────────────────────
//  Mocks
// ──────────────────────────────────────────────────────────────────────

// Minimal CharacterStrokeData for a 2-stroke character
const MOCK_DATA = {
  character: '人',
  strokePaths: ['M 0 0 L 100 100', 'M 100 0 L 0 100'],
  medians: [
    [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    [{ x: 100, y: 0 }, { x: 0, y: 100 }],
  ],
  radicalIndices: [],
  nStrokes: 2,
};

// loadCharacterStrokeData returns mock data by default; set to null to simulate missing data
let mockLoadResult: typeof MOCK_DATA | null = MOCK_DATA;

vi.mock('../strokeData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../strokeData')>();
  return {
    ...actual,
    loadCharacterStrokeData: vi.fn(() => Promise.resolve(mockLoadResult)),
    CANVAS_SIZE: 1024,
    HINT_THRESHOLD: 3,
    isStrokeCorrect: vi.fn(() => true), // always correct by default
    getStrokeDuration: vi.fn(() => 100),
    renderStrokes: vi.fn(),
  };
});

vi.mock('../strokeRenderer', () => ({
  renderStrokes: vi.fn(),
}));

// Mock canvas APIs not available in jsdom
beforeEach(() => {
  // HTMLCanvasElement.getContext is undefined in jsdom; provide a minimal stub
  const stubCtx: Partial<CanvasRenderingContext2D> = {};
  HTMLCanvasElement.prototype.getContext = vi.fn(() => stubCtx as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  // Stub requestAnimationFrame / cancelAnimationFrame to run synchronously
  let rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafId;
    // Use Promise.resolve so it runs in the microtask queue (non-recursive)
    Promise.resolve().then(() => cb(performance.now()));
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  mockLoadResult = MOCK_DATA;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────
//  Helper
// ──────────────────────────────────────────────────────────────────────

async function renderAndLoad(props: Partial<Parameters<typeof import('../WriteCharacter').default>[0]> = {}) {
  const { default: WriteCharacter } = await import('../WriteCharacter');

  let rendered: ReturnType<typeof render>;
  await act(async () => {
    rendered = render(
      <WriteCharacter
        character="人"
        onComplete={vi.fn()}
        {...props}
      />
    );
  });
  // Drain microtasks / state updates from the async data load
  await act(async () => {});
  return rendered!;
}

// ──────────────────────────────────────────────────────────────────────
//  Test: missing stroke data
// ──────────────────────────────────────────────────────────────────────

describe('WriteCharacter — missing stroke data', () => {
  it('shows a character-specific error message', async () => {
    mockLoadResult = null; // simulate no data
    await renderAndLoad({ character: '吔' });

    // Should show the error text mentioning the character
    expect(screen.getByText(/吔.*筆順資料|筆順資料.*吔/)).toBeTruthy();
  });

  it('does not render a canvas for practice', async () => {
    mockLoadResult = null;
    const { container } = await renderAndLoad({ character: '吔' });

    // canvas element should not be present when there is no stroke data
    const canvases = container.querySelectorAll('canvas');
    expect(canvases.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
//  Test: no-outline-once mode
// ──────────────────────────────────────────────────────────────────────

describe('WriteCharacter — no-outline-once mode', () => {
  it('skips animation and goes straight to practice (no 開始練習 button)', async () => {
    await renderAndLoad({ practiceMode: 'no-outline-once' });

    // The animation phase shows a "開始練習" button; in no-outline-once there is none
    expect(screen.queryByText('開始練習')).toBeNull();
  });

  it('renders a canvas for practice', async () => {
    const { container } = await renderAndLoad({ practiceMode: 'no-outline-once' });
    expect(container.querySelectorAll('canvas').length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
//  Test: outlined-once mode
// ──────────────────────────────────────────────────────────────────────

describe('WriteCharacter — outlined-once mode', () => {
  it('starts with animation preview (shows 開始練習 button)', async () => {
    await renderAndLoad({ practiceMode: 'outlined-once' });

    // outlined-once plays the stroke-order preview first (restored in #1529)
    expect(screen.getByText('開始練習')).toBeTruthy();
  });

  it('fires onComplete after 1 correct trace is submitted', async () => {
    const onComplete = vi.fn();
    const { container } = await renderAndLoad({
      practiceMode: 'outlined-once',
      onComplete,
    });

    // Simulate clicking 開始練習
    await act(async () => {
      screen.getByText('開始練習').click();
    });
    await act(async () => {});

    // Simulate drawing a correct stroke sequence on the canvas
    const canvas = container.querySelector('canvas')!;

    // Fire pointer events for each of the 2 strokes
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        const rect = { left: 0, top: 0, width: 300, height: 300 } as DOMRect;
        canvas.getBoundingClientRect = vi.fn(() => rect);
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      });
      await act(async () => {});
    }

    // Wait for the 600ms completion timer (real timers)
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    }, { timeout: 1500 });
  });
});

// ──────────────────────────────────────────────────────────────────────
//  Test: standard mode
// ──────────────────────────────────────────────────────────────────────

describe('WriteCharacter — standard mode', () => {
  it('shows 開始練習 button during animation phase', async () => {
    await renderAndLoad({ practiceMode: 'standard' });
    expect(screen.getByText('開始練習')).toBeTruthy();
  });

  it('shows progress dots (練習回合 tracking) in standard mode', async () => {
    const { container } = await renderAndLoad({ practiceMode: 'standard' });

    // Click 開始練習 to advance past animation
    await act(async () => {
      screen.getByText('開始練習').click();
    });
    await act(async () => {});

    // Progress dots are rendered in standard (non-embedded) mode
    // They contain labels "1" "2" "3" and "無框"
    expect(screen.queryByText('無框')).toBeTruthy();
  });

  it('does not call onComplete during outlined practice rounds', async () => {
    const onComplete = vi.fn();
    await renderAndLoad({ practiceMode: 'standard', onComplete });

    // Just click 開始練習 and do one stroke sequence; onComplete should NOT fire
    const { container } = await renderAndLoad({ practiceMode: 'standard', onComplete });
    await act(async () => {
      screen.getAllByText('開始練習')[0].click();
    });
    await act(async () => {});

    const canvas = container.querySelector('canvas')!;
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        const rect = { left: 0, top: 0, width: 300, height: 300 } as DOMRect;
        canvas.getBoundingClientRect = vi.fn(() => rect);
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, clientY: 50, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      });
      await act(async () => {});
    }

    // Give 300ms — onComplete should NOT fire after one practice round in standard mode
    await new Promise(r => setTimeout(r, 300));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
