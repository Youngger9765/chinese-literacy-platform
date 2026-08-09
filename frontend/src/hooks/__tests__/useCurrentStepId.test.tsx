/**
 * useCurrentStepId (#2588) — route-derived step id with a fail-safe fallback.
 *
 * Pages used to hardcode their step id (FullReadingPage wrote 'key-passage-reading' in
 * three places).  The hook derives it from the route so a renamed / re-mounted
 * step cannot split progress across two keys — but it must NEVER return an
 * unregistered id, because the backend maps step keys to step numbers and an
 * unknown key silently drops the completion (assignment can't be submitted).
 */
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { describe, it, expect } from 'vitest';

import { useCurrentStepId } from '../useCurrentStepId';
import { STEP_REGISTRY } from '../../config/stepConfig';

const wrapperFor = (initialPath: string) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>;
  };

const renderAt = (path: string, fallback = 'key-passage-reading') =>
  renderHook(() => useCurrentStepId(fallback), { wrapper: wrapperFor(path) }).result.current;

describe('useCurrentStepId', () => {
  it('returns the route segment when it is a registered step', () => {
    expect(renderAt('/learn/1/key-passage-reading')).toBe('key-passage-reading');
    expect(renderAt('/learn/42/paragraph-reading', 'key-passage-reading')).toBe('paragraph-reading');
  });

  it('follows the route when the step is mounted under a different registered id', () => {
    // Simulates a future rename: the page must report the id it is mounted at,
    // not the literal it was written with.
    const anyOtherStepId = 'character-practice';
    expect(STEP_REGISTRY[anyOtherStepId]).toBeTruthy();
    expect(renderAt(`/learn/1/${anyOtherStepId}`, 'key-passage-reading')).toBe(anyOtherStepId);
  });

  it('falls back to the canonical id for an UNREGISTERED segment (never persists unknown keys)', () => {
    expect(renderAt('/learn/1/not-a-step')).toBe('key-passage-reading');
  });

  it('falls back outside the learning flow / on trailing slashes', () => {
    expect(renderAt('/library')).toBe('key-passage-reading');
    expect(renderAt('/learn/1/')).toBe('key-passage-reading');
    expect(renderAt('/')).toBe('key-passage-reading');
  });
});
