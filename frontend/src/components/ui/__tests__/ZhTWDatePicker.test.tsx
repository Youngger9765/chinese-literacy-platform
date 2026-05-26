/**
 * TDD test for ZhTWDatePicker — issue #2005
 * Asserts the component does NOT show mm/dd/yyyy Chrome-native placeholder,
 * and instead renders a zh-TW localized date picker.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ZhTWDatePicker } from '../ZhTWDatePicker';

describe('ZhTWDatePicker', () => {
  it('renders without a native date input (no mm/dd/yyyy placeholder)', () => {
    render(<ZhTWDatePicker value="" onChange={() => {}} />);
    // Native <input type="date"> would have a shadow-DOM placeholder of "mm/dd/yyyy".
    // Our custom picker must NOT render a raw <input type="date">.
    const nativeDateInputs = document.querySelectorAll('input[type="date"]');
    expect(nativeDateInputs.length).toBe(0);
  });

  it('renders a text input (custom picker trigger)', () => {
    render(<ZhTWDatePicker value="" onChange={() => {}} />);
    // Should have at least one text/button input or trigger button
    const textInput = screen.getByRole('textbox');
    expect(textInput).toBeInTheDocument();
  });

  it('shows yyyy/MM/dd placeholder text (zh-TW format)', () => {
    render(<ZhTWDatePicker value="" onChange={() => {}} />);
    const input = screen.getByPlaceholderText('年/月/日');
    expect(input).toBeInTheDocument();
  });

  it('displays existing value in yyyy/MM/dd format', () => {
    render(<ZhTWDatePicker value="2026-06-15" onChange={() => {}} />);
    const input = screen.getByDisplayValue('2026/06/15');
    expect(input).toBeInTheDocument();
  });
});
