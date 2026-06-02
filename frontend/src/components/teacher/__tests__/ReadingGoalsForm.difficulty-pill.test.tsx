/**
 * TDD test for issue #1990:
 * Difficulty pill (初/中/高級) must have clearly distinct selected vs unselected visual state.
 * Asserts aria-pressed + data-selected attribute so CSS can target reliably.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ReadingGoalsForm, { GoalsFormState } from '../ReadingGoalsForm';

const defaultValue: GoalsFormState = {
  target_cpm: null,
  target_accuracy: null,
  difficulty_label: null,
};

describe('ReadingGoalsForm — difficulty pill selected state (#1990)', () => {
  it('renders all 3 difficulty pills', () => {
    render(<ReadingGoalsForm value={defaultValue} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '初級' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '中級' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '高級' })).toBeInTheDocument();
  });

  it('unselected pills have aria-pressed=false', () => {
    render(<ReadingGoalsForm value={defaultValue} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '初級' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '中級' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '高級' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('selected pill has aria-pressed=true, others remain false', () => {
    const value: GoalsFormState = { ...defaultValue, difficulty_label: '中級' };
    render(<ReadingGoalsForm value={value} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '初級' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '中級' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '高級' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('selected pill has data-selected=true for CSS targeting', () => {
    const value: GoalsFormState = { ...defaultValue, difficulty_label: '高級' };
    render(<ReadingGoalsForm value={value} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '高級' })).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('button', { name: '初級' })).toHaveAttribute('data-selected', 'false');
  });

  it('clicking a pill calls onChange with correct difficulty_label', () => {
    const onChange = vi.fn();
    render(<ReadingGoalsForm value={defaultValue} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '初級' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ difficulty_label: '初級' })
    );
  });

  it('clicking the already-selected pill deselects (calls onChange with null)', () => {
    const value: GoalsFormState = { ...defaultValue, difficulty_label: '初級' };
    const onChange = vi.fn();
    render(<ReadingGoalsForm value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '初級' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ difficulty_label: null })
    );
  });
});
