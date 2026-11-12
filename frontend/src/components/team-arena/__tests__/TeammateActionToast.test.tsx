import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TeammateActionToast from '../TeammateActionToast';

describe('TeammateActionToast (#3778)', () => {
  it('renders the given text', () => {
    render(<TeammateActionToast text="隊友打倒了一座塔！" tone="good" />);
    expect(screen.getByText('隊友打倒了一座塔！')).toBeTruthy();
  });

  it('uses a distinct style for good vs bad news', () => {
    const { rerender, container } = render(<TeammateActionToast text="好消息" tone="good" />);
    const good = container.querySelector('[data-testid="teammate-action-toast"]')?.className;
    rerender(<TeammateActionToast text="壞消息" tone="bad" />);
    const bad = container.querySelector('[data-testid="teammate-action-toast"]')?.className;
    expect(good).not.toBe(bad);
  });
});
