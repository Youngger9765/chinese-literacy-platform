import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SelfAssessment, { type AssessmentRating } from '../full-reading/SelfAssessment';

describe('SelfAssessment', () => {
  it('renders 3 rating buttons', () => {
    render(<SelfAssessment onSelect={vi.fn()} />);
    expect(screen.getByLabelText('自評：需要加油')).toBeTruthy();
    expect(screen.getByLabelText('自評：還不錯')).toBeTruthy();
    expect(screen.getByLabelText('自評：非常流暢')).toBeTruthy();
  });

  it('calls onSelect with correct rating when clicking low', () => {
    const onSelect = vi.fn();
    render(<SelfAssessment onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText('自評：需要加油'));
    expect(onSelect).toHaveBeenCalledWith('low');
  });

  it('calls onSelect with correct rating when clicking mid', () => {
    const onSelect = vi.fn();
    render(<SelfAssessment onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText('自評：還不錯'));
    expect(onSelect).toHaveBeenCalledWith('mid');
  });

  it('calls onSelect with correct rating when clicking high', () => {
    const onSelect = vi.fn();
    render(<SelfAssessment onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText('自評：非常流暢'));
    expect(onSelect).toHaveBeenCalledWith('high');
  });

  it('disables buttons after selection', () => {
    const onSelect = vi.fn();
    render(<SelfAssessment onSelect={onSelect} selectedRating="mid" />);
    const lowBtn = screen.getByLabelText('自評：需要加油') as HTMLButtonElement;
    const highBtn = screen.getByLabelText('自評：非常流暢') as HTMLButtonElement;
    expect(lowBtn.disabled).toBe(true);
    expect(highBtn.disabled).toBe(true);
  });

  it('does not show comparison when showComparison is false', () => {
    render(
      <SelfAssessment
        onSelect={vi.fn()}
        selectedRating="high"
        aiRating="high"
        showComparison={false}
      />
    );
    expect(screen.queryByText('你的判斷跟 AI 一樣')).toBeNull();
  });

  it('shows match message when selected === AI rating', () => {
    render(
      <SelfAssessment
        onSelect={vi.fn()}
        selectedRating="high"
        aiRating="high"
        showComparison={true}
      />
    );
    expect(screen.getByText(/你的判斷跟 AI 一樣/)).toBeTruthy();
  });

  it('shows mismatch message with AI rating label when ratings differ', () => {
    render(
      <SelfAssessment
        onSelect={vi.fn()}
        selectedRating="low"
        aiRating="mid"
        showComparison={true}
      />
    );
    expect(screen.getByText(/AI 覺得你這次讀得/)).toBeTruthy();
    expect(screen.getByText('中')).toBeTruthy();
  });

  it('marks selected button as aria-pressed', () => {
    render(<SelfAssessment onSelect={vi.fn()} selectedRating="mid" />);
    const midBtn = screen.getByLabelText('自評：還不錯') as HTMLButtonElement;
    expect(midBtn.getAttribute('aria-pressed')).toBe('true');
    const lowBtn = screen.getByLabelText('自評：需要加油') as HTMLButtonElement;
    expect(lowBtn.getAttribute('aria-pressed')).toBe('false');
  });
});
