import { describe, it, expect } from 'vitest';
import { motionClass } from '../motionClass';

describe('motionClass', () => {
  it('returns the animated class name when motion is not reduced', () => {
    expect(motionClass(false, 'animate-fade-in')).toBe('animate-fade-in');
  });

  it('returns an empty string under prefers-reduced-motion', () => {
    expect(motionClass(true, 'animate-fade-in')).toBe('');
  });
});
