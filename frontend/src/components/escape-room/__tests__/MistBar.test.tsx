import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MistBar from '../MistBar';

describe('MistBar', () => {
  it.each([0, 100, 30])('顯示距離 %i 對應的剩餘安全空間', (distance) => {
    render(<MistBar distance={distance} reducedMotion />);

    expect(screen.getByText(`還有 ${distance} 格空間`)).toBeInTheDocument();
  });
});
