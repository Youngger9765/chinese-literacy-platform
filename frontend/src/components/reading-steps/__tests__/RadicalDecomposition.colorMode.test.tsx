/**
 * Tests for #1342: RadicalDecomposition colorMode + mergeMode props.
 *
 * These tests only verify the structural/textual changes driven by the new
 * props. Canvas-heavy or API-dependent behavior is covered by e2e/QA tests.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import RadicalDecomposition, { RADICAL_COLOR_CLASSES } from '../RadicalDecomposition';

// Stub the data/radicals module so we don't need the large JSON chunks
vi.mock('../../../data/radicals', () => ({
  getDecomposition: vi.fn((char: string) => {
    if (char === '攻') {
      return {
        components: [
          { radical: '工', role: '聲符', label: '音符' },
          { radical: '攵', role: '形符', label: '動作' },
        ],
      };
    }
    return null; // treated as 獨體字
  }),
  getDecompositionSource: vi.fn(() => 'hand-curated'),
  getRadicalInfo: vi.fn(() => null),
  getRelatedChars: vi.fn(() => []),
  initGeneratedDecompositions: vi.fn(() => Promise.resolve()),
  initRadicalMeanings: vi.fn(() => Promise.resolve()),
}));

// Stub lookupCharactersBatch
vi.mock('../../../services/learningApi', () => ({
  lookupCharactersBatch: vi.fn(() => Promise.resolve({ results: [] })),
}));

describe('RadicalDecomposition colorMode + mergeMode (#1342)', () => {
  it('exports RADICAL_COLOR_CLASSES array with at least 3 entries', () => {
    expect(Array.isArray(RADICAL_COLOR_CLASSES)).toBe(true);
    expect(RADICAL_COLOR_CLASSES.length).toBeGreaterThanOrEqual(3);
    // All entries must be Tailwind text-* classes
    for (const cls of RADICAL_COLOR_CLASSES) {
      expect(cls).toMatch(/^text-/);
    }
  });

  it('renders 部件拆解 header in default mode', () => {
    render(<RadicalDecomposition char="攻" />);
    expect(screen.getByText('部件拆解')).toBeTruthy();
  });

  it('renders 部件上色 header when colorMode=true', () => {
    render(<RadicalDecomposition char="攻" colorMode />);
    expect(screen.getByText('部件上色')).toBeTruthy();
  });

  it('renders 合體！ header when colorMode=true and mergeMode=true', () => {
    render(<RadicalDecomposition char="攻" colorMode mergeMode />);
    expect(screen.getByText('合體！')).toBeTruthy();
  });

  it('shows merge celebration banner in mergeMode', () => {
    render(<RadicalDecomposition char="攻" colorMode mergeMode />);
    expect(screen.getByText(/部件合在一起，就成了「攻」這個字！/)).toBeTruthy();
  });

  it('hides related-chars section in colorMode', () => {
    render(<RadicalDecomposition char="攻" colorMode />);
    // Related chars section label should not be present
    expect(screen.queryByText(/含「/)).toBeNull();
  });

  it('shows color legend when colorMode=true and not mergeMode', () => {
    render(<RadicalDecomposition char="攻" colorMode />);
    // Color legend shows "radical = label" format
    expect(screen.getByText(/工 = 音符/)).toBeTruthy();
    expect(screen.getByText(/攵 = 動作/)).toBeTruthy();
  });

  it('renders 獨體字 fallback when char has no decomposition', () => {
    render(<RadicalDecomposition char="一" colorMode />);
    expect(screen.getByText('獨體字')).toBeTruthy();
  });
});
