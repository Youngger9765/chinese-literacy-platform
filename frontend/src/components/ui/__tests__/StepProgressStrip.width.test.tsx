import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StepProgressStrip from '../StepProgressStrip';

// At 390 five tiles per row left ~50px each and 「讀全文-做記號」 wrapped to
// three lines on the student assignment card. Three per row on phones,
// five from sm up.
describe('StepProgressStrip tile width', () => {
  it('3 per row on phones, 5 per row from sm', () => {
    render(<StepProgressStrip steps={[{ id: 'a', label: '讀全文-做記號' }]} completedSteps={new Set()} />);
    const tile = screen.getByTitle('讀全文-做記號');
    expect(tile.className).toMatch(/w-\[calc\(\(100%-0\.75rem\)\/3\)\]/);
    expect(tile.className).toMatch(/sm:w-\[calc\(\(100%-1\.5rem\)\/5\)\]/);
  });
});
