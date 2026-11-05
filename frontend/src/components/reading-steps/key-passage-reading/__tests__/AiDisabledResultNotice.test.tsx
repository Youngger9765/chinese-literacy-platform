/**
 * #3856 — honest "AI grading is off" notice, no fabricated score.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AiDisabledResultNotice from '../AiDisabledResultNotice';

describe('AiDisabledResultNotice', () => {
  it('tells the student AI grading is off, without showing a 0% / 0-star score', () => {
    render(<AiDisabledResultNotice />);
    expect(screen.getByText(/AI 朗讀評分目前暫時關閉/)).toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/再多練幾次就會更熟/)).not.toBeInTheDocument();
  });
});
