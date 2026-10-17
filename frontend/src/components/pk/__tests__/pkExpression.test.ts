import { describe, it, expect } from 'vitest';
import { resolveAiExpression } from '../pkExpression';

describe('resolveAiExpression', () => {
  it('passes through every valid PRD §10.5.3 expression unchanged', () => {
    for (const key of ['idle', 'thinking', 'happy', 'impressed', 'frustrated', 'victory', 'defeat'] as const) {
      expect(resolveAiExpression(key)).toBe(key);
    }
  });

  it('defaults to idle for null/undefined (human match, §8.2 — no figure to react)', () => {
    expect(resolveAiExpression(null)).toBe('idle');
    expect(resolveAiExpression(undefined)).toBe('idle');
  });

  it('defaults to idle for an unrecognized wire value instead of rendering a broken image path', () => {
    expect(resolveAiExpression('angry')).toBe('idle');
    expect(resolveAiExpression('')).toBe('idle');
  });
});
